/**
 * Creation 与 Release 的处置：查看、隐藏 / 恢复、强制调高评级、代作者 yank。
 *
 * - 隐藏：从搜索和作品页下线，但不删除内容，已锁定它的依赖方不受影响。
 * - 强制评级：Registry 层的覆盖，只能调高，不修改 Creation 本身，也不改变已发布
 *   Release 的 digest；读取与搜索中的 effective rating 取它与发布时的值中较高的一个。
 * - 代作者 yank：与作者自己 yank 的效果相同；tombstoned 的 Release 不能 yank。
 *
 * 每个写操作都在一个事务里同时写处置记录与审计日志。
 */
import { RATINGS, type Rating } from "@char-pub/core";
import { and, desc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { appendAudit } from "../../audit/audit.js";
import type { Tx } from "../../db/client.js";
import { creations, namespaces, releases } from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { effectiveRatingOf } from "../../registry/read.js";
import { type AdminContext, type AdminEnv, adminRoute } from "../app.js";
import { parseId, publicId, recordAction, staffActor } from "./common.js";

const Reason = z.string().trim().min(10).max(2000);

function plainText(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const first = Object.values(v as Record<string, unknown>).find((x) => typeof x === "string");
    return typeof first === "string" ? first : "";
  }
  return "";
}

async function loadCreation(c: AdminContext, id: string) {
  const [row] = await c.var.services.db
    .select({ c: creations, slug: namespaces.slug })
    .from(creations)
    .innerJoin(namespaces, eq(namespaces.id, creations.namespaceId))
    .where(eq(creations.id, id));
  return row;
}

async function creationView(c: AdminContext, id: string) {
  const row = await loadCreation(c, id);
  if (!row) return null;
  const rels = await c.var.services.db
    .select()
    .from(releases)
    .where(and(eq(releases.creationId, id), eq(releases.publishState, "done")))
    .orderBy(desc(releases.createdAt));
  const latest = rels.find((r) => r.status !== "tombstoned");
  return {
    id: publicId("creation", row.c.id),
    ref: `@${row.slug}/${row.c.name}`,
    type: row.c.type,
    display_name: plainText(row.c.displayName),
    summary: plainText(row.c.summary),
    rating: row.c.rating,
    effective_rating: effectiveRatingOf(
      latest?.effectiveRating ?? row.c.rating,
      row.c.forcedRating,
    ),
    forced_rating: row.c.forcedRating,
    status: row.c.status,
    releases: rels.map((r) => ({
      id: publicId("release", r.id),
      label: r.label,
      visibility: r.visibility,
      status: r.status,
    })),
  };
}

/** 设置隐藏状态。已被管理员冻结（suspended）的 Creation 不能通过这里恢复。 */
export async function setCreationHidden(
  tx: Tx,
  c: AdminContext,
  creationId: string,
  hidden: boolean,
  reason: string,
): Promise<{ ok: true } | { ok: false; status: 404 | 409; code: string }> {
  const [row] = await tx.select().from(creations).where(eq(creations.id, creationId)).for("update");
  if (!row) return { ok: false, status: 404, code: "not_found" };
  if (row.status === "suspended") return { ok: false, status: 409, code: "creation.suspended" };
  const next = hidden ? "hidden" : "active";
  const now = c.var.services.clock.now();
  await tx
    .update(creations)
    .set({ status: next, updatedAt: now })
    .where(eq(creations.id, creationId));
  await recordAction(tx, c, {
    action: hidden ? "creation.hide" : "creation.unhide",
    subject: { creation: creationId },
    reason,
  });
  await appendAudit(tx, {
    at: now,
    actor: staffActor(c),
    action: hidden ? "creation.hide" : "creation.unhide",
    subject: `creation:${creationId}`,
    requestId: c.var.requestId,
    before: { status: row.status },
    after: { status: next, reason },
  });
  return { ok: true };
}

