/**
 * `POST /v1/publish/oidc`：GitHub Action 用 GitHub OIDC token 发布。
 *
 * 信任链：
 * 1. token 由 GitHub 签发（RS256、issuer、audience、有效期），jti 只能使用一次；
 * 2. token 里的 repository_id 与 repository_owner_id 同时匹配一个有效的 binding，ref 在允许的
 *    列表里，事件类型只允许 push / workflow_dispatch / release，请求的 commit 等于 token 的 sha；
 * 3. binding 所在仓库的 GitHub App 安装仍然有效（没有安装 App 的仓库不能用 OIDC 发布）；
 * 4. Registry 自己在那个 commit 上读取 char.yaml 并重新计算 digest，不采信 Action 上报的
 *    结果；两者不一致时拒绝。
 *
 * 之后与原生发布走同一条路径：建立 Revision → 占用 label 并入队 → worker 校验与构建。
 * 注意：OIDC token 只能证明“绑定的仓库在允许的 ref 与事件上运行了某个 workflow”，不能证明
 * 运行的就是官方 Action；能写这个仓库默认分支的人就能发布。
 */
import { OidcPublishRequestSchema } from "@char-pub/contracts";
import { canonicalizeCreation, isCharError, parseCreationRef } from "@char-pub/core";
import type { Hono } from "hono";
import { authorize, type Principal } from "../../authz/authorize.js";
import { bindingsForRepository, installationActive, toOidcBinding } from "../../github/bindings.js";
import type { GitHubDeps } from "../../github/deps.js";
import { DbJtiStore } from "../../github/jti.js";
import { loadSourceAtCommit } from "../../github/load-source.js";
import { problem, statusForCode } from "../../http/middleware.js";
import { authenticateOidcPublish, verifyGitHubOidcToken } from "../../oidc/github.js";
import { requestIdOf } from "../../registry/context.js";
import { encodeId } from "../../registry/ids.js";
import { lookupCreation } from "../../registry/lookup.js";
import { createRevision, requestPublish } from "../../registry/publish.js";
import { type AppContext, type Env, route } from "../app.js";
import { idempotencyKeyOf, publishResultResponse } from "./publish.js";

export const OIDC_PUBLISH_PATH = "/v1/publish/oidc";

/** OIDC 与 binding 相关错误的 HTTP 状态：凭证问题 401，权限与绑定问题 403。 */
function oidcStatus(code: string): number {
  if (code === "oidc.replay" || code.startsWith("binding.") || code === "oidc.event_not_allowed") {
    return 403;
  }
  if (code === "oidc.commit_mismatch") return 403;
  if (code.startsWith("oidc.")) return 401;
  return statusForCode(code);
}

function fromError(c: AppContext, e: unknown): Response {
  if (!isCharError(e)) throw e;
  return problem(c, oidcStatus(e.code), e.code, e.detail);
}

function bearer(c: AppContext): string | null {
  const h = c.req.header("authorization");
  return h?.startsWith("Bearer ") ? h.slice("Bearer ".length).trim() : null;
}

