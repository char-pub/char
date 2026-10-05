import { describe, expect, it } from "vitest";
import { canonicalizeCreation } from "../src/canonical.js";
import { getCreationDependencies } from "../src/dependencies.js";
import { deriveCreation } from "../src/derive.js";
import { checkPublish } from "../src/publish.js";
import type { ReleaseInput } from "../src/resolve/graph.js";
import { type CreationInput, CreationSchema } from "../src/schema/creation.js";
import { PRESET_REGIONS } from "../src/schema/policy.js";
import { initStoryState } from "../src/story/evaluate.js";
import { buildTestCreation, TEST_DEFAULT_PIN, withTestDefault } from "./build.js";
import { D, tid } from "./fixtures.js";

const meta = {
  default_locale: "en",
  rating: "general",
  rights: "original",
  license: "CC-BY-4.0",
} as const;
const target = { id: tid("cr", 20), ref: "@new/continuation", display_name: "Continuation" };
function published(
  n: number,
  creation: CreationInput,
  extra: Partial<ReleaseInput> = {},
): ReleaseInput {
  return {
    release: tid("rel", n),
    visibility: "public",
    creation,
    semantic_digest: canonicalizeCreation(creation).semantic_digest,
    ...extra,
  };
}
const fragment = (id: string, text: string) => ({
  id,
  stable: true,
  kind: "knowledge" as const,
  content: { type: "text" as const, text },
});
const character = published(1, {
  id: tid("cr", 1),
  ref: "@old/guard",
  type: "character",
  display_name: "Guard",
  meta,
  fragments: [{ ...fragment("identity", "A guard named {{self}}."), kind: "character" }],
});
function scenario(overrides: Partial<CreationInput> = {}): CreationInput {
  return {
    id: tid("cr", 2),
    ref: "@old/story",
    type: "scenario",
    display_name: { en: "Old story", ja: "前作" },
    meta,
    authors: [{ name: "Original author", user: tid("usr", 1) }],
    provenance: {
      client_id: "old-runtime",
      derived_from: [{ release: tid("rel", 99), relation: "import" }],
    },
    references: [
      {
        id: "guard",
        use: "#guard",
        mode: "default",
        pin: {
          release: character.release,
          semantic_digest: canonicalizeCreation(character.creation).semantic_digest,
        },
      },
    ],
    cast: [
      { key: "alice", who: "#guard", part: "North guard" },
      { key: "bob", who: "#guard", part: "South guard" },
      { key: "player", who: { late: "persona" }, role: "user" },
    ],
    fragments: [
      { ...fragment("secret", "The gate can open."), about: ["@old/story#other"] },
      fragment("other", "The guard has a brother."),
      {
        ...fragment("vault-fact", "Only visible in the vault."),
        visibility: { scope: "story-scene", scene: "vault" },
      },
    ],
    bootstrap: { greetings: [{ id: "welcome", text: "OLD GREETING" }] },
    story: {
      version: 1,
      scenes: [
        {
          id: "vault",
          title: "Vault",
          opening: "OLD OPENING",
          when: { judge: "The original scene can begin" },
          beats: ["old-beat"],
        },
        { id: "unused", title: "Unused" },
      ],
      starts: [
        {
          id: "old-start",
          scene: "vault",
          greeting: "OLD START",
          set: [{ add: ["var/count", 5] }],
          reached: ["old-beat"],
        },
      ],
      vars: {
        count: { type: "int", init: 1, min: 0, max: 10, description: "Count" },
        inventory: { type: "set", of: "item", init: ["coin"], description: "Inventory" },
      },
      items: [
        { id: "coin", title: "Coin", description: "A coin", lore: ["@old/story#secret"] },
        { id: "key", title: "Key", description: "A key" },
      ],
      beats: [
        {
          id: "old-beat",
          title: "Old beat",
          description: "Old progress",
          effects: [{ add: ["var/count", 1] }],
        },
      ],
      endings: [
        {
          id: "escape",
          title: { en: "Escape", ja: "脱出" },
          description: "They escape",
          when: { all: [{ reached: "beat/old-beat" }, { judge: "Player escaped" }] },
          effects: [
            { add: ["var/count", 2] },
            { put: ["var/inventory", "item/key"] },
            { learn: { who: "bob", info: "@old/story#secret" } },
          ],
          after: "stop",
        },
      ],
      knowing: {
        "@old/story#secret": { start: { knows: ["alice"], not: ["bob", "player"] } },
        "#other": { start: { knows: [] }, enter: { vault: { knows: "*" } } },
      },
    },
    ...overrides,
  };
}
function source(overrides: Partial<CreationInput> = {}) {
  return published(2, scenario(overrides));
}
function compile(creation: CreationInput, original: ReleaseInput) {
  return buildTestCreation({
    root: { release: tid("rel", 20), visibility: "public", creation },
    dependencies: [character, original],
  });
}
function report(creation: CreationInput, original: ReleaseInput) {
  return checkPublish(
    withTestDefault({
      release: tid("rel", 20),
      label: "1.0.0",
      visibility: "public",
      creation,
      dependencies: [character, original],
      registry: {
        existingLabels: {},
        assetStatus: {},
        blockedDigests: new Set<string>(),
        ownerNamespaces: new Set(["new"]),
      },
    }),
  );
}

