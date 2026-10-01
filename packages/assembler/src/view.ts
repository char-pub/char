import {
  type CatalogIndex,
  CharError,
  type ContextView,
  ContextViewSchema,
  type CreationArtifact,
  type IRFragment,
  participantKey,
  type TurnView,
  type TurnViewInput,
  TurnViewSchema,
  validateStoryState,
} from "@char-pub/core";

import { parseOrThrow } from "./validation.js";

export type ContentArtifact = Extract<CreationArtifact, { kind: "content" }>;
export interface ViewContext {
  artifact: ContentArtifact;
  turn: TurnView;
  view: ContextView;
  participant?: string;
  present: string[];
  known: Map<string, string[]>;
  /** Local role keys to runtime participant keys. */
  participants: Record<string, string>;
}
export type ViewResult = {
  status: "visible" | "withheld" | "excluded";
  reason?: string;
  knows?: string[];
};
export type ViewItem =
  | { kind: "fragment"; value: IRFragment }
  | { kind: "source"; value: CatalogIndex["sources"][number] }
  | {
      kind: "story";
      role: "scene" | "part" | "goal" | "beat" | "ending" | "runtime";
      participant?: string;
    };

export function createViewContext(
  artifact: ContentArtifact,
  input: TurnViewInput,
  rawView: ContextView,
): ViewContext {
  const turn = parseOrThrow(TurnViewSchema, input, "turn", "catalog.invalid_input");
  const view = parseOrThrow(ContextViewSchema, rawView, "view", "catalog.invalid_input");
  const participants =
    artifact.story_refs?.participants ??
    Object.fromEntries(artifact.ir.participants.map((p) => [p.key, p.key]));
  const participant = view.for ? (participants[view.for] ?? view.for) : undefined;
  if (
    view.mode === "per-agent" &&
    (!participant || !artifact.ir.participants.some((p) => p.key === participant))
  )
    throw new CharError({ code: "catalog.participant_missing", subject: view.for ?? "view.for" });
  let present = turn.present ?? Object.keys(participants);
  const known = new Map<string, string[]>();
  if (artifact.story) {
    if (!turn.story || !turn.scene || !artifact.story_refs)
      throw new CharError({ code: "catalog.story_state_required", subject: "turn" });
    const scene = artifact.story.scenes.find((s) => s.id === turn.scene);
    if (!scene) throw new CharError({ code: "story.unknown_scene", subject: turn.scene });
    present = turn.present ?? scene.cast ?? Object.keys(participants);
    validateStoryState(artifact.story, Object.keys(participants), {
      ...turn.story,
      scene: turn.scene,
      present,
    });
    for (const [ref, keys] of Object.entries(turn.story.knowing)) {
      const id = artifact.story_refs.information[ref];
      if (!id) throw new CharError({ code: "catalog.information_missing", subject: ref });
      const next = keys
        .map((key) => participants[key])
        .filter((key): key is string => key !== undefined);
      const prior = known.get(id);
      if (prior && (prior.length !== next.length || prior.some((p) => !next.includes(p))))
        throw new CharError({ code: "catalog.knowledge_alias_conflict", subject: ref });
      known.set(id, next);
    }
  } else if (turn.story)
    throw new CharError({ code: "catalog.unexpected_story_state", subject: "turn.story" });
  const resolvedPresent = present.map((key) => participants[key] ?? key);
  if (
    new Set(resolvedPresent).size !== resolvedPresent.length ||
    resolvedPresent.some((key) => !artifact.ir.participants.some((p) => p.key === key))
  )
    throw new CharError({ code: "catalog.invalid_presence", subject: "turn.present" });
  return {
    artifact,
    turn,
    view,
    ...(participant ? { participant } : {}),
    present: resolvedPresent,
    known,
    participants,
  };
}

