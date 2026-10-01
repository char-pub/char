/** Author-only impact checks over immutable definitions and readable downstream artifacts. */
import { ReferenceImpactResponseSchema } from "@char-pub/contracts";
import {
  CharError,
  type CreationArtifact,
  canonicalizeCreation,
  type PublishedDefinition,
  publishedObjectUses,
  removedCreationObjects,
} from "@char-pub/core";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Principal } from "../authz/authorize.js";
import {
  creationCollaborators,
  creationDrafts,
  creations,
  namespaceMembers,
  namespaces,
  releaseLocks,
  releases,
} from "../db/schema/index.js";
import { authorizedRelease, readArtifact } from "./artifacts.js";
import { loadRevisionContent, loadSnapshot } from "./content.js";
import { type DraftBuildRow, type DraftServices, draftOrigin } from "./draft-builds.js";
import { decodeId, encodeId } from "./ids.js";

export async function referenceImpact(
  services: DraftServices,
  input: {
    row: DraftBuildRow;
    artifact: CreationArtifact;
    principal: Principal;
    baseRelease: string;
    cursor?: string;
    limit: number;
  },
) {
  try {
    const { db, cas } = services;
    const { row, principal } = input;
    const baseline = await authorizedRelease(db, principal, input.baseRelease);
    if (
      !baseline ||
      baseline.row.creationId !== row.creationId ||
      baseline.row.status === "tombstoned"
    )
      throw new CharError({ code: "reference_impact.base_not_found", subject: input.baseRelease });
    const [before, after, baseArtifact] = await Promise.all([
      loadRevisionContent(cas, baseline.row.semanticDigest),
      loadRevisionContent(cas, row.semanticDigest),
      readArtifact(cas, baseline.row, services.publicAssetBaseUrl),
    ]);
    if (input.artifact.root.semantic_digest !== after.semantic_digest)
      throw new CharError({ code: "reference_impact.candidate_mismatch", subject: row.id });
    const objects = removedCreationObjects(before.creation, after.creation);
    const base = baseArtifact.root;
    const cursor = input.cursor ? decodeId("release", input.cursor) : null;
    if (input.cursor && !cursor)
      throw new CharError({ code: "reference_impact.invalid_cursor", subject: "cursor" });
    const readPrivate =
      principal.kind === "user" &&
      (!principal.scopes || principal.scopes.includes("creations:read"));
    // SQL narrows the candidate page before LIMIT; centralized release.read rechecks every returned release.
    // A private dependency cannot affect the cursor, result length or an aggregate count for an unauthorized reader.
    const privateAccess = readPrivate
      ? sql`(
    exists(select 1 from ${namespaceMembers} where ${namespaceMembers.namespaceId}=${namespaces.id}
      and ${namespaceMembers.userId}=${principal.user_id}
      and (${namespaceMembers.role}='owner' or (${namespaces.kind}='system' and ${namespaceMembers.role}='maintainer')))
    or exists(select 1 from ${creationCollaborators} inner join ${creationDrafts}
      on ${creationDrafts.creationId}=${creationCollaborators.creationId}
      where ${creationCollaborators.creationId}=${creations.id} and ${creationCollaborators.userId}=${principal.user_id}
      and ${creationCollaborators.acceptedAt} is not null
      and ${creationCollaborators.license}=${creationDrafts.working}->'meta'->>'license')
  )`
      : sql`false`;
    const candidates = await db
      .select({ row: releases, creation: creations, namespace: namespaces })
      .from(releases)
      .innerJoin(creations, eq(creations.id, releases.creationId))
      .innerJoin(namespaces, eq(namespaces.id, creations.namespaceId))
      .where(
        and(
          eq(releases.publishState, "done"),
          sql`${releases.status}<>'tombstoned'`,
          sql`exists(select 1 from ${releaseLocks} where ${releaseLocks.releaseId}=${releases.id} and ${releaseLocks.depCreationId}=${row.creationId})`,
          sql`(${privateAccess} or (${releases.visibility}='public' and ${creations.status}='active' and ${namespaces.status}='active'))`,
          cursor ? lt(releases.id, cursor) : sql`true`,
        ),
      )
      .orderBy(desc(releases.id))
      .limit(input.limit + 1);
    const readable = [];
    for (const candidate of candidates) {
      const allowed = await authorizedRelease(db, principal, encodeId("release", candidate.row.id));
      if (!allowed)
        throw new CharError({
          code: "reference_impact.scan_unavailable",
          subject: "readable releases",
          detail: "Read authorization changed while checking dependencies. Retry the report.",
        });
      readable.push(allowed);
    }
    const page = readable.slice(0, input.limit);
    const locks = page.length
      ? await db
          .select()
          .from(releaseLocks)
          .where(
            and(
              eq(releaseLocks.depCreationId, row.creationId),
              inArray(
                releaseLocks.releaseId,
                page.map((item) => item.row.id),
              ),
            ),
          )
      : [];
    const items = [];
    const visibleDefinitions = new Map<string, boolean>();
    for (const candidate of page) {
      if (!candidate.row.snapshotDigest)
        throw new CharError({
          code: "reference_impact.snapshot_unavailable",
          subject: encodeId("release", candidate.row.id),
        });
      const [artifact, snapshot] = await Promise.all([
        readArtifact(cas, candidate.row, services.publicAssetBaseUrl),
        loadSnapshot(cas, candidate.row.visibility, candidate.row.snapshotDigest),
      ]);
      const own = canonicalizeCreation(snapshot.root);
      if (own.semantic_digest !== artifact.root.semantic_digest)
        throw new CharError({
          code: "reference_impact.snapshot_mismatch",
          subject: artifact.root.release,
        });
      const definitions: PublishedDefinition[] = [
        { identity: artifact.root, creation: own.creation },
        ...snapshot.dependencies.map((dependency) => {
          const canonical = canonicalizeCreation(dependency.creation);
          if (
            canonical.semantic_digest !== dependency.semantic_digest ||
            canonical.creation.ref !== dependency.ref
          )
            throw new CharError({
              code: "reference_impact.snapshot_mismatch",
              subject: dependency.release,
            });
          return {
            identity: {
              ref: dependency.ref,
              release: dependency.release,
              semantic_digest: dependency.semantic_digest,
            },
            creation: canonical.creation,
          };
        }),
      ];
      const pins = locks
        .filter((lock) => lock.releaseId === candidate.row.id)
        .map((lock) => {
          const source = definitions.find(
            (definition) => definition.identity.release === encodeId("release", lock.depReleaseId),
          );
          if (
            !source ||
            source.creation.id !== before.creation.id ||
            source.identity.semantic_digest !== lock.semanticDigest
          )
            throw new CharError({
              code: "reference_impact.snapshot_mismatch",
              subject: artifact.root.release,
            });
          return source.identity;
        });
      const uses = pins.flatMap((target) =>
        publishedObjectUses({ objects, target, artifact, definitions }),
      );
      // A readable containing release does not grant independent access to every private origin.
      // Exact included paths concern the already readable containing artifact; explicit authorship
      // is disclosed only when that definition's own Release is readable too.
      for (const use of uses) {
        const release = use.defined_in.release;
        if (!visibleDefinitions.has(release))
          visibleDefinitions.set(
            release,
            (await authorizedRelease(db, principal, release)) !== null,
          );
      }
      items.push({
        ref: `@${candidate.namespace.slug}/${candidate.creation.name}`,
        display_name: own.creation.display_name,
        release: {
          id: artifact.root.release,
          label: candidate.row.label,
          visibility: candidate.row.visibility,
        },
        pins,
        uses: uses.filter((use) => visibleDefinitions.get(use.defined_in.release)),
      });
    }
    return ReferenceImpactResponseSchema.parse({
      base,
      candidate: { origin: draftOrigin(row), semantic_digest: after.semantic_digest },
      objects,
      items,
      next_cursor:
        readable.length > input.limit && page.length
          ? encodeId("release", page[page.length - 1]?.row.id ?? "")
          : null,
      scope: "readable-published-releases",
    });
  } catch (cause) {
    if (
      cause instanceof CharError &&
      ["reference_impact.base_not_found", "reference_impact.invalid_cursor"].includes(cause.code)
    )
      throw cause;
    // Snapshot/Resolver failures may mention unreadable intermediate definitions. Never serialize
    // their subject/detail/data. The non-enumerable cause remains available for internal debugging.
    const error = new CharError({
      code: "reference_impact.scan_unavailable",
      subject: input.baseRelease,
      detail:
        "The readable dependency scan could not be completed. Retry before relying on the report.",
    });
    Object.defineProperty(error, "cause", { value: cause });
    throw error;
  }
}
