import { isCharError } from "@char-pub/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sniffImageType } from "../src/assets.js";
import {
  base64Decode,
  base64Encode,
  crc32,
  latin1Decode,
  latin1Encode,
  utf8Decode,
  utf8Encode,
} from "../src/bytes.js";
import { isSafeZipPath, openZip } from "../src/charx.js";
import {
  decodeTextChunk,
  encodePngChunk,
  encodeTextChunk,
  readPngChunks,
  readPngTextEntries,
  replacePngText,
  stripPngMetadata,
  writePngChunks,
} from "../src/png.js";
import { cardTextToTemplate } from "../src/text.js";
import { charx, tinyPng } from "./helpers.js";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return isCharError(e) ? e.code : `non-char:${String(e)}`;
  }
  return undefined;
}

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(utf8Encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("can be computed incrementally", () => {
    const a = utf8Encode("hello ");
    const b = utf8Encode("world");
    expect(crc32(b, crc32(a))).toBe(crc32(utf8Encode("hello world")));
  });
});

describe("base64", () => {
  it("round-trips arbitrary bytes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (b) => {
        expect(base64Decode(base64Encode(b), "t")).toEqual(b);
      }),
    );
  });

  it("matches known vectors", () => {
    expect(base64Encode(utf8Encode("foobar"))).toBe("Zm9vYmFy");
    expect(base64Encode(utf8Encode("fo"))).toBe("Zm8=");
    expect(base64Encode(utf8Encode("f"))).toBe("Zg==");
  });

  it("ignores whitespace and accepts missing padding", () => {
    expect(utf8Decode(base64Decode("Zm9v\nYmFy", "t"), "t")).toBe("foobar");
    expect(utf8Decode(base64Decode("Zm8", "t"), "t")).toBe("fo");
  });

  it("rejects invalid characters and impossible lengths", () => {
    expect(codeOf(() => base64Decode("Zm9v!", "t"))).toBe("ccv3.invalid_base64");
    expect(codeOf(() => base64Decode("Z", "t"))).toBe("ccv3.invalid_base64");
    expect(codeOf(() => base64Decode("Zm8==", "t"))).toBe("ccv3.invalid_base64");
    expect(codeOf(() => base64Decode("Zm9v中", "t"))).toBe("ccv3.invalid_base64");
  });
});

describe("text encodings", () => {
  it("rejects invalid UTF-8 instead of replacing it", () => {
    expect(codeOf(() => utf8Decode(new Uint8Array([0xc3, 0x28]), "t"))).toBe("ccv3.invalid_utf8");
    expect(codeOf(() => utf8Decode(new Uint8Array([0xff]), "t"))).toBe("ccv3.invalid_utf8");
    expect(utf8Decode(utf8Encode("灯塔 🌊"), "t")).toBe("灯塔 🌊");
  });

  it("latin-1 round-trips and rejects wide characters", () => {
    const s = "abc\u00e9\u00ff";
    expect(latin1Decode(latin1Encode(s))).toBe(s);
    expect(codeOf(() => latin1Encode("中"))).toBe("png.bad_text_chunk");
    expect(latin1Decode(new Uint8Array(20000).fill(0x41))).toHaveLength(20000);
  });
});

