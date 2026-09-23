/**
 * 角色卡导入任务（`import.ccv3`）：把上传的 PNG / CHARX / JSON 卡片转换成一个新的 Creation 草稿。
 *
 * 步骤：
 * 1. 从 uploads 桶取回原件，重算 sha256（必须与上传处理时记录的一致），按文件头识别容器，
 *    容器必须与上传时声明的类型相符；
 * 2. 用 `@char-pub/ccv3` 解析出 Canonical Creation 与 Import Report。system_prompt 等策略字段的
 *    原值不进入 Creation，provenance 里只记字段名；原值只留在 Import Report 里，
 *    报告只有发起人能看到；
 * 3. 卡片里的图片（头像、背景等）逐张走与普通上传相同的检查：黑名单、类型与像素上限、
 *    重新编码为 webp（去掉全部元数据）、缩略图、CSAM 扫描。全部图片处理完之前不写任何东西；
 * 4. 原件与 Import Report 写入 private 桶，然后在一个事务中创建 Creation 与草稿、登记图片、
 *    把导入标记为成功并写审计。
 *
 * 失败的处理：
 * - 卡片本身有问题（容器不支持、过大、解析失败、名字已被占用）：导入标记为 failed，
 *   带稳定的错误码，不重试；
 * - 单张图片无法处理（不是支持的图片、像素过多）：这张图片不导入，原因写进报告，其余内容
 *   照常导入。这与单独上传这张图片被拒绝的结果一致，而且不会有任何未经处理的图片进入草稿；
 * - 原件或图片命中黑名单：整个导入被拒绝，不说明原因；
 * - CSAM 扫描命中：走与普通上传相同的处置路径（隔离、保全证据、锁定账号），导入被拒绝；
 * - 扫描服务暂时不可用、存储或数据库出错：抛出异常，按队列策略重试，不会跳过扫描。
 *   重试用尽时导入标记为 failed（`import.internal_error`），原件保留；admin 从死信队列重新
 *   投递后，这样的导入会重新进入 processing 继续处理。
 *
 * 幂等：只处理 pending / processing（以及上面这种可以重投的 failed）的导入；
 * 成功的写入用 runOnce 记录，重复投递直接跳过。
 */
import {
  type ImportedAsset,
  type ImportReport,
  type ImportResult,
  importCard,
  isPng,
  isZip,
} from "@char-pub/ccv3";
import {
  CharError,
  type CreationInput,
  canonicalizeCreation,
  type JSONValue,
  jcs,
  sha256Bytes,
} from "@char-pub/core";
import { and, eq, inArray } from "drizzle-orm";
import { appendAudit } from "../audit/audit.js";
import {
  assetMeta,
  blockedDigests,
  creationDrafts,
  creations,
  imports,
  namespaces,
  uploads,
} from "../db/schema/index.js";
import { QUEUE_NAMES } from "../jobs/definitions.js";
import { type JobQueue, runOnce } from "../jobs/queue.js";
import { handleCsamHit } from "../moderation/csam.js";
import { forceIdentity } from "../registry/drafts.js";
import { encodeId } from "../registry/ids.js";
import { nameTaken } from "../registry/imports.js";
import { CasError } from "../storage/cas.js";
import { decideUpload, noopScanner } from "../upload/csam.js";
import { ImageRejected, type ProcessedImage, processImage } from "../upload/image.js";
import { type PipelineDeps, RetryableUploadError, UPLOAD_LIMITS } from "../upload/pipeline.js";

export interface ImportJob {
  import_id: string;
}

export type ImportDeps = PipelineDeps;

export type ImportOutcome = "succeeded" | "failed" | "skipped";

type Container = "png" | "charx" | "json";

/** 上传时声明的类型与容器的对应关系。 */
const DECLARED_CONTAINER: Record<string, Container> = {
  "image/png": "png",
  "application/zip": "charx",
  "application/json": "json",
};

/** 按文件头识别容器。JSON 允许 BOM 与前导空白。 */
export function sniffContainer(b: Uint8Array): Container | null {
  if (isPng(b)) return "png";
  if (isZip(b)) return "charx";
  let i = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0;
  while (i < b.length && (b[i] === 0x20 || b[i] === 0x0a || b[i] === 0x0d || b[i] === 0x09)) i++;
  return b[i] === 0x7b ? "json" : null;
}

