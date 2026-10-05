import {
  type CreationInput,
  canonicalizeCreation,
  confirm,
  playerInputMessage,
  resolveStoryPlayer,
  toTurnStory,
} from "@char-pub/core";
import { describe, expect, it } from "vitest";
import { buildTestCreation } from "../../core/test/build.js";
import { level0Character, tid } from "../../core/test/fixtures.js";
import { assemble, projectPlayerView, startSession } from "../src/index.js";
import { profile } from "./fixtures/ir.js";

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("Fixture value missing");
  return value;
}

function fixture(legacy = false) {
  const creation: CreationInput = {
    id: tid("cr", 931),
    ref: "@test/player-view",
    type: "scenario",
    display_name: "Player view",
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    cast: [
      {
        key: "hero",
        who: { late: "persona" },
        role: "user",
        part: { en: "Visitor", ja: "訪問者" },
      },
      {
        key: "guide",
        who: { late: "character" },
        role: "support",
        part: "Guide",
        goal: "SECRET_NPC_GOAL",
      },
      { key: "future", who: { late: "character" }, role: "support", part: "SECRET_FUTURE_ROLE" },
    ],
    fragments: [
      {
        id: "known",
        kind: "knowledge",
        stable: true,
        description: { en: "Known clue", ja: "手掛かり" },
        content: { type: "text", text: "KNOWN {{cast:hero}}" },
      },
      {
        id: "secret",
        kind: "knowledge",
        stable: true,
        description: "Secret clue",
        content: { type: "text", text: "SECRET_TO_LEARN" },
      },
      {
        id: "restricted",
        kind: "knowledge",
        stable: true,
        content: { type: "text", text: "PRIVATE_TO_GUIDE" },
        visibility: { scope: "private", to: ["{{cast:guide}}"] },
      },
      {
        id: "later",
        kind: "knowledge",
        stable: true,
        content: { type: "text", text: "FUTURE_SCENE_CLUE" },
        visibility: { scope: "story-scene", scene: "later" },
      },
      {
        id: "undiscovered",
        kind: "knowledge",
        stable: true,
        description: "Optional public material",
        activation: { mode: "semantic" },
        content: { type: "text", text: "DISCOVERABLE_NOT_KNOWN" },
      },
      {
        id: "macros",
        kind: "instruction",
        stable: true,
        content: { type: "text", text: "Human={{user}}; hero={{cast:hero}}" },
      },
    ],
    story: {
      version: 1,
      ...(legacy ? {} : { player: "hero" }),
      scenes: [
        {
          id: "hall",
          title: { en: "Hall", ja: "広間" },
          description: "Current situation",
          time: "Evening",
          where: "Inn",
          cast: ["hero", "guide"],
          goals: { guide: "SECRET_SCENE_GOAL" },
          choices: ["free", "locked", "judged"],
        },
        { id: "later", title: "Later", cast: ["hero", "future"] },
      ],
      starts: [
        {
          id: "arrival",
          greeting: "Hello {{user}}, you control {{cast:hero}}.",
          reached: ["public", "hidden"],
        },
      ],
      vars: { open: { type: "bool", init: false, description: "SECRET_VAR_DESCRIPTION" } },
      choices: [
        { id: "free", label: "Ask a question", intent: "PRIVATE_RUNTIME_INTENT" },
        {
          id: "locked",
          label: "SECRET_LOCKED_CHOICE",
          intent: "Blocked",
          when: { is: "var/open" },
        },
        {
          id: "judged",
          label: "After judgment",
          intent: "Judge needed",
          when: { judge: "PRIVATE_JUDGE_INSTRUCTIONS" },
        },
      ],
      beats: [
        {
          id: "public",
          title: "Introduced",
          description: "SECRET_BEAT_DESCRIPTION",
          reveal: "on-reach",
        },
        { id: "hidden", title: "SECRET_HIDDEN_BEAT", description: "Hidden" },
        {
          id: "share",
          title: "Clue shared",
          description: "Share the clue",
          reveal: "on-reach",
          effects: [{ learn: { who: "hero", info: "#secret" } }],
        },
      ],
      endings: [
        {
          id: "future-ending",
          title: "SECRET_FUTURE_ENDING",
          description: "Future",
          reveal: "listed",
        },
      ],
      knowing: {
        "#known": { start: { knows: ["hero"] } },
        "#secret": { start: { knows: ["guide"] } },
        "#restricted": { start: { knows: ["hero", "guide"] } },
        "#later": { start: { knows: ["hero"] } },
      },
    },
  };
  const artifact = buildTestCreation({
    root: { creation, release: tid("rel", 931), visibility: "public" },
  }).artifact;
  if (artifact.kind !== "content" || !artifact.story_refs || !artifact.story)
    throw new Error("Content missing");
  const bindings = Object.fromEntries(
    artifact.ir.late_slots.map((slot) => {
      const participant = artifact.ir.participants.find((p) => p.late === slot.key);
      return [
        slot.key,
        {
          kind: required(slot.accepts[0]),
          display_name: slot.key === "user" ? "Human" : (participant?.cast_key ?? "Unknown"),
          description: "PRIVATE_LATE_DESCRIPTION",
          outward_description: "PUBLIC_OUTWARD",
        },
      ];
    }),
  );
  return {
    creation,
    artifact,
    bindings,
    turn: startSession({ artifact, bindings, locale: "ja-JP" }).turn,
  };
}

