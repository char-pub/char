import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildContextCatalog,
  estimateCounter,
  projectPlayerView,
  startSession,
} from "../../../../../packages/assembler/src/index.js";
import {
  availableTargets,
  buildCreation,
  canonicalizeCreation,
  checkCreation,
  confirm,
  createLocalBuildInput,
  enterScene,
  initStoryState,
  type Story,
  type StoryJudgment,
  toTurnStory,
  validateStoryState,
} from "../../../../../packages/core/src/index.js";

const here = new URL("./", import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, here), "utf8"));
const fixtures = read("fixtures.json");
const { loadCharYaml } = await import("../../../../../packages/cli/src/project.js");
const scenario = (await loadCharYaml(new URL("yamagami-family-2002.json", here).pathname)).creation;
const canonical = canonicalizeCreation(scenario);
const checked = checkCreation(canonical.creation);
assert.equal(checked.ok, true, JSON.stringify(checked.diagnostics));
const dependencyNames = ["yamagami-tetsuya", "yamagami-mother", "yamagami-uncle", "default-preset"];
for (const name of dependencyNames) {
  const snapshot = fixtures.snapshots[name];
  const pin = fixtures.pins[name];
  assert.equal(snapshot.creation.ref, pin.ref, name);
  assert.equal(snapshot.release, pin.release, name);
  assert.equal(snapshot.semantic_digest, pin.semantic_digest, name);
  assert.equal(canonicalizeCreation(snapshot.creation).semantic_digest, pin.semantic_digest, name);
  assert.equal(snapshot.visibility, "public", name);
  assert.equal(snapshot.status, "active", name);
}
const dependencies = dependencyNames.map((name) => fixtures.snapshots[name]);
const buildInput = createLocalBuildInput({
  root: { creation: scenario },
  dependencies,
  default_policy: fixtures.pins["default-preset"],
});
const result = buildCreation(buildInput);
assert.equal(result.artifact.kind, "content");
assert.equal(result.artifact.root.origin?.kind, "local-build");
const expectedArtifactDigest = process.argv[2];
if (expectedArtifactDigest)
  assert.equal(
    result.digest,
    expectedArtifactDigest,
    "Rebuild differs; existing final outputs were not replaced.",
  );
const runtimeInput = {
  artifact: result.artifact,
  ...fixtures.runtime_defaults,
  start: "after-bankruptcy",
};
runtimeInput.support = { supported: result.artifact.capabilities.map((c) => c.id) };
const started = startSession({
  artifact: result.artifact,
  bindings: runtimeInput.bindings,
  start: "after-bankruptcy",
  locale: "zh-CN",
});
const initialPlayerView = projectPlayerView({ artifact: result.artifact, turn: started.turn });
assert.equal(initialPlayerView.player.name, "山上徹也");
assert.ok(initialPlayerView.player.part?.startsWith("你正在扮演"));
assert.deepEqual(
  new Set(initialPlayerView.participants.map((p) => p.name)),
  new Set(["母亲", "伯父"]),
);
for (const person of initialPlayerView.participants) {
  assert.ok(person.portrait?.includes("本章模拟"));
  assert.ok(!/你扮演|模型|不要|目标是|内心/.test(person.portrait ?? ""));
}
assert.ok(initialPlayerView.scene?.description?.includes("眼前的生活"));
assert.equal(initialPlayerView.known.length, 1);
assert.ok(initialPlayerView.known[0]?.id.includes("care-and-contact"));
assert.ok(!JSON.stringify(initialPlayerView).includes("我可以和你把问题列清"));
const playerSamples = [{ at: "initial", view: initialPlayerView }];
const playerBuild = buildContextCatalog({
  artifact: result.artifact,
  turn: started.turn,
  view: { mode: "per-agent", for: "yamagami" },
  counter: estimateCounter,
  selection: { catalog_budget: 4000, max_depth: 4 },
});
const playerCatalog = playerBuild.catalog;
const playerDirectory = JSON.stringify([...playerBuild.nodes.values()]);
assert.ok(!playerDirectory.includes("mother-voice"));
assert.ok(!playerDirectory.includes("uncle-voice"));
assert.ok(!playerDirectory.includes("study-first-step"));
assert.ok(!playerDirectory.includes("support-terms"));
const narratorBuild = buildContextCatalog({
  artifact: result.artifact,
  turn: started.turn,
  view: { mode: "narrator" },
  counter: estimateCounter,
  selection: { catalog_budget: 4000, max_depth: 4 },
});
const narratorCatalog = narratorBuild.catalog;
assert.ok(narratorCatalog.candidates.length > 0);
assert.ok(!JSON.stringify([...narratorBuild.nodes.values()]).includes("family-accounts"));

