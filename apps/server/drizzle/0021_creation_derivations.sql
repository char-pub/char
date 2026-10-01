CREATE TABLE "app"."creation_derivations" (
	"creation_id" uuid PRIMARY KEY NOT NULL,
	"source" jsonb NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."creation_derivations" ADD CONSTRAINT "creation_derivations_creation_id_creations_id_fk" FOREIGN KEY ("creation_id") REFERENCES "app"."creations"("id") ON DELETE cascade ON UPDATE no action;