it("Remix preserves complete definitions, exact pins, original attribution and locale text without mutating the source", () => {
  const original = source();
  const before = JSON.stringify(original);
  const result = deriveCreation({ kind: "remix", source: original, target });
  expect(JSON.stringify(original)).toBe(before);
  expect(result.creation.authors).toEqual(scenario().authors);
  expect(result.creation.bootstrap).toEqual(scenario().bootstrap);
  expect(result.creation.references?.[0]).toMatchObject({
    use: "@old/guard",
    pin: { release: character.release },
  });
  expect(result.creation.cast?.map((member) => member.who)).toEqual([
    "@old/guard",
    "@old/guard",
    { late: "persona" },
  ]);
  expect(result.creation.provenance?.client_id).toBeUndefined();
  expect(result.creation.provenance?.derived_from).toContainEqual({
    ...result.source,
    relation: "remix",
  });
  expect(result.creation.story?.knowing).toHaveProperty("@new/continuation#secret");
  expect(result.creation.fragments?.[0]?.about).toContain("@new/continuation#other");
  expect(result.creation.story?.endings?.[0]?.title).toEqual({ en: "Escape", ja: "脱出" });
  const built = compile(result.creation, original);
  expect(built.lock).toContainEqual(
    expect.objectContaining({ ref: "@old/story", via: ["derivation", "1"] }),
  );
  if (built.artifact.kind !== "content") throw new Error("Expected content");
  expect(built.artifact.ir.graph.instances.some((instance) => instance.ref === "@old/story")).toBe(
    false,
  );
  expect(built.artifact.ir.participants).toHaveLength(4);
});

it("a sequel copies background and roles but creates a fresh Story initialized only by authored defaults and ending effects", () => {
  const original = source();
  const result = deriveCreation({ kind: "sequel", source: original, target, ending: "escape" });
  const story = result.creation.story;
  if (!story) throw new Error("Expected story");
  expect(result.creation.bootstrap).toBeUndefined();
  expect(result.creation.assembly_tests).toBeUndefined();
  expect(story.beats).toBeUndefined();
  expect(story.endings).toBeUndefined();
  expect(story.events).toBeUndefined();
  expect(story.scenes).toEqual([
    { id: "opening", title: "New scene" },
    { id: "vault", title: "Vault" },
  ]);
  expect(result.creation.fragments?.find((f) => f.id === "vault-fact")?.visibility).toEqual({
    scope: "story-scene",
    scene: "vault",
  });
  expect(result.notices).toContainEqual(
    expect.objectContaining({ code: "derive.scene_scope_retained" }),
  );
  const state = initStoryState(story, ["alice", "bob", "player"]);
  expect(state.vars).toEqual({ count: 3, inventory: ["coin", "key"] });
  expect(state.knowing["@new/continuation#secret"]).toEqual(["alice", "bob"]);
  expect(state.knowing["#other"]).toEqual([]);
  expect(state).toMatchObject({
    scene: "opening",
    visited: ["opening"],
    reached: [],
    ended: [],
    happened: [],
    stopped: false,
  });
  const built = compile(result.creation, original);
  if (built.artifact.kind !== "content") throw new Error("Expected content");
  expect(built.artifact.ir.participants).toHaveLength(4);
  expect(
    built.artifact.ir.graph.instances.filter((instance) => instance.ref === "@old/guard"),
  ).toHaveLength(2);
  expect(JSON.stringify(built.artifact.ir.bootstrap)).not.toContain("OLD");
  expect(built.artifact.meta.attribution).toContainEqual({
    ref: "@old/story",
    authors: scenario().authors,
  });
});

