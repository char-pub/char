/**
 * Namespace 治理：保留名、冻结 / 恢复、改名仲裁。
 *
 * - 保留名（如 `commons`、`admin`、品牌名）不能被注册；删除保留名不会释放已经被占用的名字。
 * - 冻结后该 namespace 下的内容对公众不可见，成员也不能再编辑或发布。
 * - 改名：旧名写入重定向表并永久占用，不能被任何人重新注册，旧链接跳转到新名字。
 * - 转让：把 namespace 的 owner 换成另一个用户，必须由第二名员工确认后才执行。原 owner
 *   失去这个 namespace 的全部权限（个人 Token 的权限也随之失去，因为权限来自成员关系），
 *   其他成员不变。个人 namespace 的接收方不能已经拥有个人 namespace。
 */
import { CharError, NAMESPACE_RE } from "@char-pub/core";
import { and, eq, ilike, inArray } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { appendAudit } from "../../audit/audit.js";
import type { Tx } from "../../db/client.js";
import {
  authUser,
  creations,
  namespaceMembers,
  namespaceRedirects,
  namespaces,
  reservedNames,
  staffApprovals,
} from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { MAX_USER_NAMESPACES, ownedUserNamespaces } from "../../registry/namespaces.js";
import { refreshSearchColumns } from "../../registry/search.js";
import { type AdminContext, type AdminEnv, adminRoute } from "../app.js";
import { createApproval } from "../approvals.js";
import { parseId, publicId, recordAction, staffActor } from "./common.js";

const Slug = z.string().regex(NAMESPACE_RE);
const Reason = z.string().trim().min(10).max(2000);

const TransferSchema = z.strictObject({
  /** 接收方：用户 ID（`usr_…` 或 UUID）或邮箱。 */
  to: z.string().trim().min(1).max(320),
  reason: Reason,
});

/** 四眼请求中保存的转让参数。 */
export interface TransferPayload {
  namespace_id: string;
  slug: string;
  from_user_ids: string[];
  to_user_id: string;
}

type TransferCheck =
  | { ok: true; owners: string[]; slug: string; kind: "user" | "org" | "system" }
  | { ok: false; status: 404 | 409 | 422; code: string };

async function resolveUser(tx: Tx, to: string): Promise<typeof authUser.$inferSelect | undefined> {
  if (to.includes("@")) {
    const [u] = await tx.select().from(authUser).where(eq(authUser.email, to.toLowerCase()));
    return u;
  }
  const id = parseId("user", to);
  if (!id) return undefined;
  const [u] = await tx.select().from(authUser).where(eq(authUser.id, id));
  return u;
}

/** 发起与执行转让时都要做的检查：namespace 可以转让，接收方存在、未被封禁、名额未满。 */
async function checkTransfer(
  tx: Tx,
  namespaceId: string,
  toUserId: string,
): Promise<TransferCheck> {
  const [n] = await tx
    .select()
    .from(namespaces)
    .where(eq(namespaces.id, namespaceId))
    .for("update");
  if (!n) return { ok: false, status: 404, code: "not_found" };
  if (n.kind === "system") return { ok: false, status: 422, code: "namespace.not_transferable" };
  const [target] = await tx.select().from(authUser).where(eq(authUser.id, toUserId));
  if (!target) return { ok: false, status: 422, code: "namespace.transfer_target_not_found" };
  if (target.banned) return { ok: false, status: 422, code: "namespace.transfer_target_banned" };
  const owners = (
    await tx
      .select({ userId: namespaceMembers.userId })
      .from(namespaceMembers)
      .where(and(eq(namespaceMembers.namespaceId, n.id), eq(namespaceMembers.role, "owner")))
  )
    .map((r) => r.userId)
    .sort();
  if (owners.includes(toUserId)) return { ok: false, status: 422, code: "namespace.same_owner" };
  if (n.kind === "user" && (await ownedUserNamespaces(tx, toUserId)) >= MAX_USER_NAMESPACES) {
    return { ok: false, status: 409, code: "namespace.limit" };
  }
  return { ok: true, owners, slug: n.slug, kind: n.kind };
}

/**
 * 执行转让（第二名员工确认之后）。发起之后 owner 已经变化时拒绝执行，
 * 避免按过期的判断把 namespace 交出去；这时请求保持待确认，可以取消后重新发起。
 */
