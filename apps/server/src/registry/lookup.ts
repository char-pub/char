/**
 * 从数据库加载授权需要的资源上下文：namespace 的状态、当前用户在其中的角色，以及
 * Creation 是否已有公开内容。路由在 `authorize` 回调里用它们构造 `Resource`，
 * 真正的权限判断仍然只在 `authorize()` 中进行。
 */
import { and, eq, sql } from "drizzle-orm";
import type { NamespaceContext, Principal, Resource } from "../authz/authorize.js";
import type { Executor } from "../db/client.js";
import {
  creations,
  namespaceMembers,
  namespaceRedirects,
  namespaces,
  releases,
} from "../db/schema/index.js";

export type NamespaceRow = typeof namespaces.$inferSelect;
export type CreationRow = typeof creations.$inferSelect;

export type NamespaceLookup =
  | { kind: "found"; ns: NamespaceRow; ctx: NamespaceContext }
  /** 旧名：永久重定向到当前名字。 */
  | { kind: "redirect"; to: string }
  | { kind: "missing" };

async function roleOf(db: Executor, namespaceId: string, principal: Principal) {
  if (principal.kind !== "user") return null;
  const [m] = await db
    .select({ role: namespaceMembers.role })
    .from(namespaceMembers)
    .where(
      and(
        eq(namespaceMembers.namespaceId, namespaceId),
        eq(namespaceMembers.userId, principal.user_id),
      ),
    )
    .limit(1);
  return m?.role ?? null;
}

export function namespaceContext(
  ns: NamespaceRow,
  role: NamespaceContext["role"],
): NamespaceContext {
  return { namespace_id: ns.id, status: ns.status, role };
}

export async function lookupNamespace(
  db: Executor,
  slug: string,
  principal: Principal,
): Promise<NamespaceLookup> {
  const [ns] = await db.select().from(namespaces).where(eq(namespaces.slug, slug)).limit(1);
  if (ns)
    return { kind: "found", ns, ctx: namespaceContext(ns, await roleOf(db, ns.id, principal)) };
  const [r] = await db
    .select({ slug: namespaces.slug })
    .from(namespaceRedirects)
    .innerJoin(namespaces, eq(namespaces.id, namespaceRedirects.namespaceId))
    .where(eq(namespaceRedirects.oldSlug, slug))
    .limit(1);
  return r ? { kind: "redirect", to: r.slug } : { kind: "missing" };
}

export interface CreationContext {
  ns: NamespaceRow;
  creation: CreationRow;
  resource: Extract<Resource, { type: "creation" }>;
}

/**
 * 按 `@ns/name` 加载 Creation。namespace 改过名时旧名同样可以找到（写操作也按内部 id 进行，
 * 不受改名影响）。找不到时返回 null，调用方统一返回 404。
 */
export async function lookupCreation(
  db: Executor,
  nsSlug: string,
  name: string,
  principal: Principal,
): Promise<CreationContext | null> {
  let lookup = await lookupNamespace(db, nsSlug, principal);
  if (lookup.kind === "redirect") lookup = await lookupNamespace(db, lookup.to, principal);
  if (lookup.kind !== "found") return null;
  const [creation] = await db
    .select()
    .from(creations)
    .where(and(eq(creations.namespaceId, lookup.ns.id), eq(creations.name, name)))
    .limit(1);
  if (!creation) return null;
  const [pub] = await db
    .select({ one: sql<number>`1` })
    .from(releases)
    .where(
      and(
        eq(releases.creationId, creation.id),
        eq(releases.visibility, "public"),
        eq(releases.status, "active"),
        eq(releases.publishState, "done"),
      ),
    )
    .limit(1);
  return {
    ns: lookup.ns,
    creation,
    resource: {
      type: "creation",
      id: creation.id,
      ns: lookup.ctx,
      has_public_release: pub !== undefined,
      status: creation.status,
      contribution_policy: creation.contributionPolicy,
    },
  };
}
