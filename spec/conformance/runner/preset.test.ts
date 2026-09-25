/** 三个 Runtime 读取同一份完整 fixture，检验 draft trace 比较没有覆盖的消息与策略身份。 */
import { assemble } from "@char-pub/assembler";
import { canonicalizeCreation, PRESET_REGIONS, resolve, resolvePreset } from "@char-pub/core";
import { describe, expect, it } from "vitest";
import { runAssembleScenarios } from "./assemble.js";
import bundleJson from "./cases.gen.json" with { type: "json" };
import type { AssembleScenario, Bundle } from "./types.js";

const cases = (bundleJson as unknown as Bundle).cases;

function fixture(id: string) {
  const c = cases.find((item) => item.dir === id);
  if (!c?.input.root || !c.input.assemble) throw new Error(`missing fixture ${id}`);
  return {
    ir: resolve({ root: c.input.root, dependencies: c.input.deps }).ir,
    scenarios: c.input.assemble.scenarios,
    meta: c.meta,
    expected: c.expected,
  };
}

function assembleScenario(ir: ReturnType<typeof resolve>["ir"], s: AssembleScenario) {
  return assemble({
    ir,
    profile: s.profile as Parameters<typeof assemble>[0]["profile"],
    session: s.session as Parameters<typeof assemble>[0]["session"],
    ...(s.preset ? { preset: resolvePreset(s.preset) } : {}),
  });
}

