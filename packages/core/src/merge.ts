/**
 * Contribution 的三方合并。
 *
 * 每个变更都有一个稳定的比较键：fragment 与 edge 用 id，asset 用 slot 或 slot/variant，
 * metadata 用字段路径。合并时逐个变更比较三份 digest：
 *
 * - base：贡献者提交时，这个键在基线中的值；
 * - current：这个键在目标草稿中的当前值；
 * - after：贡献者希望的新值。
 *
 * 规则（缺失值没有 digest）：
 *
 * - 新增（add，或 base 中不存在的 set）：current 缺失 → 应用；current 等于 after → 已应用，跳过；
 *   否则冲突。
 * - 修改（modify，或 base 中已存在的 set）：current 等于 base → 应用；current 等于 after →
 *   已应用，跳过；否则冲突。
 * - 删除（remove / unset）：current 等于 base → 删除；current 缺失 → 已应用，跳过；否则冲突。
 *
 * 不做 fragment 内部的文本合并：两边改了同一个键就是冲突。所有变更互不相交，所以只要
 * 没有冲突，作者期间对其他键的修改会被自动保留（rebase）。合并后的 Creation 会整体
 * 重新做 canonical 校验。
 *
 * 为了让“同一个 Contribution 再应用一次时每个变更都判定为已应用”成立，after 与 base
 * 相同的空变更、以及把字段设成默认值（canonical 形式中会被省略）的 set 都被视为不合法。
 *
 * 改变 rating、license、content_warnings 的变更是敏感变更（包括给 asset variant 单独
 * 声明 license 或 rating）：`sensitive` 由这里计算，不信任客户端提交的值；接受时作者
 * 必须逐项单独确认。
 */

import { z } from "zod";
import {
  type CanonicalCreation,
  type CanonicalResult,
  canonicalAssetSlot,
  canonicalAssetVariant,
  canonicalEdge,
  canonicalFragment,
  canonicalizeCreation,
  canonicalPolicy,
  canonicalPromptModule,
  configurationDigest,
  digestOf,
  normalizeConfigurationValue,
  normalizeValue,
} from "./canonical.js";
import { type CheckDiagnostic, checkCreation } from "./check.js";
import { CharError } from "./errors.js";
import { AssemblyConfigSchema, AssemblyFixtureSchema } from "./schema/assembly.js";
import {
  type AssetSlot,
  type AssetVariant,
  CONTRIBUTION_POLICY_DEFAULT,
  type CreationInput,
  CreationMetaSchema,
  type Fragment,
  type JSONValue,
  LocalizedTextSchema,
  type ReferenceEdge,
} from "./schema/creation.js";
import { PresetPolicySchema, PromptModuleSchema } from "./schema/policy.js";
import {
  type Change,
  ChangeSchema,
  type MetadataField,
  REQUIRED_METADATA_FIELDS,
  SENSITIVE_METADATA_FIELDS,
} from "./schema/release.js";
import { assertConditionLimits } from "./story/limits.js";
import {
  applyComposition,
  applyCompositionOrder,
  assertSafeCompositionValue,
  canonicalCompositionValue,
  compositionDigest,
  compositionValue,
  isCompositionChange,
  mergeCompositionObject,
  mergeCompositionOrder,
  removeEmptyStory,
} from "./story-merge.js";

export type MergeState = "applied" | "already_applied" | "conflict";

export interface MergeOutcome {
  /** 变更在 Contribution 中的位置。 */
  index: number;
  key: string;
  on: Change["on"];
  op: Change["op"];
  state: MergeState;
  sensitive: boolean;
  base_digest?: string;
  current_digest?: string;
  after_digest?: string;
  /**
   * 只在冲突时出现。diverged：两边都改了这个键；slot_missing：要给一个不存在的
   * asset slot 添加 variant（slot 已被删除，或从来没有）。
   */
  reason?: "diverged" | "slot_missing" | "invalid_result";
  conflict_fields?: string[];
}

export interface MergeResult {
  base_semantic_digest: string;
  /** 解析后的变更；metadata 变更的 `sensitive` 已按字段重新计算。 */
  changes: Change[];
  /** 与 changes 一一对应。 */
  outcomes: MergeOutcome[];
  conflicts: MergeOutcome[];
  /** 所有敏感变更的键，按变更顺序排列。 */
  sensitive_keys: string[];
  /** 没有冲突时的合并结果；只要有一个冲突就是 null，调用方不能生成新 Revision。 */
  result: CanonicalResult | null;
  diagnostics?: CheckDiagnostic[];
}

