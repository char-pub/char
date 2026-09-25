ALTER TYPE "app"."blob_kind" ADD VALUE 'artifact' BEFORE 'export';--> statement-breakpoint
ALTER TYPE "app"."creation_type" ADD VALUE 'prompt-module';--> statement-breakpoint
ALTER TYPE "app"."change_target" ADD VALUE 'configuration';--> statement-breakpoint
ALTER TABLE "app"."imports" ADD COLUMN "policy_preset_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."releases" ADD COLUMN "artifact_digest" text;--> statement-breakpoint
ALTER TABLE "app"."imports" ADD CONSTRAINT "imports_policy_preset_id_creations_id_fk" FOREIGN KEY ("policy_preset_id") REFERENCES "app"."creations"("id") ON DELETE no action ON UPDATE no action;