/**
 * 角色卡导入：PNG / CHARX / JSON → Canonical Creation 草稿 + Import Report + 待上传的资源。
 *
 * 映射规则：
 * - name → display_name；creator_notes（及多语言版本）→ summary；tags → meta.tags；
 *   creator → authors。
 * - description、personality → character fragment `description`、`personality`；
 *   scenario → scenario fragment `scenario`；mes_example → examples fragment（能解析出说话人时
 *   是对话，否则是文本）。这些 ID 来自固定的字段名，重复导入也不会变，所以是稳定的。
 * - first_mes、alternate_greetings → bootstrap greetings（`default`、`alt-1`……）。
 * - character_book 的条目 → knowledge fragment，ID 为 `lore/<名字>`。卡片里的条目 id 没有
 *   任何持久性保证（很多工具直接用数组下标填充），所以一律标记为 `stable: false`，
 *   源 id 与派生 ID 的对应关系只写进报告。
 * - system_prompt、post_history_instructions 属于 Preset 层的策略文本，原值不进入 Creation，
 *   只把字段名记在 provenance 里；原值留在导入原件和 Import Report 中（报告只给上传者本人看）。
 * - 头像、背景、表情图片作为 presentation 资源返回给调用方，由上传管线处理。
 *
 * 卡片没有声明评级、权利与许可，导入结果里的这三项只是保守的占位值，
 * 必须由作者在导入向导里确认（报告的 `needs_confirmation`）。
 */
import {
  type Activation,
  CharError,
  type CreationInput,
  canonicalizeCreation,
  type Digest,
  type Fragment,
  type FragmentContent,
  type Greeting,
  LocaleSchema,
  type LocalizedText,
  type Rating,
  sha256Bytes,
} from "@char-pub/core";
import {
  type AssetResolver,
  type ImageMediaType,
  resolveAssetUri,
  sniffImageType,
} from "./assets.js";
import { base64Decode, utf8Decode, utf8Encode } from "./bytes.js";
import {
  type InputAsset,
  type InputCardData,
  type InputLorebook,
  type InputLorebookEntry,
  type ParsedCard,
  parseCardJson,
  parseCardObject,
} from "./card.js";
import { DEFAULT_ZIP_LIMITS, isZip, openZip, type ZipLimits } from "./charx.js";
import {
  DEFAULT_PNG_LIMITS,
  isPng,
  type PngLimits,
  readPngChunks,
  readPngTextEntries,
  stripPngMetadata,
} from "./png.js";
import {
  allocateId,
  cardTextToTemplate,
  type Decorator,
  type PlaceholderNote,
  parseExampleDialogue,
  slugSegment,
  splitDecorators,
} from "./text.js";

export type Rights = "original" | "fan-work" | "licensed";

export interface ImportLimits {
  png: Partial<PngLimits>;
  zip: Partial<ZipLimits>;
  /** JSON 卡片的字节上限。 */
  maxJsonBytes: number;
  /** 单个资源的字节上限；超过的资源不导入。 */
  maxAssetBytes: number;
}

export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  png: DEFAULT_PNG_LIMITS,
  zip: DEFAULT_ZIP_LIMITS,
  maxJsonBytes: 20 * 1024 * 1024,
  maxAssetBytes: 10 * 1024 * 1024,
};

export interface ImportOptions {
  ids: { creation: string };
  /** 新 Creation 的公共标识 `@namespace/name`。 */
  ref: string;
  /** 原件的 digest；省略时按输入字节计算。 */
  source_digest?: Digest;
  default_locale?: string;
  /** 作者在导入向导中确认过的值；省略时使用保守默认值并要求确认。 */
  rating?: Rating;
  rights?: Rights;
  license?: string;
  limits?: Partial<ImportLimits>;
}

export interface ImportedAsset {
  slot: string;
  variant: string;
  bytes: Uint8Array;
  media_type: ImageMediaType;
  digest: Digest;
  /** 卡片中声明的来源 URI。 */
  source_uri: string;
}

export type ImportContainer = "png" | "charx" | "json";

