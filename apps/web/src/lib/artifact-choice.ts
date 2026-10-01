import { type PublishedCreationArtifact, requirePublishedArtifact } from "@char-pub/core";
import type { ReleaseSummary } from "./api";

export interface ArtifactChoice {
  artifact: PublishedCreationArtifact;
  label: string;
  visibility: "public" | "private";
}

/** Selecting an address or draft is never enough to bind a creation dependency. */
export function artifactChoice(
  artifact: PublishedCreationArtifact,
  selected: ReleaseSummary,
): ArtifactChoice {
  requirePublishedArtifact(artifact, selected.id);
  if (artifact.root.semantic_digest !== selected.semantic_digest)
    throw new Error("This artifact does not match the selected version. Reload its versions.");
  return { artifact, label: selected.label, visibility: selected.visibility };
}
