import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type CanonicalCreation,
  canonicalAssetSlot,
  canonicalAssetVariant,
  canonicalEdge,
  canonicalFragment,
  canonicalizeCreation,
  digestOf,
} from "../src/canonical.js";
import { isCharError } from "../src/errors.js";
import {
  assertRightsAck,
  assertSensitiveConfirmed,
  changeKey,
  computeSensitive,
  type MergeState,
  mergeContribution,
} from "../src/merge.js";
import type {
  AssetSlot,
  AssetVariant,
  CreationInput,
  Fragment,
  ReferenceEdge,
} from "../src/schema/creation.js";
import type { Change } from "../src/schema/release.js";
import { D, level0Character } from "./fixtures.js";

// ---------------------------------------------------------------------------
// 测试数据
// ---------------------------------------------------------------------------

const frag = (id: string, text: string): Fragment => ({
  id,
  stable: true,
  kind: "character",
  content: { type: "text", text },
});

const edge = (id: string, use: string): ReferenceEdge => ({ id, use, mode: "default" });

const variant = (id: string, c: string): AssetVariant => ({
  id,
  media_type: "image/webp",
  blob: { digest: D(c), size: 10, availability: "mirrored" },
});

const slot = (name: string, variants: AssetVariant[]): AssetSlot => ({
  slot: name,
  role: "presentation",
  variants,
});

/** 基线草稿：两个 fragment、一个 edge、一个 avatar slot，tags 为空。 */
function baseDraft(): CreationInput {
  return level0Character({
    summary: "A courier.",
    fragments: [frag("a", "A0"), frag("b", "B0")],
    references: [edge("world", "@cyberpunk/night-city")],
    assets: [slot("avatar", [variant("default", "1")])],
  });
}

function draftWith(patch: (c: CreationInput) => void): CreationInput {
  const c = baseDraft();
  patch(c);
  return c;
}

const fd = (f: Fragment) => canonicalFragment(f).digest;
const ed = (e: ReferenceEdge) => digestOf(canonicalEdge(e));
const sd = (s: AssetSlot) => digestOf(canonicalAssetSlot(s));
const vd = (v: AssetVariant) => digestOf(canonicalAssetVariant(v));
const md = (v: unknown) => digestOf(v);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return isCharError(e) ? e.code : `non-char:${String(e)}`;
  }
  return undefined;
}

function stateOf(target: CreationInput, change: Change): MergeState {
  const r = mergeContribution(target, [change]);
  const o = r.outcomes[0];
  if (!o) throw new Error("no outcome");
  return o.state;
}

// ---------------------------------------------------------------------------
// 三方比较：每个分支
// ---------------------------------------------------------------------------

type Row = [name: string, target: () => CreationInput, change: Change, expected: MergeState];

const A0 = frag("a", "A0");
const A1 = frag("a", "A1");
const A2 = frag("a", "A2");
const C1 = frag("c", "C1");
const W0 = edge("world", "@cyberpunk/night-city");
const W1: ReferenceEdge = { ...W0, mode: "intrinsic" };
const W2: ReferenceEdge = { ...W0, rel: "lives_in" };
const X1 = edge("extra", "@commons/rain");
const AV0 = slot("avatar", [variant("default", "1")]);
const AV1 = slot("avatar", [variant("default", "2")]);
const AV2 = slot("avatar", [variant("default", "3")]);
const COVER = slot("cover", [variant("default", "4")]);
const V_DEF0 = variant("default", "1");
const V_DEF1 = variant("default", "2");
const V_HAPPY = variant("happy", "5");

