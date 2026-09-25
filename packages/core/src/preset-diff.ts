import { canonicalPolicy, jcs, normalizeValue } from "./canonical.js";
import { CharError, compareStrings } from "./errors.js";
import {
  type PresetDiff,
  PresetDiffSchema,
  type ResolvedPreset,
  ResolvedPresetSchema,
} from "./schema/preset.js";

function parsePreset(input: ResolvedPreset, side: "from" | "to"): ResolvedPreset {
  const parsed = ResolvedPresetSchema.safeParse(normalizeValue(input));
  if (!parsed.success) {
    throw new CharError({
      code: "schema.invalid",
      subject: `preset.${side}`,
      detail: parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    });
  }
  return { ...parsed.data, policy: canonicalPolicy(parsed.data.policy) };
}

function canonical(value: unknown): string {
  return value === undefined ? "" : jcs(normalizeValue(value));
}

function identity(preset: ResolvedPreset): PresetDiff["from"] {
  return { ref: preset.ref, release: preset.release, semantic_digest: preset.semantic_digest };
}

/**
 * 独立比较两个已解析策略，按稳定块 ID 配对；数组结果按 UTF-16 排序。
 * 不重新验证快照摘要，也不比较作品 metadata；原始快照须先通过 resolvePreset。
 */
export function diffPresets(from: ResolvedPreset, to: ResolvedPreset): PresetDiff {
  const a = parsePreset(from, "from");
  const b = parsePreset(to, "to");
  const before = new Map(a.policy.blocks.map((block) => [block.id, block]));
  const after = new Map(b.policy.blocks.map((block) => [block.id, block]));
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort(compareStrings);
  const blocks: PresetDiff["blocks"] = {
    added: [],
    removed: [],
    modified: [],
    order_changed: false,
  };
  const origin_changes: NonNullable<PresetDiff["origin_changes"]> = [];
  const blockFields = ["text", "position", "enabled"] as const;
  for (const id of ids) {
    const oldBlock = before.get(id);
    const newBlock = after.get(id);
    if (!oldBlock) blocks.added.push(id);
    else if (!newBlock) blocks.removed.push(id);
    else {
      const fields = blockFields
        .filter((field) => oldBlock[field] !== newBlock[field])
        .sort(compareStrings);
      if (fields.length > 0) blocks.modified.push({ id, fields });
      if (canonical(oldBlock.origin) !== canonical(newBlock.origin))
        origin_changes.push({
          id,
          ...(oldBlock.origin ? { from: oldBlock.origin } : {}),
          ...(newBlock.origin ? { to: newBlock.origin } : {}),
        });
    }
  }
  blocks.order_changed =
    canonical([...before.keys()].filter((id) => after.has(id))) !==
    canonical([...after.keys()].filter((id) => before.has(id)));
  const policyFields = ["version", "layout", "region_budgets", "requires"] as const;
  const policy_changes = policyFields
    .filter((field) => canonical(a.policy[field]) !== canonical(b.policy[field]))
    .sort(compareStrings);
  const oldLock = new Map((a.lock ?? []).map((entry) => [entry.ref, entry]));
  const newLock = new Map((b.lock ?? []).map((entry) => [entry.ref, entry]));
  const lock_changes: NonNullable<PresetDiff["lock_changes"]> = [];
  for (const ref of [...new Set([...oldLock.keys(), ...newLock.keys()])].sort(compareStrings)) {
    const from = oldLock.get(ref),
      to = newLock.get(ref);
    if (canonical(from) !== canonical(to))
      lock_changes.push({ ref, ...(from ? { from } : {}), ...(to ? { to } : {}) });
  }
  return PresetDiffSchema.parse({
    from: identity(a),
    to: identity(b),
    blocks,
    policy_changes,
    lock_changes,
    origin_changes,
  });
}
