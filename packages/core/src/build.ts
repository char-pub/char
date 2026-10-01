import {
  type CanonicalCreation,
  canonicalizeCreation,
  type Digest,
  digestJson,
  digestOf,
  jcs,
  normalizeValue,
} from "./canonical.js";
import { deriveCapabilities } from "./capabilities.js";
import { buildCatalogIndex, resolveCatalogReference } from "./catalog-index.js";
import { checkCreation } from "./check.js";
import { getCreationDependencies } from "./dependencies.js";
import { CharError, compareStrings } from "./errors.js";
import { instanceKey, irAssetId } from "./keys.js";
import { createLocalBuildInput } from "./local-build.js";
import { resolvePreset, resolvePromptModule } from "./preset.js";
import { pickLocalized } from "./resolve/env.js";
import {
  type GraphWarning,
  MAX_GRAPH_DEPTH,
  MAX_GRAPH_INSTANCES,
  type RootInput,
} from "./resolve/graph.js";
import { type ResolveInput, type ResolveOutput, resolve } from "./resolve/index.js";
import { type CreationArtifact, CreationArtifactSchema } from "./schema/artifact.js";
import { type JSONValue, RATINGS } from "./schema/creation.js";
import {
  buildIdentity,
  buildIdentityKey,
  type ExactRef,
  ExactRefSchema,
  publishedIdentity,
} from "./schema/identity.js";
import type { EffectiveMeta, IRAsset } from "./schema/ir.js";
import type { LockEntry } from "./schema/release.js";
import { resolveStoryReferences } from "./story/resolve.js";

export interface BuildCreationOutput {
  artifact: CreationArtifact;
  json: string;
  digest: Digest;
  lock: LockEntry[];
  warnings: GraphWarning[];
  resolved?: ResolveOutput;
}
export interface BuildCreationInput extends ResolveInput {
  /** Required for content without assembly. Core never discovers or fetches a default. */
  default_policy?: ExactRef;
}
interface Node {
  input: RootInput;
  key: string;
  creation: CanonicalCreation;
  semantic_digest: Digest;
  via: string[];
}

function inputComparisonDigest(input: RootInput): Digest {
  const { creation, ...envelope } = input;
  return digestJson({
    envelope: normalizeValue(envelope),
    creation: canonicalizeCreation(creation).json,
  });
}