const story = scenario.story as Story;
const cast = scenario.cast.map((c: { key: string }) => c.key);
const records = (target: string, cond: unknown, path = "/when"): StoryJudgment[] => {
  if (!cond || typeof cond !== "object") return [];
  if ("judge" in cond)
    return [
      { target, path, result: "true", provider: { name: "explicit-author-test", version: "1" } },
    ];
  if ("all" in cond)
    return (cond as { all: unknown[] }).all.flatMap((v, i) =>
      records(target, v, `${path}/all/${i}`),
    );
  if ("any" in cond)
    return (cond as { any: unknown[] }).any.flatMap((v, i) =>
      records(target, v, `${path}/any/${i}`),
    );
  if ("not" in cond) return records(target, (cond as { not: unknown }).not, `${path}/not`);
  return [];
};
const judgmentFor = (target: string) => {
  const [kind, id] = target.split("/");
  const item = (kind === "beat" ? story.beats : story.endings)?.find((b) => b.id === id);
  assert.ok(item);
  return records(target, item.when);
};
const initial = initStoryState(story, cast, "after-bankruptcy");
assert.ok(initial.present.includes("yamagami"));
assert.throws(() => enterScene(story, cast, initial, "negotiation"));
assert.throws(() =>
  confirm(story, cast, initial, "beat/consider-study", judgmentFor("beat/consider-study")),
);
assert.throws(() => confirm(story, cast, initial, "beat/name-priority"));
const routes = [];
for (const route of ["study", "independent", "pause"] as const) {
  let state = initial;
  const commit = (target: string) => {
    state = confirm(story, cast, state, target, judgmentFor(target));
  };
  commit("beat/name-priority");
  state = enterScene(story, cast, state, "practical-check");
  assert.equal(state.knowing["#education-questions"]?.includes("yamagami"), false);
  commit(route === "study" ? "beat/check-education" : "beat/check-living");
  if (route === "study")
    assert.equal(state.knowing["#income-and-housing"]?.includes("yamagami"), false);
  else assert.equal(state.knowing["#education-questions"]?.includes("yamagami"), false);
  state = enterScene(story, cast, state, "negotiation");
  commit("beat/clarify-support");
  commit(`beat/consider-${route}`);
  assert.deepEqual(state.vars.considered, [route]);
  state = enterScene(story, cast, state, "first-step");
  commit("beat/prepare-first-step");
  const ending =
    route === "study"
      ? "study-inquiry"
      : route === "independent"
        ? "independent-check"
        : "pause-agreement";
  commit(`ending/${ending}`);
  assert.equal(state.stopped, false);
  assert.equal(state.vars.outcome, route);
  assert.throws(() =>
    confirm(story, cast, state, `ending/${ending}`, judgmentFor(`ending/${ending}`)),
  );
  const before = JSON.stringify(state.vars);
  state = enterScene(story, cast, state, "family-table");
  state = enterScene(story, cast, state, "negotiation");
  assert.equal(JSON.stringify(state.vars), before);
  assert.ok(!availableTargets(story, cast, state).includes("beat/clarify-support"));
  routes.push({
    route,
    ending,
    reached: state.reached,
    knowing: state.knowing,
    vars: state.vars,
    revisit_without_repeated_effects: true,
  });
}
// Asking or an unknown judge never becomes acceptance or refusal.
const unknown = [
  {
    target: "beat/name-priority",
    path: "/when/all/1",
    result: "undetermined",
    provider: { name: "explicit-author-test", version: "1" },
  },
] as StoryJudgment[];
assert.throws(() => confirm(story, cast, initial, "beat/name-priority", unknown));
assert.deepEqual(initial.vars.outcome, "undecided");
const trajectoryChecks = [];
for (const trajectory of read("acceptance-24-turns.json").trajectories) {
  let state = initStoryState(story, cast, "after-bankruptcy");
  assert.equal(trajectory.turns.length, 24);
  for (const step of trajectory.turns) {
    for (const op of step.expected_operations) {
      if (op.type === "confirm")
        state = confirm(story, cast, state, op.target, judgmentFor(op.target));
      else if (op.type === "enter-scene") state = enterScene(story, cast, state, op.scene);
      else throw new Error("Unexpected authored test operation");
    }
    assert.equal(state.vars.outcome, step.expected_outcome, `${trajectory.id}/${step.turn}`);
    for (const ref of step.expected_new_player_information)
      assert.ok(state.knowing[ref]?.includes("yamagami"));
    const view = projectPlayerView({
      artifact: result.artifact,
      turn: {
        ...started.turn,
        scene: state.scene,
        present: state.present,
        story: toTurnStory(state),
      },
    });
    assert.equal(
      view.scene?.description,
      story.scenes.find((scene) => scene.id === state.scene)?.description,
    );
    for (const info of view.known)
      assert.ok(!/玩家|引擎|NPC|模型|Runtime|confirm|story\./.test(info.text), info.id);
    if (step.turn === 24) playerSamples.push({ at: `${trajectory.id}/turn24`, view });
    if (step.turn === 12) {
      state = JSON.parse(JSON.stringify(state));
      validateStoryState(story, cast, state);
    }
  }
  assert.equal(state.vars.outcome, trajectory.final_outcome);
  const catalog = buildContextCatalog({
    artifact: result.artifact,
    turn: {
      ...started.turn,
      scene: state.scene,
      present: state.present,
      story: toTurnStory(state),
    },
    view: { mode: "per-agent", for: "yamagami" },
    counter: estimateCounter,
    selection: { catalog_budget: 4000, max_depth: 4 },
  });
  assert.ok(JSON.stringify([...catalog.nodes.values()]).includes("commitment-ledger"));
  trajectoryChecks.push({
    id: trajectory.id,
    turns: 24,
    final_outcome: state.vars.outcome,
    roundtrip_after_turn12: true,
  });
}
const irText = JSON.stringify(result.artifact.ir.fragments);
assert.ok(!irText.includes("2022年7月8日"));
assert.ok(!irText.includes("2026年1月21日"));
assert.ok(!result.artifact.ir.fragments.some((f) => f.origin.fragment === "source-notes"));
const report = {
  schema_valid: true,
  local_build: true,
  semantic_digest: canonical.semantic_digest,
  artifact_digest: result.digest,
  counts: {
    scenes: story.scenes.length,
    beats: story.beats?.length,
    choices: story.choices?.length,
    endings: story.endings?.length,
    vars: Object.keys(story.vars ?? {}).length,
    semantic_fragments: scenario.fragments.filter(
      (f: { activation?: { mode: string } }) => f.activation?.mode === "semantic",
    ).length,
  },
  future_source_bodies_excluded: true,
  initial_player_catalog: playerCatalog,
  outward_portraits_verified: true,
  player_facing_knowledge_verified: true,
  initial_narrator_catalog: narratorCatalog,
  trajectory_checks: trajectoryChecks,
  routes,
  scope:
    "Deterministic author semantics only: explicit true judgments prove guards/effects, not free-text director accuracy or narrative quality.",
};
// Format every output before writing any file, after reconstruction and behavioral checks pass.
const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
const biome = fileURLToPath(new URL("../../../../../node_modules/.bin/biome", import.meta.url));
const generated = [
  ["chapter.artifact.json", result.json],
  ["runtime-input.json", JSON.stringify(runtimeInput)],
  ["verification.json", JSON.stringify(report)],
  ["player-view-samples.json", JSON.stringify(playerSamples)],
].map(([name, json]) => {
  assert.ok(name && json);
  const target = new URL(name, here);
  const formatted = execFileSync(biome, ["format", "--stdin-file-path", fileURLToPath(target)], {
    cwd: repository,
    input: `${json}\n`,
    encoding: "utf8",
  });
  return { target, formatted };
});
for (const { target, formatted } of generated) writeFileSync(target, formatted);
console.log(JSON.stringify({ valid: true, ...report.counts, artifact_digest: result.digest }));
