/**
 * Canonical 序列化与 digest。
 *
 * 同一份语义内容无论怎么书写（键序、缩进、行尾、Unicode 组合方式、是否写出默认值），
 * 都必须得到同一个 canonical 形式和同一个 digest。步骤：
 *
 * 1. 文本归一：所有字符串做 Unicode NFC，行尾统一为 `\n`，去掉每行末尾的空格和制表符。
 * 2. schema 校验（strict，未知字段直接拒绝）。
 * 3. 剥离默认值：等于默认值的字段、空的可选数组 / 映射一律省略。
 * 4. 按 RFC 8785（JCS）序列化，再取 sha256，编码为 `sha256:<hex>`。
 *
 * fragment digest 是去掉 `digest` 字段后的 fragment 的哈希；semantic digest 是 manifest 的哈希。
 * manifest 就是 Creation 把 `fragments` 换成 `[id, digest]` 列表。这个列表保留声明顺序，
 * 因为 fragment 顺序会影响 Context IR 的输出。
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import canonicalizeJcs from "canonicalize";
import type { z } from "zod";
import { CharError } from "./errors.js";
import {
  type Activation,
  type AssetSlot,
  type AssetVariant,
  type Creation,
  type CreationInput,
  CreationSchema,
  type Fragment,
  type FragmentContent,
  type FragmentOverride,
  type Greeting,
  type JSONValue,
  type LocaleMap,
  type ReferenceEdge,
} from "./schema/creation.js";

export type Digest = `sha256:${string}`;

// ---------------------------------------------------------------------------
// 基础：文本归一、JCS、哈希
// ---------------------------------------------------------------------------

const TRAILING_WS = /[ \t]+$/gm;

/** NFC + 行尾统一为 `\n` + 去掉每行末尾的空格和制表符。 */
export function normalizeText(s: string): string {
  return s.normalize("NFC").replace(/\r\n?/g, "\n").replace(TRAILING_WS, "");
}

/**
 * 递归归一化任意 JSON 值：字符串做文本归一，对象键做 NFC，丢掉值为 undefined 的键。
 * 不接受非纯数据（函数、Date、Map 等）以及非有限数。
 */
export function normalizeValue(value: unknown, path = "$"): JSONValue {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
      return normalizeText(value);
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value)) {
        throw new CharError({ code: "canonical.invalid_number", subject: path });
      }
      return Object.is(value, -0) ? 0 : value;
    case "object": {
      if (Array.isArray(value)) {
        return value.map((v, i) => {
          if (v === undefined) {
            throw new CharError({ code: "canonical.undefined_in_array", subject: `${path}[${i}]` });
          }
          return normalizeValue(v, `${path}[${i}]`);
        });
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new CharError({ code: "canonical.not_plain_object", subject: path });
      }
      const out: Record<string, JSONValue> = {};
      for (const [k, v] of Object.entries(value)) {
        if (v === undefined) continue;
        const key = k.normalize("NFC");
        if (Object.hasOwn(out, key)) {
          throw new CharError({
            code: "canonical.duplicate_key",
            subject: `${path}.${key}`,
            detail: "two keys collapse to the same NFC form",
          });
        }
        out[key] = normalizeValue(v, `${path}.${key}`);
      }
      return out;
    }
    default:
      throw new CharError({
        code: "canonical.unsupported_value",
        subject: path,
        detail: typeof value,
      });
  }
}

/** RFC 8785 JSON Canonicalization Scheme。输入必须已经是纯 JSON 值。 */
export function jcs(value: JSONValue): string {
  const out = canonicalizeJcs(value);
  if (out === undefined) throw new CharError({ code: "canonical.unserializable", subject: "$" });
  return out;
}

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8ToBytes(text)));
}

export function sha256Bytes(bytes: Uint8Array): Digest {
  return `sha256:${bytesToHex(sha256(bytes))}`;
}

/** 对已经 canonical 的 JSON 值取 digest。 */
export function digestJson(value: JSONValue): Digest {
  return `sha256:${sha256Hex(jcs(value))}`;
}

