import { expect, it } from "vitest";
import { canonicalizeCreation } from "../src/canonical.js";
import { publishedObjectUses, removedCreationObjects } from "../src/reference-impact.js";
import type { CreationInput } from "../src/schema/creation.js";
import { buildTestCreation, TEST_DEFAULT_PIN, TEST_DEFAULT_POLICY } from "./build.js";
import { level0Character, tid } from "./fixtures.js";

const fragment = (id: string) => ({
  id,
  stable: true,
  kind: "knowledge" as const,
  content: { type: "text" as const, text: `Body ${id}` },
});
const release = (creation: CreationInput, n: number) => ({
  creation,
  release: tid("rel", n),
  visibility: "public" as const,
  semantic_digest: canonicalizeCreation(creation).semantic_digest,
});
const exact = (r: ReturnType<typeof release>) => ({
  ref: r.creation.ref,
  release: r.release,
  semantic_digest: r.semantic_digest,
});
const definition = (r: ReturnType<typeof release>) => ({
  identity: exact(r),
  creation: canonicalizeCreation(r.creation).creation,
});
const policyDefinition = {
  identity: TEST_DEFAULT_PIN,
  creation: canonicalizeCreation(TEST_DEFAULT_POLICY.creation).creation,
};
const edge = (r: ReturnType<typeof release>, id = "dep") => ({
  id,
  use: r.creation.ref,
  mode: "default" as const,
  pin: { release: r.release, semantic_digest: r.semantic_digest },
});
const work = (n: number, extra: Partial<CreationInput> = {}) =>
  level0Character({
    id: tid("cr", n),
    ref: `@impact/work-${n}`,
    assets: [],
    fragments: [{ ...fragment("description"), kind: "character" }],
    bootstrap: { greetings: [{ id: "default", text: "Hello" }] },
    meta: { default_locale: "en", rating: "general", license: "CC0-1.0", rights: "original" },
    ...extra,
    ...(extra.fragments
      ? {
          fragments: extra.fragments.map((item) => ({
            ...item,
            kind:
              !extra.type || extra.type === "character"
                ? "character"
                : extra.type === "world"
                  ? "world"
                  : item.kind,
          })),
        }
      : {}),
  });

it("reports IDs removed across groups, sections and Story; renamed address is the same work", () => {
  const before = canonicalizeCreation(
    work(700, {
      type: "scenario",
      cast: [{ key: "user", who: { late: "persona" } }],
      fragments: [fragment("old")],
      groups: [{ id: "places", title: "Places", description: "Places", entries: ["old"] }],
      story: {
        version: 1,
        scenes: [{ id: "hall", title: "Hall" }],
        endings: [{ id: "exit", title: "Exit", description: "Done" }],
      },
    }),
  ).creation;
  const after = canonicalizeCreation({
    ...before,
    ref: "@impact/new-address",
    fragments: [fragment("new")],
    groups: [],
    story: { version: 1, scenes: [{ id: "hall", title: "Hall" }] },
  }).creation;
  expect(removedCreationObjects(before, after)).toEqual([
    { kind: "ending", id: "exit" },
    { kind: "fragment", id: "old" },
    { kind: "group", id: "places" },
  ]);
});

