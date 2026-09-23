CREATE TYPE "app"."incident_reason" AS ENUM('csam_scan', 'staff_flag');--> statement-breakpoint
CREATE TYPE "app"."incident_status" AS ENUM('open', 'reported', 'closed');--> statement-breakpoint
CREATE TABLE "app"."csam_incidents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"upload_id" uuid,
	"blob_digest" text NOT NULL,
	"user_id" uuid,
	"reason" "app"."incident_reason" NOT NULL,
	"match_id" text,
	"status" "app"."incident_status" DEFAULT 'open' NOT NULL,
	"ncmec_report_id" text,
	"reported_at" timestamp with time zone,
	"evidence_key" text NOT NULL,
	"evidence_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."csam_incidents" ADD CONSTRAINT "csam_incidents_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "app"."uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."csam_incidents" ADD CONSTRAINT "csam_incidents_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "csam_incidents_status_idx" ON "app"."csam_incidents" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "csam_incidents_digest_idx" ON "app"."csam_incidents" USING btree ("blob_digest");