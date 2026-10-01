import {
  type CreationInput,
  canonicalizeCreation,
  initStoryState,
  toTurnStory,
} from "@char-pub/core";
import { describe, expect, it } from "vitest";
import { buildTestCreation } from "../../core/test/build.js";
import { tid } from "../../core/test/fixtures.js";
import { buildContextCatalog, catalogKey, selectorCatalog } from "../src/catalog.js";
import { estimateCounter } from "../src/tokens.js";
import { viewOf } from "../src/view.js";

function fixture(controlled = false) {
  const style: CreationInput = {
    id: tid("cr", 831),
    ref: "@test/voice",
    type: "style",
    display_name: "Voice",
    meta: { default_locale: "en", rating: "general", license: "CC0-1.0", rights: "original" },
    fragments: [
      {
        id: "tone",
        stable: true,
        kind: "style",
        description: "PRIVATE_TONE",
        activation: { mode: "semantic" },
        visibility: { scope: "private", to: ["{{user}}"] },
        content: { type: "text", text: "PRIVATE_BODY" },
      },
    ],
  };
  const release = tid("rel", 831);
  const creation: CreationInput = {
    id: tid("cr", 832),
    ref: "@test/scene",
    type: "scenario",
    display_name: "Scene",
    meta: style.meta,
    cast: [
      { key: "alice", who: { late: "character" }, goal: "PRIVATE_GOAL" },
      { key: "bob", who: { late: "character" } },
    ],
    references: [
      {
        id: "voice",
        use: style.ref,
        mode: "default",
        scope: { cast: "alice" },
        pin: { release, semantic_digest: canonicalizeCreation(style).semantic_digest },
      },
    ],
    story: {
      version: 1,
      scenes: [{ id: "lobby", title: "Lobby", cast: ["alice", "bob"] }],
      ...(controlled ? { knowing: { "@test/voice#tone": { start: { knows: ["alice"] } } } } : {}),
    },
  };
  const { artifact } = buildTestCreation({
    root: { creation, release: tid("rel", 832), visibility: "public" },
    dependencies: [{ creation: style, release, visibility: "public" }],
  });
  if (artifact.kind !== "content" || !artifact.story || !artifact.story_refs)
    throw new Error("Expected Story artifact");
  const state = initStoryState(artifact.story, ["alice", "bob"]);
  const input = {
    artifact,
    turn: { history: [], scene: state.scene, present: state.present, story: toTurnStory(state) },
    view: { mode: "per-agent" as const, for: "bob" },
    counter: estimateCounter,
    selection: { catalog_budget: 10000, max_depth: 4 },
  };
  const tone = artifact.ir.fragments.find((f) => f.origin.fragment === "tone");
  if (!tone) throw new Error("Expected compiled Style");
  return { input, tone, participants: artifact.story_refs.participants };
}

describe("first matching visibility rule", () => {
  it("counts a private other-cast Style as withheld before applying its speaker scope", () => {
    const { input, tone } = fixture();
    const build = buildContextCatalog(input);
    expect(build.visibility.get(catalogKey({ fragment: tone.id }))).toEqual({
      status: "withheld",
      reason: "view.private",
    });
    expect(build.catalog.withheld).toBe(1);
    expect(JSON.stringify(selectorCatalog(build.catalog))).not.toContain("PRIVATE_");
    expect(build.catalog.direct).not.toContainEqual({ fragment: tone.id });
  });

  it("reports unknown knowledge before private visibility and other-cast Style", () => {
    const { input, tone } = fixture(true);
    const build = buildContextCatalog(input);
    expect(build.visibility.get(catalogKey({ fragment: tone.id }))).toEqual({
      status: "withheld",
      reason: "view.not_knowing",
    });
    expect(build.catalog.withheld).toBe(1);
    expect(JSON.stringify(selectorCatalog(build.catalog))).not.toContain(tone.id);
  });

  it("excludes absent participants' goals before presence, and their Style before private visibility", () => {
    const { input, tone, participants } = fixture();
    const alice = participants.alice;
    if (!alice) throw new Error("Expected Alice participant");
    input.turn.present = ["bob"];
    const build = buildContextCatalog(input);
    expect(viewOf({ kind: "story", role: "goal", participant: alice }, build.context)).toEqual({
      status: "excluded",
      reason: "view.others_goal",
    });
    expect(build.visibility.get(catalogKey({ fragment: tone.id }))).toEqual({
      status: "excluded",
      reason: "view.absent",
    });
    expect(build.catalog.withheld).toBe(0);
    const narrator = buildContextCatalog({ ...input, view: { mode: "narrator" } });
    expect(viewOf({ kind: "story", role: "goal", participant: alice }, narrator.context)).toEqual({
      status: "excluded",
      reason: "view.absent",
    });
  });
});
