/** Upload original asset bytes, then wait for the Registry's validated result. */
import { MAX_ASSET_BYTES, UPLOAD_TYPES } from "@char-pub/contracts";
import { MAX_SOURCE_BYTES, sha256Bytes } from "@char-pub/core";
import type { RegistryClient, UploadStatus } from "./api";
import type { BlobInfo } from "./draft";

export const IMAGE_TYPES: readonly string[] = UPLOAD_TYPES;
export const MAX_IMAGE_BYTES = MAX_ASSET_BYTES;
export const REFERENCE_TYPES = ["text/plain", "text/markdown"] as const;
export type ReferenceFormat = "text" | "markdown";
export interface UploadOptions {
  pollMs?: number;
  maxPolls?: number;
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  onStage?: (stage: "uploading" | "processing") => void;
  /** Resume an already sent file, without sending another copy. */
  resumeUpload?: string;
}
export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}
export class UploadCancelledError extends UploadError {
  constructor() {
    super("Adding the document was cancelled.");
    this.name = "UploadCancelledError";
  }
}
export class UploadPendingError extends UploadError {
  constructor(
    readonly uploadId: string,
    message: string,
  ) {
    super(message);
    this.name = "UploadPendingError";
  }
}
const REJECT_MESSAGE: Record<string, string> = {
  "upload.type_mismatch": "The file is not the image type it claims to be.",
  "upload.unsupported_type": "Use a PNG, JPEG, WebP or GIF image.",
  "upload.too_large": "The file is too large.",
  "upload.too_many_pixels": "The image has too many pixels.",
  "upload.animated_not_supported": "Animated images are not supported.",
  "upload.decode_failed": "The image could not be read.",
  "upload.trailing_data": "The image file contains extra data after the image.",
  "upload.expired": "The upload expired. Select the file again.",
  "source.invalid_utf8": "Save this document as UTF-8 text and try again.",
  "source.binary_content":
    "This file contains binary data. Choose a plain text or Markdown document.",
  "source.too_large": "Reference documents can be at most 8 MiB.",
};
function cancelled(signal?: AbortSignal, isCurrent?: () => boolean) {
  if (signal?.aborted || (isCurrent && !isCurrent())) throw new UploadCancelledError();
}
async function sleep(ms: number, signal?: AbortSignal) {
  cancelled(signal);
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new UploadCancelledError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Shared transfer lifecycle. Cancellation stops subsequent steps; in-flight transport may finish. */
async function uploadAsset(
  client: RegistryClient,
  file: Blob,
  bytes: Uint8Array,
  opts: UploadOptions,
  label: "image" | "document",
): Promise<BlobInfo> {
  cancelled(opts.signal, opts.isCurrent);
  let id = opts.resumeUpload;
  let status: UploadStatus;
  if (id) {
    opts.onStage?.("processing");
    status = await client.upload(id);
    cancelled(opts.signal, opts.isCurrent);
    if (status.status === "uploaded") status = await client.completeUpload(id);
  } else {
    opts.onStage?.("uploading");
    const target = await client.createUpload({
      purpose: "asset",
      content_type: file.type,
      size: bytes.byteLength,
      sha256: sha256Bytes(bytes),
    });
    cancelled(opts.signal, opts.isCurrent);
    await client.putUpload(target, file);
    cancelled(opts.signal, opts.isCurrent);
    id = target.upload;
    try {
      status = await client.completeUpload(id);
    } catch {
      cancelled(opts.signal, opts.isCurrent);
      throw new UploadPendingError(
        id,
        "The file was sent, but its processing status is unavailable. Check processing again.",
      );
    }
  }
  cancelled(opts.signal, opts.isCurrent);
  opts.onStage?.("processing");
  for (
    let i = 0;
    i < (opts.maxPolls ?? 60) && (status.status === "uploaded" || status.status === "processing");
    i++
  ) {
    await sleep(opts.pollMs ?? 1000, opts.signal);
    cancelled(opts.signal, opts.isCurrent);
    try {
      status = await client.upload(id);
    } catch {
      cancelled(opts.signal, opts.isCurrent);
      throw new UploadPendingError(
        id,
        "The file was sent, but its processing status is unavailable. Check processing again.",
      );
    }
    cancelled(opts.signal, opts.isCurrent);
  }
  if (status.status === "ready" && status.blob)
    return {
      digest: status.blob.digest as BlobInfo["digest"],
      size: status.blob.size,
      media_type: status.blob.media_type,
    };
  if (status.status === "rejected" || status.status === "quarantined")
    throw new UploadError(
      (status.reject_reason && REJECT_MESSAGE[status.reject_reason]) ??
        `The ${label} was not accepted.`,
    );
  throw new UploadPendingError(
    id,
    `The ${label} is still being processed. Check processing again in a moment.`,
  );
}

export async function uploadImage(
  client: RegistryClient,
  file: Blob,
  opts: UploadOptions = {},
): Promise<BlobInfo> {
  if (!IMAGE_TYPES.includes(file.type))
    throw new UploadError("Use a PNG, JPEG, WebP or GIF image.");
  if (file.size > MAX_IMAGE_BYTES) throw new UploadError("Images can be at most 8 MiB.");
  cancelled(opts.signal, opts.isCurrent);
  return uploadAsset(client, file, new Uint8Array(await file.arrayBuffer()), opts, "image");
}

export function referenceFileFormat(file: Pick<File, "type" | "name">): ReferenceFormat {
  if (file.type && ![...REFERENCE_TYPES, "application/octet-stream"].includes(file.type))
    throw new UploadError("Choose a plain text (.txt) or Markdown (.md) document.");
  if (/\.(md|markdown)$/i.test(file.name) || file.type === "text/markdown") return "markdown";
  if (/\.txt$/i.test(file.name) || file.type === "text/plain") return "text";
  throw new UploadError("Choose a plain text (.txt) or Markdown (.md) document.");
}

/** Validate text without re-encoding it: BOM, CRLF and every original UTF-8 byte are preserved. */
export async function uploadReferenceText(
  client: RegistryClient,
  file: File,
  opts: UploadOptions = {},
): Promise<BlobInfo & { format: ReferenceFormat }> {
  const format = referenceFileFormat(file);
  if (file.size > MAX_SOURCE_BYTES)
    throw new UploadError("Reference documents can be at most 8 MiB.");
  if (file.size === 0)
    throw new UploadError("This document is empty. Choose a file with some text.");
  cancelled(opts.signal, opts.isCurrent);
  const bytes = new Uint8Array(await file.arrayBuffer());
  cancelled(opts.signal, opts.isCurrent);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new UploadError("Save this document as UTF-8 text and try again.");
  }
  if (text.includes("\u0000"))
    throw new UploadError(
      "This file contains binary data. Choose a plain text or Markdown document.",
    );
  const mediaType = format === "markdown" ? "text/markdown" : "text/plain";
  const blob = await uploadAsset(
    client,
    file.slice(0, file.size, mediaType),
    bytes,
    opts,
    "document",
  );
  if (
    blob.digest !== sha256Bytes(bytes) ||
    blob.size !== bytes.length ||
    blob.media_type !== mediaType
  )
    throw new UploadError("The uploaded document does not match your file. Select the file again.");
  return { ...blob, format };
}
