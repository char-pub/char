/**
 * CCv3 导出的按需构建：第一次请求导出时入队，worker 从 Release 的完整发布产物 生成 CCv3
 * 卡片（JSON）与 Loss Report，写入对象存储并登记缓存。
 *
 * - 输入是 Release 锁定的完整产物，含 Story、目录与策略；不读取当前默认配置。
 * - 产物是一个 JSON：`{ card, loss }`。public Release 写入 public 桶，其余写入 private 桶。
 * - 产物登记到 `blob_refs`（role 为 `export`），下架这个 Release 时会被一起删除。
 * - 幂等：缓存 key 已存在时直接跳过。Release 已被下架时不构建。
 */
import { exportCCv3 } from "@char-pub/ccv3";
import { type EffectiveMeta, type JSONValue, jcs, type ResolvedPreset } from "@char-pub/core";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { blobRefs, buildArtifacts, releases } from "../db/schema/index.js";
import { readArtifact } from "../registry/artifacts.js";
import type { Cas } from "../storage/cas.js";

export interface ExportJob {
  release_id: string;
  target: "ccv3";
  cache_key: string;
  preset_release_id?: string;
  private_output?: boolean;
  locale?: string;
}

export interface ExportDeps {
  db: Db;
  cas: Cas;
}

export type ExportOutcome = "built" | "cached" | "skipped";

export async function handleExportJob(deps: ExportDeps, job: ExportJob): Promise<ExportOutcome> {
  const { db, cas } = deps;
  const [cached] = await db
    .select()
    .from(buildArtifacts)
    .where(eq(buildArtifacts.cacheKey, job.cache_key))
    .limit(1);
  if (cached) return "cached";
  const [r] = await db.select().from(releases).where(eq(releases.id, job.release_id)).limit(1);
  if (!r || r.status === "tombstoned" || r.publishState !== "done" || !r.contextIrDigest) {
    return "skipped";
  }
  const bucket = r.visibility === "public" ? ("public" as const) : ("private" as const);
  const contentArtifact = await readArtifact(cas, r, "https://assets.char.pub/cas/sha256");
  if (contentArtifact.kind !== "content") return "skipped";
  let resolvedPreset: ResolvedPreset | undefined;
  let presetMeta: EffectiveMeta | undefined;
  let presetPublic = true;
  if (job.preset_release_id) {
    const [p] = await db
      .select()
      .from(releases)
      .where(eq(releases.id, job.preset_release_id))
      .limit(1);
    if (!p || p.status === "tombstoned" || p.publishState !== "done") return "skipped";
    const artifact = await readArtifact(cas, p, "https://assets.char.pub/cas/sha256");
    if (artifact.kind !== "preset") return "skipped";
    resolvedPreset = artifact.preset;
    presetMeta = artifact.meta;
    presetPublic = p.visibility === "public";
  }
  const { card, loss } = exportCCv3(contentArtifact, {
    ...(resolvedPreset ? { resolvedPreset, ...(presetMeta ? { presetMeta } : {}) } : {}),
    ...(job.locale ? { locale: job.locale } : {}),
  });
  const bytes = new TextEncoder().encode(jcs({ card, loss } as unknown as JSONValue));
  const blob = await cas.putBlob(db, {
    bucket: job.private_output || !presetPublic ? "private" : bucket,
    bytes,
    mediaType: "application/json",
    kind: "export",
  });
  await db.transaction(async (tx) => {
    await tx
      .insert(buildArtifacts)
      .values({ cacheKey: job.cache_key, target: job.target, blobDigest: blob.digest })
      .onConflictDoNothing();
    await tx
      .insert(blobRefs)
      .values([
        { digest: blob.digest, releaseId: r.id, role: "export" },
        ...(job.preset_release_id
          ? [{ digest: blob.digest, releaseId: job.preset_release_id, role: "export" }]
          : []),
      ])
      .onConflictDoNothing();
  });
  return "built";
}