it("derivation dependencies require the complete exact identity while legacy bare ancestry remains display-only", () => {
  const base = scenario({
    provenance: { derived_from: [{ release: tid("rel", 99), relation: "import" }] },
  });
  expect(getCreationDependencies(base).filter((item) => item.domain === "derivation")).toEqual([]);
  for (const value of [
    { release: tid("rel", 99), relation: "remix", ref: "@old/source" },
    { release: tid("rel", 99), relation: "remix", semantic_digest: D("a") },
    { release: tid("rel", 99), relation: "sequel" },
  ])
    expect(
      CreationSchema.safeParse({ ...base, provenance: { derived_from: [value] } }).success,
    ).toBe(false);
});

it("preserves precise assembly configuration and retained Style scope without carrying old greetings or test sessions into a sequel", () => {
  const profile = {
    runtime: { name: "fixture", version: "1" },
    tokenizer: "estimate",
    context_window: 4096,
    reserve_for_output: 512,
    mode: "per-agent" as const,
    capabilities: { system_role: true, multiple_system_messages: true },
  };
  const engine = { name: "fixture", version: "1" };
  const assembly = {
    version: "1-draft" as const,
    preset: TEST_DEFAULT_PIN,
    profile,
    assembler: engine,
    tokenizer: engine,
  };
  const fixture = {
    id: "original",
    root: "self" as const,
    preset: TEST_DEFAULT_PIN,
    profile,
    session: { history: [{ role: "user" as const, text: "Exact\r\nCafe\u0301\t" }], bindings: {} },
    assembler: engine,
    tokenizer: engine,
    expected: { kind: "success" as const, messages_digest: D("a") },
  };
  const style = published(4, {
    id: tid("cr", 4),
    ref: "@old/style",
    type: "style",
    display_name: "Style",
    meta,
    fragments: [{ ...fragment("tone", "Only in the old vault."), kind: "style" }],
  });
  const definition = scenario({ assembly, assembly_tests: [fixture] });
  definition.references = [
    ...(definition.references ?? []),
    {
      id: "style",
      use: "@old/style",
      mode: "default",
      pin: {
        release: style.release,
        semantic_digest: canonicalizeCreation(style.creation).semantic_digest,
      },
      scope: { scene: "vault" },
    },
  ];
  const original = published(2, definition);
  const remix = deriveCreation({ kind: "remix", source: original, target });
  expect(remix.creation.assembly_tests).toEqual([fixture]);
  expect(remix.notices).toContainEqual(
    expect.objectContaining({ code: "derive.tests_require_review" }),
  );
  const sequel = deriveCreation({ kind: "sequel", source: original, target });
  expect(sequel.creation.assembly).toEqual(assembly);
  expect(sequel.creation.assembly_tests).toBeUndefined();
  expect(sequel.creation.references.find((edge) => edge.id === "style")?.scope).toEqual({
    scene: "vault",
  });
  expect(sequel.creation.story?.scenes.find((scene) => scene.id === "vault")).toEqual({
    id: "vault",
    title: "Vault",
  });
  expect(
    buildTestCreation({
      root: { release: tid("rel", 20), visibility: "public", creation: sequel.creation },
      dependencies: [character, style, original],
    }).artifact.kind,
  ).toBe("content");
});

it.each(["CC-BY-ND-4.0", "LicenseRef-All-Rights-Reserved"])(
  "rejects adapting %s using the existing license rules",
  (license) => {
    expect(() =>
      deriveCreation({ kind: "remix", source: source({ meta: { ...meta, license } }), target }),
    ).toThrow(/derive.license_not_allowed/);
  },
);

