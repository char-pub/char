/**
 * 追加型审计日志与哈希链。
 *
 * 每条记录的 hash = sha256(JCS({ prev_hash, at, actor, action, subject, request_id,
 * ip_hash, before, after }))，prev_hash 是上一条记录的 hash（第一条为 null）。
 * 修改、删除或插入任何一条记录都会让之后的链断开，`verifyAuditChain` 能定位到断点。
 *
 * 审计记录必须和业务变更在同一个事务里写入：业务回滚时审计也回滚，
 * 不会出现"做了但没记录"或"记录了但没做"。
 */
import { digestJson, normalizeValue } from "@char-pub/core";
import { asc, desc, gt, sql } from "drizzle-orm";
import type { Executor, Tx } from "../db/client.js";
import { auditLog } from "../db/schema/index.js";

export type AuditActor =
  | { kind: "user"; id: string }
  | { kind: "staff"; id: string }
  | { kind: "system"; id: string }
  | { kind: "oidc"; id: string };

export interface AuditEntry {
  at: Date;
  actor: AuditActor;
  action: string;
  subject: string;
  requestId?: string | null;
  ipHash?: string | null;
  /** 只记录字段差异，不含正文。 */
  before?: unknown;
  after?: unknown;
}

export interface AppendedAudit {
  id: bigint;
  hash: string;
  prevHash: string | null;
}

/** 所有追加操作共用的事务级 advisory lock，保证链按提交顺序串行增长。 */
const AUDIT_LOCK_KEY = sql`hashtext('app.audit_log')`;

function hashEntry(prevHash: string | null, e: Required<Omit<AuditEntry, "at">> & { at: Date }) {
  return digestJson(
    normalizeValue({
      prev_hash: prevHash,
      at: e.at.toISOString(),
      actor: e.actor,
      action: e.action,
      subject: e.subject,
      request_id: e.requestId,
      ip_hash: e.ipHash,
      before: e.before,
      after: e.after,
    }),
  );
}

function complete(e: AuditEntry) {
  return {
    at: e.at,
    actor: e.actor,
    action: e.action,
    subject: e.subject,
    requestId: e.requestId ?? null,
    ipHash: e.ipHash ?? null,
    before: e.before ?? null,
    after: e.after ?? null,
  };
}

/**
 * 在调用方的事务中追加一条审计记录。事务结束前其他追加会等待，
 * 所以 id 顺序与链的顺序一致。
 */
export async function appendAudit(tx: Tx, entry: AuditEntry): Promise<AppendedAudit> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`);
  const [last] = await tx
    .select({ hash: auditLog.hash })
    .from(auditLog)
    .orderBy(desc(auditLog.id))
    .limit(1);
  const prevHash = last?.hash ?? null;
  const e = complete(entry);
  const hash = hashEntry(prevHash, e);
  const [row] = await tx
    .insert(auditLog)
    .values({ ...e, prevHash, hash })
    .returning({ id: auditLog.id });
  if (!row) throw new Error("audit insert returned no row");
  return { id: row.id, hash, prevHash };
}

export type AuditChainResult =
  | { ok: true; count: number; head: string | null }
  | {
      ok: false;
      count: number;
      brokenAt: bigint;
      reason: "prev_hash_mismatch" | "hash_mismatch";
    };

/** 从头校验整条审计链。按 id 分批读取，不会一次把整张表读进内存。 */
export async function verifyAuditChain(db: Executor, batchSize = 500): Promise<AuditChainResult> {
  let prev: string | null = null;
  let cursor = -1n;
  let count = 0;
  for (;;) {
    const rows = await db
      .select()
      .from(auditLog)
      .where(gt(auditLog.id, cursor))
      .orderBy(asc(auditLog.id))
      .limit(batchSize);
    if (rows.length === 0) break;
    for (const r of rows) {
      if (r.prevHash !== prev) {
        return { ok: false, count, brokenAt: r.id, reason: "prev_hash_mismatch" };
      }
      const expected = hashEntry(prev, {
        at: r.at,
        actor: r.actor as AuditActor,
        action: r.action,
        subject: r.subject,
        requestId: r.requestId,
        ipHash: r.ipHash,
        before: r.before,
        after: r.after,
      });
      if (expected !== r.hash) {
        return { ok: false, count, brokenAt: r.id, reason: "hash_mismatch" };
      }
      prev = r.hash;
      cursor = r.id;
      count += 1;
    }
  }
  return { ok: true, count, head: prev };
}
