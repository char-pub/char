import { canonicalizeCreation, isCharError, sha256Bytes } from "@char-pub/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { base64Encode, utf8Encode } from "../src/bytes.js";
import { importCard } from "../src/import.js";
import { encodeTextChunk, readPngChunks } from "../src/png.js";
import { cardChunk, charx, pngCard, tinyPng, v3Card } from "./helpers.js";

const OPTS = { ids: { creation: "cr_01h455vb4pex5vsknk084sn001" }, ref: "@importer/mira" };

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return isCharError(e) ? e.code : `non-char:${String(e)}`;
  }
  return undefined;
}

function fragments(r: ReturnType<typeof importCard>) {
  return r.creation.fragments ?? [];
}

describe("importCard: field mapping", () => {
  const r = importCard(v3Card(), OPTS);

  it("maps core fields", () => {
    expect(r.creation.display_name).toBe("Mira");
    expect(r.creation.summary).toBe("A quiet character for slow scenes.");
    expect(r.creation.meta.tags).toEqual(["original", "slice of life"]);
    expect(r.creation.authors).toEqual([{ name: "synthetic-author" }]);
    expect(r.creation.type).toBe("character");
  });

  it("maps description / personality / scenario to fragments with stable IDs", () => {
    const byId = new Map(fragments(r).map((f) => [f.id, f]));
    expect(byId.get("description")).toMatchObject({
      stable: true,
      kind: "character",
      content: {
        type: "text",
        text: "{{self}} is a lighthouse keeper who talks to {{user}} about storms.",
      },
    });
    expect(byId.get("personality")?.kind).toBe("character");
    expect(byId.get("scenario")).toMatchObject({ kind: "scenario", stable: true });
  });

  it("maps greetings and skips empty ones", () => {
    expect(r.creation.bootstrap?.greetings).toEqual([
      { id: "default", text: "You're soaked. Come in, {{user}}." },
      { id: "alt-1", text: "Oh. It's you again." },
      { id: "alt-2", text: "The lamp needs fixing." },
    ]);
  });

  it("parses multi-block examples into dialogue fragments", () => {
    const ex = fragments(r).filter((f) => f.kind === "examples");
    expect(ex.map((f) => f.id)).toEqual(["examples/1", "examples/2"]);
    expect(ex.every((f) => f.stable === false)).toBe(true);
    expect(ex[0]?.content).toEqual({
      type: "dialogue",
      turns: [
        { speaker: "{{user}}", text: "Is the storm bad?" },
        { speaker: "{{self}}", text: "Worst in a decade.\nStay inside." },
      ],
    });
  });

  it("imports lorebook entries as unstable knowledge fragments", () => {
    const lore = fragments(r).filter((f) => f.kind === "knowledge");
    expect(lore.map((f) => f.id)).toEqual([
      "lore/lamp",
      "lore/lamp-2",
      expect.stringMatching(/^lore\/h[0-9a-f]{12}$/),
      "lore/ghost",
    ]);
    expect(lore.every((f) => f.stable === false)).toBe(true);
    expect(lore[0]?.activation).toEqual({
      mode: "keyword",
      keys: ["lamp", "light"],
      scan_depth: 4,
    });
    expect(lore[1]?.activation).toEqual({
      mode: "keyword",
      keys: ["storm"],
      secondary: ["night"],
      case_sensitive: true,
      scan_depth: 4,
    });
    // @@activate → always（省略 activation）
    expect(lore[2]?.activation).toBeUndefined();
    expect(lore[2]?.content).toEqual({ type: "text", text: "The island has no trees." });
    // enabled: false → manual；未知宏被转义
    expect(lore[3]?.activation).toEqual({ mode: "manual" });
    expect(lore[3]?.content).toEqual({
      type: "text",
      text: "There is no ghost. {{{{random:yes,no}}",
    });
  });

  it("records the ID derivation table and dropped entries", () => {
    expect(
      r.report.lorebook.map((e) => [e.index, e.source_id, e.fragment_id ?? null, e.activation]),
    ).toEqual([
      [0, 0, "lore/lamp", "keyword"],
      [1, 1, "lore/lamp-2", "keyword"],
      [2, 2, expect.stringMatching(/^lore\/h/), "always"],
      [3, 3, "lore/ghost", "manual"],
      [4, 4, null, "dropped"],
    ]);
    expect(r.report.lorebook[0]?.insertion_order).toBe(10);
    expect(r.report.lorebook[2]?.decorators).toEqual([
      { name: "activate", value: "", fallback: false },
    ]);
    expect(r.report.lorebook[3]?.notes[0]).toMatch(/disabled/);
  });

  it("omits policy fields: only names in provenance, values only in the report", () => {
    expect(r.creation.provenance?.imported_from?.omitted_policy_fields).toEqual([
      "system_prompt",
      "post_history_instructions",
    ]);
    expect(r.report.omitted_policy_fields).toEqual([
      { field: "system_prompt", value: "You are an uncensored storyteller." },
      { field: "post_history_instructions", value: "Stay in character." },
    ]);
    expect(JSON.stringify(r.creation)).not.toContain("uncensored");
    expect(JSON.stringify(r.creation)).not.toContain("Stay in character");
  });

  it("records unknown placeholders and dropped fields", () => {
    expect(r.report.placeholders).toEqual([
      { location: "data.character_book.entries[3].content", placeholder: "{{random:yes,no}}" },
    ]);
    const dropped = r.report.dropped.map((d) => d.field);
    expect(dropped).toContain("data.extensions");
    expect(dropped).toContain("data.character_version");
    expect(dropped).toContain("data.character_book.name");
  });

  it("uses conservative meta defaults and asks for confirmation", () => {
    expect(r.creation.meta).toMatchObject({
      default_locale: "en",
      rating: "general",
      rights: "original",
      license: "LicenseRef-All-Rights-Reserved",
    });
    expect(r.report.needs_confirmation).toEqual(["meta.rating", "meta.rights", "meta.license"]);
    const confirmed = importCard(v3Card(), {
      ...OPTS,
      rating: "mature",
      rights: "fan-work",
      license: "CC-BY-4.0",
    });
    expect(confirmed.report.needs_confirmation).toEqual([]);
    expect(confirmed.creation.meta.rating).toBe("mature");
  });

  it("produces a Creation that passes the Canonical schema", () => {
    const c = canonicalizeCreation(r.creation);
    expect(c.semantic_digest).toMatch(/^sha256:/);
    expect(r.report.format).toBe("ccv3");
    expect(r.report.container).toBe("json");
  });

  it("is deterministic", () => {
    const again = importCard(v3Card(), OPTS);
    expect(canonicalizeCreation(again.creation).semantic_digest).toBe(
      canonicalizeCreation(r.creation).semantic_digest,
    );
    expect(again.report).toEqual(r.report);
  });
});