it("preserves unknown-license warnings and cannot bypass a source's no-derivatives rule by changing the new license", () => {
  const unknown = deriveCreation({
    kind: "remix",
    source: source({ meta: { ...meta, license: "LicenseRef-Custom" } }),
    target,
  });
  expect(unknown.license.verdict).toBe("warn");
  const original = source({ meta: { ...meta, license: "CC-BY-ND-4.0" } });
  const manual: CreationInput = {
    ...scenario(),
    ...target,
    meta: { ...meta, license: "CC0-1.0" },
    references: [],
    cast: [{ key: "player", who: { late: "persona" } }],
    story: { version: 1, scenes: [{ id: "new", title: "New" }] },
    fragments: [],
    provenance: {
      derived_from: [
        {
          ref: "@old/story",
          release: original.release,
          semantic_digest: canonicalizeCreation(original.creation).semantic_digest,
          relation: "remix",
        },
      ],
    },
  };
  expect(report(manual, original).issues).toContainEqual(
    expect.objectContaining({ code: "license.dependency_no_derivatives" }),
  );
});

it("source-only assets do not become downloadable artifact assets, while their license and rating still constrain the derivative", () => {
  const original = source({
    assets: [
      {
        slot: "private-photo",
        role: "presentation",
        variants: [
          {
            id: "default",
            media_type: "image/png",
            rating: "explicit",
            license: "CC-BY-NC-4.0",
            blob: { availability: "mirrored", digest: D("a"), size: 100 },
          },
        ],
      },
    ],
  });
  const derived = deriveCreation({ kind: "remix", source: original, target }).creation;
  derived.assets = [];
  const built = compile(derived, original);
  expect(built.artifact.assets).toEqual([]);
  expect(built.artifact.meta.rating).toBe("explicit");
  expect(built.artifact.meta.licenses).toContainEqual({
    ref: "@old/story",
    asset: "private-photo/default",
    license: "CC-BY-NC-4.0",
  });
});

it.each(["preset", "prompt-module"] as const)(
  "Remix locks a %s source without injecting its policy twice",
  (type) => {
    const policy = {
      version: "1-draft" as const,
      blocks: [{ id: "tone", default_at: "main" as const, text: "Be kind." }],
      ...(type === "preset"
        ? { layout: [...PRESET_REGIONS], requires: { system_role: true } }
        : {}),
    };
    const original = published(3, {
      id: tid("cr", 3),
      ref: "@old/policy",
      type,
      display_name: "Policy",
      meta,
      ...(type === "preset"
        ? { policy: { ...policy, layout: [...PRESET_REGIONS], requires: { system_role: true } } }
        : { prompt_module: policy }),
    });
    const derived = deriveCreation({ kind: "remix", source: original, target }).creation;
    const built = buildTestCreation({
      root: { release: tid("rel", 20), visibility: "public", creation: derived },
      dependencies: [original],
    });
    expect(built.lock).toContainEqual(expect.objectContaining({ ref: "@old/policy" }));
    expect(built.artifact.kind).toBe(type);
    if (built.artifact.kind === "preset")
      expect(built.artifact.preset.policy.blocks).toHaveLength(1);
    else if (built.artifact.kind === "prompt-module")
      expect(built.artifact.module.blocks).toHaveLength(1);
  },
);

