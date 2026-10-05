import type { CreationInput } from "@char-pub/core";
import { describe, expect, it } from "vitest";
import { buildTestCreation } from "../../core/test/build.js";
import { tid } from "../../core/test/fixtures.js";
import { assemble, initialStoryTurn, startSession } from "../src/index.js";
import { profile } from "./fixtures/ir.js";

function fixture() {
  const creation: CreationInput = {
    id: tid("cr", 801),
    ref: "@test/arrivals",
    type: "scenario",
    display_name: "Arrivals",
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    cast: [{ key: "host", who: { late: "character" } }],
    bootstrap: {
      greetings: [
        { id: "default", text: "Welcome, {{user}}." },
        {
          id: "blackout",
          text: "Lights out, {{user}}.",
          locale: { ja: { content: { type: "text", text: "停電だ、{{user}}。" } } },
        },
        { id: "legacy", text: "LEGACY_ONLY" },
      ],
    },
    story: {
      version: 1,
      scenes: [
        {
          id: "lobby",
          title: "Lobby",
          opening: {
            en: "SCENE_ONLY {{cast:host}} is waiting.",
            ja: "場面：{{cast:host}}が待っています。",
          },
          when: { is: "var/open" },
        },
      ],
      vars: { open: { type: "bool", init: false, description: "Door open" } },
      starts: [
        {
          id: "guest",
          title: "Guest",
          description: "Walk in",
          set: [{ set: ["var/open", true] }],
          greeting: {
            en: "Hello {{user}}, meet {{cast:host}}.",
            ja: "{{user}}さん、{{cast:host}}です。",
          },
        },
        {
          id: "storm",
          title: "Storm",
          description: "Blackout",
          set: [{ set: ["var/open", true] }],
          greeting: { ref: "blackout" },
        },
        {
          id: "plain",
          title: "Plain",
          description: "Default greeting",
          set: [{ set: ["var/open", true] }],
        },
      ],
    },
  };
  const build = () => {
    const { artifact } = buildTestCreation({
      root: { creation, release: tid("rel", 801), visibility: "public" },
    });
    if (artifact.kind !== "content") throw new Error("Content required");
    const bindings = Object.fromEntries(
      artifact.ir.late_slots.map((s) => [
        s.key,
        { kind: s.accepts[0] ?? "persona", display_name: s.key === "user" ? "Kai" : "Rin" },
      ]),
    );
    return { artifact, bindings };
  };
  return { creation, build };
}

describe("Story session initialization", () => {
  it("applies opening state once and places only the chosen greeting in history", () => {
    const { build } = fixture();
    const input = { ...build(), start: "guest" };
    const before = JSON.stringify(input);
    const result = startSession(input);
    expect(result.turn.story).toMatchObject({
      start: "guest",
      visited: ["lobby"],
      vars: { open: true },
    });
    expect(result.opening).toEqual({
      role: "assistant",
      content: "Hello Kai, meet Rin.",
      source: { kind: "story-start", id: "guest" },
      locale_fallback: false,
    });
    expect(result.turn.history).toEqual([{ role: "assistant", text: "Hello Kai, meet Rin." }]);
    expect(result.turn.locale).toBe("en");
    expect(JSON.stringify(result.turn.history)).not.toContain("SCENE_ONLY");
    expect(JSON.stringify(input)).toBe(before);
    const prepared = assemble({
      artifact: input.artifact,
      profile: profile({ locale: "ja" }),
      turn: result.turn,
    });
    expect(prepared.messages.some((m) => m.content.includes("SCENE_ONLY Rin"))).toBe(true);
    expect(prepared.messages.filter((m) => m.role === "assistant")).toEqual([
      { role: "assistant", content: "Hello Kai, meet Rin.", source: ["history"] },
    ]);
  });
  it("uses inline and referenced translations with locale lookup and explicit fallback", () => {
    const { build } = fixture();
    const input = build();
    expect(startSession({ ...input, start: "guest", locale: "ja-JP" }).opening).toMatchObject({
      content: "Kaiさん、Rinです。",
      locale_fallback: false,
    });
    expect(startSession({ ...input, start: "storm", locale: "ja" }).opening).toMatchObject({
      content: "停電だ、Kai。",
      source: { kind: "bootstrap", id: "blackout" },
    });
    expect(startSession({ ...input, start: "guest", locale: "fr" }).opening).toMatchObject({
      content: "Hello Kai, meet Rin.",
      locale_fallback: true,
    });
    const initialized = startSession({ ...input, start: "guest", locale: "ja" });
    const result = assemble({
      artifact: input.artifact,
      profile: profile(),
      turn: initialized.turn,
    });
    expect(result.messages.some((m) => m.content.includes("場面：Rinが待っています。"))).toBe(true);
  });
  it("falls back to bootstrap default but does not expose unrelated alternate greetings", () => {
    const { build } = fixture();
    const input = build();
    expect(startSession({ ...input, start: "plain" }).opening?.content).toBe("Welcome, Kai.");
    expect(() => startSession(input)).toThrowError(
      expect.objectContaining({ code: "story.start_required" }),
    );
    expect(() => initialStoryTurn(input.artifact)).toThrowError(
      expect.objectContaining({ code: "story.start_required" }),
    );
    expect(initialStoryTurn(input.artifact, "guest").story?.start).toBe("guest");
    expect(() => startSession({ ...input, start: "missing" })).toThrowError(
      expect.objectContaining({ code: "story.unknown_start" }),
    );
    expect(() => startSession({ ...input, start: "guest", greeting_id: "legacy" })).toThrowError(
      expect.objectContaining({ code: "story.greeting_requires_start" }),
    );
  });
  it("initializes a sole implicit start without inventing a greeting or speaker", () => {
    const { creation, build } = fixture();
    delete creation.bootstrap;
    if (!creation.story) throw new Error("Story required");
    delete creation.story.starts;
    delete creation.story.scenes[0]?.when;
    const result = startSession(build());
    expect(result.opening).toBeNull();
    expect(result.turn.history).toEqual([]);
    expect(result.turn.story?.start).toBe("default");
  });
  it("refuses to initialize an unsatisfied scene and accepts an explicit trusted judgment", () => {
    const { creation, build } = fixture();
    if (!creation.story) throw new Error("Story required");
    const scene = creation.story.scenes[0];
    if (!scene) throw new Error("Scene required");
    scene.when = { judge: "The guest may enter" };
    const input = { ...build(), start: "guest" };
    expect(() => startSession(input)).toThrowError(
      expect.objectContaining({ code: "story.condition_unsatisfied" }),
    );
    const judgments = [
      {
        target: "scene/lobby",
        path: "/when",
        result: "true" as const,
        provider: { name: "fixed", version: "1" },
      },
    ];
    expect(startSession({ ...input, judgments }).turn.story?.visited).toEqual(["lobby"]);
    expect(() => startSession({ ...input, judgments, history: [] } as never)).toThrowError(
      expect.objectContaining({ code: "assemble.invalid_input" }),
    );
  });
});