/** One aggregate authorization graph, separate from Creative instances and policy injection. */
export function buildCreation(input: BuildCreationInput): BuildCreationOutput {
  const rootIdentity = buildIdentity(input.root);
  if ("origin" in rootIdentity && rootIdentity.origin.kind === "local-build") {
    const local = createLocalBuildInput(input);
    if (rootIdentity.origin.input_digest !== local.root.origin.input_digest)
      throw new CharError({
        code: "build.local_input_mismatch",
        subject: buildIdentityKey(input.root),
      });
    input = {
      ...input,
      root: { ...input.root, creation: local.root.creation },
      dependencies: local.dependencies,
    };
  }
  const inputs = new Map<string, RootInput>();
  for (const dependency of input.dependencies ?? []) publishedIdentity(dependency);
  for (const item of [input.root, ...(input.dependencies ?? [])]) {
    const key = buildIdentityKey(buildIdentity(item));
    const prior = inputs.get(key);
    if (prior && inputComparisonDigest(prior) !== inputComparisonDigest(item))
      throw new CharError({ code: "resolve.duplicate_release", subject: key });
    inputs.set(key, item);
  }
  const nodes = new Map<string, Node>();
  const warnings: GraphWarning[] = [];
  const heights = new Map<string, number>();
  let visits = 0;
  const visit = (rel: RootInput, via: string[], ancestors: readonly string[]): Node => {
    const identity = buildIdentity(rel);
    const key = buildIdentityKey(identity);
    if (
      "origin" in identity &&
      (rel.visibility !== "private" || (rel.status && rel.status !== "active"))
    )
      throw new CharError({
        code:
          identity.origin.kind === "draft-build"
            ? "build.invalid_draft_state"
            : "build.invalid_local_state",
        subject: key,
      });
    if (ancestors.includes(key))
      throw new CharError({ code: "resolve.cycle", subject: key, data: { via } });
    if (++visits > MAX_GRAPH_INSTANCES)
      throw new CharError({ code: "resolve.graph_too_large", subject: key });
    if (ancestors.length + (heights.get(key) ?? 0) > MAX_GRAPH_DEPTH)
      throw new CharError({ code: "resolve.graph_too_deep", subject: key });
    const cached = nodes.get(key);
    if (cached) return cached;
    const canonical = canonicalizeCreation(rel.creation);
    const node: Node = {
      input: rel,
      key,
      creation: canonical.creation,
      semantic_digest: canonical.semantic_digest,
      via,
    };
    const checked = checkCreation(node.creation);
    if (!checked.ok) {
      const issue = checked.diagnostics.find((d) => d.severity === "error");
      throw new CharError({
        code: issue?.code ?? "check.invalid",
        subject: `${node.creation.ref}:${issue?.subject ?? "creation"}`,
        data: { diagnostics: checked.diagnostics },
      });
    }
    if (rel.semantic_digest !== undefined && rel.semantic_digest !== node.semantic_digest)
      throw new CharError({ code: "resolve.semantic_digest_mismatch", subject: key });
    if (rel.status === "tombstoned")
      throw new CharError({
        code: "resolve.tombstoned",
        subject: node.creation.ref,
        detail: rel.status_reason ?? "release was removed",
        data: { via, reason: rel.status_reason ?? null },
      });
    if (rel.status === "yanked")
      warnings.push({
        code: "resolve.yanked",
        subject: node.creation.ref,
        data: { via, release: key, reason: rel.status_reason ?? null },
      });
    nodes.set(key, node);
    let height = 0;
    for (const dep of getCreationDependencies(node.creation)) {
      const path =
        dep.domain === "derivation"
          ? [...via, "derivation", dep.id]
          : dep.domain === "content"
            ? [...via, dep.id]
            : dep.domain === "test"
              ? [...via, "test", dep.id, dep.accepts === "content" ? "root" : "preset"]
              : dep.domain === "assembly"
                ? [...via, "assembly"]
                : [...via, "policy", dep.id];
      if (!dep.pin || !("release" in dep.pin))
        throw new CharError({
          code: "resolve.unpinned",
          subject: `${node.creation.ref}/${dep.id}`,
          data: { via: path },
        });
      const target = inputs.get(dep.pin.release);
      if (!target)
        throw new CharError({
          code: "resolve.release_missing",
          subject: dep.pin.release,
          data: { via: path },
        });
      const child = visit(target, path, [...ancestors, key]);
      height = Math.max(height, 1 + (heights.get(buildIdentityKey(target)) ?? 0));
      if (child.creation.ref !== dep.ref)
        throw new CharError({ code: "resolve.pin_ref_mismatch", subject: dep.id });
      if (child.semantic_digest !== dep.pin.semantic_digest)
        throw new CharError({ code: "resolve.pin_digest_mismatch", subject: dep.id });
      const actual =
        child.creation.type === "preset"
          ? "preset"
          : child.creation.type === "prompt-module"
            ? "prompt-module"
            : "content";
      if (dep.accepts !== "any" && actual !== dep.accepts)
        throw new CharError({
          code: "resolve.dependency_type_mismatch",
          subject: dep.id,
          detail: `expected ${dep.accepts}, got ${child.creation.type}`,
        });
    }
    heights.set(key, height);
    return node;
  };
  const root = visit(input.root, [], []);
  if (
    root.creation.type !== "preset" &&
    root.creation.type !== "prompt-module" &&
    !root.creation.assembly &&
    !input.default_policy
  )
    throw new CharError({
      code: "resolve.default_policy_required",
      subject: root.creation.ref,
      detail: "Provide an exact default policy and its release snapshot to build content.",
    });
  let defaultPolicy: Node | undefined;
  if (
    root.creation.type !== "preset" &&
    root.creation.type !== "prompt-module" &&
    !root.creation.assembly &&
    input.default_policy
  ) {
    const pin = ExactRefSchema.safeParse(input.default_policy);
    if (!pin.success)
      throw new CharError({
        code: "schema.invalid",
        subject: "default_policy",
        detail: pin.error.message,
      });
    const dependency = inputs.get(pin.data.release);
    if (!dependency)
      throw new CharError({ code: "resolve.release_missing", subject: pin.data.release });
    defaultPolicy = visit(dependency, ["default_policy"], [buildIdentityKey(input.root)]);
    if (defaultPolicy.creation.ref !== pin.data.ref)
      throw new CharError({ code: "resolve.pin_ref_mismatch", subject: "default_policy" });
    if (defaultPolicy.semantic_digest !== pin.data.semantic_digest)
      throw new CharError({ code: "resolve.pin_digest_mismatch", subject: "default_policy" });
    if (defaultPolicy.creation.type !== "preset")
      throw new CharError({ code: "resolve.not_preset", subject: "default_policy" });
    if (defaultPolicy.input.visibility !== "public")
      throw new CharError({
        code: "resolve.default_policy_not_public",
        subject: defaultPolicy.creation.ref,
      });
  }
  // Historical source closures have independent version namespaces. Shared release
  // nodes do not cache this validation: every active graph must still be checked.
  const scope = (roots: { node: Node; via: string[] }[]) => {
    const members = new Map<Node, string[]>();
    const byRef = new Map<string, { node: Node; via: string[] }>();
    const walk = (node: Node, via: string[]) => {
      const prior = byRef.get(node.creation.ref);
      if (prior && prior.node.key !== node.key)
        throw new CharError({
          code: "resolve.diamond_conflict",
          subject: node.creation.ref,
          data: {
            ref: node.creation.ref,
            releases: [
              { ...buildIdentity(prior.node.input), via: prior.via },
              { ...buildIdentity(node.input), via },
            ],
          },
        });
      if (members.has(node)) return;
      byRef.set(node.creation.ref, { node, via });
      members.set(node, via);
      for (const dependency of getCreationDependencies(node.creation)) {
        if (dependency.domain === "derivation" || !dependency.pin || !("release" in dependency.pin))
          continue;
        const child = nodes.get(dependency.pin.release);
        if (!child)
          throw new CharError({ code: "resolve.release_missing", subject: dependency.pin.release });
        const suffix =
          dependency.domain === "content"
            ? [dependency.id]
            : dependency.domain === "assembly"
              ? ["assembly"]
              : dependency.domain === "test"
                ? ["test", dependency.id, dependency.accepts === "content" ? "root" : "preset"]
                : ["policy", dependency.id];
        walk(child, [...via, ...suffix]);
      }
    };
    for (const start of roots) walk(start.node, start.via);
    return members;
  };
  const material = scope([
    { node: root, via: [] },
    ...(defaultPolicy ? [{ node: defaultPolicy, via: ["default_policy"] }] : []),
  ]);
  const historical = new Set<Node>();
  for (const node of nodes.values())
    for (const dependency of getCreationDependencies(node.creation)) {
      if (dependency.domain !== "derivation" || !dependency.pin || !("release" in dependency.pin))
        continue;
      const source = nodes.get(dependency.pin.release);
      if (source) historical.add(source);
    }
  for (const node of historical) scope([{ node, via: node.via }]);
  for (const [node, via] of material) node.via = via;
  const all = [...nodes.values()].sort(
    (a, b) => compareStrings(a.creation.ref, b.creation.ref) || compareStrings(a.key, b.key),
  );
  const lock: LockEntry[] = all
    .filter((node) => node !== root)
    .map((node) => ({
      ref: node.creation.ref,
      ...publishedIdentity(node.input),
      semantic_digest: node.semantic_digest,
      via: node.via,
    }));
  const common = {
    version: "1-draft" as const,
    root: {
      ref: root.creation.ref,
      ...buildIdentity(root.input),
      semantic_digest: root.semantic_digest,
    },
    lock,
    lock_digest: digestOf(lock),
  };
  let resolved: ResolveOutput | undefined;
  let branch: Record<string, unknown>;
  const policyInput = (node: Node) => ({
    creation: node.creation,
    ...buildIdentity(node.input),
    semantic_digest: node.semantic_digest,
    dependencies: input.dependencies ?? [],
  });
  if (root.creation.type === "preset")
    branch = { kind: "preset", preset: resolvePreset(policyInput(root)) };
  else if (root.creation.type === "prompt-module")
    branch = { kind: "prompt-module", module: resolvePromptModule(policyInput(root)) };
  else {
    resolved = resolve(input);
    const index = buildCatalogIndex(
      resolved.ir,
      new Map([...material.keys()].map((node) => [node.creation.ref, node.creation])),
    );
    branch = { kind: "content", ir: resolved.ir, catalog_index: index };
    for (const fragment of resolved.ir.fragments) {
      if (fragment.source)
        resolveCatalogReference(
          fragment.source.use,
          resolved.ir,
          index,
          fragment.origin.instance_key,
          "source",
        );
    }
    if (root.creation.story) {
      branch.story = root.creation.story;
      branch.story_refs = resolveStoryReferences(
        root.creation,
        resolved.ir,
        index,
        resolved.story_templates,
      );
    }
    if (root.creation.assembly) {
      const config = root.creation.assembly;
      const node = nodes.get(config.preset.release);
      if (!node)
        throw new CharError({ code: "resolve.release_missing", subject: config.preset.release });
      branch.assembly = { ...config, preset: resolvePreset(policyInput(node)) };
    } else if (defaultPolicy) {
      const preset = resolvePreset(policyInput(defaultPolicy));
      for (const dependency of preset.lock ?? [])
        if (inputs.get(dependency.release)?.visibility !== "public")
          throw new CharError({
            code: "resolve.default_policy_not_public",
            subject: dependency.ref,
          });
      branch.default_policy = preset;
    }
  }
  // Source ancestry contributes rights and attribution, not downloadable source assets.
  const assets = collectAssets(
    all.filter((node) => material.has(node)),
    resolved,
    input.publicAssetBaseUrl,
  );
  const meta = collectMeta(root, all, collectAssets(all, resolved, undefined), resolved);
  const prepared = CreationArtifactSchema.parse({
    ...common,
    ...branch,
    assets,
    meta,
    capabilities: [],
  });
  const artifact = { ...prepared, capabilities: deriveCapabilities(prepared) };
  return {
    artifact,
    json: jcs(artifact as unknown as JSONValue),
    digest: digestOf(artifact),
    lock,
    warnings: warnings.sort((a, b) => compareStrings(a.subject, b.subject)),
    ...(resolved ? { resolved } : {}),
  };
}

