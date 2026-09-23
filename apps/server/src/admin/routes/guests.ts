/**
 * 访客管理：查看、停用与恢复经验证的访客。
 *
 * - 库里没有访客的明文邮箱（只有 HMAC），这里也不返回任何邮箱相关的信息。
 * - 停用在一个事务中标记 `disabled_at`、删除该访客的全部会话、写处置记录与审计，
 *   访客的下一个请求就不再带有访客身份。重新验证同一个邮箱不会解除停用。
 * - 停用与恢复需要与封禁用户相同的能力。
 */
import {
  and,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
} from "drizzle-orm";
import type { Hono } from "hono";
import { TypeID } from "typeid-js";
import { z } from "zod";
import { appendAudit } from "../../audit/audit.js";
import { newGuestId } from "../../auth/guest.js";
import { contributions, guestSessions, guests } from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { type AdminContext, type AdminEnv, adminRoute } from "../app.js";
import { isUuid, recordAction, staffActor } from "./common.js";

type GuestRow = typeof guests.$inferSelect;

/** 解析路径中的访客 ID：`gst_…`，或者直接给出的 UUID。非法时返回 null。 */
export function parseGuestId(raw: string | undefined): string | null {
  if (!raw) return null;
  if (isUuid(raw)) return newGuestId(raw);
  try {
    const id = TypeID.fromString(raw, "gst");
    return id.toString();
  } catch {
    return null;
  }
}

async function views(c: AdminContext, rows: readonly GuestRow[]) {
  const ids = rows.map((g) => g.guestId);
  const db = c.var.services.db;
  const now = c.var.services.clock.now();
  const sessions =
    ids.length === 0
      ? []
      : await db
          .select({ id: guestSessions.guestId, n: count() })
          .from(guestSessions)
          .where(and(inArray(guestSessions.guestId, ids), gt(guestSessions.expiresAt, now)))
          .groupBy(guestSessions.guestId);
  const contribs =
    ids.length === 0
      ? []
      : await db
          .select({ id: contributions.authorGuestId, n: count() })
          .from(contributions)
          .where(inArray(contributions.authorGuestId, ids))
          .groupBy(contributions.authorGuestId);
  const sessionCount = new Map(sessions.map((s) => [s.id, s.n]));
  const contribCount = new Map(contribs.map((s) => [s.id, s.n]));
  return rows.map((g) => ({
    id: g.guestId,
    display_name: g.displayName,
    verified_at: g.verifiedAt?.toISOString() ?? null,
    verification_kind: g.verificationKind,
    disabled: g.disabledAt !== null,
    disabled_at: g.disabledAt?.toISOString() ?? null,
    sessions: sessionCount.get(g.guestId) ?? 0,
    contributions: contribCount.get(g.guestId) ?? 0,
    created_at: g.createdAt.toISOString(),
  }));
}