const rows: Row[] = [
  // fragment
  [
    "fragment add → applied",
    baseDraft,
    { on: "fragment", op: "add", id: "c", after: C1 },
    "applied",
  ],
  [
    "fragment add, already present with same value → already_applied",
    () => draftWith((c) => c.fragments?.push(C1)),
    { on: "fragment", op: "add", id: "c", after: C1 },
    "already_applied",
  ],
  [
    "fragment add, present with other value → conflict",
    () => draftWith((c) => c.fragments?.push(frag("c", "other"))),
    { on: "fragment", op: "add", id: "c", after: C1 },
    "conflict",
  ],
  [
    "fragment modify, current = base → applied",
    baseDraft,
    { on: "fragment", op: "modify", id: "a", base_digest: fd(A0), after: A1 },
    "applied",
  ],
  [
    "fragment modify, current = after → already_applied",
    () => draftWith((c) => c.fragments?.splice(0, 1, A1)),
    { on: "fragment", op: "modify", id: "a", base_digest: fd(A0), after: A1 },
    "already_applied",
  ],
  [
    "fragment modify, author changed it too → conflict",
    () => draftWith((c) => c.fragments?.splice(0, 1, A2)),
    { on: "fragment", op: "modify", id: "a", base_digest: fd(A0), after: A1 },
    "conflict",
  ],
  [
    "fragment modify, author removed it → conflict",
    () => draftWith((c) => c.fragments?.splice(0, 1)),
    { on: "fragment", op: "modify", id: "a", base_digest: fd(A0), after: A1 },
    "conflict",
  ],
  [
    "fragment remove, current = base → applied",
    baseDraft,
    { on: "fragment", op: "remove", id: "a", base_digest: fd(A0) },
    "applied",
  ],
  [
    "fragment remove, already removed → already_applied",
    () => draftWith((c) => c.fragments?.splice(0, 1)),
    { on: "fragment", op: "remove", id: "a", base_digest: fd(A0) },
    "already_applied",
  ],
  [
    "fragment remove, author changed it → conflict",
    () => draftWith((c) => c.fragments?.splice(0, 1, A2)),
    { on: "fragment", op: "remove", id: "a", base_digest: fd(A0) },
    "conflict",
  ],
  // edge
  ["edge add → applied", baseDraft, { on: "edge", op: "add", id: "extra", after: X1 }, "applied"],
  [
    "edge add, already present → already_applied",
    () => draftWith((c) => c.references?.push(X1)),
    { on: "edge", op: "add", id: "extra", after: X1 },
    "already_applied",
  ],
  [
    "edge modify, current = base → applied",
    baseDraft,
    { on: "edge", op: "modify", id: "world", base_digest: ed(W0), after: W1 },
    "applied",
  ],
  [
    "edge modify, author changed it too → conflict",
    () => draftWith((c) => c.references?.splice(0, 1, W2)),
    { on: "edge", op: "modify", id: "world", base_digest: ed(W0), after: W1 },
    "conflict",
  ],
  [
    "edge remove, current = base → applied",
    baseDraft,
    { on: "edge", op: "remove", id: "world", base_digest: ed(W0) },
    "applied",
  ],
  [
    "edge remove, already removed → already_applied",
    () => draftWith((c) => c.references?.splice(0, 1)),
    { on: "edge", op: "remove", id: "world", base_digest: ed(W0) },
    "already_applied",
  ],
  // asset slot
  [
    "asset slot add → applied",
    baseDraft,
    { on: "asset", op: "add", slot: "cover", after: COVER },
    "applied",
  ],
  [
    "asset slot modify, current = base → applied",
    baseDraft,
    { on: "asset", op: "modify", slot: "avatar", base_digest: sd(AV0), after: AV1 },
    "applied",
  ],
  [
    "asset slot modify, author changed it too → conflict",
    () => draftWith((c) => c.assets?.splice(0, 1, AV2)),
    { on: "asset", op: "modify", slot: "avatar", base_digest: sd(AV0), after: AV1 },
    "conflict",
  ],
  [
    "asset slot remove, current = base → applied",
    baseDraft,
    { on: "asset", op: "remove", slot: "avatar", base_digest: sd(AV0) },
    "applied",
  ],
  // asset variant
  [
    "asset variant add → applied",
    baseDraft,
    { on: "asset", op: "add", slot: "avatar", variant: "happy", after: V_HAPPY },
    "applied",
  ],
  [
    "asset variant add, already present → already_applied",
    () => draftWith((c) => c.assets?.[0]?.variants.push(V_HAPPY)),
    { on: "asset", op: "add", slot: "avatar", variant: "happy", after: V_HAPPY },
    "already_applied",
  ],
  [
    "asset variant add, slot missing → conflict",
    baseDraft,
    { on: "asset", op: "add", slot: "cover", variant: "happy", after: V_HAPPY },
    "conflict",
  ],
  [
    "asset variant modify, current = base → applied",
    baseDraft,
    {
      on: "asset",
      op: "modify",
      slot: "avatar",
      variant: "default",
      base_digest: vd(V_DEF0),
      after: V_DEF1,
    },
    "applied",
  ],
  [
    "asset variant remove, already removed → already_applied",
    baseDraft,
    { on: "asset", op: "remove", slot: "avatar", variant: "happy", base_digest: vd(V_HAPPY) },
    "already_applied",
  ],
  // metadata
  [
    "metadata set on absent field → applied",
    baseDraft,
    { on: "metadata", field: "meta.tags", op: "set", after: ["noir"], sensitive: false },
    "applied",
  ],
  [
    "metadata set on absent field, same value present → already_applied",
    () => draftWith((c) => Object.assign(c.meta, { tags: ["noir"] })),
    { on: "metadata", field: "meta.tags", op: "set", after: ["noir"], sensitive: false },
    "already_applied",
  ],
  [
    "metadata set on absent field, other value present → conflict",
    () => draftWith((c) => Object.assign(c.meta, { tags: ["cozy"] })),
    { on: "metadata", field: "meta.tags", op: "set", after: ["noir"], sensitive: false },
    "conflict",
  ],
  [
    "metadata set with base, current = base → applied",
    baseDraft,
    {
      on: "metadata",
      field: "meta.rating",
      op: "set",
      base_digest: md("general"),
      after: "teen",
      sensitive: true,
    },
    "applied",
  ],
  [
    "metadata set with base, current = after → already_applied",
    () => draftWith((c) => Object.assign(c.meta, { rating: "teen" })),
    {
      on: "metadata",
      field: "meta.rating",
      op: "set",
      base_digest: md("general"),
      after: "teen",
      sensitive: true,
    },
    "already_applied",
  ],
  [
    "metadata set with base, author changed it → conflict",
    () => draftWith((c) => Object.assign(c.meta, { rating: "mature" })),
    {
      on: "metadata",
      field: "meta.rating",
      op: "set",
      base_digest: md("general"),
      after: "teen",
      sensitive: true,
    },
    "conflict",
  ],
  [
    "metadata unset, current = base → applied",
    baseDraft,
    {
      on: "metadata",
      field: "summary",
      op: "unset",
      base_digest: md("A courier."),
      sensitive: false,
    },
    "applied",
  ],
  [
    "metadata unset, already absent → already_applied",
    () => draftWith((c) => delete c.summary),
    {
      on: "metadata",
      field: "summary",
      op: "unset",
      base_digest: md("A courier."),
      sensitive: false,
    },
    "already_applied",
  ],
  [
    "metadata unset, author changed it → conflict",
    () => draftWith((c) => Object.assign(c, { summary: "A hacker." })),
    {
      on: "metadata",
      field: "summary",
      op: "unset",
      base_digest: md("A courier."),
      sensitive: false,
    },
    "conflict",
  ],
  [
    "metadata: contribution_policy default counts as absent",
    () => draftWith((c) => Object.assign(c.meta, { contribution_policy: "signed-in" })),
    {
      on: "metadata",
      field: "meta.contribution_policy",
      op: "set",
      after: "closed",
      sensitive: false,
    },
    "applied",
  ],
];

