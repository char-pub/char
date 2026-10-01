import { DraftBuildRequestSchema } from "@char-pub/contracts";
import { CharError, isCharError } from "@char-pub/core";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { appendAudit } from "../../audit/audit.js";
import { authorize } from "../../authz/authorize.js";
import { draftBuilds } from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { auditActor, param } from "../../registry/context.js";
import {
  buildCreationContext,
  draftBuildResponse,
  lockDraftBuildCreation,
  payloadStore,
  readDraftArtifact,
  requestDraftBuild,
  requireLiveBuild,
  validateDraftBuild,
} from "../../registry/draft-builds.js";
import { decodeId, encodeId } from "../../registry/ids.js";
import { lookupCreation } from "../../registry/lookup.js";
import { referenceImpact } from "../../registry/reference-impact.js";
import { readSourceText } from "../../registry/source-text.js";
import { DraftPayloadError } from "../../storage/draft-payload.js";
import { type AppContext, type Env, notFound, route } from "../app.js";
import { CREATION_PATH, parseIfMatch } from "./drafts.js";

function failure(c: AppContext, error: unknown) {
  if (error instanceof DraftPayloadError)
    return error.code === "draft_payload.expired"
      ? problem(c, 410, "draft_build.expired")
      : problem(c, 503, "draft_build.payload_unavailable");
  if (!isCharError(error)) throw error;
  const authStatus =
    error.code === "auth.required"
      ? 401
      : error.code.endsWith("not_found")
        ? 404
        : [
              "forbidden",
              "account.banned",
              "creation.suspended",
              "namespace.suspended",
              "token.insufficient_scope",
            ].includes(error.code)
          ? 403
          : error.code === "feature.read_only"
            ? 503
            : undefined;
  const status =
    authStatus ??
    (error.code === "draft.version_conflict"
      ? 409
      : error.code === "draft_build.limit"
        ? 429
        : error.code.endsWith("_unavailable") && error.code !== "draft_build.dependency_unavailable"
          ? 503
          : error.code === "draft_build.expired"
            ? 410
            : error.code === "draft_build.not_ready"
              ? 409
              : 422);
  return problem(c, status, error.code, error.detail, error.data ? { data: error.data } : {});
}
async function loadBuild(c: AppContext) {
  const id = decodeId("draft_build", param(c, "build"));
  if (!id) return null;
  const [row] = await c.var.services.db.select().from(draftBuilds).where(eq(draftBuilds.id, id));
  if (!row) return null;
  const { context, principal } = await buildCreationContext(
    c.var.services.db,
    row.creationId,
    c.var.principal,
    c.var.services.clock.now(),
  );
  c.set("principal", principal);
  return { row, context };
}

