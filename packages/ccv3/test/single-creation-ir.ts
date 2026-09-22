/**
 * 仅供测试的极简“单个 Creation → Context IR”转换。
 *
 * 临时性：真正的 Resolver 在 core 中实现后，往返测试应改用它，这个文件随之删除。
 * 这里只处理没有依赖的 Creation：不做 binding、params、select、override，也不计算
 * 真正的 lock，只是把 canonical fragment 原样搬进 IR 的形状里，足以驱动导出器。
 */
import {
  type CanonicalCreation,
  type ContextIR,
  canonicalizeCreation,
  digestJson,
  escapeTemplateText,
  type FragmentContent,
  finalizeIrText,
  type IRContent,
  type IRFragment,
  irFragmentDigest,
  irFragmentId,
  type LocalizedText,
  parseTemplate,
} from "@char-pub/core";

/**
 * 按 Resolver 的约定转换模板：`{{self}}` 是 early 绑定，直接替换成角色名；`{{user}}` 是 late
 * binding，写成 `{{late:user}}`；字面量里的 `{{` 保持转义。
 */
function toIrText(text: string, selfName: string): string {
  let out = "";
  for (const t of parseTemplate(text)) {
    if (t.t === "text") out += escapeTemplateText(t.v);
    else if (t.t === "self") out += escapeTemplateText(selfName);
    else if (t.t === "user") out += "{{late:user}}";
    else throw new Error(`unsupported placeholder in test helper: ${t.t}`);
  }
  return out;
}

function content(c: FragmentContent, selfName: string): IRContent {
  switch (c.type) {
    case "text":
      return { type: "text", text: toIrText(c.text, selfName), format: c.format ?? "markdown" };
    case "dialogue":
      return {
        type: "dialogue",
        turns: c.turns.map((t) => ({
          speaker: t.speaker === "{{user}}" ? "participant:user" : "participant:self",
          text: toIrText(t.text, selfName),
        })),
      };
    case "media":
      return c.caption === undefined
        ? { type: "media", asset: c.asset }
        : { type: "media", asset: c.asset, caption: c.caption };
    case "structured":
      return { type: "structured", schema: c.schema, data: c.data };
  }
}

function plain(v: LocalizedText, locale: string): string {
  return typeof v === "string" ? v : (v[locale] ?? Object.values(v)[0] ?? "");
}

export function singleCreationIR(
  input: unknown,
  release = "rel_01h455vb4pex5vsknk084sn001",
): ContextIR {
  const { creation, semantic_digest } = canonicalizeCreation(input);
  const c: CanonicalCreation = creation;
  const locale = c.meta.default_locale;
  const selfName = plain(c.display_name, locale);
  const fragments: IRFragment[] = c.fragments.map((f) => {
    const sem = {
      kind: f.kind,
      content: content(f.content, selfName),
      activation: f.activation ?? { mode: "always" as const },
      visibility: { scope: "shared" as const },
      importance: f.importance ?? ("normal" as const),
      placement_hint: f.placement_hint ?? f.kind,
    };
    return {
      id: irFragmentId(c.ref, f.id, "root"),
      ...sem,
      origin: {
        creation: c.ref,
        release,
        fragment: f.id,
        via: [],
        instance_key: "root",
        stable: f.stable,
      },
      digest: irFragmentDigest(sem),
    };
  });
  const omitted = c.provenance.imported_from?.omitted_policy_fields ?? [];
  return {
    ir_version: "0-draft",
    root: { ref: c.ref, release, semantic_digest },
    lock_digest: digestJson([]),
    resolver: { name: "test-single-creation", version: "0" },
    meta: {
      default_locale: locale,
      available_locales: [locale],
      rating: c.meta.rating,
      rating_sources: [{ ref: c.ref, rating: c.meta.rating }],
      content_warnings: c.meta.content_warnings ?? [],
      licenses: [{ ref: c.ref, license: c.meta.license }],
      attribution: [{ ref: c.ref, authors: c.authors ?? [] }],
      contributors: [],
      import_omissions: omitted.length > 0 ? [{ ref: c.ref, fields: omitted }] : [],
      au: false,
      recommended_presets: [],
    },
    participants: [{ key: "self", ref: c.ref, display_name: c.display_name, kind: "character" }],
    late_slots: [{ key: "user", accepts: ["persona"], required: true, used_by: [] }],
    fragments,
    bootstrap: {
      greetings: (c.bootstrap?.greetings ?? []).map((g) => ({
        id: g.id,
        speaker: "self",
        text: toIrText(g.text, selfName),
      })),
    },
    assets: [],
    graph: {
      nodes: [{ ref: c.ref, release, type: c.type, display_name: plain(c.display_name, locale) }],
      instances: [{ key: "root", ref: c.ref, via: [] }],
      edges: [],
      removed: [],
    },
    diagnostics: [],
  };
}

/** 导出器最终写进卡片的文本应当等于 IR 文本去掉转义后的结果。 */
export function irPlainText(text: string): string {
  return finalizeIrText(text, (k) => (k === "user" ? "{{user}}" : k));
}
