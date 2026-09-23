/**
 * 法律下架与严重违规处置：tombstone 级联。
 *
 * 下架一个对象（fragment、asset、Release 或整个 Creation）时，所有包含它的 Release 都必须
 * 同时进入 tombstoned，包括把它放在依赖闭包里的下游 Release。否则被下架的内容仍然可以从
 * 某个下游 Release 的快照或 IR 中取到。
 *
 * 流程分两步：
 * 1. `previewTombstone`：只读，列出影响范围，供员工在执行前确认；
 * 2. `executeTombstone`：在一个事务中改状态、标记 blob 为 withheld、写黑名单、处置记录与
 *    审计日志，并入队删除任务。真正删除对象存储中的副本、清除 CDN 缓存由 worker 完成。
 *
 * Release 的 metadata、digest 和依赖边保留下来，只移除内容本身；解析时遇到 tombstoned
 * 的 Release 会返回带原因代码的明确错误。
 */
import { CharError } from "@char-pub/core";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { type AuditActor, appendAudit } from "../audit/audit.js";
import type { Executor, Tx } from "../db/client.js";
import {
  blobRefs,
  blobs,
  blockedDigests,
  creations,
  moderationActions,
  namespaces,
  releaseFragments,
  releases,
} from "../db/schema/index.js";
import { QUEUE_NAMES } from "../jobs/definitions.js";
import type { JobQueue } from "../jobs/queue.js";
import { publicObjectUrl } from "./read.js";

/** 公开的下架原因代码。解析 tombstoned Release 时返回给调用方。 */
export const TOMBSTONE_REASONS = [
  "legal.dmca",
  "legal.court_order",
  "legal.gdpr",
  "policy.minor_sexual",
  "policy.illegal",
  "policy.non_consensual",
  "policy.malware",
  "author.request",
] as const;
export type TombstoneReason = (typeof TOMBSTONE_REASONS)[number];

export type TombstoneSubject =
  | { kind: "fragment"; digest: string }
  | { kind: "asset"; digest: string }
  | { kind: "release"; release_id: string }
  | { kind: "creation"; creation_id: string };

export interface AffectedRelease {
  release_id: string;
  creation_id: string;
  ref: string;
  label: string;
  visibility: "public" | "private";
  status: "active" | "yanked" | "tombstoned";
  /** 这个 Release 直接包含被下架的对象，还是通过依赖闭包间接包含。 */
  via: "direct" | "closure";
}

export interface TombstonePreview {
  subject: TombstoneSubject;
  releases: AffectedRelease[];
  /** 需要删除可分发副本的对象（快照、IR、导出物、asset、fragment 等）。 */
  objects: { digest: string; roles: string[]; in_public: boolean; in_private: boolean }[];
  /** 需要清除 CDN 缓存的公共 URL。 */
  cdn_urls: string[];
  /** 受影响的下游作者所在的 namespace。 */
  downstream_namespaces: string[];
  /** 需要加入黑名单的内容 digest。 */
  block: string[];
}

function assertDigest(d: string) {
  if (!/^sha256:[0-9a-f]{64}$/.test(d)) {
    throw new CharError({ code: "tombstone.invalid_subject", subject: d });
  }
}

/** 直接包含被下架对象的 Release。 */
async function directReleases(db: Executor, s: TombstoneSubject): Promise<string[]> {
  switch (s.kind) {
    case "fragment": {
      assertDigest(s.digest);
      const rows = await db
        .selectDistinct({ id: releaseFragments.releaseId })
        .from(releaseFragments)
        .where(eq(releaseFragments.digest, s.digest));
      const refs = await db
        .selectDistinct({ id: blobRefs.releaseId })
        .from(blobRefs)
        .where(eq(blobRefs.digest, s.digest));
      return [...new Set([...rows, ...refs].map((r) => r.id))];
    }
    case "asset": {
      assertDigest(s.digest);
      const rows = await db
        .selectDistinct({ id: blobRefs.releaseId })
        .from(blobRefs)
        .where(eq(blobRefs.digest, s.digest));
      return rows.map((r) => r.id);
    }
    case "release":
      return [s.release_id];
    case "creation": {
      const rows = await db
        .select({ id: releases.id })
        .from(releases)
        .where(eq(releases.creationId, s.creation_id));
      return rows.map((r) => r.id);
    }
  }
}

/**
 * 沿反向依赖一直往下游走，找出把这些 Release 放在闭包里的所有 Release。
 * 发布时闭包已经物化在 release_locks 中，所以查一层就能拿到全部下游；
 * 这里再沿 reverse_edges 迭代一次作为兜底，防止物化数据缺失。
 */