describe("source integrity and closure", () => {
  it("rejects local identities, mismatched source digests, missing endings and unpinned dependencies", () => {
    expect(() =>
      deriveCreation({ kind: "remix", source: { ...source(), release: tid("dbld", 2) }, target }),
    ).toThrow(/schema.invalid/);
    expect(() =>
      deriveCreation({ kind: "sequel", source: source(), target, ending: "absent" }),
    ).toThrow(/derive.ending_missing/);
    expect(() =>
      deriveCreation({ kind: "remix", source: { ...source(), semantic_digest: D("f") }, target }),
    ).toThrow(/resolve.semantic_digest_mismatch/);
    expect(() =>
      deriveCreation({
        kind: "remix",
        source: source({
          references: [{ id: "guard", use: "#guard", mode: "default", pin: { follow: "latest" } }],
        }),
        target,
      }),
    ).toThrow(/resolve.unpinned/);
    expect(() =>
      deriveCreation({ kind: "remix", source: source(), target: { ...target, ref: "@old/story" } }),
    ).toThrow(/derive.new_identity_required/);
  });
  it("checks private, removed and missing source dependencies even though no source content is expanded", () => {
    const original = source();
    const derived = deriveCreation({ kind: "remix", source: original, target }).creation;
    expect(report(derived, { ...original, visibility: "private" }).issues).toContainEqual(
      expect.objectContaining({ code: "publish.public_depends_on_private" }),
    );
    expect(report(derived, { ...original, status: "tombstoned" }).issues).toContainEqual(
      expect.objectContaining({ code: "publish.tombstoned_dependency" }),
    );
    expect(() =>
      buildTestCreation({
        root: { release: tid("rel", 20), visibility: "public", creation: derived },
        dependencies: [character],
      }),
    ).toThrow(/resolve.release_missing/);
  });
});

it("upgrades a runtime dependency while retaining historical pins, metadata and exact-version license checks", () => {
  const old = published(1, {
    ...canonicalizeCreation(character.creation).creation,
    meta: { ...meta, license: "CC-BY-ND-4.0" },
    assets: [
      {
        slot: "portrait",
        role: "presentation",
        variants: [
          {
            id: "default",
            media_type: "image/png",
            rating: "mature",
            license: "CC-BY-4.0",
            blob: { digest: D("a"), size: 1, availability: "mirrored" },
          },
        ],
      },
    ],
  });
  const next = published(3, {
    ...canonicalizeCreation(character.creation).creation,
    meta: { ...meta, license: "CC0-1.0" },
    fragments: [{ ...fragment("identity", "NEW GUARD"), kind: "character" }],
    assets: [
      {
        slot: "portrait",
        role: "presentation",
        variants: [
          {
            id: "default",
            media_type: "image/png",
            license: "CC0-1.0",
            blob: { digest: D("b"), size: 1, availability: "mirrored" },
          },
        ],
      },
    ],
  });
  const original = source({
    references: [
      {
        id: "guard",
        use: "#guard",
        mode: "default",
        pin: {
          release: old.release,
          semantic_digest: canonicalizeCreation(old.creation).semantic_digest,
        },
      },
    ],
  });
  const creation = deriveCreation({ kind: "remix", source: original, target }).creation;
  const edge = creation.references[0];
  const member = creation.cast?.[0];
  if (!edge || !member) throw new Error("fixture role required");
  edge.pin = {
    release: next.release,
    semantic_digest: canonicalizeCreation(next.creation).semantic_digest,
  };
  member.override = [
    { op: "replace", target: "identity", content: { type: "text", text: "NEW NORTH GUARD" } },
  ];
  const root = { release: tid("rel", 20), visibility: "public" as const, creation };
  const dependencies = [original, old, next];
  const built = buildTestCreation({ root, dependencies });
  expect(buildTestCreation({ root, dependencies: [...dependencies].reverse() }).json).toBe(
    built.json,
  );
  expect(
    built.lock.filter((entry) => entry.ref === "@old/guard").map((entry) => entry.release),
  ).toEqual([old.release, next.release]);
  if (built.artifact.kind !== "content") throw new Error("content required");
  expect(built.artifact.ir.participants.filter((p) => p.ref === "@old/guard")).toHaveLength(2);
  expect(JSON.stringify(built.artifact.ir.fragments)).toContain("NEW GUARD");
  expect(JSON.stringify(built.artifact.ir.fragments)).not.toContain("A guard named");
  expect(built.artifact.assets.some((asset) => asset.digest === D("a"))).toBe(false);
  expect(built.artifact.assets.some((asset) => asset.digest === D("b"))).toBe(true);
  expect(built.artifact.meta.rating).toBe("mature");
  expect(built.artifact.meta.licenses).toContainEqual(
    expect.objectContaining({ ref: "@old/guard", license: "CC-BY-ND-4.0" }),
  );
  const publish = (deps: ReleaseInput[], blockedDigests = new Set<string>()) =>
    checkPublish(
      withTestDefault({
        ...root,
        label: "1.0.0",
        dependencies: deps,
        registry: {
          existingLabels: {},
          assetStatus: { [D("b")]: "ready" as const },
          blockedDigests,
          ownerNamespaces: new Set(["new"]),
        },
      }),
    );
  expect(publish(dependencies).issues.filter((issue) => issue.code.startsWith("license."))).toEqual(
    [],
  );
  expect(publish(dependencies, new Set([D("a")])).issues).toContainEqual(
    expect.objectContaining({ code: "publish.blocked_content" }),
  );
  expect(publish([original, { ...old, visibility: "private" }, next]).issues).toContainEqual(
    expect.objectContaining({ code: "publish.public_depends_on_private" }),
  );
  expect(publish([original, { ...old, status: "tombstoned" }, next]).issues).toContainEqual(
    expect.objectContaining({ code: "publish.tombstoned_dependency" }),
  );
});

