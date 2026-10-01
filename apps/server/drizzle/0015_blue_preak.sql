CREATE TYPE "app"."draft_build_state" AS ENUM('pending', 'ready', 'failed', 'expired', 'deleted');--> statement-breakpoint
CREATE TABLE "app"."draft_builds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creation_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"requester_id" uuid NOT NULL,
	"draft_version" integer NOT NULL,
	"builder" text NOT NULL,
	"config_digest" text NOT NULL,
	"default_policy" jsonb,
	"state" "app"."draft_build_state" DEFAULT 'pending' NOT NULL,
	"semantic_digest" text NOT NULL,
	"lock_digest" text,
	"artifact_digest" text,
	"report" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"payload_deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."draft_builds" ADD CONSTRAINT "draft_builds_creation_id_creations_id_fk" FOREIGN KEY ("creation_id") REFERENCES "app"."creations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."draft_builds" ADD CONSTRAINT "draft_builds_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "app"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."draft_builds" ADD CONSTRAINT "draft_builds_requester_id_auth_user_id_fk" FOREIGN KEY ("requester_id") REFERENCES "app"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "draft_builds_creation_idx" ON "app"."draft_builds" USING btree ("creation_id","created_at");--> statement-breakpoint
CREATE INDEX "draft_builds_expiry_idx" ON "app"."draft_builds" USING btree ("expires_at","payload_deleted_at");--> statement-breakpoint
CREATE INDEX "draft_builds_pending_idx" ON "app"."draft_builds" USING btree ("state","updated_at");