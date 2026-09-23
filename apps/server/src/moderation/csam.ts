/**
 * CSAM 命中后的处置。扫描命中与员工手动标记走同一条路径。
 *
 * 在一个事务中完成：
 * 1. 上传状态改为 quarantined；
 * 2. 原件（或已处理的 blob）写入 evidence 桶保全，然后从 public / private 桶删除可分发副本；
 * 3. 锁定上传者：封禁、删除全部会话、吊销全部 Token；
 * 4. 内容 digest 写入黑名单，阻止重新上传或发布；
 * 5. 写处置记录、审计日志，创建事件工单；
 * 6. 如果内容已被某个 Release 引用，入队 tombstone 级联（原因代码 `policy.minor_sexual`）。
 *
 * 不通知上传者具体原因。对象存储的写入不在数据库事务里：证据先写入，再提交事务，
 * 最后删除可分发副本。事务失败时证据对象留在 evidence 桶中，这是安全的一侧
 * （宁可多保全，不能丢证据）。
 */
import { and, eq, inArray } from "drizzle-orm";
import { appendAudit } from "../audit/audit.js";
import { banUser } from "../auth/ban.js";
import type { Db } from "../db/client.js";
import {
  assetMeta,
  blobRefs,
  blobs,
  blockedDigests,
  csamIncidents,
  moderationActions,
  uploads,
} from "../db/schema/index.js";
import { QUEUE_NAMES } from "../jobs/definitions.js";
import type { JobQueue } from "../jobs/queue.js";
import type { Cas } from "../storage/cas.js";

export const CSAM_REASON_CODE = "policy.minor_sexual";

export interface CsamHitInput {
  /** 扫描命中时是上传 ID；员工标记已处理的 asset 时给 blob digest。二者至少给一个。 */
  uploadId?: string;
  blobDigest?: string;
  reason: "csam_scan" | "staff_flag";
  /** 执行者：扫描命中时是系统账号，员工标记时是员工的 user id。 */
  actorId: string;
  actorKind: "system" | "staff";
  matchId?: string;
  now: Date;
  /** 扫描命中时 worker 手里已有原件字节，直接传入，避免再读一次。 */
  original?: { bytes: Uint8Array; mediaType: string };
}

export interface CsamHitResult {
  incidentId: string;
  evidenceKey: string;
  /** 引用了该内容、需要 tombstone 的 Release。 */
  affectedReleases: string[];
  blockedDigests: string[];
}

export class CsamHitError extends Error {
  constructor(readonly code: "csam.subject_missing" | "csam.subject_not_found") {
    super(code);
    this.name = "CsamHitError";
  }
}

interface Subject {
  uploadId: string | null;
  ownerUserId: string | null;
  /** 所有需要拉黑、删除副本的 digest：原件、处理后的 webp、缩略图。 */
  digests: string[];
  /** 要保全的内容。 */
  evidence: { bytes: Uint8Array; mediaType: string };
}

type UploadResult = {
  blob?: { digest: string; media_type: string };
  thumbnail?: string;
  original_digest?: string;
  /** 从这个上传中派生出的其他 blob，例如导入的角色卡里取出的图片及其缩略图。 */
  derived?: string[];
};

async function loadSubject(db: Db, cas: Cas, input: CsamHitInput): Promise<Subject> {
  if (input.uploadId) {
    const [u] = await db.select().from(uploads).where(eq(uploads.id, input.uploadId)).limit(1);
    if (!u) throw new CsamHitError("csam.subject_not_found");
    const result = (u.result ?? {}) as UploadResult;
    const digests = [
      result.original_digest,
      result.blob?.digest,
      result.thumbnail,
      ...(result.derived ?? []),
    ].filter((d): d is string => typeof d === "string");
    let evidence = input.original;
    if (!evidence) {
      // 原件可能已被删除（ready 之后）；那就保全处理后的 blob。
      evidence = await cas
        .getUpload(u.stagingKey)
        .then((bytes) => ({ bytes, mediaType: u.declaredType }))
        .catch(async () => {
          const digest = result.blob?.digest;
          if (!digest) throw new CsamHitError("csam.subject_not_found");
          return {
            bytes: await cas.getBlob("private", digest),
            mediaType: result.blob?.media_type ?? "application/octet-stream",
          };
        });
    }
    return { uploadId: u.id, ownerUserId: u.ownerUserId, digests, evidence };
  }
  if (input.blobDigest) {
    const digest = input.blobDigest;
    // 找到产生这个 blob 的上传（webp 或缩略图），以便锁定上传者。
    const candidates = await db
      .select()
      .from(uploads)
      .where(inArray(uploads.status, ["ready", "quarantined"]));
    const u = candidates.find((c) => {
      const r = (c.result ?? {}) as UploadResult;
      return (
        r.blob?.digest === digest ||
        r.thumbnail === digest ||
        r.original_digest === digest ||
        (r.derived ?? []).includes(digest)
      );
    });
    const [meta] = await db.select().from(blobs).where(eq(blobs.digest, digest)).limit(1);
    const bucket = meta?.inPrivate ? "private" : "public";
    const bytes = await cas.getBlob(bucket, digest).catch(() => {
      throw new CsamHitError("csam.subject_not_found");
    });
    const r = (u?.result ?? {}) as UploadResult;
    const digests = [
      digest,
      r.original_digest,
      r.blob?.digest,
      r.thumbnail,
      ...(r.derived ?? []),
    ].filter((d): d is string => typeof d === "string");
    return {
      uploadId: u?.id ?? null,
      ownerUserId: u?.ownerUserId ?? null,
      digests: [...new Set(digests)],
      evidence: { bytes, mediaType: meta?.mediaType ?? "application/octet-stream" },
    };
  }
  throw new CsamHitError("csam.subject_missing");
}

