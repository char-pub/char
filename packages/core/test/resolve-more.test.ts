import { describe, expect, it } from "vitest";
import { canonicalizeCreation } from "../src/canonical.js";
import { isCharError } from "../src/errors.js";
import { displayFragmentId, instanceKey, participantKey } from "../src/keys.js";
import { type ReleaseInput, resolve } from "../src/resolve/index.js";
import type { CreationInput } from "../src/schema/creation.js";
import {
  escapeTemplateText,
  finalizeIrText,
  parseTemplate,
  placeholderText,
  tokenizeTemplate,
} from "../src/template.js";
import { level0Character, tid } from "./fixtures.js";

// biome-ignore lint/suspicious/noExplicitAny: 反例输入不需要满足类型
type Loose = any;

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return isCharError(e) ? e.code : `non-char:${String(e)}`;
  }
  return undefined;
}

function rel(n: number, creation: CreationInput, extra: Partial<ReleaseInput> = {}) {
  return {
    release: tid("rel", n),
    visibility: "public" as const,
    creation,
    semantic_digest: canonicalizeCreation(creation).semantic_digest,
    ...extra,
  };
}
const pinOf = (r: { release: string; semantic_digest: string }) => ({
  release: r.release,
  semantic_digest: r.semantic_digest,
});

const META = {
  default_locale: "en",
  rating: "general",
  rights: "original",
  license: "CC0-1.0",
} as const;

const bob = (): CreationInput => ({
  id: tid("cr", 20),
  ref: "@djj/bob",
  type: "character",
  display_name: "Bob",
  fragments: [
    {
      id: "description",
      stable: true,
      kind: "character",
      content: { type: "text", text: "{{self}} is a netrunner." },
    },
  ],
  meta: META,
});

const rooftop = (
  bobRel: { release: string; semantic_digest: string },
  extra: Partial<CreationInput> = {},
): CreationInput => ({
  id: tid("cr", 21),
  ref: "@djj/rooftop",
  type: "scenario",
  display_name: "Rooftop",
  cast: [
    { key: "bob", who: "@djj/bob", role: "lead" },
    { key: "you", who: { late: "persona", hint: "the visitor" }, role: "user" },
  ],
  references: [{ id: "bob", use: "@djj/bob", mode: "intrinsic", pin: pinOf(bobRel) }],
  fragments: [
    {
      id: "scene",
      stable: true,
      kind: "scenario",
      content: {
        type: "dialogue",
        turns: [
          { speaker: "{{cast:bob}}", text: "You made it." },
          { speaker: "{{cast:you}}", text: "Barely." },
        ],
      },
    },
    {
      id: "secret",
      stable: true,
      kind: "knowledge",
      content: { type: "text", text: "The deal is a trap." },
      visibility: { scope: "private", to: ["{{cast:bob}}", "@djj/bob"] },
    },
    {
      id: "night",
      stable: true,
      kind: "scenario",
      content: { type: "text", text: "It rains." },
      visibility: { scope: "scene" },
    },
  ],
  bootstrap: { greetings: [{ id: "default", text: "Rain hits the rooftop." }] },
  meta: META,
  ...extra,
});

