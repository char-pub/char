/** Verified published sources for new works; source identity survives subsequent draft edits. */
import type { DeriveCreationRequest } from "@char-pub/contracts";
import {
  type CanonicalCreation,
  CharError,
  canonicalizeCreation,
  checkCreation,
  checkDependencyLicense,
  deriveCreation,
  sameBuildIdentity,
} from "@char-pub/core";
import { and, eq } from "drizzle-orm";
import type { Services } from "../api/app.js";
import { appendAudit } from "../audit/audit.js";
import { authorize, type Principal } from "../authz/authorize.js";
import type { Executor } from "../db/client.js";
import {
  creationAssetGrants,
  creationDerivations,
  creationDrafts,
  creationRedirects,
  creations,
  namespaces,
} from "../db/schema/index.js";
import { authorizedRelease, readArtifact } from "./artifacts.js";
import { loadRevisionContent } from "./content.js";
import { encodeId } from "./ids.js";
import { lookupNamespace } from "./lookup.js";

/** The verified source may not be erased by a new Revision, raw draft or external Source. */
export async function assertDerivationSource(
  db: Executor,
  creationId: string,
  creation: CanonicalCreation,
) {
  const [record] = await db
    .select()
    .from(creationDerivations)
    .where(eq(creationDerivations.creationId, creationId));
  if (!record) return;
  if (
    !creation.provenance.derived_from?.some(
      (source) =>
        "ref" in source &&
        source.release === record.source.release &&
        source.ref === record.source.ref &&
        source.semantic_digest === record.source.semantic_digest &&
        source.relation === record.kind,
    )
  )
    throw new CharError({
      code: "check.derivation_source_required",
      subject: creation.ref,
      detail: "Keep the original exact source in this work's derivation history.",
    });
}

