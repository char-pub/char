/**
 * 举报队列。公开 API 负责接收举报，这里只处理队列：列出、认领、处置。
 *
 * 处置动作（`POST /v1/admin/reports/:id/actions`）：
 * - dismiss：驳回；
 * - hide / force_rating / yank：对举报对象执行相应处置（对象必须是 Creation 或 Release），
 *   然后把举报标为 resolved；
 * - escalate：转交 trust_safety / legal，举报保持 claimed，并在审计中记录。
 *
 * 举报人的描述是用户内容，原样返回，由前端按纯文本显示。
 */
import { RATINGS } from "@char-pub/core";
import { and, asc, eq, gt, inArray, or, type SQL } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { appendAudit } from "../../audit/audit.js";
import { creations, namespaces, releases, reports } from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { type AdminContext, type AdminEnv, adminRoute } from "../app.js";
import { isUuid, parseId, recordAction, staffActor } from "./common.js";
import { forceRating, setCreationHidden, yankRelease } from "./content.js";

const SEVERITY: Record<string, "low" | "medium" | "high" | "critical"> = {
  sexual_minors: "critical",
  illegal: "high",
  copyright: "medium",
  harassment: "medium",
  rating: "low",
  spam: "low",
  other: "low",
};

type ReportRow = typeof reports.$inferSelect;

async function subjectLabel(c: AdminContext, r: ReportRow): Promise<string> {
  const db = c.var.services.db;
  if (r.subjectType === "creation") {
    const id = parseId("creation", r.subjectId);
    if (!id) return r.subjectId;
    const [row] = await db
      .select({ slug: namespaces.slug, name: creations.name })
      .from(creations)
      .innerJoin(namespaces, eq(namespaces.id, creations.namespaceId))
      .where(eq(creations.id, id));
    return row ? `@${row.slug}/${row.name}` : r.subjectId;
  }
  if (r.subjectType === "release") {
    const id = parseId("release", r.subjectId);
    if (!id) return r.subjectId;
    const [row] = await db
      .select({ slug: namespaces.slug, name: creations.name, label: releases.label })
      .from(releases)
      .innerJoin(creations, eq(creations.id, releases.creationId))
      .innerJoin(namespaces, eq(namespaces.id, creations.namespaceId))
      .where(eq(releases.id, id));
    return row ? `@${row.slug}/${row.name}@${row.label}` : r.subjectId;
  }
  return r.subjectId;
}

function reporterKind(reporter: unknown): "user" | "guest" | "anonymous" {
  const r = reporter as Record<string, unknown> | null;
  if (r && "user" in r) return "user";
  if (r && "guest" in r) return "guest";
  return "anonymous";
}

async function view(c: AdminContext, r: ReportRow) {
  const category = r.category in SEVERITY ? r.category : "other";
  return {
    id: r.id,
    category,
    severity: SEVERITY[category] ?? "low",
    subject: { type: r.subjectType, id: r.subjectId, label: await subjectLabel(c, r) },
    details: r.details ?? "",
    reporter: reporterKind(r.reporter),
    status: r.status,
    assignee: r.assignee,
    created_at: r.createdAt.toISOString(),
  };
}

const ActionSchema = z
  .strictObject({
    action: z.enum(["dismiss", "hide", "force_rating", "yank", "escalate"]),
    rating: z.enum(RATINGS).optional(),
    reason: z.string().trim().min(10).max(2000),
  })
  .refine((b) => b.action !== "force_rating" || b.rating !== undefined, {
    message: "rating is required for force_rating",
    path: ["rating"],
  });

