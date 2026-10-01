import { CharError, isCharError } from "@char-pub/core";
import { and, eq, gt, inArray, isNull, lt, lte, or } from "drizzle-orm";
import type { Services } from "../api/app.js";
import { principalFromStoredToken } from "../auth/tokens.js";
import { authorize, type Principal } from "../authz/authorize.js";
import { draftBuilds } from "../db/schema/index.js";
import { QUEUE_NAMES } from "../jobs/definitions.js";
import {
  buildCreationContext,
  lockDraftBuildCreation,
  payloadStore,
  testDraftBuild,
  validateDraftBuild,
} from "../registry/draft-builds.js";
import { encodeId } from "../registry/ids.js";

export interface DraftBuildJob {
  build_id: string;
}

export async function handleDraftBuild(services: Services, job: DraftBuildJob) {
  const disabled = await services.flags();
  if (disabled.has("read_only")) return "deferred";
  // Locate the immutable parent without taking a build lock; all permission writes
  // serialize on creation first, then draft/build, never in the opposite order.
  const [parent] = await services.db
    .select({ creationId: draftBuilds.creationId })
    .from(draftBuilds)
    .where(eq(draftBuilds.id, job.build_id));
  if (!parent) return "skipped";
  return services.db.transaction(async (tx) => {
    await lockDraftBuildCreation(tx, parent.creationId);
    const [row] = await tx
      .select()
      .from(draftBuilds)
      .where(eq(draftBuilds.id, job.build_id))
      .for("update");
    if (row?.state !== "pending") return "skipped";
    const now = services.clock.now();
    if (row.expiresAt <= now) {
      await tx
        .update(draftBuilds)
        .set({ state: "expired", updatedAt: now })
        .where(eq(draftBuilds.id, row.id));
      return "expired";
    }
    const deps = { ...services, db: tx };
    try {
      let requester: Principal = { kind: "user", user_id: row.requesterId, banned: false };
      if (row.requesterTokenId) {
        const live = await principalFromStoredToken(tx, row.requesterTokenId, row.requesterId, now);
        if (live?.kind !== "user" || !row.requesterScopes)
          throw new CharError({ code: "auth.invalid_token", subject: row.id });
        requester = {
          ...live,
          scopes: (live.scopes ?? []).filter((scope) => row.requesterScopes?.includes(scope)),
        };
      }
      const { context, principal } = await buildCreationContext(tx, row.creationId, requester, now);
      const allowed = authorize(principal, "creation.edit", context.resource, {
        disabled: await services.flags(),
      });
      if (!allowed.allow) {
        if (allowed.code === "feature.read_only") return "deferred";
        await tx
          .update(draftBuilds)
          .set({ state: "failed", report: { issues: [{ code: allowed.code }] }, updatedAt: now })
          .where(eq(draftBuilds.id, row.id));
        return "failed";
      }
      const validated = await validateDraftBuild(deps, row, principal);
      const authorTests = await testDraftBuild(deps, row, validated);
      await payloadStore(deps).writePayload(
        encodeId("draft_build", row.id),
        "artifact",
        new TextEncoder().encode(validated.build.json),
        { digest: validated.build.digest },
      );
      const finished = services.clock.now();
      // The same row lock serializes finish and deletion. Expiry may pass during storage IO.
      await tx
        .update(draftBuilds)
        .set({
          state: row.expiresAt <= finished ? "expired" : "ready",
          artifactDigest: validated.build.digest,
          lockDigest: validated.build.artifact.lock_digest,
          report: {
            issues: validated.report.issues,
            license_check: validated.report.license_check,
            ...(authorTests ? { assembly_tests: authorTests } : {}),
          },
          updatedAt: finished,
        })
        .where(eq(draftBuilds.id, row.id));
      return row.expiresAt <= finished ? "expired" : "ready";
    } catch (error) {
      if (!isCharError(error)) throw error;
      await tx
        .update(draftBuilds)
        .set({
          state: "failed",
          report: {
            issues: [
              {
                code: error.code,
                subject: error.subject,
                ...(error.data ? { data: error.data } : {}),
              },
            ],
          },
          updatedAt: services.clock.now(),
        })
        .where(eq(draftBuilds.id, row.id));
      return "failed";
    }
  });
}

export async function failDraftBuild(services: Services, id: string) {
  await services.db
    .update(draftBuilds)
    .set({
      state: "failed",
      report: { issues: [{ code: "draft_build.worker_failed" }] },
      updatedAt: services.clock.now(),
    })
    .where(and(eq(draftBuilds.id, id), eq(draftBuilds.state, "pending")));
}

export async function requeueDraftBuilds(services: Services) {
  if ((await services.flags()).has("read_only")) return 0;
  const now = services.clock.now();
  const rows = await services.db
    .select({ id: draftBuilds.id })
    .from(draftBuilds)
    .where(
      and(
        eq(draftBuilds.state, "pending"),
        gt(draftBuilds.expiresAt, now),
        lt(draftBuilds.updatedAt, new Date(now.getTime() - 5 * 60_000)),
      ),
    )
    .limit(500);
  let count = 0;
  for (const row of rows)
    if (
      await services.queue.enqueue(
        services.db,
        QUEUE_NAMES.draftBuild,
        { build_id: row.id },
        { singletonKey: `draft:${row.id}` },
      )
    )
      count++;
  return count;
}

/** Only dedicated build keys are deleted; uploaded/shared CAS assets remain intact. */
export async function expireDraftBuilds(services: Services) {
  return services.db.transaction(async (tx) => {
    const now = services.clock.now();
    const rows = await tx
      .select()
      .from(draftBuilds)
      .where(
        and(
          isNull(draftBuilds.payloadDeletedAt),
          or(lte(draftBuilds.expiresAt, now), inArray(draftBuilds.state, ["deleted", "expired"])),
        ),
      )
      .limit(100)
      .for("update", { skipLocked: true });
    for (const row of rows) {
      await payloadStore(services).deleteBuild(encodeId("draft_build", row.id));
      await tx
        .update(draftBuilds)
        .set({
          state: row.state === "deleted" ? "deleted" : "expired",
          payloadDeletedAt: now,
          report: null,
          updatedAt: now,
        })
        .where(eq(draftBuilds.id, row.id));
    }
    return rows.length;
  });
}

export async function registerDraftBuildWorkers(services: Services) {
  await services.queue.work<DraftBuildJob>(
    QUEUE_NAMES.draftBuild,
    async (job) => {
      await handleDraftBuild(services, job.data);
    },
    {
      onFinalFailure: async (job) => {
        await failDraftBuild(services, job.data.build_id);
      },
    },
  );
  await services.queue.work(QUEUE_NAMES.draftBuildRequeue, async () => {
    await requeueDraftBuilds(services);
  });
  await services.queue.boss.schedule(QUEUE_NAMES.draftBuildRequeue, "*/5 * * * *");
  await services.queue.work(QUEUE_NAMES.draftBuildExpire, async () => {
    await expireDraftBuilds(services);
  });
  await services.queue.boss.schedule(QUEUE_NAMES.draftBuildExpire, "*/10 * * * *");
}
