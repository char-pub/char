/** Player-facing projection. A narrator's knowledge and author guidance are never a player view. */
import {
  availableChoices,
  CharError,
  type CreationArtifact,
  CreationArtifactSchema,
  type IRFragment,
  type LocalizedText,
  resolveStoryPlayer,
  type TurnViewInput,
  USER_PARTICIPANT,
} from "@char-pub/core";
import { checkLateBindings } from "./assemble.js";
import { localizedString } from "./locale.js";
import { DEFAULT_LABELS, RenderContext } from "./render.js";
import { parseOrThrow } from "./validation.js";
import { createViewContext, viewOf } from "./view.js";

export interface PlayerViewPerson {
  key: string;
  cast_key?: string;
  name: string;
  present: boolean;
  part?: string;
  /** Only outward character/persona text admitted by the player's own view. */
  portrait?: string;
}

export interface PlayerView {
  player: {
    key: string;
    cast_key?: string;
    name: string;
    /** A legacy implicit user is not an authored actor with presence. */
    present: boolean | null;
    part?: string;
  };
  scene?: { id: string; title: string; description?: string; time?: string; where?: string };
  /** Current, visible NPCs only. Absent or future characters are not disclosed by this list. */
  participants: PlayerViewPerson[];
  /** Explicitly known, currently visible text information. Discoverable is not synonymous with known. */
  known: { id: string; title: string; text: string }[];
  choices: { id: string; label: string }[];
  /** Reached public milestones only; hidden objects never appear, even after completion. */
  milestones: { kind: "beat" | "ending"; id: string; title: string }[];
}

/** No model calls, Source loads, raw Story state, conditions, NPC goals or hidden metadata. */
export function projectPlayerView(input: {
  artifact: CreationArtifact;
  turn: TurnViewInput;
}): PlayerView {
  const artifact = parseOrThrow(CreationArtifactSchema, input.artifact, "artifact");
  if (artifact.kind !== "content")
    throw new CharError({ code: "assembly.content_required", subject: artifact.root.ref });
  const controlled = resolveStoryPlayer(artifact);
  const playerKey = controlled?.participant ?? USER_PARTICIPANT;
  const context = createViewContext(artifact, input.turn, { mode: "per-agent", for: playerKey });
  const { turn } = context;
  checkLateBindings(artifact.ir, turn);
  const locale = turn.locale ?? artifact.ir.meta.default_locale;
  const local = (value: LocalizedText) =>
    localizedString(value, locale, artifact.ir.meta.default_locale);
  const render = new RenderContext(artifact.ir, turn, locale, false, DEFAULT_LABELS);
  const visible = (fragment: IRFragment) =>
    viewOf({ kind: "fragment", value: fragment }, context).status === "visible";
  const person = artifact.ir.participants.find((entry) => entry.key === playerKey);
  if (!person) throw new CharError({ code: "catalog.participant_missing", subject: playerKey });
  const scene = artifact.story?.scenes.find((entry) => entry.id === turn.scene);
  const result: PlayerView = {
    player: {
      key: playerKey,
      ...(controlled ? { cast_key: controlled.cast_key } : {}),
      name: render.participantName(playerKey),
      present: controlled ? context.present.includes(playerKey) : null,
      ...(controlled && person.part !== undefined ? { part: local(person.part) } : {}),
    },
    ...(scene
      ? {
          scene: {
            id: scene.id,
            title: local(scene.title),
            ...(scene.description !== undefined ? { description: local(scene.description) } : {}),
            ...(scene.time !== undefined ? { time: local(scene.time) } : {}),
            ...(scene.where !== undefined ? { where: local(scene.where) } : {}),
          },
        }
      : {}),
    participants: [],
    known: [],
    choices: [],
    milestones: [],
  };
  for (const participant of artifact.ir.participants) {
    if (
      participant.key === playerKey ||
      participant.key === USER_PARTICIPANT ||
      !context.present.includes(participant.key)
    )
      continue;
    const portraits = artifact.ir.fragments.filter(
      (fragment) =>
        fragment.subject === participant.key &&
        (fragment.kind === "character" || fragment.kind === "persona") &&
        fragment.outward === true &&
        visible(fragment),
    );
    const text = portraits
      .filter((fragment) => render.pickContent(fragment).content.type === "text")
      .map((fragment) => render.render(fragment).text);
    if (participant.late) {
      const outward = turn.bindings[participant.late]?.outward_description;
      if (outward !== undefined) text.push(outward);
    }
    result.participants.push({
      key: participant.key,
      ...(participant.cast_key ? { cast_key: participant.cast_key } : {}),
      name: render.participantName(participant.key),
      present: true,
      ...(participant.part !== undefined ? { part: local(participant.part) } : {}),
      ...(text.length ? { portrait: text.join("\n\n") } : {}),
    });
  }
  if (!artifact.story || !turn.story || !turn.scene) return result;
  const state = {
    ...turn.story,
    scene: turn.scene,
    present: turn.present ?? scene?.cast ?? Object.keys(context.participants),
  };
  const choices = new Set(
    availableChoices(
      artifact.story,
      Object.keys(context.participants),
      state,
      turn.judgments ?? [],
    ),
  );
  result.choices = (scene?.choices ?? []).flatMap((id) => {
    const choice = artifact.story?.choices?.find((entry) => entry.id === id);
    return choice && choices.has(id) ? [{ id, label: local(choice.label) }] : [];
  });
  for (const [kind, objects, reached] of [
    ["beat", artifact.story.beats ?? [], turn.story.reached],
    ["ending", artifact.story.endings ?? [], turn.story.ended],
  ] as const)
    for (const entry of objects)
      if (
        reached.includes(entry.id) &&
        (entry.reveal ?? (kind === "beat" ? "hidden" : "on-reach")) !== "hidden"
      )
        result.milestones.push({ kind, id: entry.id, title: local(entry.title) });
  // An old artifact's role:user remains a control hint, not an invented viewer identity.
  if (!controlled) return result;
  const known = new Set(
    Object.entries(turn.story.knowing)
      .filter(([, cast]) => cast.includes(controlled.cast_key))
      .map(([ref]) => artifact.story_refs?.information[ref])
      .filter((id): id is string => id !== undefined),
  );
  for (const fragment of artifact.ir.fragments) {
    if (
      fragment.kind !== "knowledge" ||
      !known.has(fragment.id) ||
      !visible(fragment) ||
      render.pickContent(fragment).content.type !== "text"
    )
      continue;
    result.known.push({
      id: fragment.id,
      title:
        fragment.description !== undefined ? local(fragment.description) : fragment.origin.fragment,
      text: render.render(fragment).text,
    });
  }
  return result;
}
