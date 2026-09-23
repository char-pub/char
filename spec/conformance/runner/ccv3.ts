/**
 * CCv3 往返用例的运行与比较。纯函数，可以在 Node、浏览器和 workerd 中运行。
 *
 * 流程：导入卡片 → canonicalize → Resolver 生成 IR → 导出 CCv3。比较的是 `summarizeLoss()`
 * 保留下来的部分，它们只取决于卡片内容和映射规则：
 *
 * - 导入：被省略的策略字段（只有字段名，不含原值）、每个 lorebook 条目的源 ID / 派生的
 *   fragment ID / 激活方式、导入后标记为不稳定的 fragment；
 * - 导出的 Loss Report：被展平的依赖（不含 token 数）、被降级的激活、private 可见性、
 *   多余的参与者、context 资源、被丢弃的 locale、策略字段是否恢复、其他损失（只保留 subject）；
 * - 导出的卡片：`system_prompt` 与 `post_history_instructions` 是否为空。
 *
 * 不比较 token 估算、说明文字（detail）和卡片正文：前者依赖估算算法，后两者是展示用的文本。
 */
import { type ExportResult, exportCCv3, type ImportResult, importCard } from "@char-pub/ccv3";
import { canonicalizeCreation, compareStrings, type JSONValue, jcs, resolve } from "@char-pub/core";
import type { LossSummary } from "./types.js";

/** 往返时使用的固定 ID，保证输出与运行环境无关。 */
export const ROUNDTRIP_IDS = {
  creation: "cr_01h455vb4pex5vsknk084sn0cc",
  release: "rel_01h455vb4pex5vsknk084sn0cc",
  ref: "@conformance/imported",
} as const;

const bySubject = (a: { subject: string }, b: { subject: string }) =>
  compareStrings(a.subject, b.subject);

export function summarizeLoss(
  imported: ImportResult,
  unstable: string[],
  exported: ExportResult,
): LossSummary {
  const r = imported.report;
  const l = exported.loss;
  return {
    import: {
      omitted_policy_fields: r.omitted_policy_fields.map((f) => f.field).sort(compareStrings),
      lorebook: r.lorebook.map((e) => ({
        index: e.index,
        source_id: e.source_id ?? null,
        fragment_id: e.fragment_id ?? null,
        activation: e.activation,
      })),
      unstable_fragments: [...unstable].sort(compareStrings),
    },
    loss: {
      flattened_dependencies: l.flattened_dependencies
        .map((d) => ({ ref: d.ref, fragments: [...d.fragments], into: [...d.into] }))
        .sort((a, b) => compareStrings(a.ref, b.ref)),
      activation_downgrades: [...l.activation_downgrades]
        .sort(bySubject)
        .map((d) => ({ subject: d.subject, from: d.from, to: d.to })),
      visibility: l.visibility.map((v) => v.subject).sort(compareStrings),
      participants: l.participants.map((v) => v.subject).sort(compareStrings),
      context_assets: l.context_assets.map((v) => v.subject).sort(compareStrings),
      locales: {
        dropped: [...l.locales.dropped].sort(compareStrings),
        exported: l.locales.exported,
      },
      policy_fields: l.policy_fields
        .map((p) => ({
          ref: p.ref,
          fields: [...p.fields].sort(compareStrings),
          restored: p.restored,
        }))
        .sort((a, b) => compareStrings(a.ref, b.ref)),
      other: l.other.map((v) => v.subject).sort(compareStrings),
    },
    export: {
      system_prompt_empty: (exported.card.data.system_prompt ?? "") === "",
      post_history_instructions_empty: (exported.card.data.post_history_instructions ?? "") === "",
    },
  };
}

export function runRoundTrip(card: unknown): LossSummary {
  const imported = importCard(card as object, {
    ids: { creation: ROUNDTRIP_IDS.creation },
    ref: ROUNDTRIP_IDS.ref,
  });
  const { creation } = canonicalizeCreation(imported.creation);
  const unstable = creation.fragments.filter((f) => !f.stable).map((f) => f.id);
  const ir = resolve({
    root: { release: ROUNDTRIP_IDS.release, visibility: "public", creation },
  }).ir;
  return summarizeLoss(imported, unstable, exportCCv3(ir));
}

/** 两份摘要按 JCS 比较；不同时返回 null 以外的说明。 */
export function compareLoss(expected: LossSummary, actual: LossSummary): string | null {
  const a = jcs(expected as unknown as JSONValue);
  const b = jcs(actual as unknown as JSONValue);
  return a === b ? null : `loss summary differs: expected ${a} got ${b}`;
}