describe("scenario with cast", () => {
  it("maps early and late cast members to participants and speakers", () => {
    const b = rel(20, bob());
    const ir = resolve({ root: rel(21, rooftop(b)), dependencies: [b] }).ir;
    const bobKey = participantKey("root", "bob");
    const youKey = participantKey("root", "you");
    const scene = ir.fragments.find((f) => f.origin.fragment === "scene");
    expect(scene?.content).toEqual({
      type: "dialogue",
      turns: [
        { speaker: `participant:${bobKey}`, text: "You made it." },
        { speaker: `participant:${youKey}`, text: "Barely." },
      ],
    });
    const you = ir.participants.find((p) => p.key === youKey);
    expect(you).toMatchObject({ kind: "persona", role: "user" });
    const youSlot = ir.late_slots.find((s) => s.key === you?.late);
    expect(youSlot).toMatchObject({ accepts: ["persona"], required: true, hint: "the visitor" });
    expect(youSlot?.used_by).toEqual([scene?.id]);
    const bobP = ir.participants.find((p) => p.key === bobKey);
    expect(bobP).toMatchObject({ ref: "@djj/bob", role: "lead", display_name: "Bob" });
    // Bob 的 fragment 描述的就是 cast 里的 Bob。
    const bobDesc = ir.fragments.find((f) => f.origin.creation === "@djj/bob");
    expect(bobDesc?.subject).toBe(bobKey);
    expect(bobDesc?.content).toMatchObject({ text: "Bob is a netrunner." });
  });

  it("deduplicates private visibility targets and scopes scene visibility to the instance", () => {
    const b = rel(20, bob());
    const ir = resolve({ root: rel(21, rooftop(b)), dependencies: [b] }).ir;
    const secret = ir.fragments.find((f) => f.origin.fragment === "secret");
    expect(secret?.visibility).toEqual({
      scope: "private",
      to: [`participant:${participantKey("root", "bob")}`],
    });
    const night = ir.fragments.find((f) => f.origin.fragment === "night");
    expect(night?.visibility).toEqual({ scope: "scene", scene: "instance:root" });
    expect(ir.bootstrap.greetings[0]?.speaker).toBe("participant:self");
  });

  it("rejects cast members that are not in the graph or bound to {{self}}", () => {
    const b = rel(20, bob());
    const noRef = rooftop(b, { references: [] });
    expect(codeOf(() => resolve({ root: rel(21, noRef) }))).toBe("resolve.binding_not_in_graph");
    const selfCast = rooftop(b, { cast: [{ key: "x", who: "{{self}}" }] });
    expect(codeOf(() => resolve({ root: rel(21, selfCast), dependencies: [b] }))).toBe(
      "resolve.invalid_cast_binding",
    );
    const unknownSpeaker = rooftop(b, {
      fragments: [
        {
          id: "scene",
          stable: true,
          kind: "scenario",
          content: { type: "dialogue", turns: [{ speaker: "{{cast:nobody}}", text: "?" }] },
        },
      ],
    });
    expect(codeOf(() => resolve({ root: rel(21, unknownSpeaker), dependencies: [b] }))).toBe(
      "resolve.speaker_unknown",
    );
  });

  it("allows force override of an intrinsic character inside a scenario and marks AU", () => {
    const b = rel(20, bob());
    const s = rooftop(b, {
      references: [
        {
          id: "bob",
          use: "@djj/bob",
          mode: "intrinsic",
          pin: pinOf(b),
          override: [
            {
              op: "replace",
              target: "description",
              content: { type: "text", text: "{{self}} is a medic." },
              force: true,
            },
          ],
        },
      ],
    });
    const ir = resolve({ root: rel(21, s), dependencies: [b] }).ir;
    expect(ir.meta.au).toBe(true);
    expect(ir.fragments.find((f) => f.origin.creation === "@djj/bob")?.content).toMatchObject({
      text: "Bob is a medic.",
    });
  });

  it("binds a relationship slot to a cast member", () => {
    const b = rel(20, bob());
    const rivals: CreationInput = {
      id: tid("cr", 22),
      ref: "@commons/rivals",
      type: "relationship",
      display_name: "Rivals",
      slots: { a: { accepts: "character" }, b: { accepts: ["persona", "character"] } },
      fragments: [
        {
          id: "bond",
          stable: true,
          kind: "relationship",
          content: { type: "text", text: "{{slot:a}} distrusts {{slot:b}}." },
        },
      ],
      meta: META,
    };
    const r = rel(22, rivals);
    const s = rooftop(b, {
      references: [
        { id: "bob", use: "@djj/bob", mode: "intrinsic", pin: pinOf(b) },
        {
          id: "rivals",
          use: "@commons/rivals",
          mode: "default",
          pin: pinOf(r),
          bind: { a: "{{cast:bob}}", b: "{{cast:you}}" },
        },
      ],
    });
    const ir = resolve({ root: rel(21, s), dependencies: [b, r] }).ir;
    const bond = ir.fragments.find((f) => f.origin.fragment === "bond");
    const youLate = ir.participants.find((p) => p.key === participantKey("root", "you"))?.late;
    expect(bond?.content).toMatchObject({ text: `Bob distrusts {{late:${youLate}}}.` });
    const bad = rooftop(b, {
      references: [
        { id: "bob", use: "@djj/bob", mode: "intrinsic", pin: pinOf(b) },
        {
          id: "rivals",
          use: "@commons/rivals",
          mode: "default",
          pin: pinOf(r),
          bind: { a: "{{cast:ghost}}", b: "{{cast:you}}" },
        },
      ],
    });
    expect(codeOf(() => resolve({ root: rel(21, bad), dependencies: [b, r] }))).toBe(
      "resolve.cast_unknown",
    );
  });
});