function collectAssets(
  nodes: Node[],
  resolved: ResolveOutput | undefined,
  baseUrl: string | undefined,
): IRAsset[] {
  const assets: IRAsset[] = [...(resolved?.ir.assets ?? [])];
  const covered = new Set(assets.map((asset) => buildIdentityKey(asset.origin)));
  for (const node of nodes) {
    if (covered.has(node.key)) continue;
    const c = node.creation;
    const key = instanceKey(node.via);
    for (const slot of c.assets)
      for (const variant of slot.variants) {
        const asset: IRAsset = {
          id: irAssetId(c.ref, slot.slot, variant.id, key),
          role: slot.role,
          media_type: variant.media_type,
          digest: variant.blob.digest,
          availability: variant.blob.availability,
          access: node.input.visibility,
          rating: variant.rating ?? c.meta.rating,
          license: variant.license ?? c.meta.license,
          origin: {
            creation: c.ref,
            ...buildIdentity(node.input),
            slot: slot.slot,
            variant: variant.id,
            instance_key: key,
          },
        };
        if (variant.blob.locator) asset.locator = variant.blob.locator;
        if (variant.alt !== undefined)
          asset.alt = pickLocalized(variant.alt, c.meta.default_locale, c.meta.default_locale);
        if (
          baseUrl &&
          node.input.visibility === "public" &&
          variant.blob.availability === "mirrored"
        ) {
          const hex = variant.blob.digest.slice(7);
          asset.url = `${baseUrl.replace(/\/$/, "")}/${hex.slice(0, 2)}/${hex}`;
        }
        assets.push(asset);
      }
  }
  return assets.sort((a, b) => compareStrings(a.id, b.id));
}

