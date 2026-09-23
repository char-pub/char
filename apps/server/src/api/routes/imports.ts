/**
 * 角色卡导入的路由。
 *
 *   POST /v1/imports              从一个 purpose 为 import 的上传导入角色卡，生成新的 Creation 草稿
 *   GET  /v1/imports/:id          查询导入状态与 Import Report（只有发起人可见，其他人 404）
 *   POST /v1/imports/:id/confirm  确认评级、权利与许可；确认之前导入生成的 Creation 不能发布
 *
 * 导入是异步的：请求在一个事务里登记导入并入队，worker 解析卡片、处理图片后创建 Creation。
 * 同一个上传只能导入一次，重复提交返回同一个导入。
 */
import {
  ConfirmImportRequestSchema,
  CreateImportRequestSchema,
  type ImportStatus,
} from "@char-pub/contracts";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { appendAudit } from "../../audit/audit.js";
import type { Resource } from "../../authz/authorize.js";
import { creationDrafts, creations, imports, namespaces, uploads } from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { QUEUE_NAMES } from "../../jobs/definitions.js";
import { uploadsLocked } from "../../moderation/upload-lock.js";
import { hit, RATE_LIMITS } from "../../ops/rate-limit.js";
import { auditActor, param, requestIdOf, userIdOf } from "../../registry/context.js";
import { decodeId, encodeId } from "../../registry/ids.js";
import { type ImportRow, importStatusBody, nameTaken } from "../../registry/imports.js";
import { lookupNamespace } from "../../registry/lookup.js";
import { type AppContext, type Env, notFound, route } from "../app.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function uniqueViolation(e: unknown): string | null {
  const err = e as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  };
  if (err?.code === "23505") return err.constraint ?? "";
  if (err?.cause?.code === "23505") return err.cause.constraint ?? "";
  return null;
}

/** 按 ID 加载导入，连同授权需要的 namespace 与 Creation 状态。 */
async function loadImport(
  c: AppContext,
): Promise<{ imp: ImportRow; resource: Extract<Resource, { type: "import" }> } | Response> {
  const { db } = c.var.services;
  const id = decodeId("import", param(c, "id"));
  if (!id) return notFound(c);
  const [imp] = await db.select().from(imports).where(eq(imports.id, id)).limit(1);
  if (!imp) return notFound(c);
  const [ns] = await db
    .select({ slug: namespaces.slug })
    .from(namespaces)
    .where(eq(namespaces.id, imp.namespaceId))
    .limit(1);
  const found = ns ? await lookupNamespace(db, ns.slug, c.var.principal) : null;
  if (found?.kind !== "found") return notFound(c);
  const resource: Extract<Resource, { type: "import" }> = {
    type: "import",
    id: imp.id,
    owner_user_id: imp.ownerUserId,
    ns: found.ctx,
  };
  if (imp.creationId) {
    const [cr] = await db
      .select({ status: creations.status })
      .from(creations)
      .where(eq(creations.id, imp.creationId))
      .limit(1);
    if (cr) resource.creation_status = cr.status;
  }
  return { imp, resource };
}

/** 导入成功后生成的 Creation 的当前公共标识（namespace 改名后跟随新名字）。 */
async function creationRef(c: AppContext, imp: ImportRow): Promise<string | undefined> {
  if (!imp.creationId) return undefined;
  const [row] = await c.var.services.db
    .select({ slug: namespaces.slug, name: creations.name })
    .from(creations)
    .innerJoin(namespaces, eq(namespaces.id, creations.namespaceId))
    .where(eq(creations.id, imp.creationId))
    .limit(1);
  return row ? `@${row.slug}/${row.name}` : undefined;
}

