import {
  AssemblyTraceSchema,
  type CreationInput,
  canonicalizeCreation,
  isCharError,
  PRESET_REGIONS,
  type PresetPolicy,
  resolvePreset,
} from "@char-pub/core";
import { describe, expect, it } from "vitest";
import { assemble } from "../src/assemble.js";
import { buildIR, charCounter, frag, profile, RELEASE, USER } from "./fixtures/ir.js";

const session = { bindings: { user: USER } };
const runtime = () =>
  profile({ capabilities: { system_role: true, multiple_system_messages: true } });

function preset(overrides: Partial<PresetPolicy> = {}) {
  const creation: CreationInput = {
    id: "cr_01h455vb4pex5vsknk084sn010",
    ref: "@djj/narrative",
    type: "preset",
    display_name: "Narrative",
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    policy: {
      version: "0-draft",
      blocks: [],
      layout: [...PRESET_REGIONS],
      requires: { system_role: true },
      ...overrides,
    },
  };
  return resolvePreset({
    creation,
    release: RELEASE,
    semantic_digest: canonicalizeCreation(creation).semantic_digest,
  });
}

function codeOf(fn: () => unknown) {
  try {
    fn();
    return undefined;
  } catch (error) {
    if (!isCharError(error)) throw error;
    return error.code;
  }
}