it("distinguishes actual included fragments from explicit exclusion/override and never scans prose", () => {
  const source = release(
    work(701, { fragments: [fragment("keep"), fragment("removed"), fragment("excluded")] }),
    701,
  );
  const root = release(
    work(702, {
      fragments: [
        {
          ...fragment("own"),
          content: { type: "text", text: "removed excluded keep are prose, not references" },
        },
      ],
      references: [
        {
          ...edge(source),
          select: { exclude: ["excluded"] },
          override: [{ op: "remove", target: "removed" }],
        },
      ],
    }),
    702,
  );
  const { artifact } = buildTestCreation({ root, dependencies: [source] });
  if (!("release" in artifact.root)) throw new Error("Expected published root");
  const uses = publishedObjectUses({
    artifact: { ...artifact, root: artifact.root },
    target: exact(source),
    definitions: [policyDefinition, definition(root), definition(source)],
    objects: ["keep", "removed", "excluded"].map((id) => ({ kind: "fragment", id })),
  });
  expect(uses.filter((x) => x.kind === "included").map((x) => x.object.id)).toEqual(["keep"]);
  expect(uses.filter((x) => x.kind === "explicit")).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        object: { kind: "fragment", id: "removed" },
        path: "references[dep].override[0].target",
        defined_in: exact(root),
      }),
      expect.objectContaining({
        object: { kind: "fragment", id: "excluded" },
        path: "references[dep].select.exclude[0]",
      }),
    ]),
  );
  expect(uses.some((x) => x.path.includes("own"))).toBe(false);
});

it("uses resolved indirect cast ownership and about links, not a same-name sibling", () => {
  const actor = release(work(703, { fragments: [fragment("secret"), fragment("keep")] }), 703);
  const world = release(
    work(704, { type: "world", fragments: [fragment("world")], references: [edge(actor)] }),
    704,
  );
  const root = release(
    work(705, {
      type: "scenario",
      references: [edge(world)],
      cast: [
        { key: "guard", who: actor.creation.ref, override: [{ op: "remove", target: "secret" }] },
      ],
      fragments: [{ ...fragment("clue"), about: ["cast:guard#keep"] }],
    }),
    705,
  );
  const { artifact } = buildTestCreation({ root, dependencies: [world, actor] });
  if (!("release" in artifact.root)) throw new Error("Expected published root");
  const uses = publishedObjectUses({
    artifact: { ...artifact, root: artifact.root },
    target: exact(actor),
    definitions: [policyDefinition, ...[root, world, actor].map(definition)],
    objects: [
      { kind: "fragment", id: "secret" },
      { kind: "fragment", id: "keep" },
    ],
  });
  expect(uses).toContainEqual(
    expect.objectContaining({
      object: { kind: "fragment", id: "secret" },
      kind: "explicit",
      path: "cast[guard].override[0].target",
      defined_in: exact(root),
    }),
  );
  expect(uses).toContainEqual(
    expect.objectContaining({
      object: { kind: "fragment", id: "keep" },
      kind: "explicit",
      path: "fragments[clue].about",
    }),
  );
});

it("does not attribute a current artifact's same-ID fragment to a historical derivation pin", () => {
  const old = release(work(706, { fragments: [fragment("same")] }), 706);
  const newer = release(
    {
      ...old.creation,
      fragments: [
        { ...fragment("same"), kind: "character", content: { type: "text", text: "New body" } },
      ],
    },
    707,
  );
  const source = release(work(708, { references: [edge(old)] }), 708);
  const root = release(
    work(709, {
      references: [edge(newer)],
      provenance: { derived_from: [{ ...exact(source), relation: "remix" }] },
    }),
    709,
  );
  const { artifact } = buildTestCreation({ root, dependencies: [source, old, newer] });
  if (!("release" in artifact.root)) throw new Error("Expected published root");
  const common = {
    artifact: { ...artifact, root: artifact.root },
    definitions: [policyDefinition, ...[root, source, old, newer].map(definition)],
    objects: [{ kind: "fragment" as const, id: "same" }],
  };
  expect(publishedObjectUses({ ...common, target: exact(old) })).toEqual([]);
  expect(publishedObjectUses({ ...common, target: exact(newer) })).toContainEqual(
    expect.objectContaining({ kind: "included" }),
  );
});