export interface LorebookReportEntry {
  /** 条目在 character_book.entries 中的下标。 */
  index: number;
  source_id?: string | number;
  source_name?: string;
  /** 派生出的 fragment ID；条目被丢弃时省略。 */
  fragment_id?: string;
  activation: Activation["mode"] | "dropped";
  insertion_order?: number;
  priority?: number;
  position?: unknown;
  decorators: Decorator[];
  notes: string[];
}

export interface AssetReportEntry {
  type: string;
  name: string;
  uri: string;
  imported: boolean;
  slot?: string;
  variant?: string;
  reason?: string;
}

export interface ImportWarning {
  code: string;
  detail: string;
}

export interface ImportReport {
  container: ImportContainer;
  /** `ccv3`、`ccv2` 或 `ccv1`；写进 provenance 的格式名（CHARX 为 `charx`）。 */
  format: string;
  spec: ParsedCard["spec"];
  spec_version: string | null;
  source_digest: Digest;
  /** 源字段 → Canonical 字段。 */
  mappings: { from: string; to: string }[];
  /** 被省略的策略字段及其原值。报告只给上传者本人看，公开 Release 不包含它。 */
  omitted_policy_fields: { field: string; value: string }[];
  /** 在 Canonical 模型中没有对应物、被转义成字面量的宏。 */
  placeholders: PlaceholderNote[];
  lorebook: LorebookReportEntry[];
  assets: AssetReportEntry[];
  /** 有内容但没有导入的字段。 */
  dropped: { field: string; reason: string }[];
  /** 必须由作者确认的字段。 */
  needs_confirmation: ("meta.rating" | "meta.rights" | "meta.license")[];
  warnings: ImportWarning[];
}

export interface ImportResult {
  creation: CreationInput;
  report: ImportReport;
  assets: ImportedAsset[];
}

export type ImportInput = Uint8Array | string | object;

const POLICY_FIELDS = ["system_prompt", "post_history_instructions"] as const;

/** 已经映射或有意处理过的字段；其余有内容的字段都会出现在报告的 dropped 里。 */
const HANDLED_DATA_FIELDS = new Set([
  "name",
  "description",
  "personality",
  "scenario",
  "first_mes",
  "mes_example",
  "creator_notes",
  "creator_notes_multilingual",
  "system_prompt",
  "post_history_instructions",
  "alternate_greetings",
  "tags",
  "creator",
  "character_book",
  "assets",
]);

// ---------------------------------------------------------------------------
// 容器识别
// ---------------------------------------------------------------------------

interface Loaded {
  container: ImportContainer;
  card: ParsedCard;
  resolver: AssetResolver;
  sourceBytes: Uint8Array;
  warnings: ImportWarning[];
}

function decodeTextCard(text: string, keyword: string): unknown {
  return parseCardJson(utf8Decode(base64Decode(text, `png.${keyword}`), `png.${keyword}`));
}

function loadPng(bytes: Uint8Array, lim: ImportLimits): Loaded {
  const chunks = readPngChunks(bytes, lim.png);
  const texts = readPngTextEntries(chunks);
  const v3 = texts.find((t) => t.keyword === "ccv3");
  const v2 = texts.find((t) => t.keyword === "chara");
  const chosen = v3 ?? v2;
  if (!chosen) throw new CharError({ code: "ccv3.no_card_data", subject: "png" });
  const warnings: ImportWarning[] = [];
  if (!v3 && v2) {
    warnings.push({ code: "ccv3.v2_chunk_only", detail: "PNG has only the V2 'chara' chunk" });
  }
  const card = parseCardObject(decodeTextCard(chosen.text, chosen.keyword));
  const extAssets = new Map<string, string>();
  for (const t of texts) {
    if (t.keyword.startsWith("chara-ext-asset_:"))
      extAssets.set(t.keyword.slice("chara-ext-asset_:".length), t.text);
  }
  const icon = stripPngMetadata(bytes, lim.png);
  return {
    container: "png",
    card,
    sourceBytes: bytes,
    warnings,
    resolver: {
      defaultIcon: icon,
      maxAssetBytes: lim.maxAssetBytes,
      embedded(path) {
        const t = extAssets.get(path);
        if (t === undefined) return null;
        try {
          return base64Decode(t, "png.ext_asset");
        } catch {
          return null;
        }
      },
    },
  };
}

