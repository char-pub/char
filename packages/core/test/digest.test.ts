/**
 * digest 的独立验证。
 *
 * 1. 已知答案：按规范公式手写 canonical JSON（JCS）字节，期望的 sha256 事先离线算好并写成
 *    字面量，再与实现的结果比较。期望值不经过被测代码生成，其他语言的实现也可以直接复用这些向量。
 *    公式：fragment digest = sha256(JCS(去掉 digest 的 fragment))；
 *    semantic digest = sha256(JCS(去掉 fragments 的 Creation + fragment_digests: [[id, digest], …]))。
 * 2. 性质：任意组合地显式写出默认值（包括空的可选数组 / 映射），digest 与 canonical 形式都不变；
 *    写出非默认值则 digest 改变，确保上面的性质不是空转。
 */
import { createHash } from "node:crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalizeCreation, jcs } from "../src/canonical.js";

const nobleDigest = (s: string) => `sha256:${bytesToHex(sha256(utf8ToBytes(s)))}`;
const nodeDigest = (s: string) => `sha256:${createHash("sha256").update(s, "utf8").digest("hex")}`;

const A64 = "a".repeat(64);
const B64 = "b".repeat(64);

interface Vector {
  name: string;
  input: unknown;
  fragments: { jcs: string; digest: string }[];
  manifest: string;
  semantic_digest: string;
}

