import { describe, expect, it } from "vitest";
import { buildCreation } from "../src/build.js";
import { canonicalizeCreation, digestOf } from "../src/canonical.js";
import { getCreationDependencies } from "../src/dependencies.js";
import { mergeContribution } from "../src/merge.js";
import { resolvePreset, resolvePromptModule } from "../src/preset.js";
import { diffPresets } from "../src/preset-diff.js";
import { checkPublish, type PublishInput } from "../src/publish.js";
import type { ReleaseInput } from "../src/resolve/index.js";
import { CreationArtifactSchema } from "../src/schema/artifact.js";
import { type AssemblyFixtureInput, AssemblyFixtureSchema } from "../src/schema/assembly.js";
import { type CreationInput, CreationSchema, OPEN_CREATION_TYPES } from "../src/schema/creation.js";
import { PRESET_REGIONS, type PresetPolicy } from "../src/schema/policy.js";
import { D, level0Character, tid } from "./fixtures.js";

const profile = {
  runtime: { name: "test", version: "1" },
  tokenizer: "estimate",
  context_window: 8192,
  reserve_for_output: 512,
  mode: "narrator" as const,
  capabilities: { system_role: true, multiple_system_messages: true },
};
const engines = {
  assembler: { name: "@char-pub/assembler", version: "0.0.0" },
  tokenizer: { name: "estimate", version: "tokenx@2.1.0" },
};
const policy: PresetPolicy = {
  version: "0-draft",
  blocks: [{ id: "main", text: "Root", position: "main" }],
  layout: [...PRESET_REGIONS],
  requires: { system_role: true },
};
function creation(
  type: CreationInput["type"],
  n: number,
  extra: Partial<CreationInput> = {},
): CreationInput {
  const c = level0Character({
    id: tid("cr", n),
    ref: `@test/item-${n}`,
    type,
    assets: [],
    bootstrap: undefined,
    fragments: [],
    ...extra,
  });
  if (type === "preset") c.policy = extra.policy ?? structuredClone(policy);
  else if (type === "prompt-module")
    c.prompt_module = extra.prompt_module ?? {
      version: "0-draft",
      blocks: [{ id: "main", text: `Module ${n}`, position: "main" }],
    };
  else if (type === "scenario")
    c.cast = extra.cast ?? [{ key: "player", who: { late: "persona" } }];
  else
    c.fragments = extra.fragments ?? [
      {
        id: "main",
        stable: true,
        kind: type === "lorebook" ? "knowledge" : type,
        content: { type: "text", text: `Content ${n}` },
      },
    ];
  return c;
}
function release(
  c: CreationInput,
  n: number,
  extra: Partial<ReleaseInput> = {},
): ReleaseInput & { semantic_digest: string } {
  return {
    release: tid("rel", n),
    creation: c,
    visibility: "public",
    semantic_digest: canonicalizeCreation(c).semantic_digest,
    ...extra,
  };
}
function exact(r: ReleaseInput) {
  return {
    ref: canonicalizeCreation(r.creation).creation.ref,
    release: r.release,
    semantic_digest: canonicalizeCreation(r.creation).semantic_digest,
  };
}
function imp(id: string, r: ReleaseInput) {
  const ref = exact(r);
  return { id, use: ref.ref, pin: { release: ref.release, semantic_digest: ref.semantic_digest } };
}
function policyInput(r: ReleaseInput, deps: ReleaseInput[] = []) {
  return {
    creation: r.creation,
    release: r.release,
    semantic_digest: canonicalizeCreation(r.creation).semantic_digest,
    dependencies: deps,
  };
}
function publish(
  root: ReleaseInput,
  deps: ReleaseInput[] = [],
  registry: Partial<PublishInput["registry"]> = {},
) {
  return checkPublish({
    release: root.release,
    label: "v1",
    visibility: root.visibility,
    creation: root.creation,
    dependencies: deps,
    registry: {
      existingLabels: {},
      assetStatus: {},
      blockedDigests: new Set(),
      ownerNamespaces: new Set(["test"]),
      ...registry,
    },
  });
}
function fixture(extra: Partial<AssemblyFixtureInput> = {}): AssemblyFixtureInput {
  return {
    id: "basic",
    root: "self",
    profile,
    session: {},
    ...engines,
    expected: { kind: "success", trace: [{ source: "history" }] },
    ...extra,
  };
}

