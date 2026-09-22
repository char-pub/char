import { describe, expect, it } from "vitest";
import { type CanonicalCreation, canonicalizeCreation } from "../src/canonical.js";
import {
  type CheckDiagnostic,
  checkCreation,
  checkEdgeBindings,
  checkOverrideTargets,
  matchesFragmentPattern,
} from "../src/check.js";
import type {
  CreationInput,
  Fragment,
  FragmentOverride,
  ReferenceEdge,
} from "../src/schema/creation.js";
import { D, level0Character, tid } from "./fixtures.js";

function canon(input: CreationInput): CanonicalCreation {
  return canonicalizeCreation(input).creation;
}

function codes(list: CheckDiagnostic[], severity?: CheckDiagnostic["severity"]): string[] {
  return list.filter((d) => severity === undefined || d.severity === severity).map((d) => d.code);
}

const text = (t: string) => ({ type: "text" as const, text: t });

function frag(id: string, kind: string, t: string, extra: Record<string, unknown> = {}): Fragment {
  return { id, stable: true, kind, content: text(t), ...extra } as Fragment;
}

const meta = {
  default_locale: "en",
  rating: "general",
  rights: "original",
  license: "CC-BY-4.0",
} as const;

function world(overrides: Partial<CreationInput> = {}): CreationInput {
  return {
    id: tid("cr", 2),
    ref: "@cyberpunk/night-city",
    type: "world",
    display_name: "Night City",
    fragments: [frag("world", "world", "A city."), frag("lore/arasaka", "knowledge", "A corp.")],
    meta,
    ...overrides,
  };
}

const contextAsset = {
  slot: "map",
  role: "context" as const,
  variants: [
    {
      id: "default",
      media_type: "image/webp",
      blob: { digest: D("c"), size: 10, availability: "mirrored" as const },
    },
  ],
};

describe("checkCreation: valid inputs", () => {
  it("accepts a Level 0 character with no diagnostics", () => {
    const r = checkCreation(canon(level0Character()));
    expect(r.ok).toBe(true);
    expect(r.diagnostics).toEqual([]);
  });

  it("accepts a world with a context asset referenced by a fragment", () => {
    const r = checkCreation(
      canon(
        world({
          assets: [contextAsset],
          fragments: [frag("world", "world", "A city.", { asset_refs: ["#asset/map"] })],
        }),
      ),
    );
    expect(r.diagnostics).toEqual([]);
  });

  it("accepts a relationship template using its slots and params", () => {
    const r = checkCreation(
      canon({
        id: tid("cr", 3),
        ref: "@commons/childhood-friend",
        type: "relationship",
        display_name: "Childhood friend",
        slots: { a: { accepts: "character" }, b: { accepts: ["character", "persona"] } },
        params: { reunited_after: { type: "string", default: "several years" } },
        fragments: [
          frag(
            "bond",
            "relationship",
            "{{slot:a}} and {{slot:b}} met again after {{param:reunited_after}}.",
          ),
        ],
        meta,
      }),
    );
    expect(r.diagnostics).toEqual([]);
  });

  it("returns diagnostics sorted by code then subject", () => {
    const r = checkCreation(
      canon(
        level0Character({
          fragments: [
            frag("z", "character", "{{nope}}"),
            frag("a", "character", "{{slot:x}} {{nope}}"),
          ],
        }),
      ),
    );
    const keys = r.diagnostics.map((d) => `${d.code}|${d.subject}`);
    expect(keys).toEqual([...keys].sort());
  });
});

