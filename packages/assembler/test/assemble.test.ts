import { isCharError, lateSlotKey, participantKey } from "@char-pub/core";
import { describe, expect, it } from "vitest";
import { assemble, regionFor, startSession } from "../src/assemble.js";
import type { SessionInput } from "../src/session.js";
import {
  asset,
  buildIR,
  charCounter,
  frag,
  profile,
  ROOT_REF,
  SELF,
  text,
  USER,
  userSlot,
} from "./fixtures/ir.js";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return isCharError(e) ? e.code : `non-char:${String(e)}`;
  }
  return undefined;
}

/** 只比较 decision / reason，不比较 token 数。 */
function decisions(r: ReturnType<typeof assemble>): Record<string, string> {
  return Object.fromEntries(r.trace.entries.map((e) => [e.id, `${e.decision}:${e.reason}`]));
}

const baseSession: SessionInput = { bindings: { user: USER } };

describe("level 0 character", () => {
  const ir = buildIR({
    fragments: [frag({ fid: "description", text: "{{late:user}} is Alice's partner." })],
    late_slots: [userSlot([`${ROOT_REF}#description~root`])],
  });

  it("includes the always fragment and binds {{user}} to the session persona", () => {
    const r = assemble({ ir, profile: profile(), session: baseSession });
    const d = r.trace.entries[0];
    expect(d?.decision).toBe("included");
    expect(d?.reason).toBe("always");
    expect(d?.region).toBe("system:character");
    expect(d?.origin?.fragment).toBe("description");
    expect(r.messages).toEqual([
      {
        role: "system",
        content: "Kai is Alice's partner.",
        source: [`${ROOT_REF}#description~root`],
      },
    ]);
    expect(JSON.stringify(r.messages)).not.toContain("{{");
    expect(r.trace.estimated).toBe(true);
    expect(r.trace.profile.tokenizer).toBe("estimate");
    expect(r.trace.ir).toEqual({ root: ROOT_REF, lock_digest: ir.lock_digest });
  });

  it("fails when the session user persona is not bound", () => {
    expect(codeOf(() => assemble({ ir, profile: profile(), session: { bindings: {} } }))).toBe(
      "assemble.late_slot_unbound",
    );
  });

  it("rejects binding a character into a persona-only slot", () => {
    const session = { bindings: { user: { kind: "character" as const, display_name: "Bob" } } };
    expect(codeOf(() => assemble({ ir, profile: profile(), session }))).toBe(
      "assemble.late_slot_kind_mismatch",
    );
  });

  it("does not modify the IR", () => {
    const before = JSON.stringify(ir);
    assemble({ ir, profile: profile(), session: baseSession });
    expect(JSON.stringify(ir)).toBe(before);
  });

  it("rejects invalid input", () => {
    expect(
      codeOf(() =>
        assemble({
          ir: { ...ir, ir_version: "1" } as never,
          profile: profile(),
          session: baseSession,
        }),
      ),
    ).toBe("assemble.invalid_input");
    expect(
      codeOf(() =>
        assemble({
          ir,
          profile: profile(),
          session: { bindings: { user: { kind: "persona" } } } as never,
        }),
      ),
    ).toBe("assemble.invalid_input");
  });
});