/** 强制调高评级：新评级不能低于当前的 effective rating。 */
export async function forceRating(
  tx: Tx,
  c: AdminContext,
  creationId: string,
  rating: Rating,
  reason: string,
): Promise<{ ok: true } | { ok: false; status: 404 | 422; code: string }> {
  const [row] = await tx.select().from(creations).where(eq(creations.id, creationId)).for("update");
  if (!row) return { ok: false, status: 404, code: "not_found" };
  const [latest] = await tx
    .select({ r: releases.effectiveRating })
    .from(releases)
    .where(and(eq(releases.creationId, creationId), eq(releases.publishState, "done")))
    .orderBy(desc(releases.createdAt))
    .limit(1);
  const current = effectiveRatingOf(latest?.r ?? row.rating, row.forcedRating);
  if (RATINGS.indexOf(rating) < RATINGS.indexOf(current)) {
    return { ok: false, status: 422, code: "admin.rating_can_only_increase" };
  }
  const now = c.var.services.clock.now();
  await tx
    .update(creations)
    .set({ forcedRating: rating, updatedAt: now })
    .where(eq(creations.id, creationId));
  await recordAction(tx, c, {
    action: "creation.force_rating",
    subject: { creation: creationId },
    reason,
    params: { rating, previous: current },
  });
  await appendAudit(tx, {
    at: now,
    actor: staffActor(c),
    action: "creation.force_rating",
    subject: `creation:${creationId}`,
    requestId: c.var.requestId,
    before: { effective_rating: current, forced_rating: row.forcedRating },
    after: { forced_rating: rating, reason },
  });
  return { ok: true };
}

/** 代作者 yank 一个 Release。 */
export async function yankRelease(
  tx: Tx,
  c: AdminContext,
  releaseId: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; status: 404 | 409; code: string }> {
  const [r] = await tx.select().from(releases).where(eq(releases.id, releaseId)).for("update");
  if (!r) return { ok: false, status: 404, code: "not_found" };
  if (r.status === "tombstoned") return { ok: false, status: 409, code: "release.tombstoned" };
  if (r.status === "yanked") return { ok: true };
  const now = c.var.services.clock.now();
  await tx
    .update(releases)
    .set({ status: "yanked", statusReason: reason, updatedAt: now })
    .where(eq(releases.id, releaseId));
  await recordAction(tx, c, { action: "release.yank", subject: { release: releaseId }, reason });
  await appendAudit(tx, {
    at: now,
    actor: staffActor(c),
    action: "release.yank",
    subject: `release:${releaseId}`,
    requestId: c.var.requestId,
    before: { status: r.status },
    after: { status: "yanked", reason },
  });
  return { ok: true };
}

const VisibilitySchema = z.strictObject({ hidden: z.boolean(), reason: Reason });
const RatingSchema = z.strictObject({ rating: z.enum(RATINGS), reason: Reason });
const ReasonOnly = z.strictObject({ reason: Reason });

export function registerContent(app: Hono<AdminEnv>): void {
  adminRoute(app, {
    method: "get",
    path: "/v1/admin/creations/:ref{.+}",
    capability: "overview.read",
    handler: async (c) => {
      const raw = decodeURIComponent(c.req.param("ref") ?? "");
      let id = parseId("creation", raw);
      if (!id) {
        const m = /^@([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(raw);
        if (!m) return problem(c, 404, "not_found");
        const [row] = await c.var.services.db
          .select({ id: creations.id })
          .from(creations)
          .innerJoin(namespaces, eq(namespaces.id, creations.namespaceId))
          .where(and(eq(namespaces.slug, m[1] ?? ""), eq(creations.name, m[2] ?? "")));
        id = row?.id ?? null;
      }
      const view = id ? await creationView(c, id) : null;
      return view ? c.json(view) : problem(c, 404, "not_found");
    },
  });

  adminRoute(app, {
    method: "post",
    path: "/v1/admin/creations/:id/visibility",
    capability: "creations.hide",
    body: VisibilitySchema,
    handler: async (c, { body }) => {
      const id = parseId("creation", c.req.param("id"));
      if (!id) return problem(c, 404, "not_found");
      const r = await c.var.services.db.transaction((tx) =>
        setCreationHidden(tx, c, id, body.hidden, body.reason),
      );
      return r.ok ? c.json({ ok: true }) : problem(c, r.status, r.code);
    },
  });

  adminRoute(app, {
    method: "post",
    path: "/v1/admin/creations/:id/rating",
    capability: "reports.handle",
    body: RatingSchema,
    handler: async (c, { body }) => {
      const id = parseId("creation", c.req.param("id"));
      if (!id) return problem(c, 404, "not_found");
      const r = await c.var.services.db.transaction((tx) =>
        forceRating(tx, c, id, body.rating, body.reason),
      );
      return r.ok ? c.json({ ok: true }) : problem(c, r.status, r.code);
    },
  });

  adminRoute(app, {
    method: "post",
    path: "/v1/admin/releases/:id/yank",
    capability: "releases.yank",
    body: ReasonOnly,
    handler: async (c, { body }) => {
      const id = parseId("release", c.req.param("id"));
      if (!id) return problem(c, 404, "not_found");
      const r = await c.var.services.db.transaction((tx) => yankRelease(tx, c, id, body.reason));
      return r.ok ? c.json({ ok: true }) : problem(c, r.status, r.code);
    },
  });
}
