/**
 * 发布时加载依赖闭包与 Registry 状态，交给 core 的发布校验。
 *
 * 依赖从已发布 Release 的快照中读取：直接依赖的快照里包含它自己的完整闭包，所以只要读取
 * 每个直接依赖的快照，就能得到整张依赖图，不需要递归查询。每个 Release 当前的状态
 * （active / yanked / tombstoned）与可见性总是以数据库为准，快照里不保存可变状态。
 */
import type { CanonicalCreation, JSONValue, ReleaseInput } from "@char-pub/core";
import { and, eq, inArray, ne } from "drizzle-orm";
import type { Executor } from "../db/client.js";
import {
  assetMeta,
  blockedDigests,
  namespaceMembers,
  namespaces,
  releases,
} from "../db/schema/index.js";
import { type Cas, CasError } from "../storage/cas.js";
import { loadSnapshot, type SnapshotDependency } from "./content.js";
import { decodeId, encodeId } from "./ids.js";

type ReleaseRow = typeof releases.$inferSelect;

export interface ClosureRelease {
  input: ReleaseInput;
  row: ReleaseRow;
  /** 快照中的 canonical JSON。 */
  creation: JSONValue;
}

export interface Closure {
  /** TypeID 形式的 release id → 闭包成员。 */
  releases: Map<string, ClosureRelease>;
  /**
   * 数据库里存在、但内容已经无法读取的 Release（通常是 tombstone 后可分发副本已被删除）。
   * 发布校验会把它们当作 tombstoned 依赖拒绝。
   */
  unavailable: { release: string; status: ReleaseRow["status"]; reason: string | null }[];
}

function pinnedReleases(creation: CanonicalCreation): string[] {
  const out: string[] = [];
  for (const e of creation.references) {
    if (e.pin && "release" in e.pin) out.push(e.pin.release);
  }
  return out;
}

function bucketOf(row: ReleaseRow) {
  return row.visibility === "public" ? ("public" as const) : ("private" as const);
}

function inputOf(row: ReleaseRow, creation: JSONValue, semantic: string): ReleaseInput {
  const input: ReleaseInput = {
    release: encodeId("release", row.id),
    visibility: row.visibility,
    status: row.status,
    creation,
    semantic_digest: semantic,
  };
  if (row.statusReason) input.status_reason = row.statusReason;
  return input;
}

export async function loadClosure(
  db: Executor,
  cas: Cas,
  root: CanonicalCreation,
): Promise<Closure> {
  const direct = pinnedReleases(root);
  const closure: Closure = { releases: new Map(), unavailable: [] };
  if (direct.length === 0) return closure;

  const snapshots: { row: ReleaseRow; deps: SnapshotDependency[]; root: JSONValue }[] = [];
  for (const typeId of new Set(direct)) {
    const id = decodeId("release", typeId);
    if (!id) continue;
    const [row] = await db
      .select()
      .from(releases)
      .where(and(eq(releases.id, id), eq(releases.publishState, "done")))
      .limit(1);
    // 不存在或尚未发布成功的 Release 不加入闭包，Resolver 会报告找不到。
    if (!row?.snapshotDigest) continue;
    try {
      const s = await loadSnapshot(cas, bucketOf(row), row.snapshotDigest);
      snapshots.push({ row, deps: s.dependencies, root: s.root });
    } catch (e) {
      if (!(e instanceof CasError && e.code === "cas.not_found")) throw e;
      closure.unavailable.push({ release: typeId, status: row.status, reason: row.statusReason });
    }
  }

  // 快照里间接依赖的当前状态从数据库读取。
  const indirectIds = new Set<string>();
  for (const s of snapshots) {
    for (const d of s.deps) {
      const id = decodeId("release", d.release);
      if (id) indirectIds.add(id);
    }
  }
  const rows = new Map<string, ReleaseRow>();
  for (const s of snapshots) rows.set(s.row.id, s.row);
  const missing = [...indirectIds].filter((id) => !rows.has(id));
  if (missing.length > 0) {
    for (const r of await db.select().from(releases).where(inArray(releases.id, missing))) {
      rows.set(r.id, r);
    }
  }

  for (const s of snapshots) {
    closure.releases.set(encodeId("release", s.row.id), {
      input: inputOf(s.row, s.root, s.row.semanticDigest),
      row: s.row,
      creation: s.root,
    });
    for (const d of s.deps) {
      if (closure.releases.has(d.release)) continue;
      const id = decodeId("release", d.release);
      const row = id ? rows.get(id) : undefined;
      if (!row) continue;
      closure.releases.set(d.release, {
        input: inputOf(row, d.creation, d.semantic_digest),
        row,
        creation: d.creation,
      });
    }
  }
  return closure;
}

export type AssetStatus = "ready" | "processing" | "rejected" | "quarantined";

/**
 * 发布校验需要的 Registry 状态。
 * - asset：处理完成的图片会登记在 asset_meta 中；扫描命中的视为隔离，其余视为 ready。
 * - 黑名单只查询这次涉及的 digest。
 * - 同一权利人：被发布 Creation 所在的 namespace，以及发布者所属的所有 namespace。
 */
export async function loadRegistryState(
  db: Executor,
  input: {
    release: ReleaseRow;
    namespaceSlug: string;
    publisherUserId: string | null;
    digests: readonly string[];
    assetDigests: readonly string[];
  },
) {
  const labels = await db
    .select({ label: releases.label, semantic: releases.semanticDigest })
    .from(releases)
    .where(
      and(
        eq(releases.creationId, input.release.creationId),
        ne(releases.publishState, "failed"),
        ne(releases.id, input.release.id),
      ),
    );
  const existingLabels: Record<string, string> = {};
  for (const l of labels) existingLabels[l.label] = l.semantic;

  const assetStatus: Record<string, AssetStatus> = {};
  if (input.assetDigests.length > 0) {
    const metas = await db
      .select({ digest: assetMeta.digest, scan: assetMeta.scanStatus })
      .from(assetMeta)
      .where(inArray(assetMeta.digest, [...input.assetDigests]));
    for (const m of metas) assetStatus[m.digest] = m.scan === "matched" ? "quarantined" : "ready";
  }

  const blocked = new Set<string>();
  if (input.digests.length > 0) {
    const rows = await db
      .select({ digest: blockedDigests.digest })
      .from(blockedDigests)
      .where(inArray(blockedDigests.digest, [...input.digests]));
    for (const r of rows) blocked.add(r.digest);
  }

  const owners = new Set<string>([input.namespaceSlug]);
  if (input.publisherUserId) {
    const rows = await db
      .select({ slug: namespaces.slug })
      .from(namespaces)
      .innerJoin(namespaceMembers, eq(namespaceMembers.namespaceId, namespaces.id))
      .where(eq(namespaceMembers.userId, input.publisherUserId));
    for (const r of rows) owners.add(r.slug);
  }
  return { existingLabels, assetStatus, blockedDigests: blocked, ownerNamespaces: owners };
}