/** 变更的比较键。同一个 Contribution 内不能有两个相同的键。 */
export function changeKey(c: Change): string {
  switch (c.on) {
    case "story":
      return `story:${c.kind}:${c.id}`;
    case "story-order":
      return `story-order:${c.list}`;
    case "cast":
      return `cast:${c.key}`;
    case "group":
      return `group:${c.id}`;
    case "source":
      return `source:${c.id}`;
    case "fragment":
      return `fragment:${c.id}`;
    case "edge":
      return `edge:${c.id}`;
    case "asset":
      return c.variant === undefined ? `asset:${c.slot}` : `asset:${c.slot}/${c.variant}`;
    case "metadata":
      return `metadata:${c.field}`;
    case "configuration":
      return `configuration:${c.field}`;
  }
}

/**
 * 是否是敏感变更，与客户端声明的值无关。
 *
 * - metadata：rating、license、content_warnings 字段。
 * - asset：新值里有 variant 单独声明了 license 或 rating。这类变更同样会改变作品的
 *   许可或评级，所以也要求单独确认。
 */
export function computeSensitive(c: Change): boolean {
  if (c.on === "metadata") return SENSITIVE_METADATA_FIELDS.includes(c.field);
  if (c.on !== "asset" || c.after === undefined) return false;
  const variants = "variants" in c.after ? c.after.variants : [c.after];
  return variants.some((v) => v.license !== undefined || v.rating !== undefined);
}

// ---------------------------------------------------------------------------
// 变更解析与形状校验
// ---------------------------------------------------------------------------

function invalid(subject: string, detail: string): CharError {
  return new CharError({ code: "contribution.invalid_change", subject, detail });
}

function canonicalConfiguration(c: Extract<Change, { on: "configuration" }>): unknown {
  if (c.after === undefined) return undefined;
  const schemas = {
    policy: PresetPolicySchema,
    prompt_module: PromptModuleSchema,
    assembly: AssemblyConfigSchema,
    assembly_tests: z.array(AssemblyFixtureSchema),
  };
  const parsed = schemas[c.field].safeParse(c.after);
  if (!parsed.success) throw invalid(changeKey(c), `invalid ${c.field}: ${parsed.error.message}`);
  if (c.field === "policy") return canonicalPolicy(PresetPolicySchema.parse(parsed.data));
  if (c.field === "prompt_module")
    return canonicalPromptModule(PromptModuleSchema.parse(parsed.data));
  if (c.field === "assembly_tests" && Array.isArray(parsed.data) && parsed.data.length === 0)
    throw invalid(changeKey(c), "empty assembly_tests must be unset");
  return parsed.data;
}

/** 这些 metadata 字段在 canonical 形式中省略空列表，“设为空列表”要写成 unset。 */
const OPTIONAL_LIST_FIELDS: readonly MetadataField[] = [
  "meta.tags",
  "meta.content_warnings",
  "meta.recommended_presets",
];

function metaKey(field: MetadataField): keyof typeof CreationMetaSchema.shape | null {
  return field.startsWith("meta.")
    ? (field.slice("meta.".length) as keyof typeof CreationMetaSchema.shape)
    : null;
}

function validateMetadataValue(field: MetadataField, value: JSONValue, subject: string): void {
  const k = metaKey(field);
  const schema = k === null ? LocalizedTextSchema : CreationMetaSchema.shape[k];
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw invalid(subject, `after is not a valid ${field}: ${parsed.error.issues[0]?.message}`);
  }
  const isDefault =
    (field === "meta.contribution_policy" && value === CONTRIBUTION_POLICY_DEFAULT) ||
    (OPTIONAL_LIST_FIELDS.includes(field) && Array.isArray(value) && value.length === 0);
  if (isDefault) {
    throw invalid(subject, `setting ${field} to its default value must be written as unset`);
  }
}

