import {
  type CreationInput,
  canonicalizeCreation,
  initStoryState,
  toTurnStory,
} from "@char-pub/core";
import { describe, expect, it } from "vitest";
import { buildTestCreation } from "../../core/test/build.js";
import { D, level0Character, tid } from "../../core/test/fixtures.js";
import { buildContextCatalog, catalogKey, selectorCatalog } from "../src/catalog.js";
import { DEFAULT_LABELS, RenderContext } from "../src/render.js";
import { fixedSelection, noneSelection, validateSelectionPlan } from "../src/selection.js";
import { estimateCounter } from "../src/tokens.js";
import { selectorView, viewOf } from "../src/view.js";

function fixture(withStyles = false, edit?: (creation: CreationInput) => void) {
  const characters = ["alice", "bob"].map((name, i) => {
    const creation = level0Character({
      id: tid("cr", i + 81),
      ref: `@djj/${name}`,
      display_name: name,
      assets: [],
      bootstrap: undefined,
    });
    return {
      creation,
      release: tid("rel", i + 81),
      semantic_digest: canonicalizeCreation(creation).semantic_digest,
      visibility: "public" as const,
    };
  });
  const styles = withStyles
    ? ["old-voice", "new-voice", "other-scene"].map((name, i) => {
        const creation = level0Character({
          id: tid("cr", i + 91),
          ref: `@djj/${name}`,
          type: "style",
          display_name: name,
          assets: [],
          bootstrap: undefined,
          fragments: [
            { id: "tone", stable: true, kind: "style", content: { type: "text", text: name } },
          ],
        });
        return {
          creation,
          release: tid("rel", i + 91),
          semantic_digest: canonicalizeCreation(creation).semantic_digest,
          visibility: "public" as const,
        };
      })
    : [];
  const creation: CreationInput = {
    id: tid("cr", 85),
    ref: "@djj/inn",
    type: "scenario",
    display_name: "Inn",
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
    references: characters.map((c) => ({
      id: c.creation.display_name as string,
      use: c.creation.ref,
      mode: "intrinsic",
      pin: { release: c.release, semantic_digest: c.semantic_digest },
    })),
    cast: [
      { key: "alice", who: "@djj/alice", part: "Host", goal: "Keep the culprit secret" },
      { key: "bob", who: "@djj/bob", part: "Detective", goal: "Find the guest" },
    ],
    fragments: [
      {
        id: "secret",
        stable: true,
        kind: "knowledge",
        description: "SECRET Alice killed the guest",
        activation: { mode: "semantic" },
        content: { type: "text", text: "SECRET confession" },
      },
      {
        id: "door",
        stable: true,
        kind: "knowledge",
        description: "Public exits",
        activation: { mode: "semantic" },
        content: { type: "text", text: "The back door leads to the river." },
      },
      {
        id: "manual",
        stable: true,
        kind: "knowledge",
        description: "Manual only",
        activation: { mode: "manual" },
        content: { type: "text", text: "Not selected by a model" },
      },
      {
        id: "weather",
        stable: true,
        kind: "knowledge",
        activation: { mode: "always" },
        content: { type: "text", text: "Snow is falling" },
      },
    ],
    groups: [
      { id: "one", title: "One", description: "Public building", groups: ["two"] },
      { id: "two", title: "Two", description: "Public floor", groups: ["three"] },
      { id: "three", title: "Three", description: "Public rooms", entries: ["door", "secret"] },
    ],
    sources: [
      {
        id: "handbook",
        title: "Handbook",
        description: "Public guide",
        asset: "manual",
        format: "text",
        visibility: { scope: "shared" },
        sections: [
          { id: "inn", title: "Inn", anchor: "L1-L5" },
          { id: "river", title: "River", anchor: "L6-L10" },
        ],
      },
    ],
    assets: [
      {
        slot: "manual",
        role: "context",
        variants: [
          {
            id: "default",
            media_type: "text/plain",
            blob: { digest: D("a"), size: 100, availability: "mirrored" },
          },
        ],
      },
    ],
    story: {
      version: 1,
      scenes: [
        {
          id: "lobby",
          title: "Lobby",
          cast: ["alice"],
          opening: "The lights go out",
          lore: ["#handbook/inn"],
        },
      ],
      knowing: { "#secret": { start: { knows: ["alice"], not: ["bob"] } } },
      vars: {
        culprit: {
          type: "enum",
          values: ["alice", "bob"],
          init: "alice",
          description: "SECRET murderer",
        },
      },
    },
  };
  if (withStyles) {
    creation.references?.push(
      ...styles.map((style, i) => ({
        id: i === 0 ? "z-old" : i === 1 ? "a-new" : "scene-style",
        use: style.creation.ref,
        mode: "default" as const,
        pin: { release: style.release, semantic_digest: style.semantic_digest },
        scope: i < 2 ? { cast: "alice" } : { scene: "outside" },
        ...(i === 1 ? { combine: "replace" as const } : {}),
      })),
    );
    creation.story?.scenes.push({ id: "outside", title: "Outside" });
  }
  edit?.(creation);
  const { artifact } = buildTestCreation({
    root: { creation, release: tid("rel", 85), visibility: "public" },
    dependencies: [...characters, ...styles],
  });
  if (artifact.kind !== "content" || !artifact.story) throw new Error("Invalid fixture");
  const state = initStoryState(artifact.story, ["alice", "bob"]);
  const turn = {
    scene: state.scene,
    present: ["alice", "bob"],
    story: toTurnStory(state),
    history: [{ role: "user" as const, text: "Where is the river?" }],
    overlay: { state: { hidden: "SECRET" } },
  };
  const input = {
    artifact,
    turn,
    view: { mode: "per-agent" as const, for: "bob" },
    counter: estimateCounter,
    selection: { catalog_budget: 10000, max_depth: 4 },
  };
  return { input, artifact, turn };
}