async function closureReleases(db: Executor, seeds: readonly string[]): Promise<string[]> {
  const seen = new Set(seeds);
  let frontier = [...seeds];
  while (frontier.length > 0) {
    const locked = await db.execute<{ id: string }>(sql`
      SELECT DISTINCT release_id AS id FROM app.release_locks
      WHERE dep_release_id IN (${sql.join(
        frontier.map((f) => sql`${f}::uuid`),
        sql`, `,
      )})
      UNION
      SELECT DISTINCT dependent_release_id AS id FROM app.reverse_edges
      WHERE dep_release_id IN (${sql.join(
        frontier.map((f) => sql`${f}::uuid`),
        sql`, `,
      )})
    `);
    frontier = [];
    for (const r of locked.rows) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        frontier.push(r.id);
      }
    }
  }
  return [...seen];
}

export async function previewTombstone(
  db: Executor,
  subject: TombstoneSubject,
  opts: { publicAssetBaseUrl: string },
): Promise<TombstonePreview> {
  const direct = await directReleases(db, subject);
  if (direct.length === 0) {
    throw new CharError({ code: "tombstone.subject_not_found", subject: JSON.stringify(subject) });
  }
  const all = await closureReleases(db, direct);
  const directSet = new Set(direct);

  const rows = await db
    .select({
      id: releases.id,
      creationId: releases.creationId,
      label: releases.label,
      visibility: releases.visibility,
      status: releases.status,
      slug: namespaces.slug,
      name: creations.name,
      namespaceId: namespaces.id,
    })
    .from(releases)
    .innerJoin(creations, eq(creations.id, releases.creationId))
    .innerJoin(namespaces, eq(namespaces.id, creations.namespaceId))
    .where(inArray(releases.id, all));

  const affected: AffectedRelease[] = rows
    .map((r) => ({
      release_id: r.id,
      creation_id: r.creationId,
      ref: `@${r.slug}/${r.name}`,
      label: r.label,
      visibility: r.visibility,
      status: r.status,
      via: directSet.has(r.id) ? ("direct" as const) : ("closure" as const),
    }))
    .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : a.label < b.label ? -1 : 1));

  // 要停止分发的对象：
  // - 每个受影响 Release 的快照、IR 和导出物，它们都包含被下架的内容；
  // - 被下架的 fragment / asset 本身；整体下架 Release 或 Creation 时，还包括这些 Release
  //   直接引用的 fragment 与 asset。
  // 但任何仍被未受影响的 Release 引用的对象都保留（例如共享的依赖 fragment），
  // 只有被下架的对象本身无论如何都要删除。
  const refRows = await db
    .select({ digest: blobRefs.digest, role: blobRefs.role, releaseId: blobRefs.releaseId })
    .from(blobRefs)
    .where(inArray(blobRefs.releaseId, all));
  const subjectDigest =
    subject.kind === "fragment" || subject.kind === "asset" ? subject.digest : null;
  const wholeTarget = subject.kind === "release" || subject.kind === "creation";
  const byDigest = new Map<string, Set<string>>();
  for (const r of refRows) {
    const artifact =
      r.role === "snapshot" || r.role === "ir" || r.role === "export" || r.role === "manifest";
    const content = wholeTarget && directSet.has(r.releaseId);
    if (artifact || content || r.digest === subjectDigest) {
      const set = byDigest.get(r.digest) ?? new Set();
      set.add(r.role);
      byDigest.set(r.digest, set);
    }
  }
  if (subjectDigest && !byDigest.has(subjectDigest)) {
    byDigest.set(subjectDigest, new Set(["subject"]));
  }
  const candidates = [...byDigest.keys()];
  if (candidates.length > 0) {
    const stillUsed = await db
      .selectDistinct({ digest: blobRefs.digest })
      .from(blobRefs)
      .where(and(inArray(blobRefs.digest, candidates), notInArray(blobRefs.releaseId, all)));
    for (const u of stillUsed) if (u.digest !== subjectDigest) byDigest.delete(u.digest);
  }

  const digests = [...byDigest.keys()];
  const blobRows =
    digests.length === 0
      ? []
      : await db
          .select({ digest: blobs.digest, inPublic: blobs.inPublic, inPrivate: blobs.inPrivate })
          .from(blobs)
          .where(inArray(blobs.digest, digests));
  const blobInfo = new Map(blobRows.map((b) => [b.digest, b]));
  const objects = digests.sort().map((d) => ({
    digest: d,
    roles: [...(byDigest.get(d) ?? [])].sort(),
    in_public: blobInfo.get(d)?.inPublic ?? false,
    in_private: blobInfo.get(d)?.inPrivate ?? false,
  }));
  const cdn_urls = objects
    .filter((o) => o.in_public)
    .map((o) => publicObjectUrl(opts.publicAssetBaseUrl, o.digest));

  const subjectNamespaces = new Set(rows.filter((r) => directSet.has(r.id)).map((r) => r.slug));
  const downstream_namespaces = [
    ...new Set(
      rows.filter((r) => !directSet.has(r.id) && !subjectNamespaces.has(r.slug)).map((r) => r.slug),
    ),
  ].sort();

  // 黑名单：被下架的内容本身，以及直接受影响 Release 的语义 digest（整体下架时）。
  const block = new Set<string>();
  if (subjectDigest) block.add(subjectDigest);
  if (subject.kind === "release" || subject.kind === "creation") {
    const sem = await db
      .select({ d: releases.semanticDigest })
      .from(releases)
      .where(inArray(releases.id, direct));
    for (const s of sem) block.add(s.d);
  }

  return {
    subject,
    releases: affected,
    objects,
    cdn_urls,
    downstream_namespaces,
    block: [...block].sort(),
  };
}