describe("first-class authoring schemas", () => {
  it("opens every declared type, requiring module contents and separating policy from Creative fields", () => {
    expect(OPEN_CREATION_TYPES).toContain("prompt-module");
    expect(OPEN_CREATION_TYPES).toContain("scenario");
    expect(CreationSchema.safeParse(creation("prompt-module", 1)).success).toBe(true);
    for (const c of [
      creation("character", 1, { prompt_module: { version: "0-draft", blocks: [] } }),
      { ...creation("prompt-module", 1), prompt_module: undefined },
      creation("prompt-module", 1, { fragments: level0Character().fragments }),
      creation("preset", 1, { prompt_module: { version: "0-draft", blocks: [] } }),
    ])
      expect(CreationSchema.safeParse(c).success).toBe(false);
  });
  it("normalizes modules and imports, while keeping import order semantic", () => {
    const a = release(creation("prompt-module", 2), 2),
      b = release(creation("prompt-module", 3), 3);
    const c = creation("prompt-module", 1, {
      prompt_module: {
        version: "0-draft",
        blocks: [{ id: "main", text: "Café \r\nX\t", position: "main", enabled: true }],
        imports: [],
      },
    });
    const canon = canonicalizeCreation(c);
    expect(canon.creation.prompt_module).toEqual({
      version: "0-draft",
      blocks: [{ id: "main", text: "Café\nX", position: "main" }],
    });
    const first = creation("preset", 1, {
      policy: { ...policy, imports: [imp("a", a), imp("b", b)] },
    });
    const second = creation("preset", 1, {
      policy: { ...policy, imports: [imp("b", b), imp("a", a)] },
    });
    expect(canonicalizeCreation(first).semantic_digest).not.toBe(
      canonicalizeCreation(second).semantic_digest,
    );
    expect(
      CreationSchema.safeParse(
        creation("preset", 1, { policy: { ...policy, imports: [imp("a", a), imp("a", b)] } }),
      ).success,
    ).toBe(false);
  });
  it("keeps private Session data out of assembly and validates fixture self references and assertions", () => {
    const p = release(creation("preset", 2), 2);
    const assembly = { version: "0-draft" as const, preset: exact(p), profile, ...engines };
    expect(CreationSchema.safeParse(creation("scenario", 1, { assembly })).success).toBe(true);
    expect(
      CreationSchema.safeParse({
        ...creation("scenario", 1),
        assembly: { ...assembly, history: [] },
      }).success,
    ).toBe(false);
    expect(CreationSchema.safeParse(creation("character", 1, { assembly })).success).toBe(false);
    expect(
      CreationSchema.safeParse(creation("preset", 1, { assembly_tests: [fixture()] })).success,
    ).toBe(false);
    expect(
      CreationSchema.safeParse(
        creation("scenario", 1, { assembly_tests: [fixture({ preset: "self" })] }),
      ).success,
    ).toBe(false);
    expect(
      CreationSchema.safeParse(creation("scenario", 1, { assembly_tests: [fixture(), fixture()] }))
        .success,
    ).toBe(false);
    expect(
      AssemblyFixtureSchema.safeParse(fixture({ expected: { kind: "success" } })).success,
    ).toBe(false);
    expect(
      AssemblyFixtureSchema.safeParse(
        fixture({ expected: { kind: "error", code: "assemble.budget_exceeded" } }),
      ).success,
    ).toBe(true);
  });
});

