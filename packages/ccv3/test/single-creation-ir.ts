/**
 * 测试辅助：用 core 的 Resolver 把一个没有依赖的 Creation 解析成 Context IR，
 * 供导出与往返测试使用。
 */
import { type ContextIR, finalizeIrText, resolve } from "@char-pub/core";

const TEST_RELEASE = "rel_01h455vb4pex5vsknk084sn0zz";

export function singleCreationIR(creation: unknown): ContextIR {
  return resolve({ root: { release: TEST_RELEASE, visibility: "public", creation } }).ir;
}

/** 导出器最终写进卡片的文本应当等于 IR 文本去掉转义后的结果。 */
export function irPlainText(text: string): string {
  return finalizeIrText(text, (k) => (k === "user" ? "{{user}}" : k));
}
