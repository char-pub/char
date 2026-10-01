/** Personal bookmarks never grant access to a creation or pin a draft as a release. */
import {
  type CreationSummary,
  FavoritesResponseSchema,
  PageQuerySchema,
} from "@char-pub/contracts";
import { and, asc, eq, gt } from "drizzle-orm";
import type { Hono } from "hono";
import { appendAudit } from "../../audit/audit.js";
import { authorize, type Resource } from "../../authz/authorize.js";
import { creations, favorites, namespaces } from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { auditActor, requestIdOf } from "../../registry/context.js";
import { decodeId, encodeId } from "../../registry/ids.js";
import {
  type FoundCreation,
  findCreation,
  releaseSummary,
  visibleReleases,
} from "../../registry/read.js";
import { type AppContext, type Env, notFound, route } from "../app.js";
import { CREATION_PATH } from "./read.js";

function self(c: AppContext, action: "account.read_favorites" | "account.manage_favorites") {
  const principal = c.var.principal;
  if (principal.kind !== "user") return problem(c, 401, "auth.required");
  return {
    action,
    resource: { type: "account" as const, user_id: principal.user_id },
    loaded: principal.user_id,
  };
}
function resource(found: FoundCreation): Resource {
  return {
    type: "creation",
    id: found.creation.id,
    ns: found.ns,
    collaborator: found.collaborator === true,
    has_public_release: found.hasPublicRelease,
    status: found.creation.status,
    contribution_policy: found.creation.contributionPolicy,
  };
}

export function register(app: Hono<Env>): void {
  route(app, {
    method: "get",
    path: "/v1/me/favorites",
    authorize: async (c) => self(c, "account.read_favorites"),
    handler: async (c, { loaded: userId }) => {
      const parsed = PageQuerySchema.safeParse(c.req.query());
      if (!parsed.success) return problem(c, 422, "request.invalid");
      const { limit, cursor } = parsed.data;
      let after = cursor ? decodeId("creation", cursor) : null;
      if (cursor && !after) return problem(c, 422, "request.invalid");
      const items: CreationSummary[] = [];
      // Scan past inaccessible bookmarks without returning their IDs, counts or pagination cursors.
      // Existing (user_id, creation_id) primary key supplies the stable scan order.
      while (items.length <= limit) {
        const rows = await c.var.services.db
          .select({ id: creations.id, name: creations.name, slug: namespaces.slug })
          .from(favorites)
          .innerJoin(creations, eq(creations.id, favorites.creationId))
          .innerJoin(namespaces, eq(namespaces.id, creations.namespaceId))
          .where(
            and(eq(favorites.userId, userId), after ? gt(favorites.creationId, after) : undefined),
          )
          .orderBy(asc(favorites.creationId))
          .limit(100);
        if (!rows.length) break;
        for (const row of rows) {
          after = row.id;
          const found = await findCreation(c.var.services.db, row.slug, row.name, c.var.principal);
          if (
            found.kind !== "found" ||
            !authorize(c.var.principal, "creation.read", resource(found.value)).allow
          )
            continue;
          const creation = found.value.creation;
          const releases = await visibleReleases(c.var.services.db, found.value, c.var.principal);
          const latest = releases.find((release) => release.status !== "tombstoned");
          items.push({
            id: encodeId("creation", creation.id),
            ref: `@${found.value.namespace.slug}/${creation.name}`,
            type: creation.type,
            display_name: creation.displayName as CreationSummary["display_name"],
            rating: creation.rating,
            tags: creation.tags,
            ...(creation.summary
              ? { summary: creation.summary as CreationSummary["display_name"] }
              : {}),
            ...(latest
              ? {
                  latest_release: releaseSummary(latest),
                  effective_rating: releaseSummary(latest).effective_rating,
                }
              : {}),
          });
          if (items.length > limit) break;
        }
        if (items.length > limit || rows.length < 100) break;
      }
      const page = items.slice(0, limit);
      c.header("cache-control", "private, no-store");
      return c.json(
        FavoritesResponseSchema.parse({
          items: page,
          next_cursor: items.length > limit ? (page.at(-1)?.id ?? null) : null,
        }),
      );
    },
  });
  for (const method of ["put", "delete"] as const)
    route(app, {
      method,
      path: `${CREATION_PATH}/favorite`,
      authorize: async (c) => self(c, "account.manage_favorites"),
      handler: async (c, { loaded: userId }) => {
        const found = await findCreation(
          c.var.services.db,
          c.req.param("ns")?.slice(1) ?? "",
          c.req.param("name") ?? "",
          c.var.principal,
        );
        if (found.kind === "missing") return notFound(c);
        if (found.kind === "redirect")
          return c.redirect(`/v1/creations/@${found.ns}/${found.name}/favorite`, 307);
        const decision = authorize(c.var.principal, "creation.read", resource(found.value));
        if (!decision.allow) return problem(c, decision.status, decision.code);
        const { db, clock } = c.var.services;
        await db.transaction(async (tx) => {
          const changed =
            method === "put"
              ? await tx
                  .insert(favorites)
                  .values({ userId, creationId: found.value.creation.id, createdAt: clock.now() })
                  .onConflictDoNothing()
                  .returning()
              : await tx
                  .delete(favorites)
                  .where(
                    and(
                      eq(favorites.userId, userId),
                      eq(favorites.creationId, found.value.creation.id),
                    ),
                  )
                  .returning();
          if (changed.length)
            await appendAudit(tx, {
              at: clock.now(),
              actor: auditActor(c.var.principal),
              action: method === "put" ? "favorite.add" : "favorite.remove",
              subject: `creation:${found.value.creation.id}`,
              requestId: requestIdOf(c),
              after: { favorited: method === "put" },
            });
        });
        c.header("cache-control", "private, no-store");
        return c.json({ favorited: method === "put" });
      },
    });
}
