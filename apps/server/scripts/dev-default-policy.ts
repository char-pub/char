/** Local developer bootstrap; never reads or publishes the unreviewed Commons content bundle. */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { canonicalizeCreation, ExactRefSchema, PRESET_REGIONS } from "@char-pub/core";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "../src/db/client.js";
import { creations, namespaces, releases } from "../src/db/schema/index.js";
import { parseEnv, StorageEnvSchema } from "../src/env.js";
import { JobQueue } from "../src/jobs/queue.js";
import { readArtifact } from "../src/registry/artifacts.js";
import { encodeId } from "../src/registry/ids.js";
import { createRevision, requestPublish } from "../src/registry/publish.js";
import { Cas, casConfigFromEnv } from "../src/storage/cas.js";
import { handlePublish } from "../src/worker/publish.js";

const NAME = "Local development default policy";
const SUMMARY = "Local pnpm dev bootstrap only; not the reviewed Commons distribution.";
const LABEL = "local-dev-v1";
class LocalPolicyError extends Error {}
type Services = Parameters<typeof requestPublish>[0] & Parameters<typeof handlePublish>[0];

/** Fail before any connection or write when the launcher is not using its isolated local services. */
export function assertLocalDevelopment(env: NodeJS.ProcessEnv): void {
  const db = new URL(env.DATABASE_URL ?? "http://invalid");
  const storage = new URL(env.S3_ENDPOINT ?? "http://invalid");
  if (
    env.NODE_ENV !== "development" ||
    !["postgres:", "postgresql:"].includes(db.protocol) ||
    !["127.0.0.1", "localhost"].includes(db.hostname) ||
    decodeURIComponent(db.pathname) !== "/charpub" ||
    storage.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(storage.hostname) ||
    !["S3_BUCKET_PUBLIC", "S3_BUCKET_PRIVATE", "S3_BUCKET_UPLOADS", "S3_BUCKET_EVIDENCE"].every(
      (key) => env[key]?.startsWith("charpub-local-"),
    )
  )
    throw new LocalPolicyError(
      "Local policy bootstrap requires the development charpub database and local storage; configure DEFAULT_PRESET explicitly for other services.",
    );
}

/** Publish once through the Registry, retaining the exact local version on subsequent starts. */
export async function ensureDevelopmentDefaultPolicy(services: Services) {
  const { db } = services;
  await db
    .insert(namespaces)
    .values({ id: randomUUID(), slug: "commons", kind: "system" })
    .onConflictDoNothing();
  const [namespace] = await db.select().from(namespaces).where(eq(namespaces.slug, "commons"));
  if (namespace?.kind !== "system" || namespace.status !== "active")
    throw new LocalPolicyError(
      "The local Commons namespace is unavailable; configure DEFAULT_PRESET explicitly.",
    );
  await db
    .insert(creations)
    .values({
      id: randomUUID(),
      namespaceId: namespace.id,
      name: "default-preset",
      type: "preset",
      displayName: NAME,
      summary: SUMMARY,
      rating: "general",
    })
    .onConflictDoNothing();
  const [creation] = await db
    .select()
    .from(creations)
    .where(and(eq(creations.namespaceId, namespace.id), eq(creations.name, "default-preset")));
  if (
    creation?.type !== "preset" ||
    creation.status !== "active" ||
    creation.displayName !== NAME ||
    creation.summary !== SUMMARY
  )
    throw new LocalPolicyError(
      "An existing default-preset is not managed by local development; set its reviewed exact DEFAULT_PRESET explicitly. No existing definition was replaced.",
    );
  const canonical = canonicalizeCreation({
    id: encodeId("creation", creation.id),
    ref: "@commons/default-preset",
    type: "preset",
    display_name: NAME,
    summary: SUMMARY,
    authors: [{ name: "Local development bootstrap" }],
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    provenance: { authored_by_agent: true },
    policy: {
      version: "1-draft",
      blocks: [
        {
          id: "play",
          default_at: "main",
          text: "Continue the current scene using the supplied visible character and story information. Leave the player's decisions and speech to the player. Respect the supplied perspective and knowledge limits.",
        },
      ],
      layout: [...PRESET_REGIONS],
      requires: { system_role: true },
      selection: { catalog_budget: 2048, max_depth: 4, on_unavailable: "skip" },
    },
  });
  const actor = { kind: "system" as const, id: "local-development-default-policy" };
  const revision = await createRevision(services, {
    creationId: creation.id,
    canonical,
    parentId: null,
    author: { kind: "source" },
    message: SUMMARY,
    actor,
    requestId: null,
    updateDraftBase: false,
  });
  const published = await requestPublish(services, {
    creationId: creation.id,
    revision: revision.row,
    label: LABEL,
    visibility: "public",
    idempotencyKey: `local-default-${creation.id}`,
    source: { provider: "native", revision: encodeId("revision", revision.row.id) },
    publishedBy: { local_development: true },
    actor,
    requestId: null,
  });
  if (!["created", "same", "idempotent"].includes(published.kind) || !("row" in published))
    throw new LocalPolicyError(`Local default policy request failed (${published.kind}).`);
  if (published.row.publishState === "pending")
    await handlePublish(services, { release_id: published.row.id });
  const [ready] = await db.select().from(releases).where(eq(releases.id, published.row.id));
  if (
    ready?.publishState !== "done" ||
    ready.status !== "active" ||
    ready.visibility !== "public" ||
    ready.semanticDigest !== canonical.semantic_digest
  )
    throw new LocalPolicyError(
      "The local default policy is not an active, successfully published version; no fallback policy was installed.",
    );
  const artifact = await readArtifact(services.cas, ready, services.publicAssetBaseUrl);
  if (artifact.kind !== "preset" || artifact.root.semantic_digest !== canonical.semantic_digest)
    throw new LocalPolicyError("Local default policy artifact does not match its fixed release.");
  return ExactRefSchema.parse({
    ref: canonical.creation.ref,
    release: encodeId("release", ready.id),
    semantic_digest: canonical.semantic_digest,
  });
}

async function main(): Promise<void> {
  assertLocalDevelopment(process.env);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new LocalPolicyError("Missing local database");
  const storage = parseEnv(StorageEnvSchema);
  const database = createDatabase(connectionString, { max: 3 });
  const queue = new JobQueue({ connectionString, max: 2 });
  try {
    await queue.start();
    const pin = await ensureDevelopmentDefaultPolicy({
      db: database.db,
      cas: new Cas(casConfigFromEnv(storage)),
      queue,
      ids: { uuid: randomUUID },
      clock: { now: () => new Date() },
      publishDisabled: async () => false,
      publicAssetBaseUrl: `${storage.PUBLIC_ASSETS_BASE_URL.replace(/\/+$/, "")}/cas/sha256`,
    });
    // Public exact identity only. Queue deliveries remain for the normal idempotent worker.
    process.stdout.write(`${JSON.stringify(pin)}\n`);
  } finally {
    await queue.stop();
    await database.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof LocalPolicyError ? error.message : "Local default policy bootstrap failed; inspect the local database and storage configuration"}\n`,
    );
    process.exitCode = 1;
  });
}
