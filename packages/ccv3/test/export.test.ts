import {
  type ContextIR,
  ContextIRSchema,
  type IRFragment,
  irFragmentDigest,
  isCharError,
  parseCreationRef,
} from "@char-pub/core";
import { describe, expect, it } from "vitest";
import { base64Decode, utf8Decode } from "../src/bytes.js";
import { estimateTokens, exportCCv3 } from "../src/export.js";
import { importCard } from "../src/import.js";
import { readPngChunks, readPngTextEntries } from "../src/png.js";
import { tinyPng, v3Card } from "./helpers.js";
import { singleCreationIR } from "./single-creation-ir.js";

const OPTS = { ids: { creation: "cr_01h455vb4pex5vsknk084sn001" }, ref: "@importer/mira" };
const REL_DEP = "rel_01h455vb4pex5vsknk084sn002";
const DEP_INSTANCE = "a".repeat(64);
const FRIEND = `l:${"c".repeat(64)}`;
const UNUSED = `l:${"d".repeat(64)}`;

function frag(
  partial: Omit<
    IRFragment,
    "digest" | "origin" | "importance" | "placement_hint" | "visibility" | "activation"
  > &
    Partial<Pick<IRFragment, "importance" | "placement_hint" | "visibility" | "activation">> & {
      from?: string;
      fragment: string;
    },
): IRFragment {
  const { from, fragment, ...rest } = partial;
  const sem = {
    kind: rest.kind,
    content: rest.content,
    activation: rest.activation ?? { mode: "always" as const },
    visibility: rest.visibility ?? { scope: "shared" as const },
    importance: rest.importance ?? ("normal" as const),
    placement_hint: rest.placement_hint ?? rest.kind,
    ...(rest.subject !== undefined ? { subject: rest.subject } : {}),
    ...(rest.asset_refs !== undefined ? { asset_refs: rest.asset_refs } : {}),
    ...(rest.locales !== undefined ? { locales: rest.locales } : {}),
  };
  const creation = from ?? "@djj/alice";
  const dep = creation !== "@djj/alice";
  return {
    id: rest.id,
    ...sem,
    origin: {
      creation,
      release: dep ? REL_DEP : "rel_01h455vb4pex5vsknk084sn001",
      fragment,
      via: dep ? ["world"] : [],
      instance_key: dep ? DEP_INSTANCE : "root",
      stable: true,
    },
    digest: irFragmentDigest(sem),
  };
}