describe("policy dependency graph", () => {
  it("expands dependency-first in declaration order, deduplicates diamonds, and records stable origin/locks", () => {
    const leaf = release(creation("prompt-module", 4), 4);
    const a = release(
      creation("prompt-module", 2, {
        prompt_module: {
          version: "0-draft",
          blocks: [{ id: "own", text: "A", position: "main" }],
          imports: [imp("shared", leaf)],
        },
      }),
      2,
    );
    const b = release(
      creation("prompt-module", 3, {
        prompt_module: {
          version: "0-draft",
          blocks: [{ id: "own", text: "B", position: "after-history" }],
          imports: [imp("shared", leaf)],
        },
      }),
      3,
    );
    const root = release(
      creation("preset", 1, { policy: { ...policy, imports: [imp("b", b), imp("a", a)] } }),
      1,
    );
    const out = resolvePreset(policyInput(root, [a, b, leaf]));
    expect(out.policy.blocks.map((block) => block.id)).toEqual([
      "@test/item-4#main",
      "@test/item-3#own",
      "@test/item-2#own",
      "main",
    ]);
    expect(out.policy.blocks[0]?.origin).toMatchObject({
      ref: "@test/item-4",
      block: "main",
      via: ["b", "shared"],
    });
    expect(out.lock?.map((item) => item.ref)).toEqual([
      "@test/item-2",
      "@test/item-3",
      "@test/item-4",
    ]);
    expect(out.lock_digest).toBe(digestOf(out.lock));
    expect(out.policy).not.toHaveProperty("imports");
    expect(resolvePromptModule(policyInput(a, [leaf])).blocks.map((block) => block.id)).toEqual([
      "@test/item-4#main",
      "@test/item-2#own",
    ]);
  });
  it("rejects conflicting module versions, missing releases, type/ref/digest mismatches and removed modules", () => {
    const m1 = release(creation("prompt-module", 2), 2);
    const m2 = release(creation("prompt-module", 2, { display_name: "Updated" }), 3);
    const root = release(
      creation("preset", 1, { policy: { ...policy, imports: [imp("one", m1), imp("two", m2)] } }),
      1,
    );
    expect(() => resolvePreset(policyInput(root, [m1, m2]))).toThrow("resolve.diamond_conflict");
    expect(() => resolvePreset(policyInput(root, []))).toThrow("resolve.release_missing");
    const single = release(
      creation("preset", 1, { policy: { ...policy, imports: [imp("one", m1)] } }),
      1,
    );
    expect(() => resolvePreset(policyInput(single, [{ ...m1, status: "tombstoned" }]))).toThrow(
      "resolve.tombstoned",
    );
    const wrongRef = release(
      creation("preset", 1, {
        policy: { ...policy, imports: [{ ...imp("one", m1), use: "@test/other" }] },
      }),
      1,
    );
    expect(() => resolvePreset(policyInput(wrongRef, [m1]))).toThrow("resolve.pin_ref_mismatch");
    expect(() =>
      resolvePreset(
        policyInput(single, [
          { ...m1, creation: creation("prompt-module", 2, { display_name: "Tampered" }) },
        ]),
      ),
    ).toThrow("resolve.semantic_digest_mismatch");
    const p = release(creation("preset", 3), 3);
    const wrongType = release(
      creation("preset", 1, { policy: { ...policy, imports: [imp("preset", p)] } }),
      1,
    );
    expect(() => resolvePreset(policyInput(wrongType, [p]))).toThrow("resolve.not_prompt_module");
  });
  it("detects cycles before duplicate-injection suppression", () => {
    const c = creation("prompt-module", 1, {
      prompt_module: {
        version: "0-draft",
        blocks: [],
        imports: [
          {
            id: "self",
            use: "@test/item-1",
            pin: { release: tid("rel", 1), semantic_digest: D("a") },
          },
        ],
      },
    });
    const root = release(c, 1);
    expect(() => resolvePromptModule(policyInput(root, [root]))).toThrow("resolve.cycle");
    expect(() => buildCreation({ root })).toThrow("resolve.cycle");
  });
  it("enforces longest path depth even when a shared subtree was cached along a short path", () => {
    const deps: ReleaseInput[] = [];
    let leaf = release(creation("prompt-module", 80), 80);
    deps.push(leaf);
    for (let i = 79; i >= 50; i--) {
      leaf = release(
        creation("prompt-module", i, {
          prompt_module: { version: "0-draft", blocks: [], imports: [imp("child", leaf)] },
        }),
        i,
      );
      deps.push(leaf);
    }
    const shared = leaf;
    let long = leaf;
    for (let i = 49; i >= 45; i--) {
      long = release(
        creation("prompt-module", i, {
          prompt_module: { version: "0-draft", blocks: [], imports: [imp("child", long)] },
        }),
        i,
      );
      deps.push(long);
    }
    const root = release(
      creation("preset", 1, {
        policy: { ...policy, imports: [imp("short", shared), imp("long", long)] },
      }),
      1,
    );
    expect(() => resolvePreset(policyInput(root, deps))).toThrow("resolve.graph_too_deep");
    expect(() => buildCreation({ root, dependencies: deps })).toThrow("resolve.graph_too_deep");
  });
});