describe("checkCreation: templates", () => {
  it.each([
    ["unknown placeholder", "hi {{char}}", "check.unknown_placeholder"],
    ["unclosed placeholder", "hi {{self", "check.unclosed_placeholder"],
    ["invalid slot name", "hi {{slot:Bad}}", "check.invalid_placeholder_name"],
    ["undeclared slot", "hi {{slot:friend}}", "check.unknown_slot"],
    ["undeclared param", "hi {{param:age}}", "check.unknown_param"],
    ["late placeholder is IR-only", "hi {{late:user}}", "check.unknown_placeholder"],
  ])("rejects %s", (_name, t, code) => {
    const r = checkCreation(
      canon(level0Character({ fragments: [frag("description", "character", t)] })),
    );
    expect(r.ok).toBe(false);
    expect(codes(r.diagnostics, "error")).toContain(code);
  });

  it("accepts the {{{{ escape", () => {
    const r = checkCreation(
      canon(level0Character({ fragments: [frag("description", "character", "{{{{self}}")] })),
    );
    expect(r.diagnostics).toEqual([]);
  });

  it("rejects {{self}} outside character / persona", () => {
    const r = checkCreation(
      canon(world({ fragments: [frag("world", "world", "{{self}} is a city")] })),
    );
    expect(codes(r.diagnostics, "error")).toEqual(["check.self_not_allowed"]);
  });

  it("allows {{self}} in a persona", () => {
    const r = checkCreation(
      canon({
        id: tid("cr", 4),
        ref: "@djj/me",
        type: "persona",
        display_name: "Me",
        fragments: [frag("me", "persona", "{{self}} likes tea")],
        meta,
      }),
    );
    expect(r.diagnostics).toEqual([]);
  });

  it("checks templates in dialogue turns, captions, locale variants and greetings", () => {
    const r = checkCreation(
      canon(
        level0Character({
          assets: [contextAsset],
          fragments: [
            frag("description", "character", "ok"),
            {
              id: "examples",
              stable: true,
              kind: "examples",
              content: { type: "dialogue", turns: [{ speaker: "{{self}}", text: "{{bad}}" }] },
            },
            {
              id: "pic",
              stable: true,
              kind: "world",
              content: { type: "media", asset: "#asset/map", caption: "{{param:x}}" },
            },
            frag("l10n", "character", "ok", { locale: { ja: { content: text("{{oops}}") } } }),
          ],
          bootstrap: { greetings: [{ id: "default", text: "{{slot:x}}" }] },
        }),
      ),
    );
    const subjects = r.diagnostics.map((d) => `${d.code}@${d.subject}`);
    expect(subjects).toEqual([
      "check.unknown_param@fragments[pic].content.caption",
      "check.unknown_placeholder@fragments[examples].content.turns[0]",
      "check.unknown_placeholder@fragments[l10n].locale[ja].content",
      "check.unknown_slot@bootstrap.greetings[default]",
    ]);
  });
});

describe("checkCreation: type requirements", () => {
  const base = { id: tid("cr", 5), ref: "@djj/x", display_name: "X", meta } as const;

  it.each([
    ["character", [frag("w", "world", "x")]],
    ["world", [frag("k", "knowledge", "x")]],
    ["lorebook", [frag("w", "world", "x")]],
    ["persona", [frag("c", "character", "x")]],
    ["style", [frag("c", "character", "x")]],
  ] as const)("rejects a %s without its required fragment kind", (type, fragments) => {
    const r = checkCreation(canon({ ...base, type, fragments: [...fragments] }));
    expect(codes(r.diagnostics, "error")).toContain("check.type_requirement");
  });

  it("rejects a relationship with fewer than two slots", () => {
    const r = checkCreation(
      canon({
        ...base,
        type: "relationship",
        slots: { a: { accepts: "character" } },
        fragments: [frag("bond", "relationship", "{{slot:a}}")],
      }),
    );
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({ code: "check.type_requirement", subject: "slots" }),
    );
  });

  it("rejects a relationship without a relationship fragment", () => {
    const r = checkCreation(
      canon({
        ...base,
        type: "relationship",
        slots: { a: { accepts: "character" }, b: { accepts: "character" } },
        fragments: [frag("x", "knowledge", "x")],
      }),
    );
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({ code: "check.type_requirement", subject: "fragments" }),
    );
  });

  it("rejects a scenario without a cast", () => {
    const r = checkCreation(
      canon({ ...base, type: "scenario", fragments: [frag("s", "scenario", "x")] }),
    );
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({ code: "check.type_requirement", subject: "cast" }),
    );
  });

  it("accepts a scenario with a cast and gives a preset only an info note", () => {
    const s = checkCreation(
      canon({
        ...base,
        type: "scenario",
        cast: [{ key: "alice", who: "@djj/alice" }],
        fragments: [frag("s", "scenario", "x")],
      }),
    );
    expect(s.diagnostics).toEqual([]);
    const p = checkCreation(canon({ ...base, type: "preset" }));
    expect(p.ok).toBe(true);
    expect(codes(p.diagnostics, "info")).toEqual(["check.preset_unspecified"]);
  });
});