const VECTORS: Vector[] = [
  {
    name: "a Level 0 character written with defaults, NFD text, CRLF and trailing whitespace",
    input: {
      id: "cr_01h455vb4pex5vsknk084sn001",
      ref: "@djj/alice",
      type: "character",
      display_name: "Alice",
      fragments: [
        {
          id: "description",
          stable: true,
          kind: "character",
          // 输入里的 é 是 NFD（e + U+0301），canonical 形式里是 NFC（U+00E9）；用转义写出来以免被编辑器归一化。
          content: {
            type: "text",
            text: "Cafe\u0301 owner.  \r\nSecond line\t",
            format: "markdown",
          },
          importance: "normal",
        },
      ],
      meta: {
        default_locale: "en",
        rating: "general",
        rights: "original",
        license: "CC-BY-4.0",
        contribution_policy: "signed-in",
      },
    },
    fragments: [
      {
        jcs: '{"content":{"text":"Caf\u00e9 owner.\\nSecond line","type":"text"},"id":"description","kind":"character","stable":true}',
        digest: "sha256:dc84bebb9c54f4a0b53a58daf8d129af7beaeeb74a474c7ff201b2512fbdf1c4",
      },
    ],
    manifest:
      '{"display_name":"Alice","fragment_digests":[["description","sha256:dc84bebb9c54f4a0b53a58daf8d129af7beaeeb74a474c7ff201b2512fbdf1c4"]],"id":"cr_01h455vb4pex5vsknk084sn001","meta":{"default_locale":"en","license":"CC-BY-4.0","rating":"general","rights":"original"},"ref":"@djj/alice","type":"character"}',
    semantic_digest: "sha256:bd0198848adba914b694e013a9aa6c65d9a31995bd61fae9c92c986defc53f11",
  },
  {
    name: "a character with keyword lore, a locale variant, a pinned edge, an asset and a greeting",
    input: {
      id: "cr_01h455vb4pex5vsknk084sn002",
      ref: "@djj/alice",
      type: "character",
      display_name: { ja: "アリス", en: "Alice" },
      fragments: [
        {
          id: "description",
          stable: true,
          kind: "character",
          content: { type: "text", text: "{{self}} is a courier." },
          importance: "pinned",
        },
        {
          id: "lore/arasaka",
          stable: true,
          kind: "knowledge",
          content: { type: "text", text: "Arasaka runs the city." },
          activation: {
            mode: "keyword",
            keys: ["Arasaka"],
            logic: "any",
            case_sensitive: false,
            whole_word: false,
            secondary: [],
          },
          visibility: { scope: "shared" },
          placement_hint: "knowledge",
          locale: {
            ja: {
              content: { type: "text", text: "荒坂が街を支配している。", format: "markdown" },
              activation_keys: ["荒坂"],
            },
          },
        },
      ],
      references: [
        {
          id: "home",
          use: "@djj/night-city",
          pin: { release: "rel_01h455vb4pex5vsknk084sn002", semantic_digest: `sha256:${B64}` },
          mode: "intrinsic",
          bind: {},
          params: {},
          override: [],
        },
      ],
      assets: [
        {
          slot: "avatar",
          role: "presentation",
          variants: [
            {
              id: "default",
              media_type: "image/webp",
              blob: { digest: `sha256:${A64}`, size: 1024, availability: "mirrored" },
            },
          ],
        },
      ],
      bootstrap: { greetings: [{ id: "default", text: "Hi.", locale: {} }] },
      meta: {
        default_locale: "en",
        rating: "teen",
        rights: "original",
        license: "CC-BY-4.0",
        tags: ["cyberpunk", "courier"],
        content_warnings: [],
      },
      provenance: { au: false, authored_by_agent: false, derived_from: [] },
    },
    fragments: [
      {
        jcs: '{"content":{"text":"{{self}} is a courier.","type":"text"},"id":"description","importance":"pinned","kind":"character","stable":true}',
        digest: "sha256:10f9ab5749c856b53a5c3d4c0359eb995b0953f89263c570ed12e269e824391c",
      },
      {
        jcs: '{"activation":{"keys":["Arasaka"],"mode":"keyword"},"content":{"text":"Arasaka runs the city.","type":"text"},"id":"lore/arasaka","kind":"knowledge","locale":{"ja":{"activation_keys":["荒坂"],"content":{"text":"荒坂が街を支配している。","type":"text"}}},"stable":true}',
        digest: "sha256:dd9a59c9937b8f5d8cc8682a66e98f26195f170c92f60ae30abb8507f7a81984",
      },
    ],
    manifest: `{"assets":[{"role":"presentation","slot":"avatar","variants":[{"blob":{"availability":"mirrored","digest":"sha256:${A64}","size":1024},"id":"default","media_type":"image/webp"}]}],"bootstrap":{"greetings":[{"id":"default","text":"Hi."}]},"display_name":{"en":"Alice","ja":"アリス"},"fragment_digests":[["description","sha256:10f9ab5749c856b53a5c3d4c0359eb995b0953f89263c570ed12e269e824391c"],["lore/arasaka","sha256:dd9a59c9937b8f5d8cc8682a66e98f26195f170c92f60ae30abb8507f7a81984"]],"id":"cr_01h455vb4pex5vsknk084sn002","meta":{"default_locale":"en","license":"CC-BY-4.0","rating":"teen","rights":"original","tags":["cyberpunk","courier"]},"ref":"@djj/alice","references":[{"id":"home","mode":"intrinsic","pin":{"release":"rel_01h455vb4pex5vsknk084sn002","semantic_digest":"sha256:${B64}"},"use":"@djj/night-city"}],"type":"character"}`,
    semantic_digest: "sha256:7a5f7612dc0362472beba3334bd540f84da7363decfa375e8c069796812efe0a",
  },
];

describe("known-answer vectors", () => {
  describe.each(VECTORS)("$name", (v) => {
    it("the hand-written canonical bytes hash to the recorded digests", () => {
      for (const f of v.fragments) {
        expect(nobleDigest(f.jcs)).toBe(f.digest);
        expect(nodeDigest(f.jcs)).toBe(f.digest);
      }
      expect(nobleDigest(v.manifest)).toBe(v.semantic_digest);
      expect(nodeDigest(v.manifest)).toBe(v.semantic_digest);
    });

    it("the implementation produces the same fragment digests, manifest and semantic digest", () => {
      const r = canonicalizeCreation(v.input);
      expect(r.creation.fragments.map((f) => f.digest)).toEqual(v.fragments.map((f) => f.digest));
      expect(r.creation.fragments.map(({ digest: _d, ...body }) => jcs(body as never))).toEqual(
        v.fragments.map((f) => f.jcs),
      );
      expect(jcs(r.manifest)).toBe(v.manifest);
      expect(r.semantic_digest).toBe(v.semantic_digest);
    });
  });
});

