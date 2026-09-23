/**
 * 内容寻址存储（CAS）。对象 key 就是内容的 sha256：`cas/sha256/<前 2 位>/<64 位 hex>`。
 *
 * - 写入前在内存中重算哈希，与调用方声明的 digest 不一致就拒绝，保证 key 永远和内容相符。
 * - 已存在的对象不重复上传（内容相同，key 必然相同）。
 * - 四个桶各有用途：public 只放 Public Release 引用的对象，经 CDN 直出；private 只能通过
 *   短期签名 URL 读取；uploads 只接受短期签名 PUT；evidence 用于证据保全，不签发任何 URL。
 * - 每次写入都同步维护 `blobs` 表的元数据（大小、类型、在哪个桶里）。
 */
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { isDigest, sha256Bytes } from "@char-pub/core";
import { sql } from "drizzle-orm";
import type { Executor } from "../db/client.js";
import { blobs } from "../db/schema/index.js";
import type { StorageEnv } from "../env.js";

export type Bucket = "public" | "private" | "uploads" | "evidence";
export type BlobKind = (typeof blobs.$inferInsert)["kind"];

/** 私有对象签名 GET 的最长有效期（秒）。 */
export const MAX_SIGNED_GET_SECONDS = 300;
/** 上传签名 PUT 的最长有效期（秒）。 */
export const MAX_SIGNED_PUT_SECONDS = 600;

export class CasError extends Error {
  constructor(
    readonly code:
      | "cas.digest_mismatch"
      | "cas.invalid_digest"
      | "cas.ttl_too_long"
      | "cas.not_found"
      | "cas.bucket_not_allowed",
    message: string,
  ) {
    super(message);
    this.name = "CasError";
  }
}

export function casKey(digest: string): string {
  if (!isDigest(digest)) throw new CasError("cas.invalid_digest", `invalid digest: ${digest}`);
  const hex = digest.slice("sha256:".length);
  return `cas/sha256/${hex.slice(0, 2)}/${hex}`;
}

/** 证据对象的 key 是 `evidence/<CAS key>`，从中取回内容 digest。 */
export function evidenceDigest(key: string): string {
  const m = /^evidence\/cas\/sha256\/[0-9a-f]{2}\/([0-9a-f]{64})$/.exec(key);
  if (!m) throw new CasError("cas.invalid_digest", `invalid evidence key: ${key}`);
  return `sha256:${m[1]}`;
}

export interface CasConfig {
  client: S3Client;
  buckets: Record<Bucket, string>;
}