export async function executeNamespaceTransfer(
  tx: Tx,
  c: AdminContext,
  payload: TransferPayload,
  reason: string,
): Promise<void> {
  const check = await checkTransfer(tx, payload.namespace_id, payload.to_user_id);
  if (!check.ok) throw new CharError({ code: check.code, subject: payload.slug });
  if (check.owners.join(",") !== [...payload.from_user_ids].sort().join(",")) {
    throw new CharError({ code: "approval.stale", subject: payload.slug });
  }
  const now = c.var.services.clock.now();
  await tx
    .delete(namespaceMembers)
    .where(
      and(
        eq(namespaceMembers.namespaceId, payload.namespace_id),
        eq(namespaceMembers.role, "owner"),
      ),
    );
  await tx
    .insert(namespaceMembers)
    .values({ namespaceId: payload.namespace_id, userId: payload.to_user_id, role: "owner" })
    .onConflictDoUpdate({
      target: [namespaceMembers.namespaceId, namespaceMembers.userId],
      set: { role: "owner" },
    });
  await recordAction(tx, c, {
    action: "namespace.transfer",
    subject: { namespace: payload.namespace_id },
    reason,
    params: { from: payload.from_user_ids, to: payload.to_user_id },
  });
  await appendAudit(tx, {
    at: now,
    actor: staffActor(c),
    action: "namespace.transfer",
    subject: `namespace:${payload.namespace_id}`,
    requestId: c.var.requestId,
    before: { owners: payload.from_user_ids },
    after: { owners: [payload.to_user_id], reason },
  });
}