export function register(app: Hono<Env>): void {
  route(app, {
    method: "post",
    path: "/v1/imports",
    body: CreateImportRequestSchema,
    authorize: async (c) => {
      const raw = await c.req.json().catch(() => undefined);
      const parsed = CreateImportRequestSchema.safeParse(raw);
      // 请求体不合法时还不知道目标 namespace：只检查能否使用导入功能，之后以 422 结束。
      if (!parsed.success) {
        return { action: "import.create", resource: { type: "system" }, loaded: null };
      }
      const { db } = c.var.services;
      let found = await lookupNamespace(db, parsed.data.namespace, c.var.principal);
      if (found.kind === "redirect") found = await lookupNamespace(db, found.to, c.var.principal);
      if (found.kind !== "found") return notFound(c);
      return {
        action: "import.create",
        resource: { type: "namespace", ns: found.ctx },
        loaded: found.ns,
      };
    },
    handler: async (c, { body, loaded: ns }) => {
      const { db, queue, clock, ids } = c.var.services;
      if (!ns) return problem(c, 422, "request.invalid");
      const uid = userIdOf(c.var.principal);
      const now = clock.now();
      if (await uploadsLocked(db, uid)) return problem(c, 403, "upload.locked");

      if (!UUID_RE.test(body.upload)) return notFound(c);
      const [u] = await db.select().from(uploads).where(eq(uploads.id, body.upload)).limit(1);
      // 别人的上传与不存在的上传同样返回 404。
      if (!u || u.ownerUserId !== uid) return notFound(c);

      const [existing] = await db.select().from(imports).where(eq(imports.uploadId, u.id)).limit(1);
      if (existing) {
        if (existing.namespaceId === ns.id && existing.name === body.name) {
          return c.json(importStatusBody(existing, { creation: await creationRef(c, existing) }));
        }
        return problem(c, 409, "import.upload_used", "this upload has already been imported");
      }

      const quota = await hit(db, `import:user:${uid}`, RATE_LIMITS.import, now);
      if (!quota.allowed) {
        const res = problem(c, 429, "rate_limited", "too many imports; try again later");
        res.headers.set("retry-after", String(quota.retryAfterSeconds));
        return res;
      }

      const purpose = (u.result as { purpose?: string } | null)?.purpose;
      if (purpose !== "import") {
        return problem(c, 422, "import.wrong_purpose", "the upload was not created for import");
      }
      if (u.status === "rejected" || u.status === "quarantined") {
        return problem(c, 422, "import.upload_rejected");
      }
      if (u.status !== "ready") {
        return problem(c, 409, "import.upload_not_ready", "the upload is still being processed");
      }
      const taken = () =>
        problem(c, 409, "creation.taken", `@${ns.slug}/${body.name} already exists`);
      if (await nameTaken(db, ns.id, body.name)) return taken();

      const id = ids.uuid();
      let row: ImportRow | undefined;
      try {
        row = await db.transaction(async (tx) => {
          const [inserted] = await tx
            .insert(imports)
            .values({
              id,
              ownerUserId: uid,
              uploadId: u.id,
              namespaceId: ns.id,
              name: body.name,
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          await queue.enqueue(
            tx,
            QUEUE_NAMES.importCcv3,
            { import_id: id },
            { singletonKey: `import:${id}` },
          );
          await appendAudit(tx, {
            at: now,
            actor: auditActor(c.var.principal),
            action: "import.request",
            subject: `import:${id}`,
            requestId: requestIdOf(c),
            after: { ref: `@${ns.slug}/${body.name}`, upload: u.id },
          });
          return inserted;
        });
      } catch (e) {
        const constraint = uniqueViolation(e);
        if (constraint === null) throw e;
        if (constraint === "imports_upload_uq") {
          // 并发的重复提交：返回先提交成功的那个导入。
          const [winner] = await db
            .select()
            .from(imports)
            .where(eq(imports.uploadId, u.id))
            .limit(1);
          if (winner) return c.json(importStatusBody(winner));
        }
        return taken();
      }
      if (!row) throw new Error("import insert returned no row");
      return c.json(importStatusBody(row), 202);
    },
  });

  route(app, {
    method: "get",
    path: "/v1/imports/:id",
    authorize: async (c) => {
      const found = await loadImport(c);
      if (found instanceof Response) return found;
      return { action: "import.read", resource: found.resource, loaded: found.imp };
    },
    handler: async (c, { loaded: imp }) => {
      let report: ImportStatus["report"];
      if (imp.reportDigest) {
        const bytes = await c.var.services.cas.getBlob("private", imp.reportDigest);
        report = JSON.parse(new TextDecoder().decode(bytes)) as ImportStatus["report"];
      }
      c.header("cache-control", "private, no-store");
      return c.json(
        importStatusBody(imp, {
          creation: await creationRef(c, imp),
          ...(report ? { report } : {}),
        }),
      );
    },
  });

  route(app, {
    method: "post",
    path: "/v1/imports/:id/confirm",
    body: ConfirmImportRequestSchema,
    authorize: async (c) => {
      const found = await loadImport(c);
      if (found instanceof Response) return found;
      return { action: "import.confirm", resource: found.resource, loaded: found.imp };
    },
    handler: async (c, { body, loaded: imp }) => {
      const { db, clock } = c.var.services;
      const creationId = imp.creationId;
      if (imp.status !== "succeeded" || !creationId) {
        return problem(c, 409, "import.not_ready", "the import has not finished");
      }
      if (imp.confirmedAt) {
        return problem(c, 409, "import.already_confirmed", "edit the draft to change these values");
      }
      const uid = userIdOf(c.var.principal);
      const now = clock.now();
      const updated = await db.transaction(async (tx) => {
        const [draft] = await tx
          .select()
          .from(creationDrafts)
          .where(eq(creationDrafts.creationId, creationId))
          .limit(1)
          .for("update");
        if (!draft) return null;
        const working = draft.working as { meta?: Record<string, unknown> };
        await tx
          .update(creationDrafts)
          .set({
            working: {
              ...working,
              meta: {
                ...(working.meta ?? {}),
                rating: body.rating,
                rights: body.rights,
                license: body.license,
              },
            },
            version: draft.version + 1,
            updatedBy: uid,
            updatedAt: now,
          })
          .where(eq(creationDrafts.creationId, creationId));
        const [row] = await tx
          .update(imports)
          .set({ confirmedAt: now, updatedAt: now })
          .where(eq(imports.id, imp.id))
          .returning();
        await appendAudit(tx, {
          at: now,
          actor: auditActor(c.var.principal),
          action: "import.confirm",
          subject: `creation:${creationId}`,
          requestId: requestIdOf(c),
          after: { import: encodeId("import", imp.id), ...body },
        });
        return row ?? null;
      });
      if (!updated) return notFound(c);
      return c.json(importStatusBody(updated, { creation: await creationRef(c, updated) }));
    },
  });
}
