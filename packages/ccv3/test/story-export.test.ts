import {
  buildCreation,
  type CreationArtifact,
  type CreationInput,
  canonicalizeCreation,
  PRESET_REGIONS,
  resolvePreset,
} from "@char-pub/core";
import { describe, expect, it } from "vitest";
import { exportCCv3 } from "../src/export.js";

const meta = {
  default_locale: "en",
  rating: "general",
  rights: "original",
  license: "CC0-1.0",
} as const;
function release(creation: CreationInput, suffix: string) {
  const canonical = canonicalizeCreation(creation);
  return {
    release: `rel_01h455vb4pex5vsknk084sn${suffix}`,
    visibility: "public" as const,
    creation: canonical.creation,
    semantic_digest: canonical.semantic_digest,
  };
}
function fixture() {
  const policy = release(
    {
      id: "cr_01h455vb4pex5vsknk084sn0pp",
      ref: "@fixture/policy",
      type: "preset",
      display_name: "Policy",
      authors: [{ name: "Policy Writer" }],
      meta: { ...meta, rating: "teen", content_warnings: ["fear"] },
      policy: {
        version: "1-draft",
        blocks: [{ id: "guide", text: "Do not decide for the player.", default_at: "main" }],
        layout: [...PRESET_REGIONS],
        requires: { system_role: true },
      },
    },
    "0pp",
  );
  const actor = release(
    {
      id: "cr_01h455vb4pex5vsknk084sn0aa",
      ref: "@fixture/alice",
      type: "character",
      display_name: { en: "Alice", "zh-CN": "爱丽丝" },
      meta,
      fragments: [
        {
          id: "identity",
          kind: "character",
          stable: true,
          outward: true,
          content: { type: "text", text: "A careful owner." },
          locale: { "zh-CN": { content: { type: "text", text: "谨慎的老板。" } } },
        },
      ],
    },
    "0aa",
  );
  const creation: CreationInput = {
    id: "cr_01h455vb4pex5vsknk084sn0ss",
    ref: "@fixture/inn",
    type: "scenario",
    display_name: "Inn",
    meta,
    references: [
      {
        id: "alice",
        use: actor.creation.ref,
        mode: "intrinsic",
        pin: { release: actor.release, semantic_digest: actor.semantic_digest },
      },
    ],
    cast: [
      {
        key: "alice",
        who: actor.creation.ref,
        part: { en: "Owner", "zh-CN": "老板" },
        goal: { en: "Protect the guest", "zh-CN": "保护住客" },
      },
    ],
    bootstrap: {
      greetings: [
        {
          id: "fallback",
          text: "Default hello.",
          locale: { "zh-CN": { content: { type: "text", text: "默认问候。" } } },
        },
        {
          id: "welcome",
          text: "Welcome {{user}}.",
          locale: { "zh-CN": { content: { type: "text", text: "欢迎{{user}}。" } } },
        },
        { id: "unused", text: "Unused greeting." },
      ],
    },
    story: {
      version: 1,
      scenes: [
        { id: "unused", title: "Unused scene", opening: "Do not export this scene opening." },
        {
          id: "lobby",
          title: "Lobby",
          opening: { en: "{{cast:alice}} waits by the door.", "zh-CN": "{{cast:alice}}等在门口。" },
          goals: { alice: { en: "Find the key", "zh-CN": "找到钥匙" } },
        },
      ],
      starts: [
        {
          id: "inline",
          title: "Inline",
          description: "Inline opening",
          scene: "lobby",
          greeting: {
            en: "{{cast:alice}} waves to {{user}}.",
            "zh-CN": "{{cast:alice}}向{{user}}招手。",
          },
        },
        {
          id: "reference",
          title: "Reference",
          description: "Existing greeting",
          scene: "lobby",
          greeting: { ref: "welcome" },
        },
        { id: "fallback", title: "Fallback", description: "Default greeting", scene: "lobby" },
      ],
    },
  };
  const input = () => ({
    root: { creation, release: "rel_01h455vb4pex5vsknk084sn0ss", visibility: "public" as const },
    dependencies: [actor, policy],
    default_policy: {
      ref: policy.creation.ref,
      release: policy.release,
      semantic_digest: policy.semantic_digest,
    },
  });
  const build = () => {
    const artifact = buildCreation(input()).artifact;
    if (artifact.kind !== "content") throw new Error("expected content");
    return artifact;
  };
  return { creation, policy, actor, input, build };
}

