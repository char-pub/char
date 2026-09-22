import { describe, expect, it } from "vitest";
import { canonicalizeCreation } from "../src/canonical.js";
import { isCharError } from "../src/errors.js";
import { instanceKey, irFragmentId } from "../src/keys.js";
import { type ReleaseInput, resolve } from "../src/resolve/index.js";
import type { CreationInput } from "../src/schema/creation.js";
import { D, level0Character, tid } from "./fixtures.js";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return isCharError(e) ? e.code : `non-char:${String(e)}`;
  }
  return undefined;
}

function rel(
  n: number,
  creation: CreationInput,
  extra: Partial<ReleaseInput> = {},
): ReleaseInput & { semantic_digest: string } {
  return {
    release: tid("rel", n),
    visibility: "public",
    creation,
    semantic_digest: canonicalizeCreation(creation).semantic_digest,
    ...extra,
  };
}

/** 测试中故意构造的、可能不合法的输入，交给 Resolver 自己校验。 */
// biome-ignore lint/suspicious/noExplicitAny: 反例输入不需要满足类型
type Loose = any;

const pinOf = (r: { release: string; semantic_digest: string }) => ({
  release: r.release,
  semantic_digest: r.semantic_digest,
});

function world(n: number, overrides: Partial<CreationInput> = {}): CreationInput {
  return {
    id: tid("cr", n),
    ref: "@cyberpunk/night-city",
    type: "world",
    display_name: "Night City",
    fragments: [
      {
        id: "world",
        stable: true,
        kind: "world",
        content: { type: "text", text: "A megacity ruled by corporations." },
      },
    ],
    meta: { default_locale: "en", rating: "mature", rights: "original", license: "CC-BY-4.0" },
    ...overrides,
  };
}

function lorebook(n: number, overrides: Partial<CreationInput> = {}): CreationInput {
  return {
    id: tid("cr", n),
    ref: "@cyberpunk/corps",
    type: "lorebook",
    display_name: "Corporations",
    fragments: [
      {
        id: "lore/arasaka",
        stable: true,
        kind: "knowledge",
        content: { type: "text", text: "Arasaka is a security megacorp." },
        activation: { mode: "keyword", keys: ["Arasaka"] },
      },
      {
        id: "lore/militech",
        stable: true,
        kind: "knowledge",
        content: { type: "text", text: "Militech builds weapons." },
        activation: { mode: "keyword", keys: ["Militech"] },
      },
      {
        id: "lore/temp",
        stable: false,
        kind: "knowledge",
        content: { type: "text", text: "Imported entry." },
      },
    ],
    meta: { default_locale: "en", rating: "teen", rights: "original", license: "CC-BY-4.0" },
    ...overrides,
  };
}

describe("Level 0 character", () => {
  it("resolves to a minimal IR", () => {
    const root = rel(1, level0Character());
    const out = resolve({ root, publicAssetBaseUrl: "https://assets.char.pub/cas/sha256" });
    const ir = out.ir;
    expect(ir.ir_version).toBe("0-draft");
    expect(ir.root).toEqual({
      ref: "@djj/alice",
      release: root.release,
      semantic_digest: root.semantic_digest,
    });
    expect(ir.fragments.map((f) => f.id)).toEqual(["@djj/alice#description~root"]);
    const f = ir.fragments[0];
    expect(f?.content).toEqual({
      type: "text",
      text: "Alice is a courier in Night City.",
      format: "markdown",
    });
    expect(f?.subject).toBe("self");
    expect(f?.activation).toEqual({ mode: "always" });
    expect(f?.importance).toBe("normal");
    expect(f?.placement_hint).toBe("character");
    expect(ir.participants.map((p) => p.key)).toEqual(["self", "user"]);
    expect(ir.participants.find((p) => p.key === "self")?.avatar).toBe(
      "@djj/alice#asset/avatar/default~root",
    );
    expect(ir.late_slots).toEqual([
      { key: "user", accepts: ["persona"], required: true, used_by: [] },
    ]);
    expect(ir.bootstrap.greetings).toEqual([
      { id: "default", speaker: "participant:self", text: "Hi, you're late again." },
    ]);
    expect(ir.assets[0]?.url).toBe(`https://assets.char.pub/cas/sha256/aa/${"a".repeat(64)}`);
    expect(ir.meta.rating).toBe("general");
    expect(ir.lock_digest).toMatch(/^sha256:/);
    expect(out.lock).toEqual([]);
  });

  it("is byte-for-byte deterministic and independent of input formatting", () => {
    const c = level0Character();
    const a = resolve({ root: rel(1, c) });
    const reformatted = JSON.parse(JSON.stringify(c, null, 3));
    const b = resolve({ root: rel(1, reformatted) });
    expect(b.json).toBe(a.json);
    expect(b.digest).toBe(a.digest);
  });

  it("marks {{user}} usage on the implicit user late slot", () => {
    const c = level0Character({
      fragments: [
        {
          id: "description",
          stable: true,
          kind: "character",
          content: { type: "text", text: "{{self}} always teases {{user}}." },
        },
      ],
    });
    const ir = resolve({ root: rel(1, c) }).ir;
    expect(ir.fragments[0]?.content).toMatchObject({ text: "Alice always teases {{late:user}}." });
    expect(ir.late_slots[0]?.used_by).toEqual(["@djj/alice#description~root"]);
  });

  it("keeps escaped braces escaped", () => {
    const c = level0Character({
      fragments: [
        {
          id: "description",
          stable: true,
          kind: "character",
          content: { type: "text", text: "Literal {{{{self}} and {{self}}." },
        },
      ],
    });
    const ir = resolve({ root: rel(1, c) }).ir;
    expect(ir.fragments[0]?.content).toMatchObject({ text: "Literal {{{{self}} and Alice." });
  });
});

