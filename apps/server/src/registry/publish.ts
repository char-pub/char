/**
 * 发布请求与 Revision 创建的共用逻辑。网页 / CLI 的原生发布和 GitHub Action 的 OIDC 发布
 * 走同一套流程：
 *
 * 1. `createRevision`：把 canonical Creation 写入 private 对象存储，建立不可变 Revision；
 *    同样内容的 Revision 只保留一个。
 * 2. `requestPublish`：在一个事务里占用 label（插入 publish_state 为 pending 的 Release）、
 *    把 publish 任务入队、写审计。worker 随后完成发布校验与构建。
 *
 * 幂等规则：
 * - 同一个 Idempotency-Key 重复请求返回同一个 Release；同一个 key 用于不同的请求报错；
 * - 同一个 label 已经指向相同内容时返回已有的 Release；指向不同内容则冲突。
 */
import type { canonicalizeCreation } from "@char-pub/core";
import { and, eq, ne } from "drizzle-orm";
import type { Services } from "../api/app.js";
import { type AuditActor, appendAudit } from "../audit/audit.js";
import type { Executor } from "../db/client.js";
import {
  creationDrafts,
  creations,
  releases,
  revisionFragments,
  revisions,
} from "../db/schema/index.js";
import { QUEUE_NAMES } from "../jobs/definitions.js";
import { storeRevisionContent } from "./content.js";
import { hasUnconfirmedImport } from "./imports.js";

export type ReleaseRow = typeof releases.$inferSelect;
export type RevisionRow = typeof revisions.$inferSelect;

export const IDEMPOTENCY_KEY_RE = /^[\x21-\x7e]{8,200}$/;

export interface CreateRevisionInput {
  creationId: string;
  canonical: ReturnType<typeof canonicalizeCreation>;
  parentId: string | null;
  author: { kind: "user"; userId: string } | { kind: "source" };
  message: string | null;
  actor: AuditActor;
  requestId: string | null;
  /** 为 true 时同时把草稿的基线指向新 Revision（原生编辑）；外部 Source 不动草稿。 */
  updateDraftBase: boolean;
}

export async function findRevisionByDigest(
  db: Executor,
  creationId: string,
  semanticDigest: string,
): Promise<RevisionRow | undefined> {
  const [r] = await db
    .select()
    .from(revisions)
    .where(and(eq(revisions.creationId, creationId), eq(revisions.semanticDigest, semanticDigest)))
    .limit(1);
  return r;
}

/**
 * 建立 Revision。内容先写入对象存储（按内容寻址，重复写入没有副作用），再在一个事务里
 * 写 revision、fragment 索引与审计。返回的 `created` 为 false 表示同样内容的 Revision 已经存在。
 */
export async function createRevision(
  services: Pick<Services, "db" | "cas" | "ids" | "clock">,
  input: CreateRevisionInput,
): Promise<{ row: RevisionRow; created: boolean }> {
  const { db, cas, ids, clock } = services;
  const semantic = input.canonical.semantic_digest;
  const before = await findRevisionByDigest(db, input.creationId, semantic);
  if (before) return { row: before, created: false };

  const stored = await storeRevisionContent(db, cas, input.canonical);
  const id = ids.uuid();
  const now = clock.now();
  const inserted = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(revisions)
      .values({
        id,
        creationId: input.creationId,
        parentId: input.parentId,
        manifestDigest: semantic,
        semanticDigest: semantic,
        authorKind: input.author.kind,
        authorUserId: input.author.kind === "user" ? input.author.userId : null,
        message: input.message,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning();
    const row = rows[0];
    if (!row) return null;
    if (stored.fragments.length > 0) {
      await tx.insert(revisionFragments).values(
        stored.fragments.map((f) => ({
          revisionId: id,
          fragmentId: f.id,
          digest: f.digest,
          kind: f.kind as (typeof revisionFragments.$inferInsert)["kind"],
          stable: f.stable,
          position: f.position,
        })),
      );
    }
    await tx
      .update(creations)
      .set({ headRevisionId: id, updatedAt: now })
      .where(eq(creations.id, input.creationId));
    if (input.updateDraftBase) {
      await tx
        .update(creationDrafts)
        .set({ baseRevisionId: id })
        .where(eq(creationDrafts.creationId, input.creationId));
    }
    await appendAudit(tx, {
      at: now,
      actor: input.actor,
      action: "revision.create",
      subject: `creation:${input.creationId}`,
      requestId: input.requestId,
      after: { revision: id, semantic_digest: semantic },
    });
    return row;
  });
  if (inserted) return { row: inserted, created: true };
  // 并发创建了同样内容的 Revision：返回先写入的那个。
  const row = await findRevisionByDigest(db, input.creationId, semantic);
  if (!row) throw new Error("revision vanished after a concurrent insert");
  return { row, created: false };
}

