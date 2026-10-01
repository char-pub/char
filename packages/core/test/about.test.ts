import { describe, expect, it } from "vitest";
import { canonicalizeCreation } from "../src/canonical.js";
import { resolveAboutReference } from "../src/catalog-index.js";
import type { CreationInput } from "../src/schema/creation.js";
import { buildTestCreation } from "./build.js";
import { level0Character, tid } from "./fixtures.js";

type FragmentInput = NonNullable<CreationInput["fragments"]>[number];

const fragment = (id: string, about?: string[]): FragmentInput => ({
  id,
  stable: true,
  kind: "knowledge",
  content: { type: "text", text: id },
  ...(about ? { about } : {}),
});
const work = (
  n: number,
  type: CreationInput["type"],
  fragments: FragmentInput[],
): CreationInput => ({
  id: tid("cr", n),
  ref: `@test/work-${n}`,
  display_name: `Work ${n}`,
  type,
  meta: level0Character().meta,
  fragments: fragments.map((item) => ({
    ...item,
    kind: type === "character" || type === "world" ? type : item.kind,
  })),
});
function release(creation: CreationInput, n: number) {
  return {
    creation,
    release: tid("rel", n),
    visibility: "public" as const,
    semantic_digest: canonicalizeCreation(creation).semantic_digest,
  };
}
const edge = (dep: ReturnType<typeof release>, id = "dep") => ({
  id,
  use: dep.creation.ref,
  mode: "default" as const,
  pin: { release: dep.release, semantic_digest: dep.semantic_digest },
});

