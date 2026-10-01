import { describe, expect, it } from "vitest";
import { buildCreation } from "../src/build.js";
import { canonicalizeCreation } from "../src/canonical.js";
import { checkCapabilitySupport, deriveCapabilities } from "../src/capabilities.js";
import { checkPublish } from "../src/publish.js";
import { CreationArtifactSchema } from "../src/schema/artifact.js";
import { CapabilitiesSchema } from "../src/schema/capabilities.js";
import type { CreationInput } from "../src/schema/creation.js";
import { buildTestCreation, TEST_DEFAULT_POLICY, withTestDefault } from "./build.js";
import { D, level0Character, tid } from "./fixtures.js";

function release(creation: CreationInput, n = 1) {
  return {
    creation,
    release: tid("rel", n),
    visibility: "public" as const,
    semantic_digest: canonicalizeCreation(creation).semantic_digest,
  };
}
function character(extra: Partial<CreationInput> = {}) {
  return level0Character({ assets: [], bootstrap: undefined, ...extra });
}
function scene(extra: Partial<CreationInput> = {}): CreationInput {
  return {
    id: tid("cr", 2),
    ref: "@test/scene",
    type: "scenario",
    display_name: "Scene",
    meta: character().meta,
    cast: [{ key: "guest", who: { late: "persona" } }],
    story: { version: 1, scenes: [{ id: "lobby", title: "Lobby" }] },
    ...extra,
  };
}
const ids = (artifact: ReturnType<typeof buildCreation>["artifact"]) =>
  artifact.capabilities.map((c) => c.id);