const UNSUPPORTED_CODES = new Set([
  "ccv3.unrecognized_format",
  "charx.not_zip",
  "charx.encrypted",
  "charx.unsupported_compression",
  "charx.zip64_unsupported",
  "charx.multi_disk_unsupported",
  "png.bad_signature",
]);

const TOO_LARGE_CODES = new Set([
  "ccv3.too_large",
  "charx.too_large",
  "charx.zip_bomb",
  "charx.entry_too_large",
  "charx.too_many_entries",
  "png.too_large",
  "png.chunk_too_large",
  "png.too_many_chunks",
]);

/** 把解析器的错误码归到对外稳定的三类；具体原因作为 detail 返回给发起人。 */
export function importErrorCode(parserCode: string): string {
  if (UNSUPPORTED_CODES.has(parserCode)) return "import.unsupported_format";
  if (TOO_LARGE_CODES.has(parserCode)) return "import.too_large";
  return "import.parse_failed";
}

interface ProcessedAsset {
  asset: ImportedAsset;
  image: ProcessedImage;
  scan: { status: "not_scanned" | "clear"; provider: string };
}

type AssetCheck =
  | { kind: "ok"; processed: ProcessedAsset[]; rejected: { asset: ImportedAsset; code: string }[] }
  | { kind: "blocked" }
  | { kind: "matched"; matchId: string };

/** 对卡片里的每张图片做与普通上传相同的检查。这一步不写任何东西。 */
async function checkAssets(
  deps: ImportDeps,
  assets: readonly ImportedAsset[],
): Promise<AssetCheck> {
  if (assets.length > 0) {
    const blocked = await deps.db
      .select({ digest: blockedDigests.digest })
      .from(blockedDigests)
      .where(
        inArray(
          blockedDigests.digest,
          assets.map((a) => a.digest),
        ),
      )
      .limit(1);
    if (blocked.length > 0) return { kind: "blocked" };
  }
  const scanner = deps.scanner ?? noopScanner;
  const processed: ProcessedAsset[] = [];
  const rejected: { asset: ImportedAsset; code: string }[] = [];
  for (const asset of assets) {
    let image: ProcessedImage;
    try {
      image = await processImage(asset.bytes);
    } catch (e) {
      if (e instanceof ImageRejected) {
        rejected.push({ asset, code: e.code });
        continue;
      }
      throw e;
    }
    const outcome = decideUpload(image, await scanner.scan(asset.bytes));
    if (outcome.state === "retry") throw new RetryableUploadError(outcome.retry_after_seconds);
    if (outcome.state === "quarantined") return { kind: "matched", matchId: outcome.match_id };
    processed.push({
      asset,
      image,
      scan: { status: outcome.scan_status, provider: outcome.provider },
    });
  }
  // 重新编码是确定性的：被下架过的图片再次导入会得到同一个 webp，这里一并拦下。
  if (processed.length > 0) {
    const blocked = await deps.db
      .select({ digest: blockedDigests.digest })
      .from(blockedDigests)
      .where(
        inArray(
          blockedDigests.digest,
          processed.map((p) => sha256Bytes(p.image.webp)),
        ),
      )
      .limit(1);
    if (blocked.length > 0) return { kind: "blocked" };
  }
  return { kind: "ok", processed, rejected };
}

interface StoredAsset {
  slot: string;
  variant: string;
  webp: { digest: string; size: number };
  thumbnail: string;
  width: number;
  height: number;
  scan: ProcessedAsset["scan"];
}

/**
 * 用处理后的图片替换草稿中的资源：variant 指向重新编码的 webp；无法处理的图片被移除，
 * 原因写进报告。一个 slot 的 default 被移除时，由剩下的第一张顶替。
 */
