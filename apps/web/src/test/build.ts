import { type BuildCreationInput, buildCreation } from "@char-pub/core";
import { sampleDefaultPolicy } from "../fixtures/samples";

/** Tests choose the same explicit synthetic policy as the offline playground. */
export function buildTestCreation(input: BuildCreationInput) {
  return buildCreation(
    input.default_policy
      ? input
      : {
          ...input,
          dependencies: [...(input.dependencies ?? []), sampleDefaultPolicy],
          default_policy: {
            ref: "@examples/preview-policy",
            release: sampleDefaultPolicy.release,
            semantic_digest: sampleDefaultPolicy.semantic_digest,
          },
        },
  );
}