describe("published capability derivation", () => {
  it("does not label ordinary prose as discovery and requires author-independent sorted metadata", () => {
    const root = release(character());
    const { artifact, json } = buildTestCreation({ root });
    expect(artifact.capabilities).toEqual([{ id: "policy.1-draft" }]);
    expect(JSON.parse(json).capabilities).toEqual(artifact.capabilities);
    expect(deriveCapabilities(artifact)).toEqual(artifact.capabilities);
    expect(() =>
      canonicalizeCreation({ ...root.creation, capabilities: [{ id: "story.v1" }] }),
    ).toThrow();
    const { capabilities: _capabilities, ...incomplete } = artifact;
    expect(CreationArtifactSchema.safeParse(incomplete).success).toBe(false);
    expect(CapabilitiesSchema.safeParse([{ id: "z" }, { id: "a" }]).success).toBe(false);
    expect(CapabilitiesSchema.safeParse([{ id: "a" }, { id: "a" }]).success).toBe(false);
    expect(CapabilitiesSchema.safeParse([{ id: "a", experimental: false }]).success).toBe(false);
  });

  it("records emitted discovery metadata, sources and information perspective once", () => {
    const root = release(
      character({
        description: "Character reference",
        fragments: [
          {
            id: "identity",
            kind: "character",
            stable: true,
            outward: true,
            content: { type: "text", text: "A courier." },
          },
          {
            id: "rumor",
            kind: "knowledge",
            stable: true,
            description: "A city rumor",
            selectable: true,
            activation: { mode: "keyword", keys: ["city"] },
            perspective: "rumor",
            content: { type: "text", text: "The city sleeps." },
          },
        ],
        groups: [{ id: "city", title: "City", description: "City entries", entries: ["rumor"] }],
        sources: [
          { id: "book", title: "Book", description: "Reference", format: "text", asset: "book" },
        ],
        assets: [
          {
            slot: "book",
            role: "context",
            variants: [
              {
                id: "default",
                media_type: "text/plain",
                blob: { digest: D("b"), size: 4, availability: "mirrored" },
              },
            ],
          },
        ],
      }),
    );
    expect(buildTestCreation({ root }).artifact.capabilities).toEqual([
      { id: "catalog.v1" },
      { id: "perspective.v1" },
      { id: "policy.1-draft" },
      { id: "sources.v1" },
      { id: "view.outward" },
    ]);
  });

  it.each([
    { summary: "Legacy discovery summary" },
    {
      fragments: [
        {
          id: "identity",
          kind: "character" as const,
          stable: true,
          description: "Description",
          content: { type: "text" as const, text: "A courier." },
        },
      ],
    },
    {
      fragments: [
        {
          id: "identity",
          kind: "character" as const,
          stable: true,
          selectable: true,
          description: "Discoverable fragment",
          activation: { mode: "keyword" as const, keys: ["courier"] },
          content: { type: "text" as const, text: "A courier." },
        },
      ],
    },
  ])("detects catalog metadata independently: %j", (extra) => {
    expect(ids(buildTestCreation({ root: release(character(extra)) }).artifact)).toContain(
      "catalog.v1",
    );
  });

  it("ignores selected-out features, unused snapshots and a dependency's unexposed story", () => {
    const child = release(
      character({
        ref: "@test/child",
        fragments: [
          {
            id: "basic",
            kind: "character",
            stable: true,
            content: { type: "text", text: "A courier." },
          },
          {
            id: "extra",
            kind: "character",
            stable: true,
            description: "Details",
            outward: true,
            perspective: "rumor",
            content: { type: "text", text: "Extra." },
          },
        ],
      }),
      3,
    );
    const unused = release(
      scene({ ref: "@test/unused", description: "Not in this publication" }),
      4,
    );
    const root = release(
      character({
        references: [
          {
            id: "child",
            use: "@test/child",
            mode: "default",
            pin: { release: child.release, semantic_digest: child.semantic_digest },
            select: { include: ["basic"] },
          },
        ],
      }),
    );
    expect(
      buildTestCreation({ root, dependencies: [child, unused] }).artifact.capabilities,
    ).toEqual([{ id: "policy.1-draft" }]);
    const nested = release(
      scene({
        ref: "@test/nested",
        story: { version: 1, scenes: [{ id: "lobby", title: "Lobby", when: { judge: "Ready" } }] },
      }),
      5,
    );
    root.creation.references = [
      {
        id: "nested",
        use: "@test/nested",
        mode: "default",
        pin: { release: nested.release, semantic_digest: nested.semantic_digest },
      },
    ];
    const nestedRoot = release(root.creation);
    expect(
      buildTestCreation({ root: nestedRoot, dependencies: [nested] }).artifact.capabilities,
    ).toEqual([{ id: "policy.1-draft" }]);
  });

  it("uses effective perspective/outward values instead of optional defaults", () => {
    const creation = character();
    const first = creation.fragments?.[0];
    if (!first) throw new Error("fragment missing");
    first.perspective = "canon";
    first.outward = false;
    first.selectable = false;
    expect(buildTestCreation({ root: release(creation) }).artifact.capabilities).toEqual([
      { id: "policy.1-draft" },
    ]);
  });

  it("declares effective cast overrides including a removed fragment", () => {
    const guard = release(
      character({
        ref: "@test/guard",
        fragments: [
          {
            id: "identity",
            kind: "character",
            stable: true,
            content: { type: "text", text: "Guard" },
          },
          {
            id: "secret",
            kind: "knowledge",
            stable: true,
            content: { type: "text", text: "Secret" },
          },
        ],
      }),
      6,
    );
    const creation = scene({
      references: [
        {
          id: "guard",
          use: "@test/guard",
          mode: "default",
          pin: { release: guard.release, semantic_digest: guard.semantic_digest },
        },
      ],
      cast: [{ key: "guard", who: "@test/guard", override: [{ op: "remove", target: "secret" }] }],
    });
    const result = buildTestCreation({ root: release(creation, 2), dependencies: [guard] });
    expect(ids(result.artifact)).toContain("cast.override");
    if (result.artifact.kind !== "content") throw new Error("content missing");
    expect(result.artifact.ir.fragments.some((f) => f.origin.fragment === "secret")).toBe(false);
    expect(result.artifact.ir.graph.removed[0]?.by.cast).toBe("guard");
    const member = creation.cast?.[0];
    if (!member) throw new Error("cast missing");
    member.override = [{ op: "patch", target: "identity", set: { outward: true } }];
    expect(
      ids(buildTestCreation({ root: release(creation, 2), dependencies: [guard] }).artifact),
    ).toEqual(["cast.override", "policy.1-draft", "story.v1", "view.outward"]);
    member.override = [];
    expect(
      ids(buildTestCreation({ root: release(creation, 2), dependencies: [guard] }).artifact),
    ).not.toContain("cast.override");
  });

  it("checks retained style behavior rather than an unused style edge", () => {
    const style = release(
      {
        id: tid("cr", 7),
        ref: "@test/style",
        type: "style",
        display_name: "Style",
        meta: character().meta,
        fragments: [
          {
            id: "voice",
            kind: "style",
            stable: true,
            content: { type: "text", text: "Be concise" },
          },
        ],
      },
      7,
    );
    const creation = scene({
      references: [
        {
          id: "style",
          use: "@test/style",
          mode: "default",
          pin: { release: style.release, semantic_digest: style.semantic_digest },
          scope: { scene: "lobby" },
        },
      ],
    });
    expect(
      ids(buildTestCreation({ root: release(creation, 2), dependencies: [style] }).artifact),
    ).toContain("style.scope");
    const edge = creation.references?.[0];
    if (!edge) throw new Error("edge missing");
    edge.select = { exclude: ["voice"] };
    expect(
      ids(buildTestCreation({ root: release(creation, 2), dependencies: [style] }).artifact),
    ).not.toContain("style.scope");
    edge.select = undefined;
    edge.scope = "narration";
    expect(
      ids(buildTestCreation({ root: release(creation, 2), dependencies: [style] }).artifact),
    ).not.toContain("style.scope");
    edge.combine = "replace";
    expect(
      ids(buildTestCreation({ root: release(creation, 2), dependencies: [style] }).artifact),
    ).toContain("style.scope");
  });

  it("keeps judge-only requirements separate and traverses every story condition/effect location", () => {
    const creation = scene();
    const story = creation.story;
    const lobby = story?.scenes[0];
    if (!story || !lobby) throw new Error("story missing");
    lobby.when = { judge: "Ready" };
    expect(buildTestCreation({ root: release(creation, 2) }).artifact.capabilities).toEqual([
      { id: "policy.1-draft" },
      { id: "story.judge", experimental: true },
      { id: "story.v1" },
    ]);
    lobby.when = { not: { judge: "Ready" } };
    expect(ids(buildTestCreation({ root: release(creation, 2) }).artifact)).toContain(
      "story.conditions",
    );
    creation.cast = [{ key: "guest", who: { late: "persona" } }];
    creation.fragments = [
      { id: "secret", kind: "knowledge", stable: true, content: { type: "text", text: "Secret" } },
    ];
    story.vars = { flag: { type: "bool", init: false, description: "Flag" } };
    story.beats = [
      {
        id: "learn",
        title: "Learn",
        description: "Learn secret",
        effects: [{ learn: { who: "guest", info: "#secret" } }],
      },
    ];
    story.endings = [
      { id: "leave", title: "Leave", description: "Leave", when: { is: "var/flag" } },
    ];
    story.choices = [{ id: "ask", label: "Ask", intent: "Ask", when: { judge: "Can ask" } }];
    lobby.choices = ["ask"];
    story.starts = [{ id: "start", set: [{ set: ["var/flag", true] }] }];
    story.items = [{ id: "key", title: "Key", description: "Key" }];
    story.events = [
      {
        id: "storm",
        title: "Storm",
        description: "Storm",
        kind: "planned",
        when: { all: [] },
        effects: [{ set: ["var/flag", false] }],
      },
    ];
    story.timelines = [{ id: "order", title: "Order", order: ["storm"] }];
    expect(buildTestCreation({ root: release(creation, 2) }).artifact.capabilities).toEqual([
      { id: "policy.1-draft" },
      { id: "story.conditions", experimental: true },
      { id: "story.events", experimental: true },
      { id: "story.items", experimental: true },
      { id: "story.judge", experimental: true },
      { id: "story.knowing", experimental: true },
      { id: "story.v1" },
    ]);
  });

  it("requires both condition evaluation and controlled knowledge state for a knows condition", () => {
    const creation = scene({
      fragments: [
        {
          id: "secret",
          kind: "knowledge",
          stable: true,
          content: { type: "text", text: "Secret" },
        },
      ],
    });
    const lobby = creation.story?.scenes[0];
    if (!lobby) throw new Error("scene missing");
    lobby.when = { knows: { who: "guest", info: "#secret" } };
    if (!creation.story) throw new Error("story missing");
    creation.story.knowing = { "#secret": { start: { not: ["guest"] } } };
    expect(buildTestCreation({ root: release(creation, 2) }).artifact.capabilities).toEqual([
      { id: "policy.1-draft" },
      { id: "story.conditions", experimental: true },
      { id: "story.knowing", experimental: true },
      { id: "story.v1" },
    ]);
  });

  it("declares policy requirements for both policy artifact kinds and uses the same publish build", () => {
    expect(buildCreation({ root: TEST_DEFAULT_POLICY }).artifact.capabilities).toEqual([
      { id: "policy.1-draft" },
    ]);
    const module = release(
      {
        id: tid("cr", 8),
        ref: "@test/module",
        type: "prompt-module",
        display_name: "Module",
        meta: character().meta,
        prompt_module: { version: "1-draft", blocks: [] },
      },
      8,
    );
    expect(buildCreation({ root: module }).artifact.capabilities).toEqual([
      { id: "policy.1-draft" },
    ]);
    const root = release(character({ description: "Discoverable" }));
    const report = checkPublish(
      withTestDefault({
        release: root.release,
        label: "v1",
        visibility: root.visibility,
        creation: root.creation,
        dependencies: [],
        registry: {
          existingLabels: {},
          assetStatus: {},
          blockedDigests: new Set<string>(),
          ownerNamespaces: new Set<string>(),
        },
      }),
    );
    expect(report.ok).toBe(true);
    expect(report.artifact?.capabilities).toEqual(
      buildTestCreation({ root }).artifact.capabilities,
    );
  });

  it("covers experimental initialization and timeline/knowledge declarations without conditions", () => {
    const creation = scene();
    const story = creation.story;
    if (!story) throw new Error("story missing");
    story.vars = { flag: { type: "bool", init: false, description: "Flag" } };
    expect(buildTestCreation({ root: release(creation, 2) }).artifact.capabilities).toEqual([
      { id: "policy.1-draft" },
      { id: "story.conditions", experimental: true },
      { id: "story.v1" },
    ]);
    story.vars = {};
    story.beats = [{ id: "arrived", title: "Arrived", description: "Already here" }];
    story.starts = [{ id: "after", reached: ["arrived"] }];
    expect(ids(buildTestCreation({ root: release(creation, 2) }).artifact)).toContain(
      "story.conditions",
    );
    story.starts = [{ id: "after", reached: [], set: [] }];
    story.items = [];
    story.events = [];
    story.timelines = [];
    story.knowing = {};
    expect(buildTestCreation({ root: release(creation, 2) }).artifact.capabilities).toEqual([
      { id: "policy.1-draft" },
      { id: "story.v1" },
    ]);
    story.timelines = [{ id: "order", title: "Order", order: ["scene/lobby"] }];
    creation.cast = [{ key: "guest", who: { late: "persona" } }];
    creation.fragments = [
      { id: "secret", kind: "knowledge", stable: true, content: { type: "text", text: "Secret" } },
    ];
    story.knowing = { "#secret": { start: { knows: ["guest"] } } };
    expect(buildTestCreation({ root: release(creation, 2) }).artifact.capabilities).toEqual([
      { id: "policy.1-draft" },
      { id: "story.events", experimental: true },
      { id: "story.knowing", experimental: true },
      { id: "story.v1" },
    ]);
  });
});

