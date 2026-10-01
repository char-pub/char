/** Exact-work consent must still match the current draft license; no namespace role is inferred. */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Principal } from "../authz/authorize.js";
import type { Executor } from "../db/client.js";
import { creationCollaborators, creationDrafts } from "../db/schema/index.js";

export async function collaborationAccess(
  db: Executor,
  creationId: string,
  principal: Principal,
): Promise<boolean> {
  if (principal.kind !== "user") return false;
  const [accepted] = await db
    .select({ userId: creationCollaborators.userId })
    .from(creationCollaborators)
    .innerJoin(creationDrafts, eq(creationDrafts.creationId, creationCollaborators.creationId))
    .where(
      and(
        eq(creationCollaborators.creationId, creationId),
        eq(creationCollaborators.userId, principal.user_id),
        isNotNull(creationCollaborators.acceptedAt),
        eq(
          creationCollaborators.license,
          sql<string>`${creationDrafts.working}->'meta'->>'license'`,
        ),
      ),
    )
    .limit(1);
  return accepted !== undefined;
}