describe("late slots", () => {
  const inst = "root";
  const friendSlot = lateSlotKey(inst, "friend");
  const rivalSlot = lateSlotKey(inst, "rival");

  it("fails when a required non-user late slot is missing", () => {
    const ir = buildIR({
      fragments: [
        frag({
          fid: "bond",
          kind: "relationship",
          text: `Alice trusts {{late:${friendSlot}}}.`,
        }),
      ],
      late_slots: [
        userSlot(),
        { key: friendSlot, accepts: ["character", "persona"], required: true, used_by: [] },
      ],
    });
    expect(codeOf(() => assemble({ ir, profile: profile(), session: baseSession }))).toBe(
      "assemble.late_slot_unbound",
    );
    const r = assemble({
      ir,
      profile: profile(),
      session: {
        bindings: { user: USER, [friendSlot]: { kind: "character", display_name: "Bob" } },
      },
    });
    expect(r.messages[0]?.content).toBe("Alice trusts Bob.");
  });

  it("allows an unused optional late slot to stay unbound", () => {
    const ir = buildIR({
      fragments: [frag({ fid: "description" })],
      late_slots: [
        userSlot(),
        { key: rivalSlot, accepts: ["character"], required: false, used_by: [] },
      ],
    });
    expect(() => assemble({ ir, profile: profile(), session: baseSession })).not.toThrow();
  });

  it("never emits a leftover placeholder even if an optional slot is used but unbound", () => {
    const ir = buildIR({
      fragments: [frag({ fid: "description", text: `Rival: {{late:${rivalSlot}}}` })],
      late_slots: [
        userSlot(),
        { key: rivalSlot, accepts: ["character"], required: false, used_by: [] },
      ],
    });
    expect(codeOf(() => assemble({ ir, profile: profile(), session: baseSession }))).toBe(
      "assemble.late_slot_unbound",
    );
  });

  it("rejects a placeholder for an undeclared late slot", () => {
    const ir = buildIR({
      fragments: [frag({ fid: "description", text: `Hi {{late:${rivalSlot}}}` })],
    });
    expect(codeOf(() => assemble({ ir, profile: profile(), session: baseSession }))).toBe(
      "assemble.unknown_late_slot",
    );
  });

  it("restores escaped braces to literal text", () => {
    const ir = buildIR({
      fragments: [frag({ fid: "description", text: "Use {{{{curly}} braces." })],
    });
    const r = assemble({ ir, profile: profile(), session: baseSession });
    expect(r.messages[0]?.content).toBe("Use {{curly}} braces.");
  });

  it("adds binding descriptions as a separate session block", () => {
    const ir = buildIR({ fragments: [frag({ fid: "description" })] });
    const r = assemble({
      ir,
      profile: profile(),
      session: { bindings: { user: { ...USER, description: "A quiet mechanic." } } },
    });
    expect(r.messages.map((m) => m.source)).toEqual([
      [`${ROOT_REF}#description~root`],
      ["session:bindings"],
    ]);
    expect(r.messages[1]?.content).toContain("Kai: A quiet mechanic.");
    expect(decisions(r)["session:bindings"]).toBe("included:always");
  });
});

describe("locale", () => {
  const ir = buildIR({
    fragments: [
      frag({
        fid: "description",
        text: "Alice is a courier.",
        locales: { ja: text("アリスは運び屋。") },
      }),
      frag({ fid: "lore/city", kind: "world", text: "Night City." }),
    ],
    participants: [{ ...SELF, display_name: { en: "Alice", ja: "アリス" } }],
  });

  it("uses the session locale when a variant exists and falls back otherwise", () => {
    const r = assemble({ ir, profile: profile(), session: { ...baseSession, locale: "ja" } });
    expect(decisions(r)).toMatchObject({
      [`${ROOT_REF}#description~root`]: "included:always",
      [`${ROOT_REF}#lore/city~root`]: "included:locale-fallback",
    });
    expect(r.messages[0]?.content).toBe("アリスは運び屋。");
    expect(r.messages[1]?.content).toBe("Night City.");
  });

  it("prefers session locale over profile locale over the default", () => {
    const r1 = assemble({ ir, profile: profile({ locale: "ja" }), session: baseSession });
    expect(r1.messages[0]?.content).toBe("アリスは運び屋。");
    const r2 = assemble({
      ir,
      profile: profile({ locale: "ja" }),
      session: { ...baseSession, locale: "en" },
    });
    expect(r2.messages[0]?.content).toBe("Alice is a courier.");
    const r3 = assemble({ ir, profile: profile(), session: baseSession });
    expect(decisions(r3)[`${ROOT_REF}#lore/city~root`]).toBe("included:always");
  });

  it("matches a more specific requested tag to its base language", () => {
    const r = assemble({ ir, profile: profile(), session: { ...baseSession, locale: "ja-JP" } });
    expect(r.messages[0]?.content).toBe("アリスは運び屋。");
  });

  it("localizes participant names in dialogue", () => {
    const ir2 = buildIR({
      fragments: [
        frag({
          fid: "examples",
          kind: "examples",
          content: {
            type: "dialogue",
            turns: [
              { speaker: "participant:user", text: "Late again?" },
              { speaker: "participant:self", text: "Traffic." },
            ],
          },
        }),
      ],
      participants: [{ ...SELF, display_name: { en: "Alice", ja: "アリス" } }],
    });
    const r = assemble({ ir: ir2, profile: profile(), session: { ...baseSession, locale: "ja" } });
    expect(r.messages[0]?.content).toBe("[Example dialogue]\n\nKai: Late again?\nアリス: Traffic.");
    expect(r.trace.entries[0]?.region).toBe("system:examples");
  });
});

