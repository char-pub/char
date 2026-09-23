/**
 * Registry 的读取层：按公共标识查找 Creation 与 Release，并整理成 API 响应。
 *
 * 公共标识 `@ns/name` 与内部 ID 解耦。namespace 或 Creation 改名后，旧名写在 redirect
 * 表里，查找时返回“应该重定向到哪个新地址”，由路由返回 301。
 *
 * 这里不做权限判断：它只负责把数据查出来，并附带 `authorize()` 需要的资源描述
 * （namespace 状态、调用者的成员角色、可见性等），授权统一在路由层完成。
 */
import type { CreationDetail, ReleaseSummary } from "@char-pub/contracts";
import { ID_PREFIXES, type IdKind, isId, type Rating } from "@char-pub/core";
import { and, desc, eq, sql } from "drizzle-orm";
import { TypeID } from "typeid-js";
import type { NamespaceContext, Principal } from "../authz/authorize.js";
import type { Executor } from "../db/client.js";
import {
  creationRedirects,
  creations,
  namespaceMembers,
  namespaceRedirects,
  namespaces,
  releases,
  reverseEdges,
} from "../db/schema/index.js";

// ---------------------------------------------------------------------------
// 对外 ID：数据库列是 uuid（UUIDv7），API 中使用 TypeID `<前缀>_<26 位 base32>`。
// ---------------------------------------------------------------------------

export function toPublicId(kind: IdKind, uuid: string): string {
  return TypeID.fromUUID(ID_PREFIXES[kind], uuid).toString();
}

