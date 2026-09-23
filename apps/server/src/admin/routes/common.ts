/**
 * admin 路由共用的小工具：对外 ID 的解析、员工审计 actor、处置记录。
 *
 * admin API 与公开 API 一样对外使用 TypeID（`cr_…`、`rel_…`、`usr_…`），数据库中是 UUID。
 * 为方便运营人员从日志里复制，也接受直接给出的 UUID。
 */
import type { IdKind } from "@char-pub/core";
import type { AuditActor } from "../../audit/audit.js";
import type { Tx } from "../../db/client.js";
import { moderationActions } from "../../db/schema/index.js";
import { fromPublicId, toPublicId } from "../../registry/read.js";
import type { AdminContext } from "../app.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(s: string | undefined): s is string {
  return s !== undefined && UUID_RE.test(s);
}

/** 解析路径里的 ID：TypeID 或 UUID。非法时返回 null。 */
export function parseId(kind: IdKind, raw: string | undefined): string | null {
  if (!raw) return null;
  if (UUID_RE.test(raw)) return raw;
  return fromPublicId(kind, raw);
}

export function publicId(kind: IdKind, uuid: string): string {
  return toPublicId(kind, uuid);
}

export function staffActor(c: AdminContext): AuditActor {
  return { kind: "staff", id: c.var.staff.user_id };
}

/** 写一条处置记录（与审计日志一起写在同一个事务里）。 */
export async function recordAction(
  tx: Tx,
  c: AdminContext,
  input: {
    action: string;
    subject: Record<string, unknown>;
    reason: string;
    params?: Record<string, unknown>;
    legalRequestId?: string | undefined;
  },
): Promise<string> {
  const id = c.var.services.ids.uuid();
  await tx.insert(moderationActions).values({
    id,
    actorId: c.var.staff.user_id,
    action: input.action,
    subject: input.subject,
    reason: input.reason,
    ...(input.params ? { params: input.params } : {}),
    ...(input.legalRequestId ? { legalRequestId: input.legalRequestId } : {}),
    createdAt: c.var.services.clock.now(),
  });
  return id;
}

/** 写操作请求体的公共部分。 */
export interface WithReason {
  reason: string;
  legal_request_id?: string | undefined;
}
