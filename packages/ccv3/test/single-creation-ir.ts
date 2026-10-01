/**
 * 测试辅助：用 core 的 Resolver 把一个没有依赖的 Creation 解析成 Context IR，
 * 供导出与往返测试使用。
 */
import {
  type ContextIR,
  CreationArtifactSchema,
  canonicalizeCreation,
  deriveCapabilities,
  finalizeIrText,
  PRESET_REGIONS,
  resolve,
  resolvePreset,
} from "@char-pub/core";

const TEST_RELEASE = "rel_01h455vb4pex5vsknk084sn0zz";

export function singleCreationIR(creation: unknown): ContextIR {
  return resolve({ root: { release: TEST_RELEASE, visibility: "public", creation } }).ir;
}

/** Schema-checked envelope for deliberately synthetic IR mapping fixtures, with an explicit policy. */
export function artifactOfIR(ir: ContextIR) {
  const policy = canonicalizeCreation({
    id: "cr_01h455vb4pex5vsknk084sn0pd",
    ref: "@fixture/card-policy",
    type: "preset",
    display_name: "Card policy",
    policy: {
      version: "1-draft",
      blocks: [],
      layout: [...PRESET_REGIONS],
      requires: { system_role: true },
    },
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
  });
  const artifact = CreationArtifactSchema.parse({
    capabilities: [],
    version: "1-draft",
    kind: "content",
    root: ir.root,
    ir,
    lock: [],
    lock_digest: ir.lock_digest,
    meta: ir.meta,
    assets: ir.assets,
    catalog_index: { works: [], groups: [], sources: [] },
    default_policy: resolvePreset({
      creation: policy.json,
      release: "rel_01h455vb4pex5vsknk084sn0pd",
      semantic_digest: policy.semantic_digest,
    }),
  });
  artifact.capabilities = deriveCapabilities(artifact);
  return artifact;
}

/** 导出器最终写进卡片的文本应当等于 IR 文本去掉转义后的结果。 */
export function irPlainText(text: string): string {
  return finalizeIrText(text, (k) => (k === "user" ? "{{user}}" : k));
}