/** 手写的 IR：根角色 + 一个依赖世界，覆盖导出器需要处理的各种情况。 */
function handIR(): ContextIR {
  const base = singleCreationIR({
    id: "cr_01h455vb4pex5vsknk084sn001",
    ref: "@djj/alice",
    type: "character",
    display_name: "Alice",
    authors: [{ name: "djj" }],
    fragments: [
      { id: "placeholder", stable: true, kind: "character", content: { type: "text", text: "x" } },
    ],
    bootstrap: {
      greetings: [
        { id: "default", text: "Hi {{user}}." },
        { id: "alt-1", text: "Again?" },
      ],
    },
    meta: { default_locale: "en", rating: "teen", rights: "original", license: "CC-BY-4.0" },
  });
  const W = "@night/city";
  const fragments: IRFragment[] = [
    frag({
      id: "@djj/alice#description~root",
      fragment: "description",
      kind: "character",
      content: {
        type: "text",
        text: "Alice is a courier. Literal {{{{braces}}.",
        format: "markdown",
      },
      locales: { ja: { type: "text", text: "アリスは運び屋。", format: "markdown" } },
    }),
    frag({
      id: "@djj/alice#fear~root",
      fragment: "fear",
      kind: "instruction",
      content: { type: "text", text: "She never admits fear to {{late:user}}.", format: "plain" },
      visibility: { scope: "private", to: ["participant:self"] },
      importance: "pinned",
    }),
    frag({
      id: "@djj/alice#examples~root",
      fragment: "examples",
      kind: "examples",
      content: {
        type: "dialogue",
        turns: [
          { speaker: "participant:user", text: "Late again?" },
          { speaker: "participant:self", text: "Traffic." },
          { speaker: "participant:p:bob", text: "Hey." },
        ],
      },
    }),
    frag({
      id: `${W}#world~${DEP_INSTANCE}`,
      from: W,
      fragment: "world",
      kind: "world",
      content: { type: "text", text: "Night City never sleeps.", format: "markdown" },
    }),
    frag({
      id: `${W}#scenario~${DEP_INSTANCE}`,
      from: W,
      fragment: "scenario",
      kind: "scenario",
      content: { type: "text", text: "Rain on neon.", format: "markdown" },
    }),
    frag({
      id: `${W}#lore/arasaka~${DEP_INSTANCE}`,
      from: W,
      fragment: "lore/arasaka",
      kind: "knowledge",
      content: { type: "text", text: "Arasaka owns the tower.", format: "markdown" },
      activation: {
        mode: "keyword",
        keys: ["Arasaka"],
        secondary: ["tower"],
        logic: "all",
        case_sensitive: true,
        whole_word: true,
        scan_depth: 3,
      },
    }),
    frag({
      id: `${W}#lore/rumor~${DEP_INSTANCE}`,
      from: W,
      fragment: "lore/rumor",
      kind: "knowledge",
      content: { type: "text", text: "A rumor.", format: "markdown" },
      activation: { mode: "semantic", hint: "rumors" },
    }),
    frag({
      id: `${W}#lore/secret~${DEP_INSTANCE}`,
      from: W,
      fragment: "lore/secret",
      kind: "knowledge",
      content: { type: "text", text: "Only on request.", format: "markdown" },
      activation: { mode: "manual" },
    }),
    frag({
      id: `${W}#bob~${DEP_INSTANCE}`,
      from: W,
      fragment: "bob",
      kind: "character",
      subject: "p:bob",
      content: {
        type: "text",
        text: `Bob is a fixer who owes {{late:${FRIEND}}} money.`,
        format: "markdown",
      },
    }),
    frag({
      id: `${W}#map~${DEP_INSTANCE}`,
      from: W,
      fragment: "map",
      kind: "world",
      content: {
        type: "media",
        asset: `${W}#asset/map/default~${DEP_INSTANCE}`,
        caption: "City map.",
      },
      asset_refs: [`${W}#asset/map/default~${DEP_INSTANCE}`],
    }),
    frag({
      id: `${W}#data~${DEP_INSTANCE}`,
      from: W,
      fragment: "data",
      kind: "world",
      content: { type: "structured", schema: "x-stats", data: { population: 1 } },
      visibility: { scope: "scene", scene: "night" },
    }),
  ];
  return {
    ...base,
    meta: {
      ...base.meta,
      rating: "mature",
      licenses: [
        { ref: "@djj/alice", license: "CC-BY-4.0" },
        { ref: W, license: "CC-BY-NC-4.0" },
        { ref: W, license: "CC0-1.0", asset: "map/default" },
      ],
      attribution: [
        { ref: "@djj/alice", authors: [{ name: "djj" }] },
        { ref: W, authors: [] },
      ],
      import_omissions: [
        { ref: "@djj/alice", fields: ["system_prompt", "post_history_instructions"] },
      ],
    },
    participants: [
      ...base.participants,
      {
        key: "p:bob",
        ref: "@night/bob",
        display_name: { en: "Bob", ja: "ボブ" },
        kind: "character",
      },
      { key: "p:you", display_name: "You", kind: "persona", late: "user" },
    ],
    late_slots: [
      ...base.late_slots,
      { key: FRIEND, accepts: ["character"], required: false, hint: "a friend", used_by: [] },
      { key: UNUSED, accepts: ["persona"], required: false, used_by: [] },
    ],
    fragments,
    bootstrap: {
      greetings: [
        { id: "default", speaker: "self", text: "Hi {{late:user}}.", locales: { ja: "やあ。" } },
        { id: "alt-1", speaker: "self", text: "Again?" },
      ],
    },
    assets: [
      {
        id: `${W}#asset/map/default~${DEP_INSTANCE}`,
        role: "context",
        media_type: "image/webp",
        digest: `sha256:${"b".repeat(64)}`,
        availability: "mirrored",
        access: "public",
        rating: "general",
        license: "CC0-1.0",
        origin: {
          creation: W,
          release: REL_DEP,
          slot: "map",
          variant: "default",
          instance_key: DEP_INSTANCE,
        },
      },
    ],
  };
}