/** One filtering decision is reused by catalog selection and final assembly. */
export function viewOf(item: ViewItem, context: ViewContext): ViewResult {
  const { view, turn, participant, known, artifact, present } = context;
  const excluded = (reason: string): ViewResult => ({ status: "excluded", reason });
  const withheld = (reason: string): ViewResult => ({ status: "withheld", reason });
  if (item.kind === "story") {
    if (["beat", "ending", "runtime"].includes(item.role)) {
      if (!(view.mode === "narrator" && turn.story_guidance && item.role !== "runtime"))
        return excluded("view.runtime_only");
    }
    if (item.role === "goal" && view.mode === "per-agent" && item.participant !== participant)
      return excluded("view.others_goal");
    if (item.participant && !present.includes(item.participant)) return excluded("view.absent");
    return { status: "visible" };
  }
  if (item.kind === "source")
    return view.mode === "per-agent" && !item.value.shared
      ? withheld("view.source_not_shared")
      : { status: "visible" };
  const fragment = item.value;
  const style = fragment.style_scope;
  if (fragment.style_use) {
    const use = fragment.style_use;
    const scopeKey = JSON.stringify(fragment.style_scope);
    const layers = [use, ...(use.path ?? [])];
    const replaced = artifact.ir.fragments.some((other) => {
      if (!other.style_use || JSON.stringify(other.style_scope) !== scopeKey) return false;
      const others = [other.style_use, ...(other.style_use.path ?? [])];
      return layers.some((layer, depth) => {
        const later = others[depth];
        return (
          later?.owner === layer.owner && later.combine === "replace" && later.order > layer.order
        );
      });
    });
    if (replaced) return excluded("view.style_replaced");
  }
  if (
    style &&
    typeof style === "object" &&
    "scene" in style &&
    (style.owner !== "root" || style.scene !== turn.scene)
  )
    return excluded("view.other_scene");
  const visibility = fragment.visibility;
  if (
    (visibility.scope === "scene" || visibility.scope === "story-scene") &&
    visibility.scene !== turn.scene
  )
    return excluded("view.other_scene");
  if (
    style &&
    typeof style === "object" &&
    "participant" in style &&
    !present.includes(style.participant)
  )
    return excluded("view.absent");
  const role = artifact.ir.graph.instances.find(
    (instance) => instance.key === fragment.origin.instance_key,
  )?.cast;
  const subject = fragment.subject ?? (role ? participantKey(role.scope, role.key) : undefined);
  const personContent = ["character", "persona", "examples"].includes(fragment.kind);
  if (personContent && subject && !present.includes(subject)) return excluded("view.absent");
  if (
    view.mode === "per-agent" &&
    subject &&
    subject !== participant &&
    personContent &&
    !fragment.outward
  )
    return excluded("view.not_outward");
  const knows = known.get(fragment.id);
  if (view.mode === "per-agent") {
    if (knows && (!participant || !knows.includes(participant)))
      return withheld("view.not_knowing");
    if (
      visibility.scope === "private" &&
      !visibility.to.some((to) => to === participant || to === `participant:${participant}`)
    )
      return withheld("view.private");
    if (
      style &&
      typeof style === "object" &&
      "participant" in style &&
      style.participant !== participant
    )
      return excluded("view.style_other_cast");
  }
  if (knows) return { status: "visible", knows };
  if (visibility.scope === "private")
    return {
      status: "visible",
      knows: visibility.to
        .map((to) => to.replace(/^participant:/, ""))
        .filter((key) => artifact.ir.participants.some((p) => p.key === key)),
    };
  return { status: "visible" };
}

/** Only this projection is sent to a decision provider; state/overlays never leak implicitly. */
export function selectorView(context: ViewContext) {
  return {
    view: { ...context.view },
    ...(context.turn.scene ? { scene: context.turn.scene } : {}),
    ...(context.turn.focus !== undefined ? { focus: context.turn.focus } : {}),
    history: context.turn.history.map((message) => ({ ...message })),
  };
}
