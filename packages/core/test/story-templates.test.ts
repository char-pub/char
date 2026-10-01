import { describe, expect, it } from "vitest";
import { canonicalizeCreation } from "../src/canonical.js";
import { checkCreation } from "../src/check.js";
import { resolve } from "../src/resolve/index.js";
import { CompiledTemplateSchema } from "../src/schema/catalog.js";
import { type CreationInput, CreationSchema } from "../src/schema/creation.js";
import { LocalizedTemplateTextSchema } from "../src/schema/text.js";
import { buildTestCreation } from "./build.js";
import { level0Character, tid } from "./fixtures.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture value");
  return value;
}

function fixture() {
  const actor = canonicalizeCreation(
    level0Character({
      ref: "@djj/alice",
      display_name: { en: "Alice", "zh-CN": "爱丽丝" },
      assets: [],
      bootstrap: undefined,
    }),
  );
  const child = {
    release: tid("rel", 71),
    visibility: "public" as const,
    creation: actor.json,
    semantic_digest: actor.semantic_digest,
  };
  const creation: CreationInput = {
    id: tid("cr", 72),
    ref: "@djj/localized-inn",
    type: "scenario",
    display_name: "Inn",
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    references: [
      {
        id: "alice",
        use: "@djj/alice",
        mode: "intrinsic",
        pin: { release: child.release, semantic_digest: child.semantic_digest },
      },
    ],
    cast: [
      { key: "alice", who: "@djj/alice" },
      { key: "guest", who: { late: "persona" } },
    ],
    story: {
      version: 1,
      scenes: [
        {
          id: "lobby",
          title: "Lobby",
          opening: {
            en: "{{cast:alice}} waits for {{cast:guest}}.",
            "zh-CN": "{{cast:alice}}等待{{cast:guest}}。",
          },
        },
      ],
      starts: [
        {
          id: "arrive",
          greeting: {
            en: "{{cast:alice}} says hello to {{cast:guest}}.",
            "zh-CN": "{{cast:alice}}向{{cast:guest}}问好。",
          },
        },
      ],
    },
  };
  return {
    creation,
    child,
    input: {
      root: { release: tid("rel", 72), visibility: "public" as const, creation },
      dependencies: [child],
    },
  };
}

