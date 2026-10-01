import { describe, expect, it } from "vitest";
import { canonicalizeCreation } from "../src/canonical.js";
import { resolveCatalogReference } from "../src/catalog-index.js";
import type { CreationInput } from "../src/schema/creation.js";
import { buildTestCreation } from "./build.js";
import { D, level0Character, tid } from "./fixtures.js";

function fixture() {
  const lore = level0Character({
    id: tid("cr", 51),
    ref: "@djj/inn-lore",
    type: "lorebook",
    display_name: "Inn lore",
    fragments: [
      {
        id: "door",
        stable: true,
        kind: "knowledge",
        description: "Doors and exits",
        activation: { mode: "semantic" },
        content: { type: "text", text: "Back door opens on the river." },
        source: { use: "#handbook/inn" },
      },
      {
        id: "cellar",
        stable: true,
        kind: "knowledge",
        content: { type: "text", text: "The cellar is locked." },
      },
    ],
    bootstrap: undefined,
    groups: [
      { id: "building", title: "Building", description: "Layout and exits", groups: ["doors"] },
      { id: "doors", title: "Doors", description: "Exit details", entries: ["door"] },
    ],
    sources: [
      {
        id: "handbook",
        title: "Handbook",
        description: "Inn plans",
        asset: "handbook",
        format: "markdown",
        visibility: { scope: "shared" },
        sections: [{ id: "inn", title: "Inn", anchor: "#Inn" }],
      },
    ],
    assets: [
      {
        slot: "handbook",
        role: "context",
        variants: [
          {
            id: "default",
            media_type: "text/markdown",
            blob: { digest: D("b"), size: 100, availability: "mirrored" },
          },
        ],
      },
    ],
  });
  const dependency = {
    creation: lore,
    release: tid("rel", 51),
    semantic_digest: canonicalizeCreation(lore).semantic_digest,
    visibility: "public" as const,
  };
  const root: CreationInput = {
    id: tid("cr", 52),
    ref: "@djj/inn",
    type: "scenario",
    display_name: "Inn",
    meta: lore.meta,
    cast: [{ key: "guest", who: { late: "persona" } }],
    references: [
      {
        id: "lore",
        use: "@djj/inn-lore",
        mode: "default",
        pin: { release: dependency.release, semantic_digest: dependency.semantic_digest },
      },
    ],
    story: {
      version: 1,
      scenes: [
        {
          id: "lobby",
          title: "Lobby",
          lore: ["@djj/inn-lore#building", "@djj/inn-lore#handbook/inn"],
        },
      ],
    },
  };
  return {
    root,
    dependency,
    input: {
      root: { creation: root, release: tid("rel", 52), visibility: "public" as const },
      dependencies: [dependency],
    },
  };
}

