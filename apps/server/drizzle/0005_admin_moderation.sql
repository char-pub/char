CREATE TYPE "app"."staff_approval_kind" AS ENUM('tombstone.large', 'unban.csam', 'staff.remove_owner');--> statement-breakpoint
CREATE TYPE "app"."staff_approval_status" AS ENUM('pending', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TABLE "app"."staff_approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "app"."staff_approval_kind" NOT NULL,
	"subject" text NOT NULL,
	"payload" jsonb NOT NULL,
	"reason" text NOT NULL,
	"initiated_by" uuid NOT NULL,
	"initiated_at" timestamp with time zone NOT NULL,
	"other_eligible_staff" integer NOT NULL,
	"status" "app"."staff_approval_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."creations" ADD COLUMN "forced_rating" "app"."rating";--> statement-breakpoint
ALTER TABLE "app"."staff_approvals" ADD CONSTRAINT "staff_approvals_initiated_by_auth_user_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "app"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."staff_approvals" ADD CONSTRAINT "staff_approvals_decided_by_auth_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "app"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_approvals_status_idx" ON "app"."staff_approvals" USING btree ("status","initiated_at");