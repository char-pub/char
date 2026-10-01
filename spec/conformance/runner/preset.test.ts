/** 三个 Runtime 读取同一份完整 fixture，检验 draft trace 比较没有覆盖的消息与策略身份。 */
import {
  assemble,
  createPreparationCatalog,
  digestAssemblyMessages,
  fixedSelection,
  sourceRequests,
  startSession,
} from "@char-pub/assembler";
import {
  buildCreation,
  type CreationArtifact,
  CreationArtifactSchema,
  canonicalizeCreation,
  checkCapabilitySupport,
  digestOf,
  PRESET_REGIONS,
  publishedIdentity,
  resolvePreset,
  sha256Hex,
} from "@char-pub/core";
import { describe, expect, it } from "vitest";
import { runAssembleScenarios } from "./assemble.js";
import bundleJson from "./cases.gen.json" with { type: "json" };
import type { AssembleScenario, Bundle } from "./types.js";

const cases = (bundleJson as unknown as Bundle).cases;

function fixture(id: string) {
  const c = cases.find((item) => item.dir === id);
  if (!c?.input.root || !c.input.assemble) throw new Error(`missing fixture ${id}`);
  const { artifact } = buildCreation({
    root: c.input.root,
    dependencies: c.input.deps,
    ...c.input.options,
  });
  if (artifact.kind !== "content") throw new Error("expected content artifact");
  return {
    artifact,
    ir: artifact.ir,
    scenarios: c.input.assemble.scenarios,
    meta: c.meta,
    expected: c.expected,
  };
}

function assembleScenario(artifact: CreationArtifact, s: AssembleScenario) {
  return assemble({
    artifact,
    profile: s.profile as Parameters<typeof assemble>[0]["profile"],
    turn: s.turn as Parameters<typeof assemble>[0]["turn"],
    ...(s.preset ? { preset: resolvePreset(s.preset) } : {}),
  });
}