describe("published catalog index", () => {
  it("cannot repair a dependency's undeclared source reference by adding a sibling", () => {
    const { input, root, dependency } = fixture();
    const quoting: CreationInput = {
      id: tid("cr", 71),
      ref: "@djj/quotes",
      type: "lorebook",
      display_name: "Quotes",
      meta: root.meta,
      fragments: [
        {
          id: "quote",
          stable: true,
          kind: "knowledge",
          content: { type: "text", text: "Quoted" },
          source: { use: "@djj/inn-lore#handbook/inn" },
        },
      ],
    };
    const quoteRelease = {
      creation: quoting,
      release: tid("rel", 71),
      visibility: "public" as const,
    };
    const missing = expect.objectContaining({ code: "story.information_missing" });
    expect(() =>
      buildTestCreation({ root: quoteRelease, dependencies: [dependency] }),
    ).toThrowError(missing);
    const quoteEdge = {
      id: "quotes",
      use: quoting.ref,
      mode: "default" as const,
      pin: {
        release: quoteRelease.release,
        semantic_digest: canonicalizeCreation(quoting).semantic_digest,
      },
    };
    root.references = [...(root.references ?? []), quoteEdge];
    input.dependencies.push({ ...quoteRelease, semantic_digest: quoteEdge.pin.semantic_digest });
    expect(() => buildTestCreation(input)).toThrowError(missing);

    quoting.references = [
      {
        id: "lore",
        use: dependency.creation.ref,
        mode: "default",
        pin: { release: dependency.release, semantic_digest: dependency.semantic_digest },
      },
    ];
    quoteEdge.pin.semantic_digest = canonicalizeCreation(quoting).semantic_digest;
    input.dependencies[1] = { ...quoteRelease, semantic_digest: quoteEdge.pin.semantic_digest };
    expect(
      buildTestCreation({ root: quoteRelease, dependencies: [dependency] }).artifact.kind,
    ).toBe("content");
    // The root now sees two genuinely different lore instances; keep its own Story unambiguous.
    root.story = undefined;
    const { artifact } = buildTestCreation(input);
    if (artifact.kind !== "content") throw new Error("Wrong artifact");
    const quote = artifact.ir.fragments.find((f) => f.origin.creation === quoting.ref);
    if (!quote) throw new Error("Missing quote");
    const resolved = resolveCatalogReference(
      "@djj/inn-lore#handbook/inn",
      artifact.ir,
      artifact.catalog_index,
      quote.origin.instance_key,
      "source",
    );
    const targetInstance = artifact.ir.graph.edges.find(
      (e) => e.from_instance === quote.origin.instance_key,
    )?.to_instance;
    const targetWork = artifact.catalog_index.works.find(
      (work) => work.instance === targetInstance,
    );
    expect(targetWork).toBeDefined();
    expect(resolved).toEqual({
      source: artifact.catalog_index.sources.find((s) => s.owner === targetWork?.id)?.id,
      section: "inn",
    });
    expect(() =>
      resolveCatalogReference("@djj/inn-lore#handbook/inn", artifact.ir, artifact.catalog_index),
    ).toThrowError(expect.objectContaining({ code: "story.ambiguous_information" }));
  });

  it.each(["#handbook/inn", "@djj/inn-lore#handbook/inn"])(
    "resolves %s independently inside repeated copies of a dependency",
    (ref) => {
      const { input, root, dependency } = fixture();
      const door = dependency.creation.fragments?.[0];
      if (!door) throw new Error("Missing door");
      door.source = { use: ref };
      dependency.semantic_digest = canonicalizeCreation(dependency.creation).semantic_digest;
      root.story = undefined;
      root.references = ["left", "right"].map((id) => ({
        id,
        use: dependency.creation.ref,
        mode: "default",
        pin: { release: dependency.release, semantic_digest: dependency.semantic_digest },
      }));
      const { artifact } = buildTestCreation(input);
      if (artifact.kind !== "content") throw new Error("Wrong artifact");
      const doors = artifact.ir.fragments.filter((f) => f.origin.fragment === "door");
      expect(doors).toHaveLength(2);
      const targets = doors.map((fragment) => {
        const resolved = resolveCatalogReference(
          ref,
          artifact.ir,
          artifact.catalog_index,
          fragment.origin.instance_key,
          "source",
        );
        const own = artifact.catalog_index.sources.find(
          (s) => s.owner === `${fragment.origin.creation}~${fragment.origin.instance_key}`,
        );
        expect(resolved).toEqual({ source: own?.id, section: "inn" });
        return resolved;
      });
      expect(targets[0]).not.toEqual(targets[1]);
    },
  );

  it("checks references on surviving fragments without reviving selected-out content", () => {
    const { input, root, dependency } = fixture();
    const door = dependency.creation.fragments?.[0];
    const edge = root.references?.[0];
    if (!door || !edge) throw new Error("Missing fixture");
    door.source = { use: "@outside/book#missing" };
    dependency.semantic_digest = canonicalizeCreation(dependency.creation).semantic_digest;
    edge.pin = { release: dependency.release, semantic_digest: dependency.semantic_digest };
    edge.select = { exclude: ["door"] };
    const { artifact } = buildTestCreation(input);
    if (artifact.kind !== "content") throw new Error("Wrong artifact");
    expect(artifact.ir.fragments.some((f) => f.origin.fragment === "door")).toBe(false);
    edge.select = { include: ["door"] };
    expect(() => buildTestCreation(input)).toThrowError(
      expect.objectContaining({ code: "story.information_missing" }),
    );
  });

  it("publishes nested groups and locked source assets with exact scene associations", () => {
    const { input } = fixture();
    const { artifact, json } = buildTestCreation(input);
    if (artifact.kind !== "content") throw new Error("Wrong artifact");
    const index = artifact.catalog_index;
    const work = index.works.find((w) => w.ref === "@djj/inn-lore");
    const building = index.groups.find((g) => g.local_id === "building");
    const doors = index.groups.find((g) => g.local_id === "doors");
    const source = index.sources[0];
    expect(work?.groups).toEqual([building?.id]);
    expect(building?.groups).toEqual([doors?.id]);
    expect(doors?.entries).toEqual([
      artifact.ir.fragments.find((f) => f.origin.fragment === "door")?.id,
    ]);
    expect(work?.fragments).toEqual([
      artifact.ir.fragments.find((f) => f.origin.fragment === "cellar")?.id,
    ]);
    expect(artifact.assets.find((a) => a.id === source?.asset)?.digest).toBe(D("b"));
    expect(artifact.story_refs?.content["@djj/inn-lore#building"]).toEqual({ group: building?.id });
    expect(artifact.story_refs?.content["@djj/inn-lore#handbook/inn"]).toEqual({
      source: source?.id,
      section: "inn",
    });
    expect(buildTestCreation(input).json).toBe(json);
  });

  it("does not allow source sections to masquerade as knowing-controlled information", () => {
    const { input, root } = fixture();
    if (!root.story) throw new Error("Missing story");
    root.story.knowing = { "@djj/inn-lore#handbook/inn": { start: { knows: ["guest"] } } };
    expect(() => buildTestCreation(input)).toThrowError(
      expect.objectContaining({ code: "story.information_missing" }),
    );
  });

  it("rejects missing sections and unpinned out-of-closure source citations", () => {
    const { input, root, dependency } = fixture();
    const scene = root.story?.scenes[0];
    if (!scene) throw new Error("Missing scene");
    scene.lore = ["@djj/inn-lore#handbook/missing"];
    expect(() => buildTestCreation(input)).toThrowError(
      expect.objectContaining({ code: "story.information_missing" }),
    );
    scene.lore = [];
    const sourceFragment = dependency.creation.fragments?.[0];
    if (!sourceFragment) throw new Error("Missing fragment");
    sourceFragment.source = { use: "@elsewhere/private#book/intro" };
    dependency.semantic_digest = canonicalizeCreation(dependency.creation).semantic_digest;
    const reference = root.references?.[0];
    if (!reference) throw new Error("Missing reference");
    reference.pin = { release: dependency.release, semantic_digest: dependency.semantic_digest };
    expect(() => buildTestCreation(input)).toThrowError(
      expect.objectContaining({ code: "story.information_missing" }),
    );
  });

  it("resolves cast information even when character fragments were selected out", () => {
    const guard = level0Character({
      assets: [],
      fragments: [
        {
          id: "identity",
          stable: true,
          kind: "character",
          content: { type: "text", text: "Guard" },
        },
        {
          id: "secret",
          stable: true,
          kind: "knowledge",
          content: { type: "text", text: "Secret" },
        },
      ],
    });
    const dep = {
      creation: guard,
      release: tid("rel", 61),
      semantic_digest: canonicalizeCreation(guard).semantic_digest,
      visibility: "public" as const,
    };
    const root: CreationInput = {
      id: tid("cr", 62),
      ref: "@djj/guards",
      type: "scenario",
      display_name: "Guards",
      meta: guard.meta,
      cast: [
        { key: "front", who: guard.ref },
        { key: "back", who: guard.ref },
      ],
      references: [
        {
          id: "guard",
          use: guard.ref,
          mode: "default",
          pin: { release: dep.release, semantic_digest: dep.semantic_digest },
          select: { include: ["secret"] },
        },
      ],
    };
    const { artifact } = buildTestCreation({
      root: { creation: root, release: tid("rel", 62), visibility: "public" },
      dependencies: [dep],
    });
    if (artifact.kind !== "content") throw new Error("Wrong artifact");
    const ref = resolveCatalogReference("cast:back#secret", artifact.ir, artifact.catalog_index);
    expect(ref).toEqual({ fragment: artifact.ir.fragments.find((f) => f.instance === "back")?.id });
  });
});
