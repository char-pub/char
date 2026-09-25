import { describe, expect, it } from "vitest";
import { canonicalizeCreation } from "../src/canonical.js";
import { checkCreation } from "../src/check.js";
import { resolvePreset } from "../src/preset.js";
import { type CreationInput, CreationSchema } from "../src/schema/creation.js";
import { PRESET_REGIONS, type PresetPolicy, PresetPolicySchema } from "../src/schema/policy.js";
import { ResolvedPresetSchema } from "../src/schema/preset.js";
import { RESOLVER } from "../src/version.js";
import { D, level0Character, tid } from "./fixtures.js";

function policy(overrides: Partial<PresetPolicy> = {}): PresetPolicy {
  return {
    version: "0-draft",
    blocks: [
      { id: "main", text: "Follow the selected narrative perspective.", position: "main" },
      { id: "reminder", text: "Leave choices to the player.", position: "after-history" },
    ],
    layout: [...PRESET_REGIONS],
    requires: { system_role: true, multiple_system_messages: true },
    ...overrides,
  };
}

function preset(overrides: Partial<CreationInput> = {}): CreationInput {
  return level0Character({
    type: "preset",
    ref: "@djj/narrative",
    fragments: [],
    bootstrap: undefined,
    policy: policy(),
    ...overrides,
  });
}

describe("Preset schema boundaries", () => {
  it("requires a policy only for preset creations", () => {
    expect(CreationSchema.safeParse(preset()).success).toBe(true);
    expect(CreationSchema.safeParse(preset({ policy: undefined })).success).toBe(false);
    expect(CreationSchema.safeParse(level0Character({ policy: policy() })).success).toBe(false);
  });

  it.each([
    { fragments: level0Character().fragments },
    { references: [{ id: "world", use: "@djj/world", mode: "intrinsic" }] },
    { slots: { partner: { accepts: "character" } } },
    { params: { tone: { type: "string", default: "quiet" } } },
    { cast: [{ key: "lead", who: "@djj/alice" }] },
    { bootstrap: level0Character().bootstrap },
    { assets: [{ ...level0Character().assets?.[0], role: "context" }] },
  ])("rejects Creative fields: %j", (fields) => {
    expect(CreationSchema.safeParse({ ...preset(), ...fields }).success).toBe(false);
  });

  it("accepts empty optional Creative collections and presentation assets", () => {
    const result = canonicalizeCreation(
      preset({ slots: {}, params: {}, cast: [], references: [] }),
    );
    expect(checkCreation(result.creation).ok).toBe(true);
    expect(result.json).not.toHaveProperty("cast");
    expect(result.creation.assets[0]?.role).toBe("presentation");
    expect(
      resolvePreset({
        semantic_digest: result.semantic_digest,
        creation: result.json,
        release: tid("rel", 1),
      }).policy,
    ).toEqual(result.creation.policy);
  });

  it("requires each layout region exactly once, permitting either side of history", () => {
    expect(
      PresetPolicySchema.safeParse(policy({ layout: [...PRESET_REGIONS].reverse() })).success,
    ).toBe(true);
    for (const layout of [
      PRESET_REGIONS.slice(1),
      [...PRESET_REGIONS, "history"],
      [...PRESET_REGIONS.slice(1), "history"],
      [...PRESET_REGIONS.slice(1), "unknown"],
    ]) {
      expect(PresetPolicySchema.safeParse({ ...policy(), layout }).success).toBe(false);
    }
  });

  it("requires unique stable block IDs, nonblank literal text and known fields", () => {
    const block = policy().blocks[0];
    for (const blocks of [
      [block, block],
      [{ ...block, id: "invalid/id" }],
      [{ ...block, text: " \n\t" }],
      [{ ...block, text: "" }],
      [{ ...block, text: { type: "script", source: "x" } }],
      [{ ...block, position: "history-depth", depth: 2 }],
    ]) {
      expect(PresetPolicySchema.safeParse({ ...policy(), blocks }).success).toBe(false);
    }
    expect(PresetPolicySchema.safeParse({ ...policy(), imports: [] }).success).toBe(false);
    expect(PresetPolicySchema.safeParse(policy({ blocks: [] })).success).toBe(true);
  });

  it("restricts budget keys to Creative regions and values to safe nonnegative integers", () => {
    for (const region_budgets of [
      { history: 10 },
      { "session:memory": 10 },
      { "system:world": -1 },
      { "system:world": 0.1 },
      { "system:world": Number.MAX_SAFE_INTEGER + 1 },
      { "system:world": Number.POSITIVE_INFINITY },
    ]) {
      expect(PresetPolicySchema.safeParse({ ...policy(), region_budgets }).success).toBe(false);
    }
    expect(
      PresetPolicySchema.safeParse(policy({ region_budgets: { "system:world": 0 } })).success,
    ).toBe(true);
  });

  it("requires explicit system capability and accepts only affirmative optional requirements", () => {
    for (const requires of [
      {},
      { system_role: false },
      { system_role: true, multiple_system_messages: false },
      { system_role: true, scripts: true },
    ]) {
      expect(PresetPolicySchema.safeParse({ ...policy(), requires }).success).toBe(false);
    }
    expect(PresetPolicySchema.safeParse(policy({ requires: { system_role: true } })).success).toBe(
      true,
    );
  });
});