describe("Preset conformance fixture semantics", () => {
  it("publishes deterministic required capabilities from the real build, with no author declaration", () => {
    const { artifact } = fixture("008-private-visibility");
    expect(artifact.capabilities).toContainEqual({ id: "policy.1-draft" });
    expect(artifact.capabilities.map((item) => item.id)).toEqual(
      [...new Set(artifact.capabilities.map((item) => item.id))].sort(),
    );
    expect(fixture("008-private-visibility").artifact.capabilities).toEqual(artifact.capabilities);
    const { capabilities: _capabilities, ...missing } = artifact;
    expect(CreationArtifactSchema.safeParse(missing).success).toBe(false);
    const c = cases.find((item) => item.dir === "014-preset-layout");
    expect(() =>
      canonicalizeCreation({ ...(c?.input.root?.creation as object), capabilities: [] }),
    ).toThrow();
  });

  it("does not presume runtime support for missing, experimental or unknown capabilities", () => {
    const { artifact } = fixture("014-preset-layout");
    const report = checkCapabilitySupport(artifact.capabilities, { supported: [] });
    expect(report).toEqual({ status: "unsupported", missing: artifact.capabilities, degraded: [] });
    expect(checkCapabilitySupport([{ id: "future.v2" }], { supported: [] })).toEqual({
      status: "unsupported",
      missing: [{ id: "future.v2" }],
      degraded: [],
    });
    expect(
      checkCapabilitySupport([{ id: "story.judge", experimental: true }], { supported: [] }).status,
    ).toBe("unsupported");
    expect(
      checkCapabilitySupport(artifact.capabilities, {
        supported: artifact.capabilities.map((item) => item.id),
      }).status,
    ).toBe("supported");
  });

  it("requires explicit explained degradation rather than silently claiming full support", () => {
    const { artifact } = fixture("014-preset-layout");
    const degraded = artifact.capabilities.map((item) => ({
      id: item.id,
      reason: "Show the author guidance without executing it",
    }));
    expect(checkCapabilitySupport(artifact.capabilities, { supported: [], degraded })).toEqual({
      status: "degraded",
      missing: [],
      degraded: artifact.capabilities.map((item) => ({ ...item, reason: degraded[0]?.reason })),
    });
    expect(() =>
      checkCapabilitySupport(artifact.capabilities, {
        supported: [],
        degraded: [{ id: "policy.1-draft", reason: " " }],
      }),
    ).toThrow("capability.invalid_input");
  });

  it("reuses the referenced actor in relationship slots without contradicting narrator knowledge labels", () => {
    const { artifact, scenarios } = fixture("008-private-visibility");
    expect(artifact.ir.participants.filter((p) => p.ref === "@djj/bob")).toHaveLength(1);
    const narrator = scenarios.find((s) => s.name === "narrator");
    if (!narrator) throw new Error("missing narrator scenario");
    const result = assembleScenario(artifact, narrator);
    const text = result.messages.map((m) => m.content).join("\n");
    expect(text).toContain("知道此事：Bob");
    expect(text).not.toMatch(/不知道：[^）]*Bob/);
    expect(text).toContain("Bob secretly reports to Arasaka.");
  });

  for (const position of ["main", "after-history", "both"] as const) {
    for (const multipleSystemMessages of [true, false]) {
      it(`allows literal policy placeholders at ${position}, multiple system=${multipleSystemMessages}, while detecting matching Session text`, () => {
        const { artifact, scenarios } = fixture("014-preset-layout");
        const original = scenarios[0];
        if (!original?.preset) throw new Error("missing preset fixture");
        const literal = "Literal {{late:user}}";
        const positions = position === "both" ? ["main", "after-history"] : [position];
        const base = canonicalizeCreation(original.preset.creation).creation;
        const canonical = canonicalizeCreation({
          ...base,
          policy: {
            version: "1-draft",
            blocks: positions.map((p, i) => ({ id: `literal-${i}`, text: literal, default_at: p })),
            layout: [...PRESET_REGIONS],
            requires: { system_role: true },
          },
        });
        const scenario: AssembleScenario = {
          name: "literal-policy",
          preset: {
            creation: canonical.json,
            release: publishedIdentity(original.preset).release,
            semantic_digest: canonical.semantic_digest,
          },
          profile: {
            ...(original.profile as Parameters<typeof assemble>[0]["profile"]),
            capabilities: { system_role: true, multiple_system_messages: multipleSystemMessages },
          },
          turn: { bindings: { user: { kind: "persona", display_name: "Sam" } }, history: [] },
        };
        const messages = assembleScenario(artifact, scenario).messages;
        expect(messages.some((m) => m.content.includes(literal))).toBe(true);
        if (!multipleSystemMessages) {
          expect(messages).toHaveLength(1);
          expect(messages[0]?.source.some((s) => s.startsWith("preset:"))).toBe(true);
          expect(messages[0]?.source.some((s) => s.startsWith("@fixture/alice#"))).toBe(true);
        }
        expect(runAssembleScenarios(artifact, { scenarios: [scenario] }).violations).toEqual([]);

        const withResidual = {
          ...scenario,
          turn: {
            ...(scenario.turn as Parameters<typeof assemble>[0]["turn"]),
            overlay: { memory: [literal] },
          },
        };
        const result = runAssembleScenarios(artifact, { scenarios: [withResidual] });
        expect(result.expectation.scenarios[0]).not.toHaveProperty("error");
        expect(result.violations).toHaveLength(1);
        expect(result.violations[0]).toContain("placeholder reached the model messages");
      });
    }
  }

  it("uses valid canonical snapshots without accepting draft output", () => {
    for (const id of ["014-preset-layout", "015-preset-budget-capabilities"]) {
      const f = fixture(id);
      expect(f.meta.status).toBe("draft");
      expect(f.expected).toEqual({});
      for (const s of f.scenarios) {
        if (!s.preset) continue;
        const canonical = canonicalizeCreation(s.preset.creation);
        expect(canonical.semantic_digest).toBe(s.preset.semantic_digest);
        expect(canonical.json).toEqual(s.preset.creation);
        expect(resolvePreset(s.preset)).toMatchObject({
          ref: "@fixture/narrator",
          release: publishedIdentity(s.preset).release,
          semantic_digest: s.preset.semantic_digest,
        });
      }
    }
  });

  it("places style after actual history and keeps policy provenance separate from Creative IR", () => {
    const { artifact, scenarios } = fixture("014-preset-layout");
    const s = scenarios.find((item) => item.name === "explicit-layout");
    if (!s?.preset) throw new Error("missing explicit policy scenario");
    const ir = artifact.ir;
    const before = JSON.stringify(ir);
    const result = assembleScenario(artifact, s);
    const messages = result.messages;
    const indexOf = (text: string) => messages.findIndex((m) => m.content.includes(text));
    expect(indexOf("Portray the selected cast.")).toBeGreaterThanOrEqual(0);
    expect(indexOf("Portray the selected cast.")).toBeLessThan(indexOf("Alice is a courier."));
    expect(indexOf("The bridge is closed.")).toBeLessThan(indexOf("Where should we go?"));
    expect(indexOf("Where should we go?")).toBeLessThan(indexOf("Use concise dialogue."));
    expect(indexOf("Where should we go?")).toBeLessThan(indexOf("Continue with the next reply."));
    expect(messages[indexOf("Where should we go?")]?.role).toBe("user");
    expect(messages[indexOf("Continue with the next reply.")]?.role).toBe("system");
    expect(JSON.stringify(messages)).not.toContain("This block must never be sent.");
    expect(result.trace.entries.find((e) => e.origin?.fragment === "style")).toMatchObject({
      region: "system:style",
      decision: "included",
    });
    expect(
      result.trace.entries.filter((e) => e.id.startsWith("preset:") && e.decision === "included"),
    ).toHaveLength(2);
    expect(result.trace).toMatchObject({
      preset: {
        ref: "@fixture/narrator",
        release: publishedIdentity(s.preset).release,
        semantic_digest: s.preset.semantic_digest,
      },
    });
    expect(result.trace.ir).toEqual({
      root: ir.root.ref,
      ...publishedIdentity(ir.root),
      semantic_digest: ir.root.semantic_digest,
      lock_digest: ir.lock_digest,
    });
    expect(JSON.stringify(ir)).toBe(before);
  });

  it("uses the fixture’s explicitly locked default when no override was selected", () => {
    const { artifact, scenarios } = fixture("014-preset-layout");
    const s = scenarios.find((item) => item.name === "default-layout");
    if (!s) throw new Error("missing default scenario");
    const result = assembleScenario(artifact, s);
    expect(result.messages.map((m) => ({ role: m.role, content: m.content }))).toEqual([
      { role: "system", content: "Alice is a courier." },
      { role: "system", content: "The bridge is closed." },
      { role: "system", content: "Use concise dialogue." },
      { role: "user", content: "Where should we go?" },
    ]);
    expect(result.trace.entries.some((e) => e.id.startsWith("preset:"))).toBe(false);
  });

  it("applies a regional cap only to its Creative candidates", () => {
    const { artifact, scenarios } = fixture("015-preset-budget-capabilities");
    const s = scenarios.find((item) => item.name === "knowledge-cap");
    if (!s) throw new Error("missing capped scenario");
    const result = assembleScenario(artifact, s);
    expect(result.trace.entries.find((e) => e.origin?.fragment === "knowledge")).toMatchObject({
      region: "system:knowledge",
      decision: "skipped",
      reason: "budget",
    });
    const text = result.messages.map((m) => m.content).join("\n");
    expect(text).not.toContain("The bridge is closed.");
    expect(text).toContain("Alice is a courier.");
    expect(text).toContain("Use concise dialogue.");
    expect(text).toContain("Continue with the next reply.");
  });

  it("reports specific errors for fixed/pinned budgets and unsupported message capabilities", () => {
    const { artifact, scenarios } = fixture("015-preset-budget-capabilities");
    const result = runAssembleScenarios(artifact, { scenarios });
    expect(result.violations).toEqual([]);
    const errors = Object.fromEntries(
      result.expectation.scenarios.flatMap((s) => ("error" in s ? [[s.name, s.error.code]] : [])),
    );
    expect(errors).toEqual({
      "pinned-region-cap": "assemble.preset_region_over_budget",
      "fixed-over-budget": "assemble.fixed_over_budget",
      "missing-system": "assemble.preset_incompatible",
      "split-system-unsupported": "assemble.preset_incompatible",
    });
  });
});

