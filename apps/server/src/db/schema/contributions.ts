/**
 * Contribution：对别人作品的修改提议。接受后生成目标 Creation 的新 Revision。
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { app, createdAt, pk, ts, updatedAt } from "./common.js";
import { creations, revisions } from "./creations.js";
import { authUser, guests } from "./identity.js";

export const contributionStatusEnum = app.enum("contribution_status", [
  "open",
  "accepted",
  "rejected",
  "withdrawn",
]);
export const changeTargetEnum = app.enum("change_target", [
  "fragment",
  "edge",
  "asset",
  "metadata",
]);
export const changeOpEnum = app.enum("change_op", ["add", "modify", "remove", "set", "unset"]);
export const mergeStateEnum = app.enum("merge_state", [
  "pending",
  "applied",
  "skipped",
  "conflict",
]);

export const contributions = app.table(
  "contributions",
  {
    id: pk(),
    targetCreationId: uuid("target_creation_id")
      .notNull()
      .references(() => creations.id),
    /** 每个 Creation 内从 1 开始编号，用于公共标识 `@ns/name/contributions/<number>`。 */
    number: integer("number").notNull(),
    authorUserId: uuid("author_user_id").references(() => authUser.id),
    authorGuestId: text("author_guest_id").references(() => guests.guestId),
    agent: boolean("agent").notNull().default(false),
    title: text("title").notNull(),
    description: text("description"),
    status: contributionStatusEnum("status").notNull().default("open"),
    baseRevisionId: uuid("base_revision_id")
      .notNull()
      .references(() => revisions.id),
    baseSemanticDigest: text("base_semantic_digest").notNull(),
    transport: jsonb("transport").notNull(),
    rightsAck: jsonb("rights_ack").notNull(),
    decidedBy: uuid("decided_by").references(() => authUser.id),
    decidedAt: ts("decided_at"),
    resultRevisionId: uuid("result_revision_id").references(() => revisions.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("contributions_target_number_uq").on(t.targetCreationId, t.number),
    index("contributions_target_status_idx").on(t.targetCreationId, t.status),
  ],
);

export const contributionChanges = app.table(
  "contribution_changes",
  {
    id: pk(),
    contributionId: uuid("contribution_id")
      .notNull()
      .references(() => contributions.id, { onDelete: "cascade" }),
    /** 稳定比较键（fragment id、edge id、slot[/variant]、字段路径），同一 Contribution 内唯一。 */
    changeKey: text("change_key").notNull(),
    on: changeTargetEnum("on").notNull(),
    op: changeOpEnum("op").notNull(),
    baseDigest: text("base_digest"),
    after: jsonb("after"),
    /** 由服务端按字段计算，客户端不能降级。 */
    sensitive: boolean("sensitive").notNull().default(false),
    mergeState: mergeStateEnum("merge_state").notNull().default("pending"),
    position: integer("position").notNull(),
  },
  (t) => [uniqueIndex("contribution_changes_key_uq").on(t.contributionId, t.changeKey)],
);

/** contribution_policy 为 invited 时，被邀请提交 Contribution 的用户。 */
export const contributionInvites = app.table(
  "contribution_invites",
  {
    creationId: uuid("creation_id")
      .notNull()
      .references(() => creations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    invitedBy: uuid("invited_by").references(() => authUser.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.creationId, t.userId] })],
);