export async function createDerivation(
  services: Services,
  principal: Principal,
  slug: string,
  input: DeriveCreationRequest,
  requestId: string | null,
) {
  if (principal.kind !== "user") throw new CharError({ code: "auth.required", subject: slug });
  const userId = principal.user_id;
  const agent = input.agent === true || principal.agent === true;
  return services.db.transaction(async (tx) => {
    // Serialize names and recheck destination ownership inside the transaction.
    await tx
      .select({ id: namespaces.id })
      .from(namespaces)
      .where(eq(namespaces.slug, slug))
      .for("update");
    const ns = await lookupNamespace(tx, slug, principal);
    if (ns.kind !== "found" || ns.ns.kind !== "user" || ns.ctx.role !== "owner")
      throw new CharError({ code: "derivation.not_found", subject: slug });
    const allowed = authorize(
      principal,
      "creation.create",
      { type: "namespace", ns: ns.ctx },
      { disabled: await services.flags() },
    );
    if (!allowed.allow) throw new CharError({ code: allowed.code, subject: slug });
    const source = await authorizedRelease(tx, principal, input.source.release);
    if (!source)
      throw new CharError({ code: "derivation.not_found", subject: input.source.release });
    if (source.row.status === "tombstoned")
      throw new CharError({ code: "release.tombstoned", subject: input.source.release });
    if (source.row.status !== "active")
      throw new CharError({
        code: "check.derivation_source_inactive",
        subject: input.source.release,
      });
    const definition = await loadRevisionContent(services.cas, source.row.semanticDigest);
    if (
      definition.semantic_digest !== input.source.semantic_digest ||
      definition.creation.ref !== input.source.ref
    )
      throw new CharError({
        code: "check.derivation_source_mismatch",
        subject: input.source.release,
      });
    const artifact = await readArtifact(services.cas, source.row, services.publicAssetBaseUrl);
    if (
      !("release" in artifact.root) ||
      artifact.root.release !== input.source.release ||
      artifact.root.ref !== input.source.ref ||
      artifact.root.semantic_digest !== input.source.semantic_digest
    )
      throw new CharError({
        code: "check.derivation_source_mismatch",
        subject: input.source.release,
      });
    const copiedLicenses = [
      { ref: definition.creation.ref, license: definition.creation.meta.license, modified: true },
      ...artifact.assets
        .filter((asset) => sameBuildIdentity(asset.origin, artifact.root))
        .map((asset) => ({ ref: asset.origin.creation, license: asset.license, modified: false })),
    ];
    for (const license of copiedLicenses) {
      const check = checkDependencyLicense({
        dependent: definition.creation.meta.license,
        dependency: license.license,
        modified: license.modified,
      });
      if (check.verdict === "fail")
        throw new CharError({
          code: "license.derivation_forbidden",
          subject: license.ref,
          detail: "This source does not permit the requested copy.",
          data: { reasons: check.reasons },
        });
    }
    const [redirect] = await tx
      .select({ name: creationRedirects.oldName })
      .from(creationRedirects)
      .where(
        and(eq(creationRedirects.namespaceId, ns.ns.id), eq(creationRedirects.oldName, input.name)),
      );
    if (redirect)
      throw new CharError({
        code: "creation.conflict",
        subject: input.name,
        detail: "This address is already reserved.",
      });
    const id = services.ids.uuid();
    const ref = `@${ns.ns.slug}/${input.name}`;
    const prepared = deriveCreation({
      kind: input.kind,
      source: {
        release: input.source.release,
        visibility: source.row.visibility,
        semantic_digest: definition.semantic_digest,
        creation: definition.json,
      },
      target: { id: encodeId("creation", id), ref, display_name: input.display_name },
      ...(input.ending ? { ending: input.ending } : {}),
      ...(input.from_play !== undefined ? { from_play: input.from_play } : {}),
    });
    const clientId = principal.oauth?.client_id;
    const canonical = canonicalizeCreation({
      ...prepared.creation,
      authors: [
        ...(prepared.creation.authors ?? []).filter(
          (author) => author.user !== encodeId("user", userId),
        ),
        { name: `@${ns.ns.slug}`, user: encodeId("user", userId) },
      ],
      provenance: {
        ...prepared.creation.provenance,
        ...(agent ? { authored_by_agent: true } : {}),
        ...(clientId ? { client_id: clientId } : {}),
      },
    });
    const check = checkCreation(canonical.creation);
    if (!check.ok)
      throw new CharError({
        code: "check.failed",
        subject: ref,
        data: { diagnostics: check.diagnostics },
      });
    const now = services.clock.now();
    const inserted = await tx
      .insert(creations)
      .values({
        id,
        namespaceId: ns.ns.id,
        name: input.name,
        type: canonical.creation.type,
        displayName: canonical.creation.display_name,
        rating: canonical.creation.meta.rating,
        ...(clientId ? { clientId } : {}),
      })
      .onConflictDoNothing()
      .returning({ id: creations.id });
    if (!inserted.length)
      throw new CharError({
        code: "creation.conflict",
        subject: ref,
        detail: "Choose a different address.",
      });
    await tx
      .insert(creationDrafts)
      .values({ creationId: id, working: canonical.json, updatedBy: userId });
    await tx
      .insert(creationDerivations)
      .values({ creationId: id, source: input.source, kind: input.kind, createdAt: now });
    // Grant only actual copied root bytes, never every asset uploaded by the source author.
    const rootBytes = new Set(
      artifact.assets
        .filter(
          (asset) =>
            asset.availability === "mirrored" && sameBuildIdentity(asset.origin, artifact.root),
        )
        .map((asset) => asset.digest),
    );
    const copied = [
      ...new Set(
        canonical.creation.assets.flatMap((asset) =>
          asset.variants
            .filter(
              (variant) =>
                variant.blob.availability === "mirrored" && rootBytes.has(variant.blob.digest),
            )
            .map((variant) => variant.blob.digest),
        ),
      ),
    ];
    if (copied.length)
      await tx
        .insert(creationAssetGrants)
        .values(
          copied.map((digest) => ({ creationId: id, digest, grantedBy: userId, createdAt: now })),
        );
    await appendAudit(tx, {
      at: now,
      actor: { kind: "user", id: userId },
      action: "creation.derive",
      subject: `creation:${id}`,
      requestId,
      after: {
        ref,
        kind: input.kind,
        source: input.source,
        ...(input.from_play !== undefined ? { from_play: true } : {}),
        ...(agent ? { agent: true } : {}),
        ...(clientId ? { client_id: clientId } : {}),
      },
    });
    return { id: encodeId("creation", id), ref, type: canonical.creation.type };
  });
}
