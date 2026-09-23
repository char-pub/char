/**
 * worker 的 publish 任务：完成发布校验与构建，把 pending 的 Release 变成 active，或者标记为
 * failed 并释放 label。
 *
 * 步骤：
 * 1. 从私有对象存储重建 Revision 的 canonical Creation（核对 semantic digest）；
 * 2. 从已发布依赖的快照加载依赖闭包，读取 Registry 状态（已用 label、asset、黑名单、权利人）；
 * 3. 运行 core 的发布校验；失败 → failed，Publish Report 写入 Release，label 释放；
 * 4. 成功 → 写入快照与 Context IR（public Release 进 public 桶，否则进 private 桶；
 *    public 发布时把 fragment 与 manifest 复制到 public 桶），物化依赖闭包、反向依赖、
 *    闭包中的全部 fragment 与 blob 反向引用，Release 进入 active，写审计。
 *
 * 数据库变更在一个事务里完成，并用 `runOnce` 记录幂等 key：任务被重复投递时直接跳过。
 * 对象存储的写入发生在事务之前；对象按内容寻址，重复写入没有副作用。
 *
 * 发布功能被 kill switch 关闭时，任务不做任何事，Release 保持 pending；开关恢复后由
 * `requeuePendingPublishes` 重新入队。这样关闭多久都不会耗尽重试次数。
 */
import {
  checkPublish,
  isCharError,
  type JSONValue,
  normalizeValue,
  type ResolveOutput,
} from "@char-pub/core";
import { and, eq, lt } from "drizzle-orm";
import { appendAudit } from "../audit/audit.js";
import type { Db, Tx } from "../db/client.js";
import {
  blobRefs,
  creations,
  namespaces,
  releaseFragments,
  releaseLocks,
  releases,
  reverseEdges,
} from "../db/schema/index.js";
import { QUEUE_NAMES } from "../jobs/definitions.js";
import { type JobQueue, runOnce } from "../jobs/queue.js";
import { loadClosure, loadRegistryState } from "../registry/closure.js";
import { buildSnapshot, irBytes, loadRevisionContent } from "../registry/content.js";
import { decodeId, encodeId } from "../registry/ids.js";
import { refreshSearchColumns } from "../registry/search.js";
import type { Cas } from "../storage/cas.js";

export interface PublishJobData {
  release_id: string;
}

export interface PublishDeps {
  db: Db;
  cas: Cas;
  clock: { now(): Date };
  /** 当前是否关闭了发布功能。 */
  publishDisabled(): Promise<boolean>;
  /** public asset 的 URL 前缀，写进 public Release 的 IR。 */
  publicAssetBaseUrl: string;
}

export type PublishOutcome = "published" | "failed" | "deferred" | "skipped";

type ReleaseRow = typeof releases.$inferSelect;

const JOB = QUEUE_NAMES.publish;

function publisherUserId(row: ReleaseRow): string | null {
  const by = row.publishedBy;
  return typeof by === "string" ? decodeId("user", by) : null;
}

async function markFailed(
  deps: PublishDeps,
  row: ReleaseRow,
  report: { issues: unknown[]; license_check: string },
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    await runOnce(tx, `publish:${row.id}`, JOB, async () => {
      await tx
        .update(releases)
        .set({ publishState: "failed", publishReport: report, updatedAt: deps.clock.now() })
        .where(and(eq(releases.id, row.id), eq(releases.publishState, "pending")));
      await appendAudit(tx, {
        at: deps.clock.now(),
        actor: { kind: "system", id: "worker" },
        action: "release.publish_failed",
        subject: `release:${row.id}`,
        after: {
          codes: report.issues.map((i) => (i as { code?: string }).code ?? "unknown"),
        },
      });
    });
  });
}

