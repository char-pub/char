CREATE TABLE "app"."creation_asset_grants" (
	"creation_id" uuid NOT NULL,
	"digest" text NOT NULL,
	"granted_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creation_asset_grants_creation_id_digest_pk" PRIMARY KEY("creation_id","digest")
);
--> statement-breakpoint
CREATE TABLE "app"."creation_collaborators" (
	"creation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"invited_by" uuid NOT NULL,
	"license" text NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creation_collaborators_creation_id_user_id_pk" PRIMARY KEY("creation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "app"."creation_contributors" (
	"creation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creation_contributors_creation_id_user_id_pk" PRIMARY KEY("creation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "app"."revision_contributors" (
	"revision_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "revision_contributors_revision_id_user_id_pk" PRIMARY KEY("revision_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "app"."creation_asset_grants" ADD CONSTRAINT "creation_asset_grants_creation_id_creations_id_fk" FOREIGN KEY ("creation_id") REFERENCES "app"."creations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."creation_asset_grants" ADD CONSTRAINT "creation_asset_grants_granted_by_auth_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "app"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."creation_collaborators" ADD CONSTRAINT "creation_collaborators_creation_id_creations_id_fk" FOREIGN KEY ("creation_id") REFERENCES "app"."creations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."creation_collaborators" ADD CONSTRAINT "creation_collaborators_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."creation_collaborators" ADD CONSTRAINT "creation_collaborators_invited_by_auth_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "app"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."creation_contributors" ADD CONSTRAINT "creation_contributors_creation_id_creations_id_fk" FOREIGN KEY ("creation_id") REFERENCES "app"."creations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."creation_contributors" ADD CONSTRAINT "creation_contributors_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."revision_contributors" ADD CONSTRAINT "revision_contributors_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "app"."revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."revision_contributors" ADD CONSTRAINT "revision_contributors_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."auth_user"("id") ON DELETE no action ON UPDATE no action;