describe("character + intrinsic world + keyword lorebook", () => {
  const w = rel(2, world(2));
  const lb = rel(3, lorebook(3));
  const alice = level0Character({
    references: [
      {
        id: "lives-in",
        rel: "lives_in",
        use: "@cyberpunk/night-city",
        mode: "intrinsic",
        pin: pinOf(w),
      },
      {
        id: "knows",
        rel: "knows_about",
        use: "@cyberpunk/corps",
        mode: "default",
        pin: pinOf(lb),
        override: [{ op: "patch", target: "lore/militech", set: { importance: "opportunistic" } }],
      },
    ],
  });

  it("orders fragments depth-first with edges sorted by id", () => {
    const out = resolve({ root: rel(1, alice), dependencies: [w, lb] });
    const knows = instanceKey(["knows"]);
    const lives = instanceKey(["lives-in"]);
    expect(out.ir.fragments.map((f) => f.id)).toEqual([
      "@djj/alice#description~root",
      irFragmentId("@cyberpunk/corps", "lore/arasaka", knows),
      irFragmentId("@cyberpunk/corps", "lore/militech", knows),
      irFragmentId("@cyberpunk/corps", "lore/temp", knows),
      irFragmentId("@cyberpunk/night-city", "world", lives),
    ]);
  });

  it("aggregates rating, licenses and lock, and explains origin", () => {
    const out = resolve({ root: rel(1, alice), dependencies: [w, lb] });
    const ir = out.ir;
    expect(ir.meta.rating).toBe("mature");
    expect(ir.meta.rating_sources).toEqual([
      { ref: "@cyberpunk/corps", rating: "teen" },
      { ref: "@cyberpunk/night-city", rating: "mature" },
      { ref: "@djj/alice", rating: "general" },
    ]);
    expect(out.lock.map((l) => [l.ref, l.via])).toEqual([
      ["@cyberpunk/corps", ["knows"]],
      ["@cyberpunk/night-city", ["lives-in"]],
    ]);
    const militech = ir.fragments.find((f) => f.origin.fragment === "lore/militech");
    expect(militech?.importance).toBe("opportunistic");
    expect(militech?.origin.overridden_by).toEqual([
      { creation: "@djj/alice", edge: "knows", op: "patch" },
    ]);
    expect(militech?.activation).toEqual({ mode: "keyword", keys: ["Militech"] });
    expect(ir.graph.edges.map((e) => [e.from_instance, e.id, e.mode, e.rel])).toEqual([
      ["root", "knows", "default", "knows_about"],
      ["root", "lives-in", "intrinsic", "lives_in"],
    ]);
    expect(ir.diagnostics.map((d) => d.code)).toEqual(["resolve.unstable_fragment"]);
  });

  it("changes lock_digest but not fragment ids when a dependency is upgraded", () => {
    const w2 = rel(4, world(2, { summary: "v2" }));
    const alice2 = level0Character({
      references: [
        { id: "lives-in", use: "@cyberpunk/night-city", mode: "intrinsic", pin: pinOf(w2) },
      ],
    });
    const alice1 = level0Character({
      references: [
        { id: "lives-in", use: "@cyberpunk/night-city", mode: "intrinsic", pin: pinOf(w) },
      ],
    });
    const a = resolve({ root: rel(1, alice1), dependencies: [w] }).ir;
    const b = resolve({ root: rel(1, alice2), dependencies: [w2] }).ir;
    expect(a.lock_digest).not.toBe(b.lock_digest);
    expect(a.fragments.map((f) => f.id)).toEqual(b.fragments.map((f) => f.id));
    expect(a.fragments.map((f) => f.digest)).toEqual(b.fragments.map((f) => f.digest));
  });
});

