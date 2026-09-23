CREATE TABLE "app"."auth_account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"account_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."auth_rate_limit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."auth_session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."auth_verification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."auth_account" ADD CONSTRAINT "auth_account_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_account_provider_uq" ON "app"."auth_account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "auth_account_user_idx" ON "app"."auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_rate_limit_key_uq" ON "app"."auth_rate_limit" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_session_token_uq" ON "app"."auth_session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "auth_session_user_idx" ON "app"."auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "app"."auth_verification" USING btree ("identifier");--> statement-breakpoint
CREATE VIEW "app"."external_identities" AS (select "user_id", "provider_id" as "provider", "account_id" as "provider_subject", "created_at" from "app"."auth_account");