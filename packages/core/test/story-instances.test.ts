import { describe, expect, it } from "vitest";
import { canonicalizeCreation } from "../src/canonical.js";
import { resolve } from "../src/resolve/index.js";
import type { CreationInput } from "../src/schema/creation.js";
import { buildTestCreation } from "./build.js";
import { level0Character, tid } from "./fixtures.js";

function fixture() {
  const character = level0Character({
    ref: "@djj/guard",
    display_name: "Guard",
    assets: [],
    bootstrap: undefined,
    fragments: [
      {
        id: "identity",
        stable: true,
        kind: "character",
        content: { type: "text", text: "{{self}} guards the inn." },
        outward: true,
      },
      {
        id: "secret",
        stable: true,
        kind: "knowledge",
        content: { type: "text", text: "Original secret" },
      },
    ],
  });
  const canonical = canonicalizeCreation(character);
  const child = {
    creation: character,
    release: tid("rel", 4),
    visibility: "public" as const,
    semantic_digest: canonical.semantic_digest,
  };
  const creation: CreationInput = {
    id: tid("cr", 5),
    ref: "@djj/two-guards",
    type: "scenario",
    display_name: "Two guards",
    meta: character.meta,
    references: [
      {
        id: "guard",
        use: "@djj/guard",
        mode: "intrinsic",
        pin: { release: child.release, semantic_digest: child.semantic_digest },
      },
    ],
    cast: [
      { key: "front", who: "@djj/guard", part: "Front guard" },
      { key: "back", who: "@djj/guard", part: "Back guard" },
    ],
    story: { version: 1, scenes: [{ id: "lobby", title: "Lobby" }] },
  };
  return { creation, child };
}