export function registerNamespaces(app: Hono<AdminEnv>): void {
  adminRoute(app, {
    method: "get",
    path: "/v1/admin/namespaces",
    capability: "overview.read",
    handler: async (c) => {
      const db = c.var.services.db;
      const q = (new URL(c.req.url).searchParams.get("query") ?? "").trim().slice(0, 40);
      const rows = await db
        .select()
        .from(namespaces)
        .where(q ? ilike(namespaces.slug, `%${q.replace(/[%_\\]/g, "\\$&")}%`) : undefined)
        .limit(50);
      const ids = rows.map((r) => r.id);
      const owners =
        ids.length === 0
          ? []
          : await db
              .select({ ns: namespaceMembers.namespaceId, email: authUser.email })
              .from(namespaceMembers)
              .innerJoin(authUser, eq(authUser.id, namespaceMembers.userId))
              .where(inArray(namespaceMembers.namespaceId, ids));
      const redirects =
        ids.length === 0
          ? []
          : await db
              .select()
              .from(namespaceRedirects)
              .where(inArray(namespaceRedirects.namespaceId, ids));
      return c.json({
        items: rows.map((n) => ({
          slug: n.slug,
          kind: n.kind,
          status: n.status,
          owner: owners.find((o) => o.ns === n.id)?.email ?? null,
          redirects: redirects
            .filter((r) => r.namespaceId === n.id)
            .map((r) => r.oldSlug)
            .sort(),
        })),
      });
    },
  });

  adminRoute(app, {
    method: "get",
    path: "/v1/admin/reserved-names",
    capability: "overview.read",
    handler: async (c) => {
      const rows = await c.var.services.db.select().from(reservedNames).orderBy(reservedNames.slug);
      return c.json({ items: rows.map((r) => ({ slug: r.slug, reason: r.reason })) });
    },
  });

  adminRoute(app, {
    method: "post",
    path: "/v1/admin/reserved-names",
    capability: "namespaces.govern",
    body: z.strictObject({ slug: Slug, reason: Reason }),
    handler: async (c, { body }) => {
      const now = c.var.services.clock.now();
      await c.var.services.db.transaction(async (tx) => {
        await tx
          .insert(reservedNames)
          .values({ slug: body.slug, reason: body.reason, createdBy: c.var.staff.user_id })
          .onConflictDoUpdate({ target: reservedNames.slug, set: { reason: body.reason } });
        await appendAudit(tx, {
          at: now,
          actor: staffActor(c),
          action: "namespace.reserve",
          subject: `namespace:${body.slug}`,
          requestId: c.var.requestId,
          after: { reason: body.reason },
        });
      });
      return c.json({ ok: true }, 201);
    },
  });

  adminRoute(app, {
    method: "delete",
    path: "/v1/admin/reserved-names/:slug",
    capability: "namespaces.govern",
    body: z.strictObject({ reason: Reason }),
    handler: async (c, { body }) => {
      const slug = c.req.param("slug") ?? "";
      const now = c.var.services.clock.now();
      const deleted = await c.var.services.db.transaction(async (tx) => {
        const rows = await tx.delete(reservedNames).where(eq(reservedNames.slug, slug)).returning();
        if (rows.length === 0) return false;
        await appendAudit(tx, {
          at: now,
          actor: staffActor(c),
          action: "namespace.unreserve",
          subject: `namespace:${slug}`,
          requestId: c.var.requestId,
          before: { reason: rows[0]?.reason },
          after: { reason: body.reason },
        });
        return true;
      });
      return deleted ? c.json({ ok: true }) : problem(c, 404, "not_found");
    },
  });

  adminRoute(app, {
    method: "post",
    path: "/v1/admin/namespaces/:slug/status",
    capability: "namespaces.govern",
    body: z.strictObject({ status: z.enum(["active", "suspended"]), reason: Reason }),
    handler: async (c, { body }) => {
      const slug = c.req.param("slug") ?? "";
      const now = c.var.services.clock.now();
      const found = await c.var.services.db.transaction(async (tx) => {
        const [n] = await tx
          .select()
          .from(namespaces)
          .where(eq(namespaces.slug, slug))
          .for("update");
        if (!n) return false;
        await tx
          .update(namespaces)
          .set({ status: body.status, updatedAt: now })
          .where(eq(namespaces.id, n.id));
        await recordAction(tx, c, {
          action: body.status === "suspended" ? "namespace.suspend" : "namespace.unsuspend",
          subject: { namespace: n.id },
          reason: body.reason,
        });
        await appendAudit(tx, {
          at: now,
          actor: staffActor(c),
          action: body.status === "suspended" ? "namespace.suspend" : "namespace.unsuspend",
          subject: `namespace:${slug}`,
          requestId: c.var.requestId,
          before: { status: n.status },
          after: { status: body.status, reason: body.reason },
        });
        return true;
      });
      return found ? c.json({ ok: true }) : problem(c, 404, "not_found");
    },
  });

  adminRoute(app, {
    method: "post",
    path: "/v1/admin/namespaces/:slug/rename",
    capability: "namespaces.govern",
    body: z.strictObject({ new_slug: Slug, reason: Reason }),
    handler: async (c, { body }) => {
      const slug = c.req.param("slug") ?? "";
      const now = c.var.services.clock.now();
      const out = await c.var.services.db.transaction(async (tx) => {
        const [n] = await tx
          .select()
          .from(namespaces)
          .where(eq(namespaces.slug, slug))
          .for("update");
        if (!n) return { status: 404 as const, code: "not_found" };
        if (body.new_slug === slug) return { status: 422 as const, code: "namespace.same_name" };
        const [taken] = await tx
          .select({ id: namespaces.id })
          .from(namespaces)
          .where(eq(namespaces.slug, body.new_slug));
        const [redirected] = await tx
          .select({ ns: namespaceRedirects.namespaceId })
          .from(namespaceRedirects)
          .where(eq(namespaceRedirects.oldSlug, body.new_slug));
        // 允许改回这个 namespace 自己以前用过的名字；别人的旧名永久占用。
        if (taken || (redirected && redirected.ns !== n.id)) {
          return { status: 409 as const, code: "namespace.taken" };
        }
        if (redirected) {
          await tx.delete(namespaceRedirects).where(eq(namespaceRedirects.oldSlug, body.new_slug));
        }
        await tx
          .update(namespaces)
          .set({ slug: body.new_slug, updatedAt: now })
          .where(eq(namespaces.id, n.id));
        // 搜索文本包含 `@namespace/name`，改名后在同一事务内刷新这个 namespace 下的全部 Creation。
        const owned = await tx
          .select({ id: creations.id })
          .from(creations)
          .where(eq(creations.namespaceId, n.id));
        for (const cr of owned) await refreshSearchColumns(tx, cr.id);
        await tx
          .insert(namespaceRedirects)
          .values({ oldSlug: slug, namespaceId: n.id, createdAt: now })
          .onConflictDoNothing();
        await recordAction(tx, c, {
          action: "namespace.rename",
          subject: { namespace: n.id },
          reason: body.reason,
          params: { from: slug, to: body.new_slug },
        });
        await appendAudit(tx, {
          at: now,
          actor: staffActor(c),
          action: "namespace.rename",
          subject: `namespace:${n.id}`,
          requestId: c.var.requestId,
          before: { slug },
          after: { slug: body.new_slug, reason: body.reason },
        });
        return { status: 200 as const, code: "" };
      });
      return out.status === 200 ? c.json({ ok: true }) : problem(c, out.status, out.code);
    },
  });

  adminRoute(app, {
    method: "post",
    path: "/v1/admin/namespaces/:slug/transfer",
    capability: "namespaces.govern",
    body: TransferSchema,
    handler: async (c, { body }) => {
      const slug = c.req.param("slug") ?? "";
      const now = c.var.services.clock.now();
      return c.var.services.db.transaction(async (tx) => {
        const [n] = await tx.select().from(namespaces).where(eq(namespaces.slug, slug));
        if (!n) return problem(c, 404, "not_found");
        const target = await resolveUser(tx, body.to);
        if (!target) return problem(c, 422, "namespace.transfer_target_not_found");
        const check = await checkTransfer(tx, n.id, target.id);
        if (!check.ok) return problem(c, check.status, check.code);
        const pending = await tx
          .select({ payload: staffApprovals.payload })
          .from(staffApprovals)
          .where(
            and(
              eq(staffApprovals.kind, "namespace.transfer"),
              eq(staffApprovals.status, "pending"),
            ),
          );
        if (pending.some((p) => (p.payload as TransferPayload).namespace_id === n.id)) {
          return problem(c, 409, "namespace.transfer_pending");
        }
        const payload: TransferPayload = {
          namespace_id: n.id,
          slug: n.slug,
          from_user_ids: check.owners,
          to_user_id: target.id,
        };
        const approval = await createApproval(tx, {
          id: c.var.services.ids.uuid(),
          kind: "namespace.transfer",
          capability: "namespaces.govern",
          subject: `namespace:@${n.slug} → ${publicId("user", target.id)}`,
          payload: { ...payload },
          reason: body.reason,
          staff: c.var.staff,
          now,
          requestId: c.var.requestId,
        });
        return c.json({ approval }, 202);
      });
    },
  });
}