it("revalidates a historical cached node when it later participates in a conflicting actual graph", () => {
  const next = published(3, {
    ...canonicalizeCreation(character.creation).creation,
    fragments: [{ ...fragment("identity", "NEW"), kind: "character" }],
  });
  const original = source();
  const holder = published(4, {
    id: tid("cr", 4),
    ref: "@old/history",
    type: "world",
    display_name: "History",
    meta,
    fragments: [{ ...fragment("setting", "Setting"), kind: "world" }],
    provenance: {
      derived_from: [
        {
          ref: "@old/story",
          release: original.release,
          semantic_digest: canonicalizeCreation(original.creation).semantic_digest,
          relation: "remix",
        },
      ],
    },
  });
  const creation = deriveCreation({ kind: "remix", source: original, target }).creation;
  creation.references = [
    {
      id: "a-history",
      use: "@old/history",
      mode: "default",
      pin: {
        release: holder.release,
        semantic_digest: canonicalizeCreation(holder.creation).semantic_digest,
      },
    },
    ...creation.references,
    {
      id: "z-new",
      use: "@old/guard",
      mode: "default",
      pin: {
        release: next.release,
        semantic_digest: canonicalizeCreation(next.creation).semantic_digest,
      },
    },
  ];
  expect(() =>
    buildTestCreation({
      root: { release: tid("rel", 20), visibility: "public", creation },
      dependencies: [original, character, next, holder],
    }),
  ).toThrow(/resolve.diamond_conflict/);
});

