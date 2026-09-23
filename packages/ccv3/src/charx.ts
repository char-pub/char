/**
 * CHARX（zip）容器的安全读取。
 *
 * 不直接用 unzipSync：它会按 zip 里声明的解压后大小一次性分配内存，而这个大小是攻击者
 * 可控的。这里自己解析中央目录，先按声明的大小检查条目数、单个文件和总量上限，然后只
 * 解压真正需要的文件；解压时分段进行，实际输出一旦超过声明大小就立即中止，最后校验
 * 长度与 CRC32。拒绝加密条目、zip64、路径穿越和重复文件名。
 */
import { CharError } from "@char-pub/core";
import { Inflate } from "fflate";
import { crc32, readU16LE, readU32LE, startsWith, utf8Decode } from "./bytes.js";

export const ZIP_LOCAL_SIGNATURE = [0x50, 0x4b, 0x03, 0x04] as const;

export interface ZipLimits {
  /** 压缩包本身的字节上限。 */
  maxArchiveBytes: number;
  /** 条目数上限。 */
  maxEntries: number;
  /** 单个文件解压后的字节上限。 */
  maxEntryBytes: number;
  /** 所有文件解压后的字节总量上限（按中央目录声明的大小计算）。 */
  maxTotalBytes: number;
  /** 解压后 / 压缩后的比例上限，超过视为压缩炸弹。 */
  maxRatio: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxArchiveBytes: 50 * 1024 * 1024,
  maxEntries: 2_000,
  maxEntryBytes: 20 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
  maxRatio: 200,
};

export interface ZipEntry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
}

export interface ZipArchive {
  entries: ReadonlyMap<string, ZipEntry>;
  /** 读取并解压一个文件；不存在时返回 null。 */
  read(name: string): Uint8Array | null;
}

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const INFLATE_STEP = 16 * 1024;

function fail(code: string, detail?: string): never {
  throw new CharError(
    detail === undefined ? { code, subject: "charx" } : { code, subject: "charx", detail },
  );
}

export function isZip(bytes: Uint8Array): boolean {
  return startsWith(bytes, ZIP_LOCAL_SIGNATURE);
}

/** 文件名必须是相对路径，不能含 `..`、反斜杠、盘符或控制字符。 */
export function isSafeZipPath(name: string): boolean {
  if (name.length === 0 || name.length > 512) return false;
  if (name.startsWith("/") || name.includes("\\") || /^[A-Za-z]:/.test(name)) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 就是要拒绝控制字符
  if (/[\u0000-\u001f\u007f]/.test(name)) return false;
  return name.split("/").every((seg, i, all) => {
    if (seg === "..") return false;
    if (seg === ".") return false;
    // 只允许目录条目以 `/` 结尾（最后一段为空）
    return seg.length > 0 || i === all.length - 1;
  });
}

function findEocd(b: Uint8Array): number {
  const min = Math.max(0, b.length - 22 - 0xffff);
  for (let o = b.length - 22; o >= min; o--) {
    if (readU32LE(b, o) === EOCD_SIG) return o;
  }
  return fail("charx.not_zip", "end of central directory not found");
}

