import { sha256Bytes } from "@char-pub/core";
import type { AssistanceRequest } from "@/lib/author-assistance";
import type { Working } from "@/lib/draft";

export const assistanceBody = new TextEncoder().encode("# Harbor\nThe docks are quiet.\n");
export const assistanceWorking: Working = {
  id: "cr_01j00000000000000000000000",
  ref: "@writer/harbor",
  type: "scenario",
  display_name: "Harbor",
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
  cast: [{ key: "player", who: { late: "persona" } }],
  fragments: [
    {
      id: "mira",
      stable: true,
      kind: "character",
      description: "A private account",
      content: { type: "text", text: "Mira has a blue coat and fears deep water." },
      locale: { ja: { content: { type: "text", text: "翻訳を保持" } } },
    },
  ],
  story: {
    version: 1,
    scenes: [{ id: "harbor", title: "Harbor" }],
    beats: [{ id: "unfinished", title: "Unfinished" }],
    vars: { trust: { type: "int", init: 0, min: 0, max: 10, description: "Trust" } },
  },
  assets: [
    {
      slot: "guide",
      role: "context",
      variants: [
        {
          id: "default",
          media_type: "text/markdown",
          blob: {
            availability: "mirrored",
            digest: sha256Bytes(assistanceBody),
            size: assistanceBody.length,
          },
        },
      ],
    },
  ],
  sources: [
    {
      id: "guide",
      title: "Guide",
      description: "A harbor guide",
      asset: "guide",
      format: "markdown",
    },
  ],
};
export function candidate(request: AssistanceRequest, output: unknown) {
  return JSON.stringify({
    format: "char.pub/author-assistance-candidate",
    version: 1,
    creation_id: request.creation.id,
    working_digest: request.working_digest,
    request_digest: request.request_digest,
    output,
  });
}