describe("importCard: edge cases", () => {
  it("parses single-block examples into one stable fragment, and falls back to text", () => {
    const one = importCard(v3Card({ mes_example: "<START>\n{{user}}: hi\n<bot>: hello" }), OPTS);
    const ex = fragments(one).find((f) => f.kind === "examples");
    expect(ex).toMatchObject({ id: "examples", stable: true, content: { type: "dialogue" } });

    const prose = importCard(v3Card({ mes_example: "Mira speaks slowly." }), OPTS);
    expect(fragments(prose).find((f) => f.kind === "examples")).toMatchObject({
      id: "examples",
      content: { type: "text", text: "Mira speaks slowly." },
    });
    expect(prose.report.warnings.map((w) => w.code)).toContain("ccv3.examples_as_text");
  });

  it("converts legacy tags and case-insensitive macros", () => {
    const r = importCard(
      v3Card({ description: "<BOT> meets <user>. {{CHAR}} {{ User }} {{ unclosed" }),
      OPTS,
    );
    expect(fragments(r)[0]?.content).toEqual({
      type: "text",
      text: "{{self}} meets {{user}}. {{self}} {{user}} {{{{ unclosed",
    });
  });

  it("handles secondary key logic, regex and constant entries", () => {
    const entry = (extra: Record<string, unknown>) => ({
      keys: ["k"],
      content: "c",
      extensions: {},
      enabled: true,
      insertion_order: 0,
      use_regex: false,
      ...extra,
    });
    const r = importCard(
      v3Card({
        character_book: {
          extensions: {},
          entries: [
            entry({ selective: true, secondary_keys: "a, b", extensions: { selectiveLogic: 3 } }),
            entry({ selective: true, secondary_keys: ["a"], extensions: { selectiveLogic: 1 } }),
            entry({ use_regex: true, keys: ["/k/i"] }),
            entry({ constant: true }),
            entry({ keys: [] }),
            entry({ content: "@@dont_activate\nhidden" }),
            entry({ content: "@@risu_thing 1\n@@@activate\nshown" }),
            entry({ extensions: { match_whole_words: true } }),
          ],
        },
      }),
      OPTS,
    );
    const acts = fragments(r)
      .filter((f) => f.kind === "knowledge")
      .map((f) => f.activation ?? { mode: "always" });
    expect(acts).toEqual([
      { mode: "keyword", keys: ["k"], secondary: ["a", "b"], logic: "all" },
      { mode: "keyword", keys: ["k"] },
      { mode: "manual" },
      { mode: "always" },
      { mode: "manual" },
      { mode: "manual" },
      { mode: "always" },
      { mode: "keyword", keys: ["k"], whole_word: true },
    ]);
    expect(r.report.lorebook[1]?.notes[0]).toMatch(/secondary key logic/);
  });

  it("clamps or ignores out-of-range scan depth", () => {
    const book = (scan_depth: number) => ({
      extensions: {},
      scan_depth,
      entries: [
        {
          keys: ["k"],
          content: "c",
          extensions: {},
          enabled: true,
          insertion_order: 0,
          use_regex: false,
        },
      ],
    });
    const big = importCard(v3Card({ character_book: book(5000) }), OPTS);
    expect(fragments(big).find((f) => f.kind === "knowledge")?.activation).toMatchObject({
      scan_depth: 1000,
    });
    const zero = importCard(v3Card({ character_book: book(0) }), OPTS);
    expect(fragments(zero).find((f) => f.kind === "knowledge")?.activation).toEqual({
      mode: "keyword",
      keys: ["k"],
    });
  });

  it("uses multilingual creator notes", () => {
    const r = importCard(
      v3Card({
        creator_notes: "English",
        creator_notes_multilingual: { ja: "日本語", "bad code!": "x" },
      }),
      OPTS,
    );
    expect(r.creation.summary).toEqual({ ja: "日本語", en: "English" });
    expect(r.report.dropped.map((d) => d.field)).toContain(
      "data.creator_notes_multilingual.bad code!",
    );
  });

  it("warns about missing name and character text", () => {
    const r = importCard(v3Card({ name: "", description: "", personality: "" }), OPTS);
    expect(r.creation.display_name).toBe("Untitled");
    expect(r.report.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(["ccv3.missing_name", "ccv3.no_character_text"]),
    );
  });

  it("drops overlong tags and uses the first alternate greeting as default when first_mes is empty", () => {
    const r = importCard(
      v3Card({ tags: ["x".repeat(65), "ok"], first_mes: "", alternate_greetings: ["hey"] }),
      OPTS,
    );
    expect(r.creation.meta.tags).toEqual(["ok"]);
    expect(r.creation.bootstrap?.greetings).toEqual([{ id: "default", text: "hey" }]);
  });

  it("accepts V2 and V1 cards", () => {
    const v2 = importCard(
      { spec: "chara_card_v2", spec_version: "2.0", data: { name: "Old", description: "d" } },
      OPTS,
    );
    expect(v2.report.format).toBe("ccv2");
    const v1 = importCard({ name: "Older", description: "d", first_mes: "hi" }, OPTS);
    expect(v1.report.format).toBe("ccv1");
    expect(v1.creation.display_name).toBe("Older");
  });

  it("warns about newer spec versions", () => {
    const card = v3Card();
    card.spec_version = "3.5";
    expect(importCard(card, OPTS).report.warnings.map((w) => w.code)).toContain("ccv3.newer_spec");
  });

  it("accepts null and missing fields leniently", () => {
    const r = importCard(
      {
        spec: "chara_card_v3",
        data: { name: "N", description: null, tags: null, alternate_greetings: [null, "a"] },
      },
      OPTS,
    );
    expect(r.creation.bootstrap?.greetings).toEqual([{ id: "default", text: "a" }]);
  });
});