export function oidcPublishModule(gh: GitHubDeps): (app: Hono<Env>) => void {
  return (app) => {
    route(app, {
      method: "post",
      path: OIDC_PUBLISH_PATH,
      body: OidcPublishRequestSchema,
      // 身份来自请求里的 OIDC token，不是 session 或个人 Token，所以授权在 handler 里按步骤完成：
      // token 校验与 binding 比对之后，用 oidc principal 调用 authorize()。
      authorize: async () => ({ public: true, loaded: null }),
      handler: async (c, { body }) => {
        const services = c.var.services;
        const { db, clock } = services;
        const token = bearer(c);
        if (!token) return problem(c, 401, "oidc.missing", "a GitHub OIDC token is required");
        const key = idempotencyKeyOf(c);
        if (key instanceof Response) return key;

        const now = () => clock.now();
        // 先验签（不消耗 jti）拿到仓库 ID，才能找到对应的 binding。
        let repositoryId: string;
        try {
          const peek = await verifyGitHubOidcToken(token, {
            audience: gh.oidcAudience,
            jwks: gh.jwks,
            now,
          });
          repositoryId = peek.claims.repository_id;
        } catch (e) {
          return fromError(c, e);
        }
        const candidates = await bindingsForRepository(db, repositoryId);
        // 一个仓库可以绑定多个 Creation；请求里的 creation 决定使用哪一个。
        const ref = parseCreationRef(body.creation);
        const ctx = ref
          ? await lookupCreation(db, ref.namespace, ref.name, { kind: "anonymous" })
          : null;
        const binding = ctx ? candidates.find((b) => b.creationId === ctx.creation.id) : undefined;
        if (candidates.length > 0 && ctx && !binding) {
          return problem(
            c,
            403,
            "binding.mismatch",
            "this repository is not bound to that creation",
          );
        }

        let verified: Awaited<ReturnType<typeof authenticateOidcPublish>>;
        try {
          verified = await authenticateOidcPublish(
            token,
            { commit: body.commit },
            {
              audience: gh.oidcAudience,
              jwks: gh.jwks,
              now,
              jtiStore: new DbJtiStore(db, now),
              findBinding: async () => (binding ? toOidcBinding(binding) : null),
            },
          );
        } catch (e) {
          return fromError(c, e);
        }
        // 走到这里 binding 一定存在（authenticateOidcPublish 已检查）。
        if (!binding || !ctx) return problem(c, 403, "binding.not_found");
        if (!(await installationActive(db, binding.installationId))) {
          return problem(
            c,
            403,
            "github.installation_unavailable",
            "the char.pub GitHub App is not installed on this repository",
          );
        }
        if (body.path !== binding.path) {
          return problem(
            c,
            403,
            "binding.path_mismatch",
            `this binding publishes ${binding.path}, not ${body.path}`,
          );
        }

        const principal: Principal = {
          kind: "oidc",
          creation_id: ctx.creation.id,
          binding_id: binding.id,
        };
        const decision = authorize(principal, "creation.publish", ctx.resource, {
          disabled: await services.flags(),
        });
        if (!decision.allow) return problem(c, decision.status, decision.code);

        let loaded: Awaited<ReturnType<typeof loadSourceAtCommit>>;
        try {
          loaded = await loadSourceAtCommit(
            gh.source,
            {
              installation_id: binding.installationId.toString(),
              repository_id: binding.repositoryId.toString(),
              commit: verified.claims.sha,
              path: binding.path,
            },
            {
              ref: `@${ctx.ns.slug}/${ctx.creation.name}`,
              creationId: encodeId("creation", ctx.creation.id),
            },
          );
        } catch (e) {
          if (!isCharError(e)) throw e;
          return problem(c, 422, e.code, e.detail, { subject: e.subject });
        }
        if (loaded.reported_digest !== body.semantic_digest) {
          return problem(
            c,
            422,
            "publish.source_digest_mismatch",
            "the content at this commit does not match what the workflow built",
            { reported: body.semantic_digest, computed: loaded.reported_digest },
          );
        }

        const actor = { kind: "oidc" as const, id: `repository:${binding.repositoryId}` };
        const { row: revision } = await createRevision(services, {
          creationId: ctx.creation.id,
          canonical: canonicalizeCreation(loaded.creation),
          parentId: ctx.creation.headRevisionId,
          author: { kind: "source" },
          message: `github ${verified.claims.sha.slice(0, 12)} (${verified.claims.ref})`,
          actor,
          requestId: requestIdOf(c),
          updateDraftBase: false,
        });
        const result = await requestPublish(services, {
          creationId: ctx.creation.id,
          revision,
          label: body.label,
          visibility: body.visibility,
          idempotencyKey: key,
          source: {
            provider: "github",
            repository_id: binding.repositoryId.toString(),
            repository_owner_id: binding.repositoryOwnerId.toString(),
            commit: verified.claims.sha,
            path: binding.path,
          },
          publishedBy: { oidc: verified.claims },
          actor,
          requestId: requestIdOf(c),
        });
        return publishResultResponse(c, body.label, result);
      },
    });
  };
}
