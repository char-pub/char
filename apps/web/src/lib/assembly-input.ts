import {
  canonicalizeCreation,
  getCreationDependencies,
  type ReleaseInput,
  type ResolveInput,
} from "@char-pub/core";
import type { RegistryClient } from "./api";
import { parseRef } from "./text";

export const LOCAL_RELEASE = "rel_00000000000000000000000000";
interface Exact {
  ref: string;
  release: string;
  semantic_digest: string;
}
function declaredDependencies(creation: unknown): Exact[] {
  return getCreationDependencies(canonicalizeCreation(creation).creation).map((dependency) => {
    if (!dependency.pin || !("release" in dependency.pin))
      throw new Error("Lock every dependency to an exact version before running tests.");
    return {
      ref: dependency.ref,
      release: dependency.pin.release,
      semantic_digest: dependency.pin.semantic_digest,
    };
  });
}
export async function loadAssemblyInput(
  client: RegistryClient,
  working: unknown,
): Promise<ResolveInput> {
  const canonical = canonicalizeCreation(working);
  const dependencies: ReleaseInput[] = [];
  const queue = declaredDependencies(canonical.creation);
  const seen = new Set<string>();
  while (queue.length) {
    const exact = queue.shift();
    if (!exact) break;
    const key = `${exact.ref}:${exact.release}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > 256) throw new Error("Too many dependencies to preview in the browser.");
    const ref = parseRef(exact.ref);
    if (!ref) throw new Error(`Invalid reference ${exact.ref}`);
    const detail = await client.creation(ref.ns, ref.name);
    const release = detail.releases.find((r) => r.id === exact.release);
    if (!release || release.status === "tombstoned")
      throw new Error(`Release unavailable: ${exact.ref}`);
    const source = await client.releaseSource(ref.ns, ref.name, release.label);
    dependencies.push({
      release: release.id,
      visibility: release.visibility,
      creation: source.creation,
      semantic_digest: exact.semantic_digest,
      ...(release.status === "yanked" ? { status: "yanked" as const } : {}),
    });
    queue.push(...declaredDependencies(source.creation));
  }
  return {
    root: {
      creation: canonical.creation,
      release: LOCAL_RELEASE,
      visibility: "private",
      semantic_digest: canonical.semantic_digest,
    },
    dependencies,
  };
}
