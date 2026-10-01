/** Registry-issued temporary builds. Pure Core identity never grants access by itself. */
import { runAssemblyTests } from "@char-pub/assembler";
import {
  CharError,
  CreationArtifactSchema,
  canonicalizeCreation,
  checkDraftBuild,
  digestOf,
  ExactRefSchema,
} from "@char-pub/core";
import { and, eq, gt, gte, inArray, isNull } from "drizzle-orm";
import type { Services } from "../api/app.js";
import { appendAudit } from "../audit/audit.js";
import { authorize, type Principal } from "../authz/authorize.js";
import type { Executor } from "../db/client.js";
import {
  authUser,
  creationDrafts,
  creations,
  draftBuilds,
  namespaces,
} from "../db/schema/index.js";
import { QUEUE_NAMES } from "../jobs/definitions.js";
import { assertRootAssetOwnership } from "./asset-ownership.js";
import { loadClosure, loadContentRegistryState } from "./closure.js";
import { loadRevisionContent } from "./content.js";
import { assertDerivationSource } from "./derivations.js";
import { forceIdentity } from "./drafts.js";
import { encodeId } from "./ids.js";
import { lookupCreation } from "./lookup.js";
import { createRevision } from "./publish.js";
import { readSourceText } from "./source-text.js";

export const DRAFT_BUILDER = "story-v1.2";
export const DRAFT_BUILD_LIFETIME_MS = 7 * 24 * 60 * 60_000;
export type DraftBuildRow = typeof draftBuilds.$inferSelect;
export type DraftServices = Omit<Services, "db"> & { db: Executor };

export function draftOrigin(row: DraftBuildRow) {
  return {
    kind: "draft-build" as const,
    build_id: encodeId("draft_build", row.id),
    revision: encodeId("revision", row.revisionId),
    expires_at: row.expiresAt.toISOString(),
  };
}
export function draftBuildResponse(row: DraftBuildRow, now: Date) {
  return {
    origin: draftOrigin(row),
    state: row.state !== "deleted" && row.expiresAt <= now ? ("expired" as const) : row.state,
    draft_version: row.draftVersion,
    semantic_digest: row.semanticDigest,
    ...(row.lockDigest ? { lock_digest: row.lockDigest } : {}),
    ...(row.artifactDigest ? { artifact_digest: row.artifactDigest } : {}),
    ...(row.report ? { report: row.report } : {}),
  };
}
export function payloadStore(services: DraftServices) {
  if (!services.draftPayloads)
    throw new CharError({ code: "draft_build.storage_unavailable", subject: "registry" });
  return services.draftPayloads;
}
export function requireLiveBuild(row: DraftBuildRow, now: Date) {
  if (row.state === "deleted" || row.state === "expired" || row.expiresAt <= now)
    throw new CharError({ code: "draft_build.expired", subject: encodeId("draft_build", row.id) });
}

/** Transactions that also lock a draft/build must acquire this permission lock first. */
export async function lockDraftBuildCreation(db: Executor, creationId: string) {
  const [row] = await db
    .select({ id: creations.id })
    .from(creations)
    .where(eq(creations.id, creationId))
    .for("update");
  if (!row) throw new CharError({ code: "draft_build.not_found", subject: creationId });
}

/** Reload mutable account, membership and work state; worker must not invent banned:false. */
export async function buildCreationContext(
  db: Executor,
  creationId: string,
  principal: Principal,
  now: Date,
) {
  const [work] = await db
    .select({ creation: creations, ns: namespaces })
    .from(creations)
    .innerJoin(namespaces, eq(namespaces.id, creations.namespaceId))
    .where(eq(creations.id, creationId));
  if (!work) throw new CharError({ code: "draft_build.not_found", subject: creationId });
  let current = principal;
  if (principal.kind === "user") {
    const [user] = await db.select().from(authUser).where(eq(authUser.id, principal.user_id));
    if (!user) throw new CharError({ code: "draft_build.not_found", subject: creationId });
    current = { ...principal, banned: user.banned && (!user.banExpires || user.banExpires > now) };
  }
  const context = await lookupCreation(db, work.ns.slug, work.creation.name, current);
  if (!context) throw new CharError({ code: "draft_build.not_found", subject: creationId });
  return { context, principal: current };
}

