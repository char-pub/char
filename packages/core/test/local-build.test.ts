import { describe, expect, it } from "vitest";
import { buildCreation } from "../src/build.js";
import { canonicalizeCreation } from "../src/canonical.js";
import { createLocalBuildInput, localBuildOrigin } from "../src/local-build.js";
import { checkDraftBuild, type DraftBuildCheckInput } from "../src/publish.js";
import { CreationArtifactSchema, requirePublishedArtifact } from "../src/schema/artifact.js";
import {
  buildIdentity,
  buildIdentityKey,
  ExactRefSchema,
  publishedIdentity,
} from "../src/schema/identity.js";
import { PublishedResolvedPresetSchema } from "../src/schema/preset.js";
import { TEST_DEFAULT_POLICY, withTestDefault } from "./build.js";
import { draftInput } from "./draft-build-fixtures.js";
import { D, tid } from "./fixtures.js";

const source = () => withTestDefault(draftInput());
describe("local compilation receipts", () => {
  it("preserves local source identity throughout content while dependencies stay published", () => {
    const input = createLocalBuildInput(source());
    const artifact = buildCreation(input).artifact;
    expect(artifact.root).toMatchObject({ origin: input.root.origin });
    expect(artifact.root).not.toHaveProperty("release");
    expect(input.root.origin).not.toHaveProperty("build_id");
    expect(input.root.origin).not.toHaveProperty("revision");
    expect(input.root.origin).not.toHaveProperty("expires_at");
    expect(buildIdentityKey(artifact.root)).toBe(`local:${input.root.origin.input_digest}`);
    if (artifact.kind !== "content") throw new Error("content required");
    for (const item of [
      artifact.ir.root,
      ...artifact.ir.graph.nodes.filter((n) => "origin" in n),
      ...artifact.ir.fragments.map((f) => f.origin),
      ...artifact.assets.map((a) => a.origin),
    ])
      expect(item).toMatchObject({ origin: input.root.origin });
    expect(artifact.lock).toEqual([
      expect.objectContaining({ release: TEST_DEFAULT_POLICY.release }),
    ]);
    expect(artifact.default_policy).toHaveProperty("release", TEST_DEFAULT_POLICY.release);
    expect(CreationArtifactSchema.parse(artifact)).toEqual(artifact);
  });
  it.each(["preset", "prompt-module"] as const)(
    "retains a local %s and block provenance",
    (type) => {
      const input = createLocalBuildInput(draftInput(type));
      const artifact = buildCreation(input).artifact;
      const policy =
        artifact.kind === "preset"
          ? artifact.preset
          : artifact.kind === "prompt-module"
            ? artifact.module
            : null;
      expect(policy).toMatchObject({ origin: input.root.origin });
      const blocks =
        artifact.kind === "preset"
          ? artifact.preset.policy.blocks
          : artifact.kind === "prompt-module"
            ? artifact.module.blocks
            : [];
      expect(blocks[0]?.origin).toMatchObject({ origin: input.root.origin });
    },
  );
  it("normalizes duplicate equivalent snapshots for both the receipt and compilation", () => {
    const original = source();
    const dependency = original.dependencies[0];
    if (!dependency) throw new Error("missing dependency");
    const canonical = canonicalizeCreation(dependency.creation);
    const equivalent = {
      ...dependency,
      creation: canonical.creation,
      semantic_digest: canonical.semantic_digest,
      status: "active" as const,
    };
    const one = createLocalBuildInput(original);
    const duplicate = createLocalBuildInput({
      ...original,
      dependencies: [equivalent, dependency],
    });
    expect(duplicate.root.origin).toEqual(one.root.origin);
    expect(duplicate.dependencies).toHaveLength(1);
    expect(buildCreation(duplicate).json).toBe(buildCreation(one).json);
    expect(buildCreation({ ...duplicate, dependencies: [dependency, equivalent] }).json).toBe(
      buildCreation(one).json,
    );
    expect(() =>
      createLocalBuildInput({
        ...original,
        dependencies: [dependency, { ...equivalent, visibility: "private" }],
      }),
    ).toThrowError(expect.objectContaining({ code: "resolve.duplicate_release" }));
  });
  it("binds exact configuration and all supplied snapshots, without text-normalizing URLs", () => {
    const original = source();
    const a = createLocalBuildInput({
      ...original,
      publicAssetBaseUrl: "https://assets.test/path",
    });
    const b = createLocalBuildInput({
      ...original,
      publicAssetBaseUrl: "https://assets.test/path ",
    });
    expect(a.root.origin).not.toEqual(b.root.origin);
    expect(() =>
      buildCreation({ ...a, publicAssetBaseUrl: "https://assets.test/path " }),
    ).toThrowError(expect.objectContaining({ code: "build.local_input_mismatch" }));
    const extra = { ...TEST_DEFAULT_POLICY, release: tid("rel", 801) };
    expect(
      localBuildOrigin({ ...original, dependencies: [extra, ...original.dependencies] }),
    ).toEqual(localBuildOrigin({ ...original, dependencies: [...original.dependencies, extra] }));
    expect(
      localBuildOrigin({ ...original, dependencies: [extra, ...original.dependencies] }),
    ).not.toEqual(a.root.origin);
    expect(
      localBuildOrigin({
        ...original,
        fixture: { id: "not a compilation option" },
      } as typeof original),
    ).toEqual(localBuildOrigin(original));
  });
  it("rejects forged receipts, invalid private state, and incorrect declared semantic digests", () => {
    const input = createLocalBuildInput(source());
    expect(() =>
      buildCreation({
        ...input,
        root: { ...input.root, origin: { kind: "local-build", input_digest: D("a") } },
      }),
    ).toThrowError(expect.objectContaining({ code: "build.local_input_mismatch" }));
    expect(() =>
      buildCreation({ ...input, root: { ...input.root, visibility: "public" } }),
    ).toThrowError(expect.objectContaining({ code: "build.invalid_local_state" }));
    expect(() =>
      createLocalBuildInput({ ...source(), root: { ...source().root, semantic_digest: D("a") } }),
    ).toThrowError(expect.objectContaining({ code: "resolve.semantic_digest_mismatch" }));
    expect(() =>
      buildIdentity({ release: tid("rel", 802), origin: input.root.origin } as never),
    ).toThrowError(expect.objectContaining({ code: "schema.invalid" }));
  });
  it("never treats a local origin as a pin, published artifact, or Registry draft build", () => {
    const input = createLocalBuildInput(source());
    const artifact = buildCreation(input).artifact;
    expect(ExactRefSchema.safeParse(artifact.root).success).toBe(false);
    expect(() => publishedIdentity(artifact.root)).toThrowError(
      expect.objectContaining({ code: "build.release_required" }),
    );
    expect(() => requirePublishedArtifact(artifact)).toThrowError(
      expect.objectContaining({ code: "build.release_required" }),
    );
    expect(() => buildCreation({ ...input, dependencies: [input.root as never] })).toThrow();
    expect(() => buildCreation({ ...input, default_policy: artifact.root as never })).toThrow();
    const report = checkDraftBuild({
      creation: input.root.creation,
      origin: input.root.origin,
      registry: { assetStatus: {}, blockedDigests: new Set(), ownerNamespaces: new Set() },
    } as unknown as DraftBuildCheckInput);
    expect(report).toMatchObject({
      ok: false,
      issues: [{ code: "schema.invalid", subject: "build.origin" }],
    });
  });
  it("rejects local provenance hidden inside an otherwise published artifact", () => {
    const input = source();
    const { artifact } = buildCreation({
      ...input,
      root: { creation: input.root.creation, release: tid("rel", 803), visibility: "private" },
    });
    const local = createLocalBuildInput(input).root.origin;
    const asset = artifact.assets[0];
    if (!asset) throw new Error("missing asset");
    const { release: _, ...origin } = asset.origin as typeof asset.origin & { release: string };
    asset.origin = { ...origin, origin: local };
    expect(() => requirePublishedArtifact(artifact)).toThrowError(
      expect.objectContaining({ code: "build.release_required" }),
    );
    const preset = buildCreation({
      root: {
        creation: draftInput("preset").root.creation,
        release: tid("rel", 804),
        visibility: "public",
      },
    }).artifact;
    if (preset.kind !== "preset") throw new Error("preset required");
    const block = preset.preset.policy.blocks[0];
    if (!block?.origin) throw new Error("block origin required");
    const { release: __, ...blockOrigin } = block.origin as typeof block.origin & {
      release: string;
    };
    block.origin = { ...blockOrigin, origin: local };
    expect(PublishedResolvedPresetSchema.safeParse(preset.preset).success).toBe(false);
    expect(() => requirePublishedArtifact(preset)).toThrowError(
      expect.objectContaining({ code: "build.release_required" }),
    );
  });
});