describe("view-scoped context discovery", () => {
  it.each(["ja-JP", "JA-jp", "fr-CA"])(
    "estimates the same localized fragment body that %s renders",
    (locale) => {
      const japanese = "あ".repeat(500);
      const { input, artifact, turn } = fixture(false, (creation) => {
        const door = creation.fragments?.find((fragment) => fragment.id === "door");
        if (!door) throw new Error("Missing door");
        door.content = { type: "text", text: "x" };
        door.locale = { ja: { content: { type: "text", text: japanese } } };
      });
      const counter = { tokenizer: "characters", estimated: true, count: (s: string) => s.length };
      const localizedTurn = { ...turn, locale, bindings: {} };
      const build = buildContextCatalog({ ...input, turn: localizedTurn, counter });
      const door = artifact.ir.fragments.find((fragment) => fragment.origin.fragment === "door");
      if (!door) throw new Error("Missing resolved door");
      const expected = locale.toLowerCase().startsWith("ja") ? japanese : "x";
      const renderer = new RenderContext(artifact.ir, localizedTurn, locale, false, DEFAULT_LABELS);
      expect(renderer.render(door).text).toBe(expected);
      expect(build.nodes.get(catalogKey({ fragment: door.id }))?.est_tokens).toBe(expected.length);
    },
  );

  it("preserves cast/scene Style scopes and applies replace in authored order", () => {
    const { input, artifact } = fixture(true);
    const bob = buildContextCatalog(input);
    const alice = buildContextCatalog({ ...input, view: { mode: "per-agent", for: "alice" } });
    const style = (name: string) =>
      artifact.ir.fragments.find((f) => f.origin.creation === `@djj/${name}`);
    const old = style("old-voice");
    const current = style("new-voice");
    const otherScene = style("other-scene");
    if (!old || !current || !otherScene) throw new Error("Missing styles");
    expect(viewOf({ kind: "fragment", value: current }, bob.context).reason).toBe(
      "view.style_other_cast",
    );
    expect(viewOf({ kind: "fragment", value: old }, alice.context).reason).toBe(
      "view.style_replaced",
    );
    expect(viewOf({ kind: "fragment", value: otherScene }, alice.context).reason).toBe(
      "view.other_scene",
    );
    expect(alice.catalog.direct).toContainEqual({ fragment: current.id });
    expect(bob.catalog.direct).not.toContainEqual({ fragment: current.id });
  });

  it("charges the exact selector directory DTO including its view and excludes local diagnostics", () => {
    const { input } = fixture();
    const counter = {
      tokenizer: "characters",
      estimated: true,
      count: (text: string) => text.length,
    };
    const build = buildContextCatalog({ ...input, counter });
    const dto = selectorCatalog(build.catalog);
    expect(dto).not.toHaveProperty("required");
    expect(dto).not.toHaveProperty("direct");
    expect(dto).not.toHaveProperty("withheld");
    const exact = JSON.stringify(dto).length;
    expect(() =>
      buildContextCatalog({
        ...input,
        counter,
        selection: { ...input.selection, catalog_budget: exact - 1 },
      }),
    ).toThrow();
    const exactBuild = buildContextCatalog({
      ...input,
      counter,
      selection: { ...input.selection, catalog_budget: exact },
    });
    expect(noneSelection(exactBuild).selected).toEqual([]);
  });
  it("filters secrets and other goals before exposing metadata, while honoring actual presence", () => {
    const { input, artifact } = fixture();
    const build = buildContextCatalog(input);
    expect(JSON.stringify(build.catalog)).not.toContain("SECRET");
    expect(build.catalog.required).toContainEqual({ story: "part", id: "bob" });
    expect(build.catalog.required).toContainEqual({ story: "goal", id: "bob" });
    expect(build.catalog.required).not.toContainEqual({ story: "goal", id: "alice" });
    expect(JSON.stringify(selectorView(build.context))).not.toContain("culprit");
    expect(JSON.stringify(selectorView(build.context))).not.toContain("knowing");
    expect(JSON.stringify(selectorView(build.context))).not.toContain("SECRET");
    const secret = artifact.ir.fragments.find((f) => f.origin.fragment === "secret");
    if (!secret) throw new Error("Missing fixture");
    expect(viewOf({ kind: "fragment", value: secret }, build.context)).toMatchObject({
      status: "withheld",
    });
    expect(() => fixedSelection(build, [{ fragment: secret.id }])).toThrow();
  });

  it("keeps directly associated source sections on the none/skip path", () => {
    const { input, artifact } = fixture();
    const build = buildContextCatalog(input);
    const source = artifact.catalog_index.sources[0];
    if (!source) throw new Error("Missing fixture");
    expect(build.catalog.direct).toContainEqual({ source: source.id, section: "inn" });
    expect(noneSelection(build).selected).toEqual([]);
    expect(() => fixedSelection(build, [{ source: source.id, section: "inn" }])).toThrow();
    expect(() => fixedSelection(build, [{ source: source.id }])).toThrowError(
      expect.objectContaining({ code: "selection.overlapping_source" }),
    );
  });

  it("reaches third-level group leaves through recorded expansions", () => {
    const { input, artifact } = fixture();
    const build = buildContextCatalog(input);
    const door = artifact.ir.fragments.find((f) => f.origin.fragment === "door");
    if (!door) throw new Error("Missing fixture");
    const plan = fixedSelection(build, [{ fragment: door.id }]);
    expect(plan.decisions.filter((d) => d.action === "expand")).toHaveLength(3);
    expect(validateSelectionPlan(build, plan)).toEqual(plan);
    expect(() =>
      fixedSelection(
        buildContextCatalog({ ...input, selection: { ...input.selection, max_depth: 3 } }),
        [{ fragment: door.id }],
      ),
    ).toThrow();
    expect(() => validateSelectionPlan(build, { ...plan, decisions: [] })).toThrow();
  });

  it("rejects stale turns, changed policy limits, containers and duplicate bodies", () => {
    const { input, artifact, turn } = fixture();
    const build = buildContextCatalog(input);
    const door = artifact.ir.fragments.find((f) => f.origin.fragment === "door");
    if (!door) throw new Error("Missing fixture");
    const plan = fixedSelection(build, [{ fragment: door.id }]);
    const next = buildContextCatalog({ ...input, turn: { ...turn, focus: "Another subject" } });
    expect(() => validateSelectionPlan(next, plan)).toThrowError(
      expect.objectContaining({ code: "selection.input_mismatch" }),
    );
    const policy = buildContextCatalog({ ...input, policy: { version: "another" } });
    expect(() => validateSelectionPlan(policy, plan)).toThrow();
    expect(() => fixedSelection(build, [{ fragment: door.id }, { fragment: door.id }])).toThrow();
    const root = build.catalog.candidates[0];
    if (!root) throw new Error("Missing candidates");
    expect(() => fixedSelection(build, [root.ref])).toThrowError(
      expect.objectContaining({ code: "selection.container_body" }),
    );
    expect(catalogKey(plan.selected[0]?.ref ?? root.ref)).toBe(`fragment:${door.id}`);
  });
});

