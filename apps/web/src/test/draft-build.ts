import type { DraftBuildResponse } from "@char-pub/contracts";
import { buildCreation, PRESET_REGIONS } from "@char-pub/core";
import type { Working } from "@/lib/draft";
export const draftOrigin = {
  kind: "draft-build" as const,
  build_id: "dbld_01j00000000000000000000000",
  revision: "rev_01j00000000000000000000000",
  expires_at: "2026-10-08T00:00:00.000Z",
};
export const draftWorking: Working = {
  id: "cr_01j00000000000000000000000",
  ref: "@writer/policy",
  type: "preset",
  display_name: "Private policy",
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
  policy: {
    version: "1-draft",
    blocks: [{ id: "voice", text: "PRIVATE_DRAFT_POLICY", default_at: "main" }],
    layout: [...PRESET_REGIONS],
    requires: { system_role: true },
  },
};
export const draftBuilt = buildCreation({
  root: { origin: draftOrigin, visibility: "private", creation: draftWorking },
});
export const readyDraft: DraftBuildResponse = {
  origin: draftOrigin,
  state: "ready",
  draft_version: 2,
  semantic_digest: draftBuilt.artifact.root.semantic_digest,
  lock_digest: draftBuilt.artifact.lock_digest,
  artifact_digest: draftBuilt.digest,
};