function loadCharx(bytes: Uint8Array, lim: ImportLimits): Loaded {
  const zip = openZip(bytes, lim.zip);
  const json = zip.read("card.json");
  if (!json) throw new CharError({ code: "charx.missing_card", subject: "charx" });
  const card = parseCardObject(parseCardJson(utf8Decode(json, "charx.card_json")));
  return {
    container: "charx",
    card,
    sourceBytes: bytes,
    warnings: [],
    resolver: {
      defaultIcon: null,
      maxAssetBytes: lim.maxAssetBytes,
      embedded(path) {
        const e = zip.entries.get(path);
        if (!e || e.size > lim.maxAssetBytes) return null;
        return zip.read(path);
      },
    },
  };
}

function loadJson(text: string, bytes: Uint8Array, lim: ImportLimits): Loaded {
  if (bytes.length > lim.maxJsonBytes) {
    throw new CharError({
      code: "ccv3.too_large",
      subject: "card",
      detail: `JSON exceeds ${lim.maxJsonBytes} bytes`,
    });
  }
  return {
    container: "json",
    card: parseCardObject(parseCardJson(text)),
    sourceBytes: bytes,
    warnings: [],
    resolver: { defaultIcon: null, maxAssetBytes: lim.maxAssetBytes, embedded: () => null },
  };
}

function load(input: ImportInput, lim: ImportLimits): Loaded {
  if (input instanceof Uint8Array) {
    if (isPng(input)) return loadPng(input, lim);
    if (isZip(input)) return loadCharx(input, lim);
    let i = 0;
    if (input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf) i = 3;
    while (
      i < input.length &&
      (input[i] === 0x20 || input[i] === 0x0a || input[i] === 0x0d || input[i] === 0x09)
    )
      i++;
    if (input[i] !== 0x7b)
      throw new CharError({ code: "ccv3.unrecognized_format", subject: "card" });
    if (input.length > lim.maxJsonBytes) {
      throw new CharError({
        code: "ccv3.too_large",
        subject: "card",
        detail: `JSON exceeds ${lim.maxJsonBytes} bytes`,
      });
    }
    return loadJson(
      utf8Decode(
        input.subarray(input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf ? 3 : 0),
        "card",
      ),
      input,
      lim,
    );
  }
  if (typeof input === "string") return loadJson(input, utf8Encode(input), lim);
  const text = JSON.stringify(input);
  return {
    container: "json",
    card: parseCardObject(input),
    sourceBytes: utf8Encode(text),
    warnings: [],
    resolver: { defaultIcon: null, maxAssetBytes: lim.maxAssetBytes, embedded: () => null },
  };
}

// ---------------------------------------------------------------------------
// 字段映射
// ---------------------------------------------------------------------------

interface Ctx {
  report: ImportReport;
  used: Set<string>;
}

function textFragment(
  ctx: Ctx,
  id: string,
  kind: Fragment["kind"],
  raw: string,
  location: string,
): Fragment {
  const text = cardTextToTemplate(raw, location, ctx.report.placeholders);
  ctx.used.add(id);
  ctx.report.mappings.push({ from: location, to: `fragments#${id}` });
  return { id, stable: true, kind, content: { type: "text", text } };
}

function exampleFragments(ctx: Ctx, raw: string): Fragment[] {
  const location = "data.mes_example";
  const blocks = parseExampleDialogue(raw);
  if (!blocks) {
    ctx.report.warnings.push({
      code: "ccv3.examples_as_text",
      detail: "mes_example could not be parsed into dialogue turns; imported as text",
    });
    return [textFragment(ctx, "examples", "examples", raw, location)];
  }
  const toContent = (b: (typeof blocks)[number]): FragmentContent => ({
    type: "dialogue",
    turns: b.turns.map((t) => ({
      speaker: t.speaker,
      text: cardTextToTemplate(t.text, location, ctx.report.placeholders),
    })),
  });
  const [only] = blocks;
  if (blocks.length === 1 && only) {
    ctx.used.add("examples");
    ctx.report.mappings.push({ from: location, to: "fragments#examples" });
    return [{ id: "examples", stable: true, kind: "examples", content: toContent(only) }];
  }
  // 多段示例按顺序编号；编号取决于位置，所以不是稳定 ID
  return blocks.map((b, i) => {
    const id = `examples/${i + 1}`;
    ctx.used.add(id);
    ctx.report.mappings.push({ from: `${location}[<START> ${i + 1}]`, to: `fragments#${id}` });
    return { id, stable: false, kind: "examples", content: toContent(b) };
  });
}

