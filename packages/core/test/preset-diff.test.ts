import { describe, expect, it } from "vitest";
import { canonicalizeCreation } from "../src/canonical.js";
import { resolvePreset } from "../src/preset.js";
import { diffPresets } from "../src/preset-diff.js";
import { PRESET_REGIONS, type PresetBlock, type PresetPolicy } from "../src/schema/policy.js";
import { PresetDiffSchema, type ResolvedPreset } from "../src/schema/preset.js";
import { level0Character, tid } from "./fixtures.js";

function block(id: string, extra: Partial<PresetBlock> = {}): PresetBlock {
  return { id, text: `Text for ${id}`, position: "main", ...extra };
}

function resolved(
  overrides: Partial<PresetPolicy> = {},
  release = 1,
  displayName = "Preset",
): ResolvedPreset {
  const creation = level0Character({
    type: "preset",
    fragments: [],
    bootstrap: undefined,
    display_name: displayName,
    policy: {
      version: "0-draft",
      blocks: [block("alpha"), block("bravo"), block("charlie")],
      layout: [...PRESET_REGIONS],
      requires: { system_role: true },
      ...overrides,
    },
  });
  return resolvePreset({
    creation,
    release: tid("rel", release),
    semantic_digest: canonicalizeCreation(creation).semantic_digest,
  });
}

describe("diffPresets", () => {
  it("matches stable IDs, reports sorted additions/removals/fields and detects shared-block reorder", () => {
    const from = resolved({
      blocks: [block("gone-z"), block("gone-a"), block("bravo"), block("alpha")],
    });
    const to = resolved(
      {
        blocks: [
          block("new-z"),
          block("alpha", { text: "Different", position: "after-history", enabled: false }),
          block("bravo", { enabled: false }),
          block("new-a"),
        ],
      },
      2,
    );
    const diff = diffPresets(from, to);
    expect(diff.blocks).toEqual({
      added: ["new-a", "new-z"],
      removed: ["gone-a", "gone-z"],
      modified: [
        { id: "alpha", fields: ["enabled", "position", "text"] },
        { id: "bravo", fields: ["enabled"] },
      ],
      order_changed: true,
    });
    expect(diff.policy_changes).toEqual([]);
    expect(diff.from).toEqual({
      ref: from.ref,
      release: from.release,
      semantic_digest: from.semantic_digest,
    });
    expect(diff.to).toEqual({
      ref: to.ref,
      release: to.release,
      semantic_digest: to.semantic_digest,
    });
    expect(PresetDiffSchema.safeParse(diff).success).toBe(true);
  });

  it("does not report insertion/deletion alone as shared-block reordering", () => {
    const from = resolved();
    const to = resolved({ blocks: [block("new"), block("alpha"), block("charlie")] });
    expect(diffPresets(from, to).blocks).toEqual({
      added: ["new"],
      removed: ["bravo"],
      modified: [],
      order_changed: false,
    });
  });

  it("detects reordering even without changed text or membership", () => {
    const from = resolved();
    const to = resolved({
      blocks: [...from.policy.blocks].reverse().map(({ origin: _origin, ...block }) => block),
    });
    expect(diffPresets(from, to).blocks).toEqual({
      added: [],
      removed: [],
      modified: [],
      order_changed: true,
    });
  });

  it("compares canonical text, explicit defaults and budget maps without false changes", () => {
    const from = resolved({ blocks: [block("a", { text: "Café\n{{self}}" })] });
    const to: ResolvedPreset = {
      ...from,
      policy: {
        ...from.policy,
        blocks: [block("a", { text: "Café  \r\n{{self}}\t", enabled: true })],
        region_budgets: {},
      },
    };
    expect(diffPresets(from, to).blocks).toEqual({
      added: [],
      removed: [],
      modified: [],
      order_changed: false,
    });
    expect(diffPresets(from, to).policy_changes).toEqual([]);
    expect(to.policy.blocks[0]?.enabled).toBe(true);
    expect(to.policy.blocks[0]?.text).toContain("\r\n");
    const budgetsA = resolved({ region_budgets: { "system:world": 10, "system:style": 0 } });
    const budgetsB = resolved({ region_budgets: { "system:style": 0, "system:world": 10 } });
    expect(diffPresets(budgetsA, budgetsB).policy_changes).toEqual([]);
  });

  it("reports layout, budget and capability changes in deterministic field order", () => {
    const from = resolved();
    const to = resolved({
      layout: [...PRESET_REGIONS].reverse(),
      region_budgets: { "system:style": 0 },
      requires: { system_role: true, multiple_system_messages: true },
    });
    expect(diffPresets(from, to).policy_changes).toEqual(["layout", "region_budgets", "requires"]);
    expect(diffPresets(to, from).policy_changes).toEqual(["layout", "region_budgets", "requires"]);
  });

  it("keeps snapshot identity changes visible without claiming metadata or resolver changes are policy changes", () => {
    const from = resolved();
    const to = resolved({}, 2, "Renamed Preset");
    to.resolver = { name: "another-resolver", version: "1.0.0" };
    const diff = diffPresets(from, to);
    expect(diff.from.semantic_digest).not.toBe(diff.to.semantic_digest);
    expect(diff.from.release).not.toBe(diff.to.release);
    expect(diff.blocks).toEqual({ added: [], removed: [], modified: [], order_changed: false });
    expect(diff.policy_changes).toEqual([]);
  });

  it("rejects invalid inputs on either side before comparing", () => {
    const valid = resolved();
    const invalid = [
      { ...valid, release: "latest" },
      { ...valid, semantic_digest: "untrusted" },
      { ...valid, unknown: true },
      { ...valid, policy: { ...valid.policy, version: "future" } },
      { ...valid, policy: { ...valid.policy, blocks: [block("duplicate"), block("duplicate")] } },
      { ...valid, policy: { ...valid.policy, layout: ["history"] } },
    ];
    for (const input of invalid) {
      expect(() => diffPresets(input as ResolvedPreset, valid)).toThrow(
        "schema.invalid (preset.from)",
      );
      expect(() => diffPresets(valid, input as ResolvedPreset)).toThrow(
        "schema.invalid (preset.to)",
      );
    }
  });
});