export function register(app: Hono<Env>) {
  route(app, {
    method: "post",
    path: `${CREATION_PATH}/draft-builds`,
    body: DraftBuildRequestSchema,
    authorize: async (c) => {
      const ctx = await lookupCreation(
        c.var.services.db,
        param(c, "ns").slice(1),
        param(c, "name"),
        c.var.principal,
      );
      return ctx ? { action: "creation.edit", resource: ctx.resource, loaded: ctx } : notFound(c);
    },
    handler: async (c, { loaded }) => {
      c.header("cache-control", "private, no-store");
      const version = parseIfMatch(c.req.header("if-match"));
      if (version === null) return problem(c, 428, "draft.if_match_required");
      try {
        const result = await requestDraftBuild(c.var.services, {
          creationId: loaded.creation.id,
          version,
          principal: c.var.principal,
        });
        return c.json(
          draftBuildResponse(result.row, c.var.services.clock.now()),
          result.reused ? 200 : 202,
        );
      } catch (error) {
        return failure(c, error);
      }
    },
  });
  for (const endpoint of ["", "/artifact", "/source-text", "/assets", "/reference-impact"] as const)
    route(app, {
      method: "get",
      path: `/v1/draft-builds/:build${endpoint}`,
      authorize: async (c) => {
        const found = await loadBuild(c);
        return found
          ? {
              action:
                endpoint === "/reference-impact" ? "creation.read_draft" : "creation.read_build",
              resource: found.context.resource,
              loaded: found,
            }
          : notFound(c);
      },
      handler: async (c, { loaded }) => {
        const services = c.var.services;
        c.header("cache-control", "private, no-store");
        try {
          return await services.db.transaction(async (tx) => {
            await lockDraftBuildCreation(tx, loaded.row.creationId);
            const fresh = await buildCreationContext(
              tx,
              loaded.row.creationId,
              c.var.principal,
              services.clock.now(),
            );
            const allowed = authorize(
              fresh.principal,
              endpoint === "/reference-impact" ? "creation.read_draft" : "creation.read_build",
              fresh.context.resource,
            );
            if (!allowed.allow) return problem(c, allowed.status, allowed.code);
            const [row] = await tx
              .select()
              .from(draftBuilds)
              .where(eq(draftBuilds.id, loaded.row.id))
              .for("update");
            if (!row) return notFound(c);
            const current = { ...services, db: tx };
            if (endpoint === "") {
              if (row.state === "ready" && row.expiresAt > services.clock.now())
                await validateDraftBuild(current, row, fresh.principal);
              return c.json(draftBuildResponse(row, services.clock.now()));
            }
            requireLiveBuild(row, services.clock.now());
            const artifact = await readDraftArtifact(current, row, fresh.principal);
            if (endpoint === "/reference-impact") {
              const result = await referenceImpact(current, {
                row,
                artifact,
                principal: fresh.principal,
                baseRelease: c.req.query("base_release") ?? "",
                ...(c.req.query("cursor") ? { cursor: c.req.query("cursor") as string } : {}),
                limit: Math.trunc(
                  Math.min(Math.max(Number(c.req.query("limit") ?? 20) || 20, 1), 100),
                ),
              });
              requireLiveBuild(row, services.clock.now());
              return c.json(result);
            }
            if (endpoint === "/assets") {
              const asset = artifact.assets.find((a) => a.id === c.req.query("asset"));
              if (asset?.availability !== "mirrored") return notFound(c);
              return c.redirect(
                await payloadStore(services).signedAsset(
                  asset.digest,
                  asset.access,
                  row.expiresAt,
                  services.clock.now(),
                ),
                302,
              );
            }
            if (endpoint === "/source-text") {
              const source = await readSourceText(
                tx,
                services.cas,
                artifact,
                c.req.query("source") ?? "",
                true,
              );
              requireLiveBuild(row, services.clock.now());
              return c.json(source);
            }
            requireLiveBuild(row, services.clock.now());
            return c.redirect(
              await payloadStore(services).signedGet(
                encodeId("draft_build", row.id),
                "artifact",
                row.expiresAt,
                services.clock.now(),
              ),
              302,
            );
          });
        } catch (error) {
          return failure(c, error);
        }
      },
    });
  route(app, {
    method: "delete",
    path: "/v1/draft-builds/:build",
    authorize: async (c) => {
      const found = await loadBuild(c);
      if (!found) return notFound(c);
      const visible = authorize(c.var.principal, "creation.read_build", found.context.resource);
      if (!visible.allow) return problem(c, visible.status, visible.code);
      if (found.context.resource.ns.role !== "owner") return problem(c, 403, "forbidden");
      return { action: "creation.edit", resource: found.context.resource, loaded: found };
    },
    handler: async (c, { loaded }) => {
      const s = c.var.services;
      c.header("cache-control", "private, no-store");
      // Mark inaccessible durably before cleanup. A storage failure is retried by expiry worker.
      try {
        await s.db.transaction(async (tx) => {
          await lockDraftBuildCreation(tx, loaded.row.creationId);
          const fresh = await buildCreationContext(
            tx,
            loaded.row.creationId,
            c.var.principal,
            s.clock.now(),
          );
          const visible = authorize(fresh.principal, "creation.read_build", fresh.context.resource);
          if (!visible.allow)
            throw new CharError({ code: visible.code, subject: loaded.row.creationId });
          const writable = authorize(fresh.principal, "creation.edit", fresh.context.resource, {
            disabled: await s.flags(),
          });
          if (!writable.allow)
            throw new CharError({ code: writable.code, subject: loaded.row.creationId });
          if (fresh.context.resource.ns.role !== "owner")
            throw new CharError({ code: "forbidden", subject: loaded.row.creationId });
          const [row] = await tx
            .select()
            .from(draftBuilds)
            .where(eq(draftBuilds.id, loaded.row.id))
            .for("update");
          if (!row || row.state === "deleted") return;
          await tx
            .update(draftBuilds)
            .set({ state: "deleted", report: null, updatedAt: s.clock.now() })
            .where(eq(draftBuilds.id, row.id));
          await appendAudit(tx, {
            at: s.clock.now(),
            actor: auditActor(c.var.principal),
            action: "draft_build.delete",
            subject: `draft_build:${row.id}`,
          });
        });
      } catch (error) {
        return failure(c, error);
      }
      try {
        await payloadStore(s).deleteBuild(encodeId("draft_build", loaded.row.id));
        await s.db
          .update(draftBuilds)
          .set({ payloadDeletedAt: s.clock.now() })
          .where(eq(draftBuilds.id, loaded.row.id));
      } catch {
        // The durable deleted state stays inaccessible; the periodic worker retries cleanup.
        return c.body(null, 202);
      }
      return c.body(null, 204);
    },
  });
}