describe("compiled about associations", () => {
  it("retains authored links and resolves local fragments, works and cast participants", () => {
    const character = release(work(301, "character", [fragment("secret")]), 301);
    const creation = work(302, "scenario", [
      fragment("clue", [
        "#place",
        "cast:guard",
        "cast:player",
        "cast:guard#secret",
        character.creation.ref,
      ]),
      fragment("place"),
    ]);
    creation.cast = [
      { key: "guard", who: character.creation.ref },
      { key: "player", who: { late: "persona" } },
    ];
    creation.references = [edge(character)];
    const { artifact } = buildTestCreation({
      root: release(creation, 302),
      dependencies: [character],
    });
    if (artifact.kind !== "content") throw new Error("Wrong artifact");
    const clue = artifact.ir.fragments.find((f) => f.origin.fragment === "clue");
    const place = artifact.ir.fragments.find((f) => f.origin.fragment === "place");
    const secret = artifact.ir.fragments.find((f) => f.origin.fragment === "secret");
    const links = artifact.catalog_index.about;
    expect(artifact.capabilities).toContainEqual({ id: "catalog.v1" });
    expect(links?.map((link) => link.ref)).toEqual(clue?.about);
    expect(links?.every((link) => link.from === clue?.id)).toBe(true);
    expect(links?.map((link) => link.target)).toEqual([
      { fragment: place?.id },
      { participant: artifact.ir.participants.find((p) => p.cast_key === "guard")?.key },
      { participant: artifact.ir.participants.find((p) => p.cast_key === "player")?.key },
      { fragment: secret?.id },
      { work: artifact.catalog_index.works.find((w) => w.ref === character.creation.ref)?.id },
    ]);
  });

  it.each([
    "#missing",
    "@outside/absent#secret",
    "cast:missing",
    "@outside/absent",
    "untyped-name",
  ])("rejects unresolved target %s at build time", (ref) => {
    const root = work(303, "lorebook", [fragment("clue", [ref])]);
    expect(() => buildTestCreation({ root: release(root, 303) })).toThrowError(
      expect.objectContaining({
        code:
          ref.startsWith("#") || ref.startsWith("cast:")
            ? "check.local_reference"
            : ref.includes("#")
              ? "story.information_missing"
              : "catalog.about_missing",
      }),
    );
  });

  it("does not treat a group or source as a fragment association", () => {
    const creation = work(304, "lorebook", [fragment("clue", ["#group/places"])]);
    creation.groups = [{ id: "places", title: "Places", description: "Places", entries: ["clue"] }];
    expect(() => buildTestCreation({ root: release(creation, 304) })).toThrowError(
      expect.objectContaining({ code: "check.local_reference" }),
    );
  });

  it("does not borrow a sibling work to complete an undeclared association", () => {
    const target = release(work(305, "world", [fragment("place")]), 305);
    const quoting = release(work(306, "lorebook", [fragment("clue", [target.creation.ref])]), 306);
    const root = work(307, "scenario", []);
    root.cast = [{ key: "player", who: { late: "persona" } }];
    root.references = [edge(quoting, "quotes"), edge(target, "target")];
    expect(() =>
      buildTestCreation({ root: release(root, 307), dependencies: [quoting, target] }),
    ).toThrowError(expect.objectContaining({ code: "catalog.about_missing" }));
  });

  it("binds self work and local fragments separately in each nested copy", () => {
    const child = work(308, "lorebook", [
      fragment("clue", ["#place", "@test/work-308"]),
      fragment("place"),
    ]);
    const dep = release(child, 308);
    const root = work(309, "scenario", []);
    root.cast = [{ key: "player", who: { late: "persona" } }];
    root.references = [edge(dep, "left"), edge(dep, "right")];
    const { artifact } = buildTestCreation({ root: release(root, 309), dependencies: [dep] });
    if (artifact.kind !== "content") throw new Error("Wrong artifact");
    expect(artifact.catalog_index.about).toHaveLength(4);
    for (const clue of artifact.ir.fragments.filter((f) => f.origin.fragment === "clue")) {
      const targets = artifact.catalog_index.about
        ?.filter((link) => link.from === clue.id)
        .map((link) => link.target);
      expect(targets).toEqual([
        {
          fragment: artifact.ir.fragments.find(
            (f) =>
              f.origin.fragment === "place" && f.origin.instance_key === clue.origin.instance_key,
          )?.id,
        },
        {
          work: artifact.catalog_index.works.find((w) => w.instance === clue.origin.instance_key)
            ?.id,
        },
      ]);
    }
    expect(() =>
      resolveAboutReference(child.ref, artifact.ir, artifact.catalog_index),
    ).toThrowError(expect.objectContaining({ code: "catalog.ambiguous_about" }));
  });

  it("rejects ambiguous public actor works and accepts separate cast targets", () => {
    const dep = release(work(310, "character", [fragment("secret")]), 310);
    const root = work(311, "scenario", [fragment("clue", [dep.creation.ref])]);
    root.cast = [
      { key: "front", who: dep.creation.ref },
      { key: "back", who: dep.creation.ref },
    ];
    root.references = [edge(dep)];
    const build = () => buildTestCreation({ root: release(root, 311), dependencies: [dep] });
    expect(build).toThrowError(expect.objectContaining({ code: "catalog.ambiguous_about" }));
    root.fragments = [fragment("clue", ["cast:front", "cast:back", "cast:back#secret"])];
    const { artifact } = build();
    if (artifact.kind !== "content") throw new Error("Wrong artifact");
    const targets = artifact.catalog_index.about?.map((link) => link.target);
    expect(targets).toHaveLength(3);
    expect(targets?.[0]).not.toEqual(targets?.[1]);
    expect(targets?.[2]).toEqual({
      fragment: artifact.ir.fragments.find((f) => f.instance === "back")?.id,
    });
  });

  it("rejects references to fragments removed by dependency selection", () => {
    const dep = release(work(312, "lorebook", [fragment("secret")]), 312);
    const root = work(313, "lorebook", [fragment("clue", [`${dep.creation.ref}#secret`])]);
    root.references = [{ ...edge(dep), select: { exclude: ["secret"] } }];
    expect(() => buildTestCreation({ root: release(root, 313), dependencies: [dep] })).toThrowError(
      expect.objectContaining({ code: "story.information_missing" }),
    );
  });
});
