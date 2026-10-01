import { describe, expect, it } from "vitest";
import { buildCreation } from "../src/build.js";
import { canonicalizeCreation } from "../src/canonical.js";
import { checkDraftBuild, checkPublish } from "../src/publish.js";
import { CreationArtifactSchema, requirePublishedArtifact } from "../src/schema/artifact.js";
import { buildIdentity, ExactRefSchema, sameBuildIdentity } from "../src/schema/identity.js";
import { PublishedResolvedPresetSchema } from "../src/schema/preset.js";
import { buildTestCreation, TEST_DEFAULT_PIN, withTestDefault } from "./build.js";
import { DRAFT_ORIGIN, draftInput } from "./draft-build-fixtures.js";
import { D, level0Character, tid } from "./fixtures.js";

function sourcesOf(artifact: ReturnType<typeof buildTestCreation>["artifact"]) {
  return [
    artifact.root,
    ...artifact.assets.map((a) => a.origin),
    ...(artifact.kind === "content"
      ? [
          artifact.ir.root,
          ...artifact.ir.fragments.map((f) => f.origin),
          ...artifact.ir.graph.nodes,
          ...artifact.ir.assets.map((a) => a.origin),
        ]
      : []),
  ];
}

describe("draft build identity", () => {
  it("checks participant adaptations against dependency licenses in both lifecycle paths", () => {
    const character = level0Character({ ref: "@other/actor", assets: [], bootstrap: undefined });
    character.meta.license = "CC-BY-ND-4.0";
    const dependency = {
      creation: character,
      release: tid("rel", 604),
      visibility: "public" as const,
      semantic_digest: canonicalizeCreation(character).semantic_digest,
    };
    const creation = {
      id: tid("cr", 604),
      ref: "@draft/story",
      type: "scenario",
      display_name: "Story",
      meta: { ...character.meta },
      references: [
        {
          id: "actor",
          use: character.ref,
          mode: "default",
          pin: { release: dependency.release, semantic_digest: dependency.semantic_digest },
        },
      ],
      cast: [
        {
          key: "actor",
          who: character.ref,
          override: [
            {
              op: "replace",
              target: "description",
              content: { type: "text", text: "Changed personality" },
            },
          ],
        },
      ],
    };
    const input = withTestDefault({
      root: { creation, origin: DRAFT_ORIGIN, visibility: "private" as const },
      dependencies: [dependency],
    });
    const registry = {
      assetStatus: {},
      blockedDigests: new Set<string>(),
      ownerNamespaces: new Set(["draft"]),
    };
    const common = {
      creation,
      dependencies: input.dependencies,
      default_policy: input.default_policy,
    };
    const draft = checkDraftBuild({ ...common, origin: DRAFT_ORIGIN, registry });
    const published = checkPublish({
      ...common,
      release: tid("rel", 605),
      label: "v1",
      visibility: "private",
      registry: { ...registry, existingLabels: {} },
    });
    expect(draft.ok).toBe(false);
    expect(draft.license_check).toBe("fail");
    expect(draft.issues).toEqual(published.issues);
    expect(draft.issues.some((issue) => issue.code.includes("derivative"))).toBe(true);
  });
  it.each(["ready", "processing", "quarantined", "blocked"] as const)(
    "runs the same content gates as publishing without a Release or label (%s)",
    (status) => {
      const input = withTestDefault(draftInput());
      const registry = {
        assetStatus: {
          [D("a")]: "ready" as const,
          [D("c")]: status === "blocked" ? ("ready" as const) : status,
        },
        blockedDigests: new Set(status === "blocked" ? [D("c")] : []),
        ownerNamespaces: new Set(["draft"]),
      };
      const common = {
        creation: input.root.creation,
        dependencies: input.dependencies,
        default_policy: input.default_policy,
      };
      const draft = checkDraftBuild({ ...common, origin: DRAFT_ORIGIN, registry });
      const published = checkPublish({
        ...common,
        release: tid("rel", 601),
        label: "test",
        visibility: "private",
        registry: { ...registry, existingLabels: {} },
      });
      expect(draft.ok).toBe(status === "ready");
      expect(draft.issues).toEqual(published.issues);
      expect(draft.license_check).toBe(published.license_check);
      expect(draft).not.toHaveProperty("idempotent");
      if (draft.ok) expect(draft.artifact?.root).toMatchObject({ origin: DRAFT_ORIGIN });
      else
        expect(
          draft.issues.some(
            (issue) =>
              issue.code ===
              (status === "blocked" ? "publish.blocked_content" : "publish.asset_not_ready"),
          ),
        ).toBe(true);
    },
  );
  it("retains real draft provenance throughout root content and assets with released dependencies", () => {
    const input = draftInput();
    const { artifact, json } = buildTestCreation(input);
    expect(artifact.root).toEqual({
      ref: "@draft/character",
      semantic_digest: input.root.semantic_digest,
      origin: DRAFT_ORIGIN,
    });
    if (artifact.kind !== "content") throw new Error("Missing content");
    for (const source of sourcesOf(artifact)) {
      expect(buildIdentity(source)).toEqual({ origin: DRAFT_ORIGIN });
      expect(source).not.toHaveProperty("release");
    }
    expect(artifact.default_policy?.release).toBe(TEST_DEFAULT_PIN.release);
    expect(artifact.lock.every((entry) => entry.release.startsWith("rel_"))).toBe(true);
    expect(buildTestCreation(input).json).toBe(json);
    expect(() => requirePublishedArtifact(artifact)).toThrowError(
      expect.objectContaining({ code: "build.release_required" }),
    );
  });

  it("separates build identity from authored semantics and dependency locks", () => {
    const input = draftInput();
    const first = buildTestCreation(input);
    const second = buildTestCreation({
      root: { ...input.root, origin: { ...DRAFT_ORIGIN, build_id: tid("dbld", 602) } },
    });
    expect(second.artifact.root.semantic_digest).toBe(first.artifact.root.semantic_digest);
    expect(second.artifact.lock_digest).toBe(first.artifact.lock_digest);
    expect(second.digest).not.toBe(first.digest);
    expect(sameBuildIdentity(first.artifact.root, second.artifact.root)).toBe(false);
    if (first.artifact.kind !== "content" || second.artifact.kind !== "content")
      throw new Error("Missing content");
    expect(second.artifact.ir.fragments.map((f) => [f.id, f.digest, f.content])).toEqual(
      first.artifact.ir.fragments.map((f) => [f.id, f.digest, f.content]),
    );
  });

  it.each(["preset", "prompt-module"] as const)(
    "supports draft %s roots and block provenance",
    (type) => {
      const { artifact } = buildCreation(draftInput(type));
      expect(artifact.root).not.toHaveProperty("release");
      if (artifact.kind === "content") throw new Error("Wrong kind");
      const resolved = artifact.kind === "preset" ? artifact.preset : artifact.module;
      expect(buildIdentity(resolved)).toEqual({ origin: DRAFT_ORIGIN });
      const blocks = "policy" in resolved ? resolved.policy.blocks : resolved.blocks;
      expect(blocks[0]?.origin).toMatchObject({ origin: DRAFT_ORIGIN });
      expect(blocks[0]?.origin).not.toHaveProperty("release");
    },
  );

  it("rejects mixed identities, invalid build identifiers and public draft roots", () => {
    const input = draftInput();
    for (const root of [
      { ...input.root, release: tid("rel", 601) },
      { ...input.root, origin: { ...DRAFT_ORIGIN, build_id: tid("rel", 601) } },
      { ...input.root, origin: { ...DRAFT_ORIGIN, revision: tid("cr", 601) } },
      { ...input.root, origin: { ...DRAFT_ORIGIN, expires_at: "soon" } },
    ])
      expect(() => buildTestCreation(JSON.parse(JSON.stringify({ root })))).toThrowError(
        expect.objectContaining({ code: "schema.invalid" }),
      );
    expect(() => buildTestCreation({ root: { ...input.root, visibility: "public" } })).toThrowError(
      expect.objectContaining({ code: "build.invalid_draft_state" }),
    );
  });

  it("cannot be used as a dependency, pin, locked assembly or default policy", () => {
    const input = draftInput();
    expect(
      ExactRefSchema.safeParse({
        ref: "@draft/character",
        origin: DRAFT_ORIGIN,
        semantic_digest: input.root.semantic_digest,
      }).success,
    ).toBe(false);
    expect(() =>
      buildTestCreation(
        JSON.parse(JSON.stringify({ ...input, dependencies: [draftInput("preset").root] })),
      ),
    ).toThrowError(expect.objectContaining({ code: "build.release_required" }));
    const { artifact } = buildTestCreation(input);
    const draftPolicy = buildCreation(draftInput("preset")).artifact;
    if (artifact.kind !== "content" || draftPolicy.kind !== "preset") throw new Error("Wrong kind");
    expect(
      CreationArtifactSchema.safeParse({ ...artifact, default_policy: draftPolicy.preset }).success,
    ).toBe(false);
  });

  it("keeps imported module origins published within a draft policy", () => {
    const input = draftInput("preset");
    const module = draftInput("prompt-module").root;
    const pin = { release: tid("rel", 602), semantic_digest: module.semantic_digest };
    if (!input.root.creation.policy) throw new Error("Missing policy");
    input.root.creation.policy.imports = [{ id: "module", use: module.creation.ref, pin }];
    input.root.semantic_digest = canonicalizeCreation(input.root.creation).semantic_digest;
    const { artifact } = buildCreation({
      ...input,
      dependencies: [{ creation: module.creation, visibility: "public", ...pin }],
    });
    if (artifact.kind !== "preset") throw new Error("Wrong kind");
    expect(
      artifact.preset.policy.blocks.find((b) => b.origin?.ref === module.creation.ref)?.origin,
    ).toMatchObject(pin);
    expect(
      artifact.preset.policy.blocks.find((b) => b.origin?.ref === input.root.creation.ref)?.origin,
    ).toMatchObject({ origin: DRAFT_ORIGIN });
  });

  it("rejects a draft disguised as a published artifact, including nested origins", () => {
    const input = draftInput();
    const { artifact } = buildTestCreation({
      root: { creation: input.root.creation, release: tid("rel", 601), visibility: "private" },
    });
    expect(requirePublishedArtifact(artifact, tid("rel", 601))).toBe(artifact);
    expect(() => requirePublishedArtifact(artifact, tid("rel", 602))).toThrowError(
      expect.objectContaining({ code: "build.release_mismatch" }),
    );
    const asset = artifact.assets[0];
    if (!asset) throw new Error("Missing asset");
    const { release: _release, ...metadata } = { ...asset.origin, release: tid("rel", 601) };
    asset.origin = { ...metadata, origin: DRAFT_ORIGIN };
    expect(() => requirePublishedArtifact(artifact)).toThrowError(
      expect.objectContaining({ code: "build.release_required" }),
    );
  });

  it("checks both policy sources and rejects draft block provenance under a released policy", () => {
    const input = draftInput();
    const { artifact } = buildTestCreation({
      root: { creation: input.root.creation, release: tid("rel", 601), visibility: "private" },
    });
    const policyInput = draftInput("preset");
    const policy = buildCreation({
      root: { creation: policyInput.root.creation, release: tid("rel", 606), visibility: "public" },
    }).artifact;
    if (artifact.kind !== "content" || policy.kind !== "preset") throw new Error("Wrong fixtures");
    const forged = JSON.parse(
      JSON.stringify({
        ...artifact,
        default_policy: policy.preset,
        assembly: {
          version: "1-draft",
          preset: policy.preset,
          profile: {
            runtime: { name: "test", version: "1" },
            tokenizer: "estimate",
            context_window: 4096,
            reserve_for_output: 0,
            mode: "narrator",
            capabilities: { system_role: true },
          },
          assembler: { name: "test", version: "1" },
          tokenizer: { name: "estimate", version: "1" },
        },
      }),
    );
    expect(CreationArtifactSchema.safeParse(forged).success).toBe(true);
    const blockOrigin = forged.default_policy.policy.blocks[0].origin;
    delete blockOrigin.release;
    blockOrigin.origin = DRAFT_ORIGIN;
    expect(PublishedResolvedPresetSchema.safeParse(forged.default_policy).success).toBe(false);
    expect(CreationArtifactSchema.safeParse(forged).success).toBe(false);
    expect(() => requirePublishedArtifact(forged)).toThrowError(
      expect.objectContaining({ code: "build.release_required" }),
    );
  });
});