function applyAssets(
  creation: CreationInput,
  report: ImportReport,
  stored: readonly StoredAsset[],
  rejected: readonly { asset: ImportedAsset; code: string }[],
): void {
  // 先在报告里标出被拒绝的图片，再调整 variant：顶替 default 之后 key 会变。
  const reason = new Map(rejected.map((r) => [`${r.asset.slot}/${r.asset.variant}`, r.code]));
  for (const entry of report.assets) {
    const code =
      entry.slot && entry.variant ? reason.get(`${entry.slot}/${entry.variant}`) : undefined;
    if (!code) continue;
    entry.imported = false;
    entry.reason = code;
    delete entry.slot;
    delete entry.variant;
  }
  const byKey = new Map(stored.map((s) => [`${s.slot}/${s.variant}`, s]));
  const slots: NonNullable<CreationInput["assets"]> = [];
  for (const slot of creation.assets ?? []) {
    const variants: (typeof slot)["variants"] = [];
    for (const v of slot.variants) {
      const s = byKey.get(`${slot.slot}/${v.id}`);
      if (!s) continue;
      variants.push({
        ...v,
        media_type: "image/webp",
        blob: { digest: s.webp.digest, size: s.webp.size, availability: "mirrored" },
      });
    }
    const first = variants[0];
    if (!first) continue;
    if (!variants.some((v) => v.id === "default")) {
      const entry = report.assets.find((a) => a.slot === slot.slot && a.variant === first.id);
      if (entry) entry.variant = "default";
      first.id = "default";
    }
    slots.push({ ...slot, variants });
  }
  creation.assets = slots;
}

