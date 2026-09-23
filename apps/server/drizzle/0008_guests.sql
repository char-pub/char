CREATE TABLE "app"."guest_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"guest_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."guest_verifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"email_hmac" text NOT NULL,
	"display_name" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."guests" ADD COLUMN "email_hmac" text;--> statement-breakpoint
ALTER TABLE "app"."guest_sessions" ADD CONSTRAINT "guest_sessions_guest_id_guests_guest_id_fk" FOREIGN KEY ("guest_id") REFERENCES "app"."guests"("guest_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guest_sessions_token_uq" ON "app"."guest_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "guest_sessions_guest_idx" ON "app"."guest_sessions" USING btree ("guest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guest_verifications_token_uq" ON "app"."guest_verifications" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "guests_email_hmac_uq" ON "app"."guests" USING btree ("email_hmac");