/**
 * Native → Native Contribution：对别人作品的修改提议。
 *
 * - 提交：按作者设置的 contribution_policy 授权（所有人 / 登录用户 / 受邀用户 / 关闭）；
 *   按账号、目标 namespace、访客三个维度限流；变更是否敏感由服务端计算；提交时就对基线
 *   试合并一次，变更本身不合法时直接拒绝。
 * - 查看：贡献者本人（登录用户或访客）与目标 namespace 的成员可见，其他人一律 404。
 *   详情里附带与作者当前草稿的合并预览。作者信息附带显示名与 namespace，不包含邮箱。
 * - 接受：基于作者**当前**草稿重新合并。有冲突则拒绝且不改任何数据；敏感变更（rating、
 *   license、content_warnings 等）必须逐项确认；按目标当前的 license 重新检查贡献授权。
 *   成功后写回草稿、生成新 Revision，并把贡献者写进 provenance，下一次发布时进入
 *   Release 的贡献者名单。
 * - 拒绝 / 撤回：改状态并写审计。拒绝理由同时存进 Contribution，只在详情里返回：
 *   详情只有提交者与目标 namespace 的成员能看到，列表不带理由。
 * - 邀请名单（policy 为 invited 时）：作者按用户 ID 或对方的 @namespace 邀请，名单只有作者
 *   可见。没有公开的“按名字查用户”接口，按 namespace 解析账号只发生在作者邀请时，并且限流。
 *
 * Agent 提交的 Contribution 必须标记为 agent：请求体可以主动声明，用 Agent Token 提交的
 * 一律是 agent，客户端不能把它改回 false。
 */
