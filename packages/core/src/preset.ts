import type { z } from "zod";
import { type CanonicalCreation, canonicalizeCreation, digestOf } from "./canonical.js";
import { checkCreation } from "./check.js";
import { CharError, compareStrings } from "./errors.js";
import { MAX_GRAPH_DEPTH, MAX_GRAPH_INSTANCES, type ReleaseInput } from "./resolve/graph.js";
import { DigestSchema } from "./schema/creation.js";
import {
  type BuildIdentity,
  buildIdentity,
  buildIdentityKey,
  publishedIdentity,
  withBuildIdentity,
} from "./schema/identity.js";
import {
  type PublishedResolvedPresetSchema,
  type ResolvedModuleBlockSchema,
  type ResolvedPolicyBlockSchema,
  type ResolvedPreset,
  ResolvedPresetSchema,
  type ResolvedPromptModule,
  ResolvedPromptModuleSchema,
} from "./schema/preset.js";
import type { LockEntry } from "./schema/release.js";
import { RESOLVER } from "./version.js";

export type ResolvePresetInput = BuildIdentity & {
  creation: unknown;
  semantic_digest: string;
  dependencies?: readonly ReleaseInput[];
};
const IdentitySchema = withBuildIdentity({ semantic_digest: DigestSchema });
type Block = z.infer<typeof ResolvedModuleBlockSchema>;

function load(input: ResolvePresetInput) {
  const valid = IdentitySchema.safeParse({
    ...buildIdentity(input),
    semantic_digest: input.semantic_digest,
  });
  if (!valid.success)
    throw new CharError({ code: "schema.invalid", subject: "preset", detail: valid.error.message });
  const canonical = canonicalizeCreation(input.creation);
  if (canonical.semantic_digest !== input.semantic_digest)
    throw new CharError({
      code: "resolve.semantic_digest_mismatch",
      subject: buildIdentityKey(input),
    });
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
    publishedIdentity(dep);
    const previous = inputs.get(dep.release);
    if (previous && digestOf(previous) !== digestOf(dep))
      throw new CharError({ code: "resolve.duplicate_release", subject: dep.release });
    inputs.set(dep.release, dep);
  }
  const versions = new Map<string, { key: string; identity: BuildIdentity; via: string[] }>([
    [root.ref, { key: buildIdentityKey(input), identity: buildIdentity(input), via: [] }],
  ]);
  const visited = new Set<string>();
  const heights = new Map<string, number>();
  const lock: LockEntry[] = [];
  const blocks: Block[] = [];
  const definitions = new Map<
    string,
    { blocks: Map<string, Block>; imports: Map<string, string> }
  >();
  let visits = 0;
  const visit = (
    creation: CanonicalCreation,
    source: BuildIdentity,
    digest: string,
    via: string[],
    ancestors: readonly string[],
  ): void => {
    const release = buildIdentityKey(source);
    if (ancestors.includes(release))
      throw new CharError({ code: "resolve.cycle", subject: creation.ref, data: { via } });
    const previous = versions.get(creation.ref);
    if (previous && previous.key !== release)
      throw new CharError({
        code: "resolve.diamond_conflict",
        subject: creation.ref,
        data: {
          ref: creation.ref,
          releases: [
            { ...buildIdentity(previous.identity), via: previous.via },
            { ...buildIdentity(source), via },
          ],
        },
      });
    versions.set(creation.ref, {
      key: release,
      identity: buildIdentity(source),
      via: previous?.via ?? via,
    });
    if (++visits > MAX_GRAPH_INSTANCES)
      throw new CharError({ code: "resolve.graph_too_large", subject: root.ref });
    if (via.length + (heights.get(release) ?? 0) > MAX_GRAPH_DEPTH)
      throw new CharError({ code: "resolve.graph_too_deep", subject: creation.ref });
    if (visited.has(release)) return;
    visited.add(release);
    const local = { blocks: new Map<string, Block>(), imports: new Map<string, string>() };
    definitions.set(release, local);
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
      visit(child, { release: dep.release }, edge.pin.semantic_digest, childVia, [
        ...ancestors,
        release,
      ]);
      local.imports.set(edge.id, dep.release);
      height = Math.max(height, 1 + (heights.get(dep.release) ?? 0));
    }
    heights.set(release, height);
    for (const block of body.blocks) {
      const resolved = {
        ...block,
        id: creation.type === "prompt-module" ? `${creation.ref}#${block.id}` : block.id,
        origin: {
          ref: creation.ref,
          ...buildIdentity(source),
          semantic_digest: digest,
          block: block.id,
          via,
        },
      };
      blocks.push(resolved);
      local.blocks.set(block.id, resolved);
    }
  };
  visit(root, buildIdentity(input), input.semantic_digest, [], []);
  lock.sort((a, b) => compareStrings(a.ref, b.ref));
  const blockAt = (path: string): Block | undefined => {
    const segments = path.split("/");
    const id = segments.pop();
    let definition = definitions.get(buildIdentityKey(input));
    for (const segment of segments) {
      const release = definition?.imports.get(segment);
      definition = release ? definitions.get(release) : undefined;
      if (!definition) return undefined;
    }
    return id ? definition?.blocks.get(id) : undefined;
  };
  return { root, blocks, blockAt, lock, lock_digest: digestOf(lock) };
}

export function resolvePreset(
  input: ResolvePresetInput & { release: string },
): z.infer<typeof PublishedResolvedPresetSchema>;
export function resolvePreset(input: ResolvePresetInput): ResolvedPreset;
export function resolvePreset(input: ResolvePresetInput): ResolvedPreset {
  const graph = policyGraph(input, "preset");
  const {
    imports: _imports,
    placements,
    ...policy
  } = graph.root.policy as NonNullable<CanonicalCreation["policy"]>;
  const explicit = new Set<string>();
  const identities = new Set<string>();
  const blocks: z.infer<typeof ResolvedPolicyBlockSchema>[] = (placements ?? []).map(
    (placement) => {
      const block = graph.blockAt(placement.block);
      if (!block)
        throw new CharError({ code: "resolve.placement_missing", subject: placement.block });
      const id = `${block.id}~${placement.at}~${placement.as ?? placement.at}`;
      if (identities.has(id))
        throw new CharError({ code: "resolve.duplicate_placement", subject: id });
      identities.add(id);
      explicit.add(block.id);
      const { default_at: _default, ...definition } = block;
      return { ...definition, id, position: placement.at, placement };
    },
  );
  for (const block of graph.blocks) {
    if (explicit.has(block.id)) continue;
    const { default_at, ...definition } = block;
    blocks.push({ ...definition, position: default_at });
  }
  return ResolvedPresetSchema.parse({
    ref: graph.root.ref,
    ...buildIdentity(input),
    semantic_digest: input.semantic_digest,
    resolver: RESOLVER,
    policy: { ...policy, blocks },
    lock: graph.lock,
    lock_digest: graph.lock_digest,
  });
}

export function resolvePromptModule(input: ResolvePresetInput): ResolvedPromptModule {
  const graph = policyGraph(input, "prompt-module");
  return ResolvedPromptModuleSchema.parse({
    ref: graph.root.ref,
    ...buildIdentity(input),
    semantic_digest: input.semantic_digest,
    resolver: RESOLVER,
    version: "1-draft",
    blocks: graph.blocks,
    lock: graph.lock,
    lock_digest: graph.lock_digest,
  });
}