describe("png chunks", () => {
  it("reads a valid PNG", () => {
    const chunks = readPngChunks(tinyPng());
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
  });

  it("round-trips text chunks", () => {
    const png = tinyPng([encodeTextChunk("ccv3", "abc"), encodeTextChunk("Comment", "x")]);
    expect(readPngTextEntries(readPngChunks(png))).toEqual([
      { keyword: "ccv3", text: "abc" },
      { keyword: "Comment", text: "x" },
    ]);
  });

  it("rejects a bad signature", () => {
    const png = tinyPng();
    png[1] = 0;
    expect(codeOf(() => readPngChunks(png))).toBe("png.bad_signature");
  });

  it("rejects a bad CRC", () => {
    const png = tinyPng();
    const last = png.length - 1;
    png[last] = (png[last] ?? 0) ^ 0xff;
    expect(codeOf(() => readPngChunks(png))).toBe("png.bad_crc");
  });

  it("rejects truncated files and missing IEND", () => {
    const png = tinyPng();
    expect(codeOf(() => readPngChunks(png.subarray(0, png.length - 5)))).toBe("png.truncated");
    expect(codeOf(() => readPngChunks(png.subarray(0, png.length - 12)))).toBe("png.truncated");
    expect(codeOf(() => readPngChunks(png.subarray(0, 8)))).toBe("png.truncated");
  });

  it("rejects trailing data after IEND", () => {
    const png = tinyPng();
    const withTail = new Uint8Array(png.length + 13);
    withTail.set(png);
    withTail.set(
      encodePngChunk("tEXt", new Uint8Array([0x61, 0, 0x62])).subarray(0, 13),
      png.length,
    );
    expect(codeOf(() => readPngChunks(withTail))).toBe("png.trailing_data");
  });

  it("enforces size limits", () => {
    const png = tinyPng([encodeTextChunk("big", "x".repeat(5000))]);
    expect(codeOf(() => readPngChunks(png, { maxChunkBytes: 1000 }))).toBe("png.chunk_too_large");
    expect(codeOf(() => readPngChunks(png, { maxFileBytes: 1000 }))).toBe("png.too_large");
    expect(codeOf(() => readPngChunks(png, { maxChunks: 2 }))).toBe("png.too_many_chunks");
  });

  it("rejects a chunk length that points past the end", () => {
    const png = tinyPng();
    // IHDR 的长度字段在签名后面
    png[8] = 0x7f;
    expect(codeOf(() => readPngChunks(png))).toBe("png.chunk_too_large");
    png[8] = 0x00;
    png[9] = 0x01;
    expect(codeOf(() => readPngChunks(png))).toBe("png.truncated");
    png[8] = 0xff;
    expect(codeOf(() => readPngChunks(png))).toBe("png.bad_chunk_length");
  });

  it("requires IHDR first and letter-only chunk types", () => {
    const noIhdr = writePngChunks([
      { type: "IDAT", data: new Uint8Array(1) },
      { type: "IEND", data: new Uint8Array(0) },
    ]);
    expect(codeOf(() => readPngChunks(noIhdr))).toBe("png.missing_ihdr");
    expect(codeOf(() => encodePngChunk("ab1c", new Uint8Array(0)))).toBe("png.bad_chunk_type");
    const png = tinyPng();
    png[12] = 0x31;
    expect(codeOf(() => readPngChunks(png))).toBe("png.bad_chunk_type");
  });

  it("validates tEXt keywords", () => {
    expect(decodeTextChunk(new Uint8Array([0, 0x61]))).toBeNull();
    expect(decodeTextChunk(new Uint8Array([0x61, 0x62]))).toBeNull();
    expect(codeOf(() => encodeTextChunk("", "x"))).toBe("png.bad_text_chunk");
    expect(codeOf(() => encodeTextChunk("k", "a\0b"))).toBe("png.bad_text_chunk");
    expect(codeOf(() => encodeTextChunk("k".repeat(80), "x"))).toBe("png.bad_text_chunk");
  });

  it("replaces card chunks before IEND and keeps other chunks", () => {
    const png = tinyPng([encodeTextChunk("ccv3", "old"), encodeTextChunk("Software", "x")]);
    const out = replacePngText(png, [{ keyword: "ccv3", text: "new" }], ["ccv3", "chara"]);
    const chunks = readPngChunks(out);
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "tEXt", "IDAT", "tEXt", "IEND"]);
    expect(readPngTextEntries(chunks)).toEqual([
      { keyword: "Software", text: "x" },
      { keyword: "ccv3", text: "new" },
    ]);
  });

  it("strips metadata chunks", () => {
    const png = tinyPng([
      encodeTextChunk("ccv3", "secret"),
      { type: "eXIf", data: new Uint8Array([1, 2, 3]) },
      { type: "tIME", data: new Uint8Array(7) },
    ]);
    expect(readPngChunks(stripPngMetadata(png)).map((c) => c.type)).toEqual([
      "IHDR",
      "IDAT",
      "IEND",
    ]);
  });

  it("never throws anything but CharError on mutated input (fuzz)", () => {
    const base = tinyPng([encodeTextChunk("ccv3", "e30=")]);
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.nat(base.length - 1), fc.integer({ min: 0, max: 255 })), {
          maxLength: 8,
        }),
        fc.nat(base.length),
        (edits, cut) => {
          const b = base.slice(0, Math.max(cut, 8));
          for (const [i, v] of edits) if (i < b.length) b[i] = v;
          try {
            readPngChunks(b);
          } catch (e) {
            expect(isCharError(e)).toBe(true);
          }
        },
      ),
    );
  });
});

