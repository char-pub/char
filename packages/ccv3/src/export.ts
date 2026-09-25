/**
 * CCv3 导出：Context IR → 角色卡 JSON（可选写入 PNG）+ Loss Report。
 *
 * 导出器相当于一个离线的、有损的 Assembler，固定按 narrator 模式工作：
 * - 根角色（participant `self`）的 character fragment 按 IR 顺序拼进 description；
 *   来自依赖的内容前面加来源小标题。
 * - 其他始终激活的 world / relationship / style / persona / instruction / knowledge 内容也追加到
 *   description；scenario 内容写入 scenario 字段。
 * - keyword 激活的内容写成 character_book 条目。
 * - examples 对话写成 mes_example，每段以 `<START>` 分隔。
 * - greetings 写成 first_mes 与 alternate_greetings。
 * - `{{late:user}}` → `{{user}}`，`participant:self` → `{{char}}`；其他 late slot 和参与者
 *   用它们的显示名或提示文字替换。
 * - 署名与许可写到 creator_notes 末尾，并在 `extensions.char_pub` 里记录 IR 的来源。
 *
 * CCv3 表达不了的东西（私有可见性、多个参与者、semantic / manual 激活、context 资源、
 * 非默认语言、被省略的策略字段）都写进 Loss Report，调用方必须把它展示给用户。
 */
import {
  type ContextIR,
  type EffectiveMeta,
  finalizeIrText,
  type IRContent,
  type IRFragment,
  type Participant,
  RATINGS,
  type ResolvedPreset,
} from "@char-pub/core";
import { base64Encode, utf8Encode } from "./bytes.js";
import type { CCv2Card, CCv3Card, CCv3Data, CCv3LorebookEntry } from "./card.js";
import { replacePngText } from "./png.js";
import { exportPolicyFields } from "./policy.js";

export type TokenEstimator = (text: string) => number;

/** 粗略的 token 估算：CJK 字符按 1 个 token，其余按每 4 个字符 1 个 token。 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (
      (c >= 0x3040 && c <= 0x30ff) ||
      (c >= 0x3400 && c <= 0x9fff) ||
      (c >= 0xac00 && c <= 0xd7af) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0x20000 && c <= 0x2ffff)
    ) {
      cjk++;
    }
  }
  const rest = [...text].length - cjk;
  return cjk + Math.ceil(rest / 4);
}

export interface ExportOptions {
  /** Explicitly selected, integrity-checked policy release. */
  resolvedPreset?: ResolvedPreset;
  /** Aggregated attribution and licenses from the selected policy artifact. */
  presetMeta?: Pick<EffectiveMeta, "licenses" | "attribution"> &
    Partial<Pick<EffectiveMeta, "rating" | "content_warnings">>;
  /** 用户选择的 Preset 里的策略文本；不提供时导出结果不含这两个字段的内容。 */
  preset?: { system_prompt?: string; post_history_instructions?: string };
  /** 头像 PNG；提供时同时返回嵌入了卡片数据的 PNG。 */
  avatarPng?: Uint8Array;
  estimateTokens?: TokenEstimator;
  /** 写入 character_version；缺省为空。 */
  character_version?: string;
  /** 写入 creator；缺省取根 Creation 的第一个作者。 */
  creator?: string;
}

export interface LossItem {
  /** IR 中的对象（fragment ID、participant key、asset ID 或字段名）。 */
  subject: string;
  detail: string;
}

export interface LossReport {
  target: "ccv3";
  profile: { mode: "narrator"; tokenizer: "estimate" };
  /** 依赖的内容被展平进了 description / scenario / character_book。 */
  flattened_dependencies: { ref: string; fragments: string[]; tokens: number; into: string[] }[];
  /** semantic / manual 激活被降级的方式。 */
  activation_downgrades: (LossItem & { from: "semantic" | "manual"; to: "dropped" })[];
  /** private 可见性：CCv3 不能表达，转成 narrator 提示。 */
  visibility: LossItem[];
  /** 根角色以外的参与者：CCv3 只有一个角色，其余降级为 lore 条目或纯文字。 */
  participants: LossItem[];
  /** context 资源：CCv3 不支持放进模型的图片等资源。 */
  context_assets: LossItem[];
  /** 非默认语言的内容：每种语言需要单独导出一份。 */
  locales: { dropped: string[]; exported: string };
  /** 导入时省略、导出时也没有恢复的策略字段。 */
  policy_fields: { ref: string; fields: string[]; restored: boolean }[];
  /** 其他无法表达的内容（importance、placement hint、structured / media 内容等）。 */
  other: LossItem[];
  tokens: {
    description: number;
    scenario: number;
    character_book: number;
    mes_example: number;
    total: number;
  };
}

