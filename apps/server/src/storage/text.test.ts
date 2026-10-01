import { MAX_SOURCE_BYTES } from "@char-pub/core";
import { describe, expect, it } from "vitest";
import { decodeSourceBytes } from "./text.js";

describe("lossless reference text decoding", () => {
  it("keeps BOM and CRLF bytes representable for digest revalidation", () => {
    const input = new TextEncoder().encode("\uFEFF# 目录\r\n正文\r\n");
    expect(new TextEncoder().encode(decodeSourceBytes(input))).toEqual(input);
  });
  it.each([
    [0xc3, 0x28],
    [0xed, 0xa0, 0x80],
    [0xc0, 0x80],
    [0xf4, 0x90, 0x80, 0x80],
  ])("rejects invalid Unicode sequences %#", (...bytes) => {
    expect(() => decodeSourceBytes(new Uint8Array(bytes))).toThrowError(
      expect.objectContaining({ code: "source.invalid_utf8" }),
    );
  });
  it("checks byte limits before decoding", () => {
    expect(() => decodeSourceBytes(new Uint8Array(MAX_SOURCE_BYTES + 1))).toThrowError(
      expect.objectContaining({ code: "source.too_large" }),
    );
  });
});
