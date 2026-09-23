/**
 * Contribution 的数据访问与合并：加载、编号、针对草稿的合并预览、接受时写回草稿与
 * 创建 Revision。路由只做授权与 HTTP 映射，业务逻辑都在这里。
 *
 * 合并规则来自 core：逐个变更按稳定键比较 base digest 与当前 digest，没被别人改过的自动
 * rebase，两边都改了的就是冲突；有任何冲突时不产生结果。
 */
import {
  type Change,
  CharError,
  type CreationInput,
  canonicalizeCreation,
  isCharError,
  type MergeResult,
  mergeContribution,
} from "@char-pub/core";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { type AuditActor, appendAudit } from "../audit/audit.js";
import type { Principal } from "../authz/authorize.js";
import type { Db, Executor, Tx } from "../db/client.js";
import {
  authUser,
  contributionChanges,
  contributionInvites,
  contributions,
  creationDrafts,
  creations,
  guests,
  namespaceMembers,
  namespaces,
  revisionFragments,
  revisions,
} from "../db/schema/index.js";
import type { Cas } from "../storage/cas.js";
import { loadRevisionContent, storeRevisionContent } from "./content.js";
import { encodeId } from "./ids.js";
import type { CreationContext } from "./lookup.js";

export type ContributionRow = typeof contributions.$inferSelect;
export type ContributionChangeRow = typeof contributionChanges.$inferSelect;

