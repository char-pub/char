/**
 * Registry 的读取层：按公共标识查找 Creation 与 Release，并整理成 API 响应。
 *
 * 公共标识 `@ns/name` 与内部 ID 解耦。namespace 或 Creation 改名后，旧名写在 redirect
 * 表里，查找时返回“应该重定向到哪个新地址”，由路由返回 301。
 *
 * 加载 `authorize()` 需要的作品、namespace 和协作者上下文。
 * 列表中的私有版本与响应能力同样委托集中授权判断，不能仅以公开作品详情的权限推导。
 */
import type { CreationDetail, ReleaseSummary } from "@char-pub/contracts";
import { digestOf, ID_PREFIXES, type IdKind, isId, type Rating } from "@char-pub/core";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { TypeID } from "typeid-js";
import {
  authorize,
  isNamespaceOwner,
  type NamespaceContext,
  type Principal,
} from "../authz/authorize.js";
import type { Executor } from "../db/client.js";
import {
  creationRedirects,
  creations,
  namespaceMembers,
  namespaceRedirects,
  namespaces,
  releases,
  reverseEdges,
  revisionContributors,
} from "../db/schema/index.js";

import { collaborationAccess } from "./collaboration-access.js";

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
export type ReleaseRow = typeof releases.$inferSelect & {
  contributors?: { user: string; name: string }[];
};
export type NamespaceRow = typeof namespaces.$inferSelect;

export interface FoundCreation {
  collaborator?: boolean;
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
    kind: namespace.kind,
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
      collaborator: await collaborationAccess(db, creation.id, principal),
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
  return r ? ((await withReleaseContributors(db, [r]))[0] ?? null) : null;
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
  /** Card provenance and blob retention belong to one exact root Release. */
  release_id: string;
  bucket: "public" | "private";
  semantic_digest: string;
  lock_digest: string;
  target: string;
  compiler_version: string;
  locale?: string;
  preset?: { release_id: string; semantic_digest: string };
}): string {
  return `${input.target}:${digestOf(input)}`;
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

/** Credits belong to the immutable Revision, not the current team or profile names. */
export async function withReleaseContributors(
  db: Executor,
  rows: readonly ReleaseRow[],
): Promise<ReleaseRow[]> {
  const ids = [...new Set(rows.flatMap((row) => (row.revisionId ? [row.revisionId] : [])))];
  if (!ids.length) return [...rows];
  const credits = await db
    .select()
    .from(revisionContributors)
    .where(inArray(revisionContributors.revisionId, ids))
    .orderBy(asc(revisionContributors.userId));
  return rows.map((row) => ({
    ...row,
    contributors: credits
      .filter((credit) => credit.revisionId === row.revisionId)
      .map((credit) => ({ user: toPublicId("user", credit.userId), name: credit.name })),
  }));
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
    ...(r.contributors?.length ? { contributors: r.contributors } : {}),
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

/** 先按作品角色缩小查询，再逐版本交集读取 scope，防止公开详情泄露私有版本。 */
export async function visibleReleases(
  db: Executor,
  found: FoundCreation,
  principal: Principal,
): Promise<ReleaseRow[]> {
  const isMember =
    principal.kind === "user" && (isNamespaceOwner(found.ns) || found.collaborator === true);
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
  const visible = rows.filter(
    (row) =>
      authorize(principal, "release.read", {
        type: "release",
        id: row.id,
        creation_id: found.creation.id,
        ns: found.ns,
        collaborator: found.collaborator === true,
        visibility: row.visibility,
        status: row.status,
        creation_status: found.creation.status,
      }).allow,
  );
  return withReleaseContributors(db, visible);
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
  const resource = {
    type: "creation" as const,
    id: creation.id,
    ns: found.ns,
    collaborator: found.collaborator === true,
    has_public_release: found.hasPublicRelease,
    status: creation.status,
    contribution_policy: creation.contributionPolicy,
  };
  const permission = (action: Parameters<typeof authorize>[1]) =>
    authorize(principal, action, resource).allow;
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
    permissions: {
      read_draft: permission("creation.read_draft"),
      edit: permission("creation.edit"),
      publish: permission("creation.publish"),
      update_sensitive: permission("creation.update_settings"),
      manage_source: permission("creation.manage_source"),
      manage_collaborators: permission("creation.manage_collaborators"),
    },
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