const ListQuery = z.object({
  status: z.enum(["open", "claimed", "resolved", "dismissed", "active"]).default("active"),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export function registerReports(app: Hono<AdminEnv>): void {
  adminRoute(app, {
    method: "get",
    path: "/v1/admin/reports",
    capability: "overview.read",
    handler: async (c) => {
      const q = ListQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
      if (!q.success) return problem(c, 422, "request.invalid");
      const statuses =
        q.data.status === "active" ? (["open", "claimed"] as const) : ([q.data.status] as const);
      const conds: SQL[] = [inArray(reports.status, [...statuses])];
      if (q.data.cursor) {
        const [at, id] = q.data.cursor.split("|");
        if (at && id) {
          const d = new Date(at);
          const after = or(
            gt(reports.createdAt, d),
            and(eq(reports.createdAt, d), gt(reports.id, id)),
          );
          if (after) conds.push(after);
        }
      }
      const rows = await c.var.services.db
        .select()
        .from(reports)
        .where(and(...conds))
        .orderBy(asc(reports.createdAt), asc(reports.id))
        .limit(q.data.limit + 1);
      const page = rows.slice(0, q.data.limit);
      const last = page.at(-1);
      return c.json({
        items: await Promise.all(page.map((r) => view(c, r))),
        next_cursor:
          rows.length > q.data.limit && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
      });
    },
  });

  adminRoute(app, {
    method: "post",
    path: "/v1/admin/reports/:id/claim",
    capability: "reports.handle",
    body: z.strictObject({ reason: z.string().trim().min(10).max(2000) }),
    handler: async (c, { body }) => {
      const id = c.req.param("id");
      if (!isUuid(id)) return problem(c, 404, "not_found");
      const now = c.var.services.clock.now();
      const out = await c.var.services.db.transaction(async (tx) => {
        const [r] = await tx.select().from(reports).where(eq(reports.id, id)).for("update");
        if (!r) return 404 as const;
        if (r.status !== "open" && r.status !== "claimed") return 409 as const;
        await tx
          .update(reports)
          .set({ status: "claimed", assignee: c.var.staff.user_id, updatedAt: now })
          .where(eq(reports.id, id));
        await appendAudit(tx, {
          at: now,
          actor: staffActor(c),
          action: "report.claim",
          subject: `report:${id}`,
          requestId: c.var.requestId,
          before: { status: r.status, assignee: r.assignee },
          after: { status: "claimed", assignee: c.var.staff.user_id, reason: body.reason },
        });
        return 200 as const;
      });
      if (out === 404) return problem(c, 404, "not_found");
      if (out === 409) return problem(c, 409, "report.closed");
      return c.json({ ok: true });
    },
  });

  adminRoute(app, {
    method: "post",
    path: "/v1/admin/reports/:id/actions",
    capability: "reports.handle",
    body: ActionSchema,
    handler: async (c, { body }) => {
      const id = c.req.param("id");
      if (!isUuid(id)) return problem(c, 404, "not_found");
      const now = c.var.services.clock.now();
      const result = await c.var.services.db.transaction(async (tx) => {
        const [r] = await tx.select().from(reports).where(eq(reports.id, id)).for("update");
        if (!r) return { status: 404 as const, code: "not_found" };
        if (r.status === "resolved" || r.status === "dismissed") {
          return { status: 409 as const, code: "report.closed" };
        }
        if (body.action === "hide" || body.action === "force_rating") {
          if (r.subjectType !== "creation")
            return { status: 422 as const, code: "report.subject_not_creation" };
          const cid = parseId("creation", r.subjectId);
          if (!cid) return { status: 404 as const, code: "not_found" };
          const done =
            body.action === "hide"
              ? await setCreationHidden(tx, c, cid, true, body.reason)
              : await forceRating(tx, c, cid, body.rating ?? "general", body.reason);
          if (!done.ok) return { status: done.status, code: done.code };
        }
        if (body.action === "yank") {
          if (r.subjectType !== "release")
            return { status: 422 as const, code: "report.subject_not_release" };
          const rid = parseId("release", r.subjectId);
          if (!rid) return { status: 404 as const, code: "not_found" };
          const done = await yankRelease(tx, c, rid, body.reason);
          if (!done.ok) return { status: done.status, code: done.code };
        }
        const next =
          body.action === "dismiss"
            ? "dismissed"
            : body.action === "escalate"
              ? "claimed"
              : "resolved";
        await tx
          .update(reports)
          .set({ status: next, assignee: r.assignee ?? c.var.staff.user_id, updatedAt: now })
          .where(eq(reports.id, id));
        await recordAction(tx, c, {
          action: `report.${body.action}`,
          subject: { report: id, type: r.subjectType, id: r.subjectId },
          reason: body.reason,
          ...(body.rating ? { params: { rating: body.rating } } : {}),
        });
        await appendAudit(tx, {
          at: now,
          actor: staffActor(c),
          action: `report.${body.action}`,
          subject: `report:${id}`,
          requestId: c.var.requestId,
          before: { status: r.status },
          after: { status: next, reason: body.reason },
        });
        return { status: 200 as const, code: "" };
      });
      return result.status === 200 ? c.json({ ok: true }) : problem(c, result.status, result.code);
    },
  });
}