const ACTIVATION_DECORATORS = new Set(["activate", "dont_activate"]);

/** 按“主 decorator 不认识时才看紧随其后的后备 decorator”的规则，找出生效的激活类 decorator。 */
function effectiveActivationDecorators(decorators: readonly Decorator[]): Set<string> {
  const out = new Set<string>();
  let lastPrimaryRecognized = true;
  for (const d of decorators) {
    if (!d.fallback) {
      lastPrimaryRecognized = ACTIVATION_DECORATORS.has(d.name);
      if (lastPrimaryRecognized) out.add(d.name);
    } else if (!lastPrimaryRecognized && ACTIVATION_DECORATORS.has(d.name)) {
      out.add(d.name);
      lastPrimaryRecognized = true;
    }
  }
  return out;
}

function uniq(list: readonly string[]): string[] {
  return [...new Set(list)];
}

function clampScanDepth(v: number | undefined, notes: string[]): number | undefined {
  if (v === undefined) return undefined;
  const n = Math.floor(v);
  if (n < 1) {
    notes.push(`scan_depth ${v} ignored`);
    return undefined;
  }
  if (n > 1000) {
    notes.push(`scan_depth ${v} clamped to 1000`);
    return 1000;
  }
  return n;
}

function entryActivation(
  e: InputLorebookEntry,
  book: InputLorebook,
  decorators: readonly Decorator[],
  notes: string[],
): Activation {
  const active = effectiveActivationDecorators(decorators);
  if (e.enabled === false) {
    notes.push("entry was disabled; imported with manual activation");
    return { mode: "manual" };
  }
  if (active.has("activate")) return { mode: "always" };
  if (active.has("dont_activate")) return { mode: "manual" };
  if (e.use_regex === true) {
    notes.push("regex keys are not supported; imported with manual activation");
    return { mode: "manual" };
  }
  if (e.constant === true) return { mode: "always" };
  const keys = uniq(e.keys);
  if (keys.length === 0) {
    notes.push("entry has no keys; imported with manual activation");
    return { mode: "manual" };
  }
  const a: Extract<Activation, { mode: "keyword" }> = { mode: "keyword", keys };
  const secondary = uniq(e.secondary_keys);
  if (e.selective === true && secondary.length > 0) {
    const logic = e.extensions.selectiveLogic;
    if (logic === undefined || logic === 0) a.secondary = secondary;
    else if (logic === 3) {
      a.secondary = secondary;
      a.logic = "all";
    } else {
      notes.push(`secondary key logic ${String(logic)} is not supported; secondary keys dropped`);
    }
  }
  if (typeof e.case_sensitive === "boolean") a.case_sensitive = e.case_sensitive;
  if (typeof e.extensions.match_whole_words === "boolean")
    a.whole_word = e.extensions.match_whole_words;
  const depth = clampScanDepth(book.scan_depth, notes);
  if (depth !== undefined) a.scan_depth = depth;
  return a;
}

