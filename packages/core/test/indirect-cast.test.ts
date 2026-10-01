import { describe, expect, it } from "vitest";
import { canonicalizeCreation } from "../src/canonical.js";
import { catalogScopeInstances, resolveCatalogReference } from "../src/catalog-index.js";
import { resolve } from "../src/resolve/index.js";
import type { CreationInput } from "../src/schema/creation.js";
import { buildTestCreation } from "./build.js";
import { D, level0Character, tid } from "./fixtures.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture");
  return value;
}
function fixture() {
  const meta = level0Character().meta;
  const relation: CreationInput = {
    id: tid("cr", 401),
    ref: "@test/bond",
    type: "relationship",
    display_name: "Bond",
    meta,
    slots: { actor: { accepts: "character" }, other: { accepts: "character", required: false } },
    fragments: [
      {
        id: "bond",
        stable: true,
        kind: "relationship",
        content: {
          type: "dialogue",
          turns: [{ speaker: "{{slot:actor}}", text: "I am {{slot:actor}}." }],
        },
      },
    ],
  };
  const guard = level0Character({
    id: tid("cr", 402),
    ref: "@test/guard",
    display_name: "Guard",
    bootstrap: undefined,
    params: { station: { type: "string", default: "gate" } },
    references: [{ id: "bond", use: relation.ref, mode: "default", bind: { actor: "{{self}}" } }],
    fragments: [
      {
        id: "identity",
        stable: true,
        kind: "character",
        content: { type: "text", text: "{{self}} guards {{param:station}}." },
      },
      {
        id: "secret",
        stable: true,
        kind: "knowledge",
        content: { type: "text", text: "Original secret" },
        source: { use: "#manual" },
      },
    ],
    sources: [
      {
        id: "manual",
        title: "Manual",
        description: "Guard notes",
        format: "text",
        asset: "manual",
      },
    ],
    assets: [
      ...(level0Character().assets ?? []),
      {
        slot: "manual",
        role: "context",
        variants: [
          {
            id: "default",
            media_type: "text/plain",
            blob: { digest: D("c"), size: 10, availability: "mirrored" },
          },
        ],
      },
    ],
  });
  const world: CreationInput = {
    id: tid("cr", 403),
    ref: "@test/world",
    type: "world",
    display_name: "World",
    meta,
    fragments: [
      { id: "world", stable: true, kind: "world", content: { type: "text", text: "An inn" } },
    ],
    references: [
      {
        id: "guard",
        use: guard.ref,
        mode: "default",
        params: { station: "river" },
        override: [
          { op: "replace", target: "secret", content: { type: "text", text: "World secret" } },
        ],
      },
    ],
  };
  const root: CreationInput = {
    id: tid("cr", 404),
    ref: "@test/story",
    type: "scenario",
    display_name: "Story",
    meta,
    references: [{ id: "world", use: world.ref, mode: "default" }],
    cast: [
      { key: "front", who: guard.ref },
      {
        key: "back",
        who: guard.ref,
        override: [
          { op: "replace", target: "secret", content: { type: "text", text: "Back secret" } },
        ],
      },
    ],
    story: {
      version: 1,
      scenes: [{ id: "inn", title: "Inn" }],
      knowing: { "cast:back#secret": { start: { knows: ["back"] } } },
    },
  };
  const entries = [relation, guard, world, root];
  const input = () => {
    const dependencies = entries.map((creation, i) => {
      for (const edge of creation.references ?? []) {
        const target = entries.findIndex((c) => c.ref === edge.use);
        if (target < 0) throw new Error("Missing dependency");
        edge.pin = {
          release: tid("rel", 401 + target),
          semantic_digest: canonicalizeCreation(entries[target]).semantic_digest,
        };
      }
      return {
        creation,
        release: tid("rel", 401 + i),
        visibility: "public" as const,
        semantic_digest: canonicalizeCreation(creation).semantic_digest,
      };
    });
    return { root: required(dependencies.pop()), dependencies };
  };
  const build = () => {
    const result = buildTestCreation(input());
    if (result.artifact.kind !== "content") throw new Error("Wrong artifact");
    return result.artifact;
  };
  return { root, world, guard, relation, entries, input, build };
}

