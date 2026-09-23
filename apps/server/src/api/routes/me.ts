/**
 * 当前用户：`GET /v1/me`、`GET /v1/me/creations` 与 `PUT /v1/me/settings`。
 *
 * 成人内容（mature / explicit）默认隐藏。开启时用户必须确认已满 18 岁（自我声明），
 * 服务端记录确认时间；关闭时清空确认时间。搜索与读取接口按这个设置在服务端过滤，
 * 客户端无法绕过。修改设置只能用浏览器会话，个人 Token 不能用来开启成人内容。
 */
import {
  type MeSchema,
  type MyCreationsResponseSchema,
  UpdateSettingsRequestSchema,
} from "@char-pub/contracts";
import { and, desc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import type { z } from "zod";
import { appendAudit } from "../../audit/audit.js";
import type { Action } from "../../authz/authorize.js";
import {
  authUser,
  creationDrafts,
  creations,
  namespaceMembers,
  namespaces,
  releases,
  userSettings,
} from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { auditActor, requestIdOf } from "../../registry/context.js";
import { encodeId } from "../../registry/ids.js";
import { type AppContext, type Env, route } from "../app.js";

/** `/v1/me` 指向当前登录用户自己：没有登录时直接 401。 */
function self(c: AppContext, action: Action) {
  const p = c.var.principal;
  if (p.kind !== "user") return problem(c, 401, "auth.required");
  return { action, resource: { type: "account" as const, user_id: p.user_id }, loaded: p.user_id };
}

async function loadMe(c: AppContext, userId: string): Promise<z.input<typeof MeSchema> | null> {
  const { db } = c.var.services;
  const [u] = await db
    .select({ id: authUser.id, name: authUser.name, image: authUser.image })
    .from(authUser)
    .where(eq(authUser.id, userId))
    .limit(1);
  if (!u) return null;
  const [ns] = await db
    .select({ slug: namespaces.slug })
    .from(namespaceMembers)
    .innerJoin(namespaces, eq(namespaces.id, namespaceMembers.namespaceId))
    .where(
      and(
        eq(namespaceMembers.userId, userId),
        eq(namespaceMembers.role, "owner"),
        eq(namespaces.kind, "user"),
      ),
    )
    .limit(1);
  const [s] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  return {
    id: encodeId("user", u.id),
    name: u.name,
    image: u.image,
    namespace: ns?.slug ?? null,
    settings: {
      show_mature: s?.showMature ?? false,
      mature_confirmed_at: s?.matureConfirmedAt?.toISOString() ?? null,
      locale: s?.locale ?? null,
    },
  };
}

export function register(app: Hono<Env>): void {
  route(app, {
    method: "get",
    path: "/v1/me",
    authorize: async (c) => self(c, "account.read"),
    handler: async (c, { loaded: userId }) => {
      const me = await loadMe(c, userId);
      if (!me) return problem(c, 401, "auth.required");
      c.header("cache-control", "private, no-store");
      return c.json(me);
    },
  });

  // 创作者自己的作品列表（包括还没有发布的草稿），供“我的作品”页面使用。
  route(app, {
    method: "get",
    path: "/v1/me/creations",
    authorize: async (c) => self(c, "account.read"),
    handler: async (c, { loaded: userId }) => {
      const rows = await c.var.services.db
        .select({
          slug: namespaces.slug,
          name: creations.name,
          type: creations.type,
          displayName: creations.displayName,
          status: creations.status,
          working: creationDrafts.working,
          draftUpdatedAt: creationDrafts.updatedAt,
          label: releases.label,
          visibility: releases.visibility,
          releaseStatus: releases.status,
        })
        .from(creations)
        .innerJoin(namespaces, eq(namespaces.id, creations.namespaceId))
        .innerJoin(
          namespaceMembers,
          and(
            eq(namespaceMembers.namespaceId, creations.namespaceId),
            eq(namespaceMembers.userId, userId),
          ),
        )
        .leftJoin(creationDrafts, eq(creationDrafts.creationId, creations.id))
        .leftJoin(releases, eq(releases.id, creations.latestReleaseId))
        .orderBy(desc(creationDrafts.updatedAt), creations.name)
        .limit(500);
      const body: z.input<typeof MyCreationsResponseSchema> = {
        items: rows.map((r) => {
          // 草稿中的显示名比 Creation 行上的新（后者只在发布时更新）。
          const draftName = (r.working as { display_name?: unknown } | null)?.display_name;
          return {
            ref: `@${r.slug}/${r.name}`,
            type: r.type,
            display_name: (draftName ?? r.displayName) as string,
            status: r.status,
            latest_release:
              r.label && r.visibility && r.releaseStatus
                ? { label: r.label, visibility: r.visibility, status: r.releaseStatus }
                : null,
            draft_updated_at: r.draftUpdatedAt?.toISOString() ?? null,
          };
        }),
      };
      c.header("cache-control", "private, no-store");
      return c.json(body);
    },
  });

  route(app, {
    method: "put",
    path: "/v1/me/settings",
    body: UpdateSettingsRequestSchema,
    authorize: async (c) => self(c, "account.update_settings"),
    handler: async (c, { body, loaded: userId }) => {
      const { db, clock } = c.var.services;
      const now = clock.now();
      const confirmedAt = body.show_mature ? now : null;
      await db.transaction(async (tx) => {
        const [before] = await tx
          .select({ showMature: userSettings.showMature })
          .from(userSettings)
          .where(eq(userSettings.userId, userId))
          .limit(1);
        await tx
          .insert(userSettings)
          .values({
            userId,
            showMature: body.show_mature,
            matureConfirmedAt: confirmedAt,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: userSettings.userId,
            set: { showMature: body.show_mature, matureConfirmedAt: confirmedAt, updatedAt: now },
          });
        await appendAudit(tx, {
          at: now,
          actor: auditActor(c.var.principal),
          action: "account.settings",
          subject: `user:${userId}`,
          requestId: requestIdOf(c),
          before: { show_mature: before?.showMature ?? false },
          after: { show_mature: body.show_mature },
        });
      });
      const me = await loadMe(c, userId);
      return me ? c.json(me) : problem(c, 401, "auth.required");
    },
  });
}
