/** Deterministic local input receipts; these carry no Registry authority or lifecycle. */
import { canonicalizeCreation, digestJson } from "./canonical.js";
import { CharError, compareStrings } from "./errors.js";
import type { ReleaseInput } from "./resolve/graph.js";
import { type ExactRef, type LocalBuildOrigin, publishedIdentity } from "./schema/identity.js";
import { RESOLVER } from "./version.js";

export interface LocalBuildInput {
  root: { creation: unknown; semantic_digest?: string };
  dependencies?: readonly ReleaseInput[];
  default_policy?: ExactRef;
  publicAssetBaseUrl?: string;
}

function canonicalInput(input: LocalBuildInput["root"]) {
  const canonical = canonicalizeCreation(input.creation);
  if (input.semantic_digest !== undefined && input.semantic_digest !== canonical.semantic_digest)
    throw new CharError({
      code: "resolve.semantic_digest_mismatch",
      subject: canonical.creation.ref,
    });
  return canonical;
}

function normalizedInputs(input: LocalBuildInput) {
  const root = canonicalInput(input.root);
  const snapshots = new Map<
    string,
    {
      release: string;
      creation: ReturnType<typeof canonicalInput>["json"];
      semantic_digest: string;
      visibility: "public" | "private";
      status: "active" | "yanked" | "tombstoned";
      status_reason: string | null;
    }
  >();
  for (const dependency of input.dependencies ?? []) {
    const canonical = canonicalInput(dependency);
    const snapshot = {
      ...publishedIdentity(dependency),
      creation: canonical.json,
      semantic_digest: canonical.semantic_digest,
      visibility: dependency.visibility,
      status: dependency.status ?? "active",
      status_reason: dependency.status_reason ?? null,
    };
    const prior = snapshots.get(snapshot.release);
    if (prior && digestJson(prior) !== digestJson(snapshot))
      throw new CharError({ code: "resolve.duplicate_release", subject: snapshot.release });
    snapshots.set(snapshot.release, snapshot);
  }
  return {
    root,
    dependencies: [...snapshots.values()].sort((a, b) => compareStrings(a.release, b.release)),
  };
}
function originFor(
  input: LocalBuildInput,
  normalized: ReturnType<typeof normalizedInputs>,
): LocalBuildOrigin {
  return {
    kind: "local-build",
    input_digest: digestJson({
      domain: "char.pub/local-input/v1",
      resolver: RESOLVER,
      root: normalized.root.json,
      dependencies: normalized.dependencies,
      default_policy: input.default_policy ?? null,
      public_asset_base_url: input.publicAssetBaseUrl ?? null,
    }),
  };
}

/** Includes all supplied snapshots, even unused ones. File paths, time and machine IDs are absent. */
export function localBuildOrigin(input: LocalBuildInput): LocalBuildOrigin {
  return originFor(input, normalizedInputs(input));
}

/** Compile exactly the same normalized, de-duplicated snapshots that the receipt identifies. */
export function createLocalBuildInput(input: LocalBuildInput) {
  const normalized = normalizedInputs(input);
  return {
    root: {
      creation: normalized.root.creation,
      semantic_digest: normalized.root.semantic_digest,
      visibility: "private" as const,
      origin: originFor(input, normalized),
    },
    dependencies: normalized.dependencies.map(({ status_reason, ...snapshot }) => ({
      ...snapshot,
      ...(status_reason !== null ? { status_reason } : {}),
    })),
    ...(input.default_policy ? { default_policy: input.default_policy } : {}),
    ...(input.publicAssetBaseUrl !== undefined
      ? { publicAssetBaseUrl: input.publicAssetBaseUrl }
      : {}),
  };
}
