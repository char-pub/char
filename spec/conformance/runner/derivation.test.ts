/** Exact derivative sources authorize the work without becoming a second runtime context. */

import {
  createPreparationCatalog,
  fixedSelection,
  prepareContext,
  sourceRequests,
  startSession,
} from "@char-pub/assembler";
import {
  buildCreation,
  type CreationInput,
  canonicalizeCreation,
  checkPublish,
  confirm,
  deriveCreation,
  initStoryState,
  PRESET_REGIONS,
  type ReleaseInput,
  sha256Hex,
} from "@char-pub/core";
import { expect, it } from "vitest";

const meta = {
  default_locale: "en",
  rating: "general",
  rights: "original",
  license: "CC0-1.0",
} as const;
const digest = `sha256:${"a".repeat(64)}`;
const target = { id: "cr_01j00000000000000000000004", ref: "@new/next" };
function release(n: number, creation: CreationInput): ReleaseInput {
  return {
    release: `rel_01j0000000000000000000000${n}`,
    visibility: "public",
    creation,
    semantic_digest: canonicalizeCreation(creation).semantic_digest,
  };
}
function fixtures() {
  const character = release(1, {
    id: "cr_01j00000000000000000000001",
    ref: "@prior/guard",
    type: "character",
    display_name: "Guard",
    meta,
    fragments: [
      {
        id: "identity",
        kind: "character",
        stable: true,
        content: { type: "text", text: "I guard the bridge." },
      },
    ],
  });
  const source = release(2, {
    id: "cr_01j00000000000000000000002",
    ref: "@prior/story",
    type: "scenario",
    display_name: "Prior",
    meta,
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
      { key: "north", who: "#guard" },
      { key: "south", who: "#guard" },
    ],
    fragments: [
      {
        id: "fact",
        kind: "knowledge",
        stable: true,
        content: { type: "text", text: "The bridge is open." },
      },
    ],
    assets: [
      {
        slot: "image",
        role: "presentation",
        variants: [
          {
            id: "default",
            media_type: "image/png",
            rating: "mature",
            blob: { digest, size: 3, availability: "mirrored" },
          },
        ],
      },
    ],
    bootstrap: { greetings: [{ id: "old", text: "OLD GREETING" }] },
    story: {
      version: 1,
      scenes: [{ id: "old", title: "Old", opening: "OLD OPENING" }],
      vars: { open: { type: "bool", init: false, description: "Gate opened" } },
      endings: [
        {
          id: "escape",
          title: "Escape",
          description: "Escaped",
          when: { judge: "Did the player escape?" },
          effects: [{ set: ["var/open", true] }],
        },
      ],
    },
  });
  const preset = release(3, {
    id: "cr_01j00000000000000000000003",
    ref: "@prior/preset",
    type: "preset",
    display_name: "Policy",
    meta,
    policy: {
      version: "1-draft",
      blocks: [],
      layout: [...PRESET_REGIONS],
      requires: { system_role: true },
    },
  });
  const default_policy = {
    ref: "@prior/preset",
    release: preset.release,
    semantic_digest: canonicalizeCreation(preset.creation).semantic_digest,
  };
  return { source, character, preset, default_policy };
}

it("derives a fresh Scenario with exact ancestry and two role instances, without prior Story progress or greetings", () => {
  const { source, character, preset, default_policy } = fixtures();
  const before = JSON.stringify(source);
  const prepared = deriveCreation({ kind: "sequel", source, target, ending: "escape" });
  expect(JSON.stringify(source)).toBe(before);
  expect(prepared.creation.provenance.derived_from).toContainEqual({
    ...prepared.source,
    relation: "sequel",
  });
  expect(prepared.creation.references[0]?.use).toBe("@prior/guard");
  if (!prepared.creation.story) throw new Error("Story required");
  const state = initStoryState(prepared.creation.story, ["north", "south"]);
  expect(state).toMatchObject({
    vars: { open: true },
    ended: [],
    reached: [],
    happened: [],
    stopped: false,
  });
  const { artifact } = buildCreation({
    root: {
      release: "rel_01j00000000000000000000004",
      visibility: "public",
      creation: prepared.creation,
    },
    dependencies: [source, character, preset],
    default_policy,
  });
  expect(artifact.lock).toContainEqual(
    expect.objectContaining({ ref: "@prior/story", release: source.release }),
  );
  if (artifact.kind !== "content") throw new Error("Content required");
  expect(artifact.ir.graph.instances.some((instance) => instance.ref === "@prior/story")).toBe(
    false,
  );
  expect(
    artifact.ir.participants.filter((participant) => participant.ref === "@prior/guard"),
  ).toHaveLength(2);
  expect(JSON.stringify(artifact.ir.bootstrap)).not.toContain("OLD");
  expect(artifact.story?.endings).toBeUndefined();
});