describe("visibility", () => {
  const bob = participantKey("root", "friend");
  const ir = buildIR({
    fragments: [
      frag({ fid: "description" }),
      frag({
        fid: "secret",
        kind: "knowledge",
        text: "Alice stole the chip.",
        visibility: { scope: "private", to: [`participant:self`] },
      }),
      frag({
        fid: "bob-secret",
        kind: "knowledge",
        text: "Bob is a spy.",
        visibility: { scope: "private", to: [`participant:${bob}`] },
      }),
      frag({
        fid: "scene-only",
        kind: "scenario",
        visibility: { scope: "scene", scene: "rooftop" },
      }),
    ],
    participants: [SELF, { key: bob, display_name: "Bob", kind: "character" }],
  });
  const ids = {
    secret: `${ROOT_REF}#secret~root`,
    bob: `${ROOT_REF}#bob-secret~root`,
    scene: `${ROOT_REF}#scene-only~root`,
  };

  it("narrator mode includes private fragments with an explicit note", () => {
    const r = assemble({ ir, profile: profile({ mode: "narrator" }), session: baseSession });
    expect(decisions(r)).toMatchObject({
      [ids.secret]: "included:always",
      [ids.bob]: "included:always",
    });
    const knowledge = r.messages.find((m) => m.source.includes(ids.bob));
    expect(knowledge?.content).toContain("[Only Bob knows the following.");
    expect(knowledge?.content).toContain("[Only Alice knows the following.");
    expect(knowledge?.content).toContain("Bob is a spy.");
  });

  it("per-agent mode excludes private fragments not addressed to the current participant", () => {
    const r = assemble({ ir, profile: profile({ mode: "per-agent" }), session: baseSession });
    expect(decisions(r)).toMatchObject({
      [ids.secret]: "included:always",
      [ids.bob]: "skipped:visibility",
    });
    expect(JSON.stringify(r.messages)).not.toContain("Bob is a spy");
    expect(JSON.stringify(r.messages)).not.toContain("[Only");
  });

  it("per-agent mode assembles for another participant", () => {
    const r = assemble({
      ir,
      profile: profile({ mode: "per-agent" }),
      session: { ...baseSession, for_participant: bob },
    });
    expect(decisions(r)).toMatchObject({
      [ids.secret]: "skipped:visibility",
      [ids.bob]: "included:always",
    });
  });

  it("rejects assembling for an unknown participant", () => {
    expect(
      codeOf(() =>
        assemble({
          ir,
          profile: profile({ mode: "per-agent" }),
          session: { ...baseSession, for_participant: "p:x" },
        }),
      ),
    ).toBe("assemble.unknown_participant");
  });

  it("scene fragments are included only in their scene", () => {
    expect(decisions(assemble({ ir, profile: profile(), session: baseSession }))[ids.scene]).toBe(
      "skipped:visibility",
    );
    expect(
      decisions(
        assemble({ ir, profile: profile(), session: { ...baseSession, scene: "rooftop" } }),
      )[ids.scene],
    ).toBe("included:always");
  });
});