describe("player-facing projection", () => {
  it("projects only outward text from a real early-bound NPC", () => {
    const { creation } = fixture();
    const guide = required(creation.cast?.find((member) => member.key === "guide"));
    guide.who = "@test/guide";
    const character = level0Character({
      id: tid("cr", 934),
      ref: "@test/guide",
      display_name: "Guide",
      fragments: [
        {
          id: "outside",
          kind: "character",
          stable: true,
          outward: true,
          content: { type: "text", text: "PUBLIC_PORTRAIT" },
        },
        {
          id: "inside",
          kind: "character",
          stable: true,
          content: { type: "text", text: "PRIVATE_PORTRAIT" },
        },
      ],
    });
    const dependency = {
      creation: character,
      release: tid("rel", 934),
      visibility: "public" as const,
    };
    creation.references = [
      {
        id: "guide",
        use: "@test/guide",
        mode: "intrinsic",
        pin: {
          release: dependency.release,
          semantic_digest: canonicalizeCreation(character).semantic_digest,
        },
      },
    ];
    const artifact = buildTestCreation({
      root: { creation, release: tid("rel", 931), visibility: "public" },
      dependencies: [dependency],
    }).artifact;
    if (artifact.kind !== "content") throw new Error("Content required");
    const bindings = Object.fromEntries(
      artifact.ir.late_slots.map((slot) => [
        slot.key,
        { kind: required(slot.accepts[0]), display_name: slot.key },
      ]),
    );
    const turn = startSession({ artifact, bindings }).turn;
    expect(projectPlayerView({ artifact, turn }).participants[0]?.portrait).toBe("PUBLIC_PORTRAIT");
    expect(JSON.stringify(projectPlayerView({ artifact, turn }))).not.toContain("PRIVATE_PORTRAIT");
  });

  it("returns only current public NPCs, explicitly known clues and reached visible milestones", () => {
    const input = fixture();
    const view = projectPlayerView(input);
    expect(view.player).toMatchObject({
      cast_key: "hero",
      name: "hero",
      present: true,
      part: "訪問者",
    });
    expect(view.scene).toEqual({
      id: "hall",
      title: "広間",
      description: "Current situation",
      time: "Evening",
      where: "Inn",
    });
    expect(view.participants).toEqual([
      {
        key: input.artifact.story_refs?.participants.guide,
        cast_key: "guide",
        name: "guide",
        present: true,
        part: "Guide",
        portrait: "PUBLIC_OUTWARD",
      },
    ]);
    expect(view.known).toEqual([
      { id: expect.stringContaining("#known~"), title: "手掛かり", text: "KNOWN hero" },
    ]);
    expect(view.choices).toEqual([{ id: "free", label: "Ask a question" }]);
    expect(view.milestones).toEqual([{ kind: "beat", id: "public", title: "Introduced" }]);
    expect(JSON.stringify(view)).not.toMatch(
      /SECRET_|PRIVATE_|FUTURE_|DISCOVERABLE_|knowing|vars|judgments/,
    );
  });

  it("adds information only after a real Core learn effect and retains exact state ownership", () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const state = {
      ...required(input.turn.story),
      scene: required(input.turn.scene),
      present: required(input.turn.present),
    };
    const after = confirm(
      required(input.artifact.story),
      Object.keys(required(input.artifact.story_refs).participants),
      state,
      "beat/share",
    );
    const view = projectPlayerView({
      ...input,
      turn: { ...input.turn, story: toTurnStory(after) },
    });
    expect(view.known.map((item) => item.text)).toEqual(["KNOWN hero", "SECRET_TO_LEARN"]);
    expect(view.milestones.map((item) => item.id)).toEqual(["public", "share"]);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("uses provided Core judgments and does not guess an unknown choice", () => {
    const input = fixture();
    const judgments = [
      {
        target: "choice/judged",
        path: "/when",
        result: "true" as const,
        provider: { name: "fixed", version: "1" },
      },
    ];
    expect(
      projectPlayerView({ ...input, turn: { ...input.turn, judgments } }).choices.map((c) => c.id),
    ).toEqual(["free", "judged"]);
  });

  it("keeps legacy implicit user semantics without inventing cast control or player knowledge", () => {
    const input = fixture(true);
    const view = projectPlayerView(input);
    expect(view.player).toEqual({ key: "user", name: "Human", present: null });
    expect(view.known).toEqual([]);
    expect(view.participants.map((p) => p.cast_key)).toEqual(
      expect.arrayContaining(["hero", "guide"]),
    );
  });

  it("preserves user and cast templates and marks the actual controlled input speaker", () => {
    const input = fixture();
    expect(input.turn.history[0]?.text).toBe("Hello Human, you control hero.");
    const turn = {
      ...input.turn,
      history: [...input.turn.history, playerInputMessage(input.artifact, "I choose to ask.")],
    };
    const result = assemble({ artifact: input.artifact, profile: profile(), turn });
    expect(result.messages.some((m) => m.content.includes("Human=Human; hero=hero"))).toBe(true);
    expect(result.messages.find((m) => m.role === "user")?.content).toBe("hero: I choose to ask.");
    expect(
      result.messages.find((m) => m.source.includes("session:player-control"))?.content,
    ).toContain('The player controls "hero"');
    expect(result.trace.entries).toContainEqual(
      expect.objectContaining({
        id: "session:player-control",
        decision: "included",
        reason: "required",
      }),
    );
    expect(() =>
      assemble({
        artifact: input.artifact,
        profile: profile({ context_window: 1, reserve_for_output: 0 }),
        turn,
      }),
    ).toThrow();
  });

  it("rejects an unlabelled or wrong user speaker for an explicitly controlled story", () => {
    const input = fixture();
    const controlled = required(resolveStoryPlayer(input.artifact));
    for (const speaker of [undefined, "user", input.artifact.story_refs?.participants.guide]) {
      const message = { role: "user" as const, text: "Attempt", ...(speaker ? { speaker } : {}) };
      expect(() =>
        projectPlayerView({ ...input, turn: { ...input.turn, history: [message] } }),
      ).toThrowError(expect.objectContaining({ code: "story.player_speaker_mismatch" }));
    }
    expect(() =>
      projectPlayerView({
        ...input,
        turn: {
          ...input.turn,
          history: [{ role: "user", text: "Correct", speaker: controlled.participant }],
        },
      }),
    ).not.toThrow();
  });
});