export async function handleImportJob(deps: ImportDeps, job: ImportJob): Promise<ImportOutcome> {
  const { db, cas } = deps;
  let [imp] = await db.select().from(imports).where(eq(imports.id, job.import_id)).limit(1);
  if (imp && isRetryableFailure(imp)) imp = await reviveImport(deps, imp);
  if (!imp || (imp.status !== "pending" && imp.status !== "processing")) return "skipped";
  const [u] = await db.select().from(uploads).where(eq(uploads.id, imp.uploadId)).limit(1);

  const fail = async (code: string, detail?: string): Promise<ImportOutcome> => {
    await db
      .update(imports)
      .set({
        status: "failed",
        errorCode: code,
        errorDetail: detail ?? null,
        updatedAt: deps.now(),
      })
      .where(and(eq(imports.id, imp.id), inArray(imports.status, ["pending", "processing"])));
    if (u) await cas.deleteUpload(u.stagingKey);
    return "failed";
  };

  if (!u) return fail("import.upload_unavailable");
  // 上传已被隔离（例如上一次执行在扫描命中后中断）时，结果与命中时相同。
  if (u.status === "quarantined") return fail("import.rejected");
  if (u.status !== "ready") return fail("import.upload_unavailable");
  await db
    .update(imports)
    .set({ status: "processing", updatedAt: deps.now() })
    .where(and(eq(imports.id, imp.id), eq(imports.status, "pending")));

  let bytes: Uint8Array;
  try {
    bytes = await cas.getUpload(u.stagingKey);
  } catch (e) {
    if (e instanceof CasError && e.code === "cas.not_found") {
      return fail("import.upload_unavailable");
    }
    throw e;
  }
  const digest = sha256Bytes(bytes);
  const recorded = (u.result as { original_digest?: string } | null)?.original_digest;
  // 上传处理时已经核对过内容；这里再核对一次，防止原件在那之后被替换。
  if (digest !== recorded) return fail("import.digest_mismatch");

  const container = sniffContainer(bytes);
  if (!container || DECLARED_CONTAINER[u.declaredType] !== container) {
    return fail("import.unsupported_format", `declared ${u.declaredType}`);
  }
  const maxBytes =
    container === "json" ? UPLOAD_LIMITS.import.jsonMaxBytes : UPLOAD_LIMITS.import.maxBytes;
  if (bytes.byteLength > maxBytes) return fail("import.too_large");

  const [ns] = await db
    .select({ id: namespaces.id, slug: namespaces.slug })
    .from(namespaces)
    .where(eq(namespaces.id, imp.namespaceId))
    .limit(1);
  if (!ns) return fail("import.namespace_missing");

  const creationUuid = deps.newId();
  const creationId = encodeId("creation", creationUuid);
  const ref = `@${ns.slug}/${imp.name}`;
  let result: ImportResult;
  try {
    result = importCard(bytes, {
      ids: { creation: creationId },
      ref,
      source_digest: digest,
    });
  } catch (e) {
    if (e instanceof CharError) return fail(importErrorCode(e.code), e.code);
    throw e;
  }

  const check = await checkAssets(deps, result.assets);
  if (check.kind === "blocked") return fail("import.rejected");
  if (check.kind === "matched") {
    // 让处置路径把卡片里的图片也列入黑名单并删除，而不只是原件。
    await db
      .update(uploads)
      .set({
        result: { ...(u.result as object), derived: result.assets.map((a) => a.digest) },
      })
      .where(eq(uploads.id, u.id));
    await handleCsamHit(db, cas, deps.queue, deps.newId, {
      uploadId: u.id,
      reason: "csam_scan",
      actorId: deps.systemActorId,
      actorKind: "system",
      matchId: check.matchId,
      now: deps.now(),
      original: { bytes, mediaType: u.declaredType },
    });
    return fail("import.rejected");
  }

  const stored: StoredAsset[] = [];
  for (const p of check.processed) {
    const webp = await cas.putBlob(db, {
      bucket: "private",
      bytes: p.image.webp,
      mediaType: "image/webp",
      kind: "asset",
    });
    const thumb = await cas.putBlob(db, {
      bucket: "private",
      bytes: p.image.thumbnail,
      mediaType: "image/webp",
      kind: "thumbnail",
    });
    stored.push({
      slot: p.asset.slot,
      variant: p.asset.variant,
      webp: { digest: webp.digest, size: webp.size },
      thumbnail: thumb.digest,
      width: p.image.width,
      height: p.image.height,
      scan: p.scan,
    });
  }
  const creation = result.creation;
  const report = result.report;
  applyAssets(creation, report, stored, check.rejected);
  const working = forceIdentity(creation as unknown as Record<string, unknown>, {
    id: creationId,
    ref,
    type: creation.type,
  });
  try {
    canonicalizeCreation(working as unknown as CreationInput);
  } catch (e) {
    if (e instanceof CharError) return fail("import.parse_failed", e.code);
    throw e;
  }

  const original = await cas.putBlob(db, {
    bucket: "private",
    bytes,
    mediaType: u.declaredType,
    kind: "upload",
  });
  // 去掉 undefined 字段后再做 JCS 编码。
  const reportJson = JSON.parse(JSON.stringify(report)) as JSONValue;
  const reportBlob = await cas.putBlob(db, {
    bucket: "private",
    bytes: new TextEncoder().encode(jcs(reportJson)),
    mediaType: "application/json",
    kind: "report",
  });

  const now = deps.now();
  const outcome = await db.transaction(async (tx): Promise<ImportOutcome | "name_taken"> => {
    const [locked] = await tx
      .select({ status: imports.status })
      .from(imports)
      .where(eq(imports.id, imp.id))
      .limit(1)
      .for("update");
    if (locked?.status !== "processing") return "skipped";
    if (await nameTaken(tx, ns.id, imp.name)) return "name_taken";
    const done = await runOnce(tx, `import:${imp.id}`, QUEUE_NAMES.importCcv3, async () => {
      await tx.insert(creations).values({
        id: creationUuid,
        namespaceId: ns.id,
        name: imp.name,
        type: creation.type,
        displayName: creation.display_name,
        rating: "general",
      });
      await tx
        .insert(creationDrafts)
        .values({ creationId: creationUuid, working, updatedBy: imp.ownerUserId });
      for (const s of stored) {
        const scanStatus = s.scan.status === "clear" ? "clean" : "not_scanned";
        const scanProvider = s.scan.provider === "none" ? null : s.scan.provider;
        await tx
          .insert(assetMeta)
          .values([
            {
              digest: s.webp.digest,
              width: s.width,
              height: s.height,
              mediaType: "image/webp",
              scanStatus,
              scanProvider,
              scannedAt: s.scan.status === "clear" ? now : null,
            },
            {
              digest: s.thumbnail,
              width: 256,
              height: 256,
              mediaType: "image/webp",
              scanStatus,
              scanProvider,
              scannedAt: s.scan.status === "clear" ? now : null,
            },
          ])
          .onConflictDoNothing();
      }
      await tx
        .update(imports)
        .set({
          status: "succeeded",
          creationId: creationUuid,
          sourceDigest: original.digest,
          reportDigest: reportBlob.digest,
          needsConfirmation: report.needs_confirmation,
          confirmedAt: report.needs_confirmation.length === 0 ? now : null,
          updatedAt: now,
        })
        .where(eq(imports.id, imp.id));
      // 记下从这个上传派生出的图片：之后如果其中一张被标记为 CSAM，能追溯到上传者。
      await tx
        .update(uploads)
        .set({
          result: {
            ...(u.result as object),
            derived: stored.flatMap((s) => [s.webp.digest, s.thumbnail]),
          },
          updatedAt: now,
        })
        .where(eq(uploads.id, u.id));
      await appendAudit(tx, {
        at: now,
        actor: { kind: "system", id: "worker" },
        action: "creation.import",
        subject: `creation:${creationUuid}`,
        after: {
          import: encodeId("import", imp.id),
          ref,
          requested_by: encodeId("user", imp.ownerUserId),
          container: report.container,
        },
      });
    });
    return done ? "succeeded" : "skipped";
  });
  if (outcome === "name_taken") return fail("import.name_taken");
  if (outcome === "succeeded") await cas.deleteUpload(u.stagingKey);
  return outcome;
}