/** Normalize the change envelope while retaining exact fixture snapshots in a typed after field. */
export function normalizeContributionChange(raw: unknown, path = "$"): JSONValue {
  if (
    raw &&
    typeof raw === "object" &&
    "on" in raw &&
    raw.on === "story" &&
    "after" in raw &&
    raw.after &&
    typeof raw.after === "object" &&
    "when" in raw.after
  )
    assertConditionLimits(raw.after.when, `${path}.after.when`);
  if (
    raw &&
    typeof raw === "object" &&
    "on" in raw &&
    ["story", "story-order", "cast", "group", "source"].includes(String(raw.on))
  )
    assertSafeCompositionValue(raw);
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    (Object.getPrototypeOf(raw) === Object.prototype || Object.getPrototypeOf(raw) === null) &&
    "on" in raw &&
    raw.on === "configuration" &&
    "field" in raw &&
    raw.field === "assembly_tests" &&
    "after" in raw &&
    raw.after !== undefined
  ) {
    const { after, ...envelope } = raw;
    return {
      ...(normalizeValue(envelope, path) as Record<string, JSONValue>),
      after: normalizeConfigurationValue("assembly_tests", after, `${path}.after`),
    };
  }
  return normalizeValue(raw, path);
}

function parseChange(raw: unknown, index: number): Change {
  const parsed = ChangeSchema.safeParse(normalizeContributionChange(raw, `changes[${index}]`));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw invalid(
      `changes[${index}]`,
      `${issue?.path.join(".") || "$"}: ${issue?.message ?? "invalid change"}`,
    );
  }
  const c = parsed.data;
  return c.on === "metadata" ? { ...c, sensitive: computeSensitive(c) } : c;
}

/** 检查 op 与 base_digest / after 的组合，以及 after 的身份是否与比较键一致。 */
function checkShape(c: Change, key: string): void {
  const hasBase = c.base_digest !== undefined;
  const hasAfter = c.after !== undefined;
  switch (c.op) {
    case "add":
      if (hasBase) throw invalid(key, "add must not have base_digest");
      if (!hasAfter) throw invalid(key, "add requires after");
      break;
    case "modify":
      if (!hasBase) throw invalid(key, "modify requires base_digest");
      if (!hasAfter) throw invalid(key, "modify requires after");
      break;
    case "remove":
      if (!hasBase) throw invalid(key, "remove requires base_digest");
      if (hasAfter) throw invalid(key, "remove must not have after");
      break;
    case "set":
      if (!hasAfter) throw invalid(key, "set requires after");
      break;
    case "unset":
      if (!hasBase) throw invalid(key, "unset requires base_digest");
      if (hasAfter) throw invalid(key, "unset must not have after");
      break;
  }

  switch (c.on) {
    case "fragment":
    case "edge":
      if (c.after && c.after.id !== c.id) throw invalid(key, "after.id must equal id");
      break;
    case "asset":
      if (!c.after) break;
      if (c.variant === undefined) {
        if (!("variants" in c.after)) throw invalid(key, "slot change requires an asset slot");
        if (c.after.slot !== c.slot) throw invalid(key, "after.slot must equal slot");
      } else {
        if (!("blob" in c.after)) throw invalid(key, "variant change requires an asset variant");
        if (c.after.id !== c.variant) throw invalid(key, "after.id must equal variant");
      }
      break;
    case "configuration":
      if (c.op === "unset" && (c.field === "policy" || c.field === "prompt_module"))
        throw new CharError({ code: "contribution.required_field", subject: key });
      if (c.after !== undefined) canonicalConfiguration(c);
      break;
    case "metadata":
      if (c.op === "unset" && REQUIRED_METADATA_FIELDS.includes(c.field)) {
        throw new CharError({
          code: "contribution.required_field",
          subject: key,
          detail: `${c.field} is required and cannot be unset`,
        });
      }
      if (c.after !== undefined) validateMetadataValue(c.field, c.after, key);
      break;
  }
}

/** after 的 canonical digest。 */
function afterDigest(c: Change): string | undefined {
  if (c.after === undefined) return undefined;
  if (isCompositionChange(c)) return digestOf(canonicalCompositionValue(c, c.after));
  switch (c.on) {
    case "fragment":
      return canonicalFragment(c.after).digest;
    case "edge":
      return digestOf(canonicalEdge(c.after));
    case "asset":
      return "variants" in c.after
        ? digestOf(canonicalAssetSlot(c.after))
        : digestOf(canonicalAssetVariant(c.after));
    case "metadata":
      return digestOf(c.after);
    case "configuration":
      return configurationDigest(c.field, canonicalConfiguration(c));
  }
}

