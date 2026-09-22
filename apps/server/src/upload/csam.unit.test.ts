import { describe, expect, it } from "vitest";
import { type CsamScanner, decideUpload, noopScanner } from "./csam.js";
import type { ProcessedImage } from "./image.js";

const IMG: ProcessedImage = {
  source_type: "png",
  width: 1,
  height: 1,
  webp: new Uint8Array(),
  thumbnail: new Uint8Array(),
};

/** 测试替身：按字节内容决定扫描结果，模拟一个真实 provider。 */
function fakeScanner(result: "clear" | "match" | "unavailable"): CsamScanner {
  return {
    provider: "fake",
    scan: async () =>
      result === "match"
        ? { status: "match", provider: "fake", match_id: "m-1" }
        : result === "unavailable"
          ? { status: "unavailable", provider: "fake", retry_after_seconds: 5 }
          : { status: "clear", provider: "fake" },
  };
}

describe("CSAM scanning decisions", () => {
  it("noop scanner records 'not scanned' and lets the image through", async () => {
    const scan = await noopScanner.scan(new Uint8Array([1]));
    expect(scan).toEqual({ status: "not_scanned", provider: "none" });
    expect(decideUpload(IMG, scan)).toEqual({
      state: "ready",
      scan_status: "not_scanned",
      provider: "none",
    });
  });

  it("a clear result makes the upload ready", async () => {
    expect(decideUpload(IMG, await fakeScanner("clear").scan(new Uint8Array()))).toMatchObject({
      state: "ready",
      scan_status: "clear",
    });
  });

  it("a match quarantines the upload", async () => {
    expect(decideUpload(IMG, await fakeScanner("match").scan(new Uint8Array()))).toEqual({
      state: "quarantined",
      provider: "fake",
      match_id: "m-1",
      reason: "csam_scan",
    });
  });

  it("an unavailable provider never auto-approves; it retries later", async () => {
    expect(decideUpload(IMG, await fakeScanner("unavailable").scan(new Uint8Array()))).toEqual({
      state: "retry",
      retry_after_seconds: 30,
    });
  });
});