describe("select and override", () => {
  const lb = rel(3, lorebook(3));
  const withEdge = (edge: Record<string, unknown>) =>
    level0Character({
      references: [
        { id: "knows", use: "@cyberpunk/corps", mode: "default", pin: pinOf(lb), ...edge },
      ],
    });

  it("select.include keeps only matching fragments and records the rest as removed", () => {
    const ir = resolve({
      root: rel(1, withEdge({ select: { include: ["lore/arasaka"] } })),
      dependencies: [lb],
    }).ir;
    expect(ir.fragments.map((f) => f.origin.fragment)).toEqual(["description", "lore/arasaka"]);
    expect(ir.graph.removed.map((r) => [r.by.reason, r.id.split("~")[0]])).toEqual([
      ["select", "@cyberpunk/corps#lore/militech"],
      ["select", "@cyberpunk/corps#lore/temp"],
    ]);
  });

  it("supports prefix wildcards in exclude", () => {
    const ir = resolve({
      root: rel(1, withEdge({ select: { exclude: ["lore/*"] } })),
      dependencies: [lb],
    }).ir;
    expect(ir.fragments.map((f) => f.origin.fragment)).toEqual(["description"]);
  });

  it("replace, remove and add", () => {
    const ir = resolve({
      root: rel(
        1,
        withEdge({
          override: [
            {
              op: "replace",
              target: "lore/arasaka",
              content: { type: "text", text: "Arasaka runs the city." },
            },
            { op: "remove", target: "lore/militech" },
            {
              op: "add",
              fragment: {
                id: "lore/biotechnica",
                stable: true,
                kind: "knowledge",
                content: { type: "text", text: "Biotechnica grows food." },
              },
            },
          ],
        }),
      ),
      dependencies: [lb],
    }).ir;
    const ids = ir.fragments.map((f) => f.origin.fragment);
    expect(ids).toEqual(["description", "lore/arasaka", "lore/temp", "lore/biotechnica"]);
    expect(ir.fragments[1]?.content).toMatchObject({ text: "Arasaka runs the city." });
    expect(ir.fragments[1]?.origin.overridden_by).toEqual([
      { creation: "@djj/alice", edge: "knows", op: "replace" },
    ]);
    expect(ir.graph.removed.map((r) => r.by.reason)).toEqual(["override"]);
    expect(ir.fragments[3]?.origin.overridden_by).toEqual([
      { creation: "@djj/alice", edge: "knows", op: "add" },
    ]);
  });

  it("renders replaced content in the referenced creation's context", () => {
    // 被引用的是 lorebook，不是角色，所以替换内容里的 {{self}} 不合法。
    const edge = {
      override: [
        {
          op: "replace",
          target: "lore/arasaka",
          content: { type: "text", text: "{{self}} hates it." },
        },
      ],
    };
    expect(codeOf(() => resolve({ root: rel(1, withEdge(edge)), dependencies: [lb] }))).toBe(
      "resolve.self_outside_participant",
    );
  });

  it.each([
    [{ override: [{ op: "remove", target: "lore/temp" }] }, "resolve.override_unstable_target"],
    [{ override: [{ op: "remove", target: "lore/nope" }] }, "resolve.override_target_missing"],
    [
      {
        override: [
          { op: "remove", target: "lore/arasaka" },
          { op: "patch", target: "lore/arasaka", set: { importance: "pinned" } },
        ],
      },
      "resolve.override_duplicate_target",
    ],
    [
      {
        select: { include: ["lore/arasaka"] },
        override: [{ op: "remove", target: "lore/militech" }],
      },
      "resolve.override_target_excluded",
    ],
    [
      {
        override: [
          {
            op: "add",
            fragment: {
              id: "lore/arasaka",
              stable: true,
              kind: "knowledge",
              content: { type: "text", text: "x" },
            },
          },
        ],
      },
      "resolve.override_add_collision",
    ],
  ])("rejects invalid override %#", (edge, code) => {
    expect(codeOf(() => resolve({ root: rel(1, withEdge(edge)), dependencies: [lb] }))).toBe(code);
  });

  it("forbids replacing an intrinsic world outside a scenario", () => {
    const w = rel(2, world(2));
    const c = level0Character({
      references: [
        {
          id: "lives-in",
          use: "@cyberpunk/night-city",
          mode: "intrinsic",
          pin: pinOf(w),
          override: [{ op: "remove", target: "world", force: true }],
        },
      ],
    });
    expect(codeOf(() => resolve({ root: rel(1, c), dependencies: [w] }))).toBe(
      "resolve.intrinsic_override_forbidden",
    );
  });
});

