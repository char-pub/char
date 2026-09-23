/**
 * 法律请求（DMCA、法院命令、GDPR 等）的登记、处置、反通知与案件导出，只有 legal 与 owner
 * 可以访问。
 *
 * 申请人信息是个人数据，在应用层用 AES-256-GCM 加密后存储：数据库或备份泄露时，
 * 没有密钥也读不到申请人是谁。每条记录使用随机的 12 字节 nonce，密文带认证标签，
 * 被篡改时解密失败。密钥来自环境变量 `LEGAL_ENCRYPTION_KEY`（32 字节，base64）。
 *
 * DMCA 流程：
 * 1. 登记请求。
 * 2. 停止访问：隐藏涉及的 Creation（可以恢复）。也可以对具体对象执行 tombstone，但 tombstone
 *    不可逆，之后收到反通知也无法恢复，所以 DMCA 默认用隐藏。
 * 3. 收到反通知：登记（申请人信息同样加密），并计算恢复期限。
 * 4. 投诉方如果告知已经起诉，登记之后就不能恢复；否则在恢复期限内恢复被隐藏的内容。
 */
import { asc, desc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { appendAudit } from "../../audit/audit.js";
import type { Executor } from "../../db/client.js";
import { legalRequests, moderationActions } from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { type AdminEnv, adminRoute } from "../app.js";
import { isUuid, staffActor } from "./common.js";

export type { EncryptedValue } from "../../moderation/legal-crypto.js";
export { decryptJson, encryptJson, parseLegalKey } from "../../moderation/legal-crypto.js";

import { decryptJson, type EncryptedValue, encryptJson } from "../../moderation/legal-crypto.js";

/** 界面展示的状态：把内部的细分状态归并为四种。 */
function uiStatus(s: typeof legalRequests.$inferSelect.status) {
  if (s === "actioned") return "actioned";
  if (s === "counter_noticed") return "counter_notice";
  if (s === "closed" || s === "rejected") return "closed";
  return "open";
}

export type LegalRow = typeof legalRequests.$inferSelect;

export function iso(d: Date | null): string | null {
  return d?.toISOString() ?? null;
}

/** 列表与详情共用的字段（不含申请人信息）。 */
export function legalSummary(r: LegalRow) {
  return {
    id: r.id,
    kind: r.kind,
    received_at: r.receivedAt.toISOString(),
    deadline: iso(r.deadline),
    status: uiStatus(r.status),
    subjects: r.subjects as string[],
    counter_notice_received_at: iso(r.counterNoticeReceivedAt),
    restore_not_before: iso(r.restoreNotBefore),
    restore_deadline: iso(r.restoreDeadline),
    court_action_at: iso(r.courtActionAt),
    restored_at: iso(r.restoredAt),
  };
}

/** 与这个法律请求关联的处置记录，按时间先后排列。 */
export async function linkedActions(db: Executor, id: string) {
  return db
    .select()
    .from(moderationActions)
    .where(eq(moderationActions.legalRequestId, id))
    .orderBy(asc(moderationActions.createdAt));
}

const CreateSchema = z.strictObject({
  kind: z.enum(["dmca", "court", "gdpr", "other"]),
  requester: z.strictObject({
    name: z.string().trim().min(1).max(300),
    email: z.email().optional(),
    organization: z.string().trim().max(300).optional(),
    address: z.string().trim().max(1000).optional(),
  }),
  received_at: z.iso.datetime({ offset: true }),
  deadline: z.iso.datetime({ offset: true }).optional(),
  /** 涉及的对象：URL、`@ns/name@label` 或内容 digest。 */
  subjects: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
  reason: z.string().trim().min(10).max(2000),
});

export function registerLegal(key: Uint8Array) {
  return (app: Hono<AdminEnv>): void => {
    adminRoute(app, {
      method: "get",
      path: "/v1/admin/legal-requests",
      capability: "legal.manage",
      handler: async (c) => {
        const rows = await c.var.services.db
          .select()
          .from(legalRequests)
          .orderBy(desc(legalRequests.receivedAt))
          .limit(100);
        // 列表不返回申请人信息，查看详情时才解密。
        return c.json({ items: rows.map(legalSummary) });
      },
    });

    adminRoute(app, {
      method: "get",
      path: "/v1/admin/legal-requests/:id",
      capability: "legal.manage",
      handler: async (c) => {
        const id = c.req.param("id");
        if (!isUuid(id)) return problem(c, 404, "not_found");
        const [r] = await c.var.services.db
          .select()
          .from(legalRequests)
          .where(eq(legalRequests.id, id));
        if (!r) return problem(c, 404, "not_found");
        // 每次查看申请人信息都留下审计记录。
        await c.var.services.db.transaction((tx) =>
          appendAudit(tx, {
            at: c.var.services.clock.now(),
            actor: staffActor(c),
            action: "legal.view",
            subject: `legal_request:${id}`,
            requestId: c.var.requestId,
          }),
        );
        const actions = await linkedActions(c.var.services.db, id);
        return c.json({
          ...legalSummary(r),
          requester: decryptJson(key, r.requester as EncryptedValue),
          counter_notice: r.counterNotice
            ? decryptJson(key, r.counterNotice as EncryptedValue)
            : null,
          actions: actions.map((a) => ({
            id: a.id,
            action: a.action,
            subject: a.subject,
            created_at: a.createdAt.toISOString(),
            reverted: a.revertedBy !== null,
          })),
        });
      },
    });

    adminRoute(app, {
      method: "post",
      path: "/v1/admin/legal-requests",
      capability: "legal.manage",
      noLegalRequest: true,
      body: CreateSchema,
      handler: async (c, { body }) => {
        const id = c.var.services.ids.uuid();
        const now = c.var.services.clock.now();
        await c.var.services.db.transaction(async (tx) => {
          await tx.insert(legalRequests).values({
            id,
            kind: body.kind,
            requester: encryptJson(key, body.requester),
            receivedAt: new Date(body.received_at),
            ...(body.deadline ? { deadline: new Date(body.deadline) } : {}),
            subjects: body.subjects,
            status: "received",
          });
          // 审计中不记录申请人信息。
          await appendAudit(tx, {
            at: now,
            actor: staffActor(c),
            action: "legal.register",
            subject: `legal_request:${id}`,
            requestId: c.var.requestId,
            after: { kind: body.kind, subjects: body.subjects, reason: body.reason },
          });
        });
        return c.json({ id }, 201);
      },
    });
  };
}