export function openZip(bytes: Uint8Array, limits: Partial<ZipLimits> = {}): ZipArchive {
  const lim = { ...DEFAULT_ZIP_LIMITS, ...limits };
  if (bytes.length > lim.maxArchiveBytes)
    fail("charx.too_large", `archive exceeds ${lim.maxArchiveBytes} bytes`);
  if (bytes.length < 22) fail("charx.not_zip");
  const eocd = findEocd(bytes);
  if (eocd >= 20 && readU32LE(bytes, eocd - 20) === ZIP64_LOCATOR_SIG)
    fail("charx.zip64_unsupported");
  const diskNo = readU16LE(bytes, eocd + 4);
  const cdDisk = readU16LE(bytes, eocd + 6);
  const count = readU16LE(bytes, eocd + 10);
  const cdSize = readU32LE(bytes, eocd + 12);
  const cdOffset = readU32LE(bytes, eocd + 16);
  if (diskNo !== 0 || cdDisk !== 0) fail("charx.multi_disk_unsupported");
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff)
    fail("charx.zip64_unsupported");
  if (count > lim.maxEntries) fail("charx.too_many_entries", `more than ${lim.maxEntries} entries`);
  if (cdOffset + cdSize > eocd) fail("charx.corrupt", "central directory out of range");

  const entries = new Map<string, ZipEntry>();
  let total = 0;
  let o = cdOffset;
  for (let i = 0; i < count; i++) {
    if (o + 46 > eocd || readU32LE(bytes, o) !== CD_SIG)
      fail("charx.corrupt", "bad central directory entry");
    const flags = readU16LE(bytes, o + 8);
    const method = readU16LE(bytes, o + 10);
    const crc = readU32LE(bytes, o + 16);
    const compressedSize = readU32LE(bytes, o + 20);
    const size = readU32LE(bytes, o + 24);
    const nameLen = readU16LE(bytes, o + 28);
    const extraLen = readU16LE(bytes, o + 30);
    const commentLen = readU16LE(bytes, o + 32);
    const localHeaderOffset = readU32LE(bytes, o + 42);
    const next = o + 46 + nameLen + extraLen + commentLen;
    if (next > eocd) fail("charx.corrupt", "central directory entry overflows");
    if (compressedSize === 0xffffffff || size === 0xffffffff || localHeaderOffset === 0xffffffff) {
      fail("charx.zip64_unsupported");
    }
    const rawName = bytes.subarray(o + 46, o + 46 + nameLen);
    const name = utf8Decode(rawName, "charx.entry_name");
    o = next;
    if (flags & 0x1) fail("charx.encrypted", name);
    if (!isSafeZipPath(name)) fail("charx.unsafe_path", name);
    if (entries.has(name)) fail("charx.duplicate_entry", name);
    if (name.endsWith("/")) continue;
    if (method !== 0 && method !== 8)
      fail("charx.unsupported_compression", `${name}: method ${method}`);
    if (size > lim.maxEntryBytes) fail("charx.entry_too_large", name);
    if (method === 8 && size > Math.max(1024, compressedSize * lim.maxRatio))
      fail("charx.zip_bomb", name);
    if (method === 0 && size !== compressedSize)
      fail("charx.corrupt", `${name}: stored size mismatch`);
    total += size;
    if (total > lim.maxTotalBytes) fail("charx.too_large", "total uncompressed size exceeds limit");
    entries.set(name, { name, method, crc, compressedSize, size, localHeaderOffset });
  }

  return {
    entries,
    read(name: string): Uint8Array | null {
      const e = entries.get(name);
      return e ? extract(bytes, e) : null;
    },
  };
}

function extract(bytes: Uint8Array, e: ZipEntry): Uint8Array {
  const o = e.localHeaderOffset;
  if (o + 30 > bytes.length || readU32LE(bytes, o) !== LOCAL_SIG)
    fail("charx.corrupt", `${e.name}: bad local header`);
  const start = o + 30 + readU16LE(bytes, o + 26) + readU16LE(bytes, o + 28);
  const end = start + e.compressedSize;
  if (end > bytes.length) fail("charx.corrupt", `${e.name}: data out of range`);
  const src = bytes.subarray(start, end);
  const out = e.method === 0 ? src.slice() : inflateBounded(src, e);
  if (out.length !== e.size) fail("charx.corrupt", `${e.name}: size mismatch`);
  if (crc32(out) !== e.crc) fail("charx.bad_crc", e.name);
  return out;
}

/** 分段解压；输出一旦超过声明的大小就中止，避免被压缩炸弹拖垮内存和 CPU。 */
function inflateBounded(src: Uint8Array, e: ZipEntry): Uint8Array {
  const out = new Uint8Array(e.size);
  let written = 0;
  let finished = false;
  const inflater = new Inflate((chunk, final) => {
    if (written + chunk.length > e.size)
      fail("charx.zip_bomb", `${e.name}: output exceeds declared size`);
    out.set(chunk, written);
    written += chunk.length;
    if (final) finished = true;
  });
  try {
    for (let i = 0; i < src.length; i += INFLATE_STEP) {
      const end = Math.min(i + INFLATE_STEP, src.length);
      inflater.push(src.subarray(i, end), end === src.length);
    }
    if (src.length === 0) inflater.push(new Uint8Array(0), true);
  } catch (err) {
    if (err instanceof CharError) throw err;
    fail("charx.corrupt", `${e.name}: invalid deflate stream`);
  }
  if (!finished) fail("charx.corrupt", `${e.name}: truncated deflate stream`);
  return out.subarray(0, written);
}
