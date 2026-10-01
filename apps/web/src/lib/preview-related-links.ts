import {
  type CatalogNode,
  type ContextAssemblyInput,
  catalogKey,
  createPreparationCatalog,
  localizedString,
  viewOf,
} from "@char-pub/assembler";
import type { CatalogRef } from "@char-pub/core";

export interface PreviewRelatedNode {
  key: string;
  kind: "fragment" | "work" | "participant";
  identity: string;
  label: string;
}
export interface PreviewRelatedDirectory {
  nodes: PreviewRelatedNode[];
  links: { from: string; to: string }[];
}

/** Only return associations whose two endpoints are already exposed in this view.
 * The trusted index is used for resolution, never for expanding the public catalog.
 */
export function previewRelatedLinks(input: ContextAssemblyInput): PreviewRelatedDirectory {
  const build = createPreparationCatalog(input, input.plan?.discovery ?? true);
  const { artifact, turn } = build.context;
  const local = (value: Parameters<typeof localizedString>[0]) =>
    localizedString(
      value,
      turn.locale ?? artifact.ir.meta.default_locale,
      artifact.ir.meta.default_locale,
    );
  const exposed = new Map<string, CatalogRef>();
  const expose = (ref: CatalogRef) => exposed.set(catalogKey(ref), ref);
  const walk = (nodes: CatalogNode[]) => {
    for (const node of nodes) {
      expose(node.ref);
      if (node.children) walk(node.children);
    }
  };
  walk(build.catalog.candidates);
  for (const ref of [...build.catalog.required, ...build.catalog.direct]) expose(ref);
  const allowed = new Map<string, PreviewRelatedNode>();
  const workIds = new Set<string>();
  for (const ref of exposed.values()) if ("work" in ref) workIds.add(ref.work);
  for (const fragment of artifact.ir.fragments) {
    const key = catalogKey({ fragment: fragment.id });
    if (!exposed.has(key) || build.visibility.get(key)?.status !== "visible") continue;
    allowed.set(key, {
      key,
      kind: "fragment",
      identity: fragment.id,
      label: fragment.origin.fragment,
    });
  }
  // A directly admitted item exposes its owning instance, but never its siblings.
  for (const ref of [...build.catalog.required, ...build.catalog.direct]) {
    if ("fragment" in ref && allowed.has(catalogKey(ref))) {
      const fragment = artifact.ir.fragments.find((f) => f.id === ref.fragment);
      const work = artifact.catalog_index.works.find(
        (w) => w.instance === fragment?.origin.instance_key,
      );
      if (work) workIds.add(work.id);
    } else if ("source" in ref) {
      const source = artifact.catalog_index.sources.find((s) => s.id === ref.source);
      if (source && viewOf({ kind: "source", value: source }, build.context).status === "visible")
        workIds.add(source.owner);
    }
  }
  for (const work of artifact.catalog_index.works) {
    if (!workIds.has(work.id)) continue;
    const key = catalogKey({ work: work.id });
    allowed.set(key, { key, kind: "work", identity: work.id, label: local(work.title) });
  }
  for (const participant of artifact.ir.participants) {
    if (
      !build.context.present.includes(participant.key) ||
      viewOf({ kind: "story", role: "part", participant: participant.key }, build.context)
        .status !== "visible"
    )
      continue;
    const key = `participant:${participant.key}`;
    allowed.set(key, {
      key,
      kind: "participant",
      identity: participant.key,
      label:
        (participant.late ? turn.bindings[participant.late]?.display_name : undefined) ??
        local(participant.display_name),
    });
  }
  const links: PreviewRelatedDirectory["links"] = [];
  const used = new Set<string>();
  const seen = new Set<string>();
  for (const association of artifact.catalog_index.about ?? []) {
    const from = catalogKey({ fragment: association.from });
    const to =
      "participant" in association.target
        ? `participant:${association.target.participant}`
        : catalogKey(association.target);
    const identity = JSON.stringify([from, to]);
    if (!allowed.has(from) || !allowed.has(to) || seen.has(identity)) continue;
    seen.add(identity);
    used.add(from);
    used.add(to);
    links.push({ from, to });
  }
  return { nodes: [...allowed.values()].filter((node) => used.has(node.key)), links };
}