it("keeps source-only assets out of the consumable artifact but retains its rating and public/private publication constraints", () => {
  const { source, character, preset, default_policy } = fixtures();
  const prepared = deriveCreation({ kind: "remix", source, target });
  prepared.creation.assets = [];
  const root = {
    release: "rel_01j00000000000000000000004",
    visibility: "public" as const,
    creation: prepared.creation,
  };
  const result = buildCreation({ root, dependencies: [source, character, preset], default_policy });
  expect(result.artifact.assets).toEqual([]);
  expect(result.artifact.meta.rating).toBe("mature");
  const report = checkPublish({
    ...root,
    label: "1.0.0",
    dependencies: [{ ...source, visibility: "private" }, character, preset],
    default_policy,
    registry: {
      existingLabels: {},
      assetStatus: {},
      blockedDigests: new Set(),
      ownerNamespaces: new Set(["new"]),
    },
  });
  expect(report.ok).toBe(false);
  expect(report.issues).toContainEqual(
    expect.objectContaining({ code: "publish.public_depends_on_private" }),
  );
  expect(() => buildCreation({ root, dependencies: [character, preset], default_policy })).toThrow(
    /resolve.release_missing/,
  );
});

it("rejects untrusted source digests, non-release identities and prohibited adaptations", () => {
  const { source } = fixtures();
  expect(() =>
    deriveCreation({ kind: "remix", source: { ...source, semantic_digest: digest }, target }),
  ).toThrow(/resolve.semantic_digest_mismatch/);
  expect(() =>
    deriveCreation({
      kind: "remix",
      source: { ...source, release: "dbld_01j00000000000000000000002" },
      target,
    }),
  ).toThrow(/schema.invalid/);
  const forbidden = release(2, {
    ...canonicalizeCreation(source.creation).creation,
    meta: { ...meta, license: "CC-BY-ND-4.0" },
  });
  expect(() => deriveCreation({ kind: "sequel", source: forbidden, target })).toThrow(
    /derive.license_not_allowed/,
  );
});

const profile = {
  runtime: { name: "derivation-test", version: "1" },
  tokenizer: "estimate",
  context_window: 12000,
  reserve_for_output: 0,
  mode: "narrator" as const,
  capabilities: { system_role: true, multiple_system_messages: true },
};

it("keeps upgraded runtime content separate from its historical source closure", () => {
  const { source, character, preset, default_policy } = fixtures();
  const next = release(5, {
    ...canonicalizeCreation(character.creation).creation,
    fragments: [
      {
        id: "identity",
        kind: "character",
        stable: true,
        content: { type: "text", text: "NEW GUARD BODY" },
      },
    ],
  });
  const creation = deriveCreation({ kind: "remix", source, target }).creation;
  const edge = creation.references[0];
  if (!edge) throw new Error("fixture edge required");
  edge.pin = {
    release: next.release,
    semantic_digest: canonicalizeCreation(next.creation).semantic_digest,
  };
  const { artifact } = buildCreation({
    root: { release: "rel_01j00000000000000000000004", visibility: "public", creation },
    dependencies: [source, character, next, preset],
    default_policy,
  });
  expect(
    artifact.lock.filter((entry) => entry.ref === "@prior/guard").map((entry) => entry.release),
  ).toEqual([character.release, next.release]);
  const { turn } = startSession({
    artifact,
    bindings: { user: { kind: "persona", display_name: "Player" } },
  });
  const text = prepareContext({ artifact, profile, turn })
    .messages.map((message) => message.content)
    .join("\n");
  expect(text).toContain("NEW GUARD BODY");
  expect(text).not.toContain("I guard the bridge.");
});

