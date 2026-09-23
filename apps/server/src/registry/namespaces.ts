/**
 * Namespace 注册规则。
 *
 * - 每个登录用户可以注册一个个人 namespace，自己成为 owner。
 * - 保留名不能注册：内置列表（平台自身、常用子域、品牌名）加上 `reserved_names` 表中
 *   员工追加的名字。
 * - 已被使用的名字，以及改名后留下的旧名，都不能再注册：旧名永久重定向到原 namespace，
 *   防止别人抢注后冒充原作者。
 */
import { and, eq } from "drizzle-orm";
import type { Executor } from "../db/client.js";
import {
  namespaceMembers,
  namespaceRedirects,
  namespaces,
  reservedNames,
} from "../db/schema/index.js";

/** 平台自身使用或容易被用于冒充的名字。 */
export const BUILTIN_RESERVED = new Set([
  "about",
  "account",
  "admin",
  "administrator",
  "api",
  "app",
  "assets",
  "auth",
  "blog",
  "char",
  "char-pub",
  "charpub",
  "commons",
  "contact",
  "docs",
  "help",
  "legal",
  "login",
  "logout",
  "me",
  "mod",
  "moderator",
  "new",
  "official",
  "press",
  "root",
  "security",
  "settings",
  "signup",
  "staff",
  "staging",
  "status",
  "support",
  "system",
  "team",
  "terms",
  "www",
]);

export type SlugAvailability = "available" | "reserved" | "taken";

export async function slugAvailability(db: Executor, slug: string): Promise<SlugAvailability> {
  if (BUILTIN_RESERVED.has(slug)) return "reserved";
  const [reserved] = await db
    .select({ slug: reservedNames.slug })
    .from(reservedNames)
    .where(eq(reservedNames.slug, slug))
    .limit(1);
  if (reserved) return "reserved";
  const [ns] = await db
    .select({ id: namespaces.id })
    .from(namespaces)
    .where(eq(namespaces.slug, slug))
    .limit(1);
  if (ns) return "taken";
  const [redirect] = await db
    .select({ slug: namespaceRedirects.oldSlug })
    .from(namespaceRedirects)
    .where(eq(namespaceRedirects.oldSlug, slug))
    .limit(1);
  return redirect ? "taken" : "available";
}

/** 用户已经拥有的个人 namespace 数量。 */
export async function ownedUserNamespaces(db: Executor, userId: string): Promise<number> {
  const rows = await db
    .select({ id: namespaces.id })
    .from(namespaces)
    .innerJoin(namespaceMembers, eq(namespaceMembers.namespaceId, namespaces.id))
    .where(
      and(
        eq(namespaceMembers.userId, userId),
        eq(namespaceMembers.role, "owner"),
        eq(namespaces.kind, "user"),
      ),
    );
  return rows.length;
}

/** v0 每个用户只能有一个个人 namespace。 */
export const MAX_USER_NAMESPACES = 1;
