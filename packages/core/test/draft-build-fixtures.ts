import { canonicalizeCreation } from "../src/canonical.js";
import type { CreationInput } from "../src/schema/creation.js";
import type { DraftBuildOrigin } from "../src/schema/identity.js";
import { PRESET_REGIONS } from "../src/schema/policy.js";
import { D, level0Character, tid } from "./fixtures.js";

export const DRAFT_ORIGIN: DraftBuildOrigin = {
  kind: "draft-build",
  build_id: tid("dbld", 601),
  revision: tid("rev", 601),
  expires_at: "2026-10-07T00:00:00.000Z",
};
export function draftInput(type: "character" | "preset" | "prompt-module" = "character") {
  const creation: CreationInput =
    type === "character"
      ? level0Character({
          ref: "@draft/character",
          bootstrap: { greetings: [{ id: "hello", text: "Hello {{user}}." }] },
          sources: [
            {
              id: "notes",
              title: "Notes",
              description: "Author notes",
              asset: "notes",
              format: "text",
              visibility: { scope: "shared" },
            },
          ],
          assets: [
            ...(level0Character().assets ?? []),
            {
              slot: "notes",
              role: "context",
              variants: [
                {
                  id: "default",
                  media_type: "text/plain",
                  blob: { availability: "mirrored", digest: D("c"), size: 4 },
                },
              ],
            },
          ],
        })
      : {
          id: tid("cr", 601),
          ref: `@draft/${type}`,
          type,
          display_name: "Draft policy",
          meta: level0Character().meta,
          ...(type === "preset"
            ? {
                policy: {
                  version: "1-draft",
                  blocks: [{ id: "voice", text: "DRAFT_POLICY", default_at: "main" }],
                  layout: [...PRESET_REGIONS],
                  requires: { system_role: true },
                },
              }
            : {
                prompt_module: {
                  version: "1-draft",
                  blocks: [{ id: "voice", text: "DRAFT_MODULE", default_at: "main" }],
                },
              }),
        };
  return {
    root: {
      origin: DRAFT_ORIGIN,
      creation,
      visibility: "private" as const,
      semantic_digest: canonicalizeCreation(creation).semantic_digest,
    },
  };
}
