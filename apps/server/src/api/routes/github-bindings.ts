/**
 * 创作者管理 GitHub Source binding：
 *
 *   POST   …/source-binding           绑定一个仓库
 *   GET    …/source-binding           查看绑定、冻结原因与最近一次同步检查
 *   POST   …/source-binding/resolve   仓库转移后确认：rebind（接受新 owner）或 unbind
 *   DELETE …/source-binding           解绑
 *
 * 仓库一律按数字 ID 绑定。repository_owner_id 与仓库名都从 GitHub 读取（用 installation
 * 列出它能访问的仓库），不接受客户端提供的值：否则任何人都可以声称自己拥有某个仓库。
 */

import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { appendAudit } from "../../audit/audit.js";
import { sourceBindings } from "../../db/schema/index.js";
import { bindingForCreation, bindingJson, installationActive } from "../../github/bindings.js";
import type { GitHubDeps } from "../../github/deps.js";
import { bindRepository, resolveFrozenBinding } from "../../github/events.js";
import { normalizeRepoPath } from "../../github/source.js";
import { problem } from "../../http/middleware.js";
import { auditActor, param, requestIdOf, userIdOf } from "../../registry/context.js";
import { lookupCreation } from "../../registry/lookup.js";
import { type AppContext, type Env, notFound, route } from "../app.js";
import { CREATION_PATH } from "./drafts.js";

const DecimalId = z.string().regex(/^[1-9][0-9]{0,19}$/);
const RefPattern = z
  .string()
  .regex(
    /^refs\/[^*\s]+$|^refs\/[^*\s]*\/\*$/,
    "must be a full ref such as refs/heads/main or refs/tags/*",
  );

export const BindRequestSchema = z.strictObject({
  installation_id: DecimalId,
  repository_id: DecimalId,
  path: z.string().min(1).max(512),
  /** 默认 refs/heads/main。 */
  tracked_ref: z
    .string()
    .regex(/^refs\/heads\/[^\s*]+$/)
    .optional(),
  /** 默认为跟踪的分支加上所有 tag。 */
  publish_refs: z.array(RefPattern).min(1).max(20).optional(),
});

export const ResolveRequestSchema = z.strictObject({ action: z.enum(["rebind", "unbind"]) });

async function loadCreation(c: AppContext) {
  return lookupCreation(
    c.var.services.db,
    param(c, "ns").slice(1),
    param(c, "name"),
    c.var.principal,
  );
}

async function authorizeManage(c: AppContext) {
  const ctx = await loadCreation(c);
  if (!ctx) return notFound(c);
  return { action: "creation.manage_source" as const, resource: ctx.resource, loaded: ctx };
}

export function bindingsModule(gh: GitHubDeps): (app: Hono<Env>) => void {
  return (app) => {
    const base = `${CREATION_PATH}/source-binding`;

    route(app, {
      method: "post",
      path: base,
      body: BindRequestSchema,
      authorize: authorizeManage,
      handler: async (c, { body, loaded }) => {
        const { db, clock, ids } = c.var.services;
        let path: string;
        try {
          path = normalizeRepoPath(body.path);
        } catch {
          return problem(c, 422, "github.invalid_path");
        }
        if (!(await installationActive(db, BigInt(body.installation_id)))) {
          return problem(
            c,
            422,
            "github.installation_unavailable",
            "install the char.pub GitHub App on this repository first",
          );
        }
        const repos = await gh.source.listRepositories(body.installation_id);
        const repo = repos.find((r) => r.id === body.repository_id);
        if (!repo) {
          return problem(
            c,
            422,
            "github.repository_not_accessible",
            "the GitHub App installation cannot access this repository",
          );
        }
        const tracked = body.tracked_ref ?? "refs/heads/main";
        const result = await bindRepository(db, {
          new_id: ids.uuid(),
          creation_id: loaded.creation.id,
          repository_id: repo.id,
          repository_owner_id: repo.owner_id,
          installation_id: body.installation_id,
          path,
          tracked_ref: tracked,
          publish_refs: body.publish_refs ?? [tracked, "refs/tags/*"],
          display_full_name: repo.full_name,
          actor_user_id: userIdOf(c.var.principal),
          now: clock.now(),
        });
        if (!result.ok) return problem(c, 409, result.code);
        const b = await bindingForCreation(db, loaded.creation.id);
        return b ? c.json(bindingJson(b), 201) : problem(c, 500, "internal");
      },
    });

    route(app, {
      method: "get",
      path: base,
      authorize: authorizeManage,
      handler: async (c, { loaded }) => {
        const b = await bindingForCreation(c.var.services.db, loaded.creation.id);
        if (!b || b.status === "unbound") return notFound(c);
        return c.json(bindingJson(b));
      },
    });

    route(app, {
      method: "post",
      path: `${base}/resolve`,
      body: ResolveRequestSchema,
      authorize: authorizeManage,
      handler: async (c, { body, loaded }) => {
        const { db, clock } = c.var.services;
        const b = await bindingForCreation(db, loaded.creation.id);
        if (!b || b.status === "unbound") return notFound(c);
        let newOwner: string | undefined;
        if (body.action === "rebind") {
          // 接受转移后的新 owner：从 GitHub 读取仓库当前的 owner，而不是相信请求。
          const repos = await gh.source.listRepositories(b.installationId.toString());
          const repo = repos.find((r) => r.id === b.repositoryId.toString());
          if (!repo) {
            return problem(
              c,
              422,
              "github.repository_not_accessible",
              "the GitHub App installation can no longer access this repository; bind a new repository instead",
            );
          }
          newOwner = repo.owner_id;
        }
        const r = await resolveFrozenBinding(db, {
          binding_id: b.id,
          action: body.action,
          ...(newOwner ? { new_owner_id: newOwner } : {}),
          actor_user_id: userIdOf(c.var.principal),
          now: clock.now(),
        });
        if (!r.ok) return problem(c, r.code === "not_found" ? 404 : 409, r.code);
        const after = await bindingForCreation(db, loaded.creation.id);
        return after ? c.json(bindingJson(after)) : notFound(c);
      },
    });

    route(app, {
      method: "delete",
      path: base,
      authorize: authorizeManage,
      handler: async (c, { loaded }) => {
        const { db, clock } = c.var.services;
        const b = await bindingForCreation(db, loaded.creation.id);
        if (!b || b.status === "unbound") return notFound(c);
        const now = clock.now();
        await db.transaction(async (tx) => {
          await tx
            .update(sourceBindings)
            .set({ status: "unbound", updatedAt: now })
            .where(eq(sourceBindings.id, b.id));
          await appendAudit(tx, {
            at: now,
            actor: auditActor(c.var.principal),
            action: "binding.unbind",
            subject: `source_binding:${b.id}`,
            requestId: requestIdOf(c),
            before: { status: b.status },
            after: { status: "unbound" },
          });
        });
        return c.body(null, 204);
      },
    });
  };
}
