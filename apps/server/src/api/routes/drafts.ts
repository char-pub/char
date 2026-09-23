/**
 * 草稿与 Revision。
 *
 * 草稿是可变的工作副本，用整数 version 做乐观锁：保存时必须带 `If-Match: <version>`，
 * 与当前版本不符说明别人（或另一个标签页）已经改过，返回 409，不覆盖。
 * 保存时服务端会 canonicalize 并运行 `char check` 规则：有错误级诊断时拒绝保存，
 * 警告随响应返回。`id`、`ref`、`type` 总是由服务端填写。
 *
 * Revision 是草稿的不可变快照：内容写入私有对象存储，同样的内容只保留一个 Revision。
 */
import { CreateRevisionRequestSchema, PutDraftRequestSchema } from "@char-pub/contracts";
import {
  type CheckDiagnostic,
  canonicalizeCreation,
  checkCreation,
  isCharError,
} from "@char-pub/core";
import { and, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { appendAudit } from "../../audit/audit.js";
import { creationDrafts } from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { auditActor, param, requestIdOf, userIdOf } from "../../registry/context.js";
import { forceIdentity } from "../../registry/drafts.js";
import { encodeId } from "../../registry/ids.js";
import { type CreationContext, lookupCreation } from "../../registry/lookup.js";
import { createRevision } from "../../registry/publish.js";
import { type AppContext, type Env, notFound, route } from "../app.js";

/** `@ns` 与 name 两段路径参数；`@` 属于参数值的一部分。 */
export const CREATION_PATH = "/v1/creations/:ns{@[a-z0-9-]+}/:name";

/** 草稿请求体可以比普通 JSON 大（上限 5 MiB），在 API 组装时单独放宽。 */
export const DRAFT_PATH_RE = /^\/v1\/creations\/@[a-z0-9-]+\/[a-z0-9-]+\/draft$/;
export const MAX_DRAFT_BYTES = 5 * 1024 * 1024;

async function loadCreation(c: AppContext): Promise<CreationContext | null> {
  return lookupCreation(
    c.var.services.db,
    param(c, "ns").slice(1),
    param(c, "name"),
    c.var.principal,
  );
}

function identityOf(ctx: CreationContext) {
  return {
    id: encodeId("creation", ctx.creation.id),
    ref: `@${ctx.ns.slug}/${ctx.creation.name}`,
    type: ctx.creation.type,
  };
}

/** 解析 `If-Match`：接受 `3`、`"3"` 或 `W/"3"`。 */
export function parseIfMatch(header: string | undefined): number | null {
  if (!header) return null;
  const m = /^(?:W\/)?"?(\d{1,9})"?$/.exec(header.trim());
  return m?.[1] ? Number(m[1]) : null;
}

type Validated =
  | { ok: true; canonical: ReturnType<typeof canonicalizeCreation>; warnings: CheckDiagnostic[] }
  | { ok: false; response: Response };

/** canonicalize 并运行检查规则。 */
function validate(c: AppContext, working: unknown): Validated {
  let canonical: ReturnType<typeof canonicalizeCreation>;
  try {
    canonical = canonicalizeCreation(working);
  } catch (e) {
    if (!isCharError(e)) throw e;
    return {
      ok: false,
      response: problem(c, 422, e.code, e.detail, e.data ? { data: e.data } : {}),
    };
  }
  const result = checkCreation(canonical.creation);
  if (!result.ok) {
    return {
      ok: false,
      response: problem(c, 422, "check.failed", "the draft has errors", {
        diagnostics: result.diagnostics,
      }),
    };
  }
  return {
    ok: true,
    canonical,
    warnings: result.diagnostics.filter((d) => d.severity !== "info"),
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function register(app: Hono<Env>): void {
  route(app, {
    method: "get",
    path: `${CREATION_PATH}/draft`,
    authorize: async (c) => {
      const ctx = await loadCreation(c);
      if (!ctx) return notFound(c);
      return { action: "creation.read_draft", resource: ctx.resource, loaded: ctx };
    },
    handler: async (c, { loaded }) => {
      const [draft] = await c.var.services.db
        .select()
        .from(creationDrafts)
        .where(eq(creationDrafts.creationId, loaded.creation.id))
        .limit(1);
      if (!draft) return notFound(c);
      c.header("etag", `"${draft.version}"`);
      return c.json({
        version: draft.version,
        working: draft.working,
        base_revision_id: draft.baseRevisionId ? encodeId("revision", draft.baseRevisionId) : null,
        updated_at: draft.updatedAt.toISOString(),
      });
    },
  });

  route(app, {
    method: "put",
    path: `${CREATION_PATH}/draft`,
    body: PutDraftRequestSchema,
    authorize: async (c) => {
      const ctx = await loadCreation(c);
      if (!ctx) return notFound(c);
      return { action: "creation.edit", resource: ctx.resource, loaded: ctx };
    },
    handler: async (c, { body, loaded }) => {
      const { db, clock } = c.var.services;
      const expected = parseIfMatch(c.req.header("if-match"));
      if (expected === null) {
        return problem(c, 428, "draft.if_match_required", "send If-Match with the draft version");
      }
      if (!isObject(body.working)) {
        return problem(c, 422, "schema.invalid", "working must be an object");
      }
      const working = forceIdentity(body.working, identityOf(loaded));
      const v = validate(c, working);
      if (!v.ok) return v.response;
      const updated = await db.transaction(async (tx) => {
        const rows = await tx
          .update(creationDrafts)
          .set({
            working,
            version: expected + 1,
            updatedBy: userIdOf(c.var.principal),
            updatedAt: clock.now(),
          })
          .where(
            and(
              eq(creationDrafts.creationId, loaded.creation.id),
              eq(creationDrafts.version, expected),
            ),
          )
          .returning({ version: creationDrafts.version });
        if (rows.length === 0) return null;
        await appendAudit(tx, {
          at: clock.now(),
          actor: auditActor(c.var.principal),
          action: "draft.update",
          subject: `creation:${loaded.creation.id}`,
          requestId: requestIdOf(c),
          after: { version: expected + 1, semantic_digest: v.canonical.semantic_digest },
        });
        return rows[0];
      });
      if (!updated) {
        return problem(c, 409, "draft.version_conflict", "the draft was changed by someone else");
      }
      c.header("etag", `"${updated.version}"`);
      return c.json({
        version: updated.version,
        semantic_digest: v.canonical.semantic_digest,
        warnings: v.warnings,
      });
    },
  });

  route(app, {
    method: "post",
    path: `${CREATION_PATH}/revisions`,
    body: CreateRevisionRequestSchema,
    authorize: async (c) => {
      const ctx = await loadCreation(c);
      if (!ctx) return notFound(c);
      return { action: "creation.edit", resource: ctx.resource, loaded: ctx };
    },
    handler: async (c, { body, loaded }) => {
      const { db } = c.var.services;
      const creationId = loaded.creation.id;
      const [draft] = await db
        .select()
        .from(creationDrafts)
        .where(eq(creationDrafts.creationId, creationId))
        .limit(1);
      if (!draft) return notFound(c);
      const v = validate(
        c,
        forceIdentity(draft.working as Record<string, unknown>, identityOf(loaded)),
      );
      if (!v.ok) return v.response;

      const { row, created } = await createRevision(c.var.services, {
        creationId,
        canonical: v.canonical,
        parentId: draft.baseRevisionId,
        author: { kind: "user", userId: userIdOf(c.var.principal) },
        message: body.message ?? null,
        actor: auditActor(c.var.principal),
        requestId: requestIdOf(c),
        updateDraftBase: true,
      });
      return c.json(
        {
          id: encodeId("revision", row.id),
          semantic_digest: row.semanticDigest,
          ...(row.message ? { message: row.message } : {}),
          created_at: row.createdAt.toISOString(),
        },
        created ? 201 : 200,
      );
    },
  });
}