export async function requestDraftBuild(
  services: Services,
  input: { creationId: string; version: number; principal: Principal },
) {
  if (input.principal.kind !== "user")
    throw new CharError({ code: "auth.required", subject: input.creationId });
  payloadStore(services);
  const requesterId = input.principal.user_id;
  const requesterTokenId = input.principal.token_id;
  const requesterScopes = input.principal.scopes;
  if (requesterScopes && !requesterTokenId)
    throw new CharError({ code: "auth.invalid_token", subject: input.creationId });
  return services.db.transaction(async (tx) => {
    await lockDraftBuildCreation(tx, input.creationId);
    const disabled = await services.flags();
    const [draft] = await tx
      .select()
      .from(creationDrafts)
      .where(eq(creationDrafts.creationId, input.creationId))
      .for("update");
    if (!draft || draft.version !== input.version)
      throw new CharError({ code: "draft.version_conflict", subject: input.creationId });
    const { context, principal } = await buildCreationContext(
      tx,
      input.creationId,
      input.principal,
      services.clock.now(),
    );
    const decision = authorize(principal, "creation.edit", context.resource, {
      disabled,
    });
    if (!decision.allow) throw new CharError({ code: decision.code, subject: input.creationId });
    const read = authorize(principal, "creation.read_build", context.resource);
    if (!read.allow) throw new CharError({ code: read.code, subject: input.creationId });
    const canonical = canonicalizeCreation(
      forceIdentity(draft.working as Record<string, unknown>, {
        id: encodeId("creation", context.creation.id),
        ref: `@${context.ns.slug}/${context.creation.name}`,
        type: context.creation.type,
      }),
    );
    const needsDefault =
      !["preset", "prompt-module"].includes(canonical.creation.type) &&
      !canonical.creation.assembly;
    if (needsDefault && !services.defaultPolicy)
      throw new CharError({
        code: "draft_build.default_policy_unavailable",
        subject: input.creationId,
      });
    const policy = needsDefault ? services.defaultPolicy : undefined;
    const configDigest = digestOf({ builder: DRAFT_BUILDER, default_policy: policy ?? null });
    const now = services.clock.now();
    const [cached] = await tx
      .select()
      .from(draftBuilds)
      .where(
        and(
          eq(draftBuilds.creationId, input.creationId),
          eq(draftBuilds.requesterId, requesterId),
          requesterTokenId
            ? eq(draftBuilds.requesterTokenId, requesterTokenId)
            : isNull(draftBuilds.requesterTokenId),
          eq(draftBuilds.semanticDigest, canonical.semantic_digest),
          eq(draftBuilds.configDigest, configDigest),
          inArray(draftBuilds.state, ["pending", "ready"]),
          gt(draftBuilds.expiresAt, now),
        ),
      )
      .limit(1)
      .for("update");
    if (cached) {
      if (cached.state === "ready")
        await validateDraftBuild({ ...services, db: tx }, cached, principal);
      return { row: cached, reused: true };
    }
    const recent = await tx
      .select({
        id: draftBuilds.id,
        state: draftBuilds.state,
        expires: draftBuilds.expiresAt,
        created: draftBuilds.createdAt,
      })
      .from(draftBuilds)
      .where(
        and(
          eq(draftBuilds.creationId, input.creationId),
          gte(draftBuilds.expiresAt, new Date(now.getTime() - 60 * 60_000)),
        ),
      );
    const limits = services.draftBuildLimits ?? { retained: 20, perHour: 60 };
    if (
      recent.filter((r) => r.expires > now && !["expired", "deleted"].includes(r.state)).length >=
        limits.retained ||
      recent.filter((r) => r.created >= new Date(now.getTime() - 60 * 60_000)).length >=
        limits.perHour
    )
      throw new CharError({ code: "draft_build.limit", subject: input.creationId });
    const revision = await createRevision(
      { ...services, db: tx },
      {
        creationId: input.creationId,
        canonical,
        parentId: draft.baseRevisionId,
        author: { kind: "user", userId: requesterId },
        message: "Draft preview",
        actor: { kind: "user", id: requesterId },
        requestId: null,
        updateDraftBase: true,
      },
    );
    const [row] = await tx
      .insert(draftBuilds)
      .values({
        id: services.ids.uuid(),
        creationId: input.creationId,
        revisionId: revision.row.id,
        requesterId,
        requesterTokenId: requesterTokenId ?? null,
        requesterScopes: requesterScopes ? [...requesterScopes] : null,
        draftVersion: draft.version,
        builder: DRAFT_BUILDER,
        configDigest,
        defaultPolicy: policy ?? null,
        semanticDigest: canonical.semantic_digest,
        expiresAt: new Date(now.getTime() + DRAFT_BUILD_LIFETIME_MS),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("draft build insert failed");
    await services.queue.enqueue(
      tx,
      QUEUE_NAMES.draftBuild,
      { build_id: row.id },
      { singletonKey: `draft:${row.id}` },
    );
    await appendAudit(tx, {
      at: now,
      actor: { kind: "user", id: requesterId },
      action: "draft_build.request",
      subject: `draft_build:${row.id}`,
      after: { revision: row.revisionId, version: row.draftVersion },
    });
    return { row, reused: false };
  });
}

/** Recomputed on cache reads: exact dependency access and mutable registry checks never cache. */
export async function validateDraftBuild(
  services: DraftServices,
  row: DraftBuildRow,
  principal: Principal,
) {
  requireLiveBuild(row, services.clock.now());
  const { context, principal: current } = await buildCreationContext(
    services.db,
    row.creationId,
    principal,
    services.clock.now(),
  );
  const allowed = authorize(current, "creation.read_build", context.resource);
  if (!allowed.allow) throw new CharError({ code: allowed.code, subject: row.creationId });
  if (row.builder !== DRAFT_BUILDER)
    throw new CharError({ code: "draft_build.builder_mismatch", subject: row.id });
  const canonical = await loadRevisionContent(services.cas, row.semanticDigest);
  await assertDerivationSource(services.db, row.creationId, canonical.creation);
  const policy = row.defaultPolicy ? ExactRefSchema.parse(row.defaultPolicy) : undefined;
  const closure = await loadClosure(
    services.db,
    services.cas,
    canonical.creation,
    current,
    policy ? [policy] : [],
  );
  if (closure.denied.length || closure.unavailable.length)
    throw new CharError({ code: "draft_build.dependency_unavailable", subject: row.id });
  const dependencies = [...closure.releases.values()].map((r) => r.input);
  const definitions = [
    canonical.creation,
    ...dependencies.map((d) => canonicalizeCreation(d.creation).creation),
  ];
  const digests = new Set<string>(),
    assets = new Set<string>();
  for (const creation of definitions) {
    digests.add(canonicalizeCreation(creation).semantic_digest);
    for (const fragment of creation.fragments) digests.add(fragment.digest);
    for (const block of creation.policy?.blocks ?? creation.prompt_module?.blocks ?? [])
      digests.add(digestOf(block));
    for (const asset of creation.assets ?? [])
      for (const variant of asset.variants) assets.add(variant.blob.digest);
  }
  const registry = await loadContentRegistryState(services.db, {
    namespaceSlug: context.ns.slug,
    publisherUserId: row.requesterId,
    digests: [...digests, ...assets],
    assetDigests: [...assets],
  });
  const report = checkDraftBuild({
    creation: canonical.json,
    origin: draftOrigin(row),
    dependencies,
    ...(policy ? { default_policy: policy } : {}),
    registry,
    publicAssetBaseUrl: services.publicAssetBaseUrl,
  });
  if (!report.ok || !report.build)
    throw new CharError({
      code: "draft_build.check_failed",
      subject: row.id,
      data: { issues: report.issues },
    });
  if (row.state === "ready" && report.build.digest !== row.artifactDigest)
    throw new CharError({ code: "draft_build.artifact_mismatch", subject: row.id });
  await assertRootAssetOwnership(services.db, services.cas, report.build.artifact, {
    creationId: row.creationId,
    publisherId: row.requesterId,
    publicAssetBaseUrl: services.publicAssetBaseUrl,
  });
  if (report.build.artifact.kind === "content")
    for (const source of report.build.artifact.catalog_index.sources)
      await readSourceText(services.db, services.cas, report.build.artifact, source.id, true);
  return { canonical, dependencies, policy, report, build: report.build };
}

export async function readDraftArtifact(
  services: DraftServices,
  row: DraftBuildRow,
  principal: Principal,
) {
  if (row.state !== "ready" || !row.artifactDigest)
    throw new CharError({ code: "draft_build.not_ready", subject: row.id });
  const { build } = await validateDraftBuild(services, row, principal);
  if (build.digest !== row.artifactDigest)
    throw new CharError({ code: "draft_build.artifact_mismatch", subject: row.id });
  const bytes = await payloadStore(services).readPayload(
    encodeId("draft_build", row.id),
    "artifact",
    row.artifactDigest,
  );
  return CreationArtifactSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
}

export async function testDraftBuild(
  services: DraftServices,
  row: DraftBuildRow,
  validated: Awaited<ReturnType<typeof validateDraftBuild>>,
) {
  if (!validated.canonical.creation.assembly_tests?.length) return;
  const result = await runAssemblyTests({
    root: { creation: validated.canonical.json, visibility: "private", origin: draftOrigin(row) },
    dependencies: validated.dependencies,
    ...(validated.policy ? { default_policy: validated.policy } : {}),
    publicAssetBaseUrl: services.publicAssetBaseUrl,
  });
  if (!result.ok)
    throw new CharError({
      code: "draft_build.assembly_tests_failed",
      subject: row.id,
      data: { results: result.results },
    });
  return result.results;
}
