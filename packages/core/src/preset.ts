import { z } from "zod";
import { type CanonicalCreation, canonicalizeCreation, digestOf } from "./canonical.js";
import { checkCreation } from "./check.js";
import { CharError, compareStrings } from "./errors.js";
import { MAX_GRAPH_DEPTH, MAX_GRAPH_INSTANCES, type ReleaseInput } from "./resolve/graph.js";
import { DigestSchema, ReleaseIdSchema } from "./schema/creation.js";
import {
  type ResolvedPolicyBlockSchema,
  type ResolvedPreset,
  ResolvedPresetSchema,
  type ResolvedPromptModule,
  ResolvedPromptModuleSchema,
} from "./schema/preset.js";
import type { LockEntry } from "./schema/release.js";
import { RESOLVER } from "./version.js";

export interface ResolvePresetInput {
  creation: unknown;
  release: string;
  semantic_digest: string;
  dependencies?: readonly ReleaseInput[];
}
const IdentitySchema = z.strictObject({ release: ReleaseIdSchema, semantic_digest: DigestSchema });
type Block = z.infer<typeof ResolvedPolicyBlockSchema>;

function load(input: Pick<ResolvePresetInput, "creation" | "release" | "semantic_digest">) {
  const valid = IdentitySchema.safeParse({
    release: input.release,
    semantic_digest: input.semantic_digest,
  });
  if (!valid.success)
    throw new CharError({ code: "schema.invalid", subject: "preset", detail: valid.error.message });
  const canonical = canonicalizeCreation(input.creation);
  if (canonical.semantic_digest !== input.semantic_digest)
    throw new CharError({ code: "resolve.semantic_digest_mismatch", subject: input.release });
  const checked = checkCreation(canonical.creation);
  if (!checked.ok)
    throw new CharError({
      code: "resolve.invalid_preset",
      subject: canonical.creation.ref,
      data: { diagnostics: checked.diagnostics },
    });
  return canonical.creation;
}

/** Flatten one policy graph. Imports preserve declaration order, nodes are emitted once, dependency-first. */
function policyGraph(input: ResolvePresetInput, type: "preset" | "prompt-module") {
  // Keep wrong-type errors independent of caller's digest, as in the initial resolver API.
  const rootCanonical = canonicalizeCreation(input.creation);
  if (rootCanonical.creation.type !== type)
    throw new CharError({
      code: type === "preset" ? "resolve.not_preset" : "resolve.not_prompt_module",
      subject: rootCanonical.creation.ref,
    });
  const root = load(input);
  const inputs = new Map<string, ReleaseInput>();
  for (const dep of input.dependencies ?? []) {
    const previous = inputs.get(dep.release);
    if (previous && digestOf(previous) !== digestOf(dep))
      throw new CharError({ code: "resolve.duplicate_release", subject: dep.release });
    inputs.set(dep.release, dep);
  }
  const versions = new Map<string, { release: string; via: string[] }>([
    [root.ref, { release: input.release, via: [] }],
  ]);
  const visited = new Set<string>();
  const heights = new Map<string, number>();
  const lock: LockEntry[] = [];
  const blocks: Block[] = [];
  let visits = 0;
  const visit = (
    creation: CanonicalCreation,
    release: string,
    digest: string,
    via: string[],
    ancestors: readonly string[],
  ) => {
    if (ancestors.includes(release))
      throw new CharError({ code: "resolve.cycle", subject: creation.ref, data: { via } });
    const previous = versions.get(creation.ref);
    if (previous && previous.release !== release)
      throw new CharError({
        code: "resolve.diamond_conflict",
        subject: creation.ref,
        data: { ref: creation.ref, releases: [previous, { release, via }] },
      });
    versions.set(creation.ref, { release, via: previous?.via ?? via });
    if (++visits > MAX_GRAPH_INSTANCES)
      throw new CharError({ code: "resolve.graph_too_large", subject: root.ref });
    if (via.length + (heights.get(release) ?? 0) > MAX_GRAPH_DEPTH)
      throw new CharError({ code: "resolve.graph_too_deep", subject: creation.ref });
    if (visited.has(release)) return;
    visited.add(release);
    let height = 0;
    const body = creation.policy ?? creation.prompt_module;
    if (!body) throw new CharError({ code: "resolve.not_prompt_module", subject: creation.ref });
    for (const edge of body.imports ?? []) {
      const childVia = [...via, edge.id];
      if ([...ancestors, release].includes(edge.pin.release))
        throw new CharError({ code: "resolve.cycle", subject: edge.use, data: { via: childVia } });
      const dep = inputs.get(edge.pin.release);
      if (!dep)
        throw new CharError({
          code: "resolve.release_missing",
          subject: edge.pin.release,
          data: { via: childVia },
        });
      if (dep.status === "tombstoned")
        throw new CharError({ code: "resolve.tombstoned", subject: edge.use });
      const child = load({
        creation: dep.creation,
        release: dep.release,
        semantic_digest: edge.pin.semantic_digest,
      });
      if (dep.semantic_digest !== undefined && dep.semantic_digest !== edge.pin.semantic_digest)
        throw new CharError({ code: "resolve.pin_digest_mismatch", subject: edge.id });
      if (child.ref !== edge.use)
        throw new CharError({ code: "resolve.pin_ref_mismatch", subject: edge.id });
      if (child.type !== "prompt-module")
        throw new CharError({ code: "resolve.not_prompt_module", subject: child.ref });
      if (!visited.has(dep.release))
        lock.push({
          ref: child.ref,
          release: dep.release,
          semantic_digest: edge.pin.semantic_digest,
          via: childVia,
        });
      visit(child, dep.release, edge.pin.semantic_digest, childVia, [...ancestors, release]);
      height = Math.max(height, 1 + (heights.get(dep.release) ?? 0));
    }
    heights.set(release, height);
    for (const block of body.blocks)
      blocks.push({
        ...block,
        id: creation.type === "prompt-module" ? `${creation.ref}#${block.id}` : block.id,
        origin: { ref: creation.ref, release, semantic_digest: digest, block: block.id, via },
      });
  };
  visit(root, input.release, input.semantic_digest, [], []);
  lock.sort((a, b) => compareStrings(a.ref, b.ref));
  return { root, blocks, lock, lock_digest: digestOf(lock) };
}

export function resolvePreset(input: ResolvePresetInput): ResolvedPreset {
  const graph = policyGraph(input, "preset");
  const { imports: _imports, ...policy } = graph.root.policy as NonNullable<
    CanonicalCreation["policy"]
  >;
  return ResolvedPresetSchema.parse({
    ref: graph.root.ref,
    release: input.release,
    semantic_digest: input.semantic_digest,
    resolver: RESOLVER,
    policy: { ...policy, blocks: graph.blocks },
    lock: graph.lock,
    lock_digest: graph.lock_digest,
  });
}

export function resolvePromptModule(input: ResolvePresetInput): ResolvedPromptModule {
  const graph = policyGraph(input, "prompt-module");
  return ResolvedPromptModuleSchema.parse({
    ref: graph.root.ref,
    release: input.release,
    semantic_digest: input.semantic_digest,
    resolver: RESOLVER,
    version: "0-draft",
    blocks: graph.blocks,
    lock: graph.lock,
    lock_digest: graph.lock_digest,
  });
}
