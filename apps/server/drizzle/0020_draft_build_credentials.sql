ALTER TABLE "app"."draft_builds" ADD COLUMN "requester_token_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."draft_builds" ADD COLUMN "requester_scopes" text[];
--> statement-breakpoint
-- Existing temporary builds have no trustworthy credential provenance. Rebuild them under the new contract.
UPDATE "app"."draft_builds" SET "state" = 'expired', "expires_at" = LEAST("expires_at", now()), "updated_at" = now() WHERE "state" IN ('pending', 'ready');
