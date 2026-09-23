/**
 * 上传图片的处理：识别真实类型、限制大小与像素、重新编码、生成缩略图。
 *
 * 所有对外分发的图片都是重新编码后的版本，原件从不分发。重新编码会丢掉全部元数据
 * （EXIF、GPS、XMP、注释），只保留按方向信息旋转后的像素。
 *
 * 拒绝的输入：
 * - 类型不是 PNG / JPEG / WebP / GIF（按文件头识别，不信任扩展名和 Content-Type），包括 SVG；
 * - 文件头与解码结果不一致，或者文件末尾还拼接了别的格式（polyglot）；
 * - 超过字节上限或像素上限（防解压炸弹）；
 * - 动图（v0 只接受静态图，GIF 只取第一帧也会改变作品含义，所以直接拒绝）。
 */
import sharp from "sharp";

export type ImageType = "png" | "jpeg" | "webp" | "gif";

export const IMAGE_LIMITS = {
  /** 头像、封面等素材的字节上限。CCv3 PNG 导入另有更高的上限。 */
  maxBytes: 8 * 1024 * 1024,
  /** 解码前检查的像素上限。 */
  maxPixels: 40_000_000,
  /** 输出图片最长边。 */
  maxEdge: 2048,
  thumbnailEdge: 256,
} as const;

export class ImageRejected extends Error {
  constructor(
    readonly code: string,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ImageRejected";
  }
}

const startsWith = (b: Uint8Array, sig: readonly number[], offset = 0) =>
  b.length >= offset + sig.length && sig.every((v, i) => b[offset + i] === v);

/** 按文件头识别图片类型。 */
export function sniffImageType(b: Uint8Array): ImageType | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8))
    return "webp";
  if (
    startsWith(b, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    startsWith(b, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return "gif";
  }
  return null;
}

/**
 * 找出格式本身的结束位置，用来发现末尾拼接的数据（例如 PNG 后面接一个 ZIP 或 HTML）。
 * 返回 null 表示无法确定（交给解码器判断）。
 */
export function formatEnd(b: Uint8Array, type: ImageType): number | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (type === "png") {
    let off = 8;
    while (off + 12 <= b.length) {
      const len = view.getUint32(off);
      const t = String.fromCharCode(...b.subarray(off + 4, off + 8));
      off += 12 + len;
      if (t === "IEND") return off;
    }
    return null;
  }
  if (type === "webp") {
    const size = b.length >= 8 ? view.getUint32(4, true) : 0;
    return 8 + size + (size % 2);
  }
  if (type === "jpeg") {
    // 从后往前找 EOI 标记；JPEG 内嵌缩略图也以 EOI 结束，所以取最后一个。
    for (let i = b.length - 2; i >= 2; i--) {
      if (b[i] === 0xff && b[i + 1] === 0xd9) return i + 2;
    }
    return null;
  }
  // GIF 以 0x3b 结束。
  return b[b.length - 1] === 0x3b ? b.length : null;
}

/** 文件末尾允许的少量填充（部分编码器会补零）。 */
const MAX_TRAILING_PADDING = 16;

export interface ProcessedImage {
  source_type: ImageType;
  width: number;
  height: number;
  webp: Uint8Array;
  thumbnail: Uint8Array;
}

export async function processImage(
  input: Uint8Array,
  limits: { maxBytes?: number; maxPixels?: number; maxEdge?: number; thumbnailEdge?: number } = {},
): Promise<ProcessedImage> {
  const maxBytes = limits.maxBytes ?? IMAGE_LIMITS.maxBytes;
  const maxPixels = limits.maxPixels ?? IMAGE_LIMITS.maxPixels;
  const maxEdge = limits.maxEdge ?? IMAGE_LIMITS.maxEdge;
  const thumbEdge = limits.thumbnailEdge ?? IMAGE_LIMITS.thumbnailEdge;

  if (input.byteLength > maxBytes) throw new ImageRejected("upload.too_large");
  const type = sniffImageType(input);
  if (!type) throw new ImageRejected("upload.unsupported_type");

  const end = formatEnd(input, type);
  if (end !== null) {
    const trailing = input.subarray(Math.min(end, input.length));
    if (trailing.length > MAX_TRAILING_PADDING || trailing.some((x) => x !== 0)) {
      throw new ImageRejected("upload.trailing_data", "file contains data after the image");
    }
  }

  // 读取元数据只解析文件头、不解码像素，所以这里不设像素上限：宽高要先读出来，才能对
  // 解压炸弹给出明确的 `upload.too_many_pixels`。真正解码时仍由 limitInputPixels 兜底。
  const img = sharp(input, { limitInputPixels: false, failOn: "error", animated: true });
  let meta: sharp.Metadata;
  try {
    meta = await img.metadata();
  } catch (e) {
    throw new ImageRejected("upload.decode_failed", (e as Error).message);
  }
  // libvips 按内容选择解码器，正常情况下与文件头识别的类型一致；不一致说明文件被刻意构造过。
  if (meta.format !== type) {
    throw new ImageRejected(
      "upload.type_mismatch",
      `header says ${type}, decoder says ${meta.format}`,
    );
  }
  if ((meta.pages ?? 1) > 1) throw new ImageRejected("upload.animated_not_supported");
  if (meta.width * meta.height > maxPixels) throw new ImageRejected("upload.too_many_pixels");

  try {
    const base = sharp(input, { limitInputPixels: maxPixels, failOn: "error" }).autoOrient();
    // sharp 默认不把任何元数据写入输出，这里也不调用 withMetadata / keepMetadata。
    const { data: webp, info } = await base
      .clone()
      .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 88 })
      .toBuffer({ resolveWithObject: true });
    const thumbnail = await base
      .clone()
      .resize({ width: thumbEdge, height: thumbEdge, fit: "cover", position: "attention" })
      .webp({ quality: 80 })
      .toBuffer();
    return {
      source_type: type,
      width: info.width,
      height: info.height,
      webp: new Uint8Array(webp),
      thumbnail: new Uint8Array(thumbnail),
    };
  } catch (e) {
    throw new ImageRejected("upload.decode_failed", (e as Error).message);
  }
}
