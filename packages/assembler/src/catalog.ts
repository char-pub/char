import {
  type CatalogRef,
  CharError,
  type ContextView,
  digestExactJSON,
  type IRFragment,
  type LocalizedText,
  participantKey,
  type TurnViewInput,
} from "@char-pub/core";
import { evaluateActivation } from "./activation.js";
import { localizedString } from "./locale.js";
import type { TokenCounter } from "./tokens.js";
import {
  type ContentArtifact,
  createViewContext,
  type ViewContext,
  type ViewResult,
  viewOf,
} from "./view.js";

export interface CatalogNode {
  ref: CatalogRef;
  kind: "work" | "group" | "fragment" | "source" | "section";
  title: string;
  description?: string;
  perspective?: IRFragment["perspective"];
  /** Resolved visible instance identities, never unfiltered author references. */
  about?: string[];
  activation_hint?: "keyword" | "semantic";
  children?: CatalogNode[];
  child_count?: number;
  est_tokens: number;
  importance: "normal" | "opportunistic";
}
export interface ContextCatalog {
  view: ContextView & { scene?: string };
  required: CatalogRef[];
  direct: CatalogRef[];
  candidates: CatalogNode[];
  withheld: number;
}
/** Exact directory payload sent to Selector; required/direct and author diagnostics stay local. */
export function selectorCatalog(catalog: ContextCatalog) {
  return { view: { ...catalog.view }, candidates: catalog.candidates };
}
export interface CatalogBuild {
  associations: ReadonlySet<string>;
  discovery: boolean;
  context: ViewContext;
  catalog: ContextCatalog;
  /** Trusted engine data; never serialize this object to a provider. */
  nodes: ReadonlyMap<string, CatalogNode>;
  visibility: ReadonlyMap<string, ViewResult>;
  input: {
    artifact_digest: string;
    lock_digest: string;
    turn_digest: string;
    catalog_digest: string;
    policy_digest: string;
  };
  selection: { catalog_budget: number; max_depth: number };
  counter: TokenCounter;
}
export const catalogKey = (ref: CatalogRef): string => {
  if ("work" in ref) return `work:${ref.work}`;
  if ("fragment" in ref) return `fragment:${ref.fragment}`;
  if ("group" in ref) return `group:${ref.group}`;
  if ("source" in ref) return `source:${ref.source}${ref.section ? `/section:${ref.section}` : ""}`;
  return `story:${ref.story}:${ref.id}`;
};

