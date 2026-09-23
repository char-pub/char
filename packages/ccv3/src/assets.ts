/**
 * 导入时把卡片声明的资源（头像、背景、表情）解析成字节。
 *
 * 能解析的来源：`embeded://路径`（CHARX 压缩包内的文件）、`__asset:路径`（旧 PNG 扩展，
 * 资源放在 `chara-ext-asset_:路径` 文本 chunk 里）、`data:` URL，以及 PNG 卡片的
 * `ccdefault:` 头像（就是这张 PNG 本身，去掉元数据后使用）。远程 URL 不会被下载：
 * 这个包不做网络 IO，由调用方决定是否另行抓取。
 *
 * 只接受 PNG、JPEG、WebP、GIF 图片，按文件头判断真实类型，不信任扩展名。
 */
import { CharError } from "@char-pub/core";
import { base64Decode, startsWith } from "./bytes.js";

export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

/** 按文件头识别图片类型；不认识返回 null。 */
export function sniffImageType(b: Uint8Array): ImageMediaType | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(b, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (
    b.length >= 12 &&
    startsWith(b, [0x52, 0x49, 0x46, 0x46]) &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export type AssetSource =
  | { kind: "bytes"; bytes: Uint8Array }
  | { kind: "remote"; url: string }
  | { kind: "missing"; reason: string };

export interface AssetResolver {
  /** 容器内的文件（CHARX 用路径，PNG 旧扩展用 `__asset:` 后面的路径）。 */
  embedded(path: string): Uint8Array | null;
  /** PNG 卡片本身（已去掉元数据）；其他容器为 null。 */
  defaultIcon: Uint8Array | null;
  maxAssetBytes: number;
}

const DATA_URL_RE = /^data:([a-z0-9.+/-]*)((?:;[a-z0-9=.+-]+)*);base64,(.*)$/is;

export function resolveAssetUri(uri: string, type: string, r: AssetResolver): AssetSource {
  if (uri === "ccdefault:") {
    // 只有头像的默认资源有意义：PNG 卡片的默认头像就是图片本身
    if (type === "icon" && r.defaultIcon) return { kind: "bytes", bytes: r.defaultIcon };
    return { kind: "missing", reason: "no default asset in this container" };
  }
  if (uri.startsWith("embeded://")) {
    const b = r.embedded(uri.slice("embeded://".length));
    return b ? { kind: "bytes", bytes: b } : { kind: "missing", reason: "embedded file not found" };
  }
  if (uri.startsWith("__asset:")) {
    const b = r.embedded(uri.slice("__asset:".length));
    return b ? { kind: "bytes", bytes: b } : { kind: "missing", reason: "embedded file not found" };
  }
  if (/^data:/i.test(uri)) {
    const m = DATA_URL_RE.exec(uri);
    if (!m) return { kind: "missing", reason: "only base64 data URLs are supported" };
    const payload = m[3] ?? "";
    if (payload.length > Math.ceil((r.maxAssetBytes * 4) / 3) + 4) {
      return { kind: "missing", reason: "asset too large" };
    }
    try {
      return { kind: "bytes", bytes: base64Decode(payload, "asset") };
    } catch (e) {
      if (e instanceof CharError) return { kind: "missing", reason: "invalid base64 data URL" };
      throw e;
    }
  }
  if (/^https?:\/\//i.test(uri)) return { kind: "remote", url: uri };
  return { kind: "missing", reason: "unsupported URI scheme" };
}