describe("runtime capability support", () => {
  const required = [
    { id: "policy.1-draft" },
    { id: "story.conditions", experimental: true as const },
    { id: "story.v1" },
  ];
  it("requires explicit support or an explained degradation for every requirement", () => {
    expect(
      checkCapabilitySupport(required, { supported: required.map((item) => item.id) }),
    ).toEqual({ status: "supported", missing: [], degraded: [] });
    expect(checkCapabilitySupport(required, { supported: ["policy.1-draft", "story.v1"] })).toEqual(
      {
        status: "unsupported",
        missing: [{ id: "story.conditions", experimental: true }],
        degraded: [],
      },
    );
    expect(
      checkCapabilitySupport(required, {
        supported: ["policy.1-draft", "story.v1"],
        degraded: [{ id: "story.conditions", reason: "Conditions are shown as author guidance" }],
      }),
    ).toEqual({
      status: "degraded",
      missing: [],
      degraded: [
        {
          id: "story.conditions",
          experimental: true,
          reason: "Conditions are shown as author guidance",
        },
      ],
    });
    expect(checkCapabilitySupport([{ id: "future.v2" }], { supported: [] }).missing).toEqual([
      { id: "future.v2" },
    ]);
    expect(checkCapabilitySupport([], { supported: [] }).status).toBe("supported");
  });
  it("reports all missing and degraded IDs without silently upgrading ambiguous configuration", () => {
    const result = checkCapabilitySupport(required, {
      supported: [],
      degraded: [{ id: "story.conditions", reason: "Ignore condition state" }],
    });
    expect(result.status).toBe("unsupported");
    expect(result.missing.map((item) => item.id)).toEqual(["policy.1-draft", "story.v1"]);
    expect(result.degraded).toHaveLength(1);
    expect(() =>
      checkCapabilitySupport(required, {
        supported: [],
        degraded: [{ id: "story.conditions", reason: " " }],
      }),
    ).toThrow("capability.invalid_input");
    expect(() =>
      checkCapabilitySupport(required, {
        supported: ["story.conditions"],
        degraded: [{ id: "story.conditions", reason: "Ignore" }],
      }),
    ).toThrow("capability.invalid_input");
  });
});