describe("complete artifact CCv3 story export", () => {
  it("maps actual start greetings in order and keeps scene opening in scenario", () => {
    const { build } = fixture();
    const { card, loss } = exportCCv3(build());
    expect(card.data.first_mes).toBe("Alice waves to {{user}}.");
    expect(card.data.alternate_greetings).toEqual(["Welcome {{user}}.", "Default hello."]);
    expect(card.data.scenario).toContain("Alice waits by the door.");
    expect(card.data.scenario).toContain("Alice: Owner");
    expect(card.data.scenario).toContain("Protect the guest");
    expect(card.data.scenario).toContain("Find the key");
    expect(card.data.scenario).not.toContain("Do not export this scene opening.");
    expect(card.data.first_mes).not.toContain("waits by the door");
    expect(loss.other).toContainEqual(expect.objectContaining({ subject: "story.scenes[unused]" }));
    expect(loss.other).toContainEqual(
      expect.objectContaining({ subject: "bootstrap.greetings[unused]" }),
    );
  });

  it("exports localized compiled starts, referenced bootstrap and fragment bodies", () => {
    const { card, loss } = exportCCv3(fixture().build(), { locale: "zh-CN" });
    expect(card.data.first_mes).toBe("爱丽丝向{{user}}招手。");
    expect(card.data.alternate_greetings).toEqual(["欢迎{{user}}。", "默认问候。"]);
    expect(card.data.scenario).toContain("爱丽丝等在门口。");
    expect(card.data.scenario).toContain("爱丽丝: 老板");
    expect(card.data.character_book?.entries[0]?.content).toBe("谨慎的老板。");
    expect(loss.locales).toEqual({ exported: "zh-CN", dropped: ["en"] });
    const regional = exportCCv3(fixture().build(), { locale: "zh-cn-x-test" });
    expect(regional.card.data.first_mes).toBe("爱丽丝向{{user}}招手。");
    expect(regional.loss.locales.dropped).toEqual(["en"]);
    const fallback = exportCCv3(fixture().build(), { locale: "fr" });
    expect(fallback.card.data.first_mes).toBe("Alice waves to {{user}}.");
    expect(fallback.loss.other).toContainEqual(
      expect.objectContaining({
        subject: "start/inline/greeting",
        detail: expect.stringContaining("unavailable"),
      }),
    );
  });

  it("keeps the first no-message start empty rather than promoting a later greeting", () => {
    const f = fixture();
    f.creation.bootstrap = undefined;
    if (!f.creation.story) throw new Error("story missing");
    f.creation.story.starts = [
      { id: "silent", title: "Silent", description: "No message", scene: "lobby" },
      {
        id: "hello",
        title: "Hello",
        description: "Message",
        scene: "lobby",
        greeting: "Later greeting.",
      },
    ];
    const result = exportCCv3(f.build());
    expect(result.card.data.first_mes).toBe("");
    expect(result.card.data.alternate_greetings).toEqual(["Later greeting."]);
    f.creation.story.starts = undefined;
    const implicit = exportCCv3(f.build());
    expect(implicit.card.data.first_mes).toBe("");
    expect(implicit.card.data.alternate_greetings).toEqual([]);
    const withBootstrap = fixture();
    if (!withBootstrap.creation.story) throw new Error("story missing");
    withBootstrap.creation.story.starts = undefined;
    expect(exportCCv3(withBootstrap.build()).card.data.first_mes).toBe("Default hello.");
    expect(exportCCv3(withBootstrap.build()).card.data.alternate_greetings).toEqual([]);
  });

  it("uses locked default policy and aggregate metadata, and honors explicit overrides", () => {
    const f = fixture();
    const artifact = f.build();
    const result = exportCCv3(artifact);
    expect(result.card.data.system_prompt).toBe("Do not decide for the player.");
    expect(result.card.data.creator_notes).toContain("Rating: teen");
    expect(result.card.data.creator_notes).toContain("@fixture/policy: Policy Writer");
    expect(result.card.data.creator_notes).toContain("Content warnings: fear");
    expect(
      result.loss.other.some(
        (item) => item.subject === "policy.attribution" || item.subject === "policy.rating",
      ),
    ).toBe(false);
    expect(result.card.data.extensions.char_pub).toMatchObject({
      lock_digest: artifact.lock_digest,
      preset: { release: f.policy.release, semantic_digest: f.policy.semantic_digest },
    });
    expect(
      exportCCv3(artifact, { preset: { system_prompt: "Explicit text" } }).card.data.system_prompt,
    ).toBe("Explicit text");
    const preset = resolvePreset({
      creation: f.policy.creation,
      release: f.policy.release,
      semantic_digest: f.policy.semantic_digest,
    });
    const explicit = exportCCv3(artifact, { resolvedPreset: preset });
    expect(explicit.loss.other.some((item) => item.subject === "policy.rating")).toBe(true);
    if (!("release" in preset)) throw new Error("Expected a released policy fixture");
    const assemblyArtifact = {
      ...artifact,
      assembly: {
        version: "1-draft" as const,
        preset,
        profile: {
          runtime: { name: "test", version: "1" },
          tokenizer: "estimate",
          context_window: 4096,
          reserve_for_output: 128,
          mode: "narrator" as const,
          capabilities: { system_role: true },
        },
        assembler: { name: "test", version: "1" },
        tokenizer: { name: "estimate", version: "1" },
      },
    };
    const { default_policy: _default, ...locked } = assemblyArtifact;
    expect(exportCCv3(locked).card.data.system_prompt).toBe("Do not decide for the player.");
  });

  it("rejects standalone IR and non-content artifacts", () => {
    const f = fixture();
    expect(() => exportCCv3(f.build().ir as unknown as CreationArtifact)).toThrowError(
      expect.objectContaining({ code: "ccv3.invalid_artifact" }),
    );
    const preset = buildCreation({ root: f.policy }).artifact;
    expect(() => exportCCv3(preset)).toThrowError(
      expect.objectContaining({ code: "ccv3.content_required" }),
    );
  });

  it("fails clearly when compiled story templates or referenced greetings are missing", () => {
    const missingTemplate = fixture().build();
    if (!missingTemplate.story_refs) throw new Error("story refs missing");
    delete missingTemplate.story_refs.templates["start/inline/greeting"];
    expect(() => exportCCv3(missingTemplate)).toThrowError(
      expect.objectContaining({ code: "ccv3.story_template_missing" }),
    );
    const missingGreeting = fixture().build();
    missingGreeting.ir.bootstrap.greetings = [];
    expect(() => exportCCv3(missingGreeting)).toThrowError(
      expect.objectContaining({ code: "ccv3.greeting_missing" }),
    );
  });

  it("reports discarded narrative, knowledge and source structures and preserves perspective labels", () => {
    const f = fixture();
    const story = f.creation.story;
    if (!story) throw new Error("story missing");
    f.creation.fragments = [
      {
        id: "secret",
        kind: "knowledge",
        stable: true,
        perspective: "rumor",
        description: "A rumor about the door",
        content: { type: "text", text: "The door is haunted." },
      },
    ];
    f.creation.groups = [
      { id: "secrets", title: "Secrets", description: "Door rumors", entries: ["secret"] },
    ];
    f.creation.assets = [
      {
        slot: "handbook",
        role: "context",
        variants: [
          {
            id: "default",
            media_type: "text/plain",
            blob: {
              digest: `sha256:${"a".repeat(64)}`,
              size: 123,
              availability: "mirrored",
            },
          },
        ],
      },
    ];
    f.creation.sources = [
      {
        id: "handbook",
        title: "Handbook",
        description: "Reference book",
        asset: "handbook",
        format: "text",
      },
    ];
    story.beats = [{ id: "discovery", title: "Discovery", description: "Find the clue" }];
    story.endings = [{ id: "leave", title: "Leave", description: "Leave the inn", after: "stop" }];
    story.plotlines = [{ id: "mystery", title: "Mystery", beats: ["discovery"] }];
    story.choices = [{ id: "ask", label: "Ask", intent: "Ask about the door" }];
    const lobby = story.scenes.find((scene) => scene.id === "lobby");
    if (!lobby) throw new Error("lobby missing");
    lobby.choices = ["ask"];
    story.vars = { trust: { type: "int", init: 0, min: 0, max: 10, description: "Trust" } };
    story.items = [{ id: "key", title: "Key", description: "Brass key" }];
    story.events = [
      {
        id: "arrival",
        title: "Arrival",
        description: "Alice arrived",
        kind: "background",
        truth: "#secret",
      },
    ];
    story.timelines = [{ id: "past", title: "Past", order: ["arrival"] }];
    story.knowing = { "#secret": { start: { knows: ["alice"] } } };
    const start = story.starts?.[0];
    if (!start) throw new Error("start missing");
    start.set = [{ set: ["var/trust", 4] }];
    start.reached = ["discovery"];
    const { card, loss } = exportCCv3(f.build());
    expect(card.data.description).toContain("Rumor:\nThe door is haunted.");
    expect(loss.other.map((item) => item.subject)).toEqual(
      expect.arrayContaining([
        "story.beats[discovery]",
        "story.endings[leave]",
        "story.plotlines[mystery]",
        "story.choices[ask]",
        "story.vars[trust]",
        "story.items[key]",
        "story.events[arrival]",
        "story.timelines[past]",
        "story.knowing[#secret]",
        "story.starts[inline].set",
        "story.starts[inline].reached",
        "@fixture/inn#group/secrets~root",
        "@fixture/inn#source/handbook~root",
        "@fixture/inn#secret~root.perspective",
        "@fixture/inn#secret~root.description",
      ]),
    );
    expect(loss.other.some((item) => item.subject.endsWith(".outward"))).toBe(true);
    expect(card.data.description).not.toContain("Reference book");
    const entry = f.creation.fragments?.[0];
    if (!entry) throw new Error("secret missing");
    entry.activation = { mode: "keyword", keys: ["door"] };
    entry.selectable = true;
    entry.about = ["@fixture/alice"];
    entry.source = { use: "#handbook" };
    const keyword = exportCCv3(f.build());
    expect(
      keyword.card.data.character_book?.entries.find((item) => item.name === "secret"),
    ).toMatchObject({ keys: ["door"], constant: false, content: "Rumor:\nThe door is haunted." });
    expect(keyword.loss.other).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subject: "@fixture/inn#secret~root.selectable",
          detail: expect.stringContaining("without a keyword hit"),
        }),
        expect.objectContaining({
          subject: "@fixture/inn#secret~root.about",
          detail: expect.stringContaining("associations dropped"),
        }),
        expect.objectContaining({
          subject: "@fixture/inn#secret~root.source",
          detail: expect.stringContaining("#handbook"),
        }),
      ]),
    );
  });
});