// ---------------------------------------------------------------------------
// 默认值：写与不写得到同一个 digest
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: 测试里按路径改写任意书写形式的输入。
type Input = any;

function base(text: string): Input {
  return {
    id: "cr_01h455vb4pex5vsknk084sn003",
    ref: "@djj/alice",
    type: "character",
    display_name: "Alice",
    slots: { home: { accepts: "world" } },
    fragments: [
      { id: "description", stable: true, kind: "character", content: { type: "text", text } },
      {
        id: "lore/arasaka",
        stable: true,
        kind: "knowledge",
        content: { type: "text", text: "Arasaka" },
        activation: { mode: "keyword", keys: ["Arasaka"] },
        locale: { ja: { content: { type: "text", text: "荒坂" } } },
      },
    ],
    references: [
      { id: "home", use: "@djj/night-city", mode: "default" },
      {
        id: "lore",
        use: "@djj/night-city-lore",
        mode: "default",
        override: [
          { op: "replace", target: "lore/x", content: { type: "text", text: "y" } },
          { op: "remove", target: "lore/z" },
          { op: "patch", target: "lore/w", set: { activation: { mode: "keyword", keys: ["w"] } } },
          {
            op: "add",
            fragment: {
              id: "lore/extra",
              stable: true,
              kind: "knowledge",
              content: { type: "text", text: "extra" },
            },
          },
        ],
      },
    ],
    bootstrap: { greetings: [{ id: "default", text: "Hi." }] },
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
    provenance: { imported_from: { format: "ccv3", source_digest: `sha256:${A64}` } },
  };
}

/** 每一项在输入中显式写出一个默认值。 */
const DEFAULT_WRITERS: [string, (c: Input) => void][] = [
  ["text format markdown", (c) => (c.fragments[0].content.format = "markdown")],
  ["activation always", (c) => (c.fragments[0].activation = { mode: "always" })],
  ["visibility shared", (c) => (c.fragments[0].visibility = { scope: "shared" })],
  ["importance normal", (c) => (c.fragments[0].importance = "normal")],
  ["placement hint equal to kind", (c) => (c.fragments[0].placement_hint = "character")],
  ["empty locale map", (c) => (c.fragments[0].locale = {})],
  ["empty asset refs", (c) => (c.fragments[0].asset_refs = [])],
  ["keyword logic any", (c) => (c.fragments[1].activation.logic = "any")],
  ["keyword case_sensitive false", (c) => (c.fragments[1].activation.case_sensitive = false)],
  ["keyword whole_word false", (c) => (c.fragments[1].activation.whole_word = false)],
  ["empty secondary keys", (c) => (c.fragments[1].activation.secondary = [])],
  ["empty locale activation keys", (c) => (c.fragments[1].locale.ja.activation_keys = [])],
  ["locale text format markdown", (c) => (c.fragments[1].locale.ja.content.format = "markdown")],
  ["empty edge bind", (c) => (c.references[0].bind = {})],
  ["empty edge params", (c) => (c.references[0].params = {})],
  ["empty edge override list", (c) => (c.references[0].override = [])],
  ["replace override force false", (c) => (c.references[1].override[0].force = false)],
  [
    "replace override text format markdown",
    (c) => (c.references[1].override[0].content.format = "markdown"),
  ],
  ["remove override force false", (c) => (c.references[1].override[1].force = false)],
  [
    "patch override keyword logic any",
    (c) => (c.references[1].override[2].set.activation.logic = "any"),
  ],
  [
    "added fragment importance normal",
    (c) => (c.references[1].override[3].fragment.importance = "normal"),
  ],
  ["empty greeting locale", (c) => (c.bootstrap.greetings[0].locale = {})],
  ["slot required true", (c) => (c.slots.home.required = true)],
  ["empty tags", (c) => (c.meta.tags = [])],
  ["empty content warnings", (c) => (c.meta.content_warnings = [])],
  ["empty recommended presets", (c) => (c.meta.recommended_presets = [])],
  ["contribution policy signed-in", (c) => (c.meta.contribution_policy = "signed-in")],
  ["provenance au false", (c) => (c.provenance.au = false)],
  ["provenance authored_by_agent false", (c) => (c.provenance.authored_by_agent = false)],
  ["empty derived_from", (c) => (c.provenance.derived_from = [])],
  ["empty contributors", (c) => (c.provenance.contributors = [])],
  ["empty omitted policy fields", (c) => (c.provenance.imported_from.omitted_policy_fields = [])],
  ["empty authors", (c) => (c.authors = [])],
  ["empty params", (c) => (c.params = {})],
  ["empty assets", (c) => (c.assets = [])],
  ["empty cast", (c) => (c.cast = [])],
];