describe("exportCCv3", () => {
  const ir = handIR();

  it("uses a valid IR fixture", () => {
    expect(ContextIRSchema.safeParse(ir).success).toBe(true);
  });

  const { card, v2, loss } = exportCCv3(ir);

  it("writes the character description first, then flattened dependencies with headings", () => {
    expect(card.spec).toBe("chara_card_v3");
    expect(card.data.name).toBe("Alice");
    const d = card.data.description;
    expect(d.startsWith("Alice is a courier. Literal {{braces}}.")).toBe(true);
    expect(d).toContain(
      "[Notes · @djj/alice#fear]\n(Only {{char}} knows this.)\nShe never admits fear to {{user}}.",
    );
    expect(d).toContain("[World · @night/city#world]\nNight City never sleeps.");
    expect(d).toContain("[World · @night/city#map]\nCity map.");
    expect(card.data.scenario).toBe("[Scenario · @night/city#scenario]\nRain on neon.");
  });

  it("writes keyword fragments and other characters as lorebook entries", () => {
    const entries = card.data.character_book?.entries ?? [];
    expect(entries.map((e) => e.keys)).toEqual([["Arasaka"], ["Bob"]]);
    expect(entries[0]).toMatchObject({
      content: "Arasaka owns the tower.",
      enabled: true,
      constant: false,
      use_regex: false,
      case_sensitive: true,
      selective: true,
      secondary_keys: ["tower"],
      extensions: { selectiveLogic: 3, match_whole_words: true, depth: 3 },
      insertion_order: 0,
    });
    expect(entries[1]).toMatchObject({
      constant: true,
      content: "Bob is a fixer who owes a friend money.",
    });
  });

  it("writes examples and greetings", () => {
    expect(card.data.mes_example).toBe(
      "<START>\n{{user}}: Late again?\n{{char}}: Traffic.\nBob: Hey.",
    );
    expect(card.data.first_mes).toBe("Hi {{user}}.");
    expect(card.data.alternate_greetings).toEqual(["Again?"]);
  });

  it("does not write policy fields unless a preset is chosen", () => {
    expect(card.data.system_prompt).toBe("");
    expect(card.data.post_history_instructions).toBe("");
    expect(loss.policy_fields).toEqual([
      {
        ref: "@djj/alice",
        fields: ["system_prompt", "post_history_instructions"],
        restored: false,
      },
    ]);
    const withPreset = exportCCv3(ir, {
      preset: { system_prompt: "S", post_history_instructions: "P" },
    });
    expect(withPreset.card.data.system_prompt).toBe("S");
    expect(withPreset.loss.policy_fields[0]?.restored).toBe(true);
  });

  it("records attribution, licenses and IR provenance", () => {
    expect(card.data.creator).toBe("djj");
    expect(card.data.creator_notes).toContain("Rating: mature");
    expect(card.data.creator_notes).toContain("@night/city (map/default): CC0-1.0");
    expect(card.data.creator_notes).toContain("@night/city: unknown");
    expect(card.data.extensions.char_pub).toEqual({
      root: ir.root,
      lock_digest: ir.lock_digest,
      ir_version: "0-draft",
    });
  });

  it("produces a complete loss report", () => {
    expect(loss.profile).toEqual({ mode: "narrator", tokenizer: "estimate" });
    expect(loss.flattened_dependencies).toEqual([
      {
        ref: "@night/city",
        fragments: [
          `@night/city#world~${DEP_INSTANCE}`,
          `@night/city#scenario~${DEP_INSTANCE}`,
          `@night/city#lore/arasaka~${DEP_INSTANCE}`,
          `@night/city#bob~${DEP_INSTANCE}`,
          `@night/city#map~${DEP_INSTANCE}`,
        ],
        tokens: expect.any(Number),
        into: ["character_book", "description", "scenario"],
      },
    ]);
    expect(loss.activation_downgrades.map((d) => [d.subject.split("#")[1], d.from, d.to])).toEqual([
      [`lore/rumor~${DEP_INSTANCE}`, "semantic", "dropped"],
      [`lore/secret~${DEP_INSTANCE}`, "manual", "dropped"],
    ]);
    expect(loss.visibility.map((v) => v.subject)).toEqual([
      "@djj/alice#fear~root",
      `@night/city#data~${DEP_INSTANCE}`,
    ]);
    expect(loss.participants.map((p) => p.subject)).toEqual(["p:bob", FRIEND, UNUSED]);
    expect(loss.context_assets.map((a) => a.subject)).toEqual([
      `@night/city#asset/map/default~${DEP_INSTANCE}`,
    ]);
    expect(loss.locales).toEqual({ dropped: ["ja"], exported: "en" });
    expect(loss.other.map((o) => o.detail)).toEqual(
      expect.arrayContaining([
        "importance 'pinned' has no CCv3 equivalent",
        "attached context assets dropped",
        "media content cannot be embedded in a card; caption kept if present",
        "structured content (x-stats) dropped",
      ]),
    );
    expect(loss.tokens.total).toBe(
      loss.tokens.description +
        loss.tokens.scenario +
        loss.tokens.character_book +
        loss.tokens.mes_example,
    );
    expect(loss.tokens.description).toBeGreaterThan(0);
  });

  it("uses the injected token estimator", () => {
    const r = exportCCv3(ir, { estimateTokens: () => 1 });
    expect(r.loss.flattened_dependencies[0]?.tokens).toBe(5);
  });

  it("produces a matching V2 card without V3-only fields", () => {
    expect(v2.spec).toBe("chara_card_v2");
    expect(v2.data.description).toBe(card.data.description);
    expect("group_only_greetings" in v2.data).toBe(false);
  });

  it("embeds both ccv3 and chara chunks into the avatar PNG", () => {
    const { png } = exportCCv3(ir, { avatarPng: tinyPng() });
    expect(png).toBeDefined();
    const texts = readPngTextEntries(readPngChunks(png ?? new Uint8Array(0)));
    expect(texts.map((t) => t.keyword)).toEqual(["chara", "ccv3"]);
    const decoded = JSON.parse(utf8Decode(base64Decode(texts[1]?.text ?? "", "t"), "t"));
    expect(decoded).toEqual(card);
  });

  it("drops empty fragments and reports speakers that are not participants", () => {
    const base = handIR();
    const r = exportCCv3({
      ...base,
      fragments: [
        frag({
          id: "@djj/alice#empty~root",
          fragment: "empty",
          kind: "character",
          content: { type: "text", text: "  ", format: "markdown" },
        }),
        frag({
          id: "@djj/alice#chat~root",
          fragment: "chat",
          kind: "examples",
          content: { type: "dialogue", turns: [{ speaker: "participant:p:ghost", text: "Boo." }] },
        }),
        frag({
          id: "@djj/alice#you~root",
          fragment: "you",
          kind: "examples",
          content: { type: "dialogue", turns: [{ speaker: "participant:p:you", text: "Me." }] },
        }),
      ],
    });
    expect(r.card.data.description).toBe("");
    expect(r.card.data.mes_example).toBe("<START>\np:ghost: Boo.\n<START>\n{{user}}: Me.");
    expect(r.card.data.character_book).toBeUndefined();
  });

  it("estimates tokens for Latin and CJK text", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("灯塔")).toBe(2);
    expect(estimateTokens("灯塔 ab")).toBe(3);
  });
});