describe("selector metadata projection", () => {
  it("exposes authored perspective and resolved visible links without activating their bodies", () => {
    const { input, artifact } = fixture(false, (creation) => {
      creation.fragments?.push({
        id: "rumor",
        stable: true,
        kind: "knowledge",
        description: "Rumor about the exits",
        perspective: "rumor",
        about: ["#weather", "#manual", "#secret", "cast:alice", "@djj/bob"],
        activation: { mode: "keyword", keys: ["unmatched-signal"] },
        selectable: true,
        content: { type: "text", text: "RUMOR_BODY_NOT_IN_DIRECTORY" },
      });
    });
    const build = buildContextCatalog(input);
    const rumor = artifact.ir.fragments.find((f) => f.origin.fragment === "rumor");
    const manual = artifact.ir.fragments.find((f) => f.origin.fragment === "manual");
    const weather = artifact.ir.fragments.find((f) => f.origin.fragment === "weather");
    const alice = artifact.story_refs?.participants.alice;
    const bobWork = artifact.catalog_index.works.find((work) => work.ref === "@djj/bob");
    if (!rumor || !manual || !weather || !alice || !bobWork) throw new Error("fixture required");
    const node = build.nodes.get(catalogKey({ fragment: rumor.id }));
    expect(node).toMatchObject({
      perspective: "rumor",
      activation_hint: "keyword",
      about: [weather.id, manual.id, `participant:${alice}`, bobWork.id],
    });
    const serialized = JSON.stringify(selectorCatalog(build.catalog));
    expect(serialized).toContain('"perspective":"rumor"');
    expect(serialized).toContain(manual.id);
    const initialCost = input.counter.count(serialized);
    expect(() =>
      buildContextCatalog({
        ...input,
        selection: { ...input.selection, catalog_budget: initialCost - 1 },
      }),
    ).toThrowError(expect.objectContaining({ code: "catalog.directory_over_budget" }));
    expect(() =>
      buildContextCatalog({
        ...input,
        selection: { ...input.selection, catalog_budget: initialCost },
      }),
    ).not.toThrow();
    expect(serialized).not.toContain("#secret");
    expect(serialized).not.toContain("RUMOR_BODY_NOT_IN_DIRECTORY");
    expect(build.catalog.direct).not.toContainEqual({ fragment: manual.id });
    expect(build.catalog.required).not.toContainEqual({ fragment: manual.id });
    expect(noneSelection(build).selected).toEqual([]);
    expect(() => fixedSelection(build, [{ fragment: manual.id }])).toThrow();
  });

  it("does not leak absent speaker or work identities through perspective and about", () => {
    const { input, artifact } = fixture(false, (creation) => {
      creation.fragments?.push({
        id: "claim",
        stable: true,
        kind: "knowledge",
        description: "A claim",
        perspective: { claim: "{{cast:bob}}" },
        about: ["@djj/bob", "cast:bob"],
        activation: { mode: "semantic" },
        content: { type: "text", text: "Claim body" },
      });
    });
    const claim = artifact.ir.fragments.find((fragment) => fragment.origin.fragment === "claim");
    if (!claim) throw new Error("claim required");
    const present = buildContextCatalog(input);
    expect(present.nodes.get(catalogKey({ fragment: claim.id }))).toMatchObject({
      perspective: claim.perspective,
      activation_hint: "semantic",
    });
    const absent = buildContextCatalog({ ...input, turn: { ...input.turn, present: ["alice"] } });
    const node = absent.nodes.get(catalogKey({ fragment: claim.id }));
    expect(node).not.toHaveProperty("perspective");
    expect(node).not.toHaveProperty("about");
    expect(JSON.stringify(selectorCatalog(absent.catalog))).not.toContain("@djj/bob");
  });

  it("checks each duplicate Character instance rather than borrowing another instance's visibility", () => {
    const { input, artifact } = fixture(false, (creation) => {
      for (const member of creation.cast ?? []) member.who = "@djj/alice";
      creation.fragments?.push({
        id: "belief",
        stable: true,
        kind: "knowledge",
        description: "A belief",
        perspective: { belief: "{{cast:bob}}" },
        about: ["cast:alice#description", "cast:bob#description"],
        activation: { mode: "semantic" },
        content: { type: "text", text: "Belief body" },
      });
    });
    const belief = artifact.ir.fragments.find((fragment) => fragment.origin.fragment === "belief");
    if (!belief) throw new Error("belief required");
    const links = artifact.catalog_index.about?.filter((link) => link.from === belief.id);
    expect(links).toHaveLength(2);
    const build = buildContextCatalog(input);
    const bob = artifact.story_refs?.participants.bob;
    const visible = links?.filter(
      (link) =>
        "fragment" in link.target &&
        build.visibility.get(catalogKey(link.target))?.status === "visible",
    );
    expect(visible).toHaveLength(1);
    const target = visible?.[0]?.target;
    if (!target || !("fragment" in target)) throw new Error("visible exact fragment required");
    expect(build.nodes.get(catalogKey({ fragment: belief.id }))).toMatchObject({
      perspective: { belief: `participant:${bob}` },
      about: [target.fragment],
    });
  });

  it("charges metadata at actual initial or expanded exposure and invalidates prior plans", () => {
    const { input, artifact } = fixture(false, (creation) => {
      const door = creation.fragments?.find((f) => f.id === "door");
      if (!door) throw new Error("door required");
      door.perspective = "rumor";
      door.about = ["#weather"];
    });
    const door = artifact.ir.fragments.find((f) => f.origin.fragment === "door");
    if (!door) throw new Error("door required");
    const build = buildContextCatalog(input);
    const plan = fixedSelection(build, [{ fragment: door.id }]);
    const leaf = build.nodes.get(catalogKey({ fragment: door.id }));
    expect(leaf).toMatchObject({ perspective: "rumor", activation_hint: "semantic" });
    expect(JSON.stringify(selectorCatalog(build.catalog))).not.toContain('"perspective":"rumor"');
    let charged = input.counter.count(JSON.stringify(selectorCatalog(build.catalog)));
    let metadataCost = 0;
    for (const decision of plan.decisions) {
      if (decision.action !== "expand") continue;
      const children =
        build.nodes
          .get(catalogKey(decision.ref))
          ?.children?.map(({ children: _children, ...node }) => node) ?? [];
      const exposed = JSON.stringify({ parent: decision.ref, children });
      charged += input.counter.count(exposed);
      if (children.some((child) => child.perspective))
        metadataCost =
          input.counter.count(exposed) -
          input.counter.count(
            JSON.stringify({
              parent: decision.ref,
              children: children.map(
                ({ perspective: _p, about: _a, activation_hint: _h, ...node }) => node,
              ),
            }),
          );
    }
    expect(metadataCost).toBeGreaterThan(0);
    const tight = buildContextCatalog({
      ...input,
      selection: { ...input.selection, catalog_budget: charged - 1 },
    });
    expect(() => fixedSelection(tight, [{ fragment: door.id }])).toThrowError(
      expect.objectContaining({ code: "selection.directory_over_budget" }),
    );
    const exact = buildContextCatalog({
      ...input,
      selection: { ...input.selection, catalog_budget: charged },
    });
    expect(() => fixedSelection(exact, [{ fragment: door.id }])).not.toThrow();
    const changed = structuredClone(artifact);
    const changedDoor = changed.ir.fragments.find((fragment) => fragment.id === door.id);
    if (!changedDoor) throw new Error("door required");
    changedDoor.perspective = "canon";
    const next = buildContextCatalog({ ...input, artifact: changed });
    expect(() => validateSelectionPlan(next, plan)).toThrowError(
      expect.objectContaining({ code: "selection.input_mismatch" }),
    );
  });
});
