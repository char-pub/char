import { describe, expect, it } from "vitest";
import { diffContextIR, irContentText, isHighlightedMetaChange } from "../src/diff.js";
import { isCharError } from "../src/errors.js";
import { instanceKey, irFragmentDigest, irFragmentId, ROOT_INSTANCE } from "../src/keys.js";
import type { ContextIR, IRFragment } from "../src/schema/ir.js";
import { D, tid } from "./fixtures.js";

const ROOT = "@djj/alice";
const WORLD = "@cyberpunk/night-city";
const REL_ALICE = tid("rel", 1);
const REL_WORLD_1 = tid("rel", 2);
const REL_WORLD_2 = tid("rel", 3);

type FragInit = Partial<Omit<IRFragment, "id" | "digest" | "origin">> & {
  ref?: string;
  fid: string;
  via?: string[];
  release?: string;
  overridden?: IRFragment["origin"]["overridden_by"];
};

function f(init: FragInit): IRFragment {
  const ref = init.ref ?? ROOT;
  const via = init.via ?? [];
  const inst = instanceKey(via);
  const semantic = {
    kind: init.kind ?? "character",
    content: init.content ?? {
      type: "text" as const,
      text: `${init.fid} text`,
      format: "markdown" as const,
    },
    activation: init.activation ?? { mode: "always" as const },
    visibility: init.visibility ?? { scope: "shared" as const },
    importance: init.importance ?? "normal",
    placement_hint: init.placement_hint ?? init.kind ?? "character",
    ...(init.locales ? { locales: init.locales } : {}),
    ...(init.subject ? { subject: init.subject } : {}),
    ...(init.asset_refs ? { asset_refs: init.asset_refs } : {}),
  } satisfies Omit<IRFragment, "id" | "digest" | "origin">;
  const origin: IRFragment["origin"] = {
    creation: ref,
    release: init.release ?? (ref === ROOT ? REL_ALICE : REL_WORLD_1),
    fragment: init.fid,
    via,
    instance_key: inst,
    stable: true,
    ...(init.overridden ? { overridden_by: init.overridden } : {}),
  };
  return {
    id: irFragmentId(ref, init.fid, inst),
    ...semantic,
    origin,
    digest: irFragmentDigest(semantic),
  };
}

function ir(fragments: IRFragment[], patch: Partial<ContextIR> = {}): ContextIR {
  const base: ContextIR = {
    ir_version: "0-draft",
    root: { ref: ROOT, release: REL_ALICE, semantic_digest: D("1") },
    lock_digest: D("2"),
    resolver: { name: "@char-pub/core", version: "0.0.0" },
    meta: {
      default_locale: "en",
      available_locales: ["en"],
      rating: "general",
      rating_sources: [{ ref: ROOT, rating: "general" }],
      content_warnings: [],
      licenses: [{ ref: ROOT, license: "CC-BY-4.0" }],
      attribution: [{ ref: ROOT, authors: [{ name: "djj" }] }],
      contributors: [],
      import_omissions: [],
      au: false,
      recommended_presets: [],
    },
    participants: [],
    late_slots: [],
    fragments,
    bootstrap: { greetings: [] },
    assets: [],
    graph: {
      nodes: [
        { ref: ROOT, release: REL_ALICE, type: "character", display_name: "Alice" },
        { ref: WORLD, release: REL_WORLD_1, type: "world", display_name: "Night City" },
      ],
      instances: [],
      edges: [],
      removed: [],
    },
    diagnostics: [],
  };
  return { ...base, ...patch };
}

const desc = f({ fid: "description" });
const world = f({ ref: WORLD, fid: "world", kind: "world", via: ["world"] });
const lore = f({
  ref: WORLD,
  fid: "lore/arasaka",
  kind: "knowledge",
  via: ["world"],
  activation: { mode: "keyword", keys: ["Arasaka"] },
});

