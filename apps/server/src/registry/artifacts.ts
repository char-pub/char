/** 统一发布产物读取。旧 Release 保留原存储布局，读取时从不可变快照重建。 */
import {
  buildCreation,
  ContextIRSchema,
  type CreationArtifact,
  CreationArtifactSchema,
  type ReleaseInput,
} from "@char-pub/core";
import { and, eq } from "drizzle-orm";
import { authorize, type Principal } from "../authz/authorize.js";
import type { Executor } from "../db/client.js";
import { creations, namespaces, releases } from "../db/schema/index.js";
import type { Cas } from "../storage/cas.js";
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
  const decision = authorize(principal, "release.read", {
    type: "release",
    id: found.row.id,
    creation_id: found.creation.id,
    ns,
    visibility: found.row.visibility,
    status: found.row.status,
    creation_status: found.creation.status,
  });
  return decision.allow ? found : null;
}

export async function readArtifact(
  cas: Cas,
  row: ReleaseRow,
  publicAssetBaseUrl: string,
): Promise<CreationArtifact> {
  const bucket = row.visibility === "public" ? "public" : "private";
  if (row.artifactDigest) {
    const bytes = await cas.getBlob(bucket, row.artifactDigest);
    return CreationArtifactSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  }
  if (!row.snapshotDigest) throw new Error("completed release has no snapshot");
  const snapshot = await loadSnapshot(cas, bucket, row.snapshotDigest);
  const dependencies: ReleaseInput[] = snapshot.dependencies.map((d) => ({
    ...d,
    visibility: row.visibility,
  }));
  const artifact = buildCreation({
    root: {
      release: encodeId("release", row.id),
      visibility: row.visibility,
      semantic_digest: row.semanticDigest,
      creation: snapshot.root,
    },
    dependencies,
    publicAssetBaseUrl,
  }).artifact;
  // 保留旧发布实际存储的渲染产物，避免当前编译器或依赖可见性改变旧文本与资源 URL。
  if (artifact.kind === "content" && row.contextIrDigest) {
    const bytes = await cas.getBlob(bucket, row.contextIrDigest);
    const ir = ContextIRSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    return {
      ...artifact,
      ir,
      root: ir.root,
      lock_digest: ir.lock_digest,
      meta: ir.meta,
      assets: ir.assets,
    };
  }
  return artifact;
}