export function buildContextCatalog(input: {
  discovery?: boolean;
  artifact: ContentArtifact;
  turn: TurnViewInput;
  view: ContextView;
  counter: TokenCounter;
  selection: { catalog_budget: number; max_depth: number };
  policy?: unknown;
}): CatalogBuild {
  const { artifact, counter, selection } = input;
  const discovery = input.discovery !== false;
  if (
    !Number.isSafeInteger(selection.catalog_budget) ||
    selection.catalog_budget < 0 ||
    !Number.isSafeInteger(selection.max_depth) ||
    selection.max_depth < 1 ||
    selection.max_depth > 32
  )
    throw new CharError({ code: "catalog.invalid_limits", subject: "selection" });
  const context = createViewContext(artifact, input.turn, input.view);
  const { turn, view } = context;
  const locale = turn.locale ?? artifact.ir.meta.default_locale;
  const local = (value: LocalizedText) =>
    localizedString(value, locale, artifact.ir.meta.default_locale);
  const required = new Map<string, CatalogRef>();
  const direct = new Map<string, CatalogRef>();
  const nodes = new Map<string, CatalogNode>();
  const visibility = new Map<string, ViewResult>();
  const assoc = new Map<string, CatalogRef>();
  const add = (map: Map<string, CatalogRef>, ref: CatalogRef) => {
    map.set(catalogKey(ref), ref);
  };
  const index = artifact.catalog_index;
  const association = (ref: CatalogRef, path: Set<string> = new Set()) => {
    const key = catalogKey(ref);
    if (path.has(key)) throw new CharError({ code: "catalog.group_cycle", subject: key });
    if ("group" in ref) {
      const group = index.groups.find((g) => g.id === ref.group);
      if (!group) throw new CharError({ code: "catalog.reference_missing", subject: key });
      const next = new Set([...path, key]);
      for (const id of group.entries) association({ fragment: id }, next);
      for (const id of group.groups) association({ group: id }, next);
    } else add(assoc, ref);
  };
  const authored = (ref: string) => {
    const resolved = artifact.story_refs?.content[ref];
    if (!resolved) throw new CharError({ code: "catalog.reference_missing", subject: ref });
    association(resolved);
  };
  const scene = artifact.story?.scenes.find((s) => s.id === turn.scene);
  if (scene) {
    if (scene.place) authored(scene.place);
    for (const ref of scene.lore ?? []) authored(ref);
    for (const id of scene.items ?? [])
      for (const ref of artifact.story?.items?.find((i) => i.id === id)?.lore ?? []) authored(ref);
    for (const id of scene.events ?? []) {
      const event = artifact.story?.events?.find((e) => e.id === id);
      if (event?.place) authored(event.place);
      if (event?.truth) authored(event.truth);
      for (const ref of event?.lore ?? []) authored(ref);
    }
    if (scene.opening !== undefined || scene.time !== undefined || scene.where !== undefined)
      add(required, { story: "scene", id: scene.id });
    for (const [key, participant] of Object.entries(context.participants)) {
      const p = artifact.ir.participants.find((p) => p.key === participant);
      if (
        p?.part &&
        viewOf({ kind: "story", role: "part", participant }, context).status === "visible"
      )
        add(required, { story: "part", id: key });
      if (
        (p?.goal || scene.goals?.[key]) &&
        viewOf({ kind: "story", role: "goal", participant }, context).status === "visible"
      )
        add(required, { story: "goal", id: key });
    }
    if (view.mode === "narrator" && turn.story_guidance) {
      for (const id of scene.beats ?? [])
        if (!turn.story?.reached.includes(id)) add(direct, { story: "beat", id });
      for (const ending of artifact.story?.endings ?? [])
        if (!turn.story?.ended.includes(ending.id)) add(direct, { story: "ending", id: ending.id });
    }
  }
  const contentText = (fragment: IRFragment): string => {
    const value = fragment.locales?.[locale] ?? fragment.content;
    return value.type === "text"
      ? value.text
      : value.type === "dialogue"
        ? value.turns.map((t) => t.text).join("\n")
        : value.type === "media"
          ? (value.caption ?? "")
          : JSON.stringify(value.data);
  };
  for (const fragment of artifact.ir.fragments) {
    const ref = { fragment: fragment.id };
    const key = catalogKey(ref);
    const result = viewOf({ kind: "fragment", value: fragment }, context);
    visibility.set(key, result);
    if (result.status !== "visible") continue;
    if (fragment.importance === "pinned") {
      add(required, ref);
      continue;
    }
    const activation = evaluateActivation(
      fragment.activation,
      false,
      turn.manual_enabled?.includes(fragment.id) ?? false,
      turn.history,
    );
    if (assoc.has(key) || activation.active) {
      add(direct, ref);
      continue;
    }
    const description =
      fragment.description ??
      (fragment.activation.mode === "semantic" ? fragment.activation.hint : undefined);
    if (
      description &&
      (fragment.activation.mode === "semantic" ||
        (fragment.activation.mode === "keyword" && fragment.selectable))
    )
      nodes.set(key, {
        ref,
        kind: "fragment",
        title: fragment.origin.fragment,
        description: local(description),
        est_tokens: counter.count(contentText(fragment)),
        importance: fragment.importance,
      });
  }
  for (const source of index.sources) {
    const ref = { source: source.id };
    const key = catalogKey(ref);
    const result = viewOf({ kind: "source", value: source }, context);
    visibility.set(key, result);
    if (result.status !== "visible") continue;
    const sections: CatalogNode[] = [];
    if (assoc.has(key)) {
      add(direct, ref);
      continue;
    }
    for (const section of source.sections) {
      const ref = { source: source.id, section: section.id };
      if (assoc.has(catalogKey(ref))) {
        add(direct, ref);
        continue;
      }
      const node: CatalogNode = {
        ref,
        kind: "section",
        title: local(section.title),
        ...(section.description ? { description: local(section.description) } : {}),
        est_tokens: 0,
        importance: "normal",
      };
      sections.push(node);
      nodes.set(catalogKey(ref), node);
    }
    // A partially-direct source cannot be selected whole and duplicate that section.
    const partiallyDirect = source.sections.some((s) =>
      assoc.has(catalogKey({ source: source.id, section: s.id })),
    );
    if (!partiallyDirect || sections.length)
      nodes.set(key, {
        ref,
        kind: "source",
        title: local(source.title),
        ...(source.description ? { description: local(source.description) } : {}),
        ...(source.sections.length ? { children: sections, child_count: sections.length } : {}),
        est_tokens: 0,
        importance: "normal",
      });
  }
  // Project metadata only after every target has passed the same view decision as its body.
  // Activation and selection remain independent: an about link never admits the target.
  const visibleParticipants = new Set(
    artifact.ir.participants
      .filter(
        (participant) =>
          viewOf({ kind: "story", role: "part", participant: participant.key }, context).status ===
          "visible",
      )
      .map((participant) => participant.key),
  );
  const visibleWorks = new Set<string>();
  for (const fragment of artifact.ir.fragments)
    if (visibility.get(catalogKey({ fragment: fragment.id }))?.status === "visible")
      visibleWorks.add(`${fragment.origin.creation}~${fragment.origin.instance_key}`);
  for (const source of index.sources)
    if (visibility.get(catalogKey({ source: source.id }))?.status === "visible")
      visibleWorks.add(source.owner);
  for (const instance of artifact.ir.graph.instances) {
    const participant = instance.cast
      ? participantKey(instance.cast.scope, instance.cast.key)
      : instance.key === "root"
        ? "self"
        : undefined;
    if (participant && visibleParticipants.has(participant))
      visibleWorks.add(`${instance.ref}~${instance.key}`);
  }
  const about = new Map<string, string[]>();
  for (const link of index.about ?? []) {
    const target = link.target;
    const value =
      "fragment" in target
        ? visibility.get(catalogKey(target))?.status === "visible"
          ? target.fragment
          : undefined
        : "participant" in target
          ? visibleParticipants.has(target.participant)
            ? `participant:${target.participant}`
            : undefined
          : visibleWorks.has(target.work)
            ? target.work
            : undefined;
    if (value !== undefined) {
      const prior = about.get(link.from) ?? [];
      if (!prior.includes(value)) prior.push(value);
      about.set(link.from, prior);
    }
  }
  for (const fragment of artifact.ir.fragments) {
    const node = nodes.get(catalogKey({ fragment: fragment.id }));
    if (!node) continue;
    const perspective = fragment.perspective;
    if (typeof perspective === "string") node.perspective = perspective;
    else if (perspective) {
      const speaker = "claim" in perspective ? perspective.claim : perspective.belief;
      if (visibleParticipants.has(speaker.slice("participant:".length)))
        node.perspective = { ...perspective };
    }
    const links = about.get(fragment.id);
    if (links?.length) node.about = links;
    if (fragment.activation.mode === "keyword" || fragment.activation.mode === "semantic")
      node.activation_hint = fragment.activation.mode;
  }
  const seenGroups = new Set<string>();
  const groupNode = (id: string): CatalogNode | undefined => {
    if (seenGroups.has(id)) return undefined;
    seenGroups.add(id);
    const group = index.groups.find((g) => g.id === id);
    if (!group) throw new CharError({ code: "catalog.group_missing", subject: id });
    const children = [
      ...group.entries.map((id) => nodes.get(catalogKey({ fragment: id }))),
      ...group.groups.map(groupNode),
    ].filter((node): node is CatalogNode => node !== undefined);
    if (!children.length) return undefined;
    const node: CatalogNode = {
      ref: { group: id },
      kind: "group",
      title: local(group.title),
      ...(group.description ? { description: local(group.description) } : {}),
      children,
      child_count: children.length,
      est_tokens: 0,
      importance: "normal",
    };
    nodes.set(catalogKey(node.ref), node);
    return node;
  };
  const candidates: CatalogNode[] = [];
  for (const work of index.works) {
    const children = [
      ...work.fragments.map((id) => nodes.get(catalogKey({ fragment: id }))),
      ...work.groups.map(groupNode),
      ...work.sources.map((id) => nodes.get(catalogKey({ source: id }))),
    ].filter((node): node is CatalogNode => node !== undefined);
    if (!children.length) continue;
    const node: CatalogNode = {
      ref: { work: work.id },
      kind: "work",
      title: local(work.title),
      ...(work.description ? { description: local(work.description) } : {}),
      children,
      child_count: children.length,
      est_tokens: 0,
      importance: "normal",
    };
    nodes.set(catalogKey(node.ref), node);
    candidates.push(node);
  }
  const trim = (node: CatalogNode, depth: number): CatalogNode => {
    const { children, ...rest } = node;
    return {
      ...rest,
      ...(children && depth < Math.min(selection.max_depth, 1)
        ? { children: children.map((child) => trim(child, depth + 1)) }
        : {}),
    };
  };
  const catalog: ContextCatalog = {
    view: { ...view, ...(turn.scene ? { scene: turn.scene } : {}) },
    required: [...required.values()],
    direct: [...direct.values()],
    candidates: discovery ? candidates.map((node) => trim(node, 0)) : [],
    withheld: [...visibility.values()].filter((result) => result.status === "withheld").length,
  };
  if (
    discovery &&
    counter.count(JSON.stringify(selectorCatalog(catalog))) > selection.catalog_budget
  )
    throw new CharError({ code: "catalog.directory_over_budget", subject: "candidates" });
  return {
    associations: new Set(assoc.keys()),
    discovery,
    context,
    catalog,
    nodes,
    visibility,
    counter,
    selection: { ...selection },
    input: {
      artifact_digest: digestExactJSON(artifact),
      lock_digest: artifact.lock_digest,
      turn_digest: digestExactJSON(turn),
      catalog_digest: digestExactJSON(catalog),
      policy_digest: digestExactJSON({
        policy: input.policy ?? null,
        selection,
        tokenizer: counter.tokenizer,
        estimated: counter.estimated,
      }),
    },
  };
}
