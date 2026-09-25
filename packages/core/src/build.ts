import {
  type CanonicalCreation,
  canonicalizeCreation,
  type Digest,
  digestOf,
  jcs,
} from "./canonical.js";
import { checkCreation } from "./check.js";
import { getCreationDependencies } from "./dependencies.js";
import { CharError, compareStrings } from "./errors.js";
import { instanceKey, irAssetId } from "./keys.js";
import { resolvePreset, resolvePromptModule } from "./preset.js";
import { pickLocalized } from "./resolve/env.js";
import { type GraphWarning, MAX_GRAPH_DEPTH, MAX_GRAPH_INSTANCES } from "./resolve/graph.js";
import {
  type ReleaseInput,
  type ResolveInput,
  type ResolveOutput,
  resolve,
} from "./resolve/index.js";
import { type CreationArtifact, CreationArtifactSchema } from "./schema/artifact.js";
import { type JSONValue, RATINGS, ReleaseIdSchema } from "./schema/creation.js";
import type { EffectiveMeta, IRAsset } from "./schema/ir.js";
import type { LockEntry } from "./schema/release.js";

export interface BuildCreationOutput {
  artifact: CreationArtifact;
  json: string;
  digest: Digest;
  lock: LockEntry[];
  warnings: GraphWarning[];
  resolved?: ResolveOutput;
}
interface Node {
  input: ReleaseInput;
  creation: CanonicalCreation;
  semantic_digest: Digest;
  via: string[];
}

/** One aggregate authorization graph, separate from Creative instances and policy injection. */
export function buildCreation(input: ResolveInput): BuildCreationOutput {
  const inputs = new Map<string, ReleaseInput>();
  for (const item of [input.root, ...(input.dependencies ?? [])]) {
    const prior = inputs.get(item.release);
    if (prior && digestOf(prior) !== digestOf(item))
      throw new CharError({ code: "resolve.duplicate_release", subject: item.release });
    inputs.set(item.release, item);
  }
  const nodes = new Map<string, Node>();
  const byRef = new Map<string, Node>();
  const warnings: GraphWarning[] = [];
  const heights = new Map<string, number>();
  let visits = 0;
  const visit = (rel: ReleaseInput, via: string[], ancestors: readonly string[]): Node => {
    if (!ReleaseIdSchema.safeParse(rel.release).success)
      throw new CharError({ code: "schema.invalid", subject: "release" });
    if (ancestors.includes(rel.release))
      throw new CharError({ code: "resolve.cycle", subject: rel.release, data: { via } });
    if (++visits > MAX_GRAPH_INSTANCES)
      throw new CharError({ code: "resolve.graph_too_large", subject: rel.release });
    if (ancestors.length + (heights.get(rel.release) ?? 0) > MAX_GRAPH_DEPTH)
      throw new CharError({ code: "resolve.graph_too_deep", subject: rel.release });
    const cached = nodes.get(rel.release);
    if (cached) return cached;
    const canonical = canonicalizeCreation(rel.creation);
    const node: Node = {
      input: rel,
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
      throw new CharError({ code: "resolve.semantic_digest_mismatch", subject: rel.release });
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
        data: { via, release: rel.release, reason: rel.status_reason ?? null },
      });
    const prior = byRef.get(node.creation.ref);
    if (prior && prior.input.release !== rel.release)
      throw new CharError({
        code: "resolve.diamond_conflict",
        subject: node.creation.ref,
        data: {
          ref: node.creation.ref,
          releases: [
            { release: prior.input.release, via: prior.via },
            { release: rel.release, via },
          ],
        },
      });
    byRef.set(node.creation.ref, node);
    nodes.set(rel.release, node);
    let height = 0;
    for (const dep of getCreationDependencies(node.creation)) {
      const path =
        dep.domain === "content"
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
      const child = visit(target, path, [...ancestors, rel.release]);
      height = Math.max(height, 1 + (heights.get(target.release) ?? 0));
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
      if (actual !== dep.accepts)
        throw new CharError({
          code: "resolve.dependency_type_mismatch",
          subject: dep.id,
          detail: `expected ${dep.accepts}, got ${child.creation.type}`,
        });
    }
    heights.set(rel.release, height);
    return node;
  };
  const root = visit(input.root, [], []);
  const all = [...nodes.values()].sort((a, b) => compareStrings(a.creation.ref, b.creation.ref));
  const lock: LockEntry[] = all
    .filter((node) => node !== root)
    .map((node) => ({
      ref: node.creation.ref,
      release: node.input.release,
      semantic_digest: node.semantic_digest,
      via: node.via,
    }));
  const common = {
    version: "0-draft" as const,
    root: {
      ref: root.creation.ref,
      release: root.input.release,
      semantic_digest: root.semantic_digest,
    },
    lock,
    lock_digest: digestOf(lock),
  };
  let resolved: ResolveOutput | undefined;
  let branch: Record<string, unknown>;
  const policyInput = (node: Node) => ({
    creation: node.creation,
    release: node.input.release,
    semantic_digest: node.semantic_digest,
    dependencies: input.dependencies ?? [],
  });
  if (root.creation.type === "preset")
    branch = { kind: "preset", preset: resolvePreset(policyInput(root)) };
  else if (root.creation.type === "prompt-module")
    branch = { kind: "prompt-module", module: resolvePromptModule(policyInput(root)) };
  else {
    resolved = resolve(input);
    branch = { kind: "content", ir: resolved.ir };
    if (root.creation.assembly) {
      const config = root.creation.assembly;
      const node = nodes.get(config.preset.release);
      if (!node)
        throw new CharError({ code: "resolve.release_missing", subject: config.preset.release });
      branch.assembly = { ...config, preset: resolvePreset(policyInput(node)) };
    }
  }
  const assets = collectAssets(all, resolved, input.publicAssetBaseUrl);
  const meta = collectMeta(root, all, assets, resolved);
  const artifact = CreationArtifactSchema.parse({ ...common, ...branch, assets, meta });
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
  const covered = new Set(assets.map((asset) => asset.origin.creation));
  for (const node of nodes) {
    if (covered.has(node.creation.ref)) continue;
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
            release: node.input.release,
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
    const key = `${asset.origin.creation}#${asset.origin.slot}/${asset.origin.variant}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const owner = nodes.find((node) => node.creation.ref === asset.origin.creation)?.creation;
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