it("preserves sequel background discovery without directly activating all groups, manual fragments or source bodies", () => {
  const { source: original, character, preset, default_policy } = fixtures();
  const text = "LONG SOURCE BODY: consult only when selected.\n";
  const source = release(2, {
    ...canonicalizeCreation(original.creation).creation,
    fragments: [
      {
        id: "always",
        kind: "knowledge",
        stable: true,
        activation: { mode: "always" },
        content: { type: "text", text: "ALWAYS BACKGROUND" },
      },
      {
        id: "manual",
        kind: "knowledge",
        stable: true,
        description: "Manual background",
        activation: { mode: "manual" },
        content: { type: "text", text: "MANUAL BODY" },
      },
      {
        id: "optional",
        kind: "knowledge",
        stable: true,
        description: "Routes through the bridge",
        activation: { mode: "semantic" },
        content: { type: "text", text: "OPTIONAL BODY" },
      },
    ],
    groups: [
      { id: "outer", title: "Background", description: "Background directory", groups: ["inner"] },
      {
        id: "inner",
        title: "Bridge",
        description: "Bridge directory",
        entries: ["manual", "optional"],
      },
    ],
    sources: [
      {
        id: "guide",
        title: "Guide",
        description: "Long-form bridge guide",
        asset: "guide",
        format: "text",
      },
    ],
    assets: [
      {
        slot: "guide",
        role: "context",
        variants: [
          {
            id: "default",
            media_type: "text/plain",
            blob: {
              digest: `sha256:${sha256Hex(text)}`,
              size: text.length,
              availability: "mirrored",
            },
          },
        ],
      },
    ],
  });
  const creation = deriveCreation({ kind: "sequel", source, target }).creation;
  expect(creation.story?.scenes[0]?.lore).toBeUndefined();
  const { artifact } = buildCreation({
    root: { release: "rel_01j00000000000000000000004", visibility: "public", creation },
    dependencies: [source, character, preset],
    default_policy,
  });
  if (artifact.kind !== "content") throw new Error("Content required");
  expect(artifact.catalog_index.groups).toHaveLength(2);
  expect(
    artifact.ir.fragments.find((fragment) => fragment.origin.fragment === "manual")?.activation
      .mode,
  ).toBe("manual");
  const { turn } = startSession({
    artifact,
    bindings: { user: { kind: "persona", display_name: "Player" } },
  });
  const input = { artifact, profile, turn };
  const catalog = createPreparationCatalog(input);
  expect(JSON.stringify(catalog.catalog.candidates)).toContain("Background directory");
  expect(JSON.stringify(catalog.catalog.candidates)).toContain("Long-form bridge guide");
  expect(
    catalog.catalog.direct.every(
      (ref) =>
        "fragment" in ref &&
        !ref.fragment.includes("#manual~") &&
        !ref.fragment.includes("#optional~"),
    ),
  ).toBe(true);
  const empty = { ...input, plan: fixedSelection(catalog, []) };
  expect(sourceRequests(empty)).toEqual([]);
  const messages = prepareContext(empty)
    .messages.map((message) => message.content)
    .join("\n");
  expect(messages).toContain("ALWAYS BACKGROUND");
  expect(messages).not.toContain("MANUAL BODY");
  expect(messages).not.toContain("OPTIONAL BODY");
  expect(messages).not.toContain("LONG SOURCE BODY");
  const guide = artifact.catalog_index.sources[0];
  const optional = artifact.ir.fragments.find(
    (fragment) => fragment.origin.fragment === "optional",
  );
  if (!guide || !optional) throw new Error("fixture catalog entries required");
  const selected = {
    ...input,
    plan: fixedSelection(catalog, [{ source: guide.id }, { fragment: optional.id }]),
  };
  expect(sourceRequests(selected)).toHaveLength(1);
  const chosen = prepareContext({ ...selected, source_texts: { [guide.asset]: text } })
    .messages.map((message) => message.content)
    .join("\n");
  expect(chosen).toContain("LONG SOURCE BODY");
  expect(chosen).toContain("OPTIONAL BODY");
  expect(chosen).not.toContain("MANUAL BODY");
});

it("starts a reviewed sequel after a stopped run without replaying old initialization or importing progress", () => {
  const { source: original, character, preset, default_policy } = fixtures();
  const creation = canonicalizeCreation(original.creation).creation;
  if (!creation.story) throw new Error("Story required");
  const prior = creation.story;
  prior.vars = { count: { type: "int", init: 0, min: 0, max: 20, description: "Counter" } };
  prior.starts = [{ id: "old-start", scene: "old", set: [{ add: ["var/count", 5] }] }];
  prior.knowing = { "#fact": { start: { knows: [] }, enter: { old: { knows: ["north"] } } } };
  prior.endings = [
    { id: "escape", title: "Escape", description: "Stopped", effects: [{ add: ["var/count", 2] }] },
  ];
  const originalState = initStoryState(prior, ["north", "south"]);
  const stopped = confirm(prior, ["north", "south"], originalState, "ending/escape");
  expect(stopped.stopped).toBe(true);
  expect(stopped.vars.count).toBe(7);
  // The user reviews a new presence/knowledge situation; it is not represented as past gameplay.
  const source = release(2, creation);
  const prepared = deriveCreation({
    kind: "sequel",
    source,
    target,
    from_play: {
      scene: stopped.scene,
      present: ["south"],
      vars: stopped.vars,
      knowing: { "#fact": ["south"] },
      opening: "REVIEWED NEW SCENE",
    },
  });
  const { artifact } = buildCreation({
    root: {
      release: "rel_01j00000000000000000000004",
      visibility: "public",
      creation: prepared.creation,
    },
    dependencies: [source, character, preset],
    default_policy,
  });
  if (artifact.kind !== "content" || !artifact.story) throw new Error("Content Story required");
  const initial = initStoryState(artifact.story, ["north", "south"]);
  expect(initial.vars.count).toBe(7);
  expect(initial.knowing).toEqual({ "#fact": ["south"] });
  expect(initial.present).toEqual(["south"]);
  expect(initial).toMatchObject({
    visited: ["old"],
    reached: [],
    ended: [],
    happened: [],
    stopped: false,
  });
  const { turn, opening } = startSession({
    artifact,
    bindings: { user: { kind: "persona", display_name: "New player" } },
  });
  expect(opening).toBeNull();
  expect(turn.history).toEqual([]);
  const text = prepareContext({ artifact, profile, turn })
    .messages.map((message) => message.content)
    .join("\n");
  expect(text).toContain("REVIEWED NEW SCENE");
  expect(text).not.toContain("OLD GREETING");
  expect(text).not.toContain("OLD OPENING");
  expect(artifact.ir.participants.filter((item) => item.ref === "@prior/guard")).toHaveLength(2);
});
