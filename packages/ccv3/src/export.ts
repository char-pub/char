/**
 * CCv3 导出：CreationArtifact → 角色卡 JSON（可选写入 PNG）+ Loss Report。
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
  buildIdentity,
  CharError,
  type CompiledTemplate,
  type ContextIR,
  type CreationArtifact,
  CreationArtifactSchema,
  type EffectiveMeta,
  finalizeIrText,
  type IRContent,
  type IRFragment,
  LocaleSchema,
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
  /** Export one requested locale, falling back to the published default with a loss note. */
  locale?: string;
  /** Explicitly selected, integrity-checked policy release. */
  resolvedPreset?: ResolvedPreset;
  /** Aggregated attribution and licenses from the selected policy artifact. */
  presetMeta?: Pick<EffectiveMeta, "licenses" | "attribution"> &
    Partial<Pick<EffectiveMeta, "rating" | "content_warnings">>;
  /** 显式提供的字面策略覆盖；未指定策略覆盖时使用产物锁定的 assembly 或 default_policy。 */
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

function matchingLocale(available: readonly string[], wanted: string): string | undefined {
  const parts = wanted.split("-");
  for (let length = parts.length; length > 0; length--) {
    if (length < parts.length && parts[length - 1]?.length === 1) continue;
    const candidate = parts.slice(0, length).join("-").toLowerCase();
    const found = available.find((tag) => tag.toLowerCase() === candidate);
    if (found !== undefined) return found;
  }
  return undefined;
}