/** 与上面对应的非默认值：写出来必须改变 digest。 */
const NON_DEFAULT_WRITERS: [string, (c: Input) => void][] = [
  ["text format plain", (c) => (c.fragments[0].content.format = "plain")],
  ["activation manual", (c) => (c.fragments[0].activation = { mode: "manual" })],
  ["visibility scene", (c) => (c.fragments[0].visibility = { scope: "scene" })],
  ["importance pinned", (c) => (c.fragments[0].importance = "pinned")],
  ["placement hint differs from kind", (c) => (c.fragments[0].placement_hint = "instruction")],
  ["keyword logic all", (c) => (c.fragments[1].activation.logic = "all")],
  ["keyword case_sensitive true", (c) => (c.fragments[1].activation.case_sensitive = true)],
  ["keyword whole_word true", (c) => (c.fragments[1].activation.whole_word = true)],
  ["secondary keys", (c) => (c.fragments[1].activation.secondary = ["corp"])],
  ["replace override force true", (c) => (c.references[1].override[0].force = true)],
  ["remove override force true", (c) => (c.references[1].override[1].force = true)],
  ["slot required false", (c) => (c.slots.home.required = false)],
  ["tags", (c) => (c.meta.tags = ["cyberpunk"])],
  ["contribution policy anyone", (c) => (c.meta.contribution_policy = "anyone")],
  ["provenance au true", (c) => (c.provenance.au = true)],
  ["provenance authored_by_agent true", (c) => (c.provenance.authored_by_agent = true)],
];

function written(text: string, writers: readonly [string, (c: Input) => void][]): Input {
  const c = structuredClone(base(text));
  for (const [, write] of writers) write(c);
  return c;
}

describe("explicit defaults (property)", () => {
  const textArb = fc.string({ unit: "grapheme", minLength: 0, maxLength: 40 });

  it("writing any subset of defaults changes neither the digests nor the canonical form", () => {
    fc.assert(
      fc.property(textArb, fc.subarray(DEFAULT_WRITERS), (text, writers) => {
        const plain = canonicalizeCreation(base(text));
        const withDefaults = canonicalizeCreation(written(text, writers));
        expect(withDefaults.semantic_digest).toBe(plain.semantic_digest);
        expect(withDefaults.creation.fragments.map((f) => f.digest)).toEqual(
          plain.creation.fragments.map((f) => f.digest),
        );
        expect(withDefaults.json).toEqual(plain.json);
      }),
      { numRuns: 200 },
    );
  });

  it("writing every default at once is still the same creation", () => {
    const plain = canonicalizeCreation(base("x"));
    expect(canonicalizeCreation(written("x", DEFAULT_WRITERS)).semantic_digest).toBe(
      plain.semantic_digest,
    );
  });

  it.each(NON_DEFAULT_WRITERS)("writing %s changes the semantic digest", (_name, write) => {
    const plain = canonicalizeCreation(base("x"));
    expect(canonicalizeCreation(written("x", [["", write]])).semantic_digest).not.toBe(
      plain.semantic_digest,
    );
  });
});