/** 当前用户是否被邀请向这个 Creation 提交 Contribution。 */
export async function isInvited(db: Executor, creationId: string, p: Principal): Promise<boolean> {
  if (p.kind !== "user") return false;
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(contributionInvites)
    .where(
      and(
        eq(contributionInvites.creationId, creationId),
        eq(contributionInvites.userId, p.user_id),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function loadContribution(
  db: Executor,
  creationId: string,
  number: number,
): Promise<{ row: ContributionRow; changes: ContributionChangeRow[] } | null> {
  const [row] = await db
    .select()
    .from(contributions)
    .where(and(eq(contributions.targetCreationId, creationId), eq(contributions.number, number)))
    .limit(1);
  if (!row) return null;
  const changes = await db
    .select()
    .from(contributionChanges)
    .where(eq(contributionChanges.contributionId, row.id))
    .orderBy(contributionChanges.position);
  return { row, changes };
}

/** 从存储的行还原成提交时的变更对象（它原样保存在 after 列的 `change` 字段里）。 */
export function changeOf(r: ContributionChangeRow): unknown {
  return (r.after as { change: unknown }).change;
}

/** 当前草稿（作者的工作副本）。 */
export async function loadDraft(db: Executor, creationId: string) {
  const [draft] = await db
    .select()
    .from(creationDrafts)
    .where(eq(creationDrafts.creationId, creationId))
    .limit(1);
  return draft ?? null;
}

export interface MergeAttempt {
  merge: MergeResult | null;
  /** 合并本身失败（变更不合法，或合并后的 Creation 不合法）时的错误。 */
  error: CharError | null;
}

/** 与给定内容试合并。形状错误等 CharError 被捕获并返回，不抛出。 */
export function tryMerge(target: unknown, changes: readonly unknown[]): MergeAttempt {
  try {
    return { merge: mergeContribution(target as CreationInput, changes), error: null };
  } catch (e) {
    if (!isCharError(e)) throw e;
    return { merge: null, error: e };
  }
}

/** 从对象存储读取 Revision 的 canonical 内容。 */
export async function revisionContent(cas: Cas, semanticDigest: string) {
  return (await loadRevisionContent(cas, semanticDigest)).json;
}

/** 在事务中锁住目标 Creation 行，分配下一个 Contribution 编号。 */
export async function nextNumber(tx: Tx, creationId: string): Promise<number> {
  await tx.execute(sql`SELECT 1 FROM app.creations WHERE id = ${creationId} FOR UPDATE`);
  const [row] = await tx
    .select({ n: sql<number>`coalesce(max(${contributions.number}), 0)` })
    .from(contributions)
    .where(eq(contributions.targetCreationId, creationId));
  return Number(row?.n ?? 0) + 1;
}

export function authorOf(row: ContributionRow, guestNames?: ReadonlyMap<string, string>) {
  if (row.authorUserId) return { user: encodeId("user", row.authorUserId) };
  const id = row.authorGuestId ?? "";
  return { guest_id: id, display_name: guestNames?.get(id) ?? id };
}

/** 一批 Contribution 中访客作者的显示名。 */
export async function guestNamesOf(
  db: Executor,
  rows: readonly ContributionRow[],
): Promise<Map<string, string>> {
  const ids = [...new Set(rows.flatMap((r) => (r.authorGuestId ? [r.authorGuestId] : [])))];
  if (ids.length === 0) return new Map();
  const found = await db
    .select({ id: guests.guestId, name: guests.displayName })
    .from(guests)
    .where(inArray(guests.guestId, ids));
  return new Map(found.map((g) => [g.id, g.name]));
}

/** 对外展示的用户信息：显示名与个人 namespace。不包含邮箱。 */
export interface UserDisplay {
  display_name: string;
  namespace: string | null;
}

/** 按用户 ID 查显示名与个人 namespace（`@slug`）。 */
export async function userDisplaysOf(
  db: Executor,
  userIds: readonly string[],
): Promise<Map<string, UserDisplay>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const users = await db
    .select({ id: authUser.id, name: authUser.name })
    .from(authUser)
    .where(inArray(authUser.id, ids));
  const owned = await db
    .select({ userId: namespaceMembers.userId, slug: namespaces.slug })
    .from(namespaceMembers)
    .innerJoin(namespaces, eq(namespaces.id, namespaceMembers.namespaceId))
    .where(
      and(
        inArray(namespaceMembers.userId, ids),
        eq(namespaceMembers.role, "owner"),
        eq(namespaces.kind, "user"),
      ),
    );
  const slugs = new Map(owned.map((o) => [o.userId, `@${o.slug}`]));
  return new Map(
    users.map((u) => [u.id, { display_name: u.name, namespace: slugs.get(u.id) ?? null }]),
  );
}

/** 列表与详情展示作者需要的名字：访客的显示名、登录用户的显示名与 namespace。 */
export interface AuthorNames {
  guests: ReadonlyMap<string, string>;
  users: ReadonlyMap<string, UserDisplay>;
}

export async function authorNamesOf(
  db: Executor,
  rows: readonly ContributionRow[],
): Promise<AuthorNames> {
  const userIds = rows.flatMap((r) => (r.authorUserId ? [r.authorUserId] : []));
  const [guestNames, users] = await Promise.all([
    guestNamesOf(db, rows),
    userDisplaysOf(db, userIds),
  ]);
  return { guests: guestNames, users };
}

/** 展示用的作者：在 `authorOf` 的基础上，登录用户附带显示名与 namespace。 */
function authorDisplay(row: ContributionRow, names?: AuthorNames) {
  const author = authorOf(row, names?.guests);
  if (!("user" in author) || !row.authorUserId) return author;
  const u = names?.users.get(row.authorUserId);
  return {
    ...author,
    ...(u ? { display_name: u.display_name } : {}),
    ...(u?.namespace ? { namespace: u.namespace } : {}),
  };
}

export function summaryJson(row: ContributionRow, names?: AuthorNames) {
  return {
    id: encodeId("contribution", row.id),
    number: row.number,
    title: row.title,
    status: row.status,
    agent: row.agent,
    author: authorDisplay(row, names),
    base_revision: encodeId("revision", row.baseRevisionId),
    created_at: row.createdAt.toISOString(),
    decided_at: row.decidedAt?.toISOString() ?? null,
  };
}

export function previewJson(attempt: MergeAttempt) {
  if (!attempt.merge) {
    return {
      mergeable: false,
      outcomes: [],
      conflicts: [],
      sensitive_keys: [],
      error: attempt.error?.code ?? "contribution.invalid",
    };
  }
  const m = attempt.merge;
  return {
    mergeable: m.conflicts.length === 0,
    outcomes: m.outcomes.map((o) => ({
      key: o.key,
      on: o.on,
      op: o.op,
      state: o.state,
      sensitive: o.sensitive,
      ...(o.reason ? { reason: o.reason } : {}),
    })),
    conflicts: m.conflicts.map((o) => o.key),
    sensitive_keys: m.outcomes
      .filter((o) => o.sensitive && o.state === "applied")
      .map((o) => o.key),
  };
}

export interface ListFilter {
  status?: ContributionRow["status"];
  agent?: boolean;
  /** 只列出这个用户提交的（非成员查看时使用）。 */
  authorUserId?: string;
  /** 只列出这个访客提交的（访客查看时使用）。 */
  authorGuestId?: string;
  beforeNumber?: number;
  limit: number;
}

export async function contributionCounts(
  db: Executor,
  creationId: string,
  f: Omit<ListFilter, "limit">,
) {
  const counts = { open: 0, accepted: 0, rejected: 0, withdrawn: 0 };
  const conds = [eq(contributions.targetCreationId, creationId)];
  if (f.agent !== undefined) conds.push(eq(contributions.agent, f.agent));
  if (f.authorUserId) conds.push(eq(contributions.authorUserId, f.authorUserId));
  if (f.authorGuestId) conds.push(eq(contributions.authorGuestId, f.authorGuestId));
  const rows = await db
    .select({ status: contributions.status, count: sql<number>`count(*)::integer` })
    .from(contributions)
    .where(and(...conds))
    .groupBy(contributions.status);
  for (const row of rows) counts[row.status] = Number(row.count);
  return counts;
}
export async function listContributions(db: Executor, creationId: string, f: ListFilter) {
  const conds = [eq(contributions.targetCreationId, creationId)];
  if (f.status) conds.push(eq(contributions.status, f.status));
  if (f.agent !== undefined) conds.push(eq(contributions.agent, f.agent));
  if (f.authorUserId) conds.push(eq(contributions.authorUserId, f.authorUserId));
  if (f.authorGuestId) conds.push(eq(contributions.authorGuestId, f.authorGuestId));
  if (f.beforeNumber !== undefined) conds.push(lt(contributions.number, f.beforeNumber));
  return db
    .select()
    .from(contributions)
    .where(and(...conds))
    .orderBy(desc(contributions.number))
    .limit(f.limit);
}

/** 在已合并的 Creation 的 provenance 里追加贡献者（去重）。 */
export function withContributor(
  merged: Record<string, unknown>,
  contributor: {
    author: string | { guest_id: string; display_name: string };
    contribution: string;
  },
): Record<string, unknown> {
  const provenance = { ...((merged.provenance as Record<string, unknown> | undefined) ?? {}) };
  const list = [...((provenance.contributors as unknown[] | undefined) ?? [])];
  const key = JSON.stringify(contributor.author);
  if (!list.some((c) => JSON.stringify((c as { author: unknown }).author) === key)) {
    list.push(contributor);
  }
  provenance.contributors = list;
  return { ...merged, provenance };
}

export interface AcceptInput {
  ctx: CreationContext;
  row: ContributionRow;
  changes: ContributionChangeRow[];
  merged: Record<string, unknown>;
  mergeResult: MergeResult;
  /** 合并时读到的草稿版本；写回时必须仍然是这个版本。 */
  draftVersion: number;
  deciderUserId: string;
  actor: AuditActor;
  requestId: string | null;
  now: Date;
  newId: () => string;
}

/**
 * 接受：写回草稿、创建 Revision、更新 Contribution 状态与每个变更的合并状态、写审计。
 * 草稿在合并期间被改过时返回 null（调用方返回 409 让作者重试）。
 */
export async function acceptContribution(
  db: Db,
  cas: Cas,
  input: AcceptInput,
): Promise<{ revisionId: string; semanticDigest: string } | null> {
  const canonical = canonicalizeCreation(input.merged);
  // 内容先写入对象存储（按内容寻址，重复写入无副作用）。
  const stored = await storeRevisionContent(db, cas, canonical);
  const creationId = input.ctx.creation.id;
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(creationDrafts)
      .set({
        working: input.merged,
        version: input.draftVersion + 1,
        updatedBy: input.deciderUserId,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(creationDrafts.creationId, creationId),
          eq(creationDrafts.version, input.draftVersion),
        ),
      )
      .returning({ version: creationDrafts.version });
    if (updated.length === 0) return null;

    const [existing] = await tx
      .select()
      .from(revisions)
      .where(
        and(
          eq(revisions.creationId, creationId),
          eq(revisions.semanticDigest, canonical.semantic_digest),
        ),
      )
      .limit(1);
    const [draft] = await tx
      .select({ base: creationDrafts.baseRevisionId })
      .from(creationDrafts)
      .where(eq(creationDrafts.creationId, creationId));
    let revisionId = existing?.id;
    if (!revisionId) {
      revisionId = input.newId();
      await tx.insert(revisions).values({
        id: revisionId,
        creationId,
        parentId: draft?.base ?? null,
        manifestDigest: canonical.semantic_digest,
        semanticDigest: canonical.semantic_digest,
        authorKind: "contribution",
        authorContributionId: input.row.id,
        message: `contribution #${input.row.number}: ${input.row.title}`.slice(0, 500),
        createdAt: input.now,
      });
      if (stored.fragments.length > 0) {
        await tx.insert(revisionFragments).values(
          stored.fragments.map((f) => ({
            revisionId: revisionId as string,
            fragmentId: f.id,
            digest: f.digest,
            kind: f.kind as (typeof revisionFragments.$inferInsert)["kind"],
            stable: f.stable,
            position: f.position,
          })),
        );
      }
    }
    await tx
      .update(creations)
      .set({ headRevisionId: revisionId, updatedAt: input.now })
      .where(eq(creations.id, creationId));
    await tx
      .update(creationDrafts)
      .set({ baseRevisionId: revisionId })
      .where(eq(creationDrafts.creationId, creationId));

    const accepted = await tx
      .update(contributions)
      .set({
        status: "accepted",
        decidedBy: input.deciderUserId,
        decidedAt: input.now,
        resultRevisionId: revisionId,
        updatedAt: input.now,
      })
      .where(and(eq(contributions.id, input.row.id), eq(contributions.status, "open")))
      .returning({ id: contributions.id });
    if (accepted.length === 0) {
      throw new CharError({ code: "contribution.not_open", subject: input.row.id });
    }
    for (const o of input.mergeResult.outcomes) {
      const change = input.changes[o.index];
      if (!change) continue;
      await tx
        .update(contributionChanges)
        .set({ mergeState: o.state === "applied" ? "applied" : "skipped" })
        .where(eq(contributionChanges.id, change.id));
    }
    await appendAudit(tx, {
      at: input.now,
      actor: input.actor,
      action: "contribution.accept",
      subject: `contribution:${input.row.id}`,
      requestId: input.requestId,
      after: {
        revision: revisionId,
        semantic_digest: canonical.semantic_digest,
        applied: input.mergeResult.outcomes.filter((o) => o.state === "applied").map((o) => o.key),
        sensitive_confirmed: input.mergeResult.sensitive_keys,
      },
    });
    return { revisionId, semanticDigest: canonical.semantic_digest };
  });
}

/** 把一个已解析的变更与它的服务端属性保存成一行。 */
export function changeRow(
  contributionId: string,
  position: number,
  raw: unknown,
  parsed: Change,
  key: string,
  sensitive: boolean,
  newId: () => string,
): typeof contributionChanges.$inferInsert {
  const op = parsed.op;
  const baseDigest = parsed.base_digest ?? null;
  // 完整的变更对象（包括 after）保存在 after 列里，读取时原样还原，保证重新合并时输入不变。
  const stored =
    parsed.on === "metadata" ? { ...(raw as Record<string, unknown>), sensitive } : (raw as object);
  return {
    id: newId(),
    contributionId,
    changeKey: key,
    on: parsed.on,
    op,
    baseDigest,
    after: { change: stored },
    sensitive,
    position,
  };
}