it("reports source sections and group inclusion plus exact Story associations without loading Source bytes", () => {
  const source = release(
    work(710, {
      type: "lorebook",
      bootstrap: undefined,
      fragments: [fragment("fact")],
      groups: [{ id: "places", title: "Places", description: "Locations", entries: ["fact"] }],
      sources: [
        {
          id: "guide",
          title: "Guide",
          description: "Guide description",
          asset: "guide",
          format: "text",
          sections: [{ id: "intro", title: "Intro", anchor: "L1-L1" }],
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
              blob: { digest: `sha256:${"a".repeat(64)}`, size: 20, availability: "mirrored" },
            },
          ],
        },
      ],
    }),
    710,
  );
  const root = release(
    work(711, {
      type: "scenario",
      bootstrap: undefined,
      cast: [{ key: "user", who: { late: "persona" } }],
      references: [edge(source)],
      story: {
        version: 1,
        scenes: [
          {
            id: "hall",
            title: "Hall",
            lore: [
              `${source.creation.ref}#source/guide/intro`,
              `${source.creation.ref}#group/places`,
            ],
          },
        ],
      },
    }),
    711,
  );
  const { artifact } = buildTestCreation({ root, dependencies: [source] });
  if (!("release" in artifact.root)) throw new Error("Expected published root");
  const uses = publishedObjectUses({
    artifact: { ...artifact, root: artifact.root },
    target: exact(source),
    definitions: [policyDefinition, ...[root, source].map(definition)],
    objects: [
      { kind: "source", id: "guide" },
      { kind: "section", id: "intro", parent: "guide" },
      { kind: "group", id: "places" },
    ],
  });
  expect(uses.filter((item) => item.kind === "included")).toHaveLength(3);
  expect(uses).toContainEqual(
    expect.objectContaining({
      object: { kind: "section", id: "intro", parent: "guide" },
      kind: "explicit",
      path: "story.scenes[hall].lore[0]",
    }),
  );
  expect(uses).toContainEqual(
    expect.objectContaining({
      object: { kind: "group", id: "places" },
      kind: "explicit",
      path: "story.scenes[hall].lore[1]",
    }),
  );
});

it("only counts local Story IDs through a fixture's exact external root, never unrelated same IDs", () => {
  const source = release(
    work(712, {
      type: "scenario",
      cast: [{ key: "user", who: { late: "persona" } }],
      story: {
        version: 1,
        scenes: [{ id: "hall", title: "Hall" }],
        endings: [{ id: "exit", title: "Exit", description: "Exit" }],
      },
    }),
    712,
  );
  const root = release(
    work(713, {
      assembly_tests: [
        {
          id: "external",
          root: exact(source),
          profile: {
            runtime: { name: "test", version: "1" },
            tokenizer: "estimate",
            context_window: 4000,
            reserve_for_output: 0,
            mode: "narrator",
            capabilities: {},
          },
          session: { scene: "hall", history: [] },
          selection: [{ story: "ending", id: "exit" }],
          assembler: { name: "test", version: "1" },
          tokenizer: { name: "estimate", version: "1" },
          expected: { kind: "error", code: "test" },
        },
      ],
    }),
    713,
  );
  const { artifact } = buildTestCreation({ root, dependencies: [source] });
  if (!("release" in artifact.root)) throw new Error("Expected published root");
  const uses = publishedObjectUses({
    artifact: { ...artifact, root: artifact.root },
    target: exact(source),
    definitions: [policyDefinition, ...[root, source].map(definition)],
    objects: [
      { kind: "scene", id: "hall" },
      { kind: "ending", id: "exit" },
    ],
  });
  expect(uses.map((item) => [item.kind, item.path])).toEqual([
    ["explicit", "assembly_tests[external].selection[0]"],
    ["explicit", "assembly_tests[external].session.scene"],
  ]);
  expect(
    publishedObjectUses({
      artifact: { ...artifact, root: artifact.root },
      target: { ...exact(source), release: tid("rel", 714) },
      definitions: [policyDefinition, ...[root, source].map(definition)],
      objects: [{ kind: "scene", id: "hall" }],
    }),
  ).toEqual([]);
});