describe("activation", () => {
  const ir = buildIR({
    fragments: [
      frag({ fid: "description" }),
      frag({
        fid: "lore/arasaka",
        kind: "knowledge",
        activation: { mode: "keyword", keys: ["Arasaka", "corp"] },
      }),
      frag({
        fid: "lore/militech",
        kind: "knowledge",
        activation: {
          mode: "keyword",
          keys: ["Militech"],
          secondary: ["gun", "war"],
          logic: "all",
        },
      }),
      frag({
        fid: "lore/cs",
        kind: "knowledge",
        activation: { mode: "keyword", keys: ["NCPD"], case_sensitive: true },
      }),
      frag({
        fid: "lore/word",
        kind: "knowledge",
        activation: { mode: "keyword", keys: ["art"], whole_word: true },
      }),
      frag({
        fid: "lore/deep",
        kind: "knowledge",
        activation: { mode: "keyword", keys: ["dragon"], scan_depth: 3 },
      }),
      frag({ fid: "lore/manual", kind: "knowledge", activation: { mode: "manual" } }),
      frag({
        fid: "lore/semantic",
        kind: "knowledge",
        activation: { mode: "semantic", hint: "history" },
      }),
      frag({
        fid: "lore/pinned",
        kind: "knowledge",
        importance: "pinned",
        activation: { mode: "keyword", keys: ["never-mentioned"] },
      }),
    ],
  });
  const id = (f: string) => `${ROOT_REF}#${f}~root`;

  it("reports keyword hits, misses, manual, semantic and pinned", () => {
    const r = assemble({
      ir,
      profile: profile(),
      session: {
        ...baseSession,
        history: [
          { role: "user", text: "Tell me about the dragon." },
          { role: "assistant", text: "Nothing to say." },
          { role: "user", text: "What about the CORP and Militech guns? ncpd too, and smart art." },
        ],
      },
    });
    expect(decisions(r)).toMatchObject({
      [id("description")]: "included:always",
      [id("lore/arasaka")]: "included:keyword:corp",
      [id("lore/militech")]: "skipped:inactive",
      [id("lore/cs")]: "skipped:inactive",
      [id("lore/word")]: "included:keyword:art",
      [id("lore/deep")]: "included:keyword:dragon",
      [id("lore/manual")]: "skipped:inactive",
      [id("lore/semantic")]: "skipped:semantic",
      [id("lore/pinned")]: "included:pinned",
      history: "included:always",
    });
  });

  it("scans only the most recent messages by default", () => {
    const r = assemble({
      ir,
      profile: profile(),
      session: {
        ...baseSession,
        history: [
          { role: "user", text: "Arasaka" },
          { role: "assistant", text: "..." },
          { role: "user", text: "..." },
        ],
      },
    });
    expect(decisions(r)[id("lore/arasaka")]).toBe("skipped:inactive");
  });

  it("secondary keys with logic all require every secondary key", () => {
    const r = assemble({
      ir,
      profile: profile(),
      session: { ...baseSession, history: [{ role: "user", text: "Militech gun war" }] },
    });
    expect(decisions(r)[id("lore/militech")]).toBe("included:keyword:Militech");
  });

  it("whole word matching rejects substrings", () => {
    const r = assemble({
      ir,
      profile: profile(),
      session: { ...baseSession, history: [{ role: "user", text: "the artist" }] },
    });
    expect(decisions(r)[id("lore/word")]).toBe("skipped:inactive");
  });

  it("manual and semantic fragments are included when explicitly enabled", () => {
    const r = assemble({
      ir,
      profile: profile(),
      session: { ...baseSession, manual_enabled: [id("lore/manual"), id("lore/semantic")] },
    });
    expect(decisions(r)).toMatchObject({
      [id("lore/manual")]: "included:manual",
      [id("lore/semantic")]: "included:manual",
    });
  });

  it("empty history activates no keyword fragment", () => {
    const r = assemble({ ir, profile: profile(), session: baseSession });
    expect(decisions(r)[id("lore/arasaka")]).toBe("skipped:inactive");
    expect(r.trace.entries.some((e) => e.id === "history")).toBe(false);
  });
});

