/** A platform-created derivative retains its verified source after draft edits. */
import type { ExactRef } from "@char-pub/core";
import { jsonb, text, uuid } from "drizzle-orm/pg-core";
import { app, createdAt } from "./common.js";
import { creations } from "./creations.js";

export const creationDerivations = app.table("creation_derivations", {
  creationId: uuid("creation_id")
    .primaryKey()
    .references(() => creations.id, { onDelete: "cascade" }),
  source: jsonb("source").$type<ExactRef>().notNull(),
  kind: text("kind", { enum: ["remix", "sequel"] }).notNull(),
  createdAt: createdAt(),
});
