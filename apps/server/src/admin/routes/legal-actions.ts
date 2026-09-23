/**
 * 法律请求的处置：停止访问、登记反通知、登记投诉方起诉、恢复内容、导出案件记录。
 * 只有具备法律权限的员工（legal 与 owner）可以操作。
 *
 * - 停止访问：隐藏涉及的 Creation，并把处置记录关联到这个法律请求。隐藏可以恢复；
 *   tombstone 不可逆，即使之后收到有效的反通知也无法恢复。
 * - 反通知只适用于 DMCA 请求，而且必须先执行过处置。反通知的申请人信息与原申请人信息
 *   一样在应用层加密。
 * - 恢复：只恢复因这个法律请求而隐藏的 Creation；同一个 Creation 还因其他原因被隐藏时保持隐藏。
 * - 案件导出包含解密后的申请人信息，只有具备法律权限的员工能导出，每次导出写审计。
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { appendAudit } from "../../audit/audit.js";
import type { Tx } from "../../db/client.js";
import {
  auditLog,
  creations,
  legalRequests,
  moderationActions,
  namespaces,
} from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { type AdminEnv, adminRoute } from "../app.js";
import { isUuid, parseId, publicId, recordAction, staffActor } from "./common.js";
import { setCreationHidden } from "./content.js";
import {
  decryptJson,
  type EncryptedValue,
  encryptJson,
  iso,
  type LegalRow,
  legalSummary,
  linkedActions,
} from "./legal.js";

/**
 * 美国 DMCA 规定：收到有效的反通知后，要在 10 到 14 个工作日内恢复内容，除非投诉方在此之前
 * 告知已经起诉。这里按周一到周五计算（UTC），不维护节假日表：从第 12 个工作日开始才允许恢复，
 * 第 14 个工作日为最晚期限。任意连续 14 个工作日里最多有两个美国联邦假日（圣诞节与元旦），
 * 所以这个窗口无论如何都落在法定的 10～14 个工作日之内。
 */
export const RESTORE_NOT_BEFORE_WEEKDAYS = 12;
export const RESTORE_DEADLINE_WEEKDAYS = 14;

/** 从某一时刻起向后数 n 个工作日（周一到周五，UTC），保留原来的时刻。 */
export function addWeekdays(from: Date, n: number): Date {
  const d = new Date(from.getTime());
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) left--;
  }
  return d;
}

const Reason = z.string().trim().min(10).max(2000);

const DisableAccessSchema = z.strictObject({
  /** 要隐藏的 Creation：`cr_…`、UUID 或 `@ns/name`。 */
  creations: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
  reason: Reason,
});

const CounterNoticeSchema = z.strictObject({
  counter_notice: z.strictObject({
    name: z.string().trim().min(1).max(300),
    email: z.email().optional(),
    address: z.string().trim().min(1).max(1000),
    /** 反通知正文：包括善意声明与同意管辖的声明。 */
    statement: z.string().trim().min(1).max(10000),
  }),
  received_at: z.iso.datetime({ offset: true }),
  reason: Reason,
});

const ReasonOnly = z.strictObject({ reason: Reason });

/** 解析 Creation：TypeID、UUID 或 `@ns/name`。 */
async function resolveCreation(tx: Tx, raw: string): Promise<string | null> {
  const id = parseId("creation", raw);
  if (id) return id;
  const m = /^@([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(raw);
  if (!m) return null;
  const [row] = await tx
    .select({ id: creations.id })
    .from(creations)
    .innerJoin(namespaces, eq(namespaces.id, creations.namespaceId))
    .where(and(eq(namespaces.slug, m[1] ?? ""), eq(creations.name, m[2] ?? "")));
  return row?.id ?? null;
}

async function lockRequest(tx: Tx, id: string): Promise<LegalRow | undefined> {
  const [r] = await tx.select().from(legalRequests).where(eq(legalRequests.id, id)).for("update");
  return r;
}

/** 在事务内部中止处置，让整个事务回滚，再在事务外转换成 problem 响应。 */
class LegalAbort extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code);
  }
}

