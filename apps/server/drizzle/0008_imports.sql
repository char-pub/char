CREATE TYPE "app"."import_status" AS ENUM('pending', 'processing', 'succeeded', 'failed');--> statement-breakpoint
ALTER TYPE "app"."blob_kind" ADD VALUE 'report';--> statement-breakpoint
CREATE TABLE "app"."imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"namespace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "app"."import_status" DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"error_detail" text,
	"creation_id" uuid,
	"source_digest" text,
	"report_digest" text,
	"needs_confirmation" text[] DEFAULT '{}'::text[] NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."imports" ADD CONSTRAINT "imports_owner_user_id_auth_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "app"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."imports" ADD CONSTRAINT "imports_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "app"."uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."imports" ADD CONSTRAINT "imports_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "app"."namespaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."imports" ADD CONSTRAINT "imports_creation_id_creations_id_fk" FOREIGN KEY ("creation_id") REFERENCES "app"."creations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "imports_upload_uq" ON "app"."imports" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "imports_owner_idx" ON "app"."imports" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "imports_creation_idx" ON "app"."imports" USING btree ("creation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "imports_pending_name_uq" ON "app"."imports" USING btree ("namespace_id","name") WHERE "app"."imports"."status" in ('pending', 'processing');