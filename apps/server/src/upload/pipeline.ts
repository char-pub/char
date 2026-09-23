/**
 * 上传状态机。
 *
 *   uploaded ──complete──▶ processing ──worker──▶ ready | rejected | quarantined
 *
 * - 创建上传时只登记声明的类型、大小和 sha256，并签发一个 10 分钟有效、限定长度与类型的
 *   PUT URL；文件不经过 API。
 * - worker 下载原件后重新计算 sha256，与声明值不一致就拒绝；再查黑名单、识别真实类型、
 *   限制像素、重新编码（去掉全部元数据）、生成缩略图，最后做 CSAM 扫描。
 * - 只有 ready 的上传可以被 Creation 引用。原件处理完即删除，对外只分发重新编码后的版本。
 * - 扫描服务暂时不可用时保持 processing 并抛出可重试错误，按队列的退避策略重试，
 *   不会自动放行。
 */
import { MAX_ASSET_BYTES, MAX_CARD_JSON_BYTES, MAX_UPLOAD_BYTES } from "@char-pub/contracts";
import { sha256Bytes } from "@char-pub/core";
import { and, eq, gt, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { assetMeta, blockedDigests, uploads } from "../db/schema/index.js";
import type { JobQueue } from "../jobs/queue.js";
import { type CsamHitResult, handleCsamHit } from "../moderation/csam.js";
import type { Cas } from "../storage/cas.js";
import { type CsamScanner, decideUpload, noopScanner } from "./csam.js";
import { ImageRejected, processImage } from "./image.js";

/** 每种用途允许的类型和大小上限。 */
export const UPLOAD_LIMITS = {
  asset: {
    types: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    maxBytes: MAX_ASSET_BYTES,
  },
  import: {
    types: ["image/png", "application/json", "application/zip"],
    maxBytes: MAX_UPLOAD_BYTES,
    /** JSON 卡片的上限更低。 */
    jsonMaxBytes: MAX_CARD_JSON_BYTES,
  },
} as const;

/** 上传记录的有效期：超过后未完成的上传与原件被清理。 */
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

export function stagingKeyFor(uploadId: string): string {
  return `staging/${uploadId}`;
}

/** 上传 result 列的内容。 */
export interface UploadResultRecord {
  original_digest: string;
  blob?: { digest: string; size: number; media_type: string; width: number; height: number };
  thumbnail?: string;
  scan?: { status: string; provider: string };
}

/** 扫描服务不可用时抛出，让任务按退避策略重试。 */
export class RetryableUploadError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`scanner unavailable, retry after ${retryAfterSeconds}s`);
    this.name = "RetryableUploadError";
  }
}

export interface PipelineDeps {
  db: Db;
  cas: Cas;
  queue?: JobQueue;
  scanner?: CsamScanner;
  now: () => Date;
  newId: () => string;
  /** 扫描命中时记录为执行者的系统账号（需要存在于 auth_user 中）。 */
  systemActorId: string;
}

export type PipelineOutcome =
  | { state: "ready"; blob: string; thumbnail: string }
  | { state: "rejected"; reason: string }
  | { state: "quarantined"; incident: CsamHitResult }
  | { state: "skipped"; reason: "not_processing" | "missing" };

/**
 * 处理一个上传。可以安全地重复调用：只有 processing 状态的上传会被处理，
 * 其他状态直接跳过，所以任务重复投递不会重复写。
 */