describe("early binding to other creations", () => {
  const friendship: CreationInput = {
    id: tid("cr", 23),
    ref: "@commons/friends",
    type: "relationship",
    display_name: "Friends",
    slots: {
      a: { accepts: "character" },
      b: { accepts: "character" },
      c: { accepts: "character", required: false },
      w: { accepts: "world", required: false },
    },
    fragments: [
      {
        id: "bond",
        stable: true,
        kind: "relationship",
        content: {
          type: "dialogue",
          turns: [
            { speaker: "{{slot:a}}", text: "Hey {{slot:b}}." },
            { speaker: "@djj/bob", text: "Hey." },
          ],
        },
      },
    ],
    meta: META,
  };

  it("binds a slot to another character in the graph and uses it as a speaker", () => {
    const b = rel(20, bob());
    const f = rel(23, friendship);
    const c = level0Character({
      references: [
        { id: "bob", use: "@djj/bob", mode: "default", pin: pinOf(b) },
        {
          id: "friends",
          use: "@commons/friends",
          mode: "default",
          pin: pinOf(f),
          bind: { a: "{{self}}", b: "#bob" },
        },
      ],
    });
    const ir = resolve({ root: rel(1, c), dependencies: [b, f] }).ir;
    const bond = ir.fragments.find((x) => x.origin.fragment === "bond");
    const inst = instanceKey(["friends"]);
    expect(bond?.content).toEqual({
      type: "dialogue",
      turns: [
        { speaker: "participant:self", text: "Hey Bob." },
        { speaker: `participant:${participantKey(inst, "b")}`, text: "Hey." },
      ],
    });
    // 可选 slot c 没有被使用，不产生 late slot；非角色类型的可选 slot w 被跳过。
    expect(ir.late_slots.map((s) => s.key)).toEqual(["user"]);
    expect(
      ir.participants.find((p) => p.key === participantKey(inst, "b"))?.avatar,
    ).toBeUndefined();
  });

  it("rejects bindings to creations of the wrong type or outside the graph", () => {
    const b = rel(20, bob());
    const f = rel(23, friendship);
    const outside = level0Character({
      references: [
        {
          id: "friends",
          use: "@commons/friends",
          mode: "default",
          pin: pinOf(f),
          bind: { a: "{{self}}", b: "@djj/bob" },
        },
      ],
    });
    expect(codeOf(() => resolve({ root: rel(1, outside), dependencies: [f] }))).toBe(
      "resolve.binding_not_in_graph",
    );
    const wrongType = level0Character({
      references: [
        { id: "bob", use: "@djj/bob", mode: "default", pin: pinOf(b) },
        {
          id: "friends",
          use: "@commons/friends",
          mode: "default",
          pin: pinOf(f),
          bind: { a: "{{self}}", b: "#bob", w: "#bob" },
        },
      ],
    });
    expect(codeOf(() => resolve({ root: rel(1, wrongType), dependencies: [b, f] }))).toBe(
      "resolve.binding_type_mismatch",
    );
  });

  it("rejects {{self}} bindings from a non-character creation", () => {
    const f = rel(23, friendship);
    const worldCreation: CreationInput = {
      id: tid("cr", 24),
      ref: "@djj/world",
      type: "world",
      display_name: "World",
      fragments: [{ id: "w", stable: true, kind: "world", content: { type: "text", text: "x" } }],
      references: [
        {
          id: "friends",
          use: "@commons/friends",
          mode: "default",
          pin: pinOf(f),
          bind: { a: "{{self}}", b: "{{self}}" },
        },
      ],
      meta: META,
    };
    expect(codeOf(() => resolve({ root: rel(1, worldCreation), dependencies: [f] }))).toBe(
      "resolve.binding_type_mismatch",
    );
  });
});

