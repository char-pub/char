/**
 * PNG 容器的读写，只处理角色卡需要的部分：逐个 chunk 校验结构与 CRC，读取和写入 tEXt。
 *
 * 角色卡把 JSON 做 UTF-8 → Base64 编码后放在 tEXt chunk 中：CCv3 用 keyword `ccv3`，
 * 旧的 V2 用 `chara`。两者同时存在时以 `ccv3` 为准。
 */
import { CharError } from "@char-pub/core";
import {
  concatBytes,
  crc32,
  latin1Decode,
  latin1Encode,
  readU32BE,
  startsWith,
  writeU32BE,
} from "./bytes.js";

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export interface PngLimits {
  /** 整个文件的字节上限。 */
  maxFileBytes: number;
  /** 单个 chunk 数据的字节上限。 */
  maxChunkBytes: number;
  /** chunk 数量上限（防止用大量空 chunk 拖慢解析）。 */
  maxChunks: number;
}

export const DEFAULT_PNG_LIMITS: PngLimits = {
  maxFileBytes: 20 * 1024 * 1024,
  maxChunkBytes: 16 * 1024 * 1024,
  maxChunks: 10_000,
};

export interface PngChunk {
  type: string;
  data: Uint8Array;
}

export interface PngTextEntry {
  keyword: string;
  text: string;
}

function fail(code: string, detail?: string): never {
  throw new CharError(
    detail === undefined ? { code, subject: "png" } : { code, subject: "png", detail },
  );
}

export function isPng(bytes: Uint8Array): boolean {
  return startsWith(bytes, PNG_SIGNATURE);
}

/**
 * 解析全部 chunk。要求：签名正确、每个 chunk 长度与 CRC 正确、以 IHDR 开头、以 IEND 结束、
 * IEND 之后没有多余数据。
 */
export function readPngChunks(bytes: Uint8Array, limits: Partial<PngLimits> = {}): PngChunk[] {
  const lim = { ...DEFAULT_PNG_LIMITS, ...limits };
  if (bytes.length > lim.maxFileBytes)
    fail("png.too_large", `file exceeds ${lim.maxFileBytes} bytes`);
  if (!isPng(bytes)) fail("png.bad_signature");
  const chunks: PngChunk[] = [];
  let o = PNG_SIGNATURE.length;
  let sawEnd = false;
  while (o < bytes.length) {
    if (sawEnd) fail("png.trailing_data");
    if (chunks.length >= lim.maxChunks) fail("png.too_many_chunks");
    if (o + 12 > bytes.length) fail("png.truncated");
    const len = readU32BE(bytes, o);
    if (len > 0x7fffffff) fail("png.bad_chunk_length");
    if (len > lim.maxChunkBytes)
      fail("png.chunk_too_large", `chunk exceeds ${lim.maxChunkBytes} bytes`);
    if (o + 12 + len > bytes.length) fail("png.truncated");
    const typeBytes = bytes.subarray(o + 4, o + 8);
    for (const c of typeBytes) {
      const isLetter = (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
      if (!isLetter) fail("png.bad_chunk_type");
    }
    const type = latin1Decode(typeBytes);
    const data = bytes.subarray(o + 8, o + 8 + len);
    const expected = readU32BE(bytes, o + 8 + len);
    if (crc32(data, crc32(typeBytes)) !== expected) fail("png.bad_crc", type);
    if (chunks.length === 0 && type !== "IHDR") fail("png.missing_ihdr");
    chunks.push({ type, data });
    if (type === "IEND") sawEnd = true;
    o += 12 + len;
  }
  if (!sawEnd) fail("png.truncated", "missing IEND");
  return chunks;
}

export function encodePngChunk(type: string, data: Uint8Array): Uint8Array {
  if (!/^[A-Za-z]{4}$/.test(type)) fail("png.bad_chunk_type");
  const out = new Uint8Array(12 + data.length);
  writeU32BE(out, 0, data.length);
  const typeBytes = latin1Encode(type);
  out.set(typeBytes, 4);
  out.set(data, 8);
  writeU32BE(out, 8 + data.length, crc32(data, crc32(typeBytes)));
  return out;
}

export function writePngChunks(chunks: readonly PngChunk[]): Uint8Array {
  return concatBytes([
    Uint8Array.from(PNG_SIGNATURE),
    ...chunks.map((c) => encodePngChunk(c.type, c.data)),
  ]);
}

/** tEXt：Latin-1 keyword（1～79 字节）+ NUL + Latin-1 文本。格式不对返回 null。 */
export function decodeTextChunk(data: Uint8Array): PngTextEntry | null {
  const nul = data.indexOf(0);
  if (nul < 1 || nul > 79) return null;
  return {
    keyword: latin1Decode(data.subarray(0, nul)),
    text: latin1Decode(data.subarray(nul + 1)),
  };
}

export function encodeTextChunk(keyword: string, text: string): PngChunk {
  if (keyword.length < 1 || keyword.length > 79 || keyword.includes("\0"))
    fail("png.bad_text_chunk", "keyword");
  if (text.includes("\0")) fail("png.bad_text_chunk", "text contains NUL");
  const k = latin1Encode(keyword);
  const t = latin1Encode(text);
  const data = new Uint8Array(k.length + 1 + t.length);
  data.set(k, 0);
  data.set(t, k.length + 1);
  return { type: "tEXt", data };
}

export function readPngTextEntries(chunks: readonly PngChunk[]): PngTextEntry[] {
  const out: PngTextEntry[] = [];
  for (const c of chunks) {
    if (c.type !== "tEXt") continue;
    const e = decodeTextChunk(c.data);
    if (e) out.push(e);
  }
  return out;
}

/**
 * 可能携带隐私或卡片数据的辅助 chunk：文本（角色卡 JSON 就在这里，包括导入时要省略的
 * system_prompt 原值）、EXIF（可能有 GPS）和时间戳。
 */
const METADATA_CHUNKS = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

/** 去掉所有元数据 chunk，只保留图像本身需要的部分。 */
export function stripPngMetadata(png: Uint8Array, limits: Partial<PngLimits> = {}): Uint8Array {
  return writePngChunks(readPngChunks(png, limits).filter((c) => !METADATA_CHUNKS.has(c.type)));
}

/**
 * 替换 PNG 中的文本 chunk：删除 keyword 属于 `remove` 的旧 tEXt，
 * 把新的 tEXt 插在 IEND 之前。其余 chunk 原样保留。
 */
export function replacePngText(
  png: Uint8Array,
  entries: readonly PngTextEntry[],
  remove: readonly string[],
  limits: Partial<PngLimits> = {},
): Uint8Array {
  const chunks = readPngChunks(png, limits).filter((c) => {
    if (c.type !== "tEXt") return true;
    const e = decodeTextChunk(c.data);
    return !(e && remove.includes(e.keyword));
  });
  const end = chunks.pop();
  if (end?.type !== "IEND") fail("png.truncated", "missing IEND");
  return writePngChunks([
    ...chunks,
    ...entries.map((e) => encodeTextChunk(e.keyword, e.text)),
    end,
  ]);
}
