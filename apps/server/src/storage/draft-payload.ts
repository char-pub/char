/** Build-owned private payloads. Their keys and deletion never touch shared CAS assets. */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { isDigest, isId, sha256Bytes } from "@char-pub/core";
import { type CasConfig, casKey } from "./cas.js";

export const DRAFT_PAYLOAD_KINDS = ["artifact", "snapshot", "report"] as const;
export type DraftPayloadKind = (typeof DRAFT_PAYLOAD_KINDS)[number];
export const MAX_DRAFT_SIGNED_GET_SECONDS = 900;
export const DRAFT_PAYLOAD_CACHE_CONTROL = "private, no-store";

const MEDIA_TYPES: Record<DraftPayloadKind, string> = {
  artifact: "application/vnd.char.creation-artifact+json; version=1-draft",
  snapshot: "application/json",
  report: "application/json",
};

export class DraftPayloadError extends Error {
  constructor(
    readonly code:
      | "draft_payload.invalid_bucket"
      | "draft_payload.invalid_build"
      | "draft_payload.invalid_kind"
      | "draft_payload.invalid_digest"
      | "draft_payload.digest_mismatch"
      | "draft_payload.conflict"
      | "draft_payload.not_found"
      | "draft_payload.invalid_expiry"
      | "draft_payload.expired"
      | "draft_payload.invalid_ttl",
    message: string,
  ) {
    super(message);
    this.name = "DraftPayloadError";
  }
}

/** Only a public draft-build TypeID and one fixed payload name may become an object key. */
export function draftPayloadKey(buildId: string, kind: DraftPayloadKind): string {
  if (!isId("draft_build", buildId) || buildId !== buildId.trim())
    throw new DraftPayloadError("draft_payload.invalid_build", "Expected a draft-build TypeID");
  if (!(DRAFT_PAYLOAD_KINDS as readonly string[]).includes(kind))
    throw new DraftPayloadError("draft_payload.invalid_kind", "Unknown draft payload kind");
  return `draft-builds/${buildId}/${kind}.json`;
}

function requireDigest(digest: string): void {
  if (!isDigest(digest) || digest !== digest.trim())
    throw new DraftPayloadError("draft_payload.invalid_digest", "Expected a SHA-256 digest");
}

function hasStatus(error: unknown, status: number): boolean {
  return error instanceof S3ServiceException && error.$metadata.httpStatusCode === status;
}

export class DraftPayloadStore {
  constructor(private readonly config: CasConfig) {}

  /** A named payload is immutable for one build. Repeating identical bytes is safe. */
  async writePayload(
    buildId: string,
    kind: DraftPayloadKind,
    bytes: Uint8Array,
    options: { digest?: string } = {},
  ): Promise<{ key: string; digest: string; size: number; uploaded: boolean }> {
    const key = draftPayloadKey(buildId, kind);
    const digest = sha256Bytes(bytes);
    if (options.digest !== undefined) {
      requireDigest(options.digest);
      if (options.digest !== digest)
        throw new DraftPayloadError(
          "draft_payload.digest_mismatch",
          "Payload bytes differ from the declared digest",
        );
    }
    let uploaded = true;
    try {
      await this.config.client.send(
        new PutObjectCommand({
          Bucket: this.config.buckets.private,
          Key: key,
          Body: bytes,
          ContentLength: bytes.byteLength,
          ContentType: MEDIA_TYPES[kind],
          CacheControl: DRAFT_PAYLOAD_CACHE_CONTROL,
          Metadata: { sha256: digest.slice("sha256:".length) },
          IfNoneMatch: "*",
        }),
      );
    } catch (error) {
      if (!hasStatus(error, 412)) throw error;
      try {
        await this.readVerified(buildId, kind, digest);
      } catch (existingError) {
        if (
          existingError instanceof DraftPayloadError &&
          existingError.code === "draft_payload.digest_mismatch"
        )
          throw new DraftPayloadError(
            "draft_payload.conflict",
            "This build already has different payload bytes",
          );
        throw existingError;
      }
      uploaded = false;
    }
    return { key, digest, size: bytes.byteLength, uploaded };
  }

  /** The expected digest comes from the trusted build record, never from object metadata alone. */
  async readPayload(
    buildId: string,
    kind: DraftPayloadKind,
    expectedDigest: string,
  ): Promise<Uint8Array> {
    return this.readVerified(buildId, kind, expectedDigest);
  }