function lorebookFragments(ctx: Ctx, book: InputLorebook): Fragment[] {
  const out: Fragment[] = [];
  book.entries.forEach((e, index) => {
    const location = `data.character_book.entries[${index}]`;
    const notes: string[] = [];
    const { decorators, body } = splitDecorators(e.content);
    const entry: LorebookReportEntry = { index, activation: "dropped", decorators, notes };
    if (e.id !== undefined) entry.source_id = e.id;
    const sourceName = e.name ?? e.comment;
    if (sourceName !== undefined && sourceName !== "") entry.source_name = sourceName;
    if (e.insertion_order !== undefined) entry.insertion_order = e.insertion_order;
    if (e.priority !== undefined) entry.priority = e.priority;
    if (e.position !== undefined && e.position !== null) entry.position = e.position;
    ctx.report.lorebook.push(entry);
    if (body.trim() === "") {
      notes.push("empty content; entry dropped");
      return;
    }
    const base = slugSegment(e.name || e.comment || e.keys[0] || "entry");
    const id = allocateId(`lore/${base}`, ctx.used);
    const activation = entryActivation(e, book, decorators, notes);
    const frag: Fragment = {
      id,
      stable: false,
      kind: "knowledge",
      content: {
        type: "text",
        text: cardTextToTemplate(body, `${location}.content`, ctx.report.placeholders),
      },
    };
    if (activation.mode !== "always") frag.activation = activation;
    entry.fragment_id = id;
    entry.activation = activation.mode;
    ctx.report.mappings.push({ from: location, to: `fragments#${id}` });
    out.push(frag);
  });
  return out;
}

function greetings(ctx: Ctx, d: InputCardData): Greeting[] {
  const out: Greeting[] = [];
  if (d.first_mes.trim() !== "") {
    out.push({
      id: "default",
      text: cardTextToTemplate(d.first_mes, "data.first_mes", ctx.report.placeholders),
    });
    ctx.report.mappings.push({ from: "data.first_mes", to: "bootstrap.greetings#default" });
  }
  let n = 0;
  d.alternate_greetings.forEach((g, i) => {
    if (g.trim() === "") return;
    const location = `data.alternate_greetings[${i}]`;
    const id = out.length === 0 ? "default" : `alt-${++n}`;
    out.push({ id, text: cardTextToTemplate(g, location, ctx.report.placeholders) });
    ctx.report.mappings.push({ from: location, to: `bootstrap.greetings#${id}` });
  });
  return out;
}

function summary(ctx: Ctx, d: InputCardData): LocalizedText | undefined {
  const multi: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.creator_notes_multilingual ?? {})) {
    if (v.trim() === "") continue;
    if (!LocaleSchema.safeParse(k).success) {
      ctx.report.dropped.push({
        field: `data.creator_notes_multilingual.${k}`,
        reason: "invalid language code",
      });
      continue;
    }
    multi[k] = v;
  }
  if (Object.keys(multi).length > 0) {
    // 多语言版本缺少 en 时，creator_notes 视为英文版
    if (multi.en === undefined && d.creator_notes.trim() !== "") multi.en = d.creator_notes;
    ctx.report.mappings.push({ from: "data.creator_notes_multilingual", to: "summary" });
    return multi;
  }
  if (d.creator_notes.trim() === "") return undefined;
  ctx.report.mappings.push({ from: "data.creator_notes", to: "summary" });
  return d.creator_notes;
}

function tags(ctx: Ctx, d: InputCardData): string[] {
  const out: string[] = [];
  for (const raw of d.tags) {
    const t = raw.trim();
    if (t === "") continue;
    if (t.length > 64) {
      ctx.report.dropped.push({
        field: "data.tags",
        reason: `tag longer than 64 characters: ${t.slice(0, 64)}…`,
      });
      continue;
    }
    if (!out.includes(t)) out.push(t);
  }
  if (out.length > 0) ctx.report.mappings.push({ from: "data.tags", to: "meta.tags" });
  return out;
}

// ---------------------------------------------------------------------------
// 资源
// ---------------------------------------------------------------------------

const ASSET_SLOTS: Record<string, { slot: string; main: string }> = {
  icon: { slot: "avatar", main: "main" },
  background: { slot: "background", main: "main" },
  emotion: { slot: "emotion", main: "neutral" },
};

const DEFAULT_ASSETS: InputAsset[] = [
  { type: "icon", uri: "ccdefault:", name: "main", ext: "png" },
];