export async function handlePublish(
  deps: PublishDeps,
  data: PublishJobData,
): Promise<PublishOutcome> {
  const { db, cas } = deps;
  const [row] = await db.select().from(releases).where(eq(releases.id, data.release_id)).limit(1);
  if (row?.publishState !== "pending" || !row.revisionId) return "skipped";
  if (await deps.publishDisabled()) return "deferred";

  const [owner] = await db
    .select({ creation: creations, nsSlug: namespaces.slug })
    .from(creations)
    .innerJoin(namespaces, eq(namespaces.id, creations.namespaceId))
    .where(eq(creations.id, row.creationId))
    .limit(1);
  if (!owner) return "skipped";

  let canonical: Awaited<ReturnType<typeof loadRevisionContent>>;
  try {
    canonical = await loadRevisionContent(cas, row.semanticDigest);
  } catch (e) {
    if (!isCharError(e)) throw e;
    await markFailed(deps, row, {
      issues: [{ code: e.code, subject: e.subject, severity: "error" }],
      license_check: "pass",
    });
    return "failed";
  }
  const creation = canonical.creation;
  const closure = await loadClosure(db, cas, creation);
  // 快照已被删除的依赖（例如被 tombstone 后可分发副本已清除）无法重建，直接给出明确原因。
  if (closure.unavailable.length > 0) {
    await markFailed(deps, row, {
      issues: closure.unavailable.map((u) => ({
        code:
          u.status === "tombstoned"
            ? "publish.tombstoned_dependency"
            : "publish.dependency_unavailable",
        subject: u.release,
        severity: "error",
        ...(u.reason ? { detail: u.reason } : {}),
      })),
      license_check: "pass",
    });
    return "failed";
  }
  const dependencies = [...closure.releases.values()].map((r) => r.input);

  const assetDigests = new Set<string>();
  const addAssets = (c: { assets?: { variants: { blob: { digest: string } }[] }[] }) => {
    for (const s of c.assets ?? []) for (const v of s.variants) assetDigests.add(v.blob.digest);
  };
  addAssets(creation);
  for (const r of closure.releases.values()) addAssets(r.creation as never);
  const fragmentDigests = creation.fragments.map((f) => f.digest);

  const state = await loadRegistryState(db, {
    release: row,
    namespaceSlug: owner.nsSlug,
    publisherUserId: publisherUserId(row),
    digests: [row.semanticDigest, ...fragmentDigests, ...assetDigests],
    assetDigests: [...assetDigests],
  });

  const report = checkPublish({
    release: encodeId("release", row.id),
    label: row.label,
    visibility: row.visibility,
    creation: canonical.json,
    dependencies,
    registry: state,
    publicAssetBaseUrl: deps.publicAssetBaseUrl,
  });
  const reportJson = { issues: report.issues, license_check: report.license_check };
  if (!report.ok || !report.resolved) {
    await markFailed(deps, row, reportJson);
    return "failed";
  }

  await writeArtifacts(deps, row, owner.creation.id, canonical, closure, report.resolved, {
    ...reportJson,
    license_check: report.license_check,
  });
  return "published";
}

