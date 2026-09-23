/**
 * 角色卡 JSON 的结构。
 *
 * 读取时尽量宽松：真实世界的卡片经常缺字段、把字段写成 null、或者混用 V1 / V2 / V3 的写法，
 * 这些都按空值处理；但类型明显错误（例如 name 是数字）时直接拒绝，避免把垃圾数据带进
 * Canonical 模型。未知字段一律保留在解析结果里，由导入报告列出。
 */
import { CharError } from "@char-pub/core";
import { z } from "zod";

// ---------------------------------------------------------------------------
// 输出类型（导出时按规范写全所有必需字段）
// ---------------------------------------------------------------------------

export interface CCv3LorebookEntry {
  keys: string[];
  content: string;
  extensions: Record<string, unknown>;
  enabled: boolean;
  insertion_order: number;
  case_sensitive?: boolean;
  use_regex: boolean;
  constant?: boolean;
  name?: string;
  priority?: number;
  id?: number | string;
  comment?: string;
  selective?: boolean;
  secondary_keys?: string[];
  position?: "before_char" | "after_char";
}

export interface CCv3Lorebook {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions: Record<string, unknown>;
  entries: CCv3LorebookEntry[];
}

export interface CCv3Asset {
  type: string;
  uri: string;
  name: string;
  ext: string;
}

export interface CCv3Data {
  name: string;
  description: string;
  tags: string[];
  creator: string;
  character_version: string;
  mes_example: string;
  extensions: Record<string, unknown>;
  system_prompt: string;
  post_history_instructions: string;
  first_mes: string;
  alternate_greetings: string[];
  personality: string;
  scenario: string;
  creator_notes: string;
  character_book?: CCv3Lorebook;
  assets?: CCv3Asset[];
  nickname?: string;
  creator_notes_multilingual?: Record<string, string>;
  source?: string[];
  group_only_greetings: string[];
  creation_date?: number;
  modification_date?: number;
}

export interface CCv3Card {
  spec: "chara_card_v3";
  spec_version: "3.0";
  data: CCv3Data;
}

/** 为兼容只认识 V2 的程序而同时写入的 V2 卡片。 */
export interface CCv2Card {
  spec: "chara_card_v2";
  spec_version: "2.0";
  data: Omit<
    CCv3Data,
    | "assets"
    | "nickname"
    | "creator_notes_multilingual"
    | "source"
    | "group_only_greetings"
    | "creation_date"
    | "modification_date"
  >;
}

// ---------------------------------------------------------------------------
// 宽松的输入 schema
// ---------------------------------------------------------------------------

/** 字符串字段：缺失或 null 视为空字符串。 */
const text = z
  .string()
  .nullish()
  .transform((v) => v ?? "");

/** 字符串数组：缺失或 null 视为空数组；数组里的 null 被丢弃。 */
const textList = z
  .array(z.string().nullable())
  .nullish()
  .transform((v) => (v ?? []).filter((x): x is string => typeof x === "string"));

/** 关键词列表：兼容数组，也兼容逗号分隔的字符串。 */
const keyList = z
  .union([z.array(z.union([z.string(), z.number(), z.null()])), z.string()])
  .nullish()
  .transform((v) => {
    if (v === null || v === undefined) return [];
    const items =
      typeof v === "string" ? v.split(",") : v.map((x) => (x === null ? "" : String(x)));
    return items.map((k) => k.trim()).filter((k) => k.length > 0);
  });

/** 可选字段：null 视为缺失。 */
function opt<T extends z.ZodType>(schema: T) {
  return schema
    .nullish()
    .transform((v) => (v === null ? undefined : v))
    .optional();
}

const optBool = opt(z.boolean());
const optString = opt(z.string());
const optNumber = z
  .number()
  .nullish()
  .transform((v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined))
  .optional();
const record = z
  .record(z.string(), z.unknown())
  .nullish()
  .transform((v) => v ?? {});

export const InputLorebookEntrySchema = z.looseObject({
  keys: keyList,
  content: text,
  extensions: record,
  enabled: optBool,
  insertion_order: optNumber,
  case_sensitive: optBool,
  use_regex: optBool,
  constant: optBool,
  name: optString,
  priority: optNumber,
  id: opt(z.union([z.string(), z.number()])),
  comment: optString,
  selective: optBool,
  secondary_keys: keyList,
  position: z.unknown().optional(),
});
export type InputLorebookEntry = z.output<typeof InputLorebookEntrySchema>;

