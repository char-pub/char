/**
 * 真实输入触发不到的防御性检查：libvips 按文件内容选择解码器，所以对支持的四种格式，
 * 文件头识别的类型与解码器报告的格式总是一致。这里把 sharp 换成替身，确认解码器一旦
 * 报告了别的格式（例如以后的 libvips 改变了解码器优先级），图片仍然会被拒绝。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("sharp", () => ({
  default: () => ({ metadata: async () => ({ format: "svg", width: 1, height: 1, pages: 1 }) }),
}));

const { ImageRejected, processImage } = await import("./image.js");

describe("header and decoder disagree", () => {
  it("rejects the file as a type mismatch", async () => {
    // PNG 文件头后面没有完整的 chunk：找不到格式结尾，末尾数据检查交给解码器。
    const input = new Uint8Array(64);
    input.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const err = await processImage(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImageRejected);
    expect((err as InstanceType<typeof ImageRejected>).code).toBe("upload.type_mismatch");
  });
});