export interface RequestPublishInput {
  creationId: string;
  revision: RevisionRow;
  label: string;
  visibility: "public" | "private";
  idempotencyKey: string;
  /** Release 的 source 记录（原生发布指向 Revision，GitHub 发布指向仓库与 commit）。 */
  source: unknown;
  /** Release 的 published_by（用户 ID 或 `{ oidc: claims }`）。 */
  publishedBy: unknown;
  actor: AuditActor;
  requestId: string | null;
}

export type RequestPublishResult =
  | { kind: "created"; row: ReleaseRow }
  | { kind: "same"; row: ReleaseRow }
  | { kind: "idempotent"; row: ReleaseRow }
  | { kind: "key_reused" }
  | { kind: "taken" }
  /** 由导入生成、评级、权利与许可还没有被作者确认。 */
  | { kind: "import_unconfirmed" };

export async function requestPublish(
  services: Pick<Services, "db" | "ids" | "clock" | "queue">,
  input: RequestPublishInput,
): Promise<RequestPublishResult> {
  const { db, ids, clock, queue } = services;
  const [byKey] = await db
    .select()
    .from(releases)
    .where(
      and(
        eq(releases.creationId, input.creationId),
        eq(releases.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (byKey) {
    if (byKey.label !== input.label || byKey.revisionId !== input.revision.id) {
      return { kind: "key_reused" };
    }
    return { kind: "idempotent", row: byKey };
  }
  if (await hasUnconfirmedImport(db, input.creationId)) return { kind: "import_unconfirmed" };

  const now = clock.now();
  const id = ids.uuid();
  return db.transaction(async (tx): Promise<RequestPublishResult> => {
    const [taken] = await tx
      .select()
      .from(releases)
      .where(
        and(
          eq(releases.creationId, input.creationId),
          eq(releases.label, input.label),
          ne(releases.publishState, "failed"),
        ),
      )
      .limit(1)
      .for("update");
    if (taken) {
      return taken.semanticDigest === input.revision.semanticDigest
        ? { kind: "same", row: taken }
        : { kind: "taken" };
    }
    const [row] = await tx
      .insert(releases)
      .values({
        id,
        creationId: input.creationId,
        label: input.label,
        visibility: input.visibility,
        status: "active",
        publishState: "pending",
        revisionId: input.revision.id,
        source: input.source,
        semanticDigest: input.revision.semanticDigest,
        publishedBy: input.publishedBy,
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    // 并发请求刚刚占用了同一个 label。
    if (!row) return { kind: "taken" };
    await queue.enqueue(
      tx,
      QUEUE_NAMES.publish,
      { release_id: id },
      { singletonKey: `publish:${id}` },
    );
    await appendAudit(tx, {
      at: now,
      actor: input.actor,
      action: "release.publish_requested",
      subject: `release:${id}`,
      requestId: input.requestId,
      after: {
        creation: input.creationId,
        label: input.label,
        visibility: input.visibility,
        semantic_digest: input.revision.semanticDigest,
      },
    });
    return { kind: "created", row };
  });
}