describe("explicit presets", () => {
  it("places policy and Creative content around unchanged history, with separate identity", () => {
    const ir = buildIR({
      fragments: [
        frag({ fid: "character", text: "Alice" }),
        frag({ fid: "style", kind: "style", text: "Brief" }),
      ],
    });
    const chosen = preset({
      blocks: [
        { id: "main", text: "Narrate", position: "main" },
        { id: "last", text: "Continue", position: "after-history" },
        { id: "off", text: "Omitted", position: "main", enabled: false },
      ],
      layout: [...PRESET_REGIONS.filter((r) => r !== "system:style"), "system:style"],
    });
    const input = {
      ir,
      preset: chosen,
      profile: runtime(),
      session: {
        ...session,
        history: [
          { role: "user" as const, text: "Hello" },
          { role: "assistant" as const, text: "Hi" },
        ],
      },
      counter: charCounter,
    };
    const before = JSON.stringify(input);
    const result = assemble(input);
    expect(result.messages.map((m) => m.content)).toEqual([
      "Narrate",
      "Alice",
      "Hello",
      "Hi",
      "Brief",
      "Continue",
    ]);
    expect(result.messages.map((m) => m.role)).toEqual([
      "system",
      "system",
      "user",
      "assistant",
      "system",
      "system",
    ]);
    expect(result.trace.ir.lock_digest).toBe(ir.lock_digest);
    expect(result.trace.preset).toEqual({
      ref: chosen.ref,
      release: chosen.release,
      semantic_digest: chosen.semantic_digest,
      resolver: chosen.resolver,
    });
    expect(result.trace.assembler?.layout).toBe("preset-v1");
    expect(result.trace.entries.find((e) => e.id === "preset:off")).toMatchObject({
      decision: "skipped",
      reason: "inactive",
      tokens: 0,
    });
    expect(result.trace.entries.find((e) => e.id === "preset:last")?.region).toBe(
      "preset:after-history",
    );
    expect(result.trace.total_tokens).toBe(32);
    expect(AssemblyTraceSchema.safeParse(result.trace).success).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("changes policy identity without changing the content IR", () => {
    const ir = buildIR({ fragments: [frag({ fid: "character" })] });
    const first = preset({ blocks: [{ id: "main", text: "First", position: "main" }] });
    const second = preset({ blocks: [{ id: "main", text: "Second", position: "main" }] });
    const a = assemble({ ir, preset: first, profile: runtime(), session });
    const b = assemble({ ir, preset: second, profile: runtime(), session });
    expect(a.trace.ir).toEqual(b.trace.ir);
    expect(a.trace.preset?.semantic_digest).not.toBe(b.trace.preset?.semantic_digest);
    expect(a.trace.entries.filter((e) => !e.id.startsWith("preset:"))).toEqual(
      b.trace.entries.filter((e) => !e.id.startsWith("preset:")),
    );
  });

  it("treats policy text as literal, without using the Creative template evaluator", () => {
    const chosen = preset({
      blocks: [{ id: "literal", text: "Literal {{user}}", position: "main" }],
    });
    const r = assemble({
      ir: buildIR({ fragments: [] }),
      preset: chosen,
      profile: runtime(),
      session,
    });
    expect(r.messages[0]?.content).toBe("Literal {{user}}");
  });

  it("does not resurrect private, inactive or scene-filtered Creative fragments", () => {
    const ir = buildIR({
      fragments: [
        frag({
          fid: "private",
          visibility: { scope: "private", to: ["user"] },
          importance: "pinned",
        }),
        frag({ fid: "scene", visibility: { scope: "scene", scene: "other" } }),
        frag({ fid: "inactive", activation: { mode: "manual" } }),
      ],
    });
    const r = assemble({
      ir,
      preset: preset(),
      profile: { ...runtime(), mode: "per-agent" },
      session,
    });
    expect(r.messages).toEqual([]);
    expect(r.trace.entries.map((e) => e.reason)).toEqual(["visibility", "visibility", "inactive"]);
  });

  it("validates a serialized ResolvedPreset at the assembly boundary", () => {
    const chosen = preset();
    chosen.policy.layout[0] = "history";
    expect(
      codeOf(() =>
        assemble({ ir: buildIR({ fragments: [] }), preset: chosen, profile: runtime(), session }),
      ),
    ).toBe("assemble.invalid_input");
  });
});

describe("preset budgeting", () => {
  const ir = buildIR({
    fragments: [
      frag({ fid: "knowledge", kind: "knowledge", text: "KKKKK" }),
      frag({ fid: "character", text: "CCCCC" }),
    ],
  });

  it("uses layout order only for explicit presets and preserves legacy IR priority", () => {
    const input = {
      ir,
      profile: { ...runtime(), context_window: 5 },
      session,
      counter: charCounter,
    };
    expect(assemble(input).messages[0]?.content).toBe("KKKKK");
    const explicit = assemble({ ...input, preset: preset() });
    expect(explicit.messages[0]?.content).toBe("CCCCC");
    expect(explicit.trace.entries[0]?.reason).toBe("budget");
    const legacy = assemble(input);
    expect(legacy.trace.preset).toBeUndefined();
    expect(legacy.trace.assembler?.layout).toBe("default-v1");
  });

  it("reserves all pinned before earlier normal fragments", () => {
    const r = assemble({
      ir: buildIR({
        fragments: [
          frag({ fid: "normal", text: "NNNNN" }),
          frag({ fid: "pinned", kind: "knowledge", text: "PPP", importance: "pinned" }),
        ],
      }),
      preset: preset(),
      profile: { ...runtime(), context_window: 5 },
      session,
      counter: charCounter,
    });
    expect(r.messages.map((m) => m.content)).toEqual(["PPP"]);
  });

  it("respects a zero region cap without treating it as a reservation", () => {
    const r = assemble({
      ir,
      preset: preset({ region_budgets: { "system:character": 0 } }),
      profile: { ...runtime(), context_window: 5 },
      session,
      counter: charCounter,
    });
    expect(r.messages[0]?.content).toBe("KKKKK");
    expect(r.trace.entries[1]?.reason).toBe("budget");
  });

  it("counts history and policy once, and excludes disabled policy blocks", () => {
    const chosen = preset({
      blocks: [
        { id: "main", text: "P", position: "main" },
        { id: "off", text: "long disabled block", position: "main", enabled: false },
      ],
    });
    const r = assemble({
      ir,
      preset: chosen,
      profile: { ...runtime(), context_window: 8 },
      session: { ...session, history: [{ role: "user", text: "HH" }] },
      counter: charCounter,
    });
    expect(r.trace.total_tokens).toBe(8);
    expect(r.messages.map((m) => m.content)).toEqual(["P", "CCCCC", "HH"]);
  });

  it("counts Session content once and does not apply Creative region caps to it", () => {
    const chosen = preset({ region_budgets: { "system:character": 0 } });
    const r = assemble({
      ir,
      preset: chosen,
      profile: runtime(),
      session: { ...session, overlay: { memory: ["Remember"] } },
      counter: charCounter,
    });
    expect(r.trace.entries.find((e) => e.id === "session:memory")?.decision).toBe("included");
    expect(r.trace.total_tokens).toBe(
      r.trace.entries.filter((e) => e.decision === "included").reduce((n, e) => n + e.tokens, 0),
    );
  });

  it.each(["history", "policy", "session"] as const)(
    "fails when fixed %s content alone exceeds the budget",
    (source) => {
      const chosen = preset({
        blocks: source === "policy" ? [{ id: "big", text: "XXXX", position: "main" }] : [],
      });
      expect(
        codeOf(() =>
          assemble({
            ir: buildIR({ fragments: [] }),
            preset: chosen,
            profile: { ...runtime(), context_window: 1 },
            session: {
              ...session,
              ...(source === "history"
                ? { history: [{ role: "user" as const, text: "XXXX" }] }
                : {}),
              ...(source === "session" ? { overlay: { memory: ["XXXX"] } } : {}),
            },
            counter: charCounter,
          }),
        ),
      ).toBe("assemble.fixed_over_budget");
    },
  );

  it("fails rather than trims pinned content that exceeds a region limit", () => {
    expect(
      codeOf(() =>
        assemble({
          ir: buildIR({ fragments: [frag({ fid: "pinned", text: "PP", importance: "pinned" })] }),
          preset: preset({ region_budgets: { "system:character": 1 } }),
          profile: runtime(),
          session,
          counter: charCounter,
        }),
      ),
    ).toBe("assemble.preset_region_over_budget");
  });

  it("fails when pinned exceeds global remaining budget", () => {
    expect(
      codeOf(() =>
        assemble({
          ir: buildIR({ fragments: [frag({ fid: "pinned", text: "PP", importance: "pinned" })] }),
          preset: preset(),
          profile: { ...runtime(), context_window: 1 },
          session,
          counter: charCounter,
        }),
      ),
    ).toBe("assemble.pinned_over_budget");
  });
});

describe("preset capability requirements", () => {
  const ir = buildIR({
    fragments: [
      frag({ fid: "one", text: "A" }),
      frag({ fid: "two", kind: "knowledge", text: "B" }),
    ],
  });

  it.each([{}, { system_role: false }])("requires explicit system support: %j", (capabilities) => {
    expect(
      codeOf(() => assemble({ ir, preset: preset(), profile: profile({ capabilities }), session })),
    ).toBe("assemble.preset_incompatible");
  });

  it("enforces explicit multiple-system requirements even for an empty conversation", () => {
    expect(
      codeOf(() =>
        assemble({
          ir,
          preset: preset({ requires: { system_role: true, multiple_system_messages: true } }),
          profile: profile({ capabilities: { system_role: true } }),
          session,
        }),
      ),
    ).toBe("assemble.preset_incompatible");
  });

  it("merges adjacent system messages without moving them across history", () => {
    const r = assemble({
      ir,
      preset: preset({ blocks: [{ id: "main", text: "P", position: "main" }] }),
      profile: profile({ capabilities: { system_role: true, multiple_system_messages: false } }),
      session: { ...session, history: [{ role: "user", text: "H" }] },
    });
    expect(r.messages.map((m) => [m.role, m.content])).toEqual([
      ["system", "P\n\nA\n\nB"],
      ["user", "H"],
    ]);
    expect(r.messages[0]?.source[0]).toBe("preset:main");
  });

  it("rejects separated system groups if the runtime cannot represent them", () => {
    expect(
      codeOf(() =>
        assemble({
          ir,
          preset: preset({ blocks: [{ id: "last", text: "P", position: "after-history" }] }),
          profile: profile({
            capabilities: { system_role: true, multiple_system_messages: false },
          }),
          session: { ...session, history: [{ role: "user", text: "H" }] },
        }),
      ),
    ).toBe("assemble.preset_incompatible");
  });

  it("does not count disabled after-history blocks as system groups", () => {
    const r = assemble({
      ir,
      preset: preset({
        blocks: [{ id: "off", text: "P", position: "after-history", enabled: false }],
      }),
      profile: profile({ capabilities: { system_role: true } }),
      session: { ...session, history: [{ role: "user", text: "H" }] },
    });
    expect(r.messages).toHaveLength(2);
  });

  it("allows a sole post-history system group and all-empty input", () => {
    const p = preset({ blocks: [{ id: "last", text: "P", position: "after-history" }] });
    const r = assemble({
      ir: buildIR({ fragments: [] }),
      preset: p,
      profile: profile({ capabilities: { system_role: true } }),
      session: { ...session, history: [{ role: "user", text: "H" }] },
    });
    expect(r.messages.map((m) => m.role)).toEqual(["user", "system"]);
    expect(
      assemble({ ir: buildIR({ fragments: [] }), preset: preset(), profile: runtime(), session })
        .messages,
    ).toEqual([]);
  });
});

describe("preset final message text budget", () => {
  const singleSystem = (limit: number) =>
    profile({
      context_window: limit,
      capabilities: { system_role: true, multiple_system_messages: false },
    });

  it("counts policy separators as fixed cost after single-system merging", () => {
    const chosen = preset({
      blocks: [
        { id: "a", text: "A", position: "main" },
        { id: "b", text: "B", position: "main" },
      ],
    });
    const input = { ir: buildIR({ fragments: [] }), preset: chosen, session, counter: charCounter };
    expect(codeOf(() => assemble({ ...input, profile: singleSystem(2) }))).toBe(
      "assemble.fixed_over_budget",
    );
    const r = assemble({ ...input, profile: singleSystem(4) });
    expect(r.messages[0]?.content).toBe("A\n\nB");
    expect(r.trace.total_tokens).toBe(4);
    expect(r.trace.entries.find((e) => e.id === "assembly:formatting")?.tokens).toBe(2);
  });

  it("skips a whole optional fragment if its joining separator would overflow", () => {
    const r = assemble({
      ir: buildIR({ fragments: [frag({ fid: "a", text: "A" }), frag({ fid: "b", text: "B" })] }),
      preset: preset(),
      profile: singleSystem(2),
      session,
      counter: charCounter,
    });
    expect(r.messages.map((m) => m.content)).toEqual(["A"]);
    expect(r.trace.entries[1]?.reason).toBe("budget");
  });

  it("does not trim pinned content to make room for formatting", () => {
    expect(
      codeOf(() =>
        assemble({
          ir: buildIR({
            fragments: [
              frag({ fid: "a", text: "A", importance: "pinned" }),
              frag({ fid: "b", text: "B", importance: "pinned" }),
            ],
          }),
          preset: preset(),
          profile: singleSystem(2),
          session,
          counter: charCounter,
        }),
      ),
    ).toBe("assemble.pinned_over_budget");
  });

  it("accounts for the examples region heading in global cost and Trace", () => {
    const r = assemble({
      ir: buildIR({ fragments: [frag({ fid: "example", kind: "examples", text: "A" })] }),
      preset: preset(),
      profile: runtime(),
      session,
      counter: charCounter,
    });
    expect(r.trace.total_tokens).toBe(r.messages.reduce((n, m) => n + m.content.length, 0));
    expect(r.trace.entries.find((e) => e.id === "assembly:formatting")?.tokens).toBeGreaterThan(0);
  });
});