function displayText(v: Participant["display_name"], locale: string, defaultLocale = "en"): string {
  if (typeof v === "string") return v;
  const keys = Object.keys(v).sort();
  const key = matchingLocale(keys, locale) ?? matchingLocale(keys, defaultLocale) ?? keys[0];
  return key === undefined ? "" : (v[key] ?? "");
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
  const name = p ? displayText(p.display_name, env.locale, env.ir.meta.default_locale) : key;
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

/** Preserve start ordering while making every discarded narrative object visible to the author. */
function exportStory(
  artifact: Extract<CreationArtifact, { kind: "content" }>,
  env: Env,
  compiled: (key: string) => string,
  pickTemplate: (value: CompiledTemplate, subject: string) => string,
  scenarioParts: string[],
  estimate: TokenEstimator,
): string[] {
  const story = artifact.story;
  if (!story) return [];
  const starts: NonNullable<typeof story.starts> = story.starts ?? [{ id: "default" }];
  const firstScene = starts[0]?.scene ?? story.scenes[0]?.id;
  const scene = story.scenes.find((item) => item.id === firstScene);
  if (!scene)
    throw new CharError({
      code: "ccv3.story_scene_missing",
      subject: firstScene ?? "story.scenes",
    });
  const note = (subject: string, detail: string) => env.loss.other.push({ subject, detail });
  const scenarioText: string[] = [];
  if (scene.opening !== undefined) scenarioText.push(compiled(`scene/${scene.id}/opening`));
  const roles = artifact.story_refs?.participants ?? {};
  for (const key of scene.cast ?? Object.keys(roles)) {
    const participant = env.participants.get(roles[key] ?? "");
    if (!participant) throw new CharError({ code: "ccv3.story_participant_missing", subject: key });
    const name = displayText(participant.display_name, env.locale, env.ir.meta.default_locale);
    if (participant.part)
      scenarioText.push(
        `${name}: ${displayText(participant.part, env.locale, env.ir.meta.default_locale)}`,
      );
    if (participant.goal)
      scenarioText.push(
        `${name} — Goal: ${displayText(participant.goal, env.locale, env.ir.meta.default_locale)}`,
      );
    const goal = scene.goals?.[key];
    if (goal)
      scenarioText.push(
        `${name} — Scene goal: ${displayText(goal, env.locale, env.ir.meta.default_locale)}`,
      );
  }
  const text = scenarioText.filter((value) => value !== "").join("\n");
  if (text) {
    scenarioParts.push(text);
    env.loss.tokens.scenario += estimate(text);
  }
  for (const item of story.scenes) {
    note(
      `story.scenes[${item.id}]`,
      item.id === scene.id
        ? "opening and present participants' part/goals flattened into scenario; scene identity, presence and transitions cannot execute"
        : "scene, opening, presence and local goals dropped",
    );
    for (const field of [
      "when",
      "place",
      "lore",
      "items",
      "events",
      "beats",
      "choices",
      "time",
      "where",
    ] as const)
      if (item[field] !== undefined)
        note(
          `story.scenes[${item.id}].${field}`,
          "scene association or condition is not executable in CCv3",
        );
  }
  for (const field of [
    "beats",
    "endings",
    "plotlines",
    "choices",
    "items",
    "events",
    "timelines",
  ] as const)
    for (const item of story[field] ?? [])
      note(
        `story.${field}[${item.id}]`,
        "narrative object, conditions, effects and reveal rules dropped",
      );
  for (const key of Object.keys(story.vars ?? {}))
    note(`story.vars[${key}]`, "story variable and initial value dropped");
  for (const key of Object.keys(story.knowing ?? {}))
    note(
      `story.knowing[${key}]`,
      "participant knowledge and enter-scene updates dropped; export is a narrator view",
    );
  note("story.version", "story execution and per-agent semantics are not supported by CCv3");
  const usedBootstrap = new Set<string>();
  const greetings = starts.map((start) => {
    if (story.starts)
      note(
        `story.starts[${start.id}]`,
        "start identity, scene selection and metadata flattened into an ordered greeting",
      );
    for (const field of ["set", "reached"] as const)
      if (start[field] !== undefined)
        note(`story.starts[${start.id}].${field}`, "start state changes dropped");
    const greeting = start.greeting;
    if (greeting !== undefined && (typeof greeting === "string" || !("ref" in greeting)))
      return compiled(`start/${start.id}/greeting`);
    const bootstrap =
      greeting && typeof greeting === "object" && "ref" in greeting
        ? env.ir.bootstrap.greetings.find((item) => item.id === greeting.ref)
        : env.ir.bootstrap.greetings[0];
    if (!bootstrap) {
      if (greeting !== undefined)
        throw new CharError({
          code: "ccv3.greeting_missing",
          subject: `story.starts[${start.id}].greeting`,
        });
      note(
        `story.starts[${start.id}].greeting`,
        "start has no opening message; empty greeting retained without promoting another start",
      );
      return "";
    }
    usedBootstrap.add(bootstrap.id);
    return pickTemplate(bootstrap, `bootstrap.${bootstrap.id}`);
  });
  for (const greeting of env.ir.bootstrap.greetings)
    if (!usedBootstrap.has(greeting.id))
      note(
        `bootstrap.greetings[${greeting.id}]`,
        "unreferenced bootstrap greeting omitted from story start choices",
      );
  return greetings;
}

export function exportCCv3(input: CreationArtifact, options: ExportOptions = {}): ExportResult {
  const parsed = CreationArtifactSchema.safeParse(input);
  if (!parsed.success)
    throw new CharError({
      code: "ccv3.invalid_artifact",
      subject: "artifact",
      detail: parsed.error.issues[0]?.message ?? "invalid creation artifact",
    });
  const artifact = parsed.data;
  if (artifact.kind !== "content")
    throw new CharError({ code: "ccv3.content_required", subject: artifact.root.ref });
  const ir = artifact.ir;
  const locked = artifact.assembly?.preset ?? artifact.default_policy;
  const explicit = options.resolvedPreset !== undefined || options.preset !== undefined;
  const opts: ExportOptions =
    !explicit && locked
      ? { ...options, resolvedPreset: locked, presetMeta: artifact.meta }
      : options;
  const est = opts.estimateTokens ?? estimateTokens;
  const locale = opts.locale ?? ir.meta.default_locale;
  if (!LocaleSchema.safeParse(locale).success)
    throw new CharError({ code: "ccv3.invalid_locale", subject: locale });
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
    const hit = matchingLocale(
      [ir.meta.default_locale, ...Object.keys(f.locales ?? {}).sort()],
      locale,
    );
    for (const l of [ir.meta.default_locale, ...Object.keys(f.locales ?? {})])
      if (l !== (hit ?? ir.meta.default_locale)) droppedLocales.add(l);
    if (f.visibility.scope === "private") {
      loss.visibility.push({
        subject: f.id,
        detail: `private to ${f.visibility.to.join(", ")}; exported with a narrator note, not as a boundary`,
      });
    } else if (f.visibility.scope === "scene" || f.visibility.scope === "story-scene") {
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
      const name = p ? displayText(p.display_name, locale, ir.meta.default_locale) : f.subject;
      noteParticipant(
        env,
        f.subject,
        `${name} is not the main character; exported as a lorebook entry`,
      );
    }

    const translated =
      hit === undefined || hit === ir.meta.default_locale ? undefined : f.locales?.[hit];
    if (hit === undefined)
      loss.other.push({
        subject: `locales.${f.id}`,
        detail: `requested ${locale} unavailable; used published default text`,
      });
    if (f.description !== undefined)
      loss.other.push({ subject: `${f.id}.description`, detail: "selection description dropped" });
    if (f.selectable !== undefined)
      loss.other.push({
        subject: `${f.id}.selectable`,
        detail:
          f.selectable && f.activation.mode === "keyword"
            ? "AI selection without a keyword hit is lost; only keyword activation is exported"
            : "context selector eligibility declaration cannot be represented in CCv3",
      });
    if (f.about !== undefined)
      loss.other.push({
        subject: `${f.id}.about`,
        detail:
          "structured subject associations dropped; CCv3 keyword keys do not preserve these links",
      });
    if (f.source !== undefined)
      loss.other.push({
        subject: `${f.id}.source`,
        detail: `reference-source relationship (${f.source.use}) dropped; it is not reconstructed from keyword keys`,
      });
    if (f.outward !== undefined)
      loss.other.push({
        subject: `${f.id}.outward`,
        detail: "per-agent outward visibility rules dropped",
      });
    if (f.style_scope || f.style_use)
      loss.other.push({
        subject: `${f.id}.style_scope`,
        detail: "style scope and combination rules lost; style text is flattened",
      });
    let body = contentText(env, translated ?? f.content, f.id);
    if (body === null || body.trim() === "") continue;
    if (f.visibility.scope === "private") {
      const who = f.visibility.to.map((k) => speakerText(env, k)).join(", ");
      body = `(Only ${who} know${f.visibility.to.length === 1 ? "s" : ""} this.)\n${body}`;
    }
    if (f.perspective && f.perspective !== "canon") {
      const prefix =
        f.perspective === "rumor"
          ? "Rumor:"
          : "claim" in f.perspective
            ? `${speakerText(env, f.perspective.claim)} claims:`
            : `${speakerText(env, f.perspective.belief)} believes:`;
      body = `${prefix}\n${body}`;
      loss.other.push({
        subject: `${f.id}.perspective`,
        detail: "information perspective converted to a textual label",
      });
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
      `${displayText(p.display_name, locale, ir.meta.default_locale)} cannot be a separate character in CCv3`,
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
  const pickTemplate = (template: CompiledTemplate, subject: string): string => {
    const hit = matchingLocale(
      [ir.meta.default_locale, ...Object.keys(template.locales ?? {}).sort()],
      locale,
    );
    for (const l of [ir.meta.default_locale, ...Object.keys(template.locales ?? {})])
      if (l !== (hit ?? ir.meta.default_locale)) droppedLocales.add(l);
    const translated =
      hit === undefined || hit === ir.meta.default_locale ? undefined : template.locales?.[hit];
    if (hit === undefined)
      loss.other.push({
        subject,
        detail: `requested ${locale} unavailable; used published default template`,
      });
    return cardText(env, translated ?? template.text);
  };
  const compiled = (key: string): string => {
    const template = artifact.story_refs?.templates[key];
    if (!template) throw new CharError({ code: "ccv3.story_template_missing", subject: key });
    return pickTemplate(template, key);
  };
  const greetings = artifact.story
    ? exportStory(artifact, env, compiled, pickTemplate, scenarioParts, est)
    : ir.bootstrap.greetings.map((g) => pickTemplate(g, `bootstrap.${g.id}`));
  for (const group of artifact.catalog_index.groups)
    loss.other.push({
      subject: group.id,
      detail: "lore group hierarchy and description dropped; entries exported independently",
    });
  for (const source of artifact.catalog_index.sources)
    loss.other.push({
      subject: source.id,
      detail: "reference source body, sections and retrieval rules not exported",
    });
  for (const work of artifact.catalog_index.works)
    if (work.description !== undefined)
      loss.other.push({
        subject: `${work.id}.description`,
        detail: "work selection description dropped",
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
  const name = self
    ? displayText(self.display_name, locale, ir.meta.default_locale)
    : (rootNode?.display_name ?? rootRef);
  const unique = (lines: string[]) => [...new Set(lines)].join("\n");
  const attribution = unique(
    [
      ...ir.meta.attribution,
      ...(opts.resolvedPreset ? (opts.presetMeta?.attribution ?? []) : []),
    ].map((a) => `${a.ref}: ${a.authors.map((x) => x.name).join(", ") || "unknown"}`),
  );
  const licenses = unique(
    [...ir.meta.licenses, ...(opts.resolvedPreset ? (opts.presetMeta?.licenses ?? []) : [])].map(
      (l) => `${l.ref}${l.asset ? ` (${l.asset})` : ""}: ${l.license}`,
    ),
  );
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
        lock_digest: artifact.lock_digest,
        ir_version: ir.ir_version,
        ...(opts.resolvedPreset
          ? {
              preset: {
                ref: opts.resolvedPreset.ref,
                ...buildIdentity(opts.resolvedPreset),
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