const ListQuery = z.object({
  status: z.enum(["all", "active", "disabled"]).default("all"),
  query: z.string().trim().max(200).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** 翻页位置：上一页最后一行的创建时间与访客 ID。 */
function parseCursor(raw: string): { at: Date; id: string } | null {
  const [at, id] = raw.split("|");
  if (!at || !id) return null;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  const guestId = parseGuestId(id);
  return guestId ? { at: d, id: guestId } : null;
}

const ReasonOnly = z.strictObject({ reason: z.string().trim().min(10).max(2000) });

export function registerGuests(app: Hono<AdminEnv>): void {
  adminRoute(app, {
    method: "get",
    path: "/v1/admin/guests",
    capability: "overview.read",
    handler: async (c) => {
      const q = ListQuery.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
      if (!q.success) return problem(c, 422, "request.invalid");
      const conds: SQL[] = [];
      if (q.data.status === "active") conds.push(isNull(guests.disabledAt));
      if (q.data.status === "disabled") conds.push(isNotNull(guests.disabledAt));
      if (q.data.query) {
        conds.push(ilike(guests.displayName, `%${q.data.query.replace(/[%_\\]/g, "\\$&")}%`));
      }
      if (q.data.cursor) {
        const cur = parseCursor(q.data.cursor);
        if (!cur) return problem(c, 422, "request.invalid");
        const before = or(
          lt(guests.createdAt, cur.at),
          and(eq(guests.createdAt, cur.at), lt(guests.guestId, cur.id)),
        );
        if (before) conds.push(before);
      }
      const rows = await c.var.services.db
        .select()
        .from(guests)
        .where(conds.length > 0 ? and(...conds) : undefined)
        .orderBy(desc(guests.createdAt), desc(guests.guestId))
        .limit(q.data.limit + 1);
      const page = rows.slice(0, q.data.limit);
      const last = page.at(-1);
      return c.json({
        items: await views(c, page),
        next_cursor:
          rows.length > q.data.limit && last
            ? `${last.createdAt.toISOString()}|${last.guestId}`
            : null,
      });
    },
  });

  adminRoute(app, {
    method: "get",
    path: "/v1/admin/guests/:id",
    capability: "overview.read",
    handler: async (c) => {
      const id = parseGuestId(c.req.param("id"));
      if (!id) return problem(c, 404, "not_found");
      const [g] = await c.var.services.db.select().from(guests).where(eq(guests.guestId, id));
      if (!g) return problem(c, 404, "not_found");
      const [view] = await views(c, [g]);
      return c.json(view);
    },
  });

  adminRoute(app, {
    method: "post",
    path: "/v1/admin/guests/:id/disable",
    capability: "users.ban",
    body: ReasonOnly,
    handler: async (c, { body }) => {
      const id = parseGuestId(c.req.param("id"));
      if (!id) return problem(c, 404, "not_found");
      const now = c.var.services.clock.now();
      const out = await c.var.services.db.transaction(async (tx) => {
        const [g] = await tx.select().from(guests).where(eq(guests.guestId, id)).for("update");
        if (!g) return null;
        const revoked = await tx
          .delete(guestSessions)
          .where(eq(guestSessions.guestId, id))
          .returning({ id: guestSessions.id });
        // 已经停用且没有残留会话时什么也不改，也不重复记审计。
        if (g.disabledAt && revoked.length === 0) {
          return { sessionsRevoked: 0, alreadyDisabled: true };
        }
        if (!g.disabledAt) {
          await tx.update(guests).set({ disabledAt: now }).where(eq(guests.guestId, id));
        }
        await recordAction(tx, c, {
          action: "guest.disable",
          subject: { guest: id },
          reason: body.reason,
        });
        await appendAudit(tx, {
          at: now,
          actor: staffActor(c),
          action: "guest.disable",
          subject: `guest:${id}`,
          requestId: c.var.requestId,
          before: { disabled_at: g.disabledAt?.toISOString() ?? null },
          after: {
            disabled_at: (g.disabledAt ?? now).toISOString(),
            sessions_revoked: revoked.length,
            reason: body.reason,
          },
        });
        return { sessionsRevoked: revoked.length, alreadyDisabled: g.disabledAt !== null };
      });
      if (!out) return problem(c, 404, "not_found");
      return c.json({
        ok: true,
        already_disabled: out.alreadyDisabled,
        sessions_revoked: out.sessionsRevoked,
      });
    },
  });

  adminRoute(app, {
    method: "post",
    path: "/v1/admin/guests/:id/enable",
    capability: "users.ban",
    body: ReasonOnly,
    handler: async (c, { body }) => {
      const id = parseGuestId(c.req.param("id"));
      if (!id) return problem(c, 404, "not_found");
      const now = c.var.services.clock.now();
      const out = await c.var.services.db.transaction(async (tx) => {
        const [g] = await tx.select().from(guests).where(eq(guests.guestId, id)).for("update");
        if (!g) return null;
        if (!g.disabledAt) return { changed: false };
        await tx.update(guests).set({ disabledAt: null }).where(eq(guests.guestId, id));
        await recordAction(tx, c, {
          action: "guest.enable",
          subject: { guest: id },
          reason: body.reason,
        });
        await appendAudit(tx, {
          at: now,
          actor: staffActor(c),
          action: "guest.enable",
          subject: `guest:${id}`,
          requestId: c.var.requestId,
          before: { disabled_at: g.disabledAt.toISOString() },
          after: { disabled_at: null, reason: body.reason },
        });
        return { changed: true };
      });
      if (!out) return problem(c, 404, "not_found");
      return c.json({ ok: true, changed: out.changed });
    },
  });
}
