/** Read stored artifacts, or rebuild only from the release's fixed snapshot/configuration. */
import {
  buildCreation,
  CharError,
  CreationArtifactSchema,
  canonicalizeCreation,
  digestOf,
  type PublishedCreationArtifact,
  type ReleaseInput,
  requirePublishedArtifact,
} from "@char-pub/core";
import { and, eq } from "drizzle-orm";
import { authorize, type Principal } from "../authz/authorize.js";
import type { Executor } from "../db/client.js";
import { creations, namespaces, releases } from "../db/schema/index.js";
import type { Cas } from "../storage/cas.js";
import { collaborationAccess } from "./collaboration-access.js";
import { loadSnapshot } from "./content.js";
import { decodeId, encodeId } from "./ids.js";
import { namespaceContext, type ReleaseRow } from "./read.js";

/** 对知道精确 Release ID 的调用者仍逐项执行集中式读取授权。 */
export async function authorizedRelease(db: Executor, principal: Principal, publicId: string) {
  const id = decodeId("release", publicId);
  if (!id) return null;
  const [found] = await db
    .select({ row: releases, creation: creations, namespace: namespaces })
    .from(releases)
    .innerJoin(creations, eq(creations.id, releases.creationId))
    .innerJoin(namespaces, eq(namespaces.id, creations.namespaceId))
    .where(and(eq(releases.id, id), eq(releases.publishState, "done")))
    .limit(1);
  if (!found) return null;
  const ns = await namespaceContext(db, found.namespace, principal);
  const collaborator = await collaborationAccess(db, found.creation.id, principal);
  const decision = authorize(principal, "release.read", {
    type: "release",
    id: found.row.id,
    creation_id: found.creation.id,
    ns,
    collaborator,
    visibility: found.row.visibility,
    status: found.row.status,
    creation_status: found.creation.status,
  });
  return decision.allow ? { ...found, collaborator } : null;
}

export async function readArtifact(
  cas: Cas,
  row: ReleaseRow,
  publicAssetBaseUrl: string,
): Promise<PublishedCreationArtifact> {
  const bucket = row.visibility === "public" ? "public" : "private";
  if (row.artifactDigest) {
    const bytes = await cas.getBlob(bucket, row.artifactDigest);
    const artifact = requirePublishedArtifact(
      CreationArtifactSchema.parse(JSON.parse(new TextDecoder().decode(bytes))),
      encodeId("release", row.id),
    );
    if (artifact.root.semantic_digest !== row.semanticDigest)
      throw new CharError({ code: "registry.artifact_mismatch", subject: row.id });
    return artifact;
  }
  if (!row.snapshotDigest) throw new Error("completed release has no snapshot");
  const snapshot = await loadSnapshot(cas, bucket, row.snapshotDigest);
  if (
    snapshot.default_policy &&
    row.defaultPolicy &&
    digestOf(snapshot.default_policy) !== digestOf(row.defaultPolicy)
  )
    throw new CharError({ code: "registry.default_policy_mismatch", subject: row.id });
  const defaultPolicy = snapshot.default_policy ?? row.defaultPolicy;
  const creation = canonicalizeCreation(snapshot.root).creation;
  if (
    creation.type !== "preset" &&
    creation.type !== "prompt-module" &&
    !creation.assembly &&
    !defaultPolicy
  )
    throw new CharError({ code: "registry.default_policy_missing", subject: row.id });
  const dependencies: ReleaseInput[] = snapshot.dependencies.map((d) => ({
    ...d,
    visibility: d.visibility ?? row.visibility,
  }));
  const artifact = buildCreation({
    root: {
      release: encodeId("release", row.id),
      visibility: row.visibility,
      semantic_digest: row.semanticDigest,
      creation: snapshot.root,
    },
    dependencies,
    ...(defaultPolicy ? { default_policy: defaultPolicy } : {}),
    publicAssetBaseUrl,
  }).artifact;
  return requirePublishedArtifact(artifact, encodeId("release", row.id));
}