/**
 * 重试用尽时的错误码。这类失败不是卡片本身的问题（例如存储或数据库长时间不可用），
 * 原件仍然保留在 uploads 桶里，从死信队列重新投递后可以继续处理。
 */
export const IMPORT_INTERNAL_ERROR = "import.internal_error";

type ImportRow = typeof imports.$inferSelect;

function isRetryableFailure(imp: ImportRow): boolean {
  return imp.status === "failed" && imp.errorCode === IMPORT_INTERNAL_ERROR;
}

/**
 * 死信重新投递时，把因内部错误失败的导入放回 processing 并清掉错误。
 * 期间用户已经用同一个名字发起了另一个进行中的导入时（部分唯一索引冲突），保持失败不动。
 */
async function reviveImport(deps: ImportDeps, imp: ImportRow): Promise<ImportRow | undefined> {
  try {
    const [row] = await deps.db
      .update(imports)
      .set({ status: "processing", errorCode: null, errorDetail: null, updatedAt: deps.now() })
      .where(
        and(
          eq(imports.id, imp.id),
          eq(imports.status, "failed"),
          eq(imports.errorCode, IMPORT_INTERNAL_ERROR),
        ),
      )
      .returning();
    return row ?? imp;
  } catch (e) {
    if (isUniqueViolation(e)) return imp;
    throw e;
  }
}

function isUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e; cur; cur = (cur as { cause?: unknown }).cause) {
    if ((cur as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

/**
 * 最后一次尝试失败：把仍在进行中的导入标记为失败，发起人查询时能看到结果，而不是一直
 * “处理中”。不删除原件，以便从死信重新投递后继续处理。
 */
export async function markImportInternalError(
  deps: Pick<ImportDeps, "db" | "now">,
  importId: string,
  err: unknown,
): Promise<void> {
  const detail = err instanceof Error ? err.message.slice(0, 500) : "unknown error";
  await deps.db
    .update(imports)
    .set({
      status: "failed",
      errorCode: IMPORT_INTERNAL_ERROR,
      errorDetail: detail,
      updatedAt: deps.now(),
    })
    .where(and(eq(imports.id, importId), inArray(imports.status, ["pending", "processing"])));
}

/** 注册导入任务的处理函数。 */
export async function registerImportWorker(
  queue: JobQueue,
  deps: ImportDeps,
  options: { pollingIntervalSeconds?: number } = {},
): Promise<string> {
  return queue.work<ImportJob>(
    QUEUE_NAMES.importCcv3,
    async (job) => {
      await handleImportJob(deps, job.data);
    },
    {
      ...options,
      onFinalFailure: (job, err) => markImportInternalError(deps, job.data.import_id, err),
    },
  );
}