describe("aggregate artifacts and publication", () => {
  it("preserves legacy Creative lock paths and digests including the first sorted edge", () => {
    const world = release(creation("world", 2), 2);
    const reference = {
      use: exact(world).ref,
      pin: { release: world.release, semantic_digest: exact(world).semantic_digest },
      mode: "intrinsic" as const,
    };
    const root = release(
      creation("scenario", 1, {
        references: [
          { id: "z", ...reference },
          { id: "a", ...reference },
        ],
      }),
      1,
    );
    const built = buildCreation({ root, dependencies: [world] });
    expect(built.lock).toEqual(built.resolved?.lock);
    expect(built.lock[0]?.via).toEqual(["a"]);
    expect(built.artifact.lock_digest).toBe(built.resolved?.ir.lock_digest);
  });
  it("builds policy artifacts without an IR and exposes exact aggregate locks", () => {
    const mod = release(
      creation("prompt-module", 2, { meta: { ...level0Character().meta, rating: "mature" } }),
      2,
    );
    const root = release(
      creation("preset", 1, { policy: { ...policy, imports: [imp("module", mod)] } }),
      1,
    );
    const built = buildCreation({ root, dependencies: [mod] });
    expect(built.artifact.kind).toBe("preset");
    expect(built.resolved).toBeUndefined();
    expect(built.artifact).not.toHaveProperty("ir");
    expect(built.artifact.meta.rating).toBe("mature");
    expect(built.lock).toHaveLength(1);
    expect(CreationArtifactSchema.safeParse(built.artifact).success).toBe(true);
    expect(buildCreation({ root: mod }).artifact.kind).toBe("prompt-module");
    const report = publish(root, [mod]);
    expect(report.ok).toBe(true);
    expect(report.artifact?.kind).toBe("preset");
    expect(report.build?.digest).toBe(built.digest);
  });
  it("preserves Creative lock separately from Scenario assembly and test dependencies", () => {
    const preset = release(creation("preset", 2), 2),
      content = release(creation("character", 3), 3);
    const root = release(
      creation("scenario", 1, {
        assembly: { version: "0-draft", preset: exact(preset), profile, ...engines },
        assembly_tests: [fixture({ root: exact(content), preset: exact(preset) })],
      }),
      1,
    );
    const direct = getCreationDependencies(root.creation as CreationInput);
    expect(direct.map((d) => [d.domain, d.accepts])).toEqual([
      ["assembly", "preset"],
      ["test", "content"],
      ["test", "preset"],
    ]);
    const built = buildCreation({ root, dependencies: [preset, content] });
    expect(built.resolved?.lock).toEqual([]);
    expect(built.lock).toHaveLength(2);
    if (built.artifact.kind !== "content") throw Error("expected content");
    expect(built.artifact.assembly?.preset.ref).toBe("@test/item-2");
    expect(built.artifact.ir.lock_digest).not.toBe(built.artifact.lock_digest);
  });
  it("rejects cross-domain version conflicts and wrong dependency kinds", () => {
    const a = release(creation("character", 3), 3),
      b = release(creation("character", 3, { display_name: "v2" }), 4);
    const p = release(
      creation("preset", 2, { assembly_tests: [fixture({ root: exact(b), preset: "self" })] }),
      2,
    );
    const root = release(
      creation("scenario", 1, {
        references: [
          {
            id: "character",
            use: exact(a).ref,
            pin: { release: a.release, semantic_digest: exact(a).semantic_digest },
            mode: "intrinsic",
          },
        ],
        assembly: { version: "0-draft", preset: exact(p), profile, ...engines },
      }),
      1,
    );
    expect(() => buildCreation({ root, dependencies: [a, b, p] })).toThrow(
      "resolve.diamond_conflict",
    );
    const wrong = release(
      creation("scenario", 1, {
        assembly: { version: "0-draft", preset: exact(a), profile, ...engines },
      }),
      1,
    );
    expect(() => buildCreation({ root: wrong, dependencies: [a] })).toThrow(
      "resolve.dependency_type_mismatch",
    );
  });
  it("applies visibility, removal, blacklist, license and asset checks to policy closure", () => {
    const mod = release(creation("prompt-module", 2), 2);
    const makeRoot = (m: ReleaseInput) =>
      release(creation("preset", 1, { policy: { ...policy, imports: [imp("module", m)] } }), 1);
    expect(
      publish(makeRoot(mod), [{ ...mod, visibility: "private" }]).issues.some(
        (x) => x.code === "publish.public_depends_on_private",
      ),
    ).toBe(true);
    expect(
      publish(makeRoot(mod), [{ ...mod, status: "tombstoned", status_reason: "Removed" }])
        .issues[0],
    ).toMatchObject({ code: "publish.tombstoned_dependency", detail: "Removed" });
    expect(
      publish(makeRoot(mod), [{ ...mod, status: "yanked" }]).issues.some(
        (x) => x.code === "publish.yanked_dependency",
      ),
    ).toBe(true);
    expect(
      publish(makeRoot(mod), [mod], { blockedDigests: new Set([mod.semantic_digest]) }).issues.some(
        (x) => x.code === "publish.blocked_content",
      ),
    ).toBe(true);
    const bad = release(
      creation("prompt-module", 2, {
        meta: { ...level0Character().meta, license: "LicenseRef-All-Rights-Reserved" },
      }),
      2,
    );
    expect(publish(makeRoot(bad), [bad], { ownerNamespaces: new Set() }).ok).toBe(false);
    const withAsset = release(
      creation("prompt-module", 2, { assets: level0Character().assets }),
      2,
    );
    expect(
      publish(makeRoot(withAsset), [withAsset]).issues.some(
        (x) => x.code === "publish.asset_not_ready",
      ),
    ).toBe(true);
    const block = canonicalizeCreation(mod.creation).creation.prompt_module?.blocks[0];
    expect(publish(makeRoot(mod), [mod], { blockedDigests: new Set([digestOf(block)]) }).ok).toBe(
      false,
    );
  });
  it("checks test dependencies for public access even when they are not injected", () => {
    const target = release(creation("character", 2), 2, { visibility: "private" });
    const root = release(
      creation("preset", 1, { assembly_tests: [fixture({ root: exact(target), preset: "self" })] }),
      1,
    );
    expect(
      publish(root, [target]).issues.some((x) => x.code === "publish.public_depends_on_private"),
    ).toBe(true);
  });
});

