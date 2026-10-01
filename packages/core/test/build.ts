/** Explicit synthetic policy for source/artifact tests. Never imported by production code. */
import { type BuildCreationInput, buildCreation } from "../src/build.js";
import { canonicalizeCreation } from "../src/canonical.js";
import type { ReleaseInput } from "../src/resolve/index.js";
import type { ExactRef } from "../src/schema/identity.js";
import { PRESET_REGIONS } from "../src/schema/policy.js";
import { tid } from "./fixtures.js";

export const TEST_DEFAULT_POLICY = {
  release: tid("rel", 999),
  visibility: "public" as const,
  creation: {
    id: tid("cr", 999),
    ref: "@fixtures/default-policy",
    type: "preset",
    display_name: "Test default policy",
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    policy: {
      version: "1-draft",
      blocks: [],
      layout: [...PRESET_REGIONS],
      requires: { system_role: true },
    },
  },
};
export const TEST_DEFAULT_PIN = {
  ref: TEST_DEFAULT_POLICY.creation.ref,
  release: TEST_DEFAULT_POLICY.release,
  semantic_digest: canonicalizeCreation(TEST_DEFAULT_POLICY.creation).semantic_digest,
};
export function withTestDefault<T extends object>(
  input: T & {
    dependencies?: readonly ReleaseInput[] | undefined;
    default_policy?: ExactRef | undefined;
  },
) {
  return {
    ...input,
    default_policy: input.default_policy ?? TEST_DEFAULT_PIN,
    dependencies: [
      ...(input.dependencies ?? []),
      ...(input.default_policy ? [] : [TEST_DEFAULT_POLICY]),
    ],
  };
}
export function buildTestCreation(input: BuildCreationInput) {
  return buildCreation(withTestDefault(input));
}
