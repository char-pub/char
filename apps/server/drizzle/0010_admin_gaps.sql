ALTER TYPE "app"."staff_approval_kind" ADD VALUE 'namespace.transfer';--> statement-breakpoint
CREATE TABLE "app"."upload_locks" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"locked_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"locked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."evidence_download_tickets" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"incident_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."legal_requests" ADD COLUMN "counter_notice_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."legal_requests" ADD COLUMN "restore_not_before" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."legal_requests" ADD COLUMN "restore_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."legal_requests" ADD COLUMN "court_action_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."legal_requests" ADD COLUMN "restored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."upload_locks" ADD CONSTRAINT "upload_locks_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."upload_locks" ADD CONSTRAINT "upload_locks_locked_by_auth_user_id_fk" FOREIGN KEY ("locked_by") REFERENCES "app"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."evidence_download_tickets" ADD CONSTRAINT "evidence_download_tickets_incident_id_csam_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "app"."csam_incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."evidence_download_tickets" ADD CONSTRAINT "evidence_download_tickets_staff_id_auth_user_id_fk" FOREIGN KEY ("staff_id") REFERENCES "app"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_download_tickets_expires_idx" ON "app"."evidence_download_tickets" USING btree ("expires_at");