import { describe, expect, it } from "vitest";
import { canonicalizeCreation } from "../src/canonical.js";
import { checkCreation } from "../src/check.js";
import type { CreationInput } from "../src/schema/creation.js";
import { playerInputMessage, resolveStoryPlayer } from "../src/story/player.js";
import { buildTestCreation } from "./build.js";
import { level0Character, tid } from "./fixtures.js";

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("Fixture value missing");
  return value;
}

function fixture(): CreationInput {
  return {
    id: tid("cr", 930),
    ref: "@test/player",
    type: "scenario",
    display_name: "Player contract",
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    cast: [
      { key: "hero", who: { late: "persona" }, role: "user" },
      { key: "guide", who: { late: "character" }, role: "support" },
    ],
    story: { version: 1, player: "hero", scenes: [{ id: "hall", title: "Hall" }] },
  };
}

function build(creation = fixture()) {
  const artifact = buildTestCreation({
    root: { creation, release: tid("rel", 930), visibility: "public" },
  }).artifact;
  if (artifact.kind !== "content") throw new Error("Expected content");
  return artifact;
}

describe("explicit story player control", () => {
  it("controls an early-bound character without manufacturing another player binding", () => {
    const character = level0Character({
      id: tid("cr", 933),
      ref: "@test/hero",
      display_name: "Hero",
    });
    const dependency = {
      creation: character,
      release: tid("rel", 933),
      visibility: "public" as const,
    };
    const creation = fixture();
    creation.cast = [{ key: "hero", who: "@test/hero", role: "user" }];
    creation.references = [
      {
        id: "hero",
        use: "@test/hero",
        mode: "intrinsic",
        pin: {
          release: dependency.release,
          semantic_digest: canonicalizeCreation(character).semantic_digest,
        },
      },
    ];
    const artifact = buildTestCreation({
      root: { creation, release: tid("rel", 930), visibility: "public" },
      dependencies: [dependency],
    }).artifact;
    if (artifact.kind !== "content") throw new Error("Content required");
    expect(artifact.ir.late_slots.map((slot) => slot.key)).toEqual(["user"]);
    const player = required(resolveStoryPlayer(artifact));
    expect(
      artifact.ir.participants.find((person) => person.key === player.participant),
    ).toMatchObject({ ref: "@test/hero", display_name: "Hero", cast_key: "hero", role: "user" });
    expect(playerInputMessage(artifact, "Hello").speaker).toBe(player.participant);
  });

  it("resolves the authored cast identity without merging the implicit user", () => {
    const artifact = build();
    const player = resolveStoryPlayer(artifact);
    expect(player).toEqual({
      cast_key: "hero",
      participant: artifact.story_refs?.participants.hero,
    });
    expect(player?.participant).not.toBe("user");
    expect(artifact.ir.participants.find((p) => p.key === "user")?.role).toBe("user");
    expect(artifact.capabilities).toContainEqual({
      id: "story.player-control",
      experimental: true,
    });
    const text = "NFD e\u0301\r\nplayer input  ";
    expect(playerInputMessage(artifact, text)).toEqual({
      role: "user",
      text,
      speaker: player?.participant,
    });
  });

  it("keeps old role:user definitions and input bytes unchanged without an explicit declaration", () => {
    const creation = fixture();
    if (!creation.story) throw new Error("Story missing");
    delete creation.story.player;
    creation.cast?.push({ key: "second", who: { late: "persona" }, role: "user" });
    expect(checkCreation(canonicalizeCreation(creation).creation).ok).toBe(true);
    const artifact = build(creation);
    expect(resolveStoryPlayer(artifact)).toBeNull();
    expect(playerInputMessage(artifact, "old input\n")).toEqual({
      role: "user",
      text: "old input\n",
    });
    expect(artifact.capabilities.some((c) => c.id === "story.player-control")).toBe(false);
    expect(canonicalizeCreation(creation).creation.story).not.toHaveProperty("player");
  });

  it.each([
    ["missing", "story.player_missing"],
    ["role", "story.player_role"],
    ["multiple", "story.player_ambiguous"],
  ] as const)("rejects an invalid %s control declaration at authoring time", (kind, code) => {
    const creation = fixture();
    if (!creation.story || !creation.cast) throw new Error("Fixture missing");
    if (kind === "missing") creation.story.player = "absent";
    if (kind === "role") creation.cast[0] = { ...required(creation.cast[0]), role: "support" };
    if (kind === "multiple") creation.cast[1] = { ...required(creation.cast[1]), role: "user" };
    const result = checkCreation(canonicalizeCreation(creation).creation);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code, subject: "story.player" }),
    );
  });

  it("rejects missing, misbound and undeclared compiled player identities", () => {
    const artifact = build();
    const player = resolveStoryPlayer(artifact);
    if (!player || !artifact.story_refs) throw new Error("Player missing");
    const misbound = structuredClone(artifact);
    required(misbound.story_refs).participants.hero = "user";
    expect(() => resolveStoryPlayer(misbound)).toThrowError(
      expect.objectContaining({ code: "story.player_missing" }),
    );
    const wrongRole = structuredClone(artifact);
    required(wrongRole.ir.participants.find((p) => p.key === player.participant)).role = "support";
    expect(() => resolveStoryPlayer(wrongRole)).toThrowError(
      expect.objectContaining({ code: "story.player_role" }),
    );
    const missingCapability = structuredClone(artifact);
    missingCapability.capabilities = missingCapability.capabilities.filter(
      (c) => c.id !== "story.player-control",
    );
    expect(() => resolveStoryPlayer(missingCapability)).toThrowError(
      expect.objectContaining({ code: "story.player_capability_missing" }),
    );
  });
});