import {
  AcceptContributionRequestSchema,
  ContributionInviteRequestSchema,
  type ContributionInviteResponseSchema,
  ContributionQuerySchema,
  ContributionSettingsRequestSchema,
  CreateContributionRequestSchema,
  NamespaceSlugSchema,
  RejectContributionRequestSchema,
} from "@char-pub/contracts";
import {
  assertRightsAck,
  assertSensitiveConfirmed,
  type Change,
  ChangeSchema,
  changeKey,
  computeSensitive,
  isCharError,
  normalizeValue,
} from "@char-pub/core";
import { and, asc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import type { z } from "zod";
import { appendAudit } from "../../audit/audit.js";
import type { Principal, Resource } from "../../authz/authorize.js";
import {
  authUser,
  contributionChanges,
  contributionInvites,
  contributions,
  creations,
  guests,
  namespaceMembers,
  revisions,
} from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { hit, RATE_LIMITS } from "../../ops/rate-limit.js";
import { auditActor, param, requestIdOf } from "../../registry/context.js";
import {
  acceptContribution,
  authorNamesOf,
  authorOf,
  type ContributionRow,
  changeOf,
  changeRow,
  guestNamesOf,
  isInvited,
  listContributions,
  loadContribution,
  loadDraft,
  nextNumber,
  previewJson,
  revisionContent,
  summaryJson,
  tryMerge,
  userDisplaysOf,
  withContributor,
} from "../../registry/contributions.js";
import { decodeId, encodeId } from "../../registry/ids.js";
import { type CreationContext, lookupCreation, lookupNamespace } from "../../registry/lookup.js";
import { type AppContext, type Env, notFound, route } from "../app.js";
import { CREATION_PATH } from "./drafts.js";

const BASE = `${CREATION_PATH}/contributions`;
const ITEM = `${BASE}/:number{[0-9]{1,9}}`;

async function loadCreation(c: AppContext): Promise<CreationContext | null> {
  const ctx = await lookupCreation(
    c.var.services.db,
    param(c, "ns").slice(1),
    param(c, "name"),
    c.var.principal,
  );
  if (!ctx) return null;
  if (ctx.creation.contributionPolicy === "invited") {
    ctx.resource.invited = await isInvited(c.var.services.db, ctx.creation.id, c.var.principal);
  }
  return ctx;
}

function contributionResource(ctx: CreationContext, row: ContributionRow): Resource {
  return {
    type: "contribution",
    id: row.id,
    ns: ctx.resource.ns,
    author: {
      ...(row.authorUserId ? { user_id: row.authorUserId } : {}),
      ...(row.authorGuestId ? { guest_id: row.authorGuestId } : {}),
    },
    status: row.status,
  };
}

/** 加载某一个 Contribution 及其所在 Creation；找不到时直接返回 404。 */
async function loadItem(c: AppContext) {
  const ctx = await loadCreation(c);
  if (!ctx) return null;
  const item = await loadContribution(
    c.var.services.db,
    ctx.creation.id,
    Number(param(c, "number")),
  );
  if (!item) return null;
  return { ctx, ...item };
}

function isMember(ctx: CreationContext): boolean {
  return ctx.resource.ns.role === "owner" || ctx.resource.ns.role === "maintainer";
}

function limited(c: AppContext, retryAfter: number): Response {
  const res = problem(c, 429, "rate_limited", "too many contributions, try again later");
  res.headers.set("retry-after", String(retryAfter));
  return res;
}

function charProblem(
  c: AppContext,
  status: number,
  e: { code: string; detail?: string | undefined; data?: unknown },
) {
  return problem(c, status, e.code, e.detail, e.data ? { data: e.data } : {});
}

/** 一个 Contribution 的作者信息：登录用户或经过验证的访客。 */
async function authorFields(c: AppContext, p: Principal) {
  if (p.kind === "user") return { authorUserId: p.user_id, authorGuestId: null };
  if (p.kind === "guest") {
    // 访客必须已经存在于 guests 表中（通过访客验证流程创建），而且没有被停用。
    const [g] = await c.var.services.db
      .select()
      .from(guests)
      .where(eq(guests.guestId, p.guest_id))
      .limit(1);
    if (!g?.verifiedAt || g.disabledAt) return null;
    return { authorUserId: null, authorGuestId: g.guestId };
  }
  return null;
}

type InviteTarget = { user: string } | { namespace: string };

/**
 * 被邀请的用户：按用户 ID，或者按个人 namespace 找到它的 owner（旧名跟随改名）。
 * org 与 system namespace 不属于某一个人，按找不到处理。
 */
async function inviteeOf(c: AppContext, target: InviteTarget): Promise<{ id: string } | null> {
  const { db } = c.var.services;
  if ("user" in target) {
    const userId = decodeId("user", target.user);
    if (!userId) return null;
    const [row] = await db
      .select({ id: authUser.id })
      .from(authUser)
      .where(eq(authUser.id, userId));
    return row ?? null;
  }
  const slug = target.namespace.replace(/^@/, "");
  if (!NamespaceSlugSchema.safeParse(slug).success) return null;
  let found = await lookupNamespace(db, slug, c.var.principal);
  if (found.kind === "redirect") found = await lookupNamespace(db, found.to, c.var.principal);
  if (found.kind !== "found" || found.ns.kind !== "user") return null;
  const [owner] = await db
    .select({ id: namespaceMembers.userId })
    .from(namespaceMembers)
    .where(and(eq(namespaceMembers.namespaceId, found.ns.id), eq(namespaceMembers.role, "owner")))
    .limit(1);
  return owner ?? null;
}

export function register(app: Hono<Env>): void {
  // ------------------------------------------------------------------------
  // 提交
  // ------------------------------------------------------------------------
  route(app, {
    method: "post",
    path: BASE,
    body: CreateContributionRequestSchema,
    authorize: async (c) => {
      const ctx = await loadCreation(c);
      if (!ctx) return notFound(c);
      return { action: "contribution.submit", resource: ctx.resource, loaded: ctx };
    },
    handler: async (c, { body, loaded: ctx }) => {
      const { db, cas, clock, ids } = c.var.services;
      const p = c.var.principal;
      const now = clock.now();
      const author = await authorFields(c, p);
      if (!author) return problem(c, 403, "guest.unverified");

      // 限流：先按贡献者，再按目标 namespace。
      const who = author.authorUserId
        ? await hit(
            db,
            `contrib:user:${author.authorUserId}`,
            RATE_LIMITS.contributionPerAccount,
            now,
          )
        : await hit(
            db,
            `contrib:guest:${author.authorGuestId}`,
            RATE_LIMITS.contributionPerGuest,
            now,
          );
      if (!who.allowed) return limited(c, who.retryAfterSeconds);
      const ns = await hit(
        db,
        `contrib:ns:${ctx.ns.id}`,
        RATE_LIMITS.contributionPerNamespace,
        now,
      );
      if (!ns.allowed) return limited(c, ns.retryAfterSeconds);

      const baseId = decodeId("revision", body.base_revision);
      const [base] = baseId
        ? await db
            .select()
            .from(revisions)
            .where(and(eq(revisions.id, baseId), eq(revisions.creationId, ctx.creation.id)))
            .limit(1)
        : [];
      if (!base) {
        return problem(
          c,
          422,
          "contribution.base_not_found",
          "base_revision is not a revision of this creation",
        );
      }

      // 贡献授权按目标当前的 license 检查。
      try {
        const draft = await loadDraft(db, ctx.creation.id);
        const license = ((draft?.working as { meta?: { license?: string } })?.meta?.license ??
          "LicenseRef-All-Rights-Reserved") as string;
        assertRightsAck(license, body.rights_ack);
      } catch (e) {
        if (isCharError(e)) return charProblem(c, 422, e);
        throw e;
      }

      // 解析每个变更，服务端重新计算 sensitive；与基线试合并，变更不合法时直接拒绝。
      const parsed: { raw: unknown; change: Change; key: string; sensitive: boolean }[] = [];
      for (const [i, raw] of body.changes.entries()) {
        const r = ChangeSchema.safeParse(normalizeValue(raw, `changes[${i}]`));
        if (!r.success) {
          return problem(c, 422, "contribution.invalid_change", r.error.issues[0]?.message, {
            subject: `changes[${i}]`,
          });
        }
        parsed.push({
          raw,
          change: r.data,
          key: changeKey(r.data),
          sensitive: computeSensitive(r.data),
        });
      }
      const baseContent = await revisionContent(cas, base.semanticDigest);
      const attempt = tryMerge(baseContent, body.changes);
      if (attempt.error) return charProblem(c, 422, attempt.error);

      const agent = body.agent === true || (p.kind === "user" && p.agent === true);
      const id = ids.uuid();
      const number = await db.transaction(async (tx) => {
        const n = await nextNumber(tx, ctx.creation.id);
        await tx.insert(contributions).values({
          id,
          targetCreationId: ctx.creation.id,
          number: n,
          ...author,
          agent,
          title: body.title,
          ...(body.description ? { description: body.description } : {}),
          status: "open",
          baseRevisionId: base.id,
          baseSemanticDigest: base.semanticDigest,
          transport: { type: "native" },
          rightsAck: body.rights_ack,
          createdAt: now,
          updatedAt: now,
        });
        await tx
          .insert(contributionChanges)
          .values(
            parsed.map((x, i) =>
              changeRow(id, i, x.raw, x.change, x.key, x.sensitive, () => ids.uuid()),
            ),
          );
        await appendAudit(tx, {
          at: now,
          actor: auditActor(p),
          action: "contribution.submit",
          subject: `contribution:${id}`,
          requestId: requestIdOf(c),
          after: {
            creation: ctx.creation.id,
            number: n,
            agent,
            keys: parsed.map((x) => x.key),
            sensitive: parsed.filter((x) => x.sensitive).map((x) => x.key),
          },
        });
        return n;
      });
      return c.json(
        {
          id: encodeId("contribution", id),
          number,
          status: "open",
          agent,
          sensitive_keys: parsed.filter((x) => x.sensitive).map((x) => x.key),
        },
        201,
      );
    },
  });

  // ------------------------------------------------------------------------
  // 列表与详情
  // ------------------------------------------------------------------------
  route(app, {
    method: "get",
    path: BASE,
    authorize: async (c) => {
      const ctx = await loadCreation(c);
      if (!ctx) return notFound(c);
      // 列表本身可以看；成员看到全部，其他登录用户和访客只看到自己提交的，匿名看不到任何条目。
      return { action: "creation.read", resource: ctx.resource, loaded: ctx };
    },
    handler: async (c, { loaded: ctx }) => {
      const q = ContributionQuerySchema.safeParse(
        Object.fromEntries(new URL(c.req.url).searchParams),
      );
      if (!q.success) return problem(c, 422, "request.invalid", q.error.issues[0]?.message);
      const p = c.var.principal;
      const member = isMember(ctx) && p.kind === "user";
      if (!member && p.kind !== "user" && p.kind !== "guest") {
        return c.json({ items: [], next_cursor: null });
      }
      const before = q.data.cursor ? Number(q.data.cursor) : undefined;
      if (before !== undefined && !Number.isSafeInteger(before)) {
        return problem(c, 422, "request.invalid", "bad cursor");
      }
      const rows = await listContributions(c.var.services.db, ctx.creation.id, {
        ...(q.data.status ? { status: q.data.status } : {}),
        ...(q.data.agent ? { agent: q.data.agent === "true" } : {}),
        ...(!member && p.kind === "user" ? { authorUserId: p.user_id } : {}),
        ...(p.kind === "guest" ? { authorGuestId: p.guest_id } : {}),
        ...(before !== undefined ? { beforeNumber: before } : {}),
        limit: q.data.limit,
      });
      const last = rows.at(-1);
      const names = await authorNamesOf(c.var.services.db, rows);
      return c.json({
        items: rows.map((r) => summaryJson(r, names)),
        next_cursor: rows.length === q.data.limit && last ? String(last.number) : null,
      });
    },
  });

  route(app, {
    method: "get",
    path: ITEM,
    authorize: async (c) => {
      const item = await loadItem(c);
      if (!item) return notFound(c);
      return {
        action: "contribution.read",
        resource: contributionResource(item.ctx, item.row),
        loaded: item,
      };
    },
    handler: async (c, { loaded: item }) => {
      const { db } = c.var.services;
      const changes = item.changes.map(changeOf);
      let preview = null;
      if (item.row.status === "open") {
        const draft = await loadDraft(db, item.ctx.creation.id);
        preview = previewJson(tryMerge(draft?.working, changes));
      }
      return c.json({
        ...summaryJson(item.row, await authorNamesOf(db, [item.row])),
        ...(item.row.description ? { description: item.row.description } : {}),
        changes,
        preview,
        result_revision: item.row.resultRevisionId
          ? encodeId("revision", item.row.resultRevisionId)
          : null,
        ...(item.row.status === "rejected" && item.row.decisionReason
          ? { decision_reason: item.row.decisionReason }
          : {}),
      });
    },
  });

  // ------------------------------------------------------------------------
  // 接受
  // ------------------------------------------------------------------------
  route(app, {
    method: "post",
    path: `${ITEM}/accept`,
    body: AcceptContributionRequestSchema,
    authorize: async (c) => {
      const item = await loadItem(c);
      if (!item) return notFound(c);
      return {
        action: "contribution.decide",
        resource: contributionResource(item.ctx, item.row),
        loaded: item,
      };
    },
    handler: async (c, { body, loaded: item }) => {
      const { db, cas, clock, ids } = c.var.services;
      const p = c.var.principal;
      if (p.kind !== "user") return problem(c, 401, "auth.required");
      if (body.confirm_sensitive.some((k) => k.includes("*"))) {
        return problem(
          c,
          422,
          "contribution.sensitive_wildcard",
          "confirm each sensitive change by its key",
        );
      }
      const draft = await loadDraft(db, item.ctx.creation.id);
      if (!draft) return notFound(c);
      const attempt = tryMerge(draft.working, item.changes.map(changeOf));
      if (attempt.error) return charProblem(c, 422, attempt.error);
      const merge = attempt.merge;
      if (!merge?.result) {
        return problem(
          c,
          409,
          "contribution.conflict",
          "these changes conflict with the current draft",
          {
            conflicts:
              merge?.conflicts.map((o) => ({ key: o.key, reason: o.reason ?? "diverged" })) ?? [],
          },
        );
      }
      try {
        assertSensitiveConfirmed(merge, body.confirm_sensitive);
        const license = merge.result.creation.meta.license;
        assertRightsAck(license, item.row.rightsAck as Parameters<typeof assertRightsAck>[1]);
      } catch (e) {
        if (isCharError(e)) return charProblem(c, 422, e);
        throw e;
      }

      const author = authorOf(item.row, await guestNamesOf(db, [item.row]));
      const contributor = {
        author: "user" in author ? author.user : author,
        contribution: encodeId("contribution", item.row.id),
      };
      const merged = withContributor(merge.result.json as Record<string, unknown>, contributor);
      let out: Awaited<ReturnType<typeof acceptContribution>>;
      try {
        out = await acceptContribution(db, cas, {
          ctx: item.ctx,
          row: item.row,
          changes: item.changes,
          merged,
          mergeResult: merge,
          draftVersion: draft.version,
          deciderUserId: p.user_id,
          actor: auditActor(p),
          requestId: requestIdOf(c),
          now: clock.now(),
          newId: () => ids.uuid(),
        });
      } catch (e) {
        if (isCharError(e) && e.code === "contribution.not_open") return charProblem(c, 409, e);
        throw e;
      }
      if (!out) {
        return problem(
          c,
          409,
          "draft.version_conflict",
          "the draft changed while merging; try again",
        );
      }
      return c.json({
        status: "accepted",
        revision: encodeId("revision", out.revisionId),
        semantic_digest: out.semanticDigest,
        applied: merge.outcomes.filter((o) => o.state === "applied").map((o) => o.key),
        already_applied: merge.outcomes
          .filter((o) => o.state === "already_applied")
          .map((o) => o.key),
      });
    },
  });

  // ------------------------------------------------------------------------
  // 拒绝与撤回
  // ------------------------------------------------------------------------
  const decide = (
    path: string,
    action: "contribution.decide" | "contribution.withdraw",
    status: "rejected" | "withdrawn",
  ) =>
    route(app, {
      method: "post",
      path,
      body: status === "rejected" ? RejectContributionRequestSchema : undefined,
      authorize: async (c) => {
        const item = await loadItem(c);
        if (!item) return notFound(c);
        return { action, resource: contributionResource(item.ctx, item.row), loaded: item };
      },
      handler: async (c, { body, loaded: item }) => {
        const { db, clock } = c.var.services;
        const p = c.var.principal;
        const now = clock.now();
        const changed = await db.transaction(async (tx) => {
          const rows = await tx
            .update(contributions)
            .set({
              status,
              ...(status === "rejected" && p.kind === "user" ? { decidedBy: p.user_id } : {}),
              ...(body && "reason" in body ? { decisionReason: body.reason } : {}),
              decidedAt: now,
              updatedAt: now,
            })
            .where(and(eq(contributions.id, item.row.id), eq(contributions.status, "open")))
            .returning({ id: contributions.id });
          if (rows.length === 0) return false;
          await appendAudit(tx, {
            at: now,
            actor: auditActor(p),
            action: `contribution.${status === "rejected" ? "reject" : "withdraw"}`,
            subject: `contribution:${item.row.id}`,
            requestId: requestIdOf(c),
            ...(body && "reason" in body ? { after: { reason: body.reason } } : {}),
          });
          return true;
        });
        if (!changed) return problem(c, 409, "contribution.not_open");
        return c.json({ status });
      },
    });
  decide(`${ITEM}/reject`, "contribution.decide", "rejected");
  decide(`${ITEM}/withdraw`, "contribution.withdraw", "withdrawn");

  // ------------------------------------------------------------------------
  // 作者设置：谁可以提交，以及 invited 模式下的邀请名单
  // ------------------------------------------------------------------------
  route(app, {
    method: "put",
    path: `${CREATION_PATH}/contribution-settings`,
    body: ContributionSettingsRequestSchema,
    authorize: async (c) => {
      const ctx = await loadCreation(c);
      if (!ctx) return notFound(c);
      return { action: "creation.update_settings", resource: ctx.resource, loaded: ctx };
    },
    handler: async (c, { body, loaded: ctx }) => {
      const { db, clock } = c.var.services;
      await db.transaction(async (tx) => {
        await tx
          .update(creations)
          .set({ contributionPolicy: body.policy, updatedAt: clock.now() })
          .where(eq(creations.id, ctx.creation.id));
        await appendAudit(tx, {
          at: clock.now(),
          actor: auditActor(c.var.principal),
          action: "creation.contribution_policy",
          subject: `creation:${ctx.creation.id}`,
          requestId: requestIdOf(c),
          before: { policy: ctx.creation.contributionPolicy },
          after: { policy: body.policy },
        });
      });
      return c.json({ policy: body.policy });
    },
  });

  const INVITES = `${CREATION_PATH}/contribution-invites`;
  const settingsAuthorize = async (c: AppContext) => {
    const ctx = await loadCreation(c);
    if (!ctx) return notFound(c);
    return {
      action: "creation.update_settings" as const,
      resource: ctx.resource,
      loaded: ctx,
    };
  };

  /**
   * 修改邀请名单并写审计。被邀请人用用户 ID 或个人 namespace 指定，必须存在；找不到用户、
   * namespace 不存在或不是个人 namespace 时返回同一个错误。邀请按操作者限流，免得有人用
   * 邀请名单批量把 namespace 解析成账号。
   */
  async function updateInvite(
    c: AppContext,
    ctx: CreationContext,
    target: InviteTarget,
    invite: boolean,
  ) {
    const { db, clock } = c.var.services;
    const p = c.var.principal;
    if (invite && p.kind === "user") {
      const r = await hit(
        db,
        `invite:user:${p.user_id}`,
        RATE_LIMITS.contributionInvite,
        clock.now(),
      );
      if (!r.allowed) {
        const res = problem(c, 429, "rate_limited", "too many invitations, try again later");
        res.headers.set("retry-after", String(r.retryAfterSeconds));
        return res;
      }
    }
    const row = await inviteeOf(c, target);
    if (!row) return problem(c, 422, "contribution.invite_unknown_user");
    await db.transaction(async (tx) => {
      if (invite) {
        await tx
          .insert(contributionInvites)
          .values({
            creationId: ctx.creation.id,
            userId: row.id,
            ...(p.kind === "user" ? { invitedBy: p.user_id } : {}),
          })
          .onConflictDoNothing();
      } else {
        await tx
          .delete(contributionInvites)
          .where(
            and(
              eq(contributionInvites.creationId, ctx.creation.id),
              eq(contributionInvites.userId, row.id),
            ),
          );
      }
      await appendAudit(tx, {
        at: clock.now(),
        actor: auditActor(p),
        action: invite ? "contribution.invite" : "contribution.uninvite",
        subject: `creation:${ctx.creation.id}`,
        requestId: requestIdOf(c),
        after: { user: row.id },
      });
    });
    const display = (await userDisplaysOf(db, [row.id])).get(row.id);
    const res: z.input<typeof ContributionInviteResponseSchema> = {
      user: encodeId("user", row.id),
      namespace: display?.namespace ?? null,
      invited: invite,
    };
    return c.json(res);
  }

  // 邀请名单只有作者可见：列出用户 ID、显示名与 namespace。
  route(app, {
    method: "get",
    path: INVITES,
    authorize: settingsAuthorize,
    handler: async (c, { loaded: ctx }) => {
      const { db } = c.var.services;
      const rows = await db
        .select({ userId: contributionInvites.userId, createdAt: contributionInvites.createdAt })
        .from(contributionInvites)
        .where(eq(contributionInvites.creationId, ctx.creation.id))
        .orderBy(asc(contributionInvites.createdAt), asc(contributionInvites.userId))
        .limit(1000);
      const users = await userDisplaysOf(
        db,
        rows.map((r) => r.userId),
      );
      c.header("cache-control", "private, no-store");
      return c.json({
        items: rows.map((r) => {
          const u = users.get(r.userId);
          return {
            user: encodeId("user", r.userId),
            display_name: u?.display_name ?? null,
            namespace: u?.namespace ?? null,
            invited_at: r.createdAt.toISOString(),
          };
        }),
      });
    },
  });

  route(app, {
    method: "post",
    path: INVITES,
    body: ContributionInviteRequestSchema,
    authorize: settingsAuthorize,
    handler: (c, { body, loaded: ctx }) => updateInvite(c, ctx, body, true),
  });

  // 取消邀请：路径里可以是用户 ID，也可以是 `@namespace`。
  route(app, {
    method: "delete",
    path: `${INVITES}/:user`,
    authorize: settingsAuthorize,
    handler: (c, { loaded: ctx }) => {
      const who = param(c, "user");
      return updateInvite(c, ctx, who.startsWith("@") ? { namespace: who } : { user: who }, false);
    },
  });
}