describe("checkCreation: local references", () => {
  it.each([
    ["missing slot", ["#asset/missing"], "check.unknown_asset"],
    ["missing variant", ["#asset/map/rainy"], "check.unknown_asset"],
    ["presentation asset", ["#asset/avatar"], "check.asset_not_context"],
  ])("rejects asset_refs pointing at a %s", (_name, refs, code) => {
    const c = level0Character();
    const r = checkCreation(
      canon({
        ...c,
        assets: [...(c.assets ?? []), contextAsset],
        fragments: [frag("description", "character", "x", { asset_refs: refs })],
      }),
    );
    expect(codes(r.diagnostics, "error")).toEqual([code]);
  });

  it("rejects media content that shows a presentation asset", () => {
    const r = checkCreation(
      canon(
        level0Character({
          fragments: [
            frag("description", "character", "x"),
            {
              id: "pic",
              stable: true,
              kind: "character",
              content: { type: "media", asset: "#asset/avatar" },
            },
          ],
        }),
      ),
    );
    expect(codes(r.diagnostics, "error")).toEqual(["check.asset_not_context"]);
  });

  it.each([
    ["undeclared slot", "{{slot:friend}}", "check.unknown_slot"],
    ["cast outside a scenario", "{{cast:bob}}", "check.unknown_cast"],
  ])("rejects private visibility for an %s", (_name, to, code) => {
    const r = checkCreation(
      canon(
        level0Character({
          fragments: [
            frag("description", "character", "x", { visibility: { scope: "private", to: [to] } }),
          ],
        }),
      ),
    );
    expect(codes(r.diagnostics, "error")).toEqual([code]);
  });

  it("rejects dialogue speakers that reference undeclared slots", () => {
    const r = checkCreation(
      canon(
        level0Character({
          fragments: [
            frag("description", "character", "x"),
            {
              id: "examples",
              stable: true,
              kind: "examples",
              content: { type: "dialogue", turns: [{ speaker: "{{slot:friend}}", text: "hi" }] },
            },
          ],
        }),
      ),
    );
    expect(r.diagnostics).toEqual([
      expect.objectContaining({
        code: "check.unknown_slot",
        subject: "fragments[examples].content.turns[0].speaker",
      }),
    ]);
  });

  it("rejects a cast member not declared in the scenario", () => {
    const r = checkCreation(
      canon({
        id: tid("cr", 6),
        ref: "@djj/rooftop",
        type: "scenario",
        display_name: "Rooftop",
        cast: [{ key: "alice", who: "@djj/alice" }],
        fragments: [
          frag("s", "scenario", "x", { visibility: { scope: "private", to: ["{{cast:bob}}"] } }),
        ],
        meta,
      }),
    );
    expect(codes(r.diagnostics, "error")).toEqual(["check.unknown_cast"]);
  });

  it("rejects a scene visibility that points at a missing fragment", () => {
    const r = checkCreation(
      canon(
        level0Character({
          fragments: [
            frag("description", "character", "x", {
              visibility: { scope: "scene", scene: "nope" },
            }),
          ],
        }),
      ),
    );
    expect(codes(r.diagnostics, "error")).toEqual(["check.unknown_scene"]);
  });

  it("rejects {{self}} bindings outside character / persona and {{cast}} bindings outside scenarios", () => {
    const edge = (bind: ReferenceEdge["bind"]): ReferenceEdge => ({
      id: "friend",
      use: "@commons/childhood-friend",
      mode: "default",
      ...(bind ? { bind } : {}),
    });
    const w = checkCreation(canon(world({ references: [edge({ a: "{{self}}" })] })));
    expect(codes(w.diagnostics, "error")).toEqual(["check.self_not_allowed"]);
    const c = checkCreation(canon(level0Character({ references: [edge({ a: "{{cast:bob}}" })] })));
    expect(codes(c.diagnostics, "error")).toEqual(["check.unknown_cast"]);
    const ok = checkCreation(
      canon(level0Character({ references: [edge({ a: "{{self}}", b: { late: "persona" } })] })),
    );
    expect(ok.diagnostics).toEqual([]);
  });

  it("rejects a cast declared outside a scenario", () => {
    const r = checkCreation(canon(level0Character({ cast: [{ key: "bob", who: "@djj/bob" }] })));
    expect(codes(r.diagnostics, "error")).toEqual(["check.cast_not_allowed"]);
  });
});