describe("budget", () => {
  // charCounter：每个字符 1 token。
  const ir = buildIR({
    fragments: [
      frag({ fid: "description", text: "x".repeat(10), importance: "pinned" }),
      frag({ fid: "lore/a", kind: "knowledge", text: "a".repeat(30) }),
      frag({ fid: "lore/b", kind: "knowledge", text: "b".repeat(30), importance: "opportunistic" }),
      frag({ fid: "lore/c", kind: "knowledge", text: "c".repeat(15) }),
      frag({ fid: "lore/d", kind: "knowledge", text: "d".repeat(5), importance: "opportunistic" }),
    ],
  });
  const id = (f: string) => `${ROOT_REF}#${f}~root`;

  it("fills normal before opportunistic and skips whole fragments that do not fit", () => {
    // 预算 50：pinned 10 → 剩 40；normal a(30) 纳入 → 10；c(15) 放不下；
    // opportunistic b(30) 放不下；d(5) 纳入。
    const r = assemble({
      ir,
      profile: profile({ context_window: 60, reserve_for_output: 10 }),
      session: baseSession,
      counter: charCounter,
    });
    expect(decisions(r)).toMatchObject({
      [id("description")]: "included:pinned",
      [id("lore/a")]: "included:always",
      [id("lore/b")]: "skipped:budget",
      [id("lore/c")]: "skipped:budget",
      [id("lore/d")]: "included:always",
    });
    expect(r.trace.total_tokens).toBe(45);
    expect(r.trace.estimated).toBe(false);
    expect(r.trace.profile.tokenizer).toBe("chars");
    for (const m of r.messages) {
      expect(m.content).not.toMatch(/c{15}|b{30}/);
    }
    expect(r.messages.find((m) => m.source.includes(id("lore/a")))?.content).toBe(
      `${"a".repeat(30)}\n\n${"d".repeat(5)}`,
    );
  });

  it("counts history against the budget", () => {
    const r = assemble({
      ir,
      profile: profile({ context_window: 60, reserve_for_output: 10 }),
      session: { ...baseSession, history: [{ role: "user", text: "h".repeat(20) }] },
      counter: charCounter,
    });
    // 可用 50 - 20 = 30：pinned 10 → 20；a(30) 跳过；c(15) 纳入 → 5；d(5) 纳入。
    expect(decisions(r)).toMatchObject({
      [id("lore/a")]: "skipped:budget",
      [id("lore/c")]: "included:always",
      [id("lore/d")]: "included:always",
    });
    expect(r.messages.at(-1)).toEqual({
      role: "user",
      content: "h".repeat(20),
      source: ["history"],
    });
  });

  it("fails loudly when pinned fragments alone exceed the budget", () => {
    expect(
      codeOf(() =>
        assemble({
          ir,
          profile: profile({ context_window: 15, reserve_for_output: 6 }),
          session: baseSession,
          counter: charCounter,
        }),
      ),
    ).toBe("assemble.pinned_over_budget");
  });

  it("pinned is never trimmed even if it uses the entire budget", () => {
    const r = assemble({
      ir,
      profile: profile({ context_window: 10, reserve_for_output: 0 }),
      session: baseSession,
      counter: charCounter,
    });
    expect(decisions(r)[id("description")]).toBe("included:pinned");
    expect(r.messages[0]?.content).toBe("x".repeat(10));
  });
});

describe("session overlay", () => {
  const ir = buildIR({ fragments: [frag({ fid: "description", text: "Alice." })] });

  it("adds memory, state and active variants as separate messages without touching fragments", () => {
    const r = assemble({
      ir,
      profile: profile(),
      session: {
        ...baseSession,
        overlay: {
          memory: ["Kai owes Alice money."],
          state: { weather: "rain", location: "rooftop" },
          active_variants: { avatar: "embarrassed" },
        },
      },
    });
    expect(r.messages.map((m) => m.source)).toEqual([
      [`${ROOT_REF}#description~root`],
      ["session:memory"],
      ["session:state"],
      ["session:variants"],
    ]);
    expect(r.messages[0]?.content).toBe("Alice.");
    expect(r.messages[1]?.content).toBe("[Memory]\nKai owes Alice money.");
    expect(r.messages[2]?.content).toBe("[Current state]\nlocation: rooftop\nweather: rain");
    expect(r.messages[3]?.content).toBe("[Active variants]\navatar: embarrassed");
    expect(decisions(r)).toMatchObject({
      "session:memory": "included:always",
      "session:state": "included:always",
      "session:variants": "included:always",
    });
  });

  it("session content counts against the budget", () => {
    const ir2 = buildIR({ fragments: [frag({ fid: "description", text: "x".repeat(10) })] });
    const r = assemble({
      ir: ir2,
      profile: profile({ context_window: 20 }),
      session: { ...baseSession, overlay: { memory: ["m".repeat(5)] } },
      counter: charCounter,
    });
    // memory 块是 "[Memory]\nmmmmm" = 14 个字符，剩 6，fragment 放不下。
    expect(decisions(r)[`${ROOT_REF}#description~root`]).toBe("skipped:budget");
  });
});

