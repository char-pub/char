import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  canonicalFragment,
  canonicalizeCreation,
  digestJson,
  jcs,
  normalizeText,
  normalizeValue,
} from "../src/canonical.js";
import { isCharError } from "../src/errors.js";
import type { CreationInput } from "../src/schema/creation.js";
import { level0Character } from "./fixtures.js";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return isCharError(e) ? e.code : `non-char:${String(e)}`;
  }
  return undefined;
}

/** 随机打乱对象键序（递归），用于验证键序无关性。 */
function shuffleKeys(value: unknown, seed: number): unknown {
  if (Array.isArray(value)) return value.map((v, i) => shuffleKeys(v, seed + i + 1));
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    const rotated = entries.map((_, i) => entries[(i + seed) % entries.length]);
    const reversed = seed % 2 === 0 ? rotated.reverse() : rotated;
    return Object.fromEntries(
      reversed.flatMap((e, i) => (e ? [[e[0], shuffleKeys(e[1], seed * 31 + i)]] : [])),
    );
  }
  return value;
}

describe("normalizeText", () => {
  it("applies NFC", () => {
    expect(normalizeText("é")).toBe("é");
  });

  it("unifies line endings and strips trailing whitespace per line", () => {
    expect(normalizeText("a  \r\nb\t\rc \n")).toBe("a\nb\nc\n");
  });

  it("keeps leading indentation and inner spaces", () => {
    expect(normalizeText("  a  b")).toBe("  a  b");
  });
});

describe("normalizeValue", () => {
  it("drops undefined keys and turns -0 into 0", () => {
    expect(normalizeValue({ a: undefined, b: -0 })).toEqual({ b: 0 });
  });

  it("rejects non-finite numbers, undefined array items and non-plain objects", () => {
    expect(codeOf(() => normalizeValue({ a: Number.NaN }))).toBe("canonical.invalid_number");
    expect(codeOf(() => normalizeValue([undefined]))).toBe("canonical.undefined_in_array");
    expect(codeOf(() => normalizeValue({ d: new Map() }))).toBe("canonical.not_plain_object");
    expect(codeOf(() => normalizeValue({ f: () => 1 }))).toBe("canonical.unsupported_value");
  });

  it("rejects keys that collide after NFC", () => {
    expect(codeOf(() => normalizeValue({ é: 1, é: 2 }))).toBe("canonical.duplicate_key");
  });
});

