/**
 * Namespace 治理：保留名、冻结 / 恢复、改名仲裁。
 *
 * - 保留名（如 `commons`、`admin`、品牌名）不能被注册；删除保留名不会释放已经被占用的名字。
 * - 冻结后该 namespace 下的内容对公众不可见，成员也不能再编辑或发布。
 * - 改名：旧名写入重定向表并永久占用，不能被任何人重新注册，旧链接跳转到新名字。
 */
import { NAMESPACE_RE } from "@char-pub/core";
import { eq, ilike, inArray } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { appendAudit } from "../../audit/audit.js";
import {
  authUser,
  namespaceMembers,
  namespaceRedirects,
  namespaces,
  reservedNames,
} from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { type AdminEnv, adminRoute } from "../app.js";
import { recordAction, staffActor } from "./common.js";

const Slug = z.string().regex(NAMESPACE_RE);
const Reason = z.string().trim().min(10).max(2000);

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
}