// ---------------------------------------------------------------------------
// 读取目标草稿中的当前值
// ---------------------------------------------------------------------------

interface Current {
  digest: string | undefined;
  /** 只对 variant 级 asset 变更有意义：所在的 slot 是否存在。 */
  slotExists?: boolean;
}

function currentOf(base: CanonicalResult, c: Change): Current {
  const creation = base.creation;
  if (isCompositionChange(c)) return { digest: compositionDigest(creation, c) };
  switch (c.on) {
    case "fragment":
      return { digest: creation.fragments.find((f) => f.id === c.id)?.digest };
    case "edge": {
      const e = creation.references.find((r) => r.id === c.id);
      return { digest: e ? digestOf(e) : undefined };
    }
    case "asset": {
      const slot = creation.assets.find((s) => s.slot === c.slot);
      if (c.variant === undefined) return { digest: slot ? digestOf(slot) : undefined };
      const v = slot?.variants.find((x) => x.id === c.variant);
      return { digest: v ? digestOf(v) : undefined, slotExists: slot !== undefined };
    }
    case "configuration": {
      const value = (base.json as Record<string, JSONValue>)[c.field];
      return { digest: value === undefined ? undefined : configurationDigest(c.field, value) };
    }
    case "metadata": {
      // 读 canonical JSON：默认值和空列表在那里已被省略，视为缺失。
      const json = base.json as Record<string, JSONValue>;
      const k = metaKey(c.field);
      const holder = k === null ? json : (json.meta as Record<string, JSONValue>);
      const value = holder[k ?? c.field];
      return { digest: value === undefined ? undefined : digestOf(value) };
    }
  }
}

function decide(
  c: Change,
  current: Current,
  after: string | undefined,
): Pick<MergeOutcome, "state" | "reason"> {
  const base = c.base_digest;
  const conflict = { state: "conflict", reason: "diverged" } as const;
  if ((c.op === "add" || c.op === "set") && base === undefined) {
    if (current.digest === undefined) {
      if (current.slotExists === false) return { state: "conflict", reason: "slot_missing" };
      return { state: "applied" };
    }
    return current.digest === after ? { state: "already_applied" } : conflict;
  }
  if (c.op === "modify" || c.op === "set") {
    if (current.digest === base) return { state: "applied" };
    return current.digest === after ? { state: "already_applied" } : conflict;
  }
  if (current.digest === base) return { state: "applied" };
  return current.digest === undefined ? { state: "already_applied" } : conflict;
}

// ---------------------------------------------------------------------------
// 应用
// ---------------------------------------------------------------------------

interface Working {
  fragments: Fragment[];
  references: ReferenceEdge[];
  assets: AssetSlot[];
  meta: Record<string, JSONValue>;
  [field: string]: unknown;
}

function upsert<T>(list: T[], match: (x: T) => boolean, value: T | undefined): void {
  const i = list.findIndex(match);
  if (value === undefined) {
    if (i >= 0) list.splice(i, 1);
  } else if (i >= 0) {
    list[i] = value;
  } else {
    list.push(value);
  }
}

