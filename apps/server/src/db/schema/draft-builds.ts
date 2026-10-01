import { index, integer, jsonb, text, uuid } from "drizzle-orm/pg-core";
import { app, createdAt, pk, ts, updatedAt } from "./common.js";
import { creations, revisions } from "./creations.js";
import { authUser } from "./identity.js";

export const draftBuildState = app.enum("draft_build_state", [
  "pending",
  "ready",
  "failed",
  "expired",
  "deleted",
]);

/** Private, temporary build receipts; never Release rows or dependency targets. */
export const draftBuilds = app.table(
  "draft_builds",
  {
    id: pk(),
    creationId: uuid("creation_id")
      .notNull()
      .references(() => creations.id),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => revisions.id),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => authUser.id),
    requesterTokenId: uuid("requester_token_id"),
    requesterScopes: text("requester_scopes").array(),
    draftVersion: integer("draft_version").notNull(),
    builder: text("builder").notNull(),
    configDigest: text("config_digest").notNull(),
    defaultPolicy: jsonb("default_policy"),
    state: draftBuildState("state").notNull().default("pending"),
    semanticDigest: text("semantic_digest").notNull(),
    lockDigest: text("lock_digest"),
    artifactDigest: text("artifact_digest"),
    report: jsonb("report"),
    expiresAt: ts("expires_at").notNull(),
    payloadDeletedAt: ts("payload_deleted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("draft_builds_creation_idx").on(t.creationId, t.createdAt),
    index("draft_builds_expiry_idx").on(t.expiresAt, t.payloadDeletedAt),
    index("draft_builds_pending_idx").on(t.state, t.updatedAt),
  ],
);
