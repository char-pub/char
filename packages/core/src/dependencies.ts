import type { CanonicalCreation } from "./canonical.js";
import { compareStrings } from "./errors.js";
import { resolveUseRef } from "./resolve/graph.js";
import type { CreationInput, ReleasePin } from "./schema/creation.js";
import type { ExactRef } from "./schema/identity.js";

export interface CreationDependency {
  domain: "content" | "policy" | "assembly" | "test";
  id: string;
  ref: string;
  pin?: ReleasePin;
  accepts: "content" | "preset" | "prompt-module";
}

/** Direct dependencies only. No IO, no latest resolution; all domains share publication authorization. */
export function getCreationDependencies(
  creation: CreationInput | CanonicalCreation,
): CreationDependency[] {
  const out: CreationDependency[] = [...(creation.references ?? [])]
    .sort((a, b) => compareStrings(a.id, b.id))
    .map((edge) => ({
      domain: "content",
      id: edge.id,
      ref: resolveUseRef(edge.use, creation.ref),
      ...(edge.pin ? { pin: edge.pin } : {}),
      accepts: "content",
    }));
  for (const item of creation.policy?.imports ?? creation.prompt_module?.imports ?? []) {
    out.push({
      domain: "policy",
      id: item.id,
      ref: item.use,
      pin: item.pin,
      accepts: "prompt-module",
    });
  }
  const add = (
    domain: "assembly" | "test",
    id: string,
    value: ExactRef,
    accepts: "content" | "preset",
  ) =>
    out.push({
      domain,
      id,
      ref: value.ref,
      pin: { release: value.release, semantic_digest: value.semantic_digest },
      accepts,
    });
  if (creation.assembly) add("assembly", "assembly", creation.assembly.preset, "preset");
  for (const test of creation.assembly_tests ?? []) {
    if (test.root !== "self") add("test", test.id, test.root, "content");
    if (test.preset && test.preset !== "self") add("test", test.id, test.preset, "preset");
  }
  return out;
}