describe("localized story templates", () => {
  it("compiles every authored locale with localized early names and one tracked late identity", () => {
    const { input } = fixture();
    const { artifact } = buildTestCreation(input);
    if (artifact.kind !== "content") throw new Error("expected content");
    const guest = artifact.ir.participants.find((p) => p.cast_key === "guest");
    expect(guest?.late).toBeDefined();
    const late = `{{late:${guest?.late}}}`;
    expect(artifact.story_refs?.templates).toEqual({
      "scene/lobby/opening": {
        text: `Alice waits for ${late}.`,
        locales: { "zh-CN": `爱丽丝等待${late}。` },
      },
      "start/arrive/greeting": {
        text: `Alice says hello to ${late}.`,
        locales: { "zh-CN": `爱丽丝向${late}问好。` },
      },
    });
    expect(artifact.ir.late_slots.find((slot) => slot.key === guest?.late)?.used_by).toEqual([
      "scene/lobby/opening",
      "start/arrive/greeting",
    ]);
    expect(buildTestCreation(input).json).toBe(buildTestCreation(input).json);
    expect(checkCreation(canonicalizeCreation(input.root.creation).creation).ok).toBe(true);
  });

  it("retains plain strings and omits an empty compiled locale collection", () => {
    const { creation, input } = fixture();
    if (!creation.story) throw new Error("story missing");
    required(creation.story.scenes[0]).opening = "{{cast:alice}} arrives.";
    required(creation.story.starts?.[0]).greeting = { en: "Hello." };
    expect(resolve(input).story_templates).toEqual({
      "scene/lobby/opening": { text: "Alice arrives." },
      "start/arrive/greeting": { text: "Hello." },
    });
    expect(CompiledTemplateSchema.safeParse("Hello.").success).toBe(false);
  });

  it("requires the declared default locale and checks templates in every translation", () => {
    const { creation, input } = fixture();
    if (!creation.story) throw new Error("story missing");
    required(creation.story.scenes[0]).opening = { "zh-CN": "只有中文。" };
    const checked = checkCreation(canonicalizeCreation(creation).creation);
    expect(checked.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "check.template_default_locale_missing",
        subject: "story.scenes[lobby].opening",
      }),
    );
    expect(() => resolve(input)).toThrowError(
      expect.objectContaining({
        code: "resolve.template_default_locale_missing",
        subject: "scene/lobby/opening",
      }),
    );
    required(creation.story.scenes[0]).opening = { en: "Fine", "zh-CN": "{{cast:missing}}" };
    expect(checkCreation(canonicalizeCreation(creation).creation).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "check.unknown_cast",
        subject: "story.scenes[lobby].opening[zh-CN]",
      }),
    );
    expect(() => resolve(input)).toThrowError(
      expect.objectContaining({ code: "resolve.unknown_cast" }),
    );
    required(creation.story.scenes[0]).opening = { en: "Fine", "zh-CN": "Fine" };
    required(creation.story.starts?.[0]).greeting = { "zh-CN": "你好" };
    expect(checkCreation(canonicalizeCreation(creation).creation).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "check.template_default_locale_missing",
        subject: "story.starts[arrive].greeting",
      }),
    );
    expect(() => resolve(input)).toThrowError(
      expect.objectContaining({
        code: "resolve.template_default_locale_missing",
        subject: "start/arrive/greeting",
      }),
    );
  });

  it("reserves ref for a bootstrap reference and does not compile the greeting twice", () => {
    const { creation, input } = fixture();
    if (!creation.story) throw new Error("story missing");
    creation.bootstrap = {
      greetings: [
        {
          id: "welcome",
          text: "{{cast:alice}} welcomes {{user}}.",
          locale: { "zh-CN": { content: { type: "text", text: "{{cast:alice}}欢迎{{user}}。" } } },
        },
      ],
    };
    required(creation.story.starts?.[0]).greeting = { ref: "welcome" };
    const output = resolve(input);
    expect(output.story_templates).not.toHaveProperty("start/arrive/greeting");
    expect(output.ir.bootstrap.greetings[0]).toEqual({
      id: "welcome",
      text: "Alice welcomes {{late:user}}.",
      locales: { "zh-CN": "爱丽丝欢迎{{late:user}}。" },
    });
    expect(output.ir.participants.some((p) => p.key === "self")).toBe(false);
    expect(output.ir.late_slots.find((slot) => slot.key === "user")?.used_by).toEqual([
      "bootstrap:welcome",
    ]);
    expect(checkCreation(canonicalizeCreation(creation).creation).ok).toBe(true);
    required(creation.story.starts?.[0]).greeting = { ref: "unknown" };
    expect(checkCreation(canonicalizeCreation(creation).creation).diagnostics).toContainEqual(
      expect.objectContaining({ code: "story.unknown_greeting" }),
    );
    for (const value of [{}, { ref: "welcome" }, { ref: "welcome", en: "Hello" }])
      expect(LocalizedTemplateTextSchema.safeParse(value).success).toBe(false);
    required(creation.story.starts?.[0]).greeting = { ref: "welcome", en: "Hello" };
    expect(CreationSchema.safeParse(creation).success).toBe(false);
  });

  it("normalizes localized templates in canonical identity and includes every variant in the digest", () => {
    const { creation } = fixture();
    if (!creation.story) throw new Error("story missing");
    required(creation.story.scenes[0]).opening = { en: "Cafe\u0301  \r\n", "zh-CN": "你好" };
    const before = canonicalizeCreation(creation);
    required(creation.story.scenes[0]).opening = { "zh-CN": "你好", en: "Café\n" };
    expect(canonicalizeCreation(creation).semantic_digest).toBe(before.semantic_digest);
    expect(canonicalizeCreation(before.json).semantic_digest).toBe(before.semantic_digest);
    required(creation.story.scenes[0]).opening = { "zh-CN": "再见", en: "Café\n" };
    expect(canonicalizeCreation(creation).semantic_digest).not.toBe(before.semantic_digest);
  });
});