export interface ExportResult {
  card: CCv3Card;
  /** 同样内容的 V2 卡片，供只支持 V2 的程序读取。 */
  v2: CCv2Card;
  png?: Uint8Array;
  loss: LossReport;
}

const DESCRIPTION_KINDS = new Set([
  "character",
  "world",
  "relationship",
  "style",
  "persona",
  "instruction",
  "knowledge",
]);

const KIND_LABEL: Record<string, string> = {
  character: "Character",
  world: "World",
  relationship: "Relationship",
  style: "Style",
  persona: "Persona",
  instruction: "Notes",
  knowledge: "Knowledge",
  scenario: "Scenario",
  examples: "Examples",
};

function displayText(v: Participant["display_name"], locale: string): string {
  if (typeof v === "string") return v;
  return v[locale] ?? v.en ?? Object.values(v)[0] ?? "";
}

interface Env {
  ir: ContextIR;
  locale: string;
  participants: Map<string, Participant>;
  lateHints: Map<string, string>;
  loss: LossReport;
  lossyParticipants: Set<string>;
}

/** 每个参与者或 late slot 只在 Loss Report 里记录一次（第一次遇到时的原因）。 */
function noteParticipant(env: Env, subject: string, detail: string): void {
  if (env.lossyParticipants.has(subject)) return;
  env.lossyParticipants.add(subject);
  env.loss.participants.push({ subject, detail });
}

/**
 * 把 IR 文本变成卡片文本：`{{late:user}}` 写成 `{{user}}`，其他 late slot 用提示文字替换；
 * IR 中转义过的 `{{{{` 还原成 `{{`，所以导入时保留下来的卡片宏会原样回到卡片里。
 */
function cardText(env: Env, text: string): string {
  return finalizeIrText(text, (key) => {
    if (key === "user") return "{{user}}";
    noteParticipant(env, key, "late slot replaced with its hint text; CCv3 can only bind {{user}}");
    return env.lateHints.get(key) ?? "someone";
  });
}

function speakerText(env: Env, speaker: string): string {
  const key = speaker.startsWith("participant:") ? speaker.slice("participant:".length) : speaker;
  if (key === "self") return "{{char}}";
  if (key === "user") return "{{user}}";
  const p = env.participants.get(key);
  if (p?.late === "user") return "{{user}}";
  const name = p ? displayText(p.display_name, env.locale) : key;
  noteParticipant(env, key, `speaker ${name} written as a plain name; CCv3 has only one character`);
  return name;
}

function contentText(env: Env, c: IRContent, subject: string): string | null {
  switch (c.type) {
    case "text":
      return cardText(env, c.text);
    case "dialogue":
      return c.turns
        .map((t) => `${speakerText(env, t.speaker)}: ${cardText(env, t.text)}`)
        .join("\n");
    case "media":
      env.loss.other.push({
        subject,
        detail: "media content cannot be embedded in a card; caption kept if present",
      });
      return c.caption !== undefined ? cardText(env, c.caption) : null;
    case "structured":
      env.loss.other.push({ subject, detail: `structured content (${c.schema}) dropped` });
      return null;
  }
}

function sourceLabel(f: IRFragment): string {
  return `${KIND_LABEL[f.kind] ?? f.kind} · ${f.origin.creation}#${f.origin.fragment}`;
}

function isRootSelf(f: IRFragment, rootRef: string): boolean {
  return (
    f.origin.via.length === 0 &&
    f.origin.creation === rootRef &&
    (f.subject === undefined || f.subject === "self")
  );
}

