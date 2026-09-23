/**
 * 上传图片：浏览器先算 sha256，向 API 申请限定长度与类型的预签名 PUT 地址，直接上传到
 * 对象存储，然后通知 API 进入处理队列（格式校验、去除元数据、安全扫描），等到 ready 后
 * 得到可以在 Creation 里引用的 blob。
 */
import { UPLOAD_TYPES } from "@char-pub/contracts";
import { sha256Bytes } from "@char-pub/core";
import type { RegistryClient } from "./api";
import type { BlobInfo } from "./draft";

export const IMAGE_TYPES: readonly string[] = UPLOAD_TYPES;
/** 头像等图片 asset 的大小上限。 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

const REJECT_MESSAGE: Record<string, string> = {
  "upload.type_mismatch": "The file is not the image type it claims to be.",
  "upload.unsupported_type": "Use a PNG, JPEG, WebP or GIF image.",
  "upload.too_large": "The image is too large.",
  "upload.too_many_pixels": "The image has too many pixels.",
  "upload.animated_not_supported": "Animated images are not supported.",
  "upload.decode_failed": "The image could not be read.",
  "upload.trailing_data": "The image file contains extra data after the image.",
  "upload.expired": "The upload took too long. Try again.",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function uploadImage(
  client: RegistryClient,
  file: Blob,
  opts: { pollMs?: number; maxPolls?: number } = {},
): Promise<BlobInfo> {
  if (!IMAGE_TYPES.includes(file.type)) {
    throw new UploadError("Use a PNG, JPEG, WebP or GIF image.");
  }
  if (file.size > MAX_IMAGE_BYTES) throw new UploadError("Images can be at most 10 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const target = await client.createUpload({
    purpose: "asset",
    content_type: file.type,
    size: bytes.byteLength,
    sha256: sha256Bytes(bytes),
  });
  await client.putUpload(target, file);
  let status = await client.completeUpload(target.upload);
  const maxPolls = opts.maxPolls ?? 60;
  for (
    let i = 0;
    i < maxPolls && (status.status === "uploaded" || status.status === "processing");
    i++
  ) {
    await sleep(opts.pollMs ?? 1000);
    status = await client.upload(target.upload);
  }
  if (status.status === "ready" && status.blob) {
    return {
      digest: status.blob.digest as BlobInfo["digest"],
      size: status.blob.size,
      media_type: status.blob.media_type,
    };
  }
  if (status.status === "rejected" || status.status === "quarantined") {
    throw new UploadError(
      (status.reject_reason && REJECT_MESSAGE[status.reject_reason]) ??
        "The image was not accepted.",
    );
  }
  throw new UploadError("The image is still being processed. Try again in a moment.");
}