// ---------------------------------------------------------------------------
// 默认值剥离
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

/** 删除值为 undefined、空数组或空对象的可选字段。 */
function compact<T extends Obj>(o: T, optionalCollections: readonly string[]): T {
  const out: Obj = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue;
    if (optionalCollections.includes(k)) {
      if (Array.isArray(v) && v.length === 0) continue;
      if (v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) {
        continue;
      }
    }
    out[k] = v;
  }
  return out as T;
}

function omitIf<T extends Obj, K extends keyof T>(
  o: T,
  key: K,
  isDefault: (v: NonNullable<T[K]>) => boolean,
): T {
  const v = o[key];
  if (v !== undefined && v !== null && isDefault(v)) {
    const { [key]: _omit, ...rest } = o;
    return rest as T;
  }
  return o;
}

export function canonicalContent(c: FragmentContent): FragmentContent {
  if (c.type === "text") return omitIf({ ...c }, "format", (f) => f === "markdown");
  return c;
}

export function canonicalActivation(a: Activation): Activation {
  if (a.mode !== "keyword") return a;
  let out = compact({ ...a }, ["secondary"]);
  out = omitIf(out, "logic", (v) => v === "any");
  out = omitIf(out, "case_sensitive", (v) => v === false);
  out = omitIf(out, "whole_word", (v) => v === false);
  return out;
}

function canonicalLocaleMap(m: LocaleMap): LocaleMap {
  const out: LocaleMap = {};
  for (const [loc, v] of Object.entries(m)) {
    out[loc] = compact({ ...v, content: canonicalContent(v.content) }, ["activation_keys"]);
  }
  return out;
}

export function canonicalFragmentBody(f: Omit<Fragment, "digest">): Omit<Fragment, "digest"> {
  let out: Omit<Fragment, "digest"> = { ...f, content: canonicalContent(f.content) };
  if (out.locale) out.locale = canonicalLocaleMap(out.locale);
  if (out.activation) out.activation = canonicalActivation(out.activation);
  out = compact(out, ["locale", "asset_refs"]);
  out = omitIf(out, "activation", (a) => a.mode === "always");
  out = omitIf(out, "visibility", (v) => v.scope === "shared");
  out = omitIf(out, "importance", (v) => v === "normal");
  out = omitIf(out, "placement_hint", (v) => v === f.kind);
  return out;
}

/** 计算 fragment digest，并返回带 digest 的 canonical fragment。 */
export function canonicalFragment(f: Fragment): Fragment & { digest: Digest } {
  const { digest: declared, ...body } = f;
  const canon = canonicalFragmentBody(body);
  const digest = digestJson(canon as JSONValue);
  if (declared !== undefined && declared !== digest) {
    throw new CharError({
      code: "canonical.fragment_digest_mismatch",
      subject: f.id,
      detail: `declared ${declared}, computed ${digest}`,
    });
  }
  return { ...canon, digest };
}

function canonicalOverride(o: FragmentOverride): FragmentOverride {
  switch (o.op) {
    case "replace":
      return omitIf({ ...o, content: canonicalContent(o.content) }, "force", (v) => v === false);
    case "remove":
      return omitIf({ ...o }, "force", (v) => v === false);
    case "patch": {
      const set = { ...o.set };
      if (set.activation) set.activation = canonicalActivation(set.activation);
      return { ...o, set };
    }
    case "add":
      return { ...o, fragment: canonicalFragment(o.fragment) };
  }
}

export function canonicalEdge(e: ReferenceEdge): ReferenceEdge {
  const out: ReferenceEdge = { ...e };
  if (out.override) out.override = out.override.map(canonicalOverride);
  return compact(out, ["bind", "params", "override"]);
}

export function canonicalAssetVariant(v: AssetVariant): AssetVariant {
  return v;
}

export function canonicalAssetSlot(s: AssetSlot): AssetSlot {
  return { ...s, variants: s.variants.map(canonicalAssetVariant) };
}

