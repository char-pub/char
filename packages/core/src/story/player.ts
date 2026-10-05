/** Explicit player control resolves to one existing cast identity, never a second character. */
import { CharError } from "../errors.js";
import { participantKey, ROOT_INSTANCE } from "../keys.js";
import type { CreationArtifact } from "../schema/artifact.js";
import type { HistoryMessage } from "../schema/session.js";

export interface StoryPlayer {
  cast_key: string;
  participant: string;
}

/** Legacy artifacts retain their independent implicit user and have no controlled cast. */
export function resolveStoryPlayer(artifact: CreationArtifact): StoryPlayer | null {
  if (artifact.kind !== "content" || artifact.story?.player === undefined) return null;
  const cast = artifact.story.player;
  const participant = artifact.story_refs?.participants[cast];
  const member = artifact.ir.participants.find((entry) => entry.key === participant);
  if (
    !participant ||
    participant !== participantKey(ROOT_INSTANCE, cast) ||
    !member ||
    member.cast_key !== cast ||
    member.cast_scope !== ROOT_INSTANCE
  )
    throw new CharError({ code: "story.player_missing", subject: "story.player" });
  if (member.role !== "user")
    throw new CharError({ code: "story.player_role", subject: "story.player" });
  if (
    artifact.ir.participants.filter(
      (entry) => entry.cast_scope === ROOT_INSTANCE && entry.role === "user",
    ).length !== 1
  )
    throw new CharError({ code: "story.player_ambiguous", subject: "story.player" });
  if (!artifact.capabilities.some((capability) => capability.id === "story.player-control"))
    throw new CharError({ code: "story.player_capability_missing", subject: "capabilities" });
  return { cast_key: cast, participant };
}

/** The human's input speaks through the explicitly controlled cast; old inputs keep their shape. */
export function playerInputMessage(artifact: CreationArtifact, text: string): HistoryMessage {
  const player = resolveStoryPlayer(artifact);
  return { role: "user", text, ...(player ? { speaker: player.participant } : {}) };
}