describe("Preset conformance fixture semantics", () => {
  for (const position of ["main", "after-history", "both"] as const) {
    for (const multipleSystemMessages of [true, false]) {
      it(`allows literal policy placeholders at ${position}, multiple system=${multipleSystemMessages}, while detecting matching Session text`, () => {
        const { ir, scenarios } = fixture("014-preset-layout");
        const original = scenarios[0];
        if (!original?.preset) throw new Error("missing preset fixture");
        const literal = "Literal {{late:user}}";
        const positions = position === "both" ? ["main", "after-history"] : [position];
        const base = canonicalizeCreation(original.preset.creation).creation;
        const canonical = canonicalizeCreation({
          ...base,
          policy: {
            version: "0-draft",
            blocks: positions.map((p, i) => ({ id: `literal-${i}`, text: literal, position: p })),
            layout: [...PRESET_REGIONS],
            requires: { system_role: true },
          },
        });
        const scenario: AssembleScenario = {
          name: "literal-policy",
          preset: {
            creation: canonical.json,
            release: original.preset.release,
            semantic_digest: canonical.semantic_digest,
          },
          profile: {
            ...(original.profile as Parameters<typeof assemble>[0]["profile"]),
            capabilities: { system_role: true, multiple_system_messages: multipleSystemMessages },
          },
          session: { bindings: { user: { kind: "persona", display_name: "Sam" } }, history: [] },
        };
        const messages = assembleScenario(ir, scenario).messages;
        expect(messages.some((m) => m.content.includes(literal))).toBe(true);
        if (!multipleSystemMessages) {
          expect(messages).toHaveLength(1);
          expect(messages[0]?.source.some((s) => s.startsWith("preset:"))).toBe(true);
          expect(messages[0]?.source.some((s) => s.startsWith("@fixture/alice#"))).toBe(true);
        }
        expect(runAssembleScenarios(ir, { scenarios: [scenario] }).violations).toEqual([]);

        const withResidual = {
          ...scenario,
          session: {
            ...(scenario.session as Parameters<typeof assemble>[0]["session"]),
            overlay: { memory: [literal] },
          },
        };
        const result = runAssembleScenarios(ir, { scenarios: [withResidual] });
        expect(result.expectation.scenarios[0]).not.toHaveProperty("error");
        expect(result.violations).toHaveLength(1);
        expect(result.violations[0]).toContain("placeholder reached the model messages");
      });
    }
  }

  it("uses valid canonical snapshots without accepting draft output", () => {
    for (const id of ["014-preset-layout", "015-preset-budget-capabilities"]) {
      const f = fixture(id);
      expect(f.meta.status).toBe("draft");
      expect(f.expected).toEqual({});
      for (const s of f.scenarios) {
        if (!s.preset) continue;
        const canonical = canonicalizeCreation(s.preset.creation);
        expect(canonical.semantic_digest).toBe(s.preset.semantic_digest);
        expect(canonical.json).toEqual(s.preset.creation);
        expect(resolvePreset(s.preset)).toMatchObject({
          ref: "@fixture/narrator",
          release: s.preset.release,
          semantic_digest: s.preset.semantic_digest,
        });
      }
    }
  });

  it("places style after actual history and keeps policy provenance separate from Creative IR", () => {
    const { ir, scenarios } = fixture("014-preset-layout");
    const s = scenarios.find((item) => item.name === "explicit-layout");
    if (!s?.preset) throw new Error("missing explicit policy scenario");
    const before = JSON.stringify(ir);
    const result = assembleScenario(ir, s);
    const messages = result.messages;
    const indexOf = (text: string) => messages.findIndex((m) => m.content.includes(text));
    expect(indexOf("Portray the selected cast.")).toBeGreaterThanOrEqual(0);
    expect(indexOf("Portray the selected cast.")).toBeLessThan(indexOf("Alice is a courier."));
    expect(indexOf("The bridge is closed.")).toBeLessThan(indexOf("Where should we go?"));
    expect(indexOf("Where should we go?")).toBeLessThan(indexOf("Use concise dialogue."));
    expect(indexOf("Where should we go?")).toBeLessThan(indexOf("Continue with the next reply."));
    expect(messages[indexOf("Where should we go?")]?.role).toBe("user");
    expect(messages[indexOf("Continue with the next reply.")]?.role).toBe("system");
    expect(JSON.stringify(messages)).not.toContain("This block must never be sent.");
    expect(result.trace.entries.find((e) => e.origin?.fragment === "style")).toMatchObject({
      region: "system:style",
      decision: "included",
    });
    expect(
      result.trace.entries.filter((e) => e.id.startsWith("preset:") && e.decision === "included"),
    ).toHaveLength(2);
    expect(result.trace).toMatchObject({
      preset: {
        ref: "@fixture/narrator",
        release: s.preset.release,
        semantic_digest: s.preset.semantic_digest,
      },
    });
    expect(result.trace.ir).toEqual({ root: ir.root.ref, lock_digest: ir.lock_digest });
    expect(JSON.stringify(ir)).toBe(before);
  });

  it("preserves the default messages when no Preset was selected", () => {
    const { ir, scenarios } = fixture("014-preset-layout");
    const s = scenarios.find((item) => item.name === "default-layout");
    if (!s) throw new Error("missing default scenario");
    const result = assembleScenario(ir, s);
    expect(result.messages.map((m) => ({ role: m.role, content: m.content }))).toEqual([
      { role: "system", content: "Alice is a courier." },
      { role: "system", content: "The bridge is closed." },
      { role: "system", content: "Use concise dialogue." },
      { role: "user", content: "Where should we go?" },
    ]);
    expect(result.trace.entries.some((e) => e.id.startsWith("preset:"))).toBe(false);
  });

  it("applies a regional cap only to its Creative candidates", () => {
    const { ir, scenarios } = fixture("015-preset-budget-capabilities");
    const s = scenarios.find((item) => item.name === "knowledge-cap");
    if (!s) throw new Error("missing capped scenario");
    const result = assembleScenario(ir, s);
    expect(result.trace.entries.find((e) => e.origin?.fragment === "knowledge")).toMatchObject({
      region: "system:knowledge",
      decision: "skipped",
      reason: "budget",
    });
    const text = result.messages.map((m) => m.content).join("\n");
    expect(text).not.toContain("The bridge is closed.");
    expect(text).toContain("Alice is a courier.");
    expect(text).toContain("Use concise dialogue.");
    expect(text).toContain("Continue with the next reply.");
  });

  it("reports specific errors for fixed/pinned budgets and unsupported message capabilities", () => {
    const { ir, scenarios } = fixture("015-preset-budget-capabilities");
    const result = runAssembleScenarios(ir, { scenarios });
    expect(result.violations).toEqual([]);
    const errors = Object.fromEntries(
      result.expectation.scenarios.flatMap((s) => ("error" in s ? [[s.name, s.error.code]] : [])),
    );
    expect(errors).toEqual({
      "pinned-region-cap": "assemble.preset_region_over_budget",
      "fixed-over-budget": "assemble.fixed_over_budget",
      "missing-system": "assemble.preset_incompatible",
      "split-system-unsupported": "assemble.preset_incompatible",
    });
  });
});
