/** Ready bytes still require a scoped grant before a root can read or distribute them. */
import {
  AssetSlotSchema,
  CharError,
  type CreationArtifact,
  sameBuildIdentity,
} from "@char-pub/core";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Executor } from "../db/client.js";
import { blobRefs, creationAssetGrants, releases, uploads } from "../db/schema/index.js";
import type { Cas } from "../storage/cas.js";
import { readArtifact } from "./artifacts.js";

async function ownUploadDigests(db: Executor, actorId: string, digests: readonly string[]) {
  if (!digests.length) return [];
  return db
    .select({ digest: sql<string>`grant_digest.value` })
    .from(uploads)
    .innerJoin(
      sql`jsonb_array_elements_text(${JSON.stringify(digests)}::jsonb) as grant_digest(value)`,
      sql`(
        ${uploads.result}->'blob'->>'digest' = grant_digest.value
        or ${uploads.result}->>'thumbnail' = grant_digest.value
        or ${uploads.result}->'derived' @> jsonb_build_array(grant_digest.value)
      )`,
    )
    .where(and(eq(uploads.status, "ready"), eq(uploads.ownerUserId, actorId)));
}

/** Call inside the authorized creation-row lock, only for a draft being saved/accepted.
 * A pasted digest or another user's uploads never grant a work access to private bytes.
 */
export async function grantDraftAssets(
  db: Executor,
  creationId: string,
  actorId: string,
  working: unknown,
  now: Date,
): Promise<void> {
  const assets = AssetSlotSchema.array().parse(
    working && typeof working === "object" && "assets" in working ? (working.assets ?? []) : [],
  );
  const digests = [
    ...new Set(
      assets.flatMap((asset) =>
        asset.variants
          .filter((variant) => variant.blob.availability === "mirrored")
          .map((variant) => variant.blob.digest),
      ),
    ),
  ];
  const ready = await ownUploadDigests(db, actorId, digests);
  if (ready.length)
    await db
      .insert(creationAssetGrants)
      .values(
        [...new Set(ready.map((row) => row.digest))].map((digest) => ({
          creationId,
          digest,
          grantedBy: actorId,
          createdAt: now,
        })),
      )
      .onConflictDoNothing();
}

/** Access still requires current creation.read_draft authorization and blocked-byte checks. */
export async function canReadDraftAsset(
  db: Executor,
  creationId: string,
  actorId: string | null,
  digest: string,
): Promise<boolean> {
  const [grant] = await db
    .select({ digest: creationAssetGrants.digest })
    .from(creationAssetGrants)
    .where(
      and(eq(creationAssetGrants.creationId, creationId), eq(creationAssetGrants.digest, digest)),
    )
    .limit(1);
  return !!grant || (!!actorId && (await ownUploadDigests(db, actorId, [digest])).length > 0);
}

/** Call only after loading the exact dependency closure under the requesting principal. */
export async function assertRootAssetOwnership(
  db: Executor,
  cas: Cas,
  artifact: CreationArtifact,
  input: { creationId: string; publisherId: string | null; publicAssetBaseUrl: string },
): Promise<void> {
  const rootAssets = artifact.assets.filter(
    (asset) => asset.availability === "mirrored" && sameBuildIdentity(asset.origin, artifact.root),
  );
  if (!rootAssets.length) return;
  // A linked URL grants no access to platform bytes with the same digest.
  const granted = new Set(
    artifact.assets
      .filter(
        (asset) =>
          asset.availability === "mirrored" && !sameBuildIdentity(asset.origin, artifact.root),
      )
      .map((asset) => asset.digest),
  );
  const digests = [...new Set(rootAssets.map((asset) => asset.digest))];
  const workGrants = await db
    .select({ digest: creationAssetGrants.digest })
    .from(creationAssetGrants)
    .where(
      and(
        eq(creationAssetGrants.creationId, input.creationId),
        inArray(creationAssetGrants.digest, digests),
      ),
    );
  for (const grant of workGrants) granted.add(grant.digest);
  if (input.publisherId) {
    // Only server-produced upload results count: normalized blob, thumbnail, imported derivatives.
    // Join against requested digests instead of loading an uploader's complete history.
    const own = await ownUploadDigests(db, input.publisherId, digests);
    for (const row of own) granted.add(row.digest);
  }
  const missing = digests.filter((digest) => !granted.has(digest));
  if (!missing.length) return;
  const previous = await db
    .selectDistinct({ row: releases })
    .from(blobRefs)
    .innerJoin(releases, eq(releases.id, blobRefs.releaseId))
    .where(
      and(
        eq(releases.creationId, input.creationId),
        eq(releases.publishState, "done"),
        ne(releases.status, "tombstoned"),
        eq(blobRefs.role, "asset"),
        inArray(blobRefs.digest, missing),
      ),
    );
  // blob_refs also tracks linked assets. It locates candidate releases, but cannot grant bytes.
  for (const { row } of previous) {
    const prior = await readArtifact(cas, row, input.publicAssetBaseUrl);
    for (const asset of prior.assets)
      if (asset.availability === "mirrored" && missing.includes(asset.digest))
        granted.add(asset.digest);
    if (missing.every((digest) => granted.has(digest))) return;
  }
  for (const asset of rootAssets)
    if (!granted.has(asset.digest))
      throw new CharError({ code: "asset.not_authorized", subject: asset.id });
}