describe("importCard: containers", () => {
  it("reads a PNG card, prefers ccv3 over chara, and uses the image as avatar", () => {
    const png = pngCard(v3Card(), { v2: { spec: "chara_card_v2", data: { name: "V2 name" } } });
    const r = importCard(png, OPTS);
    expect(r.creation.display_name).toBe("Mira");
    expect(r.report.container).toBe("png");
    expect(r.report.source_digest).toBe(sha256Bytes(png));
    expect(r.assets).toHaveLength(1);
    const avatar = r.assets[0];
    expect(avatar).toMatchObject({
      slot: "avatar",
      variant: "default",
      media_type: "image/png",
      source_uri: "ccdefault:",
    });
    // 头像已去掉卡片数据：原始 system_prompt 不会随图片流出
    expect(readPngChunks(avatar?.bytes ?? new Uint8Array(0)).map((c) => c.type)).toEqual([
      "IHDR",
      "IDAT",
      "IEND",
    ]);
    expect(r.creation.assets?.[0]).toEqual({
      slot: "avatar",
      role: "presentation",
      variants: [
        {
          id: "default",
          media_type: "image/png",
          blob: { digest: avatar?.digest, size: avatar?.bytes.length, availability: "mirrored" },
        },
      ],
    });
  });

  it("falls back to the V2 chunk with a warning", () => {
    const png = tinyPng([
      cardChunk("chara", { spec: "chara_card_v2", data: { name: "Only V2", description: "d" } }),
    ]);
    const r = importCard(png, OPTS);
    expect(r.creation.display_name).toBe("Only V2");
    expect(r.report.warnings.map((w) => w.code)).toContain("ccv3.v2_chunk_only");
  });

  it("rejects PNGs without card data or with broken payloads", () => {
    expect(codeOf(() => importCard(tinyPng(), OPTS))).toBe("ccv3.no_card_data");
    expect(codeOf(() => importCard(tinyPng([encodeTextChunk("ccv3", "!!!")]), OPTS))).toBe(
      "ccv3.invalid_base64",
    );
    const notJson = tinyPng([encodeTextChunk("ccv3", base64Encode(utf8Encode("{nope")))]);
    expect(codeOf(() => importCard(notJson, OPTS))).toBe("ccv3.invalid_json");
    const badUtf8 = tinyPng([
      encodeTextChunk("ccv3", base64Encode(new Uint8Array([0x7b, 0xff, 0x7d]))),
    ]);
    expect(codeOf(() => importCard(badUtf8, OPTS))).toBe("ccv3.invalid_utf8");
  });

  it("reads PNG embedded assets through __asset:", () => {
    const bg = tinyPng();
    const card = v3Card({
      assets: [
        { type: "icon", uri: "ccdefault:", name: "main", ext: "png" },
        { type: "background", uri: "__asset:bg.png", name: "main", ext: "png" },
        { type: "background", uri: "__asset:missing.png", name: "night", ext: "png" },
      ],
    });
    const png = pngCard(card, {
      extra: [encodeTextChunk("chara-ext-asset_:bg.png", base64Encode(bg))],
    });
    const r = importCard(png, OPTS);
    expect(r.assets.map((a) => [a.slot, a.variant])).toEqual([
      ["avatar", "default"],
      ["background", "default"],
    ]);
    expect(r.report.assets.find((a) => a.uri === "__asset:missing.png")?.reason).toBe(
      "embedded file not found",
    );
  });

  it("reads a CHARX card with embedded assets", () => {
    const card = v3Card({
      assets: [
        { type: "icon", uri: "embeded://assets/icon/images/main.png", name: "main", ext: "png" },
        { type: "icon", uri: "embeded://assets/icon/images/alt.png", name: "Alt Look", ext: "png" },
        {
          type: "emotion",
          uri: "embeded://assets/emotion/images/happy.png",
          name: "happy",
          ext: "png",
        },
        {
          type: "emotion",
          uri: "embeded://assets/emotion/images/fake.png",
          name: "fake",
          ext: "png",
        },
        {
          type: "user_icon",
          uri: "embeded://assets/user_icon/images/u.png",
          name: "me",
          ext: "png",
        },
        { type: "x_custom", uri: "embeded://a", name: "a", ext: "bin" },
        { type: "background", uri: "https://example.com/bg.png", name: "main", ext: "png" },
        { type: "background", uri: "ftp://example.com/bg.png", name: "b", ext: "png" },
      ],
    });
    const zip = charx({
      "card.json": JSON.stringify(card),
      "assets/icon/images/main.png": tinyPng(),
      "assets/icon/images/alt.png": tinyPng([encodeTextChunk("x", "y")]),
      "assets/emotion/images/happy.png": tinyPng(),
      "assets/emotion/images/fake.png": "not an image",
      "assets/user_icon/images/u.png": tinyPng(),
    });
    const r = importCard(zip, OPTS);
    expect(r.report.container).toBe("charx");
    expect(r.report.format).toBe("charx");
    expect(r.assets.map((a) => [a.slot, a.variant])).toEqual([
      ["avatar", "default"],
      ["avatar", "alt-look"],
      ["emotion", "default"],
    ]);
    const reasons = Object.fromEntries(
      r.report.assets.filter((a) => !a.imported).map((a) => [a.name, a.reason]),
    );
    expect(reasons).toEqual({
      fake: "not a PNG, JPEG, WebP or GIF image",
      me: "user icons belong to the user's persona",
      a: "unsupported asset type",
      main: "remote URLs are not fetched during import",
      b: "unsupported URI scheme",
    });
    expect(canonicalizeCreation(r.creation).creation.assets).toHaveLength(2);
  });

  it("decodes base64 data URL assets and rejects bad ones", () => {
    const img = tinyPng();
    const card = v3Card({
      assets: [
        {
          type: "icon",
          uri: `data:image/png;base64,${base64Encode(img)}`,
          name: "main",
          ext: "png",
        },
        { type: "background", uri: "data:image/png;base64,!!!", name: "main", ext: "png" },
        { type: "emotion", uri: "data:text/plain,hello", name: "x", ext: "txt" },
      ],
    });
    const r = importCard(card, OPTS);
    expect(r.assets.map((a) => a.slot)).toEqual(["avatar"]);
    expect(r.report.assets.map((a) => a.reason ?? "ok")).toEqual([
      "ok",
      "invalid base64 data URL",
      "only base64 data URLs are supported",
    ]);
  });

  it("enforces the asset size limit", () => {
    const card = v3Card({
      assets: [
        {
          type: "icon",
          uri: `data:image/png;base64,${base64Encode(tinyPng())}`,
          name: "main",
          ext: "png",
        },
      ],
    });
    const r = importCard(card, { ...OPTS, limits: { maxAssetBytes: 10 } });
    expect(r.assets).toEqual([]);
    expect(r.report.assets[0]?.reason).toBe("asset too large");
  });

  it("rejects CHARX without card.json and with path traversal", () => {
    expect(codeOf(() => importCard(charx({ "other.json": "{}" }), OPTS))).toBe(
      "charx.missing_card",
    );
    expect(codeOf(() => importCard(charx({ "../card.json": "{}" }), OPTS))).toBe(
      "charx.unsafe_path",
    );
  });

  it("reads JSON from bytes and strings, and rejects bad input", () => {
    const json = JSON.stringify(v3Card());
    expect(importCard(utf8Encode(`﻿  ${json}`), OPTS).creation.display_name).toBe("Mira");
    expect(importCard(json, OPTS).creation.display_name).toBe("Mira");
    expect(codeOf(() => importCard("{bad", OPTS))).toBe("ccv3.invalid_json");
    expect(codeOf(() => importCard(utf8Encode("GIF89a"), OPTS))).toBe("ccv3.unrecognized_format");
    expect(
      codeOf(() => importCard(utf8Encode(json), { ...OPTS, limits: { maxJsonBytes: 10 } })),
    ).toBe("ccv3.too_large");
    expect(codeOf(() => importCard(json, { ...OPTS, limits: { maxJsonBytes: 10 } }))).toBe(
      "ccv3.too_large",
    );
    expect(codeOf(() => importCard("[]", OPTS))).toBe("ccv3.invalid_card");
    expect(codeOf(() => importCard({ spec: "something_else", data: {} }, OPTS))).toBe(
      "ccv3.invalid_card",
    );
    expect(codeOf(() => importCard({ foo: 1 }, OPTS))).toBe("ccv3.invalid_card");
    expect(codeOf(() => importCard({ spec: "chara_card_v3", data: "x" }, OPTS))).toBe(
      "ccv3.invalid_card",
    );
    expect(codeOf(() => importCard({ spec: "chara_card_v3", data: { name: 5 } }, OPTS))).toBe(
      "ccv3.invalid_card",
    );
  });

  it("rejects invalid caller options through schema validation", () => {
    expect(codeOf(() => importCard(v3Card(), { ...OPTS, ref: "@Bad/Ref" }))).toBe("schema.invalid");
  });

  it("never throws anything but CharError for random bytes or mutated cards (fuzz)", () => {
    const base = pngCard(v3Card());
    fc.assert(
      fc.property(
        fc.oneof(
          fc.uint8Array({ maxLength: 300 }),
          fc
            .array(fc.tuple(fc.nat(base.length - 1), fc.integer({ min: 0, max: 255 })), {
              maxLength: 6,
            })
            .map((edits) => {
              const b = base.slice();
              for (const [i, v] of edits) b[i] = v;
              return b;
            }),
        ),
        (bytes) => {
          try {
            importCard(bytes, OPTS);
          } catch (e) {
            expect(isCharError(e)).toBe(true);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("never throws anything but CharError for random JSON-shaped cards (fuzz)", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.jsonValue(), (data, book) => {
        try {
          importCard(
            {
              spec: "chara_card_v3",
              spec_version: "3.0",
              data: {
                name: "x",
                ...(typeof data === "object" && data && !Array.isArray(data) ? data : {}),
                character_book: book,
              },
            },
            OPTS,
          );
        } catch (e) {
          expect(isCharError(e)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
});