describe("three-way decision", () => {
  it.each(rows)("%s", (_name, target, change, expected) => {
    expect(stateOf(target(), change)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// 应用结果
// ---------------------------------------------------------------------------

function merged(target: CreationInput, changes: Change[]): CanonicalCreation {
  const r = mergeContribution(target, changes);
  if (!r.result) throw new Error(`unexpected conflicts: ${JSON.stringify(r.conflicts)}`);
  return r.result.creation;
}

describe("applying changes", () => {
  it("appends added fragments, replaces modified ones in place, drops removed ones", () => {
    const out = merged(baseDraft(), [
      { on: "fragment", op: "add", id: "c", after: C1 },
      { on: "fragment", op: "modify", id: "a", base_digest: fd(A0), after: A1 },
      { on: "fragment", op: "remove", id: "b", base_digest: fd(frag("b", "B0")) },
    ]);
    expect(out.fragments.map((f) => [f.id, f.content])).toEqual([
      ["a", { type: "text", text: "A1" }],
      ["c", { type: "text", text: "C1" }],
    ]);
    expect(out.fragments[0]?.digest).toBe(fd(A1));
  });

  it("applies edge and asset changes", () => {
    const out = merged(baseDraft(), [
      { on: "edge", op: "modify", id: "world", base_digest: ed(W0), after: W1 },
      { on: "edge", op: "add", id: "extra", after: X1 },
      { on: "asset", op: "add", slot: "avatar", variant: "happy", after: V_HAPPY },
      { on: "asset", op: "add", slot: "cover", after: COVER },
    ]);
    expect(out.references.map((e) => [e.id, e.mode])).toEqual([
      ["world", "intrinsic"],
      ["extra", "default"],
    ]);
    expect(out.assets.map((s) => [s.slot, s.variants.map((v) => v.id)])).toEqual([
      ["avatar", ["default", "happy"]],
      ["cover", ["default"]],
    ]);
  });

  it("removes a single variant and a whole slot", () => {
    const withHappy = draftWith((c) => c.assets?.[0]?.variants.push(V_HAPPY));
    const out = merged(withHappy, [
      { on: "asset", op: "remove", slot: "avatar", variant: "happy", base_digest: vd(V_HAPPY) },
    ]);
    expect(out.assets[0]?.variants.map((v) => v.id)).toEqual(["default"]);
    const out2 = merged(baseDraft(), [
      { on: "asset", op: "remove", slot: "avatar", base_digest: sd(AV0) },
    ]);
    expect(out2.assets).toEqual([]);
  });

  it("writes top-level and meta fields", () => {
    const out = merged(baseDraft(), [
      {
        on: "metadata",
        field: "display_name",
        op: "set",
        base_digest: md("Alice"),
        after: { en: "Alice", ja: "アリス" },
        sensitive: false,
      },
      {
        on: "metadata",
        field: "summary",
        op: "unset",
        base_digest: md("A courier."),
        sensitive: false,
      },
      { on: "metadata", field: "meta.tags", op: "set", after: ["noir"], sensitive: false },
      {
        on: "metadata",
        field: "meta.license",
        op: "set",
        base_digest: md("CC-BY-4.0"),
        after: "CC0-1.0",
        sensitive: true,
      },
    ]);
    expect(out.display_name).toEqual({ en: "Alice", ja: "アリス" });
    expect(out.summary).toBeUndefined();
    expect(out.meta.tags).toEqual(["noir"]);
    expect(out.meta.license).toBe("CC0-1.0");
  });

  it("unsets optional meta fields", () => {
    const target = draftWith((c) => Object.assign(c.meta, { tags: ["noir"] }));
    const out = merged(target, [
      {
        on: "metadata",
        field: "meta.tags",
        op: "unset",
        base_digest: md(["noir"]),
        sensitive: false,
      },
    ]);
    expect(out.meta.tags).toBeUndefined();
  });

  it("returns null result and lists conflicts when anything conflicts", () => {
    const target = draftWith((c) => c.fragments?.splice(0, 1, A2));
    const r = mergeContribution(target, [
      { on: "fragment", op: "add", id: "c", after: C1 },
      { on: "fragment", op: "modify", id: "a", base_digest: fd(A0), after: A1 },
    ]);
    expect(r.result).toBeNull();
    expect(r.conflicts).toEqual([
      expect.objectContaining({
        key: "fragment:a",
        state: "conflict",
        reason: "diverged",
        base_digest: fd(A0),
        current_digest: fd(A2),
        after_digest: fd(A1),
      }),
    ]);
    expect(r.outcomes[0]?.state).toBe("applied");
  });

  it("reports slot_missing when adding a variant to an absent slot", () => {
    const r = mergeContribution(baseDraft(), [
      { on: "asset", op: "add", slot: "cover", variant: "happy", after: V_HAPPY },
    ]);
    expect(r.conflicts[0]?.reason).toBe("slot_missing");
  });

  it("accepts an already-canonical creation as target", () => {
    const canon = canonicalizeCreation(baseDraft()).creation;
    const out = merged(canon, [{ on: "fragment", op: "add", id: "c", after: C1 }]);
    expect(out.fragments.map((f) => f.id)).toEqual(["a", "b", "c"]);
  });

  it("rejects a merge whose result is not a valid creation", () => {
    expect(
      codeOf(() =>
        mergeContribution(baseDraft(), [
          {
            on: "asset",
            op: "remove",
            slot: "avatar",
            variant: "default",
            base_digest: vd(V_DEF0),
          },
        ]),
      ),
    ).toBe("contribution.invalid_result");
  });
});

// ---------------------------------------------------------------------------
// 形状校验
// ---------------------------------------------------------------------------

const invalidShapes: [string, Change | Record<string, unknown>, string][] = [
  [
    "add with base_digest",
    { on: "fragment", op: "add", id: "c", base_digest: D("0"), after: C1 },
    "contribution.invalid_change",
  ],
  ["add without after", { on: "fragment", op: "add", id: "c" }, "contribution.invalid_change"],
  [
    "modify without base",
    { on: "fragment", op: "modify", id: "a", after: A1 },
    "contribution.invalid_change",
  ],
  [
    "modify without after",
    { on: "fragment", op: "modify", id: "a", base_digest: fd(A0) },
    "contribution.invalid_change",
  ],
  ["remove without base", { on: "fragment", op: "remove", id: "a" }, "contribution.invalid_change"],
  [
    "remove with after",
    { on: "fragment", op: "remove", id: "a", base_digest: fd(A0), after: A1 },
    "contribution.invalid_change",
  ],
  [
    "set without after",
    { on: "metadata", field: "meta.tags", op: "set", sensitive: false },
    "contribution.invalid_change",
  ],
  [
    "unset without base",
    { on: "metadata", field: "summary", op: "unset", sensitive: false },
    "contribution.invalid_change",
  ],
  [
    "unset with after",
    {
      on: "metadata",
      field: "summary",
      op: "unset",
      base_digest: md("A courier."),
      after: "x",
      sensitive: false,
    },
    "contribution.invalid_change",
  ],
  [
    "unset a required field",
    {
      on: "metadata",
      field: "meta.license",
      op: "unset",
      base_digest: md("CC-BY-4.0"),
      sensitive: true,
    },
    "contribution.required_field",
  ],
  [
    "fragment after.id differs",
    { on: "fragment", op: "add", id: "c", after: frag("d", "x") },
    "contribution.invalid_change",
  ],
  [
    "edge after.id differs",
    { on: "edge", op: "add", id: "other", after: X1 },
    "contribution.invalid_change",
  ],
  [
    "slot change with a different slot",
    { on: "asset", op: "add", slot: "banner", after: COVER },
    "contribution.invalid_change",
  ],
  [
    "slot change carrying a variant",
    { on: "asset", op: "add", slot: "cover", after: V_HAPPY },
    "contribution.invalid_change",
  ],
  [
    "variant change carrying a slot",
    { on: "asset", op: "add", slot: "avatar", variant: "happy", after: COVER },
    "contribution.invalid_change",
  ],
  [
    "variant change with a different variant id",
    { on: "asset", op: "add", slot: "avatar", variant: "sad", after: V_HAPPY },
    "contribution.invalid_change",
  ],
  [
    "invalid metadata value",
    {
      on: "metadata",
      field: "meta.rating",
      op: "set",
      base_digest: md("general"),
      after: "spicy",
      sensitive: true,
    },
    "contribution.invalid_change",
  ],
  [
    "set to the default value",
    {
      on: "metadata",
      field: "meta.contribution_policy",
      op: "set",
      after: "signed-in",
      sensitive: false,
    },
    "contribution.invalid_change",
  ],
  [
    "set to an empty list",
    { on: "metadata", field: "meta.tags", op: "set", after: [], sensitive: false },
    "contribution.invalid_change",
  ],
  [
    "after equals base",
    { on: "fragment", op: "modify", id: "a", base_digest: fd(A0), after: A0 },
    "contribution.noop_change",
  ],
  [
    "unknown field",
    { on: "metadata", field: "meta.secret", op: "set", after: 1, sensitive: false },
    "contribution.invalid_change",
  ],
  ["not an object", { nope: true }, "contribution.invalid_change"],
];

describe("change shape", () => {
  it.each(invalidShapes)("rejects %s", (_name, change, code) => {
    expect(codeOf(() => mergeContribution(baseDraft(), [change]))).toBe(code);
  });

  it("rejects two changes with the same key", () => {
    expect(
      codeOf(() =>
        mergeContribution(baseDraft(), [
          { on: "fragment", op: "modify", id: "a", base_digest: fd(A0), after: A1 },
          { on: "fragment", op: "remove", id: "a", base_digest: fd(A0) },
        ]),
      ),
    ).toBe("contribution.duplicate_key");
  });

  it("rejects a whole-slot change together with a variant change of the same slot", () => {
    for (const order of [0, 1]) {
      const changes: Change[] = [
        { on: "asset", op: "modify", slot: "avatar", base_digest: sd(AV0), after: AV1 },
        { on: "asset", op: "add", slot: "avatar", variant: "happy", after: V_HAPPY },
      ];
      if (order) changes.reverse();
      expect(codeOf(() => mergeContribution(baseDraft(), changes))).toBe(
        "contribution.overlapping_asset_change",
      );
    }
  });

  it("allows variant changes of different slots and different variants of one slot", () => {
    const withCover = draftWith((c) => c.assets?.push(COVER));
    const r = mergeContribution(withCover, [
      { on: "asset", op: "add", slot: "avatar", variant: "happy", after: V_HAPPY },
      {
        on: "asset",
        op: "modify",
        slot: "avatar",
        variant: "default",
        base_digest: vd(V_DEF0),
        after: V_DEF1,
      },
      { on: "asset", op: "add", slot: "cover", variant: "happy", after: V_HAPPY },
    ]);
    expect(r.conflicts).toEqual([]);
    expect(r.result).not.toBeNull();
  });
});

describe("change keys", () => {
  it("derives stable comparison keys", () => {
    expect(changeKey({ on: "fragment", op: "add", id: "lore/x", after: frag("lore/x", "") })).toBe(
      "fragment:lore/x",
    );
    expect(changeKey({ on: "edge", op: "add", id: "w", after: edge("w", "@a/b") })).toBe("edge:w");
    expect(changeKey({ on: "asset", op: "add", slot: "avatar", after: AV0 })).toBe("asset:avatar");
    expect(
      changeKey({ on: "asset", op: "add", slot: "avatar", variant: "x", after: V_HAPPY }),
    ).toBe("asset:avatar/x");
    expect(
      changeKey({
        on: "metadata",
        field: "meta.rating",
        op: "set",
        after: "teen",
        sensitive: true,
      }),
    ).toBe("metadata:meta.rating");
  });
});

// ---------------------------------------------------------------------------
// 敏感变更与授权
// ---------------------------------------------------------------------------

describe("sensitive changes", () => {
  it("is computed by the server regardless of what the client claims", () => {
    const r = mergeContribution(baseDraft(), [
      {
        on: "metadata",
        field: "meta.rating",
        op: "set",
        base_digest: md("general"),
        after: "mature",
        sensitive: false,
      },
      { on: "metadata", field: "meta.tags", op: "set", after: ["noir"], sensitive: true },
    ]);
    expect(r.changes.map((c) => c.on === "metadata" && c.sensitive)).toEqual([true, false]);
    expect(r.sensitive_keys).toEqual(["metadata:meta.rating"]);
    expect(r.outcomes.map((o) => o.sensitive)).toEqual([true, false]);
  });

  it.each([
    ["meta.rating", true],
    ["meta.license", true],
    ["meta.content_warnings", true],
    ["meta.tags", false],
    ["display_name", false],
  ] as const)("metadata %s → %s", (field, expected) => {
    expect(
      computeSensitive({ on: "metadata", field, op: "set", after: "x", sensitive: !expected }),
    ).toBe(expected);
  });

  it("marks asset changes that declare their own license or rating", () => {
    const licensed: AssetVariant = { ...V_HAPPY, license: "CC-BY-NC-4.0" };
    const rated: AssetVariant = { ...V_HAPPY, rating: "mature" };
    expect(
      computeSensitive({
        on: "asset",
        op: "add",
        slot: "avatar",
        variant: "happy",
        after: licensed,
      }),
    ).toBe(true);
    expect(
      computeSensitive({
        on: "asset",
        op: "add",
        slot: "cover",
        after: slot("cover", [variant("default", "4"), rated]),
      }),
    ).toBe(true);
    expect(
      computeSensitive({
        on: "asset",
        op: "add",
        slot: "avatar",
        variant: "happy",
        after: V_HAPPY,
      }),
    ).toBe(false);
    expect(
      computeSensitive({ on: "asset", op: "remove", slot: "avatar", base_digest: sd(AV0) }),
    ).toBe(false);
    expect(computeSensitive({ on: "fragment", op: "add", id: "c", after: C1 })).toBe(false);
  });

  it("requires each applied sensitive change to be confirmed individually", () => {
    const r = mergeContribution(baseDraft(), [
      {
        on: "metadata",
        field: "meta.rating",
        op: "set",
        base_digest: md("general"),
        after: "mature",
        sensitive: true,
      },
      {
        on: "metadata",
        field: "meta.license",
        op: "set",
        base_digest: md("CC-BY-4.0"),
        after: "CC0-1.0",
        sensitive: true,
      },
      { on: "fragment", op: "add", id: "c", after: C1 },
    ]);
    expect(codeOf(() => assertSensitiveConfirmed(r, []))).toBe(
      "contribution.sensitive_unconfirmed",
    );
    expect(codeOf(() => assertSensitiveConfirmed(r, ["metadata:meta.rating"]))).toBe(
      "contribution.sensitive_unconfirmed",
    );
    expect(() =>
      assertSensitiveConfirmed(r, ["metadata:meta.rating", "metadata:meta.license"]),
    ).not.toThrow();
  });

  it("does not ask to confirm sensitive changes that are already applied", () => {
    const target = draftWith((c) => Object.assign(c.meta, { rating: "mature" }));
    const r = mergeContribution(target, [
      {
        on: "metadata",
        field: "meta.rating",
        op: "set",
        base_digest: md("general"),
        after: "mature",
        sensitive: true,
      },
    ]);
    expect(() => assertSensitiveConfirmed(r, [])).not.toThrow();
  });
});

describe("rights acknowledgement", () => {
  it("accepts inbound = outbound for standard licenses", () => {
    expect(() => assertRightsAck("CC-BY-4.0", { inbound_equals_outbound: true })).not.toThrow();
    expect(() => assertRightsAck("MIT OR Apache-2.0", { explicit_grant: true })).not.toThrow();
  });

  it("requires an explicit grant for custom or all-rights-reserved licenses", () => {
    for (const lic of [
      "LicenseRef-All-Rights-Reserved",
      "CC-BY-4.0 OR LicenseRef-Custom",
      "(LicenseRef-X)",
    ]) {
      expect(codeOf(() => assertRightsAck(lic, { inbound_equals_outbound: true }))).toBe(
        "contribution.rights_ack_required",
      );
      expect(() => assertRightsAck(lic, { explicit_grant: true })).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// 用户场景：贡献者与作者同时修改
// ---------------------------------------------------------------------------

describe("contributor and author edit concurrently", () => {
  const B0 = frag("b", "B0");
  const B1 = frag("b", "B1 by author");

  it("auto-rebases when they touched different fragments", () => {
    const authorDraft = draftWith((c) => c.fragments?.splice(1, 1, B1));
    const out = merged(authorDraft, [
      { on: "fragment", op: "modify", id: "a", base_digest: fd(A0), after: A1 },
    ]);
    expect(out.fragments.map((f) => f.digest)).toEqual([fd(A1), fd(B1)]);
  });

  it("flags a conflict when both changed the same fragment", () => {
    const authorDraft = draftWith((c) => c.fragments?.splice(0, 1, A2));
    const r = mergeContribution(authorDraft, [
      { on: "fragment", op: "modify", id: "a", base_digest: fd(A0), after: A1 },
      { on: "fragment", op: "modify", id: "b", base_digest: fd(B0), after: B1 },
    ]);
    expect(r.result).toBeNull();
    expect(r.conflicts.map((c) => c.key)).toEqual(["fragment:a"]);
  });

  it("requires separate confirmation for rating and license changes", () => {
    const r = mergeContribution(baseDraft(), [
      { on: "fragment", op: "modify", id: "a", base_digest: fd(A0), after: A1 },
      {
        on: "metadata",
        field: "meta.rating",
        op: "set",
        base_digest: md("general"),
        after: "teen",
        sensitive: false,
      },
      {
        on: "metadata",
        field: "meta.license",
        op: "set",
        base_digest: md("CC-BY-4.0"),
        after: "CC-BY-SA-4.0",
        sensitive: false,
      },
    ]);
    expect(r.sensitive_keys).toEqual(["metadata:meta.rating", "metadata:meta.license"]);
  });
});

// ---------------------------------------------------------------------------
// 性质：幂等与确定性
// ---------------------------------------------------------------------------

describe("idempotency (property)", () => {
  const text = fc.string({ unit: "grapheme", maxLength: 30 });

  /** 针对 baseDraft 生成一组互不相交、形状合法的变更。 */
  const contribution = fc
    .record({
      modA: fc.option(text, { nil: undefined }),
      removeB: fc.boolean(),
      addC: fc.option(text, { nil: undefined }),
      tags: fc.option(
        fc.uniqueArray(fc.constantFrom("noir", "cozy", "rain", "中文"), { minLength: 1 }),
        {
          nil: undefined,
        },
      ),
      rating: fc.option(fc.constantFrom("teen", "mature", "explicit"), { nil: undefined }),
      edgeMode: fc.boolean(),
      happy: fc.boolean(),
    })
    .map((g): Change[] => {
      const out: Change[] = [];
      if (g.modA !== undefined) {
        out.push({
          on: "fragment",
          op: "modify",
          id: "a",
          base_digest: fd(A0),
          after: frag("a", `new:${g.modA}`),
        });
      }
      if (g.removeB)
        out.push({ on: "fragment", op: "remove", id: "b", base_digest: fd(frag("b", "B0")) });
      if (g.addC !== undefined)
        out.push({ on: "fragment", op: "add", id: "c", after: frag("c", g.addC) });
      if (g.tags)
        out.push({
          on: "metadata",
          field: "meta.tags",
          op: "set",
          after: g.tags,
          sensitive: false,
        });
      if (g.rating) {
        out.push({
          on: "metadata",
          field: "meta.rating",
          op: "set",
          base_digest: md("general"),
          after: g.rating,
          sensitive: true,
        });
      }
      if (g.edgeMode)
        out.push({ on: "edge", op: "modify", id: "world", base_digest: ed(W0), after: W1 });
      if (g.happy)
        out.push({ on: "asset", op: "add", slot: "avatar", variant: "happy", after: V_HAPPY });
      return out;
    })
    .filter((cs) => cs.length > 0);

  it("re-applying the same contribution skips every change and keeps the digest", () => {
    fc.assert(
      fc.property(contribution, (changes) => {
        const first = mergeContribution(baseDraft(), changes);
        expect(first.conflicts).toEqual([]);
        expect(first.outcomes.every((o) => o.state === "applied")).toBe(true);
        const r1 = first.result;
        if (!r1) throw new Error("expected a result");

        const second = mergeContribution(r1.creation, changes);
        expect(second.outcomes.map((o) => o.state)).toEqual(changes.map(() => "already_applied"));
        expect(second.result?.semantic_digest).toBe(r1.semantic_digest);
      }),
    );
  });

  it("is deterministic and independent of change order", () => {
    fc.assert(
      fc.property(contribution, fc.nat(), (changes, seed) => {
        const rotated = changes.map((_, i) => changes[(i + seed) % changes.length] as Change);
        const a = mergeContribution(baseDraft(), changes).result?.semantic_digest;
        const b = mergeContribution(baseDraft(), rotated).result?.semantic_digest;
        expect(a).toBeDefined();
        // fragment add 追加到末尾，其余变更原位替换或删除；变更键互不相交，所以顺序无关。
        expect(b).toBe(a);
      }),
    );
  });
});