function importAssets(
  ctx: Ctx,
  declared: InputAsset[] | undefined,
  r: AssetResolver,
): {
  slots: NonNullable<CreationInput["assets"]>;
  files: ImportedAsset[];
} {
  const list = declared ?? DEFAULT_ASSETS;
  const resolved: {
    a: InputAsset;
    bytes: Uint8Array;
    media: ImageMediaType;
    report: AssetReportEntry;
  }[] = [];
  for (const a of list) {
    const report: AssetReportEntry = {
      type: a.type,
      name: a.name,
      uri: a.uri.slice(0, 256),
      imported: false,
    };
    ctx.report.assets.push(report);
    const target = ASSET_SLOTS[a.type];
    if (!target) {
      report.reason =
        a.type === "user_icon"
          ? "user icons belong to the user's persona"
          : "unsupported asset type";
      continue;
    }
    const src = resolveAssetUri(a.uri, a.type, r);
    if (src.kind === "remote") {
      report.reason = "remote URLs are not fetched during import";
      continue;
    }
    if (src.kind === "missing") {
      report.reason = src.reason;
      continue;
    }
    if (src.bytes.length > r.maxAssetBytes) {
      report.reason = "asset too large";
      continue;
    }
    const media = sniffImageType(src.bytes);
    if (!media) {
      report.reason = "not a PNG, JPEG, WebP or GIF image";
      continue;
    }
    resolved.push({ a, bytes: src.bytes, media, report });
  }

  const slots: NonNullable<CreationInput["assets"]> = [];
  const files: ImportedAsset[] = [];
  for (const [type, target] of Object.entries(ASSET_SLOTS)) {
    const group = resolved.filter((x) => x.a.type === type);
    if (group.length === 0) continue;
    const mainIndex = Math.max(
      0,
      group.findIndex((x) => x.a.name === target.main),
    );
    const used = new Set<string>(["default"]);
    const variants = group.map((x, i) => {
      const id = i === mainIndex ? "default" : allocateId(slugSegment(x.a.name || type), used);
      const digest = sha256Bytes(x.bytes);
      x.report.imported = true;
      x.report.slot = target.slot;
      x.report.variant = id;
      files.push({
        slot: target.slot,
        variant: id,
        bytes: x.bytes,
        media_type: x.media,
        digest,
        source_uri: x.a.uri,
      });
      return {
        id,
        media_type: x.media,
        blob: { digest, size: x.bytes.length, availability: "mirrored" as const },
      };
    });
    slots.push({ slot: target.slot, role: "presentation", variants });
    ctx.report.mappings.push({ from: `data.assets[type=${type}]`, to: `assets#${target.slot}` });
  }
  return { slots, files };
}

// ---------------------------------------------------------------------------
// 报告：未导入的字段
// ---------------------------------------------------------------------------

