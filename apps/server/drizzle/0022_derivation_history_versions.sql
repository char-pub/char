ALTER TABLE "app"."release_fragments" DROP CONSTRAINT "release_fragments_release_id_owner_ref_fragment_id_pk";--> statement-breakpoint
ALTER TABLE "app"."release_locks" DROP CONSTRAINT "release_locks_release_id_dep_creation_id_pk";--> statement-breakpoint
ALTER TABLE "app"."release_fragments" ADD CONSTRAINT "release_fragments_release_id_owner_ref_fragment_id_digest_pk" PRIMARY KEY("release_id","owner_ref","fragment_id","digest");--> statement-breakpoint
ALTER TABLE "app"."release_locks" ADD CONSTRAINT "release_locks_release_id_dep_release_id_pk" PRIMARY KEY("release_id","dep_release_id");