export interface ExecuteTombstoneInput {
  subject: TombstoneSubject;
  reason_code: TombstoneReason;
  /** 员工写下的处置理由（至少 10 个字符），只进入内部记录。 */
  note: string;
  actor: { staff_user_id: string };
  legal_request_id?: string;
  now: Date;
  request_id?: string;
  action_id: string;
  publicAssetBaseUrl: string;
}

export interface TombstoneCascadeJob {
  action_id: string;
  objects: { digest: string; in_public: boolean; in_private: boolean }[];
  cdn_urls: string[];
}

export interface ExecuteTombstoneResult {
  action_id: string;
  preview: TombstonePreview;
  job_id: string | null;
}

/**
 * 在一个事务中执行下架，并入队删除副本的任务。任何一步失败，整个下架都不生效。
 */
export async function executeTombstone(
  db: { transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T> },
  queue: JobQueue,
  input: ExecuteTombstoneInput,
): Promise<ExecuteTombstoneResult> {
  if (!TOMBSTONE_REASONS.includes(input.reason_code)) {
    throw new CharError({ code: "tombstone.invalid_reason", subject: input.reason_code });
  }
  if (input.note.trim().length < 10) {
    throw new CharError({ code: "admin.reason_required", subject: "note" });
  }
  if (input.reason_code.startsWith("legal.") && !input.legal_request_id) {
    throw new CharError({ code: "admin.legal_request_required", subject: input.reason_code });
  }
  return db.transaction(async (tx) => {
    const preview = await previewTombstone(tx, input.subject, {
      publicAssetBaseUrl: input.publicAssetBaseUrl,
    });
    const ids = preview.releases.map((r) => r.release_id);
    await tx
      .update(releases)
      .set({ status: "tombstoned", statusReason: input.reason_code, updatedAt: input.now })
      .where(and(inArray(releases.id, ids), sql`${releases.status} <> 'tombstoned'`));

    const digests = preview.objects.map((o) => o.digest);
    if (digests.length > 0) {
      await tx
        .update(blobs)
        .set({ status: "withheld", updatedAt: input.now })
        .where(and(inArray(blobs.digest, digests), eq(blobs.status, "present")));
    }

    await tx.insert(moderationActions).values({
      id: input.action_id,
      actorId: input.actor.staff_user_id,
      action: "tombstone",
      subject: input.subject,
      reason: input.note,
      ...(input.legal_request_id ? { legalRequestId: input.legal_request_id } : {}),
      params: { reason_code: input.reason_code },
      blastRadius: {
        releases: preview.releases.length,
        objects: preview.objects.length,
        downstream_namespaces: preview.downstream_namespaces,
      },
      createdAt: input.now,
    });

    for (const d of preview.block) {
      await tx
        .insert(blockedDigests)
        .values({
          digest: d,
          reason: input.reason_code,
          actionId: input.action_id,
          createdAt: input.now,
        })
        .onConflictDoNothing();
    }

    const actor: AuditActor = { kind: "staff", id: input.actor.staff_user_id };
    await appendAudit(tx, {
      at: input.now,
      actor,
      action: "release.tombstone",
      subject: `moderation_action:${input.action_id}`,
      requestId: input.request_id ?? null,
      before: {
        releases: preview.releases.map((r) => ({ id: r.release_id, status: r.status })),
      },
      after: {
        status: "tombstoned",
        reason: input.reason_code,
        releases: ids,
        blocked: preview.block,
      },
    });

    const job: TombstoneCascadeJob = {
      action_id: input.action_id,
      objects: preview.objects.map((o) => ({
        digest: o.digest,
        in_public: o.in_public,
        in_private: o.in_private,
      })),
      cdn_urls: preview.cdn_urls,
    };
    const jobId = await queue.enqueue(tx, QUEUE_NAMES.tombstoneCascade, job, {
      singletonKey: `tombstone:${input.action_id}`,
    });
    return { action_id: input.action_id, preview, job_id: jobId };
  });
}

/** 数据库中的下架黑名单，给发布校验使用。 */
export async function loadBlockedDigests(
  db: Executor,
  candidates?: readonly string[],
): Promise<Set<string>> {
  const rows = await db
    .select({ d: blockedDigests.digest })
    .from(blockedDigests)
    .where(
      candidates && candidates.length > 0
        ? inArray(blockedDigests.digest, [...candidates])
        : sql`true`,
    );
  return new Set(rows.map((r) => r.d));
}