export async function processUpload(
  deps: PipelineDeps,
  uploadId: string,
): Promise<PipelineOutcome> {
  const { db, cas } = deps;
  const [u] = await db.select().from(uploads).where(eq(uploads.id, uploadId)).limit(1);
  if (!u) return { state: "skipped", reason: "missing" };
  if (u.status !== "processing") return { state: "skipped", reason: "not_processing" };

  const reject = async (reason: string): Promise<PipelineOutcome> => {
    await db
      .update(uploads)
      .set({ status: "rejected", rejectReason: reason, updatedAt: deps.now() })
      .where(eq(uploads.id, uploadId));
    await cas.deleteUpload(u.stagingKey);
    return { state: "rejected", reason };
  };

  const original = await cas.getUpload(u.stagingKey).catch(() => null);
  if (!original) return reject("upload.missing_object");
  const declared = (u.result as { declared_sha256?: string } | null)?.declared_sha256;
  const purpose = (u.result as { purpose?: string } | null)?.purpose;
  const digest = sha256Bytes(original);
  if (declared !== digest) return reject("upload.digest_mismatch");
  if (original.byteLength !== u.size) return reject("upload.size_mismatch");

  const blocked = await db
    .select({ digest: blockedDigests.digest })
    .from(blockedDigests)
    .where(inArray(blockedDigests.digest, [digest]));
  if (blocked.length > 0) return reject("upload.blocked_content");

  // 导入用的卡片（PNG / CHARX / JSON）在这里只校验完整性与黑名单，原件原样留给导入任务：
  // PNG 卡片的角色数据就在图片的文本 chunk 里，重新编码会把它丢掉。卡片里的图片由导入任务
  // 取出后再走同样的图片处理与扫描；原件由导入任务负责删除（未被取走的原件随 uploads 桶的
  // 24 小时生命周期过期）。
  if (purpose === "import" || !u.declaredType.startsWith("image/")) {
    await db
      .update(uploads)
      .set({
        status: "ready",
        result: { declared_sha256: declared, original_digest: digest, purpose },
        updatedAt: deps.now(),
      })
      .where(and(eq(uploads.id, uploadId), eq(uploads.status, "processing")));
    return { state: "ready", blob: digest, thumbnail: "" };
  }

  let image: Awaited<ReturnType<typeof processImage>>;
  try {
    image = await processImage(original);
  } catch (e) {
    if (e instanceof ImageRejected) return reject(e.code);
    throw e;
  }

  const scanner = deps.scanner ?? noopScanner;
  const scan = await scanner.scan(original);
  const outcome = decideUpload(image, scan);

  if (outcome.state === "retry") throw new RetryableUploadError(outcome.retry_after_seconds);

  if (outcome.state === "quarantined") {
    await db
      .update(uploads)
      .set({ result: { declared_sha256: declared, original_digest: digest } })
      .where(eq(uploads.id, uploadId));
    const incident = await handleCsamHit(db, cas, deps.queue, deps.newId, {
      uploadId,
      reason: "csam_scan",
      actorId: deps.systemActorId,
      actorKind: "system",
      matchId: outcome.match_id,
      now: deps.now(),
      original: { bytes: original, mediaType: u.declaredType },
    });
    return { state: "quarantined", incident };
  }

  const webp = await cas.putBlob(db, {
    bucket: "private",
    bytes: image.webp,
    mediaType: "image/webp",
    kind: "asset",
  });
  const thumb = await cas.putBlob(db, {
    bucket: "private",
    bytes: image.thumbnail,
    mediaType: "image/webp",
    kind: "thumbnail",
  });
  const now = deps.now();
  const result: UploadResultRecord & { declared_sha256: string } = {
    declared_sha256: digest,
    original_digest: digest,
    blob: {
      digest: webp.digest,
      size: webp.size,
      media_type: "image/webp",
      width: image.width,
      height: image.height,
    },
    thumbnail: thumb.digest,
    scan: { status: outcome.scan_status, provider: outcome.provider },
  };
  const scanStatus = outcome.scan_status === "clear" ? "clean" : "not_scanned";
  await db.transaction(async (tx) => {
    // 只有仍是 processing 的上传才会被更新，并发的重复任务不会覆盖彼此的结果。
    const updated = await tx
      .update(uploads)
      .set({ status: "ready", result, updatedAt: now })
      .where(and(eq(uploads.id, uploadId), eq(uploads.status, "processing")))
      .returning({ status: uploads.status });
    if (updated.length === 0) return;
    for (const d of [webp.digest, thumb.digest]) {
      await tx
        .insert(assetMeta)
        .values({
          digest: d,
          width: d === webp.digest ? image.width : 256,
          height: d === webp.digest ? image.height : 256,
          mediaType: "image/webp",
          scanStatus,
          scanProvider: outcome.provider === "none" ? null : outcome.provider,
          scannedAt: outcome.scan_status === "clear" ? now : null,
        })
        .onConflictDoNothing();
    }
  });
  await cas.deleteUpload(u.stagingKey);
  return { state: "ready", blob: webp.digest, thumbnail: thumb.digest };
}

/** 清理过期未完成的上传：删除原件，把记录标记为 rejected。 */
export async function expireUploads(
  deps: Pick<PipelineDeps, "db" | "cas" | "now">,
): Promise<number> {
  const now = deps.now();
  const stale = await deps.db
    .select({
      id: uploads.id,
      key: uploads.stagingKey,
      status: uploads.status,
      expiresAt: uploads.expiresAt,
    })
    .from(uploads)
    .where(inArray(uploads.status, ["uploaded", "processing"]));
  let n = 0;
  for (const s of stale) {
    if (s.expiresAt > now) continue;
    await deps.cas.deleteUpload(s.key);
    await deps.db
      .update(uploads)
      .set({ status: "rejected", rejectReason: "upload.expired", updatedAt: now })
      .where(eq(uploads.id, s.id));
    n++;
  }
  return n;
}

/**
 * 存量补扫：接入真实扫描服务后，对所有标记为“未扫描”的资源重新扫描。
 * 分页进行，每页处理完再取下一页；命中时走与上传扫描相同的处置路径。
 */
export async function rescanAll(
  deps: PipelineDeps & { scanner: CsamScanner; pageSize?: number },
): Promise<{ scanned: number; matched: number; unavailable: number }> {
  const pageSize = deps.pageSize ?? 100;
  const stats = { scanned: 0, matched: 0, unavailable: 0 };
  // 按 digest 做 keyset 分页：扫描失败、保持“未扫描”的记录不会被重复取到。
  let after = "";
  for (;;) {
    const page = await deps.db
      .select({ digest: assetMeta.digest })
      .from(assetMeta)
      .where(and(eq(assetMeta.scanStatus, "not_scanned"), gt(assetMeta.digest, after)))
      .orderBy(assetMeta.digest)
      .limit(pageSize);
    if (page.length === 0) break;
    for (const { digest } of page) {
      after = digest;
      const bytes = await deps.cas.getBlob("private", digest).catch(() => null);
      if (!bytes) continue;
      const scan = await deps.scanner.scan(bytes);
      if (scan.status === "unavailable") {
        stats.unavailable++;
        continue;
      }
      stats.scanned++;
      if (scan.status === "match") {
        stats.matched++;
        await handleCsamHit(deps.db, deps.cas, deps.queue, deps.newId, {
          blobDigest: digest,
          reason: "csam_scan",
          actorId: deps.systemActorId,
          actorKind: "system",
          matchId: scan.match_id,
          now: deps.now(),
        });
      } else {
        await deps.db
          .update(assetMeta)
          .set({ scanStatus: "clean", scanProvider: scan.provider, scannedAt: deps.now() })
          .where(eq(assetMeta.digest, digest));
      }
    }
  }
  return stats;
}