export async function handleCsamHit(
  db: Db,
  cas: Cas,
  queue: JobQueue | undefined,
  newId: () => string,
  input: CsamHitInput,
): Promise<CsamHitResult> {
  const subject = await loadSubject(db, cas, input);
  const evidence = await cas.putEvidence(subject.evidence.bytes, subject.evidence.mediaType);
  const digests = [...new Set([...subject.digests, evidence.digest])];
  const incidentId = newId();
  const actionId = newId();
  const actor = { kind: input.actorKind, id: input.actorId } as const;

  const affectedReleases = await db.transaction(async (tx) => {
    if (subject.uploadId) {
      await tx
        .update(uploads)
        .set({ status: "quarantined", updatedAt: input.now })
        .where(eq(uploads.id, subject.uploadId));
    }
    await tx
      .update(assetMeta)
      .set({
        scanStatus: "matched",
        scanProvider: input.reason === "staff_flag" ? "staff" : null,
        scannedAt: input.now,
      })
      .where(inArray(assetMeta.digest, digests));
    await tx
      .insert(blockedDigests)
      .values(digests.map((digest) => ({ digest, reason: CSAM_REASON_CODE, actionId })))
      .onConflictDoNothing();
    await tx.insert(moderationActions).values({
      id: actionId,
      actorId: input.actorId,
      action: "csam.quarantine",
      subject: { upload: subject.uploadId, digests },
      reason:
        input.reason === "csam_scan" ? "matched by the CSAM scanner" : "flagged as CSAM by staff",
      params: { incident: incidentId, match_id: input.matchId ?? null },
    });
    await tx.insert(csamIncidents).values({
      id: incidentId,
      uploadId: subject.uploadId,
      blobDigest: digests[0] ?? evidence.digest,
      userId: subject.ownerUserId,
      reason: input.reason,
      matchId: input.matchId ?? null,
      evidenceKey: evidence.key,
    });
    await appendAudit(tx, {
      at: input.now,
      actor,
      action: "csam.quarantine",
      subject: subject.uploadId ? `upload:${subject.uploadId}` : `blob:${digests[0]}`,
      after: { incident: incidentId, reason: input.reason, digests },
    });
    if (subject.ownerUserId) {
      await banUser(tx as unknown as Db, {
        userId: subject.ownerUserId,
        reason: "csam",
        actor,
        now: input.now,
      });
    }
    const refs = await tx
      .selectDistinct({ releaseId: blobRefs.releaseId })
      .from(blobRefs)
      .where(inArray(blobRefs.digest, digests));
    const releases = refs.map((r) => r.releaseId).sort();
    if (releases.length > 0 && queue) {
      await queue.enqueue(
        tx,
        QUEUE_NAMES.tombstoneCascade,
        { subject: { digests }, reason_code: CSAM_REASON_CODE, action_id: actionId, releases },
        { singletonKey: `tombstone:csam:${incidentId}` },
      );
    }
    return releases;
  });

  // 事务提交之后删除可分发副本。重复执行是安全的：对象不存在时删除也会成功。
  for (const digest of digests) {
    const [meta] = await db.select().from(blobs).where(eq(blobs.digest, digest)).limit(1);
    if (!meta) continue;
    if (meta.inPrivate) await cas.deleteBlob(db, "private", digest);
    if (meta.inPublic) await cas.deleteBlob(db, "public", digest);
    await db
      .update(blobs)
      .set({ status: "withheld", updatedAt: input.now })
      .where(and(eq(blobs.digest, digest)));
  }
  if (subject.uploadId) {
    const [u] = await db
      .select({ key: uploads.stagingKey })
      .from(uploads)
      .where(eq(uploads.id, subject.uploadId));
    if (u) await cas.deleteUpload(u.key);
  }

  return { incidentId, evidenceKey: evidence.key, affectedReleases, blockedDigests: digests };
}