function collectMeta(
  root: Node,
  nodes: Node[],
  assets: IRAsset[],
  resolved: ResolveOutput | undefined,
): EffectiveMeta {
  const meta: EffectiveMeta = {
    default_locale: root.creation.meta.default_locale,
    available_locales: resolved?.ir.meta.available_locales ?? [root.creation.meta.default_locale],
    rating: "general",
    rating_sources: [],
    content_warnings: [],
    licenses: [],
    attribution: [],
    contributors: [],
    import_omissions: [],
    au: resolved?.ir.meta.au ?? false,
    recommended_presets: [...(root.creation.meta.recommended_presets ?? [])].sort(compareStrings),
  };
  const bump = (rating: EffectiveMeta["rating"]) => {
    if (RATINGS.indexOf(rating) > RATINGS.indexOf(meta.rating)) meta.rating = rating;
  };
  const warnings = new Set<string>();
  for (const { creation: c } of nodes) {
    bump(c.meta.rating);
    meta.rating_sources.push({ ref: c.ref, rating: c.meta.rating });
    meta.licenses.push({ ref: c.ref, license: c.meta.license });
    meta.attribution.push({ ref: c.ref, authors: c.authors ?? [] });
    for (const entry of c.provenance.contributors ?? [])
      meta.contributors.push({ ref: c.ref, ...entry });
    const fields = c.provenance.imported_from?.omitted_policy_fields;
    if (fields?.length)
      meta.import_omissions.push({ ref: c.ref, fields: [...fields].sort(compareStrings) });
    for (const warning of c.meta.content_warnings ?? []) warnings.add(warning);
    meta.au ||= c.provenance.au === true;
  }
  const seen = new Set<string>();
  for (const asset of assets) {
    const ownerKey = buildIdentityKey(asset.origin);
    const key = `${ownerKey}#${asset.origin.slot}/${asset.origin.variant}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const owner = nodes.find((node) => node.key === ownerKey)?.creation;
    bump(asset.rating);
    const id = `${asset.origin.slot}/${asset.origin.variant}`;
    if (asset.rating !== owner?.meta.rating)
      meta.rating_sources.push({ ref: asset.origin.creation, rating: asset.rating, asset: id });
    if (asset.license !== owner?.meta.license)
      meta.licenses.push({ ref: asset.origin.creation, license: asset.license, asset: id });
  }
  meta.content_warnings = [...warnings].sort(compareStrings);
  const bySource = (
    a: { ref: string; asset?: string | undefined },
    b: { ref: string; asset?: string | undefined },
  ) => compareStrings(a.ref, b.ref) || compareStrings(a.asset ?? "", b.asset ?? "");
  meta.licenses.sort(bySource);
  meta.rating_sources.sort(bySource);
  return meta;
}