describe("Preset canonical identity", () => {
  it("normalizes text and strips enabled=true and empty budgets without changing identity", () => {
    const implicit = preset({
      policy: policy({ blocks: [{ id: "main", text: "Café\n{{self}}", position: "main" }] }),
    });
    const explicit = preset({
      policy: policy({
        blocks: [{ id: "main", text: "Café  \r\n{{self}}\t", position: "main", enabled: true }],
        region_budgets: {},
      }),
    });
    const a = canonicalizeCreation(implicit);
    const b = canonicalizeCreation(explicit);
    expect(b.semantic_digest).toBe(a.semantic_digest);
    expect(b.creation.policy).toEqual(a.creation.policy);
    expect(b.creation.policy).not.toHaveProperty("region_budgets");
    expect(b.creation.policy?.blocks[0]).not.toHaveProperty("enabled");
    expect(canonicalizeCreation(b.json).json).toEqual(b.json);
    expect(checkCreation(b.creation).diagnostics).toEqual([]);
  });

  it("includes block text, order, enabled state, layout and budgets in the digest", () => {
    const original = canonicalizeCreation(preset()).semantic_digest;
    const blocks = policy().blocks;
    const first = blocks[0];
    if (!first) throw new Error("fixture requires first block");
    for (const changed of [
      policy({ blocks: [{ ...first, text: "Changed" }, ...blocks.slice(1)] }),
      policy({ blocks: [...blocks].reverse() }),
      policy({ blocks: [{ ...first, enabled: false }, ...blocks.slice(1)] }),
      policy({ layout: [...PRESET_REGIONS].reverse() }),
      policy({ region_budgets: { "system:world": 0 } }),
    ]) {
      expect(canonicalizeCreation(preset({ policy: changed })).semantic_digest).not.toBe(original);
    }
  });

  it("preserves the existing character digest", () => {
    expect(canonicalizeCreation(level0Character()).semantic_digest).toBe(
      "sha256:1233b291b3ea4192d887ba4f72fcb0e36205b645f8ca87d570cef61dd8e76eae",
    );
  });
});

describe("resolvePreset", () => {
  const creation = preset();
  const semantic_digest = canonicalizeCreation(creation).semantic_digest;
  const input = { creation, release: tid("rel", 1), semantic_digest };

  it("returns exact release identity, resolver identity and canonical policy only", () => {
    const resolved = resolvePreset(input);
    expect(resolved).toEqual({
      ref: creation.ref,
      release: input.release,
      semantic_digest,
      resolver: RESOLVER,
      policy: policy(),
    });
    expect(ResolvedPresetSchema.safeParse(resolved).success).toBe(true);
    expect(resolved).not.toHaveProperty("assets");
    expect(input.creation).toEqual(creation);
  });

  it("rejects digest tampering including changes outside policy", () => {
    expect(() => resolvePreset({ ...input, semantic_digest: D("b") })).toThrow(
      "resolve.semantic_digest_mismatch",
    );
    expect(() =>
      resolvePreset({ ...input, creation: { ...creation, display_name: "Tampered" } }),
    ).toThrow("resolve.semantic_digest_mismatch");
    expect(() =>
      resolvePreset({ ...input, creation: preset({ policy: policy({ blocks: [] }) }) }),
    ).toThrow("resolve.semantic_digest_mismatch");
  });

  it.each(["latest", "@djj/narrative@v1", tid("cr", 1)])(
    "rejects non-release identity %s",
    (release) => {
      expect(() => resolvePreset({ ...input, release })).toThrow("schema.invalid");
    },
  );

  it("rejects malformed digests, non-Presets, unknown snapshot fields and static errors", () => {
    expect(() => resolvePreset({ ...input, semantic_digest: "untrusted" })).toThrow(
      "schema.invalid",
    );
    expect(() => resolvePreset({ ...input, creation: level0Character() })).toThrow(
      "resolve.not_preset",
    );
    expect(() => resolvePreset({ ...input, creation: { ...creation, arbitrary: true } })).toThrow(
      "schema.invalid",
    );
    const assets = creation.assets ?? [];
    const duplicateAssets = preset({ assets: [...assets, ...assets] });
    expect(() =>
      resolvePreset({
        ...input,
        creation: duplicateAssets,
        semantic_digest: canonicalizeCreation(duplicateAssets).semantic_digest,
      }),
    ).toThrow("resolve.invalid_preset");
  });
});