describe("configuration contributions", () => {
  it("merges policy atomically, preserves other metadata, detects conflicts and repeated application", () => {
    const base = creation("preset", 1);
    const canonical = canonicalizeCreation(base);
    const change = {
      on: "configuration",
      field: "policy",
      op: "set",
      base_digest: digestOf(canonical.creation.policy),
      after: { ...policy, blocks: [{ id: "main", text: "Changed", position: "main" }] },
    };
    const first = mergeContribution({ ...base, display_name: "Other author edit" }, [change]);
    expect(first.result?.creation.policy?.blocks[0]?.text).toBe("Changed");
    expect(first.result?.creation.display_name).toBe("Other author edit");
    if (!first.result) throw new Error("expected successful merge");
    expect(mergeContribution(first.result.creation, [change]).outcomes[0]?.state).toBe(
      "already_applied",
    );
    const other = creation("preset", 1, { policy: { ...policy, blocks: [] } });
    expect(mergeContribution(other, [change]).result).toBeNull();
  });
  it("rejects default-value noops, wrong configuration types, required unsets and duplicate fields", () => {
    const base = creation("preset", 1);
    const digest = digestOf(canonicalizeCreation(base).creation.policy);
    const equal = {
      on: "configuration",
      field: "policy",
      op: "set",
      base_digest: digest,
      after: {
        ...policy,
        imports: [],
        region_budgets: {},
        blocks: policy.blocks.map((b) => ({ ...b, enabled: true })),
      },
    };
    expect(() => mergeContribution(base, [equal])).toThrow("contribution.noop_change");
    expect(() =>
      mergeContribution(base, [
        { on: "configuration", field: "policy", op: "unset", base_digest: digest },
      ]),
    ).toThrow("contribution.required_field");
    expect(() =>
      mergeContribution(base, [
        { on: "configuration", field: "assembly", op: "set", after: policy },
      ]),
    ).toThrow("contribution.invalid_change");
    expect(() =>
      mergeContribution(base, [
        { ...equal, after: { ...policy, blocks: [] } },
        { ...equal, after: { ...policy, blocks: [] } },
      ]),
    ).toThrow("contribution.duplicate_key");
  });
  it("adds/removes assembly and fixtures and supports module changes without Creative writes", () => {
    const p = release(creation("preset", 2), 2);
    const base = creation("scenario", 1);
    const assembly = { version: "0-draft", preset: exact(p), profile, ...engines };
    const change = { on: "configuration", field: "assembly", op: "set", after: assembly };
    const merged = mergeContribution(base, [
      change,
      { on: "configuration", field: "assembly_tests", op: "set", after: [fixture()] },
    ]);
    expect(merged.result?.creation.assembly?.preset).toEqual(exact(p));
    if (!merged.result) throw new Error("expected successful merge");
    const removed = mergeContribution(merged.result.creation, [
      { on: "configuration", field: "assembly", op: "unset", base_digest: digestOf(assembly) },
    ]);
    expect(removed.result?.creation.assembly).toBeUndefined();
    const module = creation("prompt-module", 3);
    const moduleChange = {
      on: "configuration",
      field: "prompt_module",
      op: "set",
      base_digest: digestOf(module.prompt_module),
      after: { version: "0-draft", blocks: [] },
    };
    expect(
      mergeContribution(module, [moduleChange]).result?.creation.prompt_module?.blocks,
    ).toEqual([]);
    expect(() =>
      mergeContribution(base, [
        { on: "configuration", field: "assembly_tests", op: "set", after: [] },
      ]),
    ).toThrow("empty assembly_tests must be unset");
  });
});