describe("round trip: import → canonical → IR → export", () => {
  it("keeps the character content and reports omitted policy fields", () => {
    const imported = importCard(v3Card(), OPTS);
    const ir = singleCreationIR(imported.creation);
    expect(ContextIRSchema.safeParse(ir).success).toBe(true);
    const { card, loss } = exportCCv3(ir);

    // {{self}} 在 IR 中已绑定为角色名，所以导出后是名字而不是 {{char}}
    expect(
      card.data.description.startsWith(
        "Mira is a lighthouse keeper who talks to {{user}} about storms.",
      ),
    ).toBe(true);
    expect(card.data.description).toContain("Calm, dry humor.");
    expect(card.data.description).toContain("The island has no trees.");
    expect(card.data.scenario).toBe("A stormy night at the lighthouse.");
    expect(card.data.first_mes).toBe("You're soaked. Come in, {{user}}.");
    expect(card.data.alternate_greetings).toEqual([
      "Oh. It's you again.",
      "The lamp needs fixing.",
    ]);
    expect(card.data.mes_example).toBe(
      "<START>\n{{user}}: Is the storm bad?\n{{char}}: Worst in a decade.\nStay inside.\n<START>\n{{user}}: Tea?\n{{char}}: Always.",
    );
    expect(card.data.character_book?.entries.map((e) => e.keys)).toEqual([
      ["lamp", "light"],
      ["storm"],
    ]);
    // 导入时转义的未知宏在导出时恢复原样；它所在的条目是 manual 激活，被降级丢弃
    expect(loss.activation_downgrades.map((d) => d.subject)).toEqual([
      "@importer/mira#lore/ghost~root",
    ]);
    expect(card.data.system_prompt).toBe("");
    expect(loss.policy_fields).toEqual([
      {
        ref: "@importer/mira",
        // Resolver 把字段名排序，保证 IR 与输入顺序无关。
        fields: ["post_history_instructions", "system_prompt"],
        restored: false,
      },
    ]);
    expect(loss.flattened_dependencies).toEqual([]);

    // 再次导入导出的卡片：内容稳定
    const again = importCard(card, OPTS);
    expect(again.creation.display_name).toBe("Mira");
    expect(again.creation.provenance?.imported_from?.omitted_policy_fields).toBeUndefined();
    expect(parseCreationRef(ir.root.ref)).not.toBeNull();
  });

  it("restores escaped card macros on export", () => {
    const imported = importCard(v3Card({ description: "Roll {{roll:d6}} for {{char}}." }), OPTS);
    const ir = singleCreationIR(imported.creation);
    const { card } = exportCCv3(ir);
    expect(card.data.description.startsWith("Roll {{roll:d6}} for Mira.")).toBe(true);
  });

  it("rejects IR text that is not a valid IR template", () => {
    const ir = singleCreationIR(importCard(v3Card(), OPTS).creation);
    const first = ir.fragments[0];
    if (!first) throw new Error("fixture");
    const broken = {
      ...ir,
      fragments: [
        {
          ...first,
          content: { type: "text" as const, text: "{{self}}", format: "markdown" as const },
        },
      ],
    };
    try {
      exportCCv3(broken);
      expect.unreachable();
    } catch (e) {
      expect(isCharError(e)).toBe(true);
    }
  });
});
