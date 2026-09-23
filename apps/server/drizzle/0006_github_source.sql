ALTER TYPE "app"."revision_author_kind" ADD VALUE 'source';--> statement-breakpoint
ALTER TABLE "app"."source_bindings" ADD COLUMN "last_check" jsonb;--> statement-breakpoint
ALTER TABLE "app"."source_bindings" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."source_bindings" ADD COLUMN "require_ref_protected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."source_bindings" ADD COLUMN "environment" text;--> statement-breakpoint
ALTER TABLE "app"."source_bindings" ADD COLUMN "job_workflow_ref" text;