describe("charx (zip)", () => {
  it("reads stored and deflated entries", () => {
    for (const level of [0, 6] as const) {
      const zip = openZip(
        charx({ "card.json": "{}", "assets/icon/images/a.png": tinyPng() }, level),
      );
      expect(zip.entries.size).toBe(2);
      expect(utf8Decode(zip.read("card.json") ?? new Uint8Array(0), "t")).toBe("{}");
      expect(zip.read("missing.json")).toBeNull();
    }
  });

  it("classifies unsafe paths", () => {
    for (const p of ["../x", "a/../b", "/abs", "C:/x", "a\\b", "a//b", "./a", "a\u0001b", ""]) {
      expect(isSafeZipPath(p)).toBe(false);
    }
    for (const p of ["card.json", "assets/icon/images/main.png", "dir/"]) {
      expect(isSafeZipPath(p)).toBe(true);
    }
  });

  it("rejects path traversal", () => {
    expect(codeOf(() => openZip(charx({ "../evil.json": "{}" })))).toBe("charx.unsafe_path");
  });

  it("rejects too many entries and oversized archives", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 10; i++) files[`f${i}.txt`] = "x";
    expect(codeOf(() => openZip(charx(files), { maxEntries: 5 }))).toBe("charx.too_many_entries");
    expect(codeOf(() => openZip(charx(files), { maxArchiveBytes: 100 }))).toBe("charx.too_large");
  });

  it("rejects zip bombs by ratio and by declared size", () => {
    const bomb = charx({ "card.json": "0".repeat(2_000_000) });
    expect(codeOf(() => openZip(bomb))).toBe("charx.zip_bomb");
    expect(codeOf(() => openZip(bomb, { maxEntryBytes: 1000 }))).toBe("charx.entry_too_large");
    expect(codeOf(() => openZip(bomb, { maxRatio: 100_000, maxTotalBytes: 1000 }))).toBe(
      "charx.too_large",
    );
  });

  it("stops inflating when output exceeds the declared size", () => {
    const zip = charx({ "card.json": "a".repeat(5000) });
    // 把中央目录里声明的解压大小改小，模拟谎报大小的压缩包
    const cd = findCentralEntry(zip);
    writeU32LE(zip, cd + 24, 100);
    expect(codeOf(() => openZip(zip).read("card.json"))).toBe("charx.zip_bomb");
  });

  it("detects CRC mismatch and corrupt data", () => {
    const zip = charx({ "card.json": "hello world" }, 0);
    const cd = findCentralEntry(zip);
    writeU32LE(zip, cd + 16, 1234);
    expect(codeOf(() => openZip(zip).read("card.json"))).toBe("charx.bad_crc");

    const deflated = charx({ "card.json": "hello hello hello hello" });
    const cd2 = findCentralEntry(deflated);
    const localOffset = readLE32(deflated, cd2 + 42);
    const nameLen = (deflated[localOffset + 26] ?? 0) | ((deflated[localOffset + 27] ?? 0) << 8);
    const dataStart = localOffset + 30 + nameLen;
    deflated[dataStart] = 0xff;
    expect(codeOf(() => openZip(deflated).read("card.json"))).toMatch(/^charx\./);
  });

  it("rejects encrypted entries and garbage", () => {
    const zip = charx({ "card.json": "{}" });
    const cd = findCentralEntry(zip);
    zip[cd + 8] = (zip[cd + 8] ?? 0) | 1;
    expect(codeOf(() => openZip(zip))).toBe("charx.encrypted");
    expect(codeOf(() => openZip(new Uint8Array(100)))).toBe("charx.not_zip");
    expect(codeOf(() => openZip(new Uint8Array(5)))).toBe("charx.not_zip");
  });

  it("rejects duplicate names", () => {
    const zip = charx({ "a.json": "{}", "b.json": "{}" });
    // 把第二个条目的名字改成与第一个相同
    const first = findCentralEntry(zip);
    const second = first + 46 + 6;
    zip[second + 46] = 0x61;
    expect(codeOf(() => openZip(zip))).toBe("charx.duplicate_entry");
  });

  it("never throws anything but CharError on mutated zips (fuzz)", () => {
    const base = charx({
      "card.json": '{"spec":"chara_card_v3"}',
      "assets/a.bin": "abc".repeat(50),
    });
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.nat(base.length - 1), fc.integer({ min: 0, max: 255 })), {
          maxLength: 6,
        }),
        (edits) => {
          const b = base.slice();
          for (const [i, v] of edits) b[i] = v;
          try {
            const z = openZip(b);
            for (const name of z.entries.keys()) z.read(name);
          } catch (e) {
            expect(isCharError(e)).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

function readLE32(b: Uint8Array, o: number): number {
  return (
    ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16) | ((b[o + 3] ?? 0) << 24)) >>> 0
  );
}

function writeU32LE(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
  b[o + 2] = (v >>> 16) & 0xff;
  b[o + 3] = (v >>> 24) & 0xff;
}

function findCentralEntry(b: Uint8Array): number {
  for (let i = 0; i + 4 <= b.length; i++) {
    if (readLE32(b, i) === 0x02014b50) return i;
  }
  throw new Error("no central directory entry");
}

describe("image sniffing and card text", () => {
  it("recognizes image types by magic bytes", () => {
    expect(sniffImageType(tinyPng())).toBe("image/png");
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(utf8Encode("GIF89a"))).toBe("image/gif");
    expect(sniffImageType(utf8Encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageType(utf8Encode("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
    expect(sniffImageType(utf8Encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
  });

  it("keeps angle brackets that are not legacy tags", () => {
    const notes: { location: string; placeholder: string }[] = [];
    expect(cardTextToTemplate("a < b <i>x</i> <character> <b", "t", notes)).toBe(
      "a < b <i>x</i> <character> <b",
    );
    expect(cardTextToTemplate("<Char> and <USER>", "t", notes)).toBe("{{self}} and {{user}}");
    expect(notes).toEqual([]);
  });
});
