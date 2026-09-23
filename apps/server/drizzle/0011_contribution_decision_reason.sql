ALTER TABLE "app"."contributions" ADD COLUMN "decision_reason" text;--> statement-breakpoint
-- 以前拒绝理由只写进审计日志。把已经拒绝的 Contribution 的理由从审计记录里补回这一列，
-- 提交者才能在详情里看到；空库上这条语句什么也不改。
UPDATE "app"."contributions" AS c
SET "decision_reason" = a."after"->>'reason'
FROM "app"."audit_log" AS a
WHERE c."status" = 'rejected'
  AND c."decision_reason" IS NULL
  AND a."action" = 'contribution.reject'
  AND a."subject" = 'contribution:' || c."id"::text
  AND a."after" ? 'reason';