// These assertions run unchanged in Node, Chromium and workerd. They do not accept draft baselines.
describe("module and author fixture portability", () => {
  it("selects published source sections with a TurnView and checks the supplied bytes", () => {
    const c = cases.find((item) => item.dir === "014-preset-layout");
    const root = c?.input.root;
    const scenario = c?.input.assemble?.scenarios[1];
    if (!root || !scenario) throw new Error("missing source fixture");
    const original = canonicalizeCreation(root.creation).creation;
    const text = "# Bridge\nThe service tunnel is open.\n# Market\nThe market is closed.\n";
    const { artifact } = buildCreation({
      root: {
        ...root,
        creation: {
          ...original,
          sources: [
            {
              id: "handbook",
              title: "City handbook",
              description: "Routes through the city",
              asset: "handbook",
              format: "markdown",
              sections: [
                {
                  id: "bridge",
                  title: "Bridge",
                  description: "Crossing the river",
                  anchor: "#Bridge",
                },
              ],
            },
          ],
          assets: [
            {
              slot: "handbook",
              role: "context",
              variants: [
                {
                  id: "default",
                  media_type: "text/markdown",
                  blob: {
                    digest: `sha256:${sha256Hex(text)}`,
                    size: new TextEncoder().encode(text).byteLength,
                    availability: "mirrored",
                  },
                },
              ],
            },
          ],
        },
      },
      dependencies: c.input.deps,
      ...c.input.options,
    });
    if (artifact.kind !== "content") throw new Error("expected content");
    const source = artifact.catalog_index.sources[0];
    if (!source) throw new Error("missing catalog source");
    const selected: AssembleScenario = {
      ...scenario,
      selection: [{ source: source.id, section: "bridge" }],
      source_texts: { [source.asset]: text },
    };
    const preparation = {
      artifact,
      profile: scenario.profile as Parameters<typeof assemble>[0]["profile"],
      turn: scenario.turn as Parameters<typeof assemble>[0]["turn"],
      ...(scenario.preset ? { preset: resolvePreset(scenario.preset) } : {}),
    };
    // A directory candidate needs no body until the exact validated Plan includes it.
    expect(sourceRequests(preparation)).toEqual([]);
    const plan = fixedSelection(createPreparationCatalog(preparation), [
      { source: source.id, section: "bridge" },
    ]);
    const planned = { ...preparation, plan };
    expect(sourceRequests(planned)).toEqual([
      { source: source.id, asset: source.asset, digest: `sha256:${sha256Hex(text)}` },
    ]);
    const assembled = assemble({ ...planned, source_texts: { [source.asset]: text } });
    expect(assembled.trace.selection?.plan_digest).toBe(digestOf(plan));
    expect(
      assembled.messages.some((message) => message.content.includes("The service tunnel is open.")),
    ).toBe(true);
    expect(
      assembled.messages.some((message) => message.content.includes("The market is closed.")),
    ).toBe(false);
    const stale = {
      ...planned,
      turn: { ...preparation.turn, history: [{ role: "user" as const, text: "New input" }] },
    };
    expect(() => sourceRequests(stale)).toThrow("selection.input_mismatch");
    expect(() => assemble({ ...stale, source_texts: { [source.asset]: text } })).toThrow(
      "selection.input_mismatch",
    );
    const run = runAssembleScenarios(artifact, { scenarios: [selected] });
    expect(run.violations).toEqual([]);
    const result = run.expectation.scenarios[0];
    expect(result).not.toHaveProperty("error");
    if (!result || "error" in result) throw new Error("source assembly failed");
    expect(result.messages_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.messages_digest).toBe(digestAssemblyMessages(assembled.messages));
    const withoutSelection = runAssembleScenarios(artifact, { scenarios: [scenario] });
    expect(withoutSelection.expectation.scenarios[0]).not.toHaveProperty("error");
    expect(withoutSelection.expectation.scenarios[0]).not.toMatchObject({
      messages_digest: result.messages_digest,
    });
    const corrupted = runAssembleScenarios(artifact, {
      scenarios: [{ ...selected, source_texts: { [source.asset]: `${text}tampered` } }],
    });
    expect(corrupted.expectation.scenarios[0]).toMatchObject({
      error: { code: "source.asset_mismatch" },
    });
  });

  it("deduplicates exact module imports and runs a public synthetic fixture without a model", async () => {
    const { buildCreation } = await import("@char-pub/core");
    const { ASSEMBLER, runAssemblyTests, TOKENIZER_VERSIONS } = await import("@char-pub/assembler");
    const c = cases.find((item) => item.dir === "014-preset-layout");
    const content = c?.input.root;
    const original = c?.input.assemble?.scenarios[0];
    if (!content || !original?.preset) throw new Error("missing source fixture");
    const contentCanonical = canonicalizeCreation(content.creation);
    const module = canonicalizeCreation({
      id: "cr_01h455vb4pex5vsknk084sn007",
      ref: "@fixture/shared",
      type: "prompt-module",
      display_name: "Shared style",
      prompt_module: {
        version: "1-draft",
        blocks: [{ id: "style", default_at: "main", text: "Use vivid details." }],
      },
      meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
    });
    const moduleRelease = "rel_01h455vb4pex5vsknk084sn007";
    const base = canonicalizeCreation(original.preset.creation).creation;
    const policy = base.policy;
    if (!policy) throw new Error("missing policy");
    const preset = canonicalizeCreation({
      ...base,
      policy: {
        ...policy,
        imports: [
          {
            id: "first",
            use: module.creation.ref,
            pin: { release: moduleRelease, semantic_digest: module.semantic_digest },
          },
          {
            id: "second",
            use: module.creation.ref,
            pin: { release: moduleRelease, semantic_digest: module.semantic_digest },
          },
        ],
      },
      assembly_tests: [
        {
          id: "module-once",
          root: {
            ref: contentCanonical.creation.ref,
            release: content.release,
            semantic_digest: contentCanonical.semantic_digest,
          },
          preset: "self",
          profile: original.profile,
          session: original.turn,
          assembler: ASSEMBLER,
          tokenizer: { name: "estimate", version: TOKENIZER_VERSIONS.estimate },
          expected: {
            kind: "success",
            trace: [{ source: "preset:@fixture/shared#style", included: true, reason: "always" }],
          },
        },
      ],
    });
    const input = {
      root: {
        release: publishedIdentity(original.preset).release,
        visibility: "public" as const,
        creation: preset.creation,
      },
      ...(c?.input.options?.default_policy
        ? { default_policy: c.input.options.default_policy }
        : {}),
      dependencies: [
        content,
        ...(c?.input.deps ?? []),
        { release: moduleRelease, visibility: "public" as const, creation: module.creation },
      ],
    };
    const built = buildCreation(input);
    expect(built.artifact.kind).toBe("preset");
    if (built.artifact.kind !== "preset") throw new Error("expected preset");
    expect(
      built.artifact.preset.policy.blocks.filter((block) => block.id === "@fixture/shared#style"),
    ).toHaveLength(1);
    expect(built.artifact.preset.lock).toHaveLength(1);
    const report = await runAssemblyTests(input);
    expect(report.ok).toBe(true);
    expect(
      report.results[0]?.trace?.entries.filter(
        (entry) => entry.id === "preset:@fixture/shared#style",
      ),
    ).toHaveLength(1);
    const changed = {
      ...input,
      dependencies: input.dependencies.map((dep) =>
        dep.release === moduleRelease
          ? { ...dep, creation: { ...module.creation, display_name: "tampered" } }
          : dep,
      ),
    };
    expect(() => buildCreation(changed)).toThrow();
  });
});

