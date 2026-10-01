/** Handwritten IR fixtures packaged as explicit synthetic content artifacts.
 * Every test goes through the public preparation path; this helper performs no admission/filtering.
 */
import {
  type ContextIR,
  type CreationArtifact,
  deriveCapabilities,
  type ResolvedPreset,
  type RuntimeProfile,
  resolvePreset,
} from "@char-pub/core";
import { TEST_DEFAULT_PIN, TEST_DEFAULT_POLICY } from "../../../core/test/build.js";
import { assemble as prepare } from "../../src/index.js";
import type { SessionInput } from "../../src/session.js";
import type { TokenCounter } from "../../src/tokens.js";

const defaultPolicy = resolvePreset({
  ...TEST_DEFAULT_POLICY,
  semantic_digest: TEST_DEFAULT_PIN.semantic_digest,
});
export function artifactFor(ir: ContextIR): CreationArtifact {
  const artifact: CreationArtifact = {
    kind: "content",
    capabilities: [],
    version: "1-draft",
    root: ir.root,
    lock: [],
    lock_digest: ir.lock_digest,
    meta: ir.meta,
    assets: ir.assets,
    ir,
    default_policy: defaultPolicy,
    catalog_index: {
      works: [
        {
          id: `${ir.root.ref}~root`,
          ref: ir.root.ref,
          instance: "root",
          title: "Synthetic test content",
          fragments: ir.fragments.map((f) => f.id),
          groups: [],
          sources: [],
        },
      ],
      groups: [],
      sources: [],
    },
  };
  artifact.capabilities = deriveCapabilities(artifact);
  return artifact;
}
export function assemble(input: {
  ir: ContextIR;
  profile: RuntimeProfile;
  session: SessionInput;
  preset?: ResolvedPreset;
  counter?: TokenCounter;
}) {
  return prepare({
    artifact: artifactFor(input.ir),
    // Exact-count fixtures declare their custom tokenizer alongside the supplied counter.
    profile: { ...input.profile, tokenizer: input.counter?.tokenizer ?? input.profile.tokenizer },
    turn: input.session,
    ...(input.preset ? { preset: input.preset } : {}),
    ...(input.counter ? { counter: input.counter } : {}),
    diagnostics: "author",
  });
}