/** 解析对外 ID；前缀不对或格式非法时返回 null。 */
export function fromPublicId(kind: IdKind, id: string): string | null {
  if (!isId(kind, id)) return null;
  try {
    return TypeID.fromString(id, ID_PREFIXES[kind]).toUUID();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 查找
// ---------------------------------------------------------------------------

export type CreationRow = typeof creations.$inferSelect;
export type ReleaseRow = typeof releases.$inferSelect;
export type NamespaceRow = typeof namespaces.$inferSelect;

export interface FoundCreation {
  namespace: NamespaceRow;
  creation: CreationRow;
  ns: NamespaceContext;
  /** 至少有一个 active 或 yanked 的 public Release（完成发布的）。 */
  hasPublicRelease: boolean;
}

export type LookupResult =
  | { kind: "found"; value: FoundCreation }
  /** 旧名：应该重定向到当前的 `@ns/name`。 */
  | { kind: "redirect"; ns: string; name: string }
  | { kind: "missing" };

async function memberRole(db: Executor, namespaceId: string, principal: Principal) {
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

export async function namespaceContext(
  db: Executor,
  namespace: NamespaceRow,
  principal: Principal,
): Promise<NamespaceContext> {
  return {
    namespace_id: namespace.id,
    status: namespace.status,
    role: await memberRole(db, namespace.id, principal),
  };
}

/** 发布任务完成、对外可见的 Release（pending / failed 的发布任务不算 Release）。 */
const published = eq(releases.publishState, "done");

export async function findCreation(
  db: Executor,
  slug: string,
  name: string,
  principal: Principal,
): Promise<LookupResult> {
  let [namespace] = await db.select().from(namespaces).where(eq(namespaces.slug, slug)).limit(1);
  let redirected = false;
  if (!namespace) {
    const [r] = await db
      .select({ ns: namespaces })
      .from(namespaceRedirects)
      .innerJoin(namespaces, eq(namespaces.id, namespaceRedirects.namespaceId))
      .where(eq(namespaceRedirects.oldSlug, slug))
      .limit(1);
    if (!r) return { kind: "missing" };
    namespace = r.ns;
    redirected = true;
  }
  let [creation] = await db
    .select()
    .from(creations)
    .where(and(eq(creations.namespaceId, namespace.id), eq(creations.name, name)))
    .limit(1);
  if (!creation) {
    const [r] = await db
      .select({ c: creations })
      .from(creationRedirects)
      .innerJoin(creations, eq(creations.id, creationRedirects.creationId))
      .where(
        and(eq(creationRedirects.namespaceId, namespace.id), eq(creationRedirects.oldName, name)),
      )
      .limit(1);
    if (!r) return { kind: "missing" };
    creation = r.c;
    redirected = true;
  }
  if (redirected) return { kind: "redirect", ns: namespace.slug, name: creation.name };

  const [pub] = await db
    .select({ id: releases.id })
    .from(releases)
    .where(
      and(
        eq(releases.creationId, creation.id),
        eq(releases.visibility, "public"),
        published,
        sql`${releases.status} <> 'tombstoned'`,
      ),
    )
    .limit(1);
  return {
    kind: "found",
    value: {
      namespace,
      creation,
      ns: await namespaceContext(db, namespace, principal),
      hasPublicRelease: pub !== undefined,
    },
  };
}

export async function findRelease(
  db: Executor,
  creationId: string,
  label: string,
): Promise<ReleaseRow | null> {
  const [r] = await db
    .select()
    .from(releases)
    .where(and(eq(releases.creationId, creationId), eq(releases.label, label), published))
    .limit(1);
  return r ?? null;
}

// ---------------------------------------------------------------------------
// 响应整理
// ---------------------------------------------------------------------------

export function refOf(namespaceSlug: string, creationName: string): string {
  return `@${namespaceSlug}/${creationName}`;
}

/**
 * public 对象的稳定 URL。`base` 是 CAS 在公共域名下的前缀，例如
 * `https://assets.char.pub/cas/sha256`；对象 URL 为 `<base>/<前 2 位 hex>/<64 位 hex>`，
 * 与 Context IR 中 asset URL 的写法一致。
 */
export function publicObjectUrl(base: string, digest: string): string {
  const hex = digest.slice("sha256:".length);
  return `${base.replace(/\/+$/, "")}/${hex.slice(0, 2)}/${hex}`;
}

/** 构建产物（例如 CCv3 导出）的缓存 key：内容、依赖、目标格式或编译器版本任一变化都会换 key。 */
export function exportCacheKey(input: {
  semantic_digest: string;
  lock_digest: string;
  target: string;
  compiler_version: string;
}): string {
  return `${input.target}:${input.compiler_version}:${input.semantic_digest}:${input.lock_digest}`;
}

const RATING_ORDER: readonly Rating[] = ["general", "teen", "mature", "explicit"];

/**
 * 对外展示与过滤用的 effective rating：发布时算出的值与员工强制调高的值中较高的一个。
 * 强制评级只会调高，不修改 Release 本身。
 */
export function effectiveRatingOf(published: Rating, forced: Rating | null | undefined): Rating {
  if (!forced) return published;
  return RATING_ORDER.indexOf(forced) > RATING_ORDER.indexOf(published) ? forced : published;
}

export function releaseSummary(r: ReleaseRow): ReleaseSummary {
  const out: ReleaseSummary = {
    id: toPublicId("release", r.id),
    label: r.label,
    visibility: r.visibility,
    status: r.status,
    semantic_digest: r.semanticDigest,
    effective_rating: r.effectiveRating ?? "general",
    created_at: r.createdAt.toISOString(),
  };
  const source = r.source as {
    provider?: string;
    repository_id?: string;
    commit?: string;
    path?: string;
  } | null;
  out.source =
    source?.provider === "github"
      ? {
          kind: "github",
          ...(typeof source.repository_id === "string"
            ? { repository_id: source.repository_id }
            : {}),
          ...(typeof source.commit === "string" ? { commit: source.commit } : {}),
          ...(typeof source.path === "string" ? { path: source.path } : {}),
        }
      : { kind: "native" };
  out.publisher =
    typeof r.publishedBy === "string"
      ? { kind: "user", user: r.publishedBy }
      : { kind: "github_actions" };
  if (r.statusReason) out.status_reason = r.statusReason;
  return out;
}

/** 调用方能看到哪些 Release：成员看到全部，其他人只看到 public。 */
export async function visibleReleases(
  db: Executor,
  found: FoundCreation,
  principal: Principal,
): Promise<ReleaseRow[]> {
  const isMember = principal.kind === "user" && found.ns.role !== null;
  const rows = await db
    .select()
    .from(releases)
    .where(
      and(
        eq(releases.creationId, found.creation.id),
        published,
        isMember ? sql`true` : eq(releases.visibility, "public"),
      ),
    )
    .orderBy(desc(releases.createdAt), desc(releases.id));
  return rows;
}

export async function creationDetail(
  db: Executor,
  found: FoundCreation,
  principal: Principal,
): Promise<CreationDetail> {
  const { namespace, creation } = found;
  const rels = await visibleReleases(db, found, principal);
  const latest = rels.find((r) => r.status !== "tombstoned");
  const [dep] = await db
    .select({ n: sql<number>`count(DISTINCT ${reverseEdges.dependentCreationId})::int` })
    .from(reverseEdges)
    .innerJoin(releases, eq(releases.id, reverseEdges.dependentReleaseId))
    .where(
      and(
        eq(reverseEdges.depCreationId, creation.id),
        eq(releases.visibility, "public"),
        sql`${releases.status} <> 'tombstoned'`,
      ),
    );
  const detail: CreationDetail = {
    id: toPublicId("creation", creation.id),
    ref: refOf(namespace.slug, creation.name),
    type: creation.type,
    display_name: creation.displayName as CreationDetail["display_name"],
    rating: creation.rating,
    tags: creation.tags,
    releases: rels.map(releaseSummary),
    dependents_count: dep?.n ?? 0,
    contribution_policy: creation.contributionPolicy,
  };
  if (creation.summary !== null)
    detail.summary = creation.summary as CreationDetail["display_name"];
  if (latest) {
    detail.latest_release = releaseSummary(latest);
    detail.effective_rating = effectiveRatingOf(
      latest.effectiveRating ?? creation.rating,
      creation.forcedRating,
    );
    if (latest.status === "yanked") {
      detail.warning = `release ${latest.label} was yanked${latest.statusReason ? `: ${latest.statusReason}` : ""}`;
    }
  }
  return detail;
}