describe("graph rules", () => {
  it("rejects diamond dependencies with different releases and explains both paths", () => {
    const w1 = rel(2, world(2));
    const w2 = rel(4, world(2, { summary: "newer" }));
    const lb = rel(
      3,
      lorebook(3, {
        references: [
          { id: "setting", use: "@cyberpunk/night-city", mode: "default", pin: pinOf(w2) },
        ],
      }),
    );
    const c = level0Character({
      references: [
        { id: "a-knows", use: "@cyberpunk/corps", mode: "default", pin: pinOf(lb) },
        { id: "b-lives", use: "@cyberpunk/night-city", mode: "intrinsic", pin: pinOf(w1) },
      ],
    });
    try {
      resolve({ root: rel(1, c), dependencies: [w1, w2, lb] });
      expect.unreachable();
    } catch (e) {
      expect(isCharError(e) && e.code).toBe("resolve.diamond_conflict");
      expect(isCharError(e) && e.data).toEqual({
        ref: "@cyberpunk/night-city",
        releases: [
          { release: w2.release, via: ["a-knows", "setting"] },
          { release: w1.release, via: ["b-lives"] },
        ],
      });
    }
  });

  it("allows the same release along two paths as two instances", () => {
    const w = rel(2, world(2));
    const lb = rel(
      3,
      lorebook(3, {
        references: [
          { id: "setting", use: "@cyberpunk/night-city", mode: "default", pin: pinOf(w) },
        ],
      }),
    );
    const c = level0Character({
      references: [
        { id: "a-knows", use: "@cyberpunk/corps", mode: "default", pin: pinOf(lb) },
        { id: "b-lives", use: "@cyberpunk/night-city", mode: "intrinsic", pin: pinOf(w) },
      ],
    });
    const out = resolve({ root: rel(1, c), dependencies: [w, lb] });
    const worlds = out.ir.fragments.filter((f) => f.origin.creation === "@cyberpunk/night-city");
    expect(worlds.map((f) => f.origin.via)).toEqual([["a-knows", "setting"], ["b-lives"]]);
    expect(new Set(worlds.map((f) => f.id)).size).toBe(2);
    expect(out.lock.find((l) => l.ref === "@cyberpunk/night-city")?.via).toEqual([
      "a-knows",
      "setting",
    ]);
  });

  it("rejects tombstoned dependencies with the reason, warns on yanked", () => {
    const w = rel(2, world(2), { status: "tombstoned", status_reason: "DMCA takedown" });
    const c = level0Character({
      references: [
        { id: "lives-in", use: "@cyberpunk/night-city", mode: "intrinsic", pin: pinOf(w) },
      ],
    });
    try {
      resolve({ root: rel(1, c), dependencies: [w] });
      expect.unreachable();
    } catch (e) {
      expect(isCharError(e) && [e.code, e.detail]).toEqual(["resolve.tombstoned", "DMCA takedown"]);
    }
    const y = rel(2, world(2), { status: "yanked" });
    const out = resolve({ root: rel(1, c), dependencies: [y] });
    expect(out.warnings.map((x) => x.code)).toEqual(["resolve.yanked"]);
    // 可变的 Registry 状态不进入 IR：yank 前后 IR 相同。
    const active = resolve({ root: rel(1, c), dependencies: [rel(2, world(2))] });
    expect(out.json).toBe(active.json);
  });

  it.each([
    ["unpinned", { pin: { follow: "latest" } }, "resolve.unpinned"],
    [
      "missing",
      { pin: { release: tid("rel", 99), semantic_digest: D("b") } },
      "resolve.release_missing",
    ],
    [
      "digest",
      { pin: { release: tid("rel", 2), semantic_digest: D("b") } },
      "resolve.pin_digest_mismatch",
    ],
  ])("rejects %s pins", (_name, edge, code) => {
    const w = rel(2, world(2));
    const c = level0Character({
      references: [
        { id: "lives-in", use: "@cyberpunk/night-city", mode: "intrinsic", ...edge } as Loose,
      ],
    });
    expect(codeOf(() => resolve({ root: rel(1, c), dependencies: [w] }))).toBe(code);
  });

  it("rejects a pin whose release belongs to another creation", () => {
    const w = rel(2, world(2));
    const c = level0Character({
      references: [{ id: "x", use: "@cyberpunk/corps", mode: "default", pin: pinOf(w) }],
    });
    expect(codeOf(() => resolve({ root: rel(1, c), dependencies: [w] }))).toBe(
      "resolve.pin_ref_mismatch",
    );
  });

  it("rejects a stored semantic digest that does not match the content", () => {
    const root = { ...rel(1, level0Character()), semantic_digest: D("c") };
    expect(codeOf(() => resolve({ root }))).toBe("resolve.semantic_digest_mismatch");
  });
});