async function writeArtifacts(
  deps: PublishDeps,
  row: ReleaseRow,
  creationId: string,
  canonical: Awaited<ReturnType<typeof loadRevisionContent>>,
  closure: Awaited<ReturnType<typeof loadClosure>>,
  resolved: ResolveOutput,
  report: { issues: unknown[]; license_check: "pass" | "warn" | "fail" },
): Promise<void> {
  const { db, cas, clock } = deps;
  const bucket = row.visibility === "public" ? ("public" as const) : ("private" as const);
  const snapshotBytes = buildSnapshot(
    canonical.json,
    [...closure.releases.entries()].map(([release, r]) => ({
      release,
      ref: (r.creation as { ref: string }).ref,
      semantic_digest: r.row.semanticDigest,
      creation: r.creation,
    })),
  );
  const snapshot = await cas.putBlob(db, {
    bucket,
    bytes: snapshotBytes,
    mediaType: "application/json",
    kind: "snapshot",
  });
  const ir = await cas.putBlob(db, {
    bucket,
    bytes: irBytes(resolved.json),
    mediaType: "application/vnd.char.context-ir+json; version=0-draft",
    kind: "ir",
  });
  if (bucket === "public") {
    // 公开发布时，Revision 的内容（fragment 与 manifest）也随之公开。
    for (const f of canonical.creation.fragments) await cas.copyToPublic(db, f.digest);
    await cas.copyToPublic(db, row.semanticDigest);
  }

  // 闭包中每个依赖的 fragment 都要登记，下架其中任何一个都能找到这个 Release。
  const fragments = new Map<string, { ownerRef: string; fragmentId: string; digest: string }>();
  const addFragments = (ref: string, list: { id: string; digest?: string }[] | undefined) => {
    for (const f of list ?? []) {
      if (f.digest)
        fragments.set(`${ref}#${f.id}`, { ownerRef: ref, fragmentId: f.id, digest: f.digest });
    }
  };
  addFragments(canonical.creation.ref, canonical.creation.fragments);
  for (const r of closure.releases.values()) {
    const c = r.creation as { ref: string; fragments?: { id: string; digest?: string }[] };
    addFragments(c.ref, c.fragments);
  }
  const assets = new Set<string>(resolved.ir.assets.map((a) => a.digest));

  const lockRows = resolved.lock.map((l) => {
    const dep = closure.releases.get(l.release);
    return {
      releaseId: row.id,
      depCreationId: dep?.row.creationId ?? "",
      depReleaseId: dep?.row.id ?? "",
      semanticDigest: l.semantic_digest,
      via: l.via as unknown as JSONValue,
    };
  });
  const directEdges = canonical.creation.references.flatMap((e) => {
    const pin = e.pin && "release" in e.pin ? e.pin.release : null;
    const dep = pin ? closure.releases.get(pin) : undefined;
    return dep ? [{ dep, mode: e.mode, rel: e.rel ?? null }] : [];
  });

  const now = clock.now();
  await db.transaction(async (tx: Tx) => {
    await runOnce(tx, `publish:${row.id}`, JOB, async () => {
      const updated = await tx
        .update(releases)
        .set({
          publishState: "done",
          publishReport: normalizeValue(report),
          lockDigest: resolved.ir.lock_digest,
          snapshotDigest: snapshot.digest,
          contextIrDigest: ir.digest,
          availability: resolved.ir.assets.some((a) => a.availability === "linked")
            ? "linked"
            : "complete",
          effectiveRating: resolved.ir.meta.rating,
          licenseCheck: report.license_check === "warn" ? "warn" : "pass",
          updatedAt: now,
        })
        .where(and(eq(releases.id, row.id), eq(releases.publishState, "pending")))
        .returning({ id: releases.id });
      if (updated.length === 0) return;
      if (lockRows.length > 0) await tx.insert(releaseLocks).values(lockRows).onConflictDoNothing();
      // 反向依赖只记录直接引用：“谁用了它”指的是谁直接依赖它。
      const seenDeps = new Set<string>();
      for (const e of directEdges) {
        if (seenDeps.has(e.dep.row.id)) continue;
        seenDeps.add(e.dep.row.id);
        await tx
          .insert(reverseEdges)
          .values({
            depCreationId: e.dep.row.creationId,
            depReleaseId: e.dep.row.id,
            dependentCreationId: creationId,
            dependentReleaseId: row.id,
            mode: e.mode,
            rel: e.rel,
          })
          .onConflictDoNothing();
      }
      const fragmentRows = [...fragments.values()].map((f) => ({ releaseId: row.id, ...f }));
      if (fragmentRows.length > 0)
        await tx.insert(releaseFragments).values(fragmentRows).onConflictDoNothing();
      const refs = [
        { digest: snapshot.digest, role: "snapshot" },
        { digest: ir.digest, role: "ir" },
        { digest: row.semanticDigest, role: "manifest" },
        ...[...fragments.values()].map((f) => ({ digest: f.digest, role: "fragment" })),
        ...[...assets].map((d) => ({ digest: d, role: "asset" })),
      ];
      await tx
        .insert(blobRefs)
        .values(refs.map((r) => ({ ...r, releaseId: row.id })))
        .onConflictDoNothing();
      await tx
        .update(creations)
        .set({
          latestReleaseId: row.id,
          effectiveRating: resolved.ir.meta.rating,
          rating: canonical.creation.meta.rating,
          displayName: canonical.creation.display_name,
          summary: canonical.creation.summary ?? null,
          tags: canonical.creation.meta.tags ?? [],
          updatedAt: now,
        })
        .where(eq(creations.id, creationId));
      // 名字、简介、标签随发布更新，搜索列在同一事务里刷新，否则新作品搜不到。
      await refreshSearchColumns(tx, creationId);
      await appendAudit(tx, {
        at: now,
        actor: { kind: "system", id: "worker" },
        action: "release.published",
        subject: `release:${row.id}`,
        after: {
          label: row.label,
          visibility: row.visibility,
          semantic_digest: row.semanticDigest,
          context_ir: ir.digest,
          effective_rating: resolved.ir.meta.rating,
        },
      });
    });
  });
}

/**
 * 把长时间停留在 pending 的发布重新入队：kill switch 恢复后、或任务丢失时使用。
 * 由定时任务调用；同一个 Release 已有排队或执行中的任务时，入队会被去重。
 */
export async function requeuePendingPublishes(
  db: Db,
  queue: JobQueue,
  olderThan: Date,
): Promise<number> {
  const pending = await db
    .select({ id: releases.id })
    .from(releases)
    .where(and(eq(releases.publishState, "pending"), lt(releases.updatedAt, olderThan)))
    .limit(500);
  let n = 0;
  for (const p of pending) {
    const id = await db.transaction((tx) =>
      queue.enqueue(tx, JOB, { release_id: p.id }, { singletonKey: `publish:${p.id}` }),
    );
    if (id) n += 1;
  }
  return n;
}

/** 在 worker 进程中注册处理函数。 */
export async function registerPublishWorker(queue: JobQueue, deps: PublishDeps): Promise<string> {
  return queue.work<PublishJobData>(JOB, async (job) => {
    await handlePublish(deps, job.data);
  });
}