function canonicalGreeting(g: Greeting): Greeting {
  const out = { ...g };
  if (out.locale) out.locale = canonicalLocaleMap(out.locale);
  return compact(out, ["locale"]);
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/** canonical Creation：fragment 都带 digest，默认值已剥离。它本身就是可存储的 JSON。 */
export type CanonicalCreation = Omit<Creation, "fragments"> & {
  fragments: (Fragment & { digest: Digest })[];
};

export interface CanonicalResult {
  /** 结构化形式，fragments / references / assets / provenance 总是存在，便于后续处理。 */
  creation: CanonicalCreation;
  /** 去掉默认值后的 JSON，存储与传输都用它。 */
  json: JSONValue;
  /** 用于计算 semantic digest 的 manifest。 */
  manifest: JSONValue;
  semantic_digest: Digest;
}

function stripCreationDefaults(c: CanonicalCreation): JSONValue {
  let out: Obj = { ...c };
  if (c.slots) {
    const slots: Obj = {};
    for (const [k, v] of Object.entries(c.slots)) {
      slots[k] = omitIf({ ...v }, "required", (r) => r === true);
    }
    out.slots = slots;
  }
  const meta = omitIf(
    compact({ ...c.meta }, ["tags", "content_warnings", "recommended_presets"]),
    "contribution_policy",
    (p) => p === "signed-in",
  );
  out.meta = meta;
  let prov = compact({ ...c.provenance }, ["derived_from", "contributors"]);
  prov = omitIf(prov, "au", (v) => v === false);
  prov = omitIf(prov, "authored_by_agent", (v) => v === false);
  if (prov.imported_from) {
    prov.imported_from = compact({ ...prov.imported_from }, ["omitted_policy_fields"]);
  }
  out.provenance = prov;
  out = compact(out, [
    "authors",
    "slots",
    "params",
    "fragments",
    "references",
    "assets",
    "cast",
    "provenance",
  ]);
  return normalizeValue(out);
}

function formatIssues(err: z.ZodError): string {
  return err.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "$"}: ${i.message}`)
    .join("; ");
}

/**
 * 把任意书写形式的 Creation 转成 canonical 形式，并计算所有 digest。
 * 校验失败抛出 `schema.invalid`；fragment ID 重复抛出 `canonical.duplicate_fragment`。
 */
export function canonicalizeCreation(input: CreationInput | unknown): CanonicalResult {
  const normalized = normalizeValue(input);
  const parsed = CreationSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new CharError({
      code: "schema.invalid",
      subject: "creation",
      detail: formatIssues(parsed.error),
      data: {
        issues: parsed.error.issues.map((i) => ({ path: i.path.map(String), message: i.message })),
      },
    });
  }
  const c = parsed.data;

  const seen = new Set<string>();
  for (const f of c.fragments) {
    if (seen.has(f.id)) {
      throw new CharError({ code: "canonical.duplicate_fragment", subject: f.id });
    }
    seen.add(f.id);
  }

  const creation: CanonicalCreation = {
    ...c,
    fragments: c.fragments.map(canonicalFragment),
    references: c.references.map(canonicalEdge),
    assets: c.assets.map(canonicalAssetSlot),
  };
  if (c.bootstrap) {
    creation.bootstrap = { greetings: c.bootstrap.greetings.map(canonicalGreeting) };
  }

  const json = stripCreationDefaults(creation);
  const { fragments: _f, ...rest } = json as Obj;
  const manifest = normalizeValue({
    ...rest,
    fragment_digests: creation.fragments.map((f) => [f.id, f.digest]),
  });
  return { creation, json, manifest, semantic_digest: digestJson(manifest) };
}

/**
 * 某个值的 canonical digest（edge、asset、metadata 等）。
 * 调用方应先用对应的 canonicalXxx 函数剥离默认值；缺失值没有 digest。
 */
export function digestOf(value: unknown): Digest {
  return digestJson(normalizeValue(value));
}