describe("relationship template: early + late binding", () => {
  const friend: CreationInput = {
    id: tid("cr", 5),
    ref: "@commons/childhood-friend",
    type: "relationship",
    display_name: "Childhood friend",
    slots: { a: { accepts: "character" }, b: { accepts: ["character", "persona"] } },
    params: { reunited_after: { type: "string", default: "several years" } },
    fragments: [
      {
        id: "bond",
        stable: true,
        kind: "relationship",
        content: {
          type: "text",
          text: "{{slot:a}} and {{slot:b}} grew up next door. They met again after {{param:reunited_after}}.",
        },
      },
    ],
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
  };
  const fr = rel(5, friend);

  it("binds {{self}} early and the persona late", () => {
    const c = level0Character({
      references: [
        {
          id: "friend",
          rel: "relationship",
          use: "@commons/childhood-friend",
          mode: "default",
          pin: pinOf(fr),
          bind: { a: "{{self}}", b: { late: "persona" } },
          params: { reunited_after: "10 years" },
        },
      ],
    });
    const ir = resolve({ root: rel(1, c), dependencies: [fr] }).ir;
    const inst = instanceKey(["friend"]);
    const bond = ir.fragments.find((f) => f.origin.fragment === "bond");
    const lateB = ir.late_slots.find((s) => s.key !== "user");
    expect(lateB).toMatchObject({ accepts: ["persona"], required: true, used_by: [bond?.id] });
    expect(bond?.content).toMatchObject({
      text: `Alice and {{late:${lateB?.key}}} grew up next door. They met again after 10 years.`,
    });
    expect(bond?.id).toBe(irFragmentId("@commons/childhood-friend", "bond", inst));
  });

  it("uses the param default and rejects wrong types or unknown params", () => {
    const mk = (params?: Record<string, unknown>) =>
      level0Character({
        references: [
          {
            id: "friend",
            use: "@commons/childhood-friend",
            mode: "default",
            pin: pinOf(fr),
            bind: { a: "{{self}}", b: { late: "persona" } },
            ...(params ? { params } : {}),
          } as Loose,
        ],
      });
    const ir = resolve({ root: rel(1, mk()), dependencies: [fr] }).ir;
    expect(JSON.stringify(ir.fragments)).toContain("after several years.");
    expect(
      codeOf(() => resolve({ root: rel(1, mk({ reunited_after: 3 })), dependencies: [fr] })),
    ).toBe("resolve.param_type_mismatch");
    expect(codeOf(() => resolve({ root: rel(1, mk({ nope: "x" })), dependencies: [fr] }))).toBe(
      "resolve.param_unknown",
    );
  });

  it("rejects a missing required slot and type mismatches", () => {
    const mk = (bind: Loose) =>
      level0Character({
        references: [
          { id: "friend", use: "@commons/childhood-friend", mode: "default", pin: pinOf(fr), bind },
        ],
      });
    expect(codeOf(() => resolve({ root: rel(1, mk({ a: "{{self}}" })), dependencies: [fr] }))).toBe(
      "resolve.required_slot_unbound",
    );
    expect(
      codeOf(() =>
        resolve({
          root: rel(1, mk({ a: { late: "persona" }, b: "{{self}}" })),
          dependencies: [fr],
        }),
      ),
    ).toBe("resolve.binding_type_mismatch");
    expect(
      codeOf(() =>
        resolve({
          root: rel(1, mk({ a: "{{self}}", b: "{{self}}", c: "{{self}}" })),
          dependencies: [fr],
        }),
      ),
    ).toBe("resolve.slot_unknown");
  });

  it("gives two instances of the same release distinct keys (no collisions)", () => {
    const c = level0Character({
      references: [
        {
          id: "friend-1",
          use: "@commons/childhood-friend",
          mode: "default",
          pin: pinOf(fr),
          bind: { a: "{{self}}", b: { late: "persona" } },
          params: { reunited_after: "1 year" },
        },
        {
          id: "friend-2",
          use: "@commons/childhood-friend",
          mode: "default",
          pin: pinOf(fr),
          bind: { a: "{{self}}", b: { late: "character" } },
          params: { reunited_after: "2 years" },
        },
      ],
    });
    const ir = resolve({ root: rel(1, c), dependencies: [fr] }).ir;
    const bonds = ir.fragments.filter((f) => f.origin.fragment === "bond");
    expect(bonds).toHaveLength(2);
    expect(new Set(bonds.map((b) => b.id)).size).toBe(2);
    expect(new Set(bonds.map((b) => b.digest)).size).toBe(2);
    const lates = ir.late_slots.filter((s) => s.key !== "user");
    expect(lates).toHaveLength(2);
    expect(lates.map((s) => s.accepts[0]).sort()).toEqual(["character", "persona"]);
  });

  it("publishes the template itself with its slots as late slots", () => {
    const ir = resolve({ root: fr }).ir;
    expect(ir.late_slots.map((s) => s.key === "user" || s.key.startsWith("l:"))).toEqual([
      true,
      true,
      true,
    ]);
    expect(ir.participants.some((p) => p.key === "self")).toBe(false);
  });
});