function apply(w: Working, c: Change): void {
  if (isCompositionChange(c)) {
    applyComposition(
      w,
      c,
      c.after === undefined ? undefined : canonicalCompositionValue(c, c.after),
    );
    return;
  }
  switch (c.on) {
    case "fragment":
      upsert(w.fragments, (f) => f.id === c.id, c.after && canonicalFragment(c.after));
      return;
    case "edge":
      upsert(w.references, (e) => e.id === c.id, c.after && canonicalEdge(c.after));
      return;
    case "asset": {
      if (c.variant === undefined) {
        const after = c.after as AssetSlot | undefined;
        upsert(w.assets, (s) => s.slot === c.slot, after && canonicalAssetSlot(after));
        return;
      }
      // 决策阶段已保证 slot 存在：slot 缺失时 add 是冲突，modify / remove 也不会进入应用。
      const slot = w.assets.find((s) => s.slot === c.slot) as AssetSlot;
      const after = c.after as AssetVariant | undefined;
      upsert(slot.variants, (v) => v.id === c.variant, after && canonicalAssetVariant(after));
      return;
    }
    case "configuration": {
      if (c.after === undefined) delete w[c.field];
      else w[c.field] = canonicalConfiguration(c);
      return;
    }
    case "metadata": {
      const k = metaKey(c.field);
      const holder: Record<string, unknown> = k === null ? w : w.meta;
      const name = k ?? c.field;
      if (c.after === undefined) delete holder[name];
      else holder[name] = c.after;
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/**
 * 把 Contribution 的变更合并进目标草稿。
 *
 * 形状错误（op 与 base_digest / after 不匹配、键重复、整个 slot 与其 variant 同时变更、
 * unset 必填字段等）直接抛出 `contribution.*` 错误，因为这说明 Contribution 本身不合法。
 * 新对象变更要求第三参数为Registry从不可变Revision加载的原始基线；不能信任客户端
 * 提供的基线对象。base_digest逐对象核对，字段独立合并，列表顺序独立处理。
 * 冲突及合并后静态错误不抛异常，返回outcomes/conflict_fields/diagnostics与result:null。
 */
export function mergeContribution(
  targetDraft: CanonicalCreation | CreationInput,
  rawChanges: readonly unknown[],
  baseCreation?: CanonicalCreation | CreationInput,
): MergeResult {
  const base = canonicalizeCreation(targetDraft);
  const changes = rawChanges.map(parseChange);
  const original = baseCreation === undefined ? undefined : canonicalizeCreation(baseCreation);
  if (changes.some(isCompositionChange) && !original)
    throw new CharError({
      code: "contribution.base_required",
      subject: "base_creation",
      detail: "Field-level changes require the immutable Revision baseline.",
    });
  if (
    original &&
    ["id", "ref", "type"].some(
      (field) =>
        original.creation[field as "id" | "ref" | "type"] !==
        base.creation[field as "id" | "ref" | "type"],
    )
  )
    throw new CharError({
      code: "contribution.base_identity_mismatch",
      subject: base.creation.ref,
    });
  const compositionResults = new Map<number, JSONValue | undefined>();

  const keys = changes.map(changeKey);
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      throw new CharError({ code: "contribution.duplicate_key", subject: key });
    }
    seen.add(key);
  }
  for (const c of changes) {
    if (c.on === "asset" && c.variant !== undefined && seen.has(`asset:${c.slot}`)) {
      throw new CharError({
        code: "contribution.overlapping_asset_change",
        subject: `asset:${c.slot}`,
        detail:
          "a whole-slot change and a variant change of the same slot cannot be merged independently",
      });
    }
  }

  const outcomes = changes.map((c, index): MergeOutcome => {
    const key = keys[index] as string;
    checkShape(c, key);
    const after = afterDigest(c);
    if (after !== undefined && after === c.base_digest) {
      throw new CharError({
        code: "contribution.noop_change",
        subject: key,
        detail: "after is identical to the base value",
      });
    }
    if (
      isCompositionChange(c) &&
      original &&
      compositionDigest(original.creation, c) !== c.base_digest
    )
      throw new CharError({
        code: "contribution.base_mismatch",
        subject: key,
        detail: "base_digest does not match the immutable Revision object.",
      });
    const current = currentOf(base, c);
    const outcome: MergeOutcome = {
      index,
      key,
      on: c.on,
      op: c.op,
      sensitive: computeSensitive(c),
      ...decide(c, current, after),
    };
    if (isCompositionChange(c) && c.on !== "story-order" && original) {
      const merged = mergeCompositionObject(
        c,
        compositionValue(original.creation, c),
        compositionValue(base.creation, c),
      );
      compositionResults.set(index, merged.value);
      outcome.state = merged.conflict_fields.length
        ? "conflict"
        : (
              merged.value === undefined
                ? current.digest === undefined
                : digestOf(merged.value) === current.digest
            )
          ? "already_applied"
          : "applied";
      delete outcome.reason;
      if (merged.conflict_fields.length) {
        outcome.reason = "diverged";
        outcome.conflict_fields = merged.conflict_fields;
      }
    }
    if (c.base_digest !== undefined) outcome.base_digest = c.base_digest;
    if (current.digest !== undefined) outcome.current_digest = current.digest;
    if (after !== undefined) outcome.after_digest = after;
    return outcome;
  });

  const working = JSON.parse(JSON.stringify(base.creation)) as Working;
  const proposed = original
    ? (JSON.parse(JSON.stringify(original.creation)) as Working)
    : undefined;
  for (const [index, c] of changes.entries()) {
    if (isCompositionChange(c) && c.on === "story-order") continue;
    if (proposed && isCompositionChange(c)) apply(proposed, c);
    if (outcomes[index]?.state !== "applied") continue;
    if (isCompositionChange(c)) applyComposition(working, c, compositionResults.get(index));
    else apply(working, c);
  }
  for (const [index, c] of changes.entries()) {
    if (c.on !== "story-order" || !original || !proposed) continue;
    const membership = compositionValue(proposed as unknown as CreationInput, c) as string[];
    if (membership.length !== c.after.length || membership.some((id) => !c.after.includes(id)))
      throw invalid(
        changeKey(c),
        "order must name every proposed object exactly once; add/remove objects with object changes",
      );
    const merged = mergeCompositionOrder(
      compositionValue(original.creation, c) as string[],
      compositionValue(base.creation, c) as string[],
      c.after,
      compositionValue(working as unknown as CreationInput, c) as string[],
    );
    const outcome = outcomes[index] as MergeOutcome;
    if (merged.conflict_fields.length) {
      outcome.state = "conflict";
      outcome.reason = "diverged";
      outcome.conflict_fields = merged.conflict_fields;
    } else {
      delete outcome.reason;
      outcome.state =
        digestOf(merged.value) === outcome.current_digest ? "already_applied" : "applied";
      applyCompositionOrder(working, c, merged.value as string[]);
    }
  }
  if (changes.some(isCompositionChange)) removeEmptyStory(working);
  const conflicts = outcomes.filter((outcome) => outcome.state === "conflict");
  const report = {
    base_semantic_digest: base.semantic_digest,
    changes,
    outcomes,
    conflicts,
    sensitive_keys: outcomes.filter((outcome) => outcome.sensitive).map((outcome) => outcome.key),
  };
  if (conflicts.length) return { ...report, result: null };
  let diagnostics: CheckDiagnostic[] = [];
  let result: CanonicalResult | undefined;
  try {
    result = canonicalizeCreation(working);
    diagnostics = checkCreation(result.creation).diagnostics.filter((d) => d.severity === "error");
  } catch (error) {
    if (!(error instanceof CharError)) throw error;
    diagnostics = [
      { severity: "error", code: error.code, subject: error.subject, detail: error.message },
    ];
  }
  if (diagnostics.length) {
    for (const outcome of outcomes) {
      outcome.state = "conflict";
      outcome.reason = "invalid_result";
      outcome.conflict_fields = [...new Set(diagnostics.map((d) => d.subject))];
    }
    return { ...report, conflicts: [...outcomes], result: null, diagnostics };
  }
  return { ...report, result: result ?? null };
}

/**
 * 接受 Contribution 前调用：每个将被应用的敏感变更都必须出现在作者逐项确认的键列表里，
 * 否则抛出 `contribution.sensitive_unconfirmed`。已应用过的敏感变更不需要再确认。
 */
export function assertSensitiveConfirmed(
  merge: MergeResult,
  confirmedKeys: readonly string[],
): void {
  const missing = merge.outcomes
    .filter((o) => o.sensitive && o.state === "applied" && !confirmedKeys.includes(o.key))
    .map((o) => o.key);
  if (missing.length > 0) {
    throw new CharError({
      code: "contribution.sensitive_unconfirmed",
      subject: missing[0] as string,
      detail: "sensitive changes must be confirmed one by one",
      data: { keys: missing },
    });
  }
}

/**
 * 贡献授权检查。默认规则是贡献内容按目标 Creation 的 license 授权（inbound = outbound）。
 * 目标使用自定义许可（`LicenseRef-*`，包括保留所有权利）时，许可条款无法自动套用到
 * 贡献内容上，必须由贡献者显式授权。接受 Contribution 时要用目标的当前 license
 * 重新检查一次，因为提交之后作者可能改过 license。
 */
export function assertRightsAck(
  targetLicense: string,
  rightsAck: { inbound_equals_outbound: true } | { explicit_grant: true },
): void {
  const needsExplicit = /(^|[\s(])LicenseRef-/.test(targetLicense);
  if (needsExplicit && !("explicit_grant" in rightsAck)) {
    throw new CharError({
      code: "contribution.rights_ack_required",
      subject: "rights_ack",
      detail: `target license ${targetLicense} requires an explicit grant from the contributor`,
    });
  }
}