describe("one character used by two participants", () => {
  it.each(["dialogue", "visibility", "claim", "belief"] as const)(
    "rejects ambiguous public participant references in %s and accepts explicit cast",
    (field) => {
      const { creation, child } = fixture();
      const fragment = (speaker: string) => ({
        id: "address",
        stable: true,
        kind: "knowledge" as const,
        content:
          field === "dialogue"
            ? { type: "dialogue" as const, turns: [{ speaker, text: "A secret." }] }
            : { type: "text" as const, text: "A secret." },
        ...(field === "visibility"
          ? { visibility: { scope: "private" as const, to: [speaker] } }
          : {}),
        ...(field === "claim" ? { perspective: { claim: speaker } } : {}),
        ...(field === "belief" ? { perspective: { belief: speaker } } : {}),
      });
      creation.fragments = [fragment("@djj/guard")];
      const input = {
        root: { creation, release: tid("rel", 5), visibility: "public" as const },
        dependencies: [child],
      };
      expect(() => buildTestCreation(input)).toThrowError(
        expect.objectContaining({ code: "resolve.ambiguous_participant" }),
      );
      creation.fragments = [fragment("{{cast:back}}")];
      const { artifact } = buildTestCreation(input);
      if (artifact.kind !== "content") throw new Error("Wrong artifact");
      const back = artifact.ir.participants.find((p) => p.cast_key === "back")?.key;
      const rendered = artifact.ir.fragments.find((f) => f.origin.fragment === "address");
      expect(back).toBeDefined();
      if (field === "dialogue")
        expect(rendered?.content).toEqual({
          type: "dialogue",
          turns: [{ speaker: `participant:${back}`, text: "A secret." }],
        });
      else if (field === "visibility")
        expect(rendered?.visibility).toEqual({ scope: "private", to: [`participant:${back}`] });
      else expect(rendered?.perspective).toEqual({ [field]: `participant:${back}` });
    },
  );

  it("keeps public self references local to each character instance", () => {
    const { creation, child } = fixture();
    child.creation.fragments = [
      {
        id: "self",
        stable: true,
        kind: "character",
        content: {
          type: "dialogue",
          turns: [{ speaker: child.creation.ref, text: "My own voice." }],
        },
        visibility: { scope: "private", to: [child.creation.ref] },
      },
    ];
    child.semantic_digest = canonicalizeCreation(child.creation).semantic_digest;
    const edge = creation.references?.[0];
    if (!edge) throw new Error("Missing edge");
    edge.pin = { release: child.release, semantic_digest: child.semantic_digest };
    const { ir } = resolve({
      root: { creation, release: tid("rel", 5), visibility: "public" },
      dependencies: [child],
    });
    for (const fragment of ir.fragments) {
      const participant = ir.participants.find((p) => p.cast_key === fragment.instance);
      expect(participant).toBeDefined();
      expect(fragment.content).toEqual({
        type: "dialogue",
        turns: [{ speaker: `participant:${participant?.key}`, text: "My own voice." }],
      });
      expect(fragment.visibility).toEqual({
        scope: "private",
        to: [`participant:${participant?.key}`],
      });
    }
  });

  it("rejects a bare relationship binding to repeated actors and preserves explicit cast identities", () => {
    const { creation, child } = fixture();
    const relationship: CreationInput = {
      id: tid("cr", 8),
      ref: "@djj/guard-bond",
      type: "relationship",
      display_name: "Guard bond",
      meta: creation.meta,
      slots: { first: { accepts: "character" }, second: { accepts: "character" } },
      fragments: [
        {
          id: "secret-bond",
          stable: true,
          kind: "relationship",
          content: {
            type: "dialogue",
            turns: [
              { speaker: "{{slot:first}}", text: "My post." },
              { speaker: "{{slot:second}}", text: "My other post." },
            ],
          },
          visibility: { scope: "private", to: ["{{slot:first}}"] },
        },
      ],
    };
    const canonical = canonicalizeCreation(relationship);
    const relation = {
      release: tid("rel", 8),
      visibility: "public" as const,
      creation: relationship,
      semantic_digest: canonical.semantic_digest,
    };
    const edge = {
      id: "bond",
      use: "@djj/guard-bond",
      mode: "default" as const,
      pin: { release: relation.release, semantic_digest: relation.semantic_digest },
      bind: { first: "@djj/guard", second: "{{cast:back}}" },
    };
    creation.references = [...(creation.references ?? []), edge];
    const input = {
      root: { creation, release: tid("rel", 5), visibility: "public" as const },
      dependencies: [child, relation],
    };
    expect(() => resolve(input)).toThrowError(
      expect.objectContaining({
        code: "resolve.ambiguous_participant",
        subject: "@djj/two-guards/bond/bind/first",
      }),
    );
    edge.bind.first = "{{cast:front}}";
    const { ir } = resolve(input);
    const guards = ir.participants.filter((p) => p.ref === "@djj/guard");
    expect(guards).toHaveLength(2);
    const front = guards.find((p) => p.cast_key === "front")?.key;
    const back = guards.find((p) => p.cast_key === "back")?.key;
    expect(front).toBeDefined();
    expect(back).toBeDefined();
    expect(front).not.toBe(back);
    const bond = ir.fragments.find((f) => f.origin.fragment === "secret-bond");
    expect(bond?.content).toEqual({
      type: "dialogue",
      turns: [
        { speaker: `participant:${front}`, text: "My post." },
        { speaker: `participant:${back}`, text: "My other post." },
      ],
    });
    expect(bond?.visibility).toEqual({ scope: "private", to: [`participant:${front}`] });
  });

  it("creates independent fragment and participant identity without overrides", () => {
    const { creation, child } = fixture();
    const input = {
      root: { creation, release: tid("rel", 5), visibility: "public" as const },
      dependencies: [child],
    };
    const { ir, json } = resolve(input);
    const identities = ir.fragments.filter((f) => f.kind === "character");
    expect(identities).toHaveLength(2);
    expect(new Set(identities.map((f) => f.subject)).size).toBe(2);
    expect(new Set(identities.map((f) => f.id)).size).toBe(2);
    expect(identities.map((f) => f.instance)).toEqual(["front", "back"]);
    expect(identities.every((f) => f.outward)).toBe(true);
    expect(resolve(input).json).toBe(json);
  });

  it("applies participant overrides after edge overrides without changing the sibling", () => {
    const { creation, child } = fixture();
    const edge = creation.references?.[0];
    const back = creation.cast?.[1];
    if (!edge || !back) throw new Error("Invalid fixture");
    edge.override = [
      { op: "replace", target: "secret", content: { type: "text", text: "Shared baseline" } },
    ];
    back.override = [
      { op: "replace", target: "secret", content: { type: "text", text: "Only back guard knows" } },
    ];
    const { ir } = resolve({
      root: { creation, release: tid("rel", 5), visibility: "public" },
      dependencies: [child],
    });
    const secrets = ir.fragments.filter((f) => f.origin.fragment === "secret");
    expect(secrets.map((f) => f.content)).toEqual([
      { type: "text", text: "Shared baseline", format: "markdown" },
      { type: "text", text: "Only back guard knows", format: "markdown" },
    ]);
    expect(secrets[1]?.origin.overridden_by).toHaveLength(2);
    expect(canonicalizeCreation(child.creation).semantic_digest).toBe(child.semantic_digest);
  });

  it("retains intrinsic override requirements for each participant", () => {
    const { creation, child } = fixture();
    const back = creation.cast?.[1];
    if (!back) throw new Error("Invalid fixture");
    back.override = [
      { op: "replace", target: "identity", content: { type: "text", text: "A thief" } },
    ];
    expect(() =>
      resolve({
        root: { creation, release: tid("rel", 5), visibility: "public" },
        dependencies: [child],
      }),
    ).toThrow();
  });

  it("publishes exact instance references and rejects an ambiguous public reference", () => {
    const { creation, child } = fixture();
    if (!creation.story) throw new Error("Invalid fixture");
    creation.story.knowing = { "cast:back#secret": { start: { knows: ["back"] } } };
    const input = {
      root: { creation, release: tid("rel", 5), visibility: "public" as const },
      dependencies: [child],
    };
    const { artifact } = buildTestCreation(input);
    if (artifact.kind !== "content") throw new Error("Wrong artifact kind");
    const ref = artifact.story_refs?.information["cast:back#secret"];
    expect(artifact.ir.fragments.find((f) => f.id === ref)?.instance).toBe("back");
    expect(artifact.ir.participants.find((p) => p.cast_key === "back")?.part).toBe("Back guard");
    expect(artifact.story?.knowing).toEqual(creation.story.knowing);
    creation.story.knowing = { "@djj/guard#secret": { start: { knows: ["back"] } } };
    expect(() => buildTestCreation(input)).toThrowError(
      expect.objectContaining({ code: "story.ambiguous_information" }),
    );
  });
});