describe("locale, visibility, assets", () => {
  it("renders locale variants and computes available locales", () => {
    const c = level0Character({
      display_name: { en: "Alice", ja: "アリス" },
      fragments: [
        {
          id: "description",
          stable: true,
          kind: "character",
          content: { type: "text", text: "{{self}} is a courier." },
          locale: { ja: { content: { type: "text", text: "{{self}}は運び屋だ。" } } },
        },
      ],
    });
    const ir = resolve({ root: rel(1, c) }).ir;
    expect(ir.fragments[0]?.locales).toEqual({
      ja: { type: "text", text: "アリスは運び屋だ。", format: "markdown" },
    });
    expect(ir.meta.available_locales).toEqual(["en", "ja"]);
  });

  it("rewrites private visibility targets to participant keys", () => {
    const c = level0Character({
      fragments: [
        {
          id: "secret",
          stable: true,
          kind: "character",
          content: { type: "text", text: "{{self}} is afraid of the dark." },
          visibility: { scope: "private", to: ["{{self}}"] },
        },
      ],
    });
    const ir = resolve({ root: rel(1, c) }).ir;
    expect(ir.fragments[0]?.visibility).toEqual({ scope: "private", to: ["participant:self"] });
  });

  it("aggregates independent asset rating and license, and rejects presentation assets in context", () => {
    const c = level0Character({
      assets: [
        {
          slot: "avatar",
          role: "presentation",
          variants: [
            {
              id: "default",
              media_type: "image/webp",
              blob: { digest: D("a"), size: 10, availability: "mirrored" },
              rating: "mature",
              license: "CC-BY-NC-4.0",
            },
          ],
        },
      ],
    });
    const ir = resolve({
      root: rel(1, c, { visibility: "private" }),
      publicAssetBaseUrl: "https://x",
    }).ir;
    expect(ir.meta.rating).toBe("mature");
    expect(ir.meta.rating_sources).toContainEqual({
      ref: "@djj/alice",
      rating: "mature",
      asset: "avatar/default",
    });
    expect(ir.meta.licenses).toContainEqual({
      ref: "@djj/alice",
      license: "CC-BY-NC-4.0",
      asset: "avatar/default",
    });
    expect(ir.assets[0]?.access).toBe("private");
    expect(ir.assets[0]?.url).toBeUndefined();

    const bad = level0Character({
      fragments: [
        {
          id: "description",
          stable: true,
          kind: "character",
          content: { type: "text", text: "x" },
          asset_refs: ["#asset/avatar"],
        },
      ],
    });
    expect(codeOf(() => resolve({ root: rel(1, bad) }))).toBe("resolve.asset_not_context");
  });
});
