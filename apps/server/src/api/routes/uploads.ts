/**
 * 上传路由。
 *
 *   POST /v1/uploads               申请上传：返回 10 分钟有效、限定长度与类型的 PUT URL
 *   POST /v1/uploads/:id/complete  上传完成：进入处理队列
 *   GET  /v1/uploads/:id           查询状态（只有上传者本人可见，其他人 404）
 *
 * 文件本身不经过 API，由浏览器直接 PUT 到对象存储。
 */
import {
  CreateUploadRequestSchema,
  type CreateUploadResponseSchema,
  type UploadStatusSchema,
} from "@char-pub/contracts";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import type { z } from "zod";
import { authUser, blockedDigests, uploads } from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { QUEUE_NAMES } from "../../jobs/definitions.js";
import { hit, RATE_LIMITS } from "../../ops/rate-limit.js";
import { stagingKeyFor, UPLOAD_LIMITS, UPLOAD_TTL_MS } from "../../upload/pipeline.js";
import { type AppContext, type Env, notFound, route } from "../app.js";

/** 注册不足 7 天的账号使用更低的上传配额。 */
const NEW_ACCOUNT_MS = 7 * 24 * 60 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type UploadRow = typeof uploads.$inferSelect;

function userId(c: AppContext): string {
  const p = c.var.principal;
  // route() 已经完成授权，这里的 principal 一定是登录用户。
  return p.kind === "user" ? p.user_id : "";
}

function limitFor(purpose: "asset" | "import", contentType: string): string | null {
  const l = UPLOAD_LIMITS[purpose];
  if (!(l.types as readonly string[]).includes(contentType)) return "upload.type_not_allowed";
  return null;
}

function maxBytesFor(purpose: "asset" | "import", contentType: string): number {
  if (purpose === "import" && contentType === "application/json")
    return UPLOAD_LIMITS.import.jsonMaxBytes;
  return UPLOAD_LIMITS[purpose].maxBytes;
}

function statusBody(u: UploadRow): z.input<typeof UploadStatusSchema> {
  const r = (u.result ?? {}) as { blob?: { digest: string; size: number; media_type: string } };
  const out: z.input<typeof UploadStatusSchema> = { upload: u.id, status: u.status };
  if (u.status === "rejected" && u.rejectReason) out.reject_reason = u.rejectReason;
  if (u.status === "ready" && r.blob) {
    out.blob = { digest: r.blob.digest, size: r.blob.size, media_type: r.blob.media_type };
  }
  return out;
}

/** 按 ID 加载上传；只有上传者本人能看到，其他情况一律 404。 */
async function loadOwnUpload(c: AppContext): Promise<UploadRow | Response> {
  const id = c.req.param("id") ?? "";
  if (!UUID_RE.test(id)) return notFound(c);
  const [u] = await c.var.services.db.select().from(uploads).where(eq(uploads.id, id)).limit(1);
  if (!u) return notFound(c);
  const p = c.var.principal;
  if (p.kind !== "user" || p.user_id !== u.ownerUserId) return notFound(c);
  return u;
}

export function register(app: Hono<Env>): void {
  route(app, {
    method: "post",
    path: "/v1/uploads",
    body: CreateUploadRequestSchema,
    authorize: async () => ({
      action: "upload.create",
      resource: { type: "system" },
      loaded: null,
    }),
    handler: async (c, { body }) => {
      const { db, cas, clock, ids } = c.var.services;
      const now = clock.now();
      const uid = userId(c);

      const typeProblem = limitFor(body.purpose, body.content_type);
      if (typeProblem) return problem(c, 422, typeProblem);
      if (body.size > maxBytesFor(body.purpose, body.content_type)) {
        return problem(c, 413, "upload.too_large");
      }

      const [user] = await db
        .select({ createdAt: authUser.createdAt })
        .from(authUser)
        .where(eq(authUser.id, uid))
        .limit(1);
      const isNew = !user || now.getTime() - user.createdAt.getTime() < NEW_ACCOUNT_MS;
      const quota = await hit(
        db,
        `upload:user:${uid}`,
        isNew ? RATE_LIMITS.uploadNewAccount : RATE_LIMITS.upload,
        now,
      );
      if (!quota.allowed) {
        const res = problem(c, 429, "rate_limited", "daily upload quota reached");
        res.headers.set("retry-after", String(quota.retryAfterSeconds));
        return res;
      }

      const [blocked] = await db
        .select({ digest: blockedDigests.digest })
        .from(blockedDigests)
        .where(eq(blockedDigests.digest, body.sha256))
        .limit(1);
      // 不说明原因：避免被用来探测哪些内容在黑名单里。
      if (blocked) return problem(c, 422, "upload.rejected");

      const id = ids.uuid();
      const key = stagingKeyFor(id);
      const expiresAt = new Date(now.getTime() + UPLOAD_TTL_MS);
      await db.insert(uploads).values({
        id,
        ownerUserId: uid,
        status: "uploaded",
        declaredType: body.content_type,
        size: body.size,
        stagingKey: key,
        result: { declared_sha256: body.sha256, purpose: body.purpose },
        expiresAt,
      });
      const putUrl = await cas.signedPut({
        key,
        contentLength: body.size,
        contentType: body.content_type,
      });
      const res: z.input<typeof CreateUploadResponseSchema> = {
        upload: id,
        put_url: putUrl,
        headers: { "content-type": body.content_type, "content-length": String(body.size) },
        expires_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
      };
      return c.json(res, 201);
    },
  });

  route(app, {
    method: "post",
    path: "/v1/uploads/:id/complete",
    authorize: async (c) => {
      const u = await loadOwnUpload(c);
      if (u instanceof Response) return u;
      // 完成上传与申请上传受同样的约束：登录、未封禁、Token scope、uploads 开关。
      return { action: "upload.create", resource: { type: "system" }, loaded: u };
    },
    handler: async (c, { loaded: u }) => {
      const { db, cas, queue, clock } = c.var.services;
      if (u.status !== "uploaded") return c.json(statusBody(u));
      if (u.expiresAt <= clock.now()) return problem(c, 410, "upload.expired");
      if (!(await cas.exists("uploads", u.stagingKey))) {
        return problem(c, 409, "upload.not_uploaded", "the file has not been uploaded yet");
      }
      const updated = await db.transaction(async (tx) => {
        const rows = await tx
          .update(uploads)
          .set({ status: "processing", updatedAt: clock.now() })
          .where(eq(uploads.id, u.id))
          .returning();
        await queue.enqueue(
          tx,
          QUEUE_NAMES.uploadProcess,
          { upload_id: u.id },
          { singletonKey: `upload:${u.id}` },
        );
        return rows[0] ?? u;
      });
      return c.json(statusBody(updated), 202);
    },
  });

  route(app, {
    method: "get",
    path: "/v1/uploads/:id",
    authorize: async (c) => {
      const u = await loadOwnUpload(c);
      if (u instanceof Response) return u;
      return {
        action: "upload.read",
        resource: { type: "upload", id: u.id, owner_user_id: u.ownerUserId },
        loaded: u,
      };
    },
    handler: async (c, { loaded: u }) => c.json(statusBody(u)),
  });
}
