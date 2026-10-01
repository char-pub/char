/** Compile a local proposal without writing its target draft or inventing a Release. */
import {
  buildCreation,
  type CreationArtifact,
  canonicalizeCreation,
  createLocalBuildInput,
  type ExactRef,
  getCreationDependencies,
  type ReleaseInput,
  sha256Bytes,
} from "@char-pub/core";
import type { RegistryClient } from "./api";
import { parseRef } from "./text";
export async function buildProposalPreview(
  client: RegistryClient,
  working: unknown,
  check: () => void,
) {
  check();
  const root = canonicalizeCreation(working);
  const defaultPolicy =
    root.creation.assembly || ["preset", "prompt-module"].includes(root.creation.type)
      ? undefined
      : await client.defaultPolicy();
  check();
  const queue: ExactRef[] = [];
  const enqueue = (creation: typeof root.creation) => {
    for (const dep of getCreationDependencies(creation)) {
      if (!dep.pin || !("release" in dep.pin))
        throw new Error(`Lock ${dep.ref} to a published version before previewing.`);
      queue.push({
        ref: dep.ref,
        release: dep.pin.release,
        semantic_digest: dep.pin.semantic_digest,
      });
    }
  };
  enqueue(root.creation);
  if (defaultPolicy) queue.push(defaultPolicy);
  const dependencies: ReleaseInput[] = [];
  const seen = new Map<string, ExactRef>();
  for (let index = 0; index < queue.length; index++) {
    check();
    const exact = queue[index];
    if (!exact) continue;
    const prior = seen.get(exact.release);
    if (prior) {
      if (prior.ref !== exact.ref || prior.semantic_digest !== exact.semantic_digest)
        throw new Error("Conflicting dependency identity.");
      continue;
    }
    if (seen.size >= 5000) throw new Error("The proposal has too many dependencies.");
    seen.set(exact.release, exact);
    const parsed = parseRef(exact.ref);
    if (!parsed) throw new Error(`Invalid dependency reference ${exact.ref}.`);
    const { ns, name } = parsed;
    const detail = await client.creation(ns, name);
    check();
    const release = detail.releases.find((r) => r.id === exact.release);
    if (
      !release ||
      release.semantic_digest !== exact.semantic_digest ||
      release.status === "tombstoned"
    )
      throw new Error(`The locked version of ${exact.ref} is unavailable.`);
    const source = await client.releaseSource(ns, name, release.label);
    check();
    const canonical = canonicalizeCreation(source.creation);
    if (
      canonical.creation.ref !== exact.ref ||
      canonical.semantic_digest !== exact.semantic_digest ||
      source.semantic_digest !== exact.semantic_digest
    )
      throw new Error(`The source of ${exact.ref} does not match its locked digest.`);
    dependencies.push({
      creation: canonical.json,
      release: exact.release,
      semantic_digest: exact.semantic_digest,
      visibility: release.visibility,
      status: release.status,
    });
    enqueue(canonical.creation);
  }
  check();
  return buildCreation(
    createLocalBuildInput({
      root: { creation: root.json },
      dependencies,
      ...(defaultPolicy ? { default_policy: defaultPolicy } : {}),
    }),
  ).artifact;
}

/** Bytes remain local and must match an authored text asset before the Engine receives them. */
export function proposalSourceTexts(
  artifact: CreationArtifact,
  bytes: Uint8Array,
): Record<string, string> {
  const digest = sha256Bytes(bytes);
  const assets = artifact.assets.filter(
    (a) =>
      a.role === "context" &&
      ["text/plain", "text/markdown"].includes(a.media_type) &&
      a.digest === digest,
  );
  if (!assets.length)
    throw new Error("This file does not match a reference document in the proposal.");
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  return Object.fromEntries(assets.map((a) => [a.id, text]));
}
