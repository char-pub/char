CREATE TABLE "app"."contribution_invites" (
	"creation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contribution_invites_creation_id_user_id_pk" PRIMARY KEY("creation_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "app"."api_tokens" ADD COLUMN "agent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."contribution_invites" ADD CONSTRAINT "contribution_invites_creation_id_creations_id_fk" FOREIGN KEY ("creation_id") REFERENCES "app"."creations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contribution_invites" ADD CONSTRAINT "contribution_invites_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contribution_invites" ADD CONSTRAINT "contribution_invites_invited_by_auth_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "app"."auth_user"("id") ON DELETE no action ON UPDATE no action;