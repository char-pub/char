import type { CanonicalCreation } from "./canonical.js";
import { CharError } from "./errors.js";
import { irAssetId } from "./keys.js";
import type { AboutTarget, CatalogIndex, CatalogRef } from "./schema/catalog.js";
import type { ContextIR } from "./schema/ir.js";

/** Build static discovery metadata from the same resolved instances as the content IR. */
export function buildCatalogIndex(
  ir: ContextIR,
  creations: ReadonlyMap<string, CanonicalCreation>,
): CatalogIndex {
  const index: CatalogIndex = { works: [], groups: [], sources: [] };
  for (const instance of ir.graph.instances) {
    const creation = creations.get(instance.ref);
    if (!creation) throw new CharError({ code: "catalog.creation_missing", subject: instance.ref });
    const owner = `${instance.ref}~${instance.key}`;
    const groupId = (id: string) => `${instance.ref}#group/${id}~${instance.key}`;
    const sourceId = (id: string) => `${instance.ref}#source/${id}~${instance.key}`;
    const fragments = ir.fragments.filter((f) => f.origin.instance_key === instance.key);
    const grouped = new Set((creation.groups ?? []).flatMap((g) => g.entries ?? []));
    const nested = new Set((creation.groups ?? []).flatMap((g) => g.groups ?? []));
    const description = creation.description ?? creation.summary;
    index.works.push({
      id: owner,
      ref: instance.ref,
      instance: instance.key,
      title: creation.display_name,
      ...(description ? { description } : {}),
      fragments: fragments.filter((f) => !grouped.has(f.origin.fragment)).map((f) => f.id),
      groups: (creation.groups ?? []).filter((g) => !nested.has(g.id)).map((g) => groupId(g.id)),
      sources: (creation.sources ?? []).map((s) => sourceId(s.id)),
    });
    for (const group of creation.groups ?? [])
      index.groups.push({
        id: groupId(group.id),
        owner,
        local_id: group.id,
        title: group.title,
        description: group.description,
        // Selection/overrides may remove an authored entry from this instance.
        entries: (group.entries ?? []).flatMap((id) =>
          fragments.filter((f) => f.origin.fragment === id).map((f) => f.id),
        ),
        groups: (group.groups ?? []).map(groupId),
      });
    for (const source of creation.sources ?? []) {
      const asset = irAssetId(instance.ref, source.asset, "default", instance.key);
      if (!ir.assets.some((a) => a.id === asset && a.role === "context"))
        throw new CharError({ code: "catalog.source_asset_missing", subject: source.id });
      index.sources.push({
        id: sourceId(source.id),
        owner,
        local_id: source.id,
        title: source.title,
        description: source.description,
        format: source.format,
        asset,
        shared: source.visibility?.scope === "shared",
        sections: source.sections ?? [],
      });
    }
  }
  const about: NonNullable<CatalogIndex["about"]> = [];
  for (const fragment of ir.fragments)
    for (const ref of fragment.about ?? [])
      about.push({
        from: fragment.id,
        ref,
        target: resolveAboutReference(ref, ir, index, fragment.origin.instance_key),
      });
  if (about.length) index.about = about;
  return index;
}

/** Actual instance reachability; authored via paths are not unique for repeated cast uses. */
export function catalogScopeInstances(ir: ContextIR, instance: string): ReadonlySet<string> {
  const children = new Map<string, string[]>();
  for (const edge of [...ir.graph.edges, ...(ir.graph.cast_edges ?? [])]) {
    const targets = children.get(edge.from_instance) ?? [];
    targets.push(edge.to_instance);
    children.set(edge.from_instance, targets);
  }
  const reachable = new Set<string>();
  const pending = [instance];
  while (pending.length) {
    const key = pending.pop();
    if (key === undefined || reachable.has(key)) continue;
    reachable.add(key);
    pending.push(...(children.get(key) ?? []));
  }
  return reachable;
}

/** #fragment / @work#fragment / cast:key#fragment, cast:key, or an exact public work ref. */
export function resolveAboutReference(
  ref: string,
  ir: ContextIR,
  index: CatalogIndex,
  instance = "root",
): AboutTarget {
  if (ref.includes("#")) {
    const target = resolveCatalogReference(ref, ir, index, instance, "fragment");
    if ("fragment" in target) return target;
  }
  const candidates: AboutTarget[] = [];
  if (ref.startsWith("cast:")) {
    for (const participant of ir.participants)
      if (participant.cast_scope === instance && participant.cast_key === ref.slice(5))
        candidates.push({ participant: participant.key });
  } else {
    const scope = catalogScopeInstances(ir, instance);
    for (const work of index.works)
      if (work.ref === ref && scope.has(work.instance)) candidates.push({ work: work.id });
  }
  const target = candidates[0];
  if (candidates.length !== 1 || !target)
    throw new CharError({
      code: candidates.length ? "catalog.ambiguous_about" : "catalog.about_missing",
      subject: ref,
      detail:
        "Association must name one fragment, cast participant, or work in its declaring scope",
    });
  return target;
}

/** Resolve author-facing shorthand against one scope, refusing ambiguous matches. */
export function resolveCatalogReference(
  ref: string,
  ir: ContextIR,
  index: CatalogIndex,
  instance = "root",
  kind: "fragment" | "source" | "content" = "content",
): CatalogRef {
  const scope = catalogScopeInstances(ir, instance);
  let owners = index.works.filter((work) =>
    ref.startsWith("#")
      ? work.instance === instance
      : scope.has(work.instance) && ref.startsWith(`${work.ref}#`),
  );
  const hash = ref.indexOf("#");
  const local = ref.slice(hash + 1);
  if (ref.startsWith("cast:")) {
    const cast = ref.slice(5, hash);
    const instances = new Set(
      ir.graph.instances
        .filter((item) => item.cast?.key === cast && item.cast.scope === instance)
        .map((item) => item.key),
    );
    owners = index.works.filter((work) => instances.has(work.instance));
  }
  const candidates: CatalogRef[] = [];
  for (const owner of owners) {
    if (kind !== "source")
      for (const fragment of ir.fragments) {
        if (fragment.origin.instance_key === owner.instance && fragment.origin.fragment === local)
          candidates.push({ fragment: fragment.id });
      }
    if (kind === "fragment") continue;
    if (kind === "content")
      for (const group of index.groups) {
        if (
          group.owner === owner.id &&
          (local === group.local_id || local === `group/${group.local_id}`)
        )
          candidates.push({ group: group.id });
      }
    for (const source of index.sources) {
      if (source.owner !== owner.id) continue;
      const alias = local.startsWith("source/") ? local.slice(7) : local;
      if (alias === source.local_id) candidates.push({ source: source.id });
      else
        for (const section of source.sections) {
          if (alias === `${source.local_id}/${section.id}`)
            candidates.push({ source: source.id, section: section.id });
        }
    }
  }
  if (candidates.length !== 1)
    throw new CharError({
      code: candidates.length ? "story.ambiguous_information" : "story.information_missing",
      subject: ref,
      detail: "Reference must resolve to one published content instance",
    });
  const result = candidates[0];
  if (!result) throw new CharError({ code: "story.information_missing", subject: ref });
  return result;
}
