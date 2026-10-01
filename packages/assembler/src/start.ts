/** Deterministic initialization of a fresh session from a complete published artifact. */
import {
  CharError,
  type CompiledTemplate,
  type CreationArtifact,
  CreationArtifactSchema,
  initStoryState,
  type Session,
  SessionSchema,
  type StoryJudgment,
  type TurnView,
  type TurnViewInput,
  TurnViewSchema,
  toTurnStory,
} from "@char-pub/core";
import { z } from "zod";
import { checkLateBindings } from "./assemble.js";
import { localizedTemplate } from "./locale.js";
import { DEFAULT_LABELS, RenderContext } from "./render.js";
import { parseOrThrow } from "./validation.js";

/** Explicit new-session initialization. Never use this to repair a runtime snapshot. */
export function initialStoryTurn(
  input: CreationArtifact,
  start?: string,
  judgments: readonly StoryJudgment[] = [],
): Pick<TurnViewInput, "scene" | "present" | "story"> {
  const artifact = parseOrThrow(CreationArtifactSchema, input, "artifact");
  if (artifact.kind !== "content")
    throw new CharError({ code: "assembly.content_required", subject: artifact.root.ref });
  if (!artifact.story) {
    if (start) throw new CharError({ code: "story.unknown_start", subject: start });
    return {};
  }
  if (!artifact.story_refs)
    throw new CharError({ code: "catalog.story_state_required", subject: "story_refs" });
  const state = initStoryState(
    artifact.story,
    Object.keys(artifact.story_refs.participants),
    start,
    judgments,
  );
  return { scene: state.scene, present: state.present, story: toTurnStory(state) };
}

export interface StartSessionInput {
  artifact: CreationArtifact;
  bindings: Session["bindings"];
  locale?: string;
  /** Required when the story offers more than one start. */
  start?: string;
  /** Alternate bootstrap greetings are selectable only for content without Story. */
  greeting_id?: string;
  judgments?: StoryJudgment[];
}
export interface OpeningMessage {
  role: "assistant";
  content: string;
  /** Omitted for a scenario narrator. */
  speaker?: string;
  source: { kind: "story-start" | "bootstrap"; id: string };
  locale_fallback: boolean;
}
export interface StartedSession {
  /** Ready to assemble. The opening is already the first history entry, if one exists. */
  turn: TurnView;
  /** Display/provenance metadata; do not append this to turn.history again. */
  opening: OpeningMessage | null;
}
const StartInputSchema = z.strictObject({
  artifact: CreationArtifactSchema,
  bindings: SessionSchema.shape.bindings,
  locale: SessionSchema.shape.locale,
  start: z.string().min(1).optional(),
  greeting_id: z.string().min(1).optional(),
  judgments: TurnViewSchema.shape.judgments,
});

/** Selects a start, applies its state, resolves its greeting, and returns one fresh history. */
export function startSession(input: StartSessionInput): StartedSession {
  const parsed = parseOrThrow(StartInputSchema, input, "start");
  const { artifact } = parsed;
  if (artifact.kind !== "content")
    throw new CharError({ code: "assembly.content_required", subject: artifact.root.ref });
  if (artifact.story && parsed.greeting_id !== undefined)
    throw new CharError({
      code: "story.greeting_requires_start",
      subject: parsed.greeting_id,
      detail: "Choose a story start; bootstrap alternatives are not independent story starts.",
    });
  if (artifact.story && (artifact.story.starts?.length ?? 0) > 1 && parsed.start === undefined)
    throw new CharError({ code: "story.start_required", subject: artifact.root.ref });
  const turn = parseOrThrow(
    TurnViewSchema,
    {
      ...initialStoryTurn(artifact, parsed.start, parsed.judgments),
      bindings: parsed.bindings,
      locale: parsed.locale ?? artifact.ir.meta.default_locale,
      ...(parsed.judgments ? { judgments: parsed.judgments } : {}),
    },
    "turn",
  );
  checkLateBindings(artifact.ir, turn);
  const start = artifact.story?.starts?.find((s) => s.id === turn.story?.start);
  const chosen = start?.greeting;
  let template: CompiledTemplate | undefined;
  let source: OpeningMessage["source"] | undefined;
  let speaker: string | undefined;
  if (start && chosen !== undefined && !(typeof chosen === "object" && "ref" in chosen)) {
    const id = `start/${start.id}/greeting`;
    template = artifact.story_refs?.templates[id];
    if (!template) throw new CharError({ code: "assemble.story_template_missing", subject: id });
    source = { kind: "story-start", id: start.id };
  } else {
    const ref = typeof chosen === "object" ? chosen.ref : parsed.greeting_id;
    const greetings = artifact.ir.bootstrap.greetings;
    const greeting = ref === undefined ? greetings[0] : greetings.find((g) => g.id === ref);
    if (!greeting && ref !== undefined)
      throw new CharError({ code: "assemble.no_greeting", subject: ref });
    if (greeting) {
      template = greeting;
      source = { kind: "bootstrap", id: greeting.id };
      if (greeting.speaker) {
        if (!greeting.speaker.startsWith("participant:"))
          throw new CharError({ code: "assemble.invalid_speaker", subject: greeting.speaker });
        speaker = greeting.speaker.slice("participant:".length);
        if (!artifact.ir.participants.some((p) => p.key === speaker))
          throw new CharError({ code: "assemble.unknown_participant", subject: speaker });
      }
    }
  }
  if (!template || !source) return { turn, opening: null };
  const locale = turn.locale ?? artifact.ir.meta.default_locale;
  const selected = localizedTemplate(template, locale, artifact.ir.meta.default_locale);
  const context = new RenderContext(artifact.ir, turn, locale, false, DEFAULT_LABELS);
  const opening: OpeningMessage = {
    role: "assistant",
    content: context.text(selected.text),
    ...(speaker ? { speaker } : {}),
    source,
    locale_fallback: selected.fallback,
  };
  turn.history.push({
    role: "assistant",
    text: opening.content,
    ...(speaker ? { speaker } : {}),
  });
  return { turn, opening };
}