describe("diffContextIR", () => {
  it("reports nothing for identical IRs", () => {
    const a = ir([desc, world, lore]);
    const d = diffContextIR(a, a);
    expect(d.fragments).toEqual({ added: [], removed: [], modified: [] });
    expect(d.origin_changes).toEqual([]);
    expect(d.meta_changes).toEqual([]);
    expect(d.lock_changes).toEqual([]);
    expect(d.token_delta).toBeUndefined();
    expect(d.from).toEqual({ root: ROOT, lock_digest: D("2") });
  });

  it("finds added and removed fragments, sorted by id", () => {
    const extra = f({ fid: "zeta" });
    const extra2 = f({ fid: "alpha" });
    const d = diffContextIR(ir([desc, world, lore]), ir([extra, desc, extra2]));
    expect(d.fragments.added).toEqual([extra2.id, extra.id]);
    expect(d.fragments.removed).toEqual([world.id, lore.id].sort());
  });

  it("treats the same fragment reached through a different path as a different instance", () => {
    const other = f({ ref: WORLD, fid: "world", kind: "world", via: ["home"] });
    const d = diffContextIR(ir([desc, world]), ir([desc, other]));
    expect(d.fragments.added).toEqual([other.id]);
    expect(d.fragments.removed).toEqual([world.id]);
    expect(other.id).not.toBe(world.id);
  });

  it.each([
    ["content", { content: { type: "text", text: "changed", format: "markdown" } }],
    ["activation", { activation: { mode: "manual" } }],
    ["visibility", { visibility: { scope: "private", to: ["participant:self"] } }],
    ["importance", { importance: "pinned" }],
    ["placement_hint", { placement_hint: "world" }],
    ["locales", { locales: { ja: { type: "text", text: "説明", format: "markdown" } } }],
  ] as const)("detects a %s change", (field, patch) => {
    const changed = f({ fid: "description", ...(patch as Partial<FragInit>) });
    const d = diffContextIR(ir([desc]), ir([changed]));
    expect(d.fragments.modified).toEqual([{ id: desc.id, fields: [field] }]);
  });

  it("lists several changed fields in a fixed order", () => {
    const changed = f({
      fid: "description",
      importance: "opportunistic",
      content: { type: "text", text: "x", format: "plain" },
    });
    const d = diffContextIR(ir([desc]), ir([changed]));
    expect(d.fragments.modified).toEqual([{ id: desc.id, fields: ["content", "importance"] }]);
  });

  it("reports origin changes even when content is unchanged", () => {
    const upgraded = f({
      ref: WORLD,
      fid: "world",
      kind: "world",
      via: ["world"],
      release: REL_WORLD_2,
    });
    const overridden = f({
      fid: "description",
      overridden: [{ creation: ROOT, op: "patch" }],
    });
    const d = diffContextIR(ir([desc, world]), ir([overridden, upgraded]));
    expect(d.fragments.modified).toEqual([]);
    expect(d.origin_changes.map((c) => c.id)).toEqual([desc.id, world.id].sort());
    const w = d.origin_changes.find((c) => c.id === world.id);
    expect(w?.from.release).toBe(REL_WORLD_1);
    expect(w?.to.release).toBe(REL_WORLD_2);
  });

  it("compares effective metadata and marks rating / license for highlighting", () => {
    const from = ir([desc]);
    const to = ir([desc], {
      meta: {
        ...from.meta,
        rating: "mature",
        rating_sources: [{ ref: WORLD, rating: "mature" }],
        content_warnings: ["violence"],
        licenses: [
          { ref: ROOT, license: "CC-BY-4.0" },
          { ref: WORLD, license: "CC-BY-NC-4.0" },
        ],
        attribution: [
          { ref: ROOT, authors: [{ name: "djj" }] },
          { ref: WORLD, authors: [{ name: "cp" }] },
        ],
        contributors: [{ ref: ROOT, author: tid("usr", 9) }],
      },
    });
    const d = diffContextIR(from, to);
    expect(d.meta_changes.map((m) => m.field)).toEqual([
      "rating",
      "content_warnings",
      "licenses",
      "attribution",
      "contributors",
    ]);
    expect(d.meta_changes[0]).toEqual({ field: "rating", from: "general", to: "mature" });
    expect(d.meta_changes.filter(isHighlightedMetaChange).map((m) => m.field)).toEqual([
      "rating",
      "licenses",
    ]);
  });

  it("derives lock changes from the graph when no locks are given", () => {
    const from = ir([desc]);
    const to = ir([desc], {
      lock_digest: D("3"),
      graph: {
        ...from.graph,
        nodes: [
          { ref: ROOT, release: REL_ALICE, type: "character", display_name: "Alice" },
          { ref: WORLD, release: REL_WORLD_2, type: "world", display_name: "Night City" },
          { ref: "@commons/rain", release: tid("rel", 4), type: "lorebook", display_name: "Rain" },
        ],
      },
    });
    const d = diffContextIR(from, to);
    expect(d.lock_changes).toEqual([
      { ref: "@commons/rain", to: tid("rel", 4) },
      { ref: WORLD, from: REL_WORLD_1, to: REL_WORLD_2 },
    ]);
    expect(d.to.lock_digest).toBe(D("3"));
  });

  it("uses labels from the provided locks", () => {
    const d = diffContextIR(ir([desc]), ir([desc]), {
      locks: {
        from: [
          { ref: WORLD, release: REL_WORLD_1, label: "1.0.0" },
          { ref: "@commons/old", release: tid("rel", 5), label: "2.0.0" },
        ],
        to: [
          { ref: WORLD, release: REL_WORLD_2, label: "1.1.0" },
          { ref: "@commons/same", release: tid("rel", 6), label: "3.0.0" },
        ],
      },
    });
    expect(d.lock_changes).toEqual([
      { ref: "@commons/old", from: "2.0.0" },
      { ref: "@commons/same", to: "3.0.0" },
      { ref: WORLD, from: "1.0.0", to: "1.1.0" },
    ]);
  });

  it("ignores unchanged locks even if labels are missing", () => {
    const d = diffContextIR(ir([desc]), ir([desc]), {
      locks: {
        from: [{ ref: WORLD, release: REL_WORLD_1 }],
        to: [{ ref: WORLD, release: REL_WORLD_1, label: "1.0.0" }],
      },
    });
    expect(d.lock_changes).toEqual([]);
  });

  it("computes token deltas for always-included and potential content", () => {
    const count = (s: string) => s.length;
    const pinnedKeyword = f({
      fid: "pinned",
      importance: "pinned",
      activation: { mode: "keyword", keys: ["x"] },
      content: { type: "text", text: "12345", format: "markdown" },
    });
    const biggerLore = f({
      ref: WORLD,
      fid: "lore/arasaka",
      kind: "knowledge",
      via: ["world"],
      activation: { mode: "keyword", keys: ["Arasaka"] },
      content: { type: "text", text: "much longer lore text", format: "markdown" },
    });
    const from = ir([desc, lore]);
    const to = ir([desc, biggerLore, pinnedKeyword]);
    const d = diffContextIR(from, to, { countTokens: count, tokenizer: "chars" });
    const loreDelta = irContentText(biggerLore.content).length - irContentText(lore.content).length;
    expect(d.token_delta).toEqual({ tokenizer: "chars", always: 5, potential: loreDelta + 5 });
  });

  it("defaults the tokenizer label to estimate", () => {
    const d = diffContextIR(ir([desc]), ir([]), { countTokens: () => 1 });
    expect(d.token_delta).toEqual({ tokenizer: "estimate", always: -1, potential: -1 });
  });

  it("rejects an IR that contains the same fragment id twice", () => {
    let code: string | undefined;
    try {
      diffContextIR(ir([desc, desc]), ir([desc]));
    } catch (e) {
      code = isCharError(e) ? e.code : undefined;
    }
    expect(code).toBe("diff.duplicate_fragment");
  });

  it("is independent of fragment order in either IR", () => {
    const a = diffContextIR(ir([desc, world, lore]), ir([lore, desc]));
    const b = diffContextIR(ir([lore, world, desc]), ir([desc, lore]));
    expect(b).toEqual(a);
  });
});

describe("irContentText", () => {
  it("flattens every content type", () => {
    expect(irContentText({ type: "text", text: "hi", format: "plain" })).toBe("hi");
    expect(
      irContentText({
        type: "dialogue",
        turns: [
          { speaker: "participant:self", text: "a" },
          { speaker: "participant:user", text: "b" },
        ],
      }),
    ).toBe("participant:self: a\nparticipant:user: b");
    expect(irContentText({ type: "media", asset: "x", caption: "cap" })).toBe("cap");
    expect(irContentText({ type: "media", asset: "x" })).toBe("");
    expect(irContentText({ type: "structured", schema: "s", data: { b: 1, a: [true] } })).toBe(
      '{"a":[true],"b":1}',
    );
  });
});

describe("instance keys used in diff ids", () => {
  it("root instance is literally root", () => {
    expect(instanceKey([])).toBe(ROOT_INSTANCE);
    expect(desc.id).toBe(`${ROOT}#description~root`);
    expect(world.id).toMatch(/^@cyberpunk\/night-city#world~[0-9a-f]{64}$/);
  });
});