describe("Story opening consumption across runtimes", () => {
  it.each(["en", "zh-CN"])("prepares exactly one localized opening in %s", (locale) => {
    const base = cases.find((item) => item.dir === "014-preset-layout");
    if (!base?.input.root || !base.input.options?.default_policy)
      throw new Error("Missing fixed policy fixture");
    const { artifact } = buildCreation({
      root: {
        release: base.input.root.release,
        visibility: "public",
        creation: {
          id: "cr_01h455vb4pex5vsknk084sn001",
          ref: "@fixture/story-start",
          cast: [{ key: "guest", who: { late: "persona" } }],
          type: "scenario",
          display_name: "Story",
          meta: { default_locale: "en", rights: "original", rating: "general", license: "CC0-1.0" },
          bootstrap: { greetings: [{ id: "unused", text: "UNUSED_BOOTSTRAP" }] },
          story: {
            version: 1,
            scenes: [
              {
                id: "lobby",
                title: "Lobby",
                opening: { en: "SCENE: Rain outside.", "zh-CN": "场景：外面下雨。" },
              },
            ],
            starts: [
              { id: "arrive", greeting: { en: "Welcome, {{user}}.", "zh-CN": "欢迎，{{user}}。" } },
            ],
          },
        },
      },
      dependencies: base.input.deps,
      default_policy: base.input.options.default_policy,
    });
    if (artifact.kind !== "content") throw new Error("Content required");
    const started = startSession({
      artifact,
      locale,
      bindings: Object.fromEntries(
        artifact.ir.late_slots.map((slot) => [
          slot.key,
          { kind: slot.accepts[0] ?? "persona", display_name: "Kai" },
        ]),
      ),
    });
    expect(started.opening?.speaker).toBeUndefined();
    expect(started.opening?.content).toBe(locale === "en" ? "Welcome, Kai." : "欢迎，Kai。");
    expect(started.turn.history).toHaveLength(1);
    const out = assemble({
      artifact,
      turn: started.turn,
      profile: {
        runtime: { name: "fixture", version: "1" },
        tokenizer: "estimate",
        mode: "narrator",
        context_window: 4096,
        reserve_for_output: 128,
        capabilities: { system_role: true, multiple_system_messages: true },
      },
    });
    expect(out.messages.filter((m) => m.role === "assistant")).toEqual([
      { role: "assistant", content: started.opening?.content, source: ["history"] },
    ]);
    expect(JSON.stringify(out.messages)).not.toContain("UNUSED_BOOTSTRAP");
    expect(
      out.messages.some(
        (m) =>
          m.role === "system" &&
          m.content.includes(locale === "en" ? "SCENE: Rain outside." : "场景：外面下雨。"),
      ),
    ).toBe(true);
  });
});