export function exportCCv3(ir: ContextIR, opts: ExportOptions = {}): ExportResult {
  const est = opts.estimateTokens ?? estimateTokens;
  const locale = ir.meta.default_locale;
  const rootRef = ir.root.ref;
  const loss: LossReport = {
    target: "ccv3",
    profile: { mode: "narrator", tokenizer: "estimate" },
    flattened_dependencies: [],
    activation_downgrades: [],
    visibility: [],
    participants: [],
    context_assets: [],
    locales: { dropped: [], exported: locale },
    policy_fields: [],
    other: [],
    tokens: { description: 0, scenario: 0, character_book: 0, mes_example: 0, total: 0 },
  };
  const env: Env = {
    ir,
    locale,
    participants: new Map(ir.participants.map((p) => [p.key, p])),
    lateHints: new Map(
      ir.late_slots.filter((s) => s.hint !== undefined).map((s) => [s.key, s.hint as string]),
    ),
    loss,
    lossyParticipants: new Set(),
  };

  const descParts: string[] = [];
  const scenarioParts: string[] = [];
  const exampleParts: string[] = [];
  const entries: CCv3LorebookEntry[] = [];
  const flattened = new Map<string, { fragments: string[]; tokens: number; into: Set<string> }>();
  const droppedLocales = new Set<string>();

  const noteFlatten = (f: IRFragment, into: string, tokens: number) => {
    if (isRootSelf(f, rootRef) || f.origin.creation === rootRef) return;
    const e = flattened.get(f.origin.creation) ?? {
      fragments: [],
      tokens: 0,
      into: new Set<string>(),
    };
    e.fragments.push(f.id);
    e.tokens += tokens;
    e.into.add(into);
    flattened.set(f.origin.creation, e);
  };

  for (const f of ir.fragments) {
    for (const l of Object.keys(f.locales ?? {})) if (l !== locale) droppedLocales.add(l);
    if (f.visibility.scope === "private") {
      loss.visibility.push({
        subject: f.id,
        detail: `private to ${f.visibility.to.join(", ")}; exported with a narrator note, not as a boundary`,
      });
    } else if (f.visibility.scope === "scene") {
      loss.visibility.push({
        subject: f.id,
        detail: `scene-only visibility (${f.visibility.scene}) dropped`,
      });
    }
    if (f.importance !== "normal") {
      loss.other.push({
        subject: f.id,
        detail: `importance '${f.importance}' has no CCv3 equivalent`,
      });
    }
    if (f.asset_refs && f.asset_refs.length > 0) {
      loss.other.push({ subject: f.id, detail: "attached context assets dropped" });
    }
    if (f.subject !== undefined && f.subject !== "self" && f.kind === "character") {
      const p = env.participants.get(f.subject);
      const name = p ? displayText(p.display_name, locale) : f.subject;
      noteParticipant(
        env,
        f.subject,
        `${name} is not the main character; exported as a lorebook entry`,
      );
    }

    let body = contentText(env, f.content, f.id);
    if (body === null || body.trim() === "") continue;
    if (f.visibility.scope === "private") {
      const who = f.visibility.to.map((k) => speakerText(env, k)).join(", ");
      body = `(Only ${who} know${f.visibility.to.length === 1 ? "s" : ""} this.)\n${body}`;
    }
    const tokens = est(body);
    const mode = f.activation.mode;

    if (mode === "semantic" || mode === "manual") {
      loss.activation_downgrades.push({
        subject: f.id,
        from: mode,
        to: "dropped",
        detail: `${mode} activation has no CCv3 equivalent; fragment not exported`,
      });
      continue;
    }

    const otherCharacter =
      f.kind === "character" && f.subject !== undefined && f.subject !== "self";
    if (mode === "keyword" || otherCharacter) {
      const keys =
        mode === "keyword"
          ? f.activation.keys
          : [
              displayText(
                env.participants.get(f.subject ?? "")?.display_name ?? f.subject ?? "",
                locale,
              ),
            ];
      const entry: CCv3LorebookEntry = {
        keys,
        content: body,
        extensions: {},
        enabled: true,
        insertion_order: entries.length,
        use_regex: false,
        name: f.origin.fragment,
        comment: f.id,
      };
      if (mode === "keyword") {
        const a = f.activation;
        entry.constant = false;
        if (a.case_sensitive !== undefined) entry.case_sensitive = a.case_sensitive;
        if (a.secondary && a.secondary.length > 0) {
          entry.selective = true;
          entry.secondary_keys = a.secondary;
          if (a.logic === "all") entry.extensions = { selectiveLogic: 3 };
        }
        if (a.whole_word !== undefined)
          entry.extensions = { ...entry.extensions, match_whole_words: a.whole_word };
        if (a.scan_depth !== undefined)
          entry.extensions = { ...entry.extensions, depth: a.scan_depth };
      } else {
        entry.constant = true;
      }
      entries.push(entry);
      loss.tokens.character_book += tokens;
      noteFlatten(f, "character_book", tokens);
      continue;
    }

    if (f.kind === "examples") {
      exampleParts.push(`<START>\n${body}`);
      loss.tokens.mes_example += tokens;
      noteFlatten(f, "mes_example", tokens);
      continue;
    }
    if (f.kind === "scenario") {
      scenarioParts.push(isRootSelf(f, rootRef) ? body : `[${sourceLabel(f)}]\n${body}`);
      loss.tokens.scenario += tokens;
      noteFlatten(f, "scenario", tokens);
      continue;
    }
    if (DESCRIPTION_KINDS.has(f.kind)) {
      const heading =
        isRootSelf(f, rootRef) && f.kind === "character" ? null : `[${sourceLabel(f)}]`;
      descParts.push(heading ? `${heading}\n${body}` : body);
      loss.tokens.description += tokens;
      noteFlatten(f, "description", tokens);
    }
  }

  for (const [ref, e] of [...flattened.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    loss.flattened_dependencies.push({
      ref,
      fragments: e.fragments,
      tokens: e.tokens,
      into: [...e.into].sort(),
    });
  }
  for (const p of ir.participants) {
    if (p.key === "self" || p.key === "user" || p.late === "user") continue;
    noteParticipant(
      env,
      p.key,
      `${displayText(p.display_name, locale)} cannot be a separate character in CCv3`,
    );
  }
  for (const s of ir.late_slots) {
    if (s.key === "user") continue;
    noteParticipant(
      env,
      s.key,
      "late slot cannot be bound in CCv3; not referenced by exported text",
    );
  }
  for (const a of ir.assets) {
    if (a.role === "context")
      loss.context_assets.push({
        subject: a.id,
        detail: `${a.media_type} context asset not exported`,
      });
  }
  const greetings = ir.bootstrap.greetings.map((g) => {
    for (const l of Object.keys(g.locales ?? {})) if (l !== locale) droppedLocales.add(l);
    return cardText(env, g.text);
  });
  loss.locales.dropped = [...droppedLocales].sort();

  const selectedPolicy = opts.resolvedPreset ? exportPolicyFields(opts.resolvedPreset) : undefined;
  if (selectedPolicy) {
    loss.other.push(...selectedPolicy.losses);
    if (!opts.presetMeta)
      loss.other.push({
        subject: "policy.attribution",
        detail:
          "ResolvedPreset has no author/license metadata; preserve attribution and licenses from its creation artifact before redistribution",
      });
  }
  const presetSystem = selectedPolicy?.fields.system_prompt ?? opts.preset?.system_prompt ?? "";
  const presetPost =
    selectedPolicy?.fields.post_history_instructions ??
    opts.preset?.post_history_instructions ??
    "";
  for (const o of ir.meta.import_omissions) {
    const restored = o.fields.every(
      (f) =>
        (f === "system_prompt" && presetSystem !== "") ||
        (f === "post_history_instructions" && presetPost !== ""),
    );
    loss.policy_fields.push({ ref: o.ref, fields: [...o.fields], restored });
  }

  const rootNode = ir.graph.nodes.find((n) => n.ref === rootRef);
  const self = env.participants.get("self");
  const name = self ? displayText(self.display_name, locale) : (rootNode?.display_name ?? rootRef);
  const attribution = [
    ...ir.meta.attribution,
    ...(opts.resolvedPreset ? (opts.presetMeta?.attribution ?? []) : []),
  ]
    .map((a) => `${a.ref}: ${a.authors.map((x) => x.name).join(", ") || "unknown"}`)
    .join("\n");
  const licenses = [
    ...ir.meta.licenses,
    ...(opts.resolvedPreset ? (opts.presetMeta?.licenses ?? []) : []),
  ]
    .map((l) => `${l.ref}${l.asset ? ` (${l.asset})` : ""}: ${l.license}`)
    .join("\n");
  const policyRating = opts.resolvedPreset ? opts.presetMeta?.rating : undefined;
  const effectiveRating =
    policyRating && RATINGS.indexOf(policyRating) > RATINGS.indexOf(ir.meta.rating)
      ? policyRating
      : ir.meta.rating;
  const ratingLabel =
    opts.resolvedPreset && !policyRating
      ? `unverified (content: ${ir.meta.rating}; policy: unknown)`
      : effectiveRating;
  if (opts.resolvedPreset && !policyRating)
    loss.other.push({
      subject: "policy.rating",
      detail:
        "The selected policy's effective rating was not provided; the combined export rating is unverified",
    });
  const contentWarnings = [
    ...new Set([
      ...ir.meta.content_warnings,
      ...(opts.resolvedPreset ? (opts.presetMeta?.content_warnings ?? []) : []),
    ]),
  ].sort();
  const notesTail = [
    "---",
    `Exported from char.pub (${rootRef}). Rating: ${ratingLabel}.`,
    contentWarnings.length ? `Content warnings: ${contentWarnings.join(", ")}` : "",
    attribution ? `Authors:\n${attribution}` : "",
    licenses ? `Licenses:\n${licenses}` : "",
  ]
    .filter((s) => s !== "")
    .join("\n");
  const rootAuthor = ir.meta.attribution.find((a) => a.ref === rootRef)?.authors[0]?.name ?? "";

  const description = descParts.join("\n\n");
  const scenario = scenarioParts.join("\n\n");
  const mes_example = exampleParts.join("\n");
  loss.tokens.total =
    loss.tokens.description +
    loss.tokens.scenario +
    loss.tokens.character_book +
    loss.tokens.mes_example;

  const data: CCv3Data = {
    name,
    description,
    tags: [],
    creator: opts.creator ?? rootAuthor,
    character_version: opts.character_version ?? "",
    mes_example,
    extensions: {
      char_pub: {
        root: ir.root,
        lock_digest: ir.lock_digest,
        ir_version: ir.ir_version,
        ...(opts.resolvedPreset
          ? {
              preset: {
                ref: opts.resolvedPreset.ref,
                release: opts.resolvedPreset.release,
                semantic_digest: opts.resolvedPreset.semantic_digest,
                ...(opts.resolvedPreset.lock_digest
                  ? { lock_digest: opts.resolvedPreset.lock_digest }
                  : {}),
              },
            }
          : {}),
      },
    },
    system_prompt: presetSystem,
    post_history_instructions: presetPost,
    first_mes: greetings[0] ?? "",
    alternate_greetings: greetings.slice(1),
    personality: "",
    scenario,
    creator_notes: notesTail,
    group_only_greetings: [],
  };
  if (entries.length > 0) data.character_book = { extensions: {}, entries };

  const card: CCv3Card = { spec: "chara_card_v3", spec_version: "3.0", data };
  const { group_only_greetings: _g, ...v2data } = data;
  const v2: CCv2Card = { spec: "chara_card_v2", spec_version: "2.0", data: v2data };

  const result: ExportResult = { card, v2, loss };
  if (opts.avatarPng) {
    result.png = replacePngText(
      opts.avatarPng,
      [
        { keyword: "chara", text: base64Encode(utf8Encode(JSON.stringify(v2))) },
        { keyword: "ccv3", text: base64Encode(utf8Encode(JSON.stringify(card))) },
      ],
      ["chara", "ccv3"],
    );
  }
  return result;
}