describe("checkCreation: consistency", () => {
  it("rejects an asset rated lower than the creation", () => {
    const c = level0Character({ meta: { ...meta, rating: "mature" } });
    const slot = c.assets?.[0];
    if (!slot) throw new Error("fixture");
    const r = checkCreation(
      canon({
        ...c,
        assets: [
          { ...slot, variants: slot.variants.map((v) => ({ ...v, rating: "teen" as const })) },
        ],
      }),
    );
    expect(codes(r.diagnostics, "error")).toEqual(["check.asset_rating_below_creation"]);
  });

  it("accepts an asset rated higher than the creation", () => {
    const c = level0Character();
    const slot = c.assets?.[0];
    if (!slot) throw new Error("fixture");
    const r = checkCreation(
      canon({
        ...c,
        assets: [
          { ...slot, variants: slot.variants.map((v) => ({ ...v, rating: "mature" as const })) },
        ],
      }),
    );
    expect(r.diagnostics).toEqual([]);
  });

  it("rejects greeting translations that are not plain text", () => {
    const r = checkCreation(
      canon(
        level0Character({
          bootstrap: {
            greetings: [
              {
                id: "default",
                text: "Hi",
                locale: {
                  ja: {
                    content: { type: "dialogue", turns: [{ speaker: "{{self}}", text: "やあ" }] },
                  },
                },
              },
            ],
          },
        }),
      ),
    );
    expect(codes(r.diagnostics, "error")).toEqual(["check.greeting_locale_not_text"]);
  });

  it("rejects duplicate greeting ids", () => {
    const r = checkCreation(
      canon(
        level0Character({
          bootstrap: {
            greetings: [
              { id: "default", text: "a" },
              { id: "default", text: "b" },
            ],
          },
        }),
      ),
    );
    expect(codes(r.diagnostics, "error")).toEqual(["check.duplicate_greeting"]);
  });

  it.each([
    ["string", 3],
    ["number", "3"],
    ["boolean", "yes"],
  ] as const)("rejects a %s param with a default of the wrong type", (type, value) => {
    const r = checkCreation(canon(level0Character({ params: { p: { type, default: value } } })));
    expect(codes(r.diagnostics, "error")).toEqual(["check.param_default_type"]);
  });

  it("rejects duplicate edge ids, asset slots and asset variants", () => {
    const edge: ReferenceEdge = { id: "w", use: "@cyberpunk/night-city", mode: "intrinsic" };
    const c = level0Character();
    const slot = c.assets?.[0];
    const variant = slot?.variants[0];
    if (!slot || !variant) throw new Error("fixture");
    const r = checkCreation(
      canon({
        ...c,
        references: [edge, edge],
        assets: [slot, { ...slot, variants: [variant, variant] }],
      }),
    );
    expect(codes(r.diagnostics, "error")).toEqual([
      "check.duplicate_asset_slot",
      "check.duplicate_asset_variant",
      "check.duplicate_edge",
    ]);
  });

  it("notes unstable fragments at info level without failing", () => {
    const r = checkCreation(
      canon(
        level0Character({ fragments: [frag("description", "character", "x", { stable: false })] }),
      ),
    );
    expect(r.ok).toBe(true);
    expect(codes(r.diagnostics, "info")).toEqual(["check.unstable_fragment"]);
  });

  it("warns about locale variants that repeat the default locale or carry unused keys", () => {
    const r = checkCreation(
      canon(
        level0Character({
          fragments: [
            frag("description", "character", "x", {
              locale: {
                en: { content: text("x") },
                ja: { content: text("y"), activation_keys: ["k"] },
              },
            }),
          ],
        }),
      ),
    );
    expect(r.ok).toBe(true);
    expect(codes(r.diagnostics, "warning")).toEqual([
      "check.locale_duplicates_default",
      "check.locale_keys_without_keyword",
    ]);
  });

  it("warns about greetings on a type that never uses them", () => {
    const r = checkCreation(
      canon(world({ bootstrap: { greetings: [{ id: "default", text: "hi" }] } })),
    );
    expect(codes(r.diagnostics, "warning")).toEqual(["check.bootstrap_unused"]);
  });

  it("warns about explicit content from a GitHub source only", () => {
    const c = canon(level0Character({ meta: { ...meta, rating: "explicit" } }));
    expect(checkCreation(c, { source: "github" }).diagnostics).toEqual([
      expect.objectContaining({ code: "check.github_explicit", severity: "warning" }),
    ]);
    expect(checkCreation(c, { source: "native" }).diagnostics).toEqual([]);
  });
});