describe("media", () => {
  const ctxAsset = asset({ slot: "map", role: "context", alt: "A map of Night City" });
  const noAlt = asset({ slot: "photo", role: "context" });
  const presentation = asset({ slot: "avatar", role: "presentation", alt: "Alice portrait" });
  const ir = buildIR({
    fragments: [
      frag({
        fid: "map",
        kind: "world",
        content: { type: "media", asset: ctxAsset.id, caption: "Districts" },
      }),
      frag({ fid: "photo", kind: "world", content: { type: "media", asset: noAlt.id } }),
      frag({ fid: "description", text: "Alice.", asset_refs: [presentation.id] }),
    ],
    assets: [ctxAsset, noAlt, presentation],
  });
  const id = (f: string) => `${ROOT_REF}#${f}~root`;

  it("uses alt text or drops the image when the runtime has no image support", () => {
    const r = assemble({
      ir,
      profile: profile({ capabilities: { images: false } }),
      session: baseSession,
    });
    expect(decisions(r)).toMatchObject({
      [id("map")]: "included:unsupported-media",
      [id("photo")]: "skipped:unsupported-media",
      [id("description")]: "included:unsupported-media",
    });
    const world = r.messages.find((m) => m.source.includes(id("map")));
    expect(world?.content).toBe("[Image: A map of Night City]\nDistricts");
    expect(world?.attachments).toBeUndefined();
  });

  it("attaches context images when supported, but never presentation assets", () => {
    const r = assemble({
      ir,
      profile: profile({ capabilities: { images: true } }),
      session: baseSession,
    });
    expect(decisions(r)).toMatchObject({
      [id("map")]: "included:always",
      [id("photo")]: "included:always",
      [id("description")]: "included:unsupported-media",
    });
    const world = r.messages.find((m) => m.source.includes(id("map")));
    expect(world?.attachments?.map((a) => a.asset)).toEqual([ctxAsset.id, noAlt.id]);
    expect(world?.content).toBe("Districts");
  });

  it("rejects references to unknown assets", () => {
    const bad = buildIR({
      fragments: [
        frag({
          fid: "x",
          content: { type: "media", asset: `${ROOT_REF}#asset/none/default~root` },
        }),
      ],
    });
    expect(codeOf(() => assemble({ ir: bad, profile: profile(), session: baseSession }))).toBe(
      "assemble.unknown_asset",
    );
  });
});

describe("default layout", () => {
  const cast = participantKey("root", "friend");
  const ir = buildIR({
    fragments: [
      frag({ fid: "style", kind: "style" }),
      frag({ fid: "lore", kind: "knowledge" }),
      frag({ fid: "world", kind: "world" }),
      frag({ fid: "bob", kind: "character", subject: cast }),
      frag({ fid: "description", kind: "character", subject: "self" }),
      frag({ fid: "rel", kind: "relationship" }),
      frag({ fid: "scen", kind: "scenario" }),
      frag({ fid: "persona", kind: "persona" }),
      frag({ fid: "inst", kind: "instruction" }),
      frag({ fid: "ex", kind: "examples", text: "Alice: hi" }),
      frag({ fid: "hinted", kind: "knowledge", placement_hint: "world" }),
      frag({
        fid: "data",
        kind: "knowledge",
        content: { type: "structured", schema: "x/stats", data: { hp: 3 } },
      }),
    ],
    participants: [SELF, { key: cast, display_name: "Bob", kind: "character" }],
  });
  const id = (f: string) => `${ROOT_REF}#${f}~root`;

  it("orders system messages by region and keeps IR order within a region", () => {
    const r = assemble({
      ir,
      profile: profile(),
      session: {
        ...baseSession,
        history: [
          { role: "user", text: "hello" },
          { role: "assistant", speaker: "self", text: "hi" },
        ],
      },
    });
    expect(r.messages.map((m) => m.source)).toEqual([
      [id("description")],
      [id("bob")],
      [id("persona")],
      [id("world"), id("hinted")],
      [id("scen")],
      [id("rel")],
      [id("lore"), id("data")],
      [id("style")],
      [id("inst")],
      [id("ex")],
      ["history"],
      ["history"],
    ]);
    expect(r.messages.find((m) => m.source.includes(id("data")))?.content).toContain('{"hp":3}');
    expect(r.messages.at(-1)).toEqual({
      role: "assistant",
      content: "Alice: hi",
      source: ["history"],
    });
  });

  it("trace lists every fragment in IR order, then session blocks and history", () => {
    const r = assemble({
      ir,
      profile: profile(),
      session: { ...baseSession, history: [{ role: "user", text: "x" }] },
    });
    expect(r.trace.entries.map((e) => e.id)).toEqual([...ir.fragments.map((f) => f.id), "history"]);
    const included = r.trace.entries.filter((e) => e.decision === "included");
    expect(r.trace.total_tokens).toBe(included.reduce((n, e) => n + e.tokens, 0));
  });

  it("merges into one system message when multiple system messages are not supported", () => {
    const r = assemble({
      ir,
      profile: profile({ capabilities: { multiple_system_messages: false } }),
      session: baseSession,
    });
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]?.source).toHaveLength(ir.fragments.length);
  });

  it("uses the user role when the runtime has no system role", () => {
    const r = assemble({
      ir,
      profile: profile({ capabilities: { system_role: false } }),
      session: baseSession,
    });
    expect(r.messages.every((m) => m.role === "user")).toBe(true);
  });

  it("maps placement hints to regions", () => {
    expect(regionFor({ placement_hint: "character" })).toBe("system:character");
    expect(regionFor({ placement_hint: "character", subject: "p:x" })).toBe("system:cast");
    expect(regionFor({ placement_hint: "examples" })).toBe("system:examples");
    expect(regionFor({ placement_hint: "lore" as never })).toBe("system:lore");
  });
});