describe("resolver edge cases", () => {
  it("rejects {{self}} in a non-participant root, and missing params", () => {
    const w: CreationInput = {
      id: tid("cr", 25),
      ref: "@djj/w",
      type: "world",
      display_name: "W",
      fragments: [
        { id: "w", stable: true, kind: "world", content: { type: "text", text: "{{self}}" } },
      ],
      meta: META,
    };
    expect(codeOf(() => resolve({ root: rel(1, w) }))).toBe("resolve.self_outside_participant");
    const p: CreationInput = {
      ...w,
      params: { n: { type: "number" } },
      fragments: [
        { id: "w", stable: true, kind: "world", content: { type: "text", text: "{{param:n}}" } },
      ],
    };
    expect(codeOf(() => resolve({ root: rel(1, p) }))).toBe("resolve.param_missing");
  });

  it("rejects self references and invalid local refs", () => {
    const a0: CreationInput = { ...bob(), references: [] };
    const aRel = rel(20, a0);
    // pin 里带着被引用内容的 digest，而 digest 又覆盖 pin，所以真正的环（A → B → A）无法构造。
    // 能构造的只有“引用同一 Creation 的另一个 Release”，由单版本规则拦下。
    const selfRef = rel(30, { ...bob(), id: tid("cr", 30), ref: "@djj/loop" });
    const loop: Loose = {
      ...selfRef.creation,
      references: [
        {
          id: "me",
          use: "@djj/loop",
          mode: "default",
          pin: { release: selfRef.release, semantic_digest: selfRef.semantic_digest },
        },
      ],
    };
    expect(codeOf(() => resolve({ root: rel(31, loop), dependencies: [selfRef] }))).toBe(
      "resolve.diamond_conflict",
    );
    expect(
      codeOf(() =>
        resolve({
          root: rel(
            1,
            level0Character({
              references: [{ id: "x", use: "#a/b", mode: "default", pin: pinOf(aRel) }],
            }),
          ),
          dependencies: [aRel],
        }),
      ),
    ).toBe("resolve.invalid_local_ref");
  });

  it("renders media content, captions and context assets", () => {
    const c = level0Character({
      assets: [
        {
          slot: "map",
          role: "context",
          variants: [
            {
              id: "default",
              media_type: "image/webp",
              blob: {
                digest: `sha256:${"b".repeat(64)}`,
                size: 5,
                availability: "linked",
                locator: { provider: "http", url: "https://example.com/map.webp" },
              },
              alt: { en: "A map", ja: "地図" },
            },
          ],
        },
      ],
      fragments: [
        {
          id: "description",
          stable: true,
          kind: "character",
          content: { type: "text", text: "x" },
          asset_refs: ["#asset/map"],
        },
        {
          id: "map",
          stable: true,
          kind: "knowledge",
          content: { type: "media", asset: "#asset/map/default", caption: "{{self}}'s map" },
        },
      ],
    });
    const ir = resolve({ root: rel(1, c), publicAssetBaseUrl: "https://assets.example" }).ir;
    const map = ir.assets.find((a) => a.origin.slot === "map");
    expect(map).toMatchObject({ role: "context", alt: "A map", availability: "linked" });
    expect(map?.url).toBeUndefined();
    expect(map?.locator).toEqual({ provider: "http", url: "https://example.com/map.webp" });
    expect(ir.fragments[1]?.content).toEqual({
      type: "media",
      asset: map?.id,
      caption: "Alice's map",
    });
    expect(ir.fragments[0]?.asset_refs).toEqual([map?.id]);
    expect(
      codeOf(() =>
        resolve({
          root: rel(
            1,
            level0Character({
              fragments: [
                {
                  id: "d",
                  stable: true,
                  kind: "character",
                  content: { type: "media", asset: "#asset/none" },
                },
              ],
            }),
          ),
        }),
      ),
    ).toBe("resolve.asset_missing");
  });

  it("passes structured content through and merges locale activation keys", () => {
    const c = level0Character({
      fragments: [
        {
          id: "description",
          stable: true,
          kind: "character",
          content: { type: "structured", schema: "x/v1", data: { a: [1, 2] } },
        },
        {
          id: "lore",
          stable: true,
          kind: "knowledge",
          content: { type: "text", text: "Tea" },
          activation: { mode: "keyword", keys: ["tea"] },
          locale: {
            ja: { content: { type: "text", text: "お茶" }, activation_keys: ["お茶", "tea"] },
          },
        },
      ],
    });
    const ir = resolve({ root: rel(1, c) }).ir;
    expect(ir.fragments[0]?.content).toEqual({
      type: "structured",
      schema: "x/v1",
      data: { a: [1, 2] },
    });
    expect(ir.fragments[1]?.activation).toEqual({ mode: "keyword", keys: ["tea", "お茶"] });
  });

  it("renders greeting locales and scenario hints, rejecting non-text greeting locales", () => {
    const c = level0Character({
      bootstrap: {
        greetings: [
          {
            id: "default",
            text: "Hi {{user}}.",
            scenario_hint: { en: "rooftop", ja: "屋上" },
            locale: { ja: { content: { type: "text", text: "やあ、{{user}}。" } } },
          },
        ],
      },
    });
    const ir = resolve({ root: rel(1, c) }).ir;
    expect(ir.bootstrap.greetings[0]).toEqual({
      id: "default",
      speaker: "participant:self",
      text: "Hi {{late:user}}.",
      locales: { ja: "やあ、{{late:user}}。" },
      scenario_hint: "rooftop",
    });
    expect(ir.late_slots[0]?.used_by).toEqual(["bootstrap:default"]);
    const bad = level0Character({
      bootstrap: {
        greetings: [
          {
            id: "default",
            text: "x",
            locale: {
              ja: { content: { type: "dialogue", turns: [{ speaker: "{{self}}", text: "x" }] } },
            },
          },
        ],
      },
    });
    expect(codeOf(() => resolve({ root: rel(1, bad) }))).toBe("resolve.greeting_locale_not_text");
  });

  it("collects contributors and import omissions", () => {
    const c = level0Character({
      authors: [{ name: "DJJ" }],
      provenance: {
        contributors: [
          { author: { guest_id: "g1", display_name: "Guest" }, contribution: tid("ctb", 1) },
        ],
        imported_from: {
          format: "ccv3",
          source_digest: `sha256:${"c".repeat(64)}`,
          omitted_policy_fields: ["system_prompt", "post_history_instructions"],
        },
      },
      meta: { ...META, content_warnings: ["violence"], recommended_presets: ["@djj/preset"] },
    });
    const ir = resolve({ root: rel(1, c) }).ir;
    expect(ir.meta.attribution).toEqual([{ ref: "@djj/alice", authors: [{ name: "DJJ" }] }]);
    expect(ir.meta.contributors).toEqual([
      {
        ref: "@djj/alice",
        author: { guest_id: "g1", display_name: "Guest" },
        contribution: tid("ctb", 1),
      },
    ]);
    expect(ir.meta.import_omissions).toEqual([
      { ref: "@djj/alice", fields: ["post_history_instructions", "system_prompt"] },
    ]);
    expect(ir.meta.content_warnings).toEqual(["violence"]);
    expect(ir.meta.recommended_presets).toEqual(["@djj/preset"]);
  });
});