describe("policy upgrade provenance", () => {
  it("shows same-text dependency release upgrades in locks and block origins", () => {
    const one = release(creation("prompt-module", 2), 2);
    const two = { ...one, release: tid("rel", 3) };
    const first = release(
      creation("preset", 1, { policy: { ...policy, imports: [imp("module", one)] } }),
      1,
    );
    const second = release(
      creation("preset", 1, { policy: { ...policy, imports: [imp("module", two)] } }),
      4,
    );
    const diff = diffPresets(
      resolvePreset(policyInput(first, [one])),
      resolvePreset(policyInput(second, [two])),
    );
    expect(diff.blocks).toEqual({ added: [], removed: [], modified: [], order_changed: false });
    expect(diff.policy_changes).toEqual([]);
    expect(diff.lock_changes).toHaveLength(1);
    expect(diff.lock_changes?.[0]).toMatchObject({
      ref: "@test/item-2",
      from: { release: one.release },
      to: { release: two.release },
    });
    expect(diff.origin_changes?.find((change) => change.id === "@test/item-2#main")).toMatchObject({
      from: { release: one.release },
      to: { release: two.release },
    });
  });
  it("does not invent lock/origin changes for equivalent defaults or legacy empty locks", () => {
    const value = resolvePreset(policyInput(release(creation("preset", 1), 1)));
    const diff = diffPresets(value, {
      ...value,
      lock: undefined,
      lock_digest: undefined,
      policy: {
        ...value.policy,
        region_budgets: {},
        blocks: value.policy.blocks.map((block) => ({ ...block, enabled: true })),
      },
    });
    expect(diff.lock_changes).toEqual([]);
    expect(diff.origin_changes).toEqual([]);
    expect(diff.blocks.modified).toEqual([]);
    expect(diff.policy_changes).toEqual([]);
  });
  it("checks an intermediate dependency license even when the root already has a restrictive license", () => {
    const leaf = release(
      creation("prompt-module", 3, {
        meta: { ...level0Character().meta, license: "CC-BY-NC-4.0" },
      }),
      3,
    );
    const middle = release(
      creation("prompt-module", 2, {
        meta: { ...level0Character().meta, license: "MIT" },
        prompt_module: { version: "0-draft", blocks: [], imports: [imp("leaf", leaf)] },
      }),
      2,
    );
    const root = release(
      creation("preset", 1, {
        meta: { ...level0Character().meta, license: "CC-BY-NC-4.0" },
        policy: { ...policy, imports: [imp("middle", middle)] },
      }),
      1,
    );
    const report = publish(root, [middle, leaf]);
    expect(report.ok).toBe(true);
    expect(report.license_check).toBe("warn");
    expect(
      report.issues.some(
        (issue) =>
          issue.code === "license.noncommercial_dependency" && issue.detail?.includes("MIT"),
      ),
    ).toBe(true);
  });
});
