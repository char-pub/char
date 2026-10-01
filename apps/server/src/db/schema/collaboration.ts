/** Work-scoped invitation, asset authorization and immutable revision credit. */
import { primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { app, createdAt, updatedAt } from "./common.js";
import { creations, revisions } from "./creations.js";
import { authUser } from "./identity.js";
export const creationCollaborators = app.table(
  "creation_collaborators",
  {
    creationId: uuid("creation_id")
      .notNull()
      .references(() => creations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => authUser.id),
    license: text("license").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.creationId, t.userId] })],
);
export const creationAssetGrants = app.table(
  "creation_asset_grants",
  {
    creationId: uuid("creation_id")
      .notNull()
      .references(() => creations.id, { onDelete: "cascade" }),
    digest: text("digest").notNull(),
    grantedBy: uuid("granted_by")
      .notNull()
      .references(() => authUser.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.creationId, t.digest] })],
);
/** Once a collaborator's edit is saved, revocation does not erase their contribution. */
export const creationContributors = app.table(
  "creation_contributors",
  {
    creationId: uuid("creation_id")
      .notNull()
      .references(() => creations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUser.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.creationId, t.userId] })],
);
export const revisionContributors = app.table(
  "revision_contributors",
  {
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => revisions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUser.id),
    name: text("name").notNull(),
  },
  (t) => [primaryKey({ columns: [t.revisionId, t.userId] })],
);
