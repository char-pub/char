/** Source bodies are read through a trusted artifact, never through a caller-provided digest. */
import {
  CharError,
  type CreationArtifact,
  materializeSourceText,
  sameBuildIdentity,
} from "@char-pub/core";
import { eq } from "drizzle-orm";
import type { Executor } from "../db/client.js";
import { assetMeta, blockedDigests } from "../db/schema/index.js";
import { type Cas, CasError } from "../storage/cas.js";
import { decodeSourceBytes } from "../storage/text.js";

export async function readSourceText(
  db: Executor,
  cas: Cas,
  artifact: CreationArtifact,
  sourceId: string,
  /** New root uploads are private until publication commits. */
  unpublishedRoot = false,
) {
  if (artifact.kind !== "content")
    throw new CharError({ code: "source.not_found", subject: sourceId });
  const source = artifact.catalog_index.sources.find((s) => s.id === sourceId);
  const asset = source ? artifact.assets.find((a) => a.id === source.asset) : undefined;
  if (!source || !asset || asset.role !== "context")
    throw new CharError({ code: "source.not_found", subject: sourceId });
  if (asset.availability !== "mirrored")
    throw new CharError({ code: "source.not_mirrored", subject: sourceId });
  const [blocked] = await db
    .select({ digest: blockedDigests.digest })
    .from(blockedDigests)
    .where(eq(blockedDigests.digest, asset.digest))
    .limit(1);
  if (blocked) throw new CharError({ code: "source.body_unavailable", subject: sourceId });
  const [meta] = await db
    .select()
    .from(assetMeta)
    .where(eq(assetMeta.digest, asset.digest))
    .limit(1);
  if (
    !meta ||
    meta.scanStatus === "matched" ||
    !["text/plain", "text/markdown"].includes(meta.mediaType)
  )
    throw new CharError({ code: "source.body_unavailable", subject: sourceId });
  const bucket =
    unpublishedRoot && sameBuildIdentity(asset.origin, artifact.root) ? "private" : asset.access;
  let bytes: Uint8Array;
  try {
    bytes = await cas.getBlob(bucket, asset.digest);
  } catch (error) {
    if (error instanceof CasError && error.code === "cas.not_found")
      throw new CharError({ code: "source.body_unavailable", subject: sourceId });
    throw error;
  }
  const text = decodeSourceBytes(bytes, sourceId);
  materializeSourceText(source, asset, text);
  return { source: source.id, asset: asset.id, digest: asset.digest, text };
}