function subjectIs(creationId: string) {
  return sql`${moderationActions.subject} @> ${JSON.stringify({ creation: creationId })}::jsonb`;
}

export function registerLegalActions(key: Uint8Array) {
  return (app: Hono<AdminEnv>): void => {
    adminRoute(app, {
      method: "post",
      path: "/v1/admin/legal-requests/:id/disable-access",
      capability: "legal.manage",
      // 路径已经指明了法律请求，请求体里不需要再关联一次。
      noLegalRequest: true,
      body: DisableAccessSchema,
      handler: async (c, { body }) => {
        const id = c.req.param("id");
        if (!isUuid(id)) return problem(c, 404, "not_found");
        const now = c.var.services.clock.now();
        try {
          const hidden = await c.var.services.db.transaction(async (tx) => {
            const r = await lockRequest(tx, id);
            if (!r) throw new LegalAbort(404, "not_found");
            if (r.status === "closed" || r.status === "rejected") {
              throw new LegalAbort(409, "legal.closed");
            }
            const ids = new Set<string>();
            for (const raw of body.creations) {
              const cid = await resolveCreation(tx, raw);
              if (!cid) throw new LegalAbort(422, "legal.subject_not_found", raw);
              ids.add(cid);
            }
            // 要么全部隐藏，要么一个都不隐藏。
            for (const cid of ids) {
              const done = await setCreationHidden(tx, c, cid, true, body.reason, {
                legalRequestId: id,
              });
              if (!done.ok) {
                throw new LegalAbort(done.status, done.code, publicId("creation", cid));
              }
            }
            if (r.status === "received" || r.status === "reviewing") {
              await tx
                .update(legalRequests)
                .set({ status: "actioned", updatedAt: now })
                .where(eq(legalRequests.id, id));
            }
            await appendAudit(tx, {
              at: now,
              actor: staffActor(c),
              action: "legal.disable_access",
              subject: `legal_request:${id}`,
              requestId: c.var.requestId,
              after: {
                creations: [...ids].map((x) => publicId("creation", x)),
                reason: body.reason,
              },
            });
            return ids.size;
          });
          return c.json({ hidden });
        } catch (e) {
          if (e instanceof LegalAbort) return problem(c, e.status, e.code, e.detail);
          throw e;
        }
      },
    });

    adminRoute(app, {
      method: "post",
      path: "/v1/admin/legal-requests/:id/counter-notice",
      capability: "legal.manage",
      noLegalRequest: true,
      body: CounterNoticeSchema,
      handler: async (c, { body }) => {
        const id = c.req.param("id");
        if (!isUuid(id)) return problem(c, 404, "not_found");
        const now = c.var.services.clock.now();
        const received = new Date(body.received_at);
        if (received > now) return problem(c, 422, "legal.received_in_future");
        try {
          const window = await c.var.services.db.transaction(async (tx) => {
            const r = await lockRequest(tx, id);
            if (!r) throw new LegalAbort(404, "not_found");
            if (r.kind !== "dmca") throw new LegalAbort(422, "legal.counter_notice_dmca_only");
            if (r.status !== "actioned") throw new LegalAbort(409, "legal.not_actioned");
            const notBefore = addWeekdays(received, RESTORE_NOT_BEFORE_WEEKDAYS);
            const deadline = addWeekdays(received, RESTORE_DEADLINE_WEEKDAYS);
            await tx
              .update(legalRequests)
              .set({
                status: "counter_noticed",
                counterNotice: encryptJson(key, body.counter_notice),
                counterNoticeReceivedAt: received,
                restoreNotBefore: notBefore,
                restoreDeadline: deadline,
                updatedAt: now,
              })
              .where(eq(legalRequests.id, id));
            // 审计中不记录反通知申请人的信息。
            await appendAudit(tx, {
              at: now,
              actor: staffActor(c),
              action: "legal.counter_notice",
              subject: `legal_request:${id}`,
              requestId: c.var.requestId,
              after: {
                received_at: received.toISOString(),
                restore_not_before: notBefore.toISOString(),
                restore_deadline: deadline.toISOString(),
                reason: body.reason,
              },
            });
            return {
              restore_not_before: notBefore.toISOString(),
              restore_deadline: deadline.toISOString(),
            };
          });
          return c.json(window);
        } catch (e) {
          if (e instanceof LegalAbort) return problem(c, e.status, e.code, e.detail);
          throw e;
        }
      },
    });

    adminRoute(app, {
      method: "post",
      path: "/v1/admin/legal-requests/:id/court-action",
      capability: "legal.manage",
      noLegalRequest: true,
      body: ReasonOnly,
      handler: async (c, { body }) => {
        const id = c.req.param("id");
        if (!isUuid(id)) return problem(c, 404, "not_found");
        const now = c.var.services.clock.now();
        try {
          await c.var.services.db.transaction(async (tx) => {
            const r = await lockRequest(tx, id);
            if (!r) throw new LegalAbort(404, "not_found");
            if (r.status !== "counter_noticed")
              throw new LegalAbort(409, "legal.no_counter_notice");
            // 重复登记不产生新记录。
            if (r.courtActionAt) return;
            await tx
              .update(legalRequests)
              .set({ courtActionAt: now, updatedAt: now })
              .where(eq(legalRequests.id, id));
            await appendAudit(tx, {
              at: now,
              actor: staffActor(c),
              action: "legal.court_action",
              subject: `legal_request:${id}`,
              requestId: c.var.requestId,
              after: { reason: body.reason },
            });
          });
          return c.json({ ok: true });
        } catch (e) {
          if (e instanceof LegalAbort) return problem(c, e.status, e.code, e.detail);
          throw e;
        }
      },
    });

    adminRoute(app, {
      method: "post",
      path: "/v1/admin/legal-requests/:id/restore",
      capability: "legal.manage",
      noLegalRequest: true,
      body: ReasonOnly,
      handler: async (c, { body }) => {
        const id = c.req.param("id");
        if (!isUuid(id)) return problem(c, 404, "not_found");
        const now = c.var.services.clock.now();
        try {
          const out = await c.var.services.db.transaction(async (tx) => {
            const r = await lockRequest(tx, id);
            if (!r) throw new LegalAbort(404, "not_found");
            if (r.status !== "counter_noticed")
              throw new LegalAbort(409, "legal.no_counter_notice");
            if (r.courtActionAt) throw new LegalAbort(409, "legal.court_action_filed");
            if (!r.restoreNotBefore || now < r.restoreNotBefore) {
              throw new LegalAbort(
                409,
                "legal.restore_window_not_open",
                `restore is allowed from ${iso(r.restoreNotBefore)}`,
              );
            }
            const actions = await linkedActions(tx, id);
            const restoreId = await recordAction(tx, c, {
              action: "legal.restore",
              subject: { legal_request: id },
              reason: body.reason,
              legalRequestId: id,
            });
            const hiddenHere = new Set(
              actions
                .filter((a) => a.action === "creation.hide" && a.revertedBy === null)
                .map((a) => (a.subject as { creation: string }).creation),
            );
            const restored: string[] = [];
            const keptHidden: string[] = [];
            for (const cid of hiddenHere) {
              const [other] = await tx
                .select({ id: moderationActions.id })
                .from(moderationActions)
                .where(
                  and(
                    eq(moderationActions.action, "creation.hide"),
                    isNull(moderationActions.revertedBy),
                    subjectIs(cid),
                    sql`${moderationActions.legalRequestId} IS DISTINCT FROM ${id}`,
                  ),
                )
                .limit(1);
              if (other) {
                // 还有其他原因的隐藏：这个法律请求的隐藏记录标记为已撤销，Creation 保持隐藏。
                await tx
                  .update(moderationActions)
                  .set({ revertedBy: restoreId })
                  .where(
                    and(
                      eq(moderationActions.legalRequestId, id),
                      eq(moderationActions.action, "creation.hide"),
                      subjectIs(cid),
                    ),
                  );
                keptHidden.push(publicId("creation", cid));
                continue;
              }
              const done = await setCreationHidden(tx, c, cid, false, body.reason, {
                legalRequestId: id,
              });
              if (done.ok) restored.push(publicId("creation", cid));
              else keptHidden.push(publicId("creation", cid));
            }
            const notRestorable = actions.filter((a) => a.action === "tombstone").length;
            const late = r.restoreDeadline !== null && now > r.restoreDeadline;
            await tx
              .update(legalRequests)
              .set({ status: "closed", restoredAt: now, updatedAt: now })
              .where(eq(legalRequests.id, id));
            await appendAudit(tx, {
              at: now,
              actor: staffActor(c),
              action: "legal.restore",
              subject: `legal_request:${id}`,
              requestId: c.var.requestId,
              after: {
                restored,
                kept_hidden: keptHidden,
                not_restorable: notRestorable,
                late,
                reason: body.reason,
              },
            });
            return { restored, kept_hidden: keptHidden, not_restorable: notRestorable, late };
          });
          return c.json(out);
        } catch (e) {
          if (e instanceof LegalAbort) return problem(c, e.status, e.code, e.detail);
          throw e;
        }
      },
    });

    adminRoute(app, {
      method: "post",
      path: "/v1/admin/legal-requests/:id/export",
      capability: "legal.manage",
      noLegalRequest: true,
      body: ReasonOnly,
      handler: async (c, { body }) => {
        const id = c.req.param("id");
        if (!isUuid(id)) return problem(c, 404, "not_found");
        const now = c.var.services.clock.now();
        const record = await c.var.services.db.transaction(async (tx) => {
          const [r] = await tx.select().from(legalRequests).where(eq(legalRequests.id, id));
          if (!r) return null;
          const actions = await linkedActions(tx, id);
          const trail = await tx
            .select()
            .from(auditLog)
            .where(eq(auditLog.subject, `legal_request:${id}`))
            .orderBy(asc(auditLog.id));
          // 导出本身也写审计；它写在读取之后，所以不出现在这次导出的内容里。
          await appendAudit(tx, {
            at: now,
            actor: staffActor(c),
            action: "legal.export",
            subject: `legal_request:${id}`,
            requestId: c.var.requestId,
            after: { reason: body.reason, actions: actions.length, audit_entries: trail.length },
          });
          return {
            format: "char-pub.legal-case/1",
            exported_at: now.toISOString(),
            exported_by: c.var.staff.email,
            request: {
              ...legalSummary(r),
              requester: decryptJson(key, r.requester as EncryptedValue),
              counter_notice: r.counterNotice
                ? decryptJson(key, r.counterNotice as EncryptedValue)
                : null,
            },
            actions: actions.map((a) => ({
              id: a.id,
              action: a.action,
              actor: publicId("user", a.actorId),
              subject: a.subject,
              reason: a.reason,
              params: a.params,
              created_at: a.createdAt.toISOString(),
              reverted_by: a.revertedBy,
            })),
            audit: trail.map((e) => ({
              id: e.id.toString(),
              at: e.at.toISOString(),
              actor: e.actor,
              action: e.action,
              before: e.before,
              after: e.after,
              hash: e.hash,
            })),
          };
        });
        if (!record) return problem(c, 404, "not_found");
        return new Response(JSON.stringify(record, null, 2), {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "content-disposition": `attachment; filename="legal-request-${id}.json"`,
            "cache-control": "no-store",
          },
        });
      },
    });
  };
}