describe("template helpers", () => {
  it("tokenizes placeholders and brace runs unambiguously", () => {
    const t = (s: string) => tokenizeTemplate(s).tokens;
    expect(t("{{{self}}")).toEqual([{ t: "text", v: "{" }, { t: "self" }]);
    expect(t("{{{{self}}")).toEqual([{ t: "text", v: "{{self}}" }]);
    expect(t("a { b }} c")).toEqual([{ t: "text", v: "a { b }} c" }]);
    expect(t("{{param:n}}{{slot:a}}{{user}}")).toEqual([
      { t: "param", name: "n" },
      { t: "slot", name: "a" },
      { t: "user" },
    ]);
  });

  it("reports unknown, unclosed and invalid placeholders", () => {
    expect(tokenizeTemplate("{{char}}").issues[0]?.code).toBe("template.unknown_placeholder");
    expect(tokenizeTemplate("{{self").issues[0]?.code).toBe("template.unclosed");
    expect(tokenizeTemplate("{{slot:Bad}}").issues[0]?.code).toBe("template.invalid_name");
    expect(tokenizeTemplate("{{late:user}}").issues[0]?.code).toBe("template.unknown_placeholder");
    expect(codeOf(() => parseTemplate("{{nope}}"))).toBe("template.unknown_placeholder");
  });

  it("finalizes IR text by binding late slots and unescaping braces", () => {
    expect(finalizeIrText("Hi {{late:user}}, {{{{literal}}", () => "Sam")).toBe(
      "Hi Sam, {{literal}}",
    );
    expect(codeOf(() => finalizeIrText("{{self}}", () => ""))).toBe("template.unknown_placeholder");
    expect(escapeTemplateText("{{x}}")).toBe("{{{{x}}");
    expect(placeholderText({ t: "late", key: "user" })).toBe("{{late:user}}");
    expect(placeholderText({ t: "param", name: "a" })).toBe("{{param:a}}");
    expect(displayFragmentId("@a/b#c~root")).toBe("@a/b#c");
    expect(displayFragmentId("@a/b#c")).toBe("@a/b#c");
  });
});
