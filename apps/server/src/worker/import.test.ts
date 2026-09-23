import { describe, expect, it } from "vitest";
import { importErrorCode, sniffContainer } from "./import.js";

describe("import container detection", () => {
  it("recognises PNG, ZIP and JSON by their first bytes", () => {
    expect(sniffContainer(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      "png",
    );
    expect(sniffContainer(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))).toBe("charx");
    expect(sniffContainer(new TextEncoder().encode('  \n{"spec":1}'))).toBe("json");
    expect(sniffContainer(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b]))).toBe("json");
    expect(sniffContainer(new TextEncoder().encode("[1]"))).toBeNull();
    expect(sniffContainer(new Uint8Array())).toBeNull();
  });
});

describe("import error codes", () => {
  it.each([
    ["ccv3.unrecognized_format", "import.unsupported_format"],
    ["charx.encrypted", "import.unsupported_format"],
    ["charx.zip_bomb", "import.too_large"],
    ["png.too_many_chunks", "import.too_large"],
    ["ccv3.invalid_card", "import.parse_failed"],
    ["ccv3.no_card_data", "import.parse_failed"],
    ["something.new", "import.parse_failed"],
  ])("%s → %s", (parser, code) => {
    expect(importErrorCode(parser)).toBe(code);
  });
});