describe("indirect cast materialization", () => {
  it("creates two complete role subtrees, one World and no phantom participant", () => {
    const { build, guard } = fixture();
    const artifact = build();
    const actors = artifact.ir.participants.filter((p) => p.ref === guard.ref);
    expect(actors).toHaveLength(2);
    expect(actors.map((p) => p.cast_key).sort()).toEqual(["back", "front"]);
    expect(artifact.ir.graph.instances.filter((i) => i.ref === "@test/world")).toHaveLength(1);
    const copies = artifact.ir.graph.instances.filter((i) => i.ref === guard.ref);
    expect(copies).toHaveLength(2);
    expect(artifact.ir.graph.cast_edges).toHaveLength(2);
    for (const copy of copies) {
      const actor = required(actors.find((p) => p.cast_key === copy.cast?.key));
      const identity = required(
        artifact.ir.fragments.find(
          (f) => f.origin.instance_key === copy.key && f.origin.fragment === "identity",
        ),
      );
      expect(identity.subject).toBe(actor.key);
      expect(identity.content).toMatchObject({ text: "Guard guards river." });
      expect(artifact.ir.assets.find((a) => a.id === actor.avatar)?.origin.instance_key).toBe(
        copy.key,
      );
      const scope = catalogScopeInstances(artifact.ir, copy.key);
      const bond = required(
        artifact.ir.fragments.find(
          (f) => f.kind === "relationship" && scope.has(f.origin.instance_key),
        ),
      );
      expect(bond.content).toMatchObject({ turns: [{ speaker: `participant:${actor.key}` }] });
      expect(
        artifact.catalog_index.sources.find((s) => s.owner.endsWith(`~${copy.key}`))?.asset,
      ).toContain(copy.key);
    }
    const back = required(
      artifact.ir.fragments.find((f) => f.instance === "back" && f.origin.fragment === "secret"),
    );
    expect(back.content).toMatchObject({ text: "Back secret" });
    expect(back.origin.overridden_by).toEqual([
      { creation: "@test/world", edge: "guard", op: "replace" },
      { creation: "@test/story", cast: "back", op: "replace" },
    ]);
    expect(artifact.story_refs?.information["cast:back#secret"]).toBe(back.id);
    expect(build()).toEqual(artifact);
  });

  it("allows forced intrinsic role overrides from the owning Scenario and records that owner", () => {
    const { root, world, build } = fixture();
    required(world.references?.[0]).mode = "intrinsic";
    const back = required(root.cast?.[1]);
    back.override = [
      { op: "replace", target: "identity", force: true, content: { type: "text", text: "A spy" } },
    ];
    const artifact = build();
    expect(artifact.ir.meta.au).toBe(true);
    expect(
      artifact.ir.fragments.find((f) => f.instance === "back" && f.origin.fragment === "identity")
        ?.origin.overridden_by,
    ).toEqual([{ creation: root.ref, cast: "back", op: "replace" }]);
    back.override = [
      { op: "replace", target: "identity", force: false, content: { type: "text", text: "A spy" } },
    ];
    expect(build).toThrowError(
      expect.objectContaining({ code: "resolve.intrinsic_override_forbidden" }),
    );
  });

  it("keeps select authoritative and isolates a participant's remove", () => {
    const { root, world, build } = fixture();
    required(world.references?.[0]).select = { exclude: ["secret"] };
    expect(build).toThrowError(
      expect.objectContaining({ code: "resolve.override_target_excluded" }),
    );
    required(world.references?.[0]).select = { include: ["identity", "secret"] };
    required(root.cast?.[1]).override = [{ op: "remove", target: "secret" }];
    required(root.story).knowing = {};
    const artifact = build();
    expect(
      artifact.ir.fragments.filter((f) => f.origin.fragment === "secret").map((f) => f.instance),
    ).toEqual(["front"]);
    expect(artifact.ir.graph.removed.find((f) => f.by.cast === "back")?.by).toEqual({
      creation: root.ref,
      cast: "back",
      reason: "override",
    });
  });

  it("rejects two authored paths even when both pin the same role definition", () => {
    const { root, world, build } = fixture();
    root.references = ["left", "right"].map((id) => ({ id, use: world.ref, mode: "default" }));
    expect(build).toThrowError(
      expect.objectContaining({
        code: "resolve.ambiguous_cast_path",
        data: {
          ref: "@test/guard",
          paths: [
            ["left", "guard"],
            ["right", "guard"],
          ],
        },
      }),
    );
  });

  it("does not accept an unused release or a sibling Scenario's role as a cast dependency", () => {
    const { root, input } = fixture();
    root.references = [];
    expect(() => buildTestCreation(input())).toThrowError(
      expect.objectContaining({ code: "resolve.binding_not_in_graph" }),
    );
  });

  it("copies across a nested Scenario without inheriting its cast overrides or polluting its scope", () => {
    const { entries, root, world, guard, build } = fixture();
    const nested: CreationInput = {
      id: tid("cr", 405),
      ref: "@test/nested",
      type: "scenario",
      display_name: "Nested",
      meta: root.meta,
      references: [{ id: "world", use: world.ref, mode: "default" }],
      cast: ["front", "back"].map((key) => ({
        key,
        who: guard.ref,
        override: [
          { op: "replace", target: "secret", content: { type: "text", text: `Nested ${key}` } },
        ],
      })),
    };
    entries.splice(entries.length - 1, 0, nested);
    root.references = [{ id: "nested", use: nested.ref, mode: "default" }];
    const artifact = build();
    const actors = artifact.ir.participants.filter((p) => p.ref === guard.ref);
    expect(actors).toHaveLength(4);
    const nestedInstance = required(artifact.ir.graph.instances.find((i) => i.ref === nested.ref));
    const nestedScope = catalogScopeInstances(artifact.ir, nestedInstance.key);
    const rootCopies = artifact.ir.graph.instances.filter((i) => i.cast?.scope === "root");
    expect(rootCopies).toHaveLength(2);
    for (const copy of rootCopies) {
      expect(nestedScope.has(copy.key)).toBe(false);
      expect(copy.cast?.introduced_by?.instance).toBeDefined();
      const secret = required(
        artifact.ir.fragments.find(
          (f) => f.origin.instance_key === copy.key && f.origin.fragment === "secret",
        ),
      );
      expect(secret.content).toMatchObject({
        text: copy.cast?.key === "back" ? "Back secret" : "World secret",
      });
      expect(secret.origin.overridden_by?.some((o) => o.creation === nested.ref)).toBe(false);
    }
    const inner = resolveCatalogReference(
      "cast:back#secret",
      artifact.ir,
      artifact.catalog_index,
      nestedInstance.key,
    );
    const outer = resolveCatalogReference("cast:back#secret", artifact.ir, artifact.catalog_index);
    expect(inner).not.toEqual(outer);
  });

  it("preserves explicit lexical cast bindings on cross-Scenario introductions", () => {
    const { root, guard, entries, build } = fixture();
    guard.slots = { friend: { accepts: "character" } };
    required(guard.fragments?.[0]).content = {
      type: "dialogue",
      turns: [{ speaker: "{{slot:friend}}", text: "My friend" }],
    };
    const friend = level0Character({
      id: tid("cr", 406),
      ref: "@test/friend",
      display_name: "Friend",
      assets: [],
      bootstrap: undefined,
    });
    const nested: CreationInput = {
      id: tid("cr", 407),
      ref: "@test/nested",
      type: "scenario",
      display_name: "Nested",
      meta: root.meta,
      cast: [{ key: "friend", who: friend.ref }],
      references: [
        { id: "friend", use: friend.ref, mode: "default" },
        { id: "guard", use: guard.ref, mode: "default", bind: { friend: "{{cast:friend}}" } },
      ],
    };
    entries.splice(2, 1, friend, nested);
    root.references = [{ id: "nested", use: nested.ref, mode: "default" }];
    const artifact = build();
    const friendKey = required(artifact.ir.participants.find((p) => p.ref === friend.ref)).key;
    const copies = artifact.ir.graph.instances.filter((i) => i.cast?.scope === "root");
    expect(copies).toHaveLength(2);
    for (const copy of copies)
      expect(
        artifact.ir.fragments.find(
          (f) => f.origin.instance_key === copy.key && f.origin.fragment === "identity",
        )?.content,
      ).toMatchObject({ turns: [{ speaker: `participant:${friendKey}` }] });
  });

  it("retains nested scope isolation when the same Scenario is used twice", () => {
    const { entries, root, world, build } = fixture();
    const nested = structuredClone(root);
    nested.id = tid("cr", 408);
    nested.ref = "@test/nested";
    entries.splice(entries.length - 1, 0, nested);
    root.cast = [{ key: "guest", who: { late: "persona" } }];
    required(root.story).knowing = {};
    root.references = ["left", "right"].map((id) => ({ id, use: nested.ref, mode: "default" }));
    const artifact = build();
    expect(artifact.ir.graph.instances.filter((i) => i.ref === world.ref)).toHaveLength(2);
    const groups = new Map<string, string[]>();
    for (const participant of artifact.ir.participants.filter((p) => p.ref === "@test/guard")) {
      const owner = required(participant.cast_scope);
      groups.set(owner, [...(groups.get(owner) ?? []), participant.key]);
    }
    expect(groups.size).toBe(2);
    expect([...groups.values()].every((keys) => keys.length === 2)).toBe(true);
  });

  it.each(["character", "persona"] as const)(
    "checks late cast type across a lexical binding (%s)",
    (kind) => {
      const { root, guard, entries, build } = fixture();
      guard.slots = { friend: { accepts: "character" } };
      required(guard.fragments?.[0]).content = {
        type: "dialogue",
        turns: [{ speaker: "{{slot:friend}}", text: "My friend" }],
      };
      const nested: CreationInput = {
        id: tid("cr", 412),
        ref: "@test/nested",
        type: "scenario",
        display_name: "Nested",
        meta: root.meta,
        cast: [{ key: "player", who: { late: kind } }],
        references: [
          { id: "guard", use: guard.ref, mode: "default", bind: { friend: "{{cast:player}}" } },
        ],
      };
      entries.splice(entries.length - 1, 0, nested);
      root.references = [{ id: "nested", use: nested.ref, mode: "default" }];
      if (kind === "persona") {
        expect(build).toThrowError(
          expect.objectContaining({ code: "resolve.binding_type_mismatch" }),
        );
      } else {
        const artifact = build();
        const player = required(artifact.ir.participants.find((p) => p.cast_key === "player"));
        expect(artifact.ir.late_slots.find((s) => s.key === player.late)?.accepts).toEqual([
          "character",
        ]);
        for (const fragment of artifact.ir.fragments.filter(
          (f) => f.origin.fragment === "identity",
        ))
          expect(fragment.content).toMatchObject({
            turns: [{ speaker: `participant:${player.key}` }],
          });
      }
    },
  );

  it.each([false, true])(
    "freezes lexical introductions before sibling cross-Scenario copies (reverse=%s)",
    (reverse) => {
      const { root, guard, entries, build } = fixture();
      const dog: CreationInput = {
        id: tid("cr", 409),
        ref: "@test/dog",
        type: "character",
        display_name: "Dog",
        meta: root.meta,
        slots: { owner: { accepts: "character" } },
        fragments: [
          {
            id: "dog",
            stable: true,
            kind: "character",
            content: { type: "dialogue", turns: [{ speaker: "{{slot:owner}}", text: "My dog" }] },
            visibility: { scope: "private", to: ["{{slot:owner}}"] },
          },
        ],
      };
      entries.unshift(dog);
      required(guard.references).push({
        id: "dog",
        use: dog.ref,
        mode: "default",
        bind: { owner: "{{self}}" },
      });
      const nested: CreationInput = {
        id: tid("cr", 410),
        ref: "@test/nested",
        type: "scenario",
        display_name: "Nested",
        meta: root.meta,
        references: [{ id: "guard", use: guard.ref, mode: "default" }],
        cast: [{ key: "original", who: guard.ref }],
      };
      entries.splice(entries.length - 1, 0, nested);
      root.references = [{ id: "nested", use: nested.ref, mode: "default" }];
      root.cast = [
        { key: "guard", who: guard.ref },
        { key: "dog", who: dog.ref },
      ];
      if (reverse) root.cast.reverse();
      required(root.story).knowing = {};
      const artifact = build();
      const original = required(artifact.ir.participants.find((p) => p.cast_key === "original"));
      const outerGuard = required(
        artifact.ir.participants.find((p) => p.cast_key === "guard" && p.cast_scope === "root"),
      );
      const outerDog = required(
        artifact.ir.graph.instances.find((i) => i.cast?.key === "dog" && i.cast.scope === "root"),
      );
      const dogFragment = required(
        artifact.ir.fragments.find((f) => f.origin.instance_key === outerDog.key),
      );
      expect(dogFragment.content).toMatchObject({
        turns: [{ speaker: `participant:${original.key}` }],
      });
      expect(dogFragment.visibility).toEqual({
        scope: "private",
        to: [`participant:${original.key}`],
      });
      const outerGuardInstance = required(
        artifact.ir.graph.instances.find((i) => i.cast?.key === "guard" && i.cast.scope === "root"),
      );
      const guardScope = catalogScopeInstances(artifact.ir, outerGuardInstance.key);
      const ownDog = required(
        artifact.ir.fragments.find(
          (f) => f.origin.creation === dog.ref && guardScope.has(f.origin.instance_key),
        ),
      );
      expect(ownDog.content).toMatchObject({
        turns: [{ speaker: `participant:${outerGuard.key}` }],
      });
      const middle: CreationInput = {
        id: tid("cr", 411),
        ref: "@test/middle",
        type: "scenario",
        display_name: "Middle",
        meta: root.meta,
        references: [{ id: "nested", use: nested.ref, mode: "default" }],
        cast: [{ key: "derived", who: guard.ref }],
      };
      entries.splice(entries.length - 1, 0, middle);
      root.references = [{ id: "middle", use: middle.ref, mode: "default" }];
      root.cast = [{ key: "dog", who: dog.ref }];
      const threeLevels = build();
      const originalAtDepth = required(
        threeLevels.ir.participants.find((p) => p.cast_key === "original"),
      );
      const rootDogAtDepth = required(
        threeLevels.ir.graph.instances.find(
          (i) => i.cast?.key === "dog" && i.cast.scope === "root",
        ),
      );
      expect(
        threeLevels.ir.fragments.find((f) => f.origin.instance_key === rootDogAtDepth.key)?.content,
      ).toMatchObject({ turns: [{ speaker: `participant:${originalAtDepth.key}` }] });
      nested.cast = [
        { key: "first", who: guard.ref },
        { key: "second", who: guard.ref },
      ];
      expect(build).toThrowError(
        expect.objectContaining({ code: "resolve.ambiguous_cast_context" }),
      );
    },
  );

  it("bounds the final role expansion as well as the authored graph", () => {
    const { root, input } = fixture();
    root.cast = Array.from({ length: 2500 }, (_, i) => ({ key: `guard-${i}`, who: "@test/guard" }));
    root.story = undefined;
    expect(() => resolve(input())).toThrowError(
      expect.objectContaining({ code: "resolve.graph_too_large" }),
    );
  });
});