describe("checkCreation: overrides (local structure)", () => {
  const withOverrides = (type: "character" | "scenario", override: FragmentOverride[]) => {
    const edge: ReferenceEdge = {
      id: "w",
      use: "@cyberpunk/night-city",
      mode: "intrinsic",
      override,
    };
    if (type === "character") return canon(level0Character({ references: [edge] }));
    return canon({
      id: tid("cr", 7),
      ref: "@djj/rooftop",
      type: "scenario",
      display_name: "Rooftop",
      cast: [{ key: "alice", who: "@djj/alice" }],
      fragments: [frag("s", "scenario", "x")],
      references: [edge],
      meta,
    });
  };

  it("rejects two overrides of the same target on one reference", () => {
    const r = checkCreation(
      withOverrides("character", [
        { op: "patch", target: "world", set: { importance: "pinned" } },
        { op: "remove", target: "world" },
      ]),
    );
    expect(r.diagnostics).toEqual([
      expect.objectContaining({
        code: "check.duplicate_override",
        subject: "references[w].override[1]",
      }),
    ]);
  });

  it("rejects an add that duplicates another override's target", () => {
    const r = checkCreation(
      withOverrides("character", [
        { op: "remove", target: "extra" },
        { op: "add", fragment: frag("extra", "knowledge", "x") },
      ]),
    );
    expect(codes(r.diagnostics, "error")).toEqual(["check.duplicate_override"]);
  });

  it("rejects force outside a scenario, accepts it inside", () => {
    const bad = checkCreation(
      withOverrides("character", [{ op: "remove", target: "world", force: true }]),
    );
    expect(codes(bad.diagnostics, "error")).toEqual(["check.force_outside_scenario"]);
    const good = checkCreation(
      withOverrides("scenario", [{ op: "remove", target: "world", force: true }]),
    );
    expect(good.diagnostics).toEqual([]);
  });

  it("checks template syntax in replacement content", () => {
    const r = checkCreation(
      withOverrides("character", [{ op: "replace", target: "world", content: text("{{bogus}}") }]),
    );
    expect(codes(r.diagnostics, "error")).toEqual(["check.unknown_placeholder"]);
  });
});

describe("checkOverrideTargets", () => {
  const target = canon(
    world({
      fragments: [
        frag("world", "world", "A city."),
        frag("lore/arasaka", "knowledge", "A corp."),
        frag("lore/tmp", "knowledge", "Imported.", { stable: false }),
      ],
      slots: { mayor: { accepts: "character" } },
    }),
  );
  const edge = (mode: "intrinsic" | "default", override: FragmentOverride[]): ReferenceEdge => ({
    id: "w",
    use: "@cyberpunk/night-city",
    mode,
    override,
  });

  it("accepts patching and replacing stable, non-identity fragments", () => {
    const r = checkOverrideTargets(
      edge("intrinsic", [
        { op: "patch", target: "lore/arasaka", set: { importance: "pinned" } },
        { op: "replace", target: "lore/arasaka", content: text("{{slot:mayor}} runs it.") },
      ]),
      target,
      { dependentType: "character" },
    );
    expect(r.diagnostics).toEqual([]);
  });

  it.each([
    ["a missing target", { op: "remove", target: "lore/nope" }, "check.override_target_missing"],
    [
      "an unstable target",
      { op: "patch", target: "lore/tmp", set: { importance: "normal" } },
      "check.override_target_unstable",
    ],
    [
      "an add that clashes with an existing fragment",
      { op: "add", fragment: frag("world", "world", "x") },
      "check.override_add_conflict",
    ],
    [
      "replacement content with an undeclared slot",
      { op: "replace", target: "lore/arasaka", content: text("{{slot:x}}") },
      "check.unknown_slot",
    ],
  ] as const)("rejects %s", (_name, o, code) => {
    const r = checkOverrideTargets(edge("default", [o as FragmentOverride]), target, {
      dependentType: "character",
    });
    expect(codes(r.diagnostics, "error")).toEqual([code]);
  });

  it("requires a scenario with force to replace or remove identity fragments of an intrinsic dependency", () => {
    const remove: FragmentOverride = { op: "remove", target: "world" };
    const forced: FragmentOverride = { op: "remove", target: "world", force: true };
    const c = checkOverrideTargets(edge("intrinsic", [forced]), target, {
      dependentType: "character",
    });
    expect(codes(c.diagnostics, "error")).toEqual(["check.intrinsic_override_requires_force"]);
    const s = checkOverrideTargets(edge("intrinsic", [remove]), target, {
      dependentType: "scenario",
    });
    expect(codes(s.diagnostics, "error")).toEqual(["check.intrinsic_override_requires_force"]);
    const ok = checkOverrideTargets(edge("intrinsic", [forced]), target, {
      dependentType: "scenario",
    });
    expect(ok.diagnostics).toEqual([]);
    const dflt = checkOverrideTargets(edge("default", [remove]), target, {
      dependentType: "character",
    });
    expect(dflt.diagnostics).toEqual([]);
  });
});

