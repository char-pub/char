/**
 * 角色卡导入（CCv3 / CCv2 / PNG / CHARX / JSON），转换在服务端完成：
 *
 * 1. 浏览器算出原件的 sha256，申请一个 purpose 为 import 的上传，把原件直接 PUT 到对象
 *    存储，等上传通过完整性检查；
 * 2. `POST /v1/imports` 让服务端解析卡片，在作者的 namespace 下生成一个新 Creation 的草稿，
 *    卡片里的图片走与普通上传相同的处理与扫描；
 * 3. 轮询导入状态，拿到 Import Report；
 * 4. 作者显式确认评级、权利与许可之后才能发布。
 */
import { MAX_UPLOAD_BYTES } from "@char-pub/contracts";
import { sha256Bytes } from "@char-pub/core";
import type { ImportStatus, RegistryClient } from "./api";
import { UploadError } from "./upload";

export type CardContentType = "image/png" | "application/json" | "application/zip";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 按文件头判断容器类型：PNG、ZIP（CHARX）或 JSON。都不是时返回 null。 */
export function sniffCardType(bytes: Uint8Array): CardContentType | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return "application/zip";
  }
  // JSON：跳过 UTF-8 BOM 与空白之后以 `{` 开头。
  let i = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while (
    i < bytes.length &&
    (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09)
  ) {
    i++;
  }
  return bytes[i] === 0x7b ? "application/json" : null;
}

const IMPORT_ERRORS: Record<string, string> = {
  "import.unsupported_format": "This file is not a character card we can read.",
  "import.parse_failed": "The card could not be read. It may be damaged.",
  "import.too_large": "The card is too large to import.",
  "import.rejected": "This file cannot be imported.",
  "import.name_taken": "That address is already taken. Choose another one.",
  "import.digest_mismatch": "The upload was damaged on the way. Try again.",
  "import.upload_unavailable": "The upload expired. Choose the file again.",
  "import.internal_error": "The import failed on our side. Try again later.",
};

/** 导入失败时给作者看的说明。 */
export function importErrorMessage(code: string | undefined): string {
  return (code && IMPORT_ERRORS[code]) || "The import did not finish. Try again.";
}

/** 上传原件并等它通过完整性检查，返回上传 ID。 */
export async function uploadCard(
  client: RegistryClient,
  file: Blob,
  opts: { pollMs?: number; maxPolls?: number } = {},
): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError("Cards can be at most 20 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffCardType(bytes);
  if (!type) throw new UploadError("This file is not a PNG, JSON or CHARX character card.");
  const target = await client.createUpload({
    purpose: "import",
    content_type: type,
    size: bytes.byteLength,
    sha256: sha256Bytes(bytes),
  });
  await client.putUpload(target, new Blob([bytes], { type }));
  let status = await client.completeUpload(target.upload);
  for (
    let i = 0;
    i < (opts.maxPolls ?? 60) && (status.status === "uploaded" || status.status === "processing");
    i++
  ) {
    await sleep(opts.pollMs ?? 1000);
    status = await client.upload(target.upload);
  }
  if (status.status === "ready") return target.upload;
  if (status.status === "rejected" || status.status === "quarantined") {
    throw new UploadError("This file cannot be imported.");
  }
  throw new UploadError("The upload is still being checked. Try again in a moment.");
}

/** 轮询导入任务，直到成功或失败。 */
export async function waitForImport(
  client: RegistryClient,
  first: ImportStatus,
  opts: { pollMs?: number; maxPolls?: number } = {},
): Promise<ImportStatus> {
  let status = first;
  for (
    let i = 0;
    i < (opts.maxPolls ?? 90) && (status.status === "pending" || status.status === "processing");
    i++
  ) {
    await sleep(opts.pollMs ?? 1000);
    status = await client.importStatus(status.import);
  }
  return status;
}