export function createS3Client(env: StorageEnv): S3Client {
  return new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    // MinIO 与 R2 都使用路径风格的 URL。
    forcePathStyle: true,
    // R2 不支持 SDK 默认附加的 CRC 校验头；完整性由我们自己的 sha256 保证。
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

export function casConfigFromEnv(env: StorageEnv): CasConfig {
  return {
    client: createS3Client(env),
    buckets: {
      public: env.S3_BUCKET_PUBLIC,
      private: env.S3_BUCKET_PRIVATE,
      uploads: env.S3_BUCKET_UPLOADS,
      evidence: env.S3_BUCKET_EVIDENCE,
    },
  };
}

export interface PutBlobInput {
  bucket: Exclude<Bucket, "uploads">;
  bytes: Uint8Array;
  mediaType: string;
  kind: BlobKind;
  /** 调用方认为的 digest；提供时必须与重算结果一致。 */
  digest?: string;
}

export interface PutBlobResult {
  digest: string;
  key: string;
  size: number;
  /** false 表示对象已存在，这次没有上传。 */
  uploaded: boolean;
}

export class Cas {
  constructor(private readonly config: CasConfig) {}

  bucketName(bucket: Bucket): string {
    return this.config.buckets[bucket];
  }

  async exists(bucket: Bucket, key: string): Promise<boolean> {
    try {
      await this.config.client.send(
        new HeadObjectCommand({ Bucket: this.bucketName(bucket), Key: key }),
      );
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  /** 写入一个对象，并在 `blobs` 表中登记。 */
  async putBlob(db: Executor, input: PutBlobInput): Promise<PutBlobResult> {
    const digest = sha256Bytes(input.bytes);
    if (input.digest !== undefined && input.digest !== digest) {
      throw new CasError(
        "cas.digest_mismatch",
        `declared ${input.digest} but content hashes to ${digest}`,
      );
    }
    const key = casKey(digest);
    let uploaded = false;
    if (!(await this.exists(input.bucket, key))) {
      await this.config.client.send(
        new PutObjectCommand({
          Bucket: this.bucketName(input.bucket),
          Key: key,
          Body: input.bytes,
          ContentType: input.mediaType,
          ContentLength: input.bytes.byteLength,
          // 内容寻址的对象永远不变，可以长期缓存。
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
      uploaded = true;
    }
    if (input.bucket !== "evidence") {
      await recordBlob(db, {
        digest,
        size: input.bytes.byteLength,
        mediaType: input.mediaType,
        kind: input.kind,
        inPublic: input.bucket === "public",
        inPrivate: input.bucket === "private",
      });
    }
    return { digest, key, size: input.bytes.byteLength, uploaded };
  }

  /** 读取 uploads 桶中的原件（按 staging key）。原件没有内容校验，由调用方重算哈希。 */
  async getUpload(key: string): Promise<Uint8Array> {
    assertStagingKey(key);
    try {
      const out = await this.config.client.send(
        new GetObjectCommand({ Bucket: this.bucketName("uploads"), Key: key }),
      );
      if (!out.Body) throw new CasError("cas.not_found", key);
      return await out.Body.transformToByteArray();
    } catch (err) {
      if (isNotFound(err)) throw new CasError("cas.not_found", key);
      throw err;
    }
  }

  /** 删除 uploads 桶中的原件。对象不存在时视为成功。 */
  async deleteUpload(key: string): Promise<void> {
    assertStagingKey(key);
    await this.config.client.send(
      new DeleteObjectCommand({ Bucket: this.bucketName("uploads"), Key: key }),
    );
  }

  /**
   * 从 public / private 桶删除一个可分发副本，并在 `blobs` 中取消对应的标记。
   * 不会删除 evidence 桶中的对象。
   */
  async deleteBlob(db: Executor, bucket: "public" | "private", digest: string): Promise<void> {
    await this.config.client.send(
      new DeleteObjectCommand({ Bucket: this.bucketName(bucket), Key: casKey(digest) }),
    );
    await db
      .update(blobs)
      .set(
        bucket === "public"
          ? { inPublic: false, updatedAt: sql`now()` }
          : { inPrivate: false, updatedAt: sql`now()` },
      )
      .where(sql`${blobs.digest} = ${digest}`);
  }

  /**
   * 写入证据保全对象。evidence 桶只写不读（读取只能经 admin 的 legal 角色），不签发 URL，
   * 也不登记到 `blobs` / `blob_refs`，GC 看不到它们。key 由内容 digest 派生，重复写入幂等。
   */
  async putEvidence(
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<{ key: string; digest: string }> {
    const digest = sha256Bytes(bytes);
    const key = `evidence/${casKey(digest)}`;
    if (!(await this.exists("evidence", key))) {
      await this.config.client.send(
        new PutObjectCommand({
          Bucket: this.bucketName("evidence"),
          Key: key,
          Body: bytes,
          ContentType: mediaType,
          ContentLength: bytes.byteLength,
        }),
      );
    }
    return { key, digest };
  }

  /** 证据对象的元数据（大小与类型），不读取内容。只供 admin 的证据查看使用。 */
  async headEvidence(key: string): Promise<{ size: number; mediaType: string } | null> {
    try {
      const out = await this.config.client.send(
        new HeadObjectCommand({ Bucket: this.bucketName("evidence"), Key: key }),
      );
      return {
        size: out.ContentLength ?? 0,
        mediaType: out.ContentType ?? "application/octet-stream",
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /**
   * 读取证据对象，并校验内容与 key 中的 digest 相符。只供 admin 签发的一次性下载使用，
   * evidence 桶永远不签发存储端的 URL。
   */
  async getEvidence(key: string): Promise<Uint8Array> {
    const digest = evidenceDigest(key);
    let body: Uint8Array;
    try {
      const out = await this.config.client.send(
        new GetObjectCommand({ Bucket: this.bucketName("evidence"), Key: key }),
      );
      if (!out.Body) throw new CasError("cas.not_found", key);
      body = await out.Body.transformToByteArray();
    } catch (err) {
      if (isNotFound(err)) throw new CasError("cas.not_found", key);
      throw err;
    }
    if (sha256Bytes(body) !== digest) {
      throw new CasError("cas.digest_mismatch", `stored evidence ${key} does not match its digest`);
    }
    return body;
  }

  /** 读取对象内容，并校验内容与 key 相符。 */
  async getBlob(bucket: Exclude<Bucket, "uploads">, digest: string): Promise<Uint8Array> {
    const key = casKey(digest);
    let body: Uint8Array;
    try {
      const out = await this.config.client.send(
        new GetObjectCommand({ Bucket: this.bucketName(bucket), Key: key }),
      );
      if (!out.Body) throw new CasError("cas.not_found", key);
      body = await out.Body.transformToByteArray();
    } catch (err) {
      if (isNotFound(err)) throw new CasError("cas.not_found", key);
      throw err;
    }
    if (sha256Bytes(body) !== digest) {
      throw new CasError("cas.digest_mismatch", `stored object ${key} does not match its digest`);
    }
    return body;
  }

  /** 私有对象的短期签名 GET URL。只能签 private 桶。 */
  async signedGet(digest: string, ttlSeconds = MAX_SIGNED_GET_SECONDS): Promise<string> {
    if (ttlSeconds > MAX_SIGNED_GET_SECONDS || ttlSeconds < 1) {
      throw new CasError(
        "cas.ttl_too_long",
        `signed GET ttl must be 1..${MAX_SIGNED_GET_SECONDS}s`,
      );
    }
    return getSignedUrl(
      this.config.client,
      new GetObjectCommand({ Bucket: this.bucketName("private"), Key: casKey(digest) }),
      { expiresIn: ttlSeconds },
    );
  }

  /**
   * 上传用的短期签名 PUT URL。签名覆盖 Content-Length 与 Content-Type，
   * 客户端上传的大小或类型与声明不符时，存储端会拒绝。只能签 uploads 桶。
   */
  async signedPut(input: {
    key: string;
    contentLength: number;
    contentType: string;
    ttlSeconds?: number;
  }): Promise<string> {
    const ttl = input.ttlSeconds ?? MAX_SIGNED_PUT_SECONDS;
    if (ttl > MAX_SIGNED_PUT_SECONDS || ttl < 1) {
      throw new CasError(
        "cas.ttl_too_long",
        `signed PUT ttl must be 1..${MAX_SIGNED_PUT_SECONDS}s`,
      );
    }
    assertStagingKey(input.key);
    return getSignedUrl(
      this.config.client,
      new PutObjectCommand({
        Bucket: this.bucketName("uploads"),
        Key: input.key,
        ContentLength: input.contentLength,
        ContentType: input.contentType,
      }),
      {
        expiresIn: ttl,
        signableHeaders: new Set(["content-length", "content-type"]),
        unhoistableHeaders: new Set(["content-length", "content-type"]),
      },
    );
  }

  /**
   * 从可分发的桶（public / private）中删除一个对象，用于下架。证据桶不能通过这里删除：
   * 证据的删除只能由专门的留存期任务执行。对象本来就不存在时视为成功。
   */
  async deleteObject(bucket: "public" | "private", digest: string): Promise<void> {
    await this.config.client.send(
      new DeleteObjectCommand({ Bucket: this.bucketName(bucket), Key: casKey(digest) }),
    );
  }

  /**
   * 把 private 桶中的对象复制到 public 桶（Private 内容随 Public Release 公开时使用），
   * 并在 `blobs` 中标记 in_public。已在 public 桶中时不重复复制。
   */
  async copyToPublic(db: Executor, digest: string): Promise<{ copied: boolean }> {
    const key = casKey(digest);
    let copied = false;
    if (!(await this.exists("public", key))) {
      if (!(await this.exists("private", key))) throw new CasError("cas.not_found", key);
      await this.config.client.send(
        new CopyObjectCommand({
          Bucket: this.bucketName("public"),
          Key: key,
          CopySource: `${this.bucketName("private")}/${key}`,
        }),
      );
      copied = true;
    }
    await db
      .update(blobs)
      .set({ inPublic: true, updatedAt: sql`now()` })
      .where(sql`${blobs.digest} = ${digest}`);
    return { copied };
  }
}

async function recordBlob(
  db: Executor,
  row: {
    digest: string;
    size: number;
    mediaType: string;
    kind: BlobKind;
    inPublic: boolean;
    inPrivate: boolean;
  },
): Promise<void> {
  await db
    .insert(blobs)
    .values(row)
    .onConflictDoUpdate({
      target: blobs.digest,
      set: {
        inPublic: sql`${blobs.inPublic} OR excluded.in_public`,
        inPrivate: sql`${blobs.inPrivate} OR excluded.in_private`,
        updatedAt: sql`now()`,
      },
    });
}

/** uploads 桶中的对象只能位于 `staging/` 下。 */
function assertStagingKey(key: string): void {
  if (!/^staging\/[0-9a-z_-]+$/.test(key)) {
    throw new CasError("cas.bucket_not_allowed", "upload keys must live under staging/");
  }
}

function isNotFound(err: unknown): boolean {
  if (err instanceof S3ServiceException) {
    return (
      err.$metadata.httpStatusCode === 404 || err.name === "NotFound" || err.name === "NoSuchKey"
    );
  }
  return false;
}
