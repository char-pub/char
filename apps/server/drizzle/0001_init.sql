CREATE SCHEMA IF NOT EXISTS "app";
--> statement-breakpoint
CREATE TYPE "app"."blob_kind" AS ENUM('fragment', 'manifest', 'snapshot', 'ir', 'export', 'asset', 'thumbnail', 'upload');--> statement-breakpoint
CREATE TYPE "app"."blob_status" AS ENUM('present', 'withheld', 'purged');--> statement-breakpoint
CREATE TYPE "app"."contribution_policy" AS ENUM('anyone', 'signed-in', 'invited', 'closed');--> statement-breakpoint
CREATE TYPE "app"."creation_type" AS ENUM('character', 'world', 'lorebook', 'relationship', 'scenario', 'persona', 'style', 'preset');--> statement-breakpoint
CREATE TYPE "app"."edge_mode" AS ENUM('intrinsic', 'default');--> statement-breakpoint
CREATE TYPE "app"."fragment_kind" AS ENUM('character', 'persona', 'relationship', 'world', 'scenario', 'knowledge', 'style', 'examples', 'instruction');--> statement-breakpoint
CREATE TYPE "app"."publish_state" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "app"."rating" AS ENUM('general', 'teen', 'mature', 'explicit');--> statement-breakpoint
CREATE TYPE "app"."release_status" AS ENUM('active', 'yanked', 'tombstoned');--> statement-breakpoint
CREATE TYPE "app"."scan_status" AS ENUM('not_scanned', 'clean', 'matched', 'error');--> statement-breakpoint
CREATE TYPE "app"."upload_status" AS ENUM('uploaded', 'processing', 'ready', 'rejected', 'quarantined');--> statement-breakpoint
CREATE TYPE "app"."visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TYPE "app"."change_op" AS ENUM('add', 'modify', 'remove', 'set', 'unset');--> statement-breakpoint
CREATE TYPE "app"."change_target" AS ENUM('fragment', 'edge', 'asset', 'metadata');--> statement-breakpoint
CREATE TYPE "app"."contribution_status" AS ENUM('open', 'accepted', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "app"."merge_state" AS ENUM('pending', 'applied', 'skipped', 'conflict');--> statement-breakpoint
CREATE TYPE "app"."creation_status" AS ENUM('active', 'hidden', 'suspended');--> statement-breakpoint
CREATE TYPE "app"."member_role" AS ENUM('owner', 'maintainer');--> statement-breakpoint
CREATE TYPE "app"."namespace_kind" AS ENUM('user', 'org', 'system');--> statement-breakpoint
CREATE TYPE "app"."namespace_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "app"."revision_author_kind" AS ENUM('user', 'contribution');--> statement-breakpoint
CREATE TYPE "app"."binding_status" AS ENUM('active', 'frozen', 'unbound');--> statement-breakpoint
CREATE TYPE "app"."github_account_type" AS ENUM('User', 'Organization');--> statement-breakpoint
CREATE TYPE "app"."webhook_status" AS ENUM('received', 'processed', 'failed', 'ignored');--> statement-breakpoint
CREATE TYPE "app"."legal_kind" AS ENUM('dmca', 'court', 'gdpr', 'other');--> statement-breakpoint
CREATE TYPE "app"."legal_status" AS ENUM('received', 'reviewing', 'actioned', 'rejected', 'counter_noticed', 'closed');--> statement-breakpoint
CREATE TYPE "app"."report_status" AS ENUM('open', 'claimed', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "app"."license_check" AS ENUM('pass', 'warn');--> statement-breakpoint
CREATE TYPE "app"."release_availability" AS ENUM('complete', 'linked');--> statement-breakpoint
CREATE TABLE "app"."contribution_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contribution_id" uuid NOT NULL,
	"change_key" text NOT NULL,
	"on" "app"."change_target" NOT NULL,
	"op" "app"."change_op" NOT NULL,
	"base_digest" text,
	"after" jsonb,
	"sensitive" boolean DEFAULT false NOT NULL,
	"merge_state" "app"."merge_state" DEFAULT 'pending' NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."contributions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"target_creation_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"author_user_id" uuid,
	"author_guest_id" text,
	"agent" boolean DEFAULT false NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "app"."contribution_status" DEFAULT 'open' NOT NULL,
	"base_revision_id" uuid NOT NULL,
	"base_semantic_digest" text NOT NULL,
	"transport" jsonb NOT NULL,
	"rights_ack" jsonb NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"result_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."creation_drafts" (
	"creation_id" uuid PRIMARY KEY NOT NULL,
	"working" jsonb NOT NULL,
	"base_revision_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."creation_redirects" (
	"namespace_id" uuid NOT NULL,
	"old_name" text NOT NULL,
	"creation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creation_redirects_namespace_id_old_name_pk" PRIMARY KEY("namespace_id","old_name")
);
--> statement-breakpoint
CREATE TABLE "app"."creations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"namespace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "app"."creation_type" NOT NULL,
	"display_name" jsonb NOT NULL,
	"summary" jsonb,
	"rating" "app"."rating" NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"contribution_policy" "app"."contribution_policy" DEFAULT 'signed-in' NOT NULL,
	"status" "app"."creation_status" DEFAULT 'active' NOT NULL,
	"head_revision_id" uuid,
	"latest_release_id" uuid,
	"effective_rating" "app"."rating",
	"search_text" text DEFAULT '' NOT NULL,
	"search_grams" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creations_name_syntax" CHECK ("app"."creations"."name" ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$')
);
--> statement-breakpoint
CREATE TABLE "app"."favorites" (
	"user_id" uuid NOT NULL,
	"creation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorites_user_id_creation_id_pk" PRIMARY KEY("user_id","creation_id")
);
--> statement-breakpoint
CREATE TABLE "app"."namespace_members" (
	"namespace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "app"."member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "namespace_members_namespace_id_user_id_pk" PRIMARY KEY("namespace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "app"."namespace_redirects" (
	"old_slug" text PRIMARY KEY NOT NULL,
	"namespace_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."namespaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"kind" "app"."namespace_kind" NOT NULL,
	"status" "app"."namespace_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "namespaces_slug_syntax" CHECK ("app"."namespaces"."slug" ~ '^[a-z0-9]([a-z0-9-]{0,37}[a-z0-9])?$')
);
--> statement-breakpoint
CREATE TABLE "app"."reserved_names" (
	"slug" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."revision_fragments" (
	"revision_id" uuid NOT NULL,
	"fragment_id" text NOT NULL,
	"digest" text NOT NULL,
	"kind" "app"."fragment_kind" NOT NULL,
	"stable" boolean NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "revision_fragments_revision_id_fragment_id_pk" PRIMARY KEY("revision_id","fragment_id")
);
--> statement-breakpoint
CREATE TABLE "app"."revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creation_id" uuid NOT NULL,
	"parent_id" uuid,
	"manifest_digest" text NOT NULL,
	"semantic_digest" text NOT NULL,
	"author_kind" "app"."revision_author_kind" NOT NULL,
	"author_user_id" uuid,
	"author_contribution_id" uuid,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."github_installations" (
	"installation_id" bigint PRIMARY KEY NOT NULL,
	"account_id" bigint NOT NULL,
	"account_login" text NOT NULL,
	"account_type" "app"."github_account_type" NOT NULL,
	"suspended_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."oidc_jti" (
	"jti" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."source_bindings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creation_id" uuid NOT NULL,
	"repository_id" bigint NOT NULL,
	"repository_owner_id" bigint NOT NULL,
	"installation_id" bigint NOT NULL,
	"path" text NOT NULL,
	"tracked_ref" text NOT NULL,
	"publish_refs" text[] NOT NULL,
	"display_full_name" text NOT NULL,
	"status" "app"."binding_status" DEFAULT 'active' NOT NULL,
	"frozen_reason" text,
	"last_seen_commit" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."webhook_deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"status" "app"."webhook_status" DEFAULT 'received' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."api_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."auth_user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"image" text,
	"role" text,
	"banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."guests" (
	"guest_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"verified_at" timestamp with time zone,
	"verification_kind" text,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"show_mature" boolean DEFAULT false NOT NULL,
	"mature_confirmed_at" timestamp with time zone,
	"locale" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor" jsonb NOT NULL,
	"action" text NOT NULL,
	"subject" text NOT NULL,
	"request_id" text,
	"ip_hash" text,
	"before" jsonb,
	"after" jsonb,
	"prev_hash" text,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"reason" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."job_effects" (
	"key" text PRIMARY KEY NOT NULL,
	"job_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."legal_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "app"."legal_kind" NOT NULL,
	"requester" jsonb NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"subjects" jsonb NOT NULL,
	"status" "app"."legal_status" DEFAULT 'received' NOT NULL,
	"deadline" timestamp with time zone,
	"counter_notice" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."moderation_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"subject" jsonb NOT NULL,
	"reason" text NOT NULL,
	"legal_request_id" uuid,
	"params" jsonb,
	"blast_radius" jsonb,
	"reverted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_reason_len" CHECK (char_length("app"."moderation_actions"."reason") >= 10)
);
--> statement-breakpoint
CREATE TABLE "app"."reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reporter" jsonb NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"category" text NOT NULL,
	"details" text,
	"status" "app"."report_status" DEFAULT 'open' NOT NULL,
	"assignee" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."asset_meta" (
	"digest" text PRIMARY KEY NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"media_type" text NOT NULL,
	"scan_status" "app"."scan_status" DEFAULT 'not_scanned' NOT NULL,
	"scan_provider" text,
	"scanned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."blob_refs" (
	"digest" text NOT NULL,
	"release_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "blob_refs_digest_release_id_role_pk" PRIMARY KEY("digest","release_id","role")
);
--> statement-breakpoint
CREATE TABLE "app"."blobs" (
	"digest" text PRIMARY KEY NOT NULL,
	"size" bigint NOT NULL,
	"media_type" text NOT NULL,
	"kind" "app"."blob_kind" NOT NULL,
	"in_public" boolean DEFAULT false NOT NULL,
	"in_private" boolean DEFAULT false NOT NULL,
	"status" "app"."blob_status" DEFAULT 'present' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blobs_digest_syntax" CHECK ("app"."blobs"."digest" ~ '^sha256:[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."blocked_digests" (
	"digest" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"action_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."build_artifacts" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"target" text NOT NULL,
	"blob_digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."release_fragments" (
	"release_id" uuid NOT NULL,
	"owner_ref" text NOT NULL,
	"fragment_id" text NOT NULL,
	"digest" text NOT NULL,
	CONSTRAINT "release_fragments_release_id_owner_ref_fragment_id_pk" PRIMARY KEY("release_id","owner_ref","fragment_id")
);
--> statement-breakpoint
CREATE TABLE "app"."release_locks" (
	"release_id" uuid NOT NULL,
	"dep_creation_id" uuid NOT NULL,
	"dep_release_id" uuid NOT NULL,
	"semantic_digest" text NOT NULL,
	"via" jsonb NOT NULL,
	CONSTRAINT "release_locks_release_id_dep_creation_id_pk" PRIMARY KEY("release_id","dep_creation_id")
);
--> statement-breakpoint
CREATE TABLE "app"."releases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creation_id" uuid NOT NULL,
	"label" text NOT NULL,
	"visibility" "app"."visibility" NOT NULL,
	"status" "app"."release_status" DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"publish_state" "app"."publish_state" DEFAULT 'pending' NOT NULL,
	"publish_report" jsonb,
	"revision_id" uuid,
	"source" jsonb NOT NULL,
	"source_digest" text,
	"semantic_digest" text NOT NULL,
	"lock_digest" text,
	"snapshot_digest" text,
	"context_ir_digest" text,
	"availability" "app"."release_availability",
	"effective_rating" "app"."rating",
	"license_check" "app"."license_check",
	"published_by" jsonb NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "releases_label_syntax" CHECK ("app"."releases"."label" ~ '^[0-9A-Za-z.+-]{1,64}$')
);
--> statement-breakpoint
CREATE TABLE "app"."reverse_edges" (
	"dep_creation_id" uuid NOT NULL,
	"dep_release_id" uuid NOT NULL,
	"dependent_creation_id" uuid NOT NULL,
	"dependent_release_id" uuid NOT NULL,
	"mode" "app"."edge_mode" NOT NULL,
	"rel" text,
	CONSTRAINT "reverse_edges_dep_release_id_dependent_release_id_pk" PRIMARY KEY("dep_release_id","dependent_release_id")
);
--> statement-breakpoint
CREATE TABLE "app"."uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"status" "app"."upload_status" DEFAULT 'uploaded' NOT NULL,
	"declared_type" text NOT NULL,
	"size" bigint NOT NULL,
	"staging_key" text NOT NULL,
	"result" jsonb,
	"reject_reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."contribution_changes" ADD CONSTRAINT "contribution_changes_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "app"."contributions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contributions" ADD CONSTRAINT "contributions_target_creation_id_creations_id_fk" FOREIGN KEY ("target_creation_id") REFERENCES "app"."creations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contributions" ADD CONSTRAINT "contributions_author_user_id_auth_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "app"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contributions" ADD CONSTRAINT "contributions_author_guest_id_guests_guest_id_fk" FOREIGN KEY ("author_guest_id") REFERENCES "app"."guests"("guest_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contributions" ADD CONSTRAINT "contributions_base_revision_id_revisions_id_fk" FOREIGN KEY ("base_revision_id") REFERENCES "app"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contributions" ADD CONSTRAINT "contributions_decided_by_auth_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "app"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."contributions" ADD CONSTRAINT "contributions_result_revision_id_revisions_id_fk" FOREIGN KEY ("result_revision_id") REFERENCES "app"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."creation_drafts" ADD CONSTRAINT "creation_drafts_creation_id_creations_id_fk" FOREIGN KEY ("creation_id") REFERENCES "app"."creations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."creation_drafts" ADD CONSTRAINT "creation_drafts_updated_by_auth_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "app"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."creation_redirects" ADD CONSTRAINT "creation_redirects_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "app"."namespaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."creation_redirects" ADD CONSTRAINT "creation_redirects_creation_id_creations_id_fk" FOREIGN KEY ("creation_id") REFERENCES "app"."creations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."creations" ADD CONSTRAINT "creations_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "app"."namespaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."favorites" ADD CONSTRAINT "favorites_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."favorites" ADD CONSTRAINT "favorites_creation_id_creations_id_fk" FOREIGN KEY ("creation_id") REFERENCES "app"."creations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."namespace_members" ADD CONSTRAINT "namespace_members_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "app"."namespaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."namespace_members" ADD CONSTRAINT "namespace_members_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."namespace_redirects" ADD CONSTRAINT "namespace_redirects_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "app"."namespaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."namespaces" ADD CONSTRAINT "namespaces_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reserved_names" ADD CONSTRAINT "reserved_names_created_by_auth_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."revision_fragments" ADD CONSTRAINT "revision_fragments_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "app"."revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."revisions" ADD CONSTRAINT "revisions_creation_id_creations_id_fk" FOREIGN KEY ("creation_id") REFERENCES "app"."creations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."revisions" ADD CONSTRAINT "revisions_author_user_id_auth_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "app"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."source_bindings" ADD CONSTRAINT "source_bindings_creation_id_creations_id_fk" FOREIGN KEY ("creation_id") REFERENCES "app"."creations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."source_bindings" ADD CONSTRAINT "source_bindings_installation_id_github_installations_installation_id_fk" FOREIGN KEY ("installation_id") REFERENCES "app"."github_installations"("installation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."api_tokens" ADD CONSTRAINT "api_tokens_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user_settings" ADD CONSTRAINT "user_settings_user_id_auth_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."auth_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."feature_flags" ADD CONSTRAINT "feature_flags_updated_by_auth_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "app"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."moderation_actions" ADD CONSTRAINT "moderation_actions_actor_id_auth_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "app"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."moderation_actions" ADD CONSTRAINT "moderation_actions_legal_request_id_legal_requests_id_fk" FOREIGN KEY ("legal_request_id") REFERENCES "app"."legal_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reports" ADD CONSTRAINT "reports_assignee_auth_user_id_fk" FOREIGN KEY ("assignee") REFERENCES "app"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."blob_refs" ADD CONSTRAINT "blob_refs_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "app"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."release_fragments" ADD CONSTRAINT "release_fragments_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "app"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."release_locks" ADD CONSTRAINT "release_locks_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "app"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."release_locks" ADD CONSTRAINT "release_locks_dep_creation_id_creations_id_fk" FOREIGN KEY ("dep_creation_id") REFERENCES "app"."creations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."release_locks" ADD CONSTRAINT "release_locks_dep_release_id_releases_id_fk" FOREIGN KEY ("dep_release_id") REFERENCES "app"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."releases" ADD CONSTRAINT "releases_creation_id_creations_id_fk" FOREIGN KEY ("creation_id") REFERENCES "app"."creations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."releases" ADD CONSTRAINT "releases_revision_id_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "app"."revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reverse_edges" ADD CONSTRAINT "reverse_edges_dep_creation_id_creations_id_fk" FOREIGN KEY ("dep_creation_id") REFERENCES "app"."creations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reverse_edges" ADD CONSTRAINT "reverse_edges_dep_release_id_releases_id_fk" FOREIGN KEY ("dep_release_id") REFERENCES "app"."releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reverse_edges" ADD CONSTRAINT "reverse_edges_dependent_creation_id_creations_id_fk" FOREIGN KEY ("dependent_creation_id") REFERENCES "app"."creations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reverse_edges" ADD CONSTRAINT "reverse_edges_dependent_release_id_releases_id_fk" FOREIGN KEY ("dependent_release_id") REFERENCES "app"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."uploads" ADD CONSTRAINT "uploads_owner_user_id_auth_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "app"."auth_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_changes_key_uq" ON "app"."contribution_changes" USING btree ("contribution_id","change_key");--> statement-breakpoint
CREATE UNIQUE INDEX "contributions_target_number_uq" ON "app"."contributions" USING btree ("target_creation_id","number");--> statement-breakpoint
CREATE INDEX "contributions_target_status_idx" ON "app"."contributions" USING btree ("target_creation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "creations_ns_name_uq" ON "app"."creations" USING btree ("namespace_id","name");--> statement-breakpoint
CREATE INDEX "creations_search_trgm_idx" ON "app"."creations" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "creations_search_grams_idx" ON "app"."creations" USING gin ("search_grams");--> statement-breakpoint
CREATE INDEX "creations_tags_idx" ON "app"."creations" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "favorites_creation_idx" ON "app"."favorites" USING btree ("creation_id");--> statement-breakpoint
CREATE INDEX "namespace_members_user_idx" ON "app"."namespace_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "namespaces_slug_uq" ON "app"."namespaces" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "revision_fragments_digest_idx" ON "app"."revision_fragments" USING btree ("digest");--> statement-breakpoint
CREATE INDEX "revisions_creation_idx" ON "app"."revisions" USING btree ("creation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "source_bindings_creation_uq" ON "app"."source_bindings" USING btree ("creation_id");--> statement-breakpoint
CREATE INDEX "source_bindings_repo_idx" ON "app"."source_bindings" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_hash_uq" ON "app"."api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_tokens_user_idx" ON "app"."api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_user_email_uq" ON "app"."auth_user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "audit_log_subject_idx" ON "app"."audit_log" USING btree ("subject");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "app"."audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "app"."reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "blob_refs_digest_idx" ON "app"."blob_refs" USING btree ("digest");--> statement-breakpoint
CREATE INDEX "blob_refs_release_idx" ON "app"."blob_refs" USING btree ("release_id");--> statement-breakpoint
CREATE INDEX "release_fragments_digest_idx" ON "app"."release_fragments" USING btree ("digest");--> statement-breakpoint
CREATE UNIQUE INDEX "releases_creation_label_uq" ON "app"."releases" USING btree ("creation_id","label");--> statement-breakpoint
CREATE INDEX "releases_semantic_idx" ON "app"."releases" USING btree ("semantic_digest");--> statement-breakpoint
CREATE INDEX "reverse_edges_dep_creation_idx" ON "app"."reverse_edges" USING btree ("dep_creation_id");--> statement-breakpoint
CREATE INDEX "reverse_edges_dependent_idx" ON "app"."reverse_edges" USING btree ("dependent_release_id");--> statement-breakpoint
CREATE INDEX "uploads_owner_idx" ON "app"."uploads" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "uploads_status_idx" ON "app"."uploads" USING btree ("status","expires_at");