export const InputLorebookSchema = z.looseObject({
  name: optString,
  description: optString,
  scan_depth: optNumber,
  token_budget: optNumber,
  recursive_scanning: optBool,
  extensions: record,
  entries: z
    .array(InputLorebookEntrySchema)
    .nullish()
    .transform((v) => v ?? []),
});
export type InputLorebook = z.output<typeof InputLorebookSchema>;

export const InputAssetSchema = z.looseObject({
  type: z.string(),
  uri: z.string(),
  name: text,
  ext: text,
});
export type InputAsset = z.output<typeof InputAssetSchema>;

export const InputCardDataSchema = z.looseObject({
  name: text,
  description: text,
  personality: text,
  scenario: text,
  first_mes: text,
  mes_example: text,
  creator_notes: text,
  system_prompt: text,
  post_history_instructions: text,
  alternate_greetings: textList,
  group_only_greetings: textList,
  tags: textList,
  creator: text,
  character_version: z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v) => (v === null || v === undefined ? "" : String(v))),
  extensions: record,
  character_book: opt(InputLorebookSchema),
  assets: opt(z.array(InputAssetSchema)),
  nickname: optString,
  creator_notes_multilingual: opt(z.record(z.string(), z.string())),
  source: opt(z.array(z.string())),
  creation_date: optNumber,
  modification_date: optNumber,
});
export type InputCardData = z.output<typeof InputCardDataSchema>;

/** 解析出的卡片，已统一成 V3 的字段结构。 */
export interface ParsedCard {
  /** 卡片自报的规范：`chara_card_v3`、`chara_card_v2`，或 V1（没有 spec 字段）。 */
  spec: "chara_card_v3" | "chara_card_v2" | "v1";
  spec_version: string | null;
  data: InputCardData;
  /** 顶层除 spec / spec_version / data 以外的字段（只记录名字）。 */
  extra_top_level: string[];
}

/** V1 的卡片没有 `data` 包装，字段直接在顶层；这些是 V1 定义过的字段名。 */
const V1_FIELDS = new Set([
  "name",
  "description",
  "personality",
  "scenario",
  "first_mes",
  "mes_example",
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function invalid(detail: string): never {
  throw new CharError({ code: "ccv3.invalid_card", subject: "card", detail });
}

/** 识别卡片版本并解析成统一结构。无法识别或类型错误时抛出 `ccv3.invalid_card`。 */
export function parseCardObject(value: unknown): ParsedCard {
  if (!isRecord(value)) invalid("card must be a JSON object");
  const spec = value.spec;
  let kind: ParsedCard["spec"];
  let data: unknown;
  let extra: string[];
  if (spec === "chara_card_v3" || spec === "chara_card_v2") {
    kind = spec;
    data = value.data;
    extra = Object.keys(value).filter((k) => k !== "spec" && k !== "spec_version" && k !== "data");
  } else if (spec === undefined && Object.keys(value).some((k) => V1_FIELDS.has(k))) {
    kind = "v1";
    data = value;
    extra = [];
  } else {
    invalid(
      typeof spec === "string"
        ? `unsupported spec '${spec.slice(0, 64)}'`
        : "unrecognized card format",
    );
  }
  if (!isRecord(data)) invalid("card data must be a JSON object");
  const parsed = InputCardDataSchema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    invalid(first ? `${first.path.join(".") || "data"}: ${first.message}` : "invalid card data");
  }
  const rawVersion = value.spec_version;
  const spec_version =
    typeof rawVersion === "string"
      ? rawVersion
      : typeof rawVersion === "number"
        ? String(rawVersion)
        : null;
  return { spec: kind, spec_version, data: parsed.data, extra_top_level: extra.sort() };
}

/** 把 JSON 文本解析成对象；语法错误抛出 `ccv3.invalid_json`。 */
export function parseCardJson(textValue: string): unknown {
  const s = textValue.charCodeAt(0) === 0xfeff ? textValue.slice(1) : textValue;
  try {
    return JSON.parse(s);
  } catch {
    throw new CharError({ code: "ccv3.invalid_json", subject: "card" });
  }
}