  private async readVerified(
    buildId: string,
    kind: DraftPayloadKind,
    expectedDigest: string,
  ): Promise<Uint8Array> {
    const key = draftPayloadKey(buildId, kind);
    requireDigest(expectedDigest);
    let bytes: Uint8Array;
    try {
      const object = await this.config.client.send(
        new GetObjectCommand({ Bucket: this.config.buckets.private, Key: key }),
      );
      if (!object.Body)
        throw new DraftPayloadError("draft_payload.not_found", "Draft payload is unavailable");
      bytes = await object.Body.transformToByteArray();
    } catch (error) {
      if (hasStatus(error, 404))
        throw new DraftPayloadError("draft_payload.not_found", "Draft payload is unavailable");
      throw error;
    }
    if (sha256Bytes(bytes) !== expectedDigest)
      throw new DraftPayloadError(
        "draft_payload.digest_mismatch",
        "Stored draft payload does not match its digest",
      );
    return bytes;
  }

  /** Missing objects are already deleted. Caller serializes deletion against worker writes. */
  async deletePayload(buildId: string, kind: DraftPayloadKind): Promise<void> {
    await this.remove(buildId, kind);
  }

  private async remove(buildId: string, kind: DraftPayloadKind): Promise<void> {
    const key = draftPayloadKey(buildId, kind);
    await this.config.client.send(
      new DeleteObjectCommand({ Bucket: this.config.buckets.private, Key: key }),
    );
  }

  /** Delete only the three known payloads; no prefix listing or shared CAS deletion. */
  async deleteBuild(buildId: string): Promise<void> {
    draftPayloadKey(buildId, "artifact");
    await Promise.all(DRAFT_PAYLOAD_KINDS.map((kind) => this.remove(buildId, kind)));
  }

  /** Authorization/deleted status are checked by Registry before signing under the build lock. */
  async signedGet(
    buildId: string,
    kind: DraftPayloadKind,
    expiresAt: Date,
    now: Date,
    ttlSeconds = MAX_DRAFT_SIGNED_GET_SECONDS,
  ): Promise<string> {
    const key = draftPayloadKey(buildId, kind);
    const lifetime = signedLifetime(expiresAt, now, ttlSeconds);
    return getSignedUrl(
      this.config.client,
      new GetObjectCommand({
        Bucket: this.config.buckets.private,
        Key: key,
        ResponseCacheControl: DRAFT_PAYLOAD_CACHE_CONTROL,
        ResponseContentType: MEDIA_TYPES[kind],
      }),
      { expiresIn: lifetime },
    );
  }

  /** Sign only an asset located in an already authorized artifact; Registry owns that lookup. */
  async signedAsset(
    digest: string,
    bucket: "private" | "public",
    expiresAt: Date,
    now: Date,
    ttlSeconds = MAX_DRAFT_SIGNED_GET_SECONDS,
  ): Promise<string> {
    requireDigest(digest);
    if (bucket !== "private" && bucket !== "public")
      throw new DraftPayloadError(
        "draft_payload.invalid_bucket",
        "Only asset distribution buckets may be signed",
      );
    const lifetime = signedLifetime(expiresAt, now, ttlSeconds);
    return getSignedUrl(
      this.config.client,
      new GetObjectCommand({
        Bucket: this.config.buckets[bucket],
        Key: casKey(digest),
        ResponseCacheControl: DRAFT_PAYLOAD_CACHE_CONTROL,
      }),
      { expiresIn: lifetime },
    );
  }
}

function signedLifetime(expiresAt: Date, now: Date, ttlSeconds: number): number {
  if (!Number.isFinite(expiresAt.getTime()) || !Number.isFinite(now.getTime()))
    throw new DraftPayloadError(
      "draft_payload.invalid_expiry",
      "Expected valid build and current times",
    );
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_DRAFT_SIGNED_GET_SECONDS)
    throw new DraftPayloadError(
      "draft_payload.invalid_ttl",
      "Draft download TTL must be 1..900 seconds",
    );
  const remaining = Math.floor((expiresAt.getTime() - now.getTime()) / 1000);
  if (remaining < 1)
    throw new DraftPayloadError("draft_payload.expired", "Draft build has expired");
  return Math.min(ttlSeconds, remaining);
}
