/**
 * 上传图片处理的测试。恶意样本在运行时生成，不提交二进制文件：
 * 带 GPS 的 JPEG、PNG 后面拼 ZIP / HTML 的 polyglot、SVG、像素炸弹、动图、截断文件、
 * 伪造文件头。
 */
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { formatEnd, ImageRejected, processImage, sniffImageType } from "./image.js";

async function solid(format: "png" | "jpeg" | "webp" | "gif", w = 64, h = 48): Promise<Uint8Array> {
  const img = sharp({
    create: { width: w, height: h, channels: 3, background: { r: 200, g: 40, b: 90 } },
  });
  const out =
    format === "gif"
      ? img.gif()
      : format === "png"
        ? img.png()
        : format === "jpeg"
          ? img.jpeg()
          : img.webp();
  return new Uint8Array(await out.toBuffer());
}

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return e instanceof ImageRejected ? e.code : `other:${String(e)}`;
  }
  return undefined;
}

describe("type sniffing", () => {
  it.each(["png", "jpeg", "webp", "gif"] as const)("detects %s by its header", async (f) => {
    expect(sniffImageType(await solid(f))).toBe(f);
  });

  it("does not recognise SVG, HTML or empty input", () => {
    const enc = new TextEncoder();
    expect(sniffImageType(enc.encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImageType(enc.encode("<html><script>alert(1)</script>"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("processing", () => {
  it.each(["png", "jpeg", "webp", "gif"] as const)(
    "re-encodes %s to webp with a thumbnail",
    async (f) => {
      const out = await processImage(await solid(f));
      expect(out.source_type).toBe(f);
      expect(sniffImageType(out.webp)).toBe("webp");
      expect(sniffImageType(out.thumbnail)).toBe("webp");
      expect([out.width, out.height]).toEqual([64, 48]);
      const t = await sharp(out.thumbnail).metadata();
      expect([t.width, t.height]).toEqual([256, 256]);
    },
  );

  it("strips EXIF including GPS, and applies the orientation", async () => {
    const withGps = await sharp({
      create: { width: 40, height: 20, channels: 3, background: "#fff" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExifMerge({
        IFD0: { Make: "TestCam" },
        IFD3: {
          GPSLatitudeRef: "N",
          GPSLatitude: "35/1 41/1 0/1",
          GPSLongitudeRef: "E",
          GPSLongitude: "139/1 41/1 0/1",
        },
      })
      .toBuffer();
    const before = await sharp(withGps).metadata();
    expect(before.exif).toBeDefined();
    expect(before.orientation).toBe(6);
    expect(Buffer.from(withGps).includes(Buffer.from("TestCam"))).toBe(true);
    const out = await processImage(new Uint8Array(withGps));
    const after = await sharp(out.webp).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    // Orientation 6 表示需要顺时针旋转 90 度：宽高互换。
    expect([out.width, out.height]).toEqual([20, 40]);
    expect(Buffer.from(out.webp).includes(Buffer.from("TestCam"))).toBe(false);
  });

  it("downscales large images to the maximum edge", async () => {
    const out = await processImage(await solid("png", 3000, 1500));
    expect([out.width, out.height]).toEqual([2048, 1024]);
  });
});

describe("rejections", () => {
  it("rejects SVG and unknown types", async () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect(await codeOf(processImage(svg))).toBe("upload.unsupported_type");
  });

  it("rejects polyglots: data appended after the image", async () => {
    const png = await solid("png");
    const zip = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
    ]);
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    for (const tail of [zip, html]) {
      const poly = new Uint8Array(png.length + tail.length);
      poly.set(png);
      poly.set(tail, png.length);
      expect(await codeOf(processImage(poly))).toBe("upload.trailing_data");
    }
    const jpeg = await solid("jpeg");
    const jpoly = new Uint8Array(jpeg.length + html.length);
    jpoly.set(jpeg);
    jpoly.set(html, jpeg.length);
    // JPEG 从最后一个 EOI 判断，末尾的 HTML 不含 EOI，所以能被发现。
    expect(await codeOf(processImage(jpoly))).toBe("upload.trailing_data");
  });

  it("allows a few zero padding bytes", async () => {
    const png = await solid("png");
    const padded = new Uint8Array(png.length + 4);
    padded.set(png);
    expect((await processImage(padded)).source_type).toBe("png");
  });

  it("rejects pixel bombs before decoding them fully", async () => {
    // 一张 10000×10000 的纯色 PNG 只有几十 KB，但解码需要 300 MB 内存。
    const bomb = await sharp({
      create: { width: 10000, height: 10000, channels: 3, background: "#000" },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.byteLength).toBeLessThan(2 * 1024 * 1024);
    expect(await codeOf(processImage(new Uint8Array(bomb)))).toBe("upload.too_many_pixels");
  });

  it("rejects oversized files", async () => {
    expect(await codeOf(processImage(await solid("png"), { maxBytes: 10 }))).toBe(
      "upload.too_large",
    );
  });

  it("rejects animations", async () => {
    // 8×16 的原始像素按 pageHeight 8 切成两帧，得到一个两帧的 GIF 动图。
    const raw = Buffer.alloc(8 * 16 * 3, 0).fill(255, 8 * 8 * 3);
    const animated = await sharp(raw, { raw: { width: 8, height: 16, channels: 3, pageHeight: 8 } })
      .gif({ loop: 0 })
      .toBuffer();
    expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(2);
    expect(await codeOf(processImage(new Uint8Array(animated)))).toBe(
      "upload.animated_not_supported",
    );
  });

  it("rejects truncated and forged files", async () => {
    const png = await solid("png");
    expect(await codeOf(processImage(png.subarray(0, 40)))).toMatch(
      /upload\.(decode_failed|trailing_data)/,
    );
    const forged = new Uint8Array(64);
    forged.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await codeOf(processImage(forged))).toBe("upload.decode_failed");
    // 文件头是 GIF，内容是 PNG：解码器识别的格式与文件头不一致。
    const mixed = new Uint8Array(png);
    mixed.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(await codeOf(processImage(mixed))).toMatch(
      /upload\.(type_mismatch|decode_failed|trailing_data)/,
    );
  });

  it("computes format ends", async () => {
    const png = await solid("png");
    expect(formatEnd(png, "png")).toBe(png.length);
    const webp = await solid("webp");
    expect(formatEnd(webp, "webp")).toBe(webp.length);
    const gif = await solid("gif");
    expect(formatEnd(gif, "gif")).toBe(gif.length);
    expect(formatEnd(new Uint8Array([0x47, 0x49, 0x46, 0x00]), "gif")).toBeNull();
    expect(formatEnd(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), "jpeg")).toBeNull();
    expect(formatEnd(png.subarray(0, 20), "png")).toBeNull();
  });
});

describe("edge cases", () => {
  it("reports too many pixels from the header before decoding", async () => {
    const png = await solid("png", 100, 100);
    expect(await codeOf(processImage(png, { maxPixels: 5000 }))).toBe("upload.too_many_pixels");
    expect(await codeOf(processImage(png, { maxPixels: 10_000 }))).toBeUndefined();
  });

  it("reports decode failures during re-encoding", async () => {
    // 文件头与 IEND 都正确，但像素数据损坏：元数据可以读出，重新编码时失败。
    const png = await solid("png", 32, 32);
    const broken = new Uint8Array(png);
    const idat = Buffer.from(broken).indexOf(Buffer.from("IDAT"));
    for (let i = idat + 4; i < idat + 24; i++) broken[i] = 0x00;
    expect(await codeOf(processImage(broken))).toBe("upload.decode_failed");
  });

  it("handles a webp header without a size field", () => {
    expect(formatEnd(new Uint8Array([0x52, 0x49, 0x46, 0x46]), "webp")).toBe(8);
  });
});
