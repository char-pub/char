/**
 * 发布：把一个 Revision 发布成 Release。
 *
 * 发布是异步的。请求在一个事务里完成三件事：占用 label（插入一个 publish_state 为
 * pending 的 Release）、在同一事务中把 publish 任务入队、写审计。worker 随后完成全部
 * 发布校验与构建；校验失败时把 Release 标记为 failed 并释放 label。pending 与 failed
 * 只是发布任务的状态，对外的 Release 状态始终只有 active / yanked / tombstoned。
 *
 * 幂等：
 * - 必须带 `Idempotency-Key`。同一个 key 重复请求返回同一个 Release；
 * - 同一个 label 已经指向相同内容时直接返回已有的 Release；指向不同内容则 409。
 */
import { PublishRequestSchema, type PublishResponse } from "@char-pub/contracts";
import { and, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { releases, revisions } from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { auditActor, param, requestIdOf, userIdOf } from "../../registry/context.js";
import { decodeId, encodeId } from "../../registry/ids.js";
import { lookupCreation } from "../../registry/lookup.js";
import {
  IDEMPOTENCY_KEY_RE,
  type ReleaseRow,
  type RequestPublishResult,
  requestPublish,
} from "../../registry/publish.js";
import { type AppContext, type Env, notFound, route } from "../app.js";
import { CREATION_PATH } from "./drafts.js";

function publishState(r: ReleaseRow): PublishResponse["state"] {
  if (r.publishState === "failed") return "failed";
  return r.publishState === "done" ? "active" : "pending";
}

export function publishResponse(r: ReleaseRow, idempotent: boolean): PublishResponse {
  const out: PublishResponse = {
    release: encodeId("release", r.id),
    state: publishState(r),
    idempotent,
  };
  const report = r.publishReport as PublishResponse["report"] | null;
  if (report) out.report = report;
  return out;
}

/** 把发布请求的结果转成 HTTP 响应。原生发布与 OIDC 发布共用。 */
export function publishResultResponse(
  c: AppContext,
  label: string,
  result: RequestPublishResult,
): Response {
  switch (result.kind) {
    case "created":
      return c.json(publishResponse(result.row, false), 202);
    case "same":
    case "idempotent":
      return c.json(publishResponse(result.row, true), 200);
    case "key_reused":
      return problem(
        c,
        422,
        "request.idempotency_key_reused",
        "this Idempotency-Key was used for a different publish request",
      );
    case "taken":
      return problem(
        c,
        409,
        "publish.label_taken",
        `${label} already points to different content; choose a new label`,
      );
  }
}

/** 读取并校验 `Idempotency-Key`；缺失或格式不对时返回错误响应。 */
export function idempotencyKeyOf(c: AppContext): string | Response {
  const key = c.req.header("idempotency-key");
  if (!key || !IDEMPOTENCY_KEY_RE.test(key)) {
    return problem(
      c,
      400,
      "request.idempotency_key_required",
      "publishing requires an Idempotency-Key header (8–200 visible ASCII characters)",
    );
  }
  return key;
}

async function loadCreation(c: AppContext) {
  return lookupCreation(
    c.var.services.db,
    param(c, "ns").slice(1),
    param(c, "name"),
    c.var.principal,
  );
}

export function register(app: Hono<Env>): void {
  route(app, {
    method: "post",
    path: `${CREATION_PATH}/releases`,
    body: PublishRequestSchema,
    authorize: async (c) => {
      const ctx = await loadCreation(c);
      if (!ctx) return notFound(c);
      return { action: "creation.publish", resource: ctx.resource, loaded: ctx };
    },
    handler: async (c, { body, loaded }) => {
      const { db } = c.var.services;
      const key = idempotencyKeyOf(c);
      if (key instanceof Response) return key;
      const creationId = loaded.creation.id;
      const revisionId = decodeId("revision", body.revision);
      const [revision] = revisionId
        ? await db
            .select()
            .from(revisions)
            .where(and(eq(revisions.id, revisionId), eq(revisions.creationId, creationId)))
            .limit(1)
        : [];
      if (!revision) return problem(c, 404, "revision.not_found");

      const result = await requestPublish(c.var.services, {
        creationId,
        revision,
        label: body.label,
        visibility: body.visibility,
        idempotencyKey: key,
        source: { provider: "native", revision: encodeId("revision", revision.id) },
        publishedBy: encodeId("user", userIdOf(c.var.principal)),
        actor: auditActor(c.var.principal),
        requestId: requestIdOf(c),
      });
      return publishResultResponse(c, body.label, result);
    },
  });

  route(app, {
    method: "get",
    path: `${CREATION_PATH}/releases/:label/report`,
    authorize: async (c) => {
      const ctx = await loadCreation(c);
      if (!ctx) return notFound(c);
      // 发布报告可能包含私有依赖的信息，只有能编辑草稿的人可以查看。
      return { action: "creation.read_draft", resource: ctx.resource, loaded: ctx };
    },
    handler: async (c, { loaded }) => {
      const rows = await c.var.services.db
        .select()
        .from(releases)
        .where(
          and(eq(releases.creationId, loaded.creation.id), eq(releases.label, param(c, "label"))),
        )
        .orderBy(releases.createdAt);
      // 失败的尝试会释放 label，同一个 label 可能有多次尝试；返回最近一次。
      const last = rows.at(-1);
      if (!last) return notFound(c);
      return c.json({ ...publishResponse(last, false), label: last.label });
    },
  });
}
