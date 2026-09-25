import { canonicalizeCreation, resolvePreset } from "@char-pub/core";
import { describe, expect, it } from "vitest";
import { exportCCv3 } from "../src/export.js";
import { exportPolicyFields, importPolicyPreset } from "../src/policy.js";
import { singleCreationIR } from "./single-creation-ir.js";

const report = {
  format: "ccv3",
  source_digest: `sha256:${"a".repeat(64)}` as const,
  omitted_policy_fields: [
    { field: "system_prompt", value: "Stay in {{char}}'s voice." },
    { field: "post_history_instructions", value: "Leave room for a reply." },
    { field: "unknown", value: "Do not restore me." },
  ],
};
const options = {
  id: "cr_01h455vb4pex5vsknk084sn001",
  ref: "@test/policy",
  display_name: "Policy",
  authors: [{ name: "Original Creator" }],
  meta: {
    default_locale: "en",
    rating: "general" as const,
    rights: "licensed" as const,
    license: "CC-BY-4.0",
  },
};

describe("explicit CCv3 policy conversion", () => {
  it("creates an independently identified preset, preserving literal text and confirmed rights", () => {
    const creation = importPolicyPreset(report, options);
    expect(creation.type).toBe("preset");
    expect(creation.authors).toEqual([{ name: "Original Creator" }]);
    expect(creation.meta).toEqual(options.meta);
    expect(creation.policy?.blocks.map((block) => block.text)).toEqual(
      report.omitted_policy_fields.slice(0, 2).map((field) => field.value),
    );
    expect(creation.provenance?.imported_from).toEqual({
      format: report.format,
      source_digest: report.source_digest,
    });
    const canonical = canonicalizeCreation(creation);
    const preset = resolvePreset({
      creation,
      release: "rel_01h455vb4pex5vsknk084sn001",
      semantic_digest: canonical.semantic_digest,
    });
    const exported = exportPolicyFields(preset);
    expect(exported.fields.system_prompt).toBe(report.omitted_policy_fields[0]?.value);
    expect(exported.fields.post_history_instructions).toBe(report.omitted_policy_fields[1]?.value);
    expect(exported.losses.map((loss) => loss.subject)).toEqual([
      "policy.layout",
      "policy.requires",
      "policy.blocks",
    ]);
  });
  it("does not create an empty preset or restore unknown fields", () => {
    expect(() =>
      importPolicyPreset(
        { ...report, omitted_policy_fields: [{ field: "unknown", value: "x" }] },
        options,
      ),
    ).toThrow("ccv3.policy_empty");
  });
  it("omits disabled blocks and reports budgets as unenforceable", () => {
    const creation = importPolicyPreset(report, options);
    if (!creation.policy) throw new Error("policy missing");
    const first = creation.policy.blocks[0];
    if (!first) throw new Error("block missing");
    first.enabled = false;
    creation.policy.region_budgets = { "system:character": 25 };
    const canonical = canonicalizeCreation(creation);
    const exported = exportPolicyFields(
      resolvePreset({
        creation,
        release: "rel_01h455vb4pex5vsknk084sn001",
        semantic_digest: canonical.semantic_digest,
      }),
    );
    expect(exported.fields.system_prompt).toBe("");
    expect(exported.losses).toContainEqual(
      expect.objectContaining({ subject: "policy.region_budgets" }),
    );
  });
});

it("keeps selected policy attribution and exact release identity in exported cards", () => {
  const creation = importPolicyPreset(report, options);
  const canonical = canonicalizeCreation(creation);
  const preset = resolvePreset({
    creation,
    release: "rel_01h455vb4pex5vsknk084sn001",
    semantic_digest: canonical.semantic_digest,
  });
  const ir = singleCreationIR({
    id: "cr_01h455vb4pex5vsknk084sn002",
    ref: "@test/actor",
    type: "character",
    display_name: "Actor",
    meta: options.meta,
    fragments: [
      {
        id: "description",
        stable: true,
        kind: "character",
        content: { type: "text", text: "A thoughtful traveller." },
      },
    ],
  });
  const result = exportCCv3(ir, {
    resolvedPreset: preset,
    presetMeta: {
      rating: "mature",
      content_warnings: ["violence"],
      attribution: [{ ref: preset.ref, authors: [{ name: "Policy Author" }] }],
      licenses: [{ ref: preset.ref, license: "CC-BY-4.0" }],
    },
  });
  expect(result.card.data.creator_notes).toContain("@test/policy: Policy Author");
  expect(result.card.data.creator_notes).toContain("Rating: mature");
  expect(result.card.data.creator_notes).toContain("Content warnings: violence");
  expect(result.card.data.creator_notes).toContain("@test/policy: CC-BY-4.0");
  expect(result.card.data.extensions.char_pub).toMatchObject({
    preset: { ref: preset.ref, release: preset.release, semantic_digest: preset.semantic_digest },
  });
  expect(result.loss.other.some((item) => item.subject === "policy.attribution")).toBe(false);
  expect(
    exportCCv3(ir, { resolvedPreset: preset }).loss.other.some(
      (item) => item.subject === "policy.attribution",
    ),
  ).toBe(true);
});

it("marks an explicitly selected policy's rating unverified when metadata is absent", () => {
  const creation = importPolicyPreset(report, options);
  const canonical = canonicalizeCreation(creation);
  const preset = resolvePreset({
    creation,
    release: "rel_01h455vb4pex5vsknk084sn001",
    semantic_digest: canonical.semantic_digest,
  });
  const ir = singleCreationIR({
    id: "cr_01h455vb4pex5vsknk084sn002",
    ref: "@test/actor",
    type: "character",
    display_name: "Actor",
    meta: options.meta,
    fragments: [
      {
        id: "description",
        stable: true,
        kind: "character",
        content: { type: "text", text: "A traveller." },
      },
    ],
  });
  const result = exportCCv3(ir, { resolvedPreset: preset });
  expect(result.card.data.creator_notes).toContain("Rating: unverified");
  expect(result.loss.other.some((item) => item.subject === "policy.rating")).toBe(true);
});