describe("checkEdgeBindings", () => {
  const rel = canon({
    id: tid("cr", 8),
    ref: "@commons/childhood-friend",
    type: "relationship",
    display_name: "Childhood friend",
    slots: {
      a: { accepts: "character" },
      b: { accepts: ["character", "persona"] },
      c: { accepts: "character", required: false },
    },
    params: { reunited_after: { type: "string", default: "years" }, place: { type: "string" } },
    fragments: [
      frag("bond", "relationship", "{{slot:a}} {{slot:b}}"),
      frag("lore/x", "knowledge", "x"),
    ],
    meta,
  });
  const edge = (e: Partial<ReferenceEdge>): ReferenceEdge => ({
    id: "friend",
    use: "@commons/childhood-friend",
    mode: "default",
    ...e,
  });
  const good = {
    bind: { a: "{{self}}", b: { late: "persona" as const } },
    params: { place: "Tokyo" },
  };

  it("accepts a complete, well-typed binding", () => {
    expect(checkEdgeBindings(edge(good), rel, { dependentType: "character" }).diagnostics).toEqual(
      [],
    );
  });

  it.each([
    [
      "an undeclared slot",
      { ...good, bind: { ...good.bind, z: "@djj/bob" } },
      "check.unknown_slot_binding",
    ],
    [
      "a missing required slot",
      { ...good, bind: { a: "{{self}}" } },
      "check.required_slot_unbound",
    ],
    [
      "a late type the slot does not accept",
      { ...good, bind: { ...good.bind, a: { late: "persona" as const } } },
      "check.binding_type_mismatch",
    ],
    [
      "an undeclared param",
      { ...good, params: { ...good.params, age: 3 } },
      "check.unknown_param_binding",
    ],
    ["a param of the wrong type", { ...good, params: { place: 3 } }, "check.param_type_mismatch"],
    ["a param with no default and no value", { bind: good.bind }, "check.param_unbound"],
  ])("rejects %s", (_name, e, code) => {
    const r = checkEdgeBindings(edge(e as Partial<ReferenceEdge>), rel, {
      dependentType: "character",
    });
    expect(codes(r.diagnostics, "error")).toEqual([code]);
  });

  it("rejects binding {{self}} when the dependent type is not accepted", () => {
    const r = checkEdgeBindings(edge(good), rel, { dependentType: "persona" });
    expect(codes(r.diagnostics, "error")).toEqual(["check.binding_type_mismatch"]);
  });

  it("warns about selector patterns that match nothing", () => {
    const r = checkEdgeBindings(edge({ ...good, select: { include: ["lore/*", "nope"] } }), rel, {
      dependentType: "character",
    });
    expect(r.ok).toBe(true);
    expect(r.diagnostics).toEqual([
      expect.objectContaining({
        code: "check.selector_no_match",
        severity: "warning",
        detail: expect.stringContaining("'nope'"),
      }),
    ]);
  });
});

describe("matchesFragmentPattern", () => {
  it.each([
    ["*", "anything", true],
    ["lore/*", "lore/arasaka", true],
    ["lore/*", "lore/a/b", true],
    ["lore/*", "lore", false],
    ["lore/*", "lorex/a", false],
    ["world", "world", true],
    ["world", "world/x", false],
  ])("%s vs %s → %s", (p, id, ok) => {
    expect(matchesFragmentPattern(p, id)).toBe(ok);
  });
});
