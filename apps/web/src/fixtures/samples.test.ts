import { assemble } from "@char-pub/assembler";
import { diffContextIR } from "@char-pub/core";
import { describe, expect, it } from "vitest";
import { diffPair, locksOf, resolveSample, samples } from "./samples";

describe("sample creations", () => {
  it.each(samples.map((s) => [s.id, s] as const))("%s resolves and assembles", (_id, s) => {
    const out = resolveSample(s);
    expect(out.ir.fragments.length).toBeGreaterThan(0);
    const bindings = Object.fromEntries(
      out.ir.late_slots
        .filter((l) => l.required)
        .map((l) => [l.key, { kind: l.accepts[0] ?? "persona", display_name: "Sam" }]),
    );
    const r = assemble({
      ir: out.ir,
      profile: {
        runtime: { name: "test", version: "0" },
        tokenizer: "estimate",
        context_window: 8000,
        reserve_for_output: 500,
        mode: "narrator",
        capabilities: {},
      },
      session: { bindings, history: [{ role: "user", text: "Tell me about Arasaka" }] },
    });
    expect(r.trace.entries.length).toBeGreaterThan(0);
  });

  it("the world upgrade raises rating and changes license", () => {
    const d = diffContextIR(resolveSample(diffPair.from).ir, resolveSample(diffPair.to).ir, {
      locks: { from: locksOf(diffPair.from), to: locksOf(diffPair.to) },
      countTokens: (t) => Math.ceil(t.length / 4),
    });
    expect(d.meta_changes.map((m) => m.field)).toEqual(
      expect.arrayContaining(["rating", "licenses", "content_warnings"]),
    );
    expect(d.fragments.added.length).toBe(1);
    expect(d.fragments.modified.length).toBeGreaterThan(0);
    expect(d.lock_changes).toContainEqual({
      ref: "@cyberpunk/night-city",
      from: "1.0.0",
      to: "2.0.0",
    });
  });
});
