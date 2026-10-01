/** Fullstack-only seed: publish the reviewed Commons policy through the real Registry pipeline. */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadCharYaml } from "@char-pub/cli";
import { canonicalizeCreation, ExactRefSchema } from "@char-pub/core";
import { createDatabase } from "../src/db/client.js";
import { creations, namespaces } from "../src/db/schema/index.js";
import { parseEnv, StorageEnvSchema } from "../src/env.js";
import { QUEUE_NAMES } from "../src/jobs/definitions.js";
import { JobQueue } from "../src/jobs/queue.js";
import { encodeId } from "../src/registry/ids.js";
import { createRevision, requestPublish } from "../src/registry/publish.js";
import { Cas, casConfigFromEnv } from "../src/storage/cas.js";
import { handlePublish } from "../src/worker/publish.js";

const DB_NAME = "charpub_e2e";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing E2E database");
  const url = new URL(connectionString);
  if (
    process.env.E2E_FULLSTACK !== "1" ||
    process.env.NODE_ENV === "production" ||
    decodeURIComponent(url.pathname.slice(1)) !== DB_NAME ||
    !["127.0.0.1", "localhost"].includes(url.hostname)
  )
    throw new Error("Seed is restricted to the isolated local charpub_e2e database");
  const storage = parseEnv(StorageEnvSchema);
  const database = createDatabase(connectionString, { max: 3 });
  const queue = new JobQueue({ connectionString, max: 2 });
  try {
    await queue.start();
    const namespaceId = randomUUID();
    const creationId = randomUUID();
    const services = {
      db: database.db,
      cas: new Cas(casConfigFromEnv(storage)),
      queue,
      ids: { uuid: () => randomUUID() },
      clock: { now: () => new Date() },
      publicAssetBaseUrl: `${storage.PUBLIC_ASSETS_BASE_URL.replace(/\/+$/, "")}/cas/sha256`,
    };
    await database.db
      .insert(namespaces)
      .values({ id: namespaceId, slug: "commons", kind: "system" });
    await database.db.insert(creations).values({
      id: creationId,
      namespaceId,
      name: "default-preset",
      type: "preset",
      displayName: "Default roleplay policy",
      rating: "general",
    });
    const project = await loadCharYaml(
      fileURLToPath(new URL("../../../content/commons/default-preset/char.yaml", import.meta.url)),
    );
    const canonical = canonicalizeCreation({
      ...project.creation,
      id: encodeId("creation", creationId),
    });
    if (
      canonical.creation.ref !== "@commons/default-preset" ||
      canonical.creation.type !== "preset"
    )
      throw new Error("Unexpected Commons default policy identity");
    const actor = { kind: "system" as const, id: "e2e-default-policy" };
    const revision = await createRevision(services, {
      creationId,
      canonical,
      parentId: null,
      author: { kind: "source" },
      message: "Isolated fullstack seed",
      actor,
      requestId: null,
      updateDraftBase: false,
    });
    const published = await requestPublish(services, {
      creationId,
      revision: revision.row,
      label: "e2e-default",
      visibility: "public",
      idempotencyKey: `e2e-default-${creationId}`,
      source: { provider: "native", revision: encodeId("revision", revision.row.id) },
      publishedBy: { e2e: true },
      actor,
      requestId: null,
    });
    if (published.kind !== "created")
      throw new Error("Default policy request did not create a Release");
    if (
      (await handlePublish(
        { ...services, publishDisabled: async () => false },
        { release_id: published.row.id },
      )) !== "published"
    )
      throw new Error("Default policy failed its real publish checks");
    const jobs = await queue.boss.fetch<{ release_id: string }>(QUEUE_NAMES.publish, {
      batchSize: 10,
    });
    for (const job of jobs ?? []) {
      if (job.data.release_id !== published.row.id)
        throw new Error("Unexpected E2E seed queue entry");
      await queue.boss.complete(QUEUE_NAMES.publish, job.id);
    }
    const pin = ExactRefSchema.parse({
      ref: canonical.creation.ref,
      release: encodeId("release", published.row.id),
      semantic_digest: canonical.semantic_digest,
    });
    // The parent captures this one public identity. Never print env, credentials or connection URLs.
    process.stdout.write(`${JSON.stringify(pin)}\n`);
  } finally {
    await queue.stop();
    await database.close();
  }
}

main().catch((error: unknown) => {
  const code =
    error && typeof error === "object" && "code" in error ? String(error.code) : "seed_failed";
  process.stderr.write(
    `Isolated E2E default-preset seed failed (${code}); no credentials logged.\n`,
  );
  process.exitCode = 1;
});
