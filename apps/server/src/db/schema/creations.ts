/**
 * Namespace、Creation、草稿与 Revision。
 *
 * 公共标识 `@ns/name` 与内部 id 解耦：改名时旧名写入 redirect 表并永久占用，
 * 不能被其他人重新注册，防止改名后的旧链接被抢注劫持。
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  app,
  contributionPolicyEnum,
  createdAt,
  creationTypeEnum,
  emptyTextArray,
  fragmentKindEnum,
  pk,
  ratingEnum,
  updatedAt,
} from "./common.js";
import { authUser } from "./identity.js";

export const namespaceKindEnum = app.enum("namespace_kind", ["user", "org", "system"]);
export const namespaceStatusEnum = app.enum("namespace_status", ["active", "suspended"]);
export const creationStatusEnum = app.enum("creation_status", ["active", "hidden", "suspended"]);
export const memberRoleEnum = app.enum("member_role", ["owner", "maintainer"]);

export const namespaces = app.table(
  "namespaces",
  {
    id: pk(),
    slug: text("slug").notNull(),
    kind: namespaceKindEnum("kind").notNull(),
    status: namespaceStatusEnum("status").notNull().default("active"),
    createdBy: uuid("created_by").references(() => authUser.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("namespaces_slug_uq").on(t.slug),
    check("namespaces_slug_syntax", sql`${t.slug} ~ '^[a-z0-9]([a-z0-9-]{0,37}[a-z0-9])?$'`),
  ],
);

export const namespaceMembers = app.table(
  "namespace_members",
  {
    namespaceId: uuid("namespace_id")
      .notNull()
      .references(() => namespaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.namespaceId, t.userId] }),
    index("namespace_members_user_idx").on(t.userId),
  ],
);

/** 旧 namespace 名永久占用并重定向到当前 namespace。 */
export const namespaceRedirects = app.table("namespace_redirects", {
  oldSlug: text("old_slug").primaryKey(),
  namespaceId: uuid("namespace_id")
    .notNull()
    .references(() => namespaces.id),
  createdAt: createdAt(),
});

/** 保留名（commons、admin、api、www、品牌名等）不能被注册。 */
export const reservedNames = app.table("reserved_names", {
  slug: text("slug").primaryKey(),
  reason: text("reason").notNull(),
  createdBy: uuid("created_by").references(() => authUser.id),
  createdAt: createdAt(),
});

export const creations = app.table(
  "creations",
  {
    id: pk(),
    namespaceId: uuid("namespace_id")
      .notNull()
      .references(() => namespaces.id),
    name: text("name").notNull(),
    type: creationTypeEnum("type").notNull(),
    /** 可本地化文本：字符串或 locale → 文本。 */
    displayName: jsonb("display_name").notNull(),
    summary: jsonb("summary"),
    rating: ratingEnum("rating").notNull(),
    tags: text("tags").array().notNull().default(emptyTextArray),
    contributionPolicy: contributionPolicyEnum("contribution_policy")
      .notNull()
      .default("signed-in"),
    status: creationStatusEnum("status").notNull().default("active"),
    headRevisionId: uuid("head_revision_id"),
    latestReleaseId: uuid("latest_release_id"),
    /** 最近一个 Release 的 effective rating（包含依赖），搜索过滤按它执行。 */
    effectiveRating: ratingEnum("effective_rating"),
    /** 搜索用的拼接文本（名字、简介、标签、作者），用 pg_trgm 索引。 */
    searchText: text("search_text").notNull().default(""),
    /** 应用层生成的一到两字 n-gram，用于 pg_trgm 无法索引的短 CJK 查询。 */
    searchGrams: text("search_grams").array().notNull().default(emptyTextArray),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("creations_ns_name_uq").on(t.namespaceId, t.name),
    check("creations_name_syntax", sql`${t.name} ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'`),
    index("creations_search_trgm_idx").using("gin", t.searchText.op("gin_trgm_ops")),
    index("creations_search_grams_idx").using("gin", t.searchGrams),
    index("creations_tags_idx").using("gin", t.tags),
  ],
);

export const creationRedirects = app.table(
  "creation_redirects",
  {
    namespaceId: uuid("namespace_id")
      .notNull()
      .references(() => namespaces.id),
    oldName: text("old_name").notNull(),
    creationId: uuid("creation_id")
      .notNull()
      .references(() => creations.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.namespaceId, t.oldName] })],
);

/** 可变的工作副本，用 version 做乐观锁，防止并发编辑互相覆盖。 */
export const creationDrafts = app.table("creation_drafts", {
  creationId: uuid("creation_id")
    .primaryKey()
    .references(() => creations.id, { onDelete: "cascade" }),
  working: jsonb("working").notNull(),
  baseRevisionId: uuid("base_revision_id"),
  version: integer("version").notNull().default(1),
  updatedBy: uuid("updated_by").references(() => authUser.id),
  updatedAt: updatedAt(),
});

/** Revision 的来源：网页编辑（user）、合并的投稿（contribution）或外部 Source（例如 GitHub）。 */
export const revisionAuthorKindEnum = app.enum("revision_author_kind", [
  "user",
  "contribution",
  "source",
]);

/** 不可变的历史版本；内容通过 CAS 引用。 */
export const revisions = app.table(
  "revisions",
  {
    id: pk(),
    creationId: uuid("creation_id")
      .notNull()
      .references(() => creations.id),
    parentId: uuid("parent_id"),
    manifestDigest: text("manifest_digest").notNull(),
    semanticDigest: text("semantic_digest").notNull(),
    authorKind: revisionAuthorKindEnum("author_kind").notNull(),
    authorUserId: uuid("author_user_id").references(() => authUser.id),
    authorContributionId: uuid("author_contribution_id"),
    message: text("message"),
    createdAt: createdAt(),
  },
  (t) => [
    index("revisions_creation_idx").on(t.creationId, t.createdAt),
    // 同一内容只保留一个 Revision，重复提交直接返回已有的。
    uniqueIndex("revisions_creation_semantic_uq").on(t.creationId, t.semanticDigest),
  ],
);

export const revisionFragments = app.table(
  "revision_fragments",
  {
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => revisions.id, { onDelete: "cascade" }),
    fragmentId: text("fragment_id").notNull(),
    digest: text("digest").notNull(),
    kind: fragmentKindEnum("kind").notNull(),
    stable: boolean("stable").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.revisionId, t.fragmentId] }),
    index("revision_fragments_digest_idx").on(t.digest),
  ],
);

/** 收藏（v0 的社交功能只做这一项）。 */
export const favorites = app.table(
  "favorites",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    creationId: uuid("creation_id")
      .notNull()
      .references(() => creations.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.creationId] }),
    index("favorites_creation_idx").on(t.creationId),
  ],
);