describe("reviewed play situation to sequel", () => {
  const situation = () => ({
    scene: "vault",
    present: ["bob", "player"],
    vars: { count: 8, inventory: ["coin", "key"] },
    knowing: { "@old/story#secret": ["bob"], "#other": [] },
    opening: { en: "A reviewed new beginning for {{cast:bob}}.", ja: "新しい始まり。" },
  });

  it("preserves explicit player control in both authored and reviewed sequels", () => {
    const creation = scenario();
    if (!creation.story) throw new Error("expected Story");
    creation.story.player = "player";
    const original = published(2, creation);
    for (const from_play of [undefined, situation()]) {
      const result = deriveCreation({
        kind: "sequel",
        source: original,
        target,
        ...(from_play ? { from_play } : {}),
      });
      expect(result.creation.story?.player).toBe("player");
      expect(result.creation.cast?.find((member) => member.key === "player")?.role).toBe("user");
      expect(compile(result.creation, original).artifact.capabilities).toContainEqual({
        id: "story.player-control",
        experimental: true,
      });
    }
  });

  it("creates a clean editable opening without replaying prior starts, gates, or entry knowledge", () => {
    const original = source();
    const before = JSON.stringify(original);
    const result = deriveCreation({
      kind: "sequel",
      source: original,
      target,
      from_play: situation(),
    });
    const story = result.creation.story;
    if (!story) throw new Error("expected Story");
    const state = initStoryState(
      story,
      (result.creation.cast ?? []).map((member) => member.key),
    );
    expect(state).toEqual({
      start: "continuation",
      scene: "vault",
      present: ["bob", "player"],
      vars: { count: 8, inventory: ["coin", "key"] },
      knowing: { "@new/continuation#secret": ["bob"], "#other": [] },
      visited: ["vault"],
      reached: [],
      ended: [],
      happened: [],
      stopped: false,
    });
    expect(story.scenes[0]).toEqual({
      id: "vault",
      title: "Vault",
      cast: ["bob", "player"],
      opening: situation().opening,
    });
    expect(story.starts).toEqual([{ id: "continuation", scene: "vault" }]);
    expect(story.beats).toBeUndefined();
    expect(story.endings).toBeUndefined();
    expect(result.creation.bootstrap).toBeUndefined();
    expect(result.creation.assembly_tests).toBeUndefined();
    expect(result.creation.fragments.find((item) => item.id === "vault-fact")?.visibility).toEqual({
      scope: "story-scene",
      scene: "vault",
    });
    expect(JSON.stringify(original)).toBe(before);
    const built = compile(result.creation, original).artifact;
    expect(built.kind).toBe("content");
    if (built.kind !== "content") throw new Error("expected content");
    expect(Object.keys(built.story_refs?.participants ?? {})).toEqual(["alice", "bob", "player"]);
    expect(built.ir.participants).toHaveLength(4);
    expect(built.ir.participants.filter((item) => item.ref === "@old/guard")).toHaveLength(2);
    expect(built.story_refs?.templates["scene/vault/opening"]?.locales?.ja).toBe("新しい始まり。");
  });

  it.each([
    ["unknown scene", { scene: "missing" }],
    ["unknown participant", { present: ["outsider"] }],
    ["duplicate participant", { present: ["bob", "bob"] }],
    ["missing variable", { vars: { count: 8 } }],
    ["extra variable", { vars: { count: 8, inventory: [], extra: true } }],
    ["wrong typed value", { vars: { count: "8", inventory: [] } }],
    ["out of range", { vars: { count: 11, inventory: [] } }],
    ["unknown item", { vars: { count: 8, inventory: ["missing"] } }],
    ["missing knowledge", { knowing: { "#other": [] } }],
    ["unknown knowledge", { knowing: { "@old/story#secret": [], "#other": [], "#missing": [] } }],
    ["unknown knower", { knowing: { "@old/story#secret": ["outsider"], "#other": [] } }],
    ["duplicate knower", { knowing: { "@old/story#secret": ["bob", "bob"], "#other": [] } }],
    ["forbidden history", { history: [] }],
    ["forbidden stopped", { stopped: true }],
  ])("rejects %s instead of coercing the reviewed snapshot", (_label, patch) => {
    expect(() =>
      deriveCreation({
        kind: "sequel",
        source: source(),
        target,
        from_play: { ...situation(), ...patch } as ReturnType<typeof situation>,
      }),
    ).toThrow();
  });

  it("rejects remix and simultaneous static-ending seeding", () => {
    expect(() =>
      deriveCreation({ kind: "remix", source: source(), target, from_play: situation() }),
    ).toThrowError(/derive.invalid_continuation/);
    expect(() =>
      deriveCreation({
        kind: "sequel",
        source: source(),
        target,
        ending: "escape",
        from_play: situation(),
      }),
    ).toThrowError(/derive.invalid_continuation/);
  });

  it("preserves other scoped scenes without enabling their former plot or broadening visibility", () => {
    const working = scenario();
    if (!working.story || !working.fragments) throw new Error("expected editable Story");
    working.story.scenes.push({
      id: "garden",
      title: "Garden",
      when: { judge: "Do not run" },
      opening: "OLD GARDEN",
    });
    working.fragments.push({
      ...fragment("garden-fact", "Garden only"),
      visibility: { scope: "story-scene", scene: "garden" },
    });
    const original = published(2, working);
    const result = deriveCreation({
      kind: "sequel",
      source: original,
      target,
      from_play: situation(),
    });
    expect(result.creation.story?.scenes[1]).toEqual({ id: "garden", title: "Garden" });
    expect(result.creation.story?.scenes[0]?.lore).toBeUndefined();
    expect(compile(result.creation, original).artifact.kind).toBe("content");
  });
});