describe("jcs / digest", () => {
  it("sorts keys and has no whitespace", () => {
    expect(jcs({ b: 1, a: [true, null, "x"] })).toBe('{"a":[true,null,"x"],"b":1}');
  });

  it("matches a known sha256 of the empty object", () => {
    // sha256("{}")
    expect(digestJson({})).toBe(
      "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    );
  });
});

describe("fragment digest", () => {
  const base = {
    id: "description",
    stable: true,
    kind: "character" as const,
    content: { type: "text" as const, text: "hello" },
  };

  it("ignores explicitly written defaults", () => {
    const explicit = canonicalFragment({
      ...base,
      content: { type: "text", text: "hello", format: "markdown" },
      activation: { mode: "always" },
      visibility: { scope: "shared" },
      importance: "normal",
      placement_hint: "character",
      asset_refs: [],
      locale: {},
    });
    expect(explicit.digest).toBe(canonicalFragment(base).digest);
    expect(explicit).toEqual(canonicalFragment(base));
  });

  it("strips keyword activation defaults", () => {
    const a = canonicalFragment({ ...base, activation: { mode: "keyword", keys: ["x"] } });
    const b = canonicalFragment({
      ...base,
      activation: {
        mode: "keyword",
        keys: ["x"],
        logic: "any",
        case_sensitive: false,
        whole_word: false,
        secondary: [],
      },
    });
    expect(a.digest).toBe(b.digest);
  });

  it("changes when content, activation or a locale variant changes", () => {
    const d0 = canonicalFragment(base).digest;
    expect(
      canonicalFragment({ ...base, content: { type: "text", text: "hello!" } }).digest,
    ).not.toBe(d0);
    expect(canonicalFragment({ ...base, activation: { mode: "manual" } }).digest).not.toBe(d0);
    expect(
      canonicalFragment({
        ...base,
        locale: { ja: { content: { type: "text", text: "こんにちは" } } },
      }).digest,
    ).not.toBe(d0);
    expect(
      canonicalFragment({ ...base, content: { type: "text", text: "hello", format: "plain" } })
        .digest,
    ).not.toBe(d0);
  });

  it("rejects a declared digest that does not match", () => {
    expect(codeOf(() => canonicalFragment({ ...base, digest: `sha256:${"0".repeat(64)}` }))).toBe(
      "canonical.fragment_digest_mismatch",
    );
  });

  it("accepts a declared digest that matches", () => {
    const { digest } = canonicalFragment(base);
    expect(canonicalFragment({ ...base, digest }).digest).toBe(digest);
  });
});

describe("canonicalizeCreation", () => {
  it("accepts a Level 0 character and returns stable digests", () => {
    const r = canonicalizeCreation(level0Character());
    expect(r.semantic_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(r.creation.fragments[0]?.digest).toMatch(/^sha256:/);
    expect((r.json as Record<string, unknown>).provenance).toBeUndefined();
    expect((r.manifest as Record<string, unknown>).fragments).toBeUndefined();
    expect((r.manifest as Record<string, unknown>).fragment_digests).toEqual([
      ["description", r.creation.fragments[0]?.digest],
    ]);
  });

  it("is idempotent: canonical json canonicalizes to itself", () => {
    const r1 = canonicalizeCreation(level0Character());
    const r2 = canonicalizeCreation(r1.json);
    expect(r2.json).toEqual(r1.json);
    expect(r2.semantic_digest).toBe(r1.semantic_digest);
  });

  it("ignores defaults at creation level", () => {
    const a = canonicalizeCreation(level0Character());
    const b = canonicalizeCreation(
      level0Character({
        references: [],
        provenance: { au: false, authored_by_agent: false, contributors: [] },
        meta: {
          default_locale: "en",
          rating: "general",
          rights: "original",
          license: "CC-BY-4.0",
          contribution_policy: "signed-in",
          tags: [],
        },
      }),
    );
    expect(b.semantic_digest).toBe(a.semantic_digest);
  });

  it("semantic digest depends on fragment order", () => {
    const f = (id: string) => ({
      id,
      stable: true,
      kind: "character" as const,
      content: { type: "text" as const, text: id },
    });
    const a = canonicalizeCreation(level0Character({ fragments: [f("a"), f("b")] }));
    const b = canonicalizeCreation(level0Character({ fragments: [f("b"), f("a")] }));
    expect(a.semantic_digest).not.toBe(b.semantic_digest);
  });

  it("semantic digest changes with fragment content", () => {
    const a = canonicalizeCreation(level0Character());
    const c = level0Character();
    const frag = c.fragments?.[0];
    if (!frag) throw new Error("fixture");
    const b = canonicalizeCreation({
      ...c,
      fragments: [{ ...frag, content: { type: "text", text: "other" } }],
    });
    expect(b.semantic_digest).not.toBe(a.semantic_digest);
  });

  it("rejects unknown fields and invalid identifiers", () => {
    expect(codeOf(() => canonicalizeCreation({ ...level0Character(), extra: 1 }))).toBe(
      "schema.invalid",
    );
    expect(codeOf(() => canonicalizeCreation(level0Character({ ref: "@DJJ/alice" })))).toBe(
      "schema.invalid",
    );
  });

  it("rejects duplicate fragment ids", () => {
    const c = level0Character();
    const frag = c.fragments?.[0];
    if (!frag) throw new Error("fixture");
    expect(codeOf(() => canonicalizeCreation({ ...c, fragments: [frag, frag] }))).toBe(
      "canonical.duplicate_fragment",
    );
  });

  it("rejects integers outside the safe range", () => {
    expect(
      codeOf(() =>
        canonicalizeCreation(
          level0Character({
            params: { n: { type: "number", default: 2 ** 60 } },
          }),
        ),
      ),
    ).toBe("schema.invalid");
  });

  it("rejects asset slots without a default variant", () => {
    const c = level0Character();
    expect(
      codeOf(() =>
        canonicalizeCreation({
          ...c,
          assets: [
            {
              slot: "avatar",
              role: "presentation",
              variants: [
                {
                  id: "happy",
                  media_type: "image/webp",
                  blob: { digest: `sha256:${"b".repeat(64)}`, size: 1, availability: "mirrored" },
                },
              ],
            },
          ],
        }),
      ),
    ).toBe("schema.invalid");
  });
});

describe("format independence (property)", () => {
  const textArb = fc.string({ unit: "grapheme", maxLength: 40 });

  it("key order does not change the semantic digest", () => {
    fc.assert(
      fc.property(fc.nat(1000), textArb, (seed, text) => {
        const c: CreationInput = level0Character({
          fragments: [
            {
              id: "description",
              stable: true,
              kind: "character",
              content: { type: "text", text },
              activation: { mode: "keyword", keys: ["k"], scan_depth: 3 },
            },
          ],
        });
        const a = canonicalizeCreation(c);
        const b = canonicalizeCreation(shuffleKeys(c, seed));
        expect(b.semantic_digest).toBe(a.semantic_digest);
        expect(jcs(b.json)).toBe(jcs(a.json));
      }),
    );
  });

  it("CRLF, trailing spaces and NFD vs NFC do not change the digest", () => {
    fc.assert(
      fc.property(fc.array(textArb, { minLength: 1, maxLength: 5 }), (lines) => {
        const clean = lines.map((l) =>
          l
            .normalize("NFC")
            .replace(/[ \t\r\n]+$/g, "")
            .replace(/[\r\n]/g, ""),
        );
        const plain = clean.join("\n");
        const messy = clean.map((l) => `${l.normalize("NFD")}  \t`).join("\r\n");
        const mk = (text: string) =>
          canonicalizeCreation(
            level0Character({
              fragments: [
                {
                  id: "description",
                  stable: true,
                  kind: "character",
                  content: { type: "text", text },
                },
              ],
            }),
          ).semantic_digest;
        expect(mk(messy)).toBe(mk(plain));
      }),
    );
  });

  it("JSON pretty-printing does not change the digest", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 8 }), (indent) => {
        const c = level0Character();
        const reparsed = JSON.parse(JSON.stringify(c, null, indent));
        expect(canonicalizeCreation(reparsed).semantic_digest).toBe(
          canonicalizeCreation(c).semantic_digest,
        );
      }),
    );
  });
});
