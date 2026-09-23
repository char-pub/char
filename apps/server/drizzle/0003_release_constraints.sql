DROP INDEX "app"."releases_creation_label_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "revisions_creation_semantic_uq" ON "app"."revisions" USING btree ("creation_id","semantic_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "releases_idempotency_uq" ON "app"."releases" USING btree ("creation_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "releases_creation_label_uq" ON "app"."releases" USING btree ("creation_id","label") WHERE "app"."releases"."publish_state" <> 'failed';