describe("speakers", () => {
  const dialogue = (speaker: string) =>
    buildIR({
      fragments: [
        frag({
          fid: "ex",
          kind: "examples",
          content: { type: "dialogue", turns: [{ speaker, text: "hi" }] },
        }),
      ],
    });

  it("rejects speakers that are not participant references", () => {
    expect(
      codeOf(() =>
        assemble({ ir: dialogue("@djj/bob"), profile: profile(), session: baseSession }),
      ),
    ).toBe("assemble.invalid_speaker");
  });

  it("rejects unknown participants in dialogue and history", () => {
    expect(
      codeOf(() =>
        assemble({ ir: dialogue("participant:p:nope"), profile: profile(), session: baseSession }),
      ),
    ).toBe("assemble.unknown_participant");
    const ir = buildIR({ fragments: [frag({ fid: "description" })] });
    expect(
      codeOf(() =>
        assemble({
          ir,
          profile: profile(),
          session: {
            ...baseSession,
            history: [{ role: "assistant", speaker: "p:nope", text: "x" }],
          },
        }),
      ),
    ).toBe("assemble.unknown_participant");
  });

  it("late-bound participants speak with the bound name", () => {
    const slot = lateSlotKey("root", "partner");
    const partner = participantKey("root", "partner");
    const ir = buildIR({
      fragments: [
        frag({
          fid: "ex",
          kind: "examples",
          content: {
            type: "dialogue",
            turns: [{ speaker: `participant:${partner}`, text: "Ready." }],
          },
        }),
      ],
      participants: [
        SELF,
        { key: partner, display_name: "Partner", kind: "character", late: slot },
      ],
      late_slots: [userSlot(), { key: slot, accepts: ["character"], required: true, used_by: [] }],
    });
    const r = assemble({
      ir,
      profile: profile(),
      session: { bindings: { user: USER, [slot]: { kind: "character", display_name: "Rin" } } },
    });
    expect(r.messages[0]?.content).toContain("Rin: Ready.");
  });
});

describe("startSession", () => {
  const ir = buildIR({
    fragments: [frag({ fid: "description" })],
    greetings: [
      {
        id: "default",
        speaker: "participant:self",
        text: "You're late, {{late:user}}.",
        locales: { ja: "遅いよ、{{late:user}}。" },
      },
      { id: "rooftop", speaker: "participant:self", text: "Nice view.", scenario_hint: "rooftop" },
    ],
  });

  it("returns the first greeting with late placeholders bound", () => {
    expect(startSession(ir, baseSession)).toEqual({
      role: "assistant",
      content: "You're late, Kai.",
      speaker: "self",
      greeting_id: "default",
      locale_fallback: false,
    });
  });

  it("selects a greeting by id and locale", () => {
    expect(startSession(ir, { ...baseSession, locale: "ja" }).content).toBe("遅いよ、Kai。");
    const r = startSession(ir, baseSession, { greetingId: "rooftop", locale: "fr" });
    expect(r.content).toBe("Nice view.");
    expect(r.locale_fallback).toBe(true);
  });

  it("fails for an unknown greeting or unbound user", () => {
    expect(codeOf(() => startSession(ir, baseSession, { greetingId: "nope" }))).toBe(
      "assemble.no_greeting",
    );
    expect(codeOf(() => startSession(ir, { bindings: {} }))).toBe("assemble.late_slot_unbound");
  });

  it("fails when there are no greetings", () => {
    const empty = buildIR({ fragments: [frag({ fid: "description" })], greetings: [] });
    expect(codeOf(() => startSession(empty, baseSession))).toBe("assemble.no_greeting");
  });
});