function hasContent(v: unknown): boolean {
  if (v === undefined || v === null || v === "" || v === 0) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

function recordDropped(ctx: Ctx, card: ParsedCard): void {
  const d = card.data as Record<string, unknown>;
  for (const [k, v] of Object.entries(d).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (HANDLED_DATA_FIELDS.has(k) || !hasContent(v)) continue;
    const reason =
      k === "extensions"
        ? `application-specific data not imported (keys: ${Object.keys(v as object)
            .sort()
            .join(", ")})`
        : k === "group_only_greetings"
          ? "group chats are not modeled"
          : k === "nickname"
            ? "no separate prompt name; {{char}} now refers to display_name"
            : "no Canonical equivalent";
    ctx.report.dropped.push({ field: `data.${k}`, reason });
  }
  const book = card.data.character_book;
  if (book) {
    for (const k of [
      "name",
      "description",
      "token_budget",
      "recursive_scanning",
      "extensions",
    ] as const) {
      if (hasContent(book[k])) {
        ctx.report.dropped.push({
          field: `data.character_book.${k}`,
          reason: "lorebook-level setting not modeled",
        });
      }
    }
  }
  for (const k of card.extra_top_level)
    ctx.report.dropped.push({ field: k, reason: "unknown top-level field" });
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

function formatName(card: ParsedCard, container: ImportContainer): string {
  if (container === "charx") return "charx";
  return card.spec === "chara_card_v3" ? "ccv3" : card.spec === "chara_card_v2" ? "ccv2" : "ccv1";
}

/**
 * 导入一张角色卡。输入可以是文件字节（自动识别 PNG / CHARX / JSON）、JSON 文本或已解析的对象。
 * 输入不合法时抛出带 code 的 CharError；可以容忍的问题记在报告的 warnings 里。
 */
export function importCard(input: ImportInput, opts: ImportOptions): ImportResult {
  const lim: ImportLimits = { ...DEFAULT_IMPORT_LIMITS, ...opts.limits };
  const loaded = load(input, lim);
  const { card } = loaded;
  const d = card.data;
  const source_digest = opts.source_digest ?? sha256Bytes(loaded.sourceBytes);
  const format = formatName(card, loaded.container);
  const report: ImportReport = {
    container: loaded.container,
    format,
    spec: card.spec,
    spec_version: card.spec_version,
    source_digest,
    mappings: [],
    omitted_policy_fields: [],
    placeholders: [],
    lorebook: [],
    assets: [],
    dropped: [],
    needs_confirmation: [],
    warnings: [...loaded.warnings],
  };
  const ctx: Ctx = { report, used: new Set() };

  if (
    card.spec === "chara_card_v3" &&
    card.spec_version !== null &&
    Number.parseFloat(card.spec_version) > 3
  ) {
    report.warnings.push({
      code: "ccv3.newer_spec",
      detail: `card uses spec_version ${card.spec_version}; fields added after 3.0 are not imported`,
    });
  }

  let display_name = d.name.trim();
  if (display_name === "") {
    display_name = "Untitled";
    report.warnings.push({
      code: "ccv3.missing_name",
      detail: "card has no name; using 'Untitled'",
    });
  } else {
    report.mappings.push({ from: "data.name", to: "display_name" });
  }

  const fragments: Fragment[] = [];
  if (d.description.trim() !== "") {
    fragments.push(
      textFragment(ctx, "description", "character", d.description, "data.description"),
    );
  }
  if (d.personality.trim() !== "") {
    fragments.push(
      textFragment(ctx, "personality", "character", d.personality, "data.personality"),
    );
  }
  if (fragments.length === 0) {
    report.warnings.push({
      code: "ccv3.no_character_text",
      detail:
        "card has no description or personality; the draft needs a character fragment before publishing",
    });
  }
  if (d.scenario.trim() !== "")
    fragments.push(textFragment(ctx, "scenario", "scenario", d.scenario, "data.scenario"));
  if (d.mes_example.trim() !== "") fragments.push(...exampleFragments(ctx, d.mes_example));
  if (d.character_book) fragments.push(...lorebookFragments(ctx, d.character_book));

  const omitted: string[] = [];
  for (const f of POLICY_FIELDS) {
    const v = d[f];
    if (v.trim() === "") continue;
    omitted.push(f);
    report.omitted_policy_fields.push({ field: f, value: v });
  }

  const bootstrap = greetings(ctx, d);
  const sum = summary(ctx, d);
  const tagList = tags(ctx, d);
  const { slots, files } = importAssets(ctx, d.assets, loaded.resolver);
  recordDropped(ctx, card);

  if (opts.rating === undefined) report.needs_confirmation.push("meta.rating");
  if (opts.rights === undefined) report.needs_confirmation.push("meta.rights");
  if (opts.license === undefined) report.needs_confirmation.push("meta.license");

  const creator = d.creator.trim();
  const creation: CreationInput = {
    id: opts.ids.creation,
    ref: opts.ref,
    type: "character",
    display_name,
    fragments,
    references: [],
    assets: slots,
    meta: {
      default_locale: opts.default_locale ?? "en",
      rating: opts.rating ?? "general",
      rights: opts.rights ?? "original",
      license: opts.license ?? "LicenseRef-All-Rights-Reserved",
    },
    provenance: {
      imported_from:
        omitted.length > 0
          ? { format, source_digest, omitted_policy_fields: omitted }
          : { format, source_digest },
    },
  };
  if (sum !== undefined) creation.summary = sum;
  if (creator !== "") {
    creation.authors = [{ name: creator.slice(0, 256) }];
    report.mappings.push({ from: "data.creator", to: "authors" });
  }
  if (bootstrap.length > 0) creation.bootstrap = { greetings: bootstrap };
  if (tagList.length > 0) creation.meta.tags = tagList;

  // 导入结果必须能通过 Canonical schema；这里失败说明调用参数不合法（例如 ref 或 id 格式错误）
  canonicalizeCreation(creation);
  return { creation, report, assets: files };
}
