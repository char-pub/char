/**
 * 字节层工具：CRC32、Base64、严格的 UTF-8 编解码、大端 / 小端整数读取。
 * 只依赖 Uint8Array 和 fflate 的 UTF-8 转换，在 Node、浏览器和 Workers 中行为一致。
 */
import { CharError } from "@char-pub/core";
import { strFromU8, strToU8 } from "fflate";

// ---------------------------------------------------------------------------
// CRC32（IEEE 802.3，PNG 与 ZIP 共用）
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** 计算 CRC32；可以分段调用：把上一段的结果作为 `seed` 传入。 */
export function crc32(bytes: Uint8Array, seed = 0): number {
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// 整数读写
// ---------------------------------------------------------------------------

export function readU32BE(b: Uint8Array, o: number): number {
  return (
    (((b[o] as number) << 24) |
      ((b[o + 1] as number) << 16) |
      ((b[o + 2] as number) << 8) |
      (b[o + 3] as number)) >>>
    0
  );
}

export function writeU32BE(b: Uint8Array, o: number, v: number): void {
  b[o] = (v >>> 24) & 0xff;
  b[o + 1] = (v >>> 16) & 0xff;
  b[o + 2] = (v >>> 8) & 0xff;
  b[o + 3] = v & 0xff;
}

export function readU16LE(b: Uint8Array, o: number): number {
  return ((b[o] as number) | ((b[o + 1] as number) << 8)) >>> 0;
}

export function readU32LE(b: Uint8Array, o: number): number {
  return (
    ((b[o] as number) |
      ((b[o + 1] as number) << 8) |
      ((b[o + 2] as number) << 16) |
      ((b[o + 3] as number) << 24)) >>>
    0
  );
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function startsWith(b: Uint8Array, prefix: readonly number[]): boolean {
  if (b.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (b[i] !== prefix[i]) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Latin-1（PNG tEXt 的编码）
// ---------------------------------------------------------------------------

export function latin1Decode(b: Uint8Array): string {
  let s = "";
  const STEP = 8192;
  for (let i = 0; i < b.length; i += STEP) {
    s += String.fromCharCode(...b.subarray(i, Math.min(i + STEP, b.length)));
  }
  return s;
}

/** 只接受 U+0000～U+00FF 的字符。 */
export function latin1Encode(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0xff) {
      throw new CharError({
        code: "png.bad_text_chunk",
        subject: "text",
        detail: "non Latin-1 character",
      });
    }
    out[i] = c;
  }
  return out;
}

// ---------------------------------------------------------------------------
// UTF-8：解码时拒绝非法字节序列，而不是悄悄替换成 U+FFFD
// ---------------------------------------------------------------------------

export function utf8Encode(s: string): Uint8Array {
  return strToU8(s);
}

export function utf8Decode(b: Uint8Array, subject: string): string {
  let s: string;
  try {
    s = strFromU8(b);
  } catch {
    throw new CharError({ code: "ccv3.invalid_utf8", subject });
  }
  // 往返比较：非法序列会被解码器替换，重新编码后字节必然不同
  if (!bytesEqual(strToU8(s), b)) throw new CharError({ code: "ccv3.invalid_utf8", subject });
  return s;
}

// ---------------------------------------------------------------------------
// Base64（标准字母表；解码时忽略 ASCII 空白、允许省略 padding，其他非法字符一律拒绝）
// ---------------------------------------------------------------------------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

export function base64Encode(b: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < b.length; i += 3) {
    const n = ((b[i] as number) << 16) | ((b[i + 1] as number) << 8) | (b[i + 2] as number);
    out +=
      B64.charAt((n >> 18) & 63) +
      B64.charAt((n >> 12) & 63) +
      B64.charAt((n >> 6) & 63) +
      B64.charAt(n & 63);
  }
  const rest = b.length - i;
  if (rest === 1) {
    const n = (b[i] as number) << 16;
    out += `${B64.charAt((n >> 18) & 63)}${B64.charAt((n >> 12) & 63)}==`;
  } else if (rest === 2) {
    const n = ((b[i] as number) << 16) | ((b[i + 1] as number) << 8);
    out += `${B64.charAt((n >> 18) & 63)}${B64.charAt((n >> 12) & 63)}${B64.charAt((n >> 6) & 63)}=`;
  }
  return out;
}

export function base64Decode(input: string, subject: string): Uint8Array {
  const s = input.replace(/[\t\n\f\r ]+/g, "");
  const bad = () => new CharError({ code: "ccv3.invalid_base64", subject });
  let end = s.length;
  if (end > 0 && s[end - 1] === "=") end--;
  if (end > 0 && s[end - 1] === "=") end--;
  const padding = s.length - end;
  if (padding > 0 && s.length % 4 !== 0) throw bad();
  if (end % 4 === 1) throw bad();
  const out = new Uint8Array(Math.floor((end * 3) / 4));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < end; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? (B64_INDEX[c] as number) : -1;
    if (v < 0) throw bad();
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  // 末尾不足一个字节的位直接丢弃（与常见解码器一致，便于兼容不规范的编码器）
  return out;
}
