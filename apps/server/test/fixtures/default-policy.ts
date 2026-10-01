/** Synthetic default published through the real revision/build pipeline in isolated test DBs. */
import { canonicalizeCreation, type ExactRef, PRESET_REGIONS } from "@char-pub/core";
import { uuidv7 } from "uuidv7";
import type { Services } from "../../src/api/app.js";
import { creations, namespaces } from "../../src/db/schema/index.js";
import { encodeId } from "../../src/registry/ids.js";
import { createRevision, requestPublish } from "../../src/registry/publish.js";
import { handlePublish } from "../../src/worker/publish.js";

export async function publishDefaultPolicy(
  services: Services,
  text = "Respect player agency.",
): Promise<ExactRef> {
  const namespaceId = uuidv7();
  const creationId = uuidv7();
  const slug = `policy-${namespaceId.slice(-12)}`;
  await services.db.insert(namespaces).values({ id: namespaceId, slug, kind: "system" });
  await services.db.insert(creations).values({
    id: creationId,
    namespaceId,
    name: "default",
    type: "preset",
    displayName: "Synthetic default",
    rating: "general",
  });
  const canonical = canonicalizeCreation({
    id: encodeId("creation", creationId),
    ref: `@${slug}/default`,
    type: "preset",
    display_name: "Synthetic default",
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    policy: {
      version: "1-draft",
      blocks: [{ id: "base", text, default_at: "main" }],
      layout: [...PRESET_REGIONS],
      requires: { system_role: true },
    },
  });
  const revision = await createRevision(services, {
    creationId,
    canonical,
    parentId: null,
    author: { kind: "source" },
    message: null,
    actor: { kind: "system", id: "test" },
    requestId: null,
    updateDraftBase: false,
  });
  const result = await requestPublish(services, {
    creationId,
    revision: revision.row,
    label: "fixture-default",
    visibility: "public",
    idempotencyKey: `seed-${creationId}`,
    source: { revision: revision.row.id },
    publishedBy: { test: true },
    actor: { kind: "system", id: "test" },
    requestId: null,
  });
  if (result.kind !== "created") throw new Error(`Default seed request: ${result.kind}`);
  const outcome = await handlePublish(
    { ...services, publishDisabled: async () => false },
    { release_id: result.row.id },
  );
  if (outcome !== "published") throw new Error(`Default seed publish: ${outcome}`);
  // The seed job was executed directly; remove its pending queue delivery to keep test batches scoped.
  const jobs = await services.queue.boss.fetch<{ release_id: string }>("publish", {
    batchSize: 10,
  });
  for (const job of jobs ?? []) {
    if (job.data.release_id !== result.row.id)
      throw new Error("Unexpected job while seeding default");
    await services.queue.boss.complete("publish", job.id);
  }
  return {
    ref: canonical.creation.ref,
    release: encodeId("release", result.row.id),
    semantic_digest: canonical.semantic_digest,
  };
}
