/**
 * 四眼原则：影响特别大的操作由一名员工发起、另一名具备相同能力的员工确认后才执行。
 *
 * - 发起时记录“除发起人以外有资格确认的员工数量”。只有发起人一个人有资格时，
 *   发起人要等冷静期（24 小时）结束后才能自己确认，确认记录中注明这一点。
 * - 确认与执行在同一个事务里完成：执行失败时确认也不生效，请求保持 pending。
 * - 请求记录只追加、只改状态，不能删除。
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { appendAudit } from "../audit/audit.js";
import type { Tx } from "../db/client.js";
import { authUser, staffApprovals } from "../db/schema/index.js";
import type { Staff } from "./app.js";
import { parseRoles } from "./app.js";
import {
  COOLING_OFF_MS,
  canConfirm,
  type FourEyesKind,
  type StaffCapability,
  staffCan,
} from "./roles.js";

/** 每种四眼操作需要的确认能力。 */
export const APPROVAL_CAPABILITY: Record<FourEyesKind, StaffCapability> = {
  "tombstone.large": "tombstone.policy",
  "unban.csam": "users.ban",
  "staff.remove_owner": "staff.manage",
};

export type ApprovalRow = typeof staffApprovals.$inferSelect;

export interface ApprovalView {
  id: string;
  kind: FourEyesKind;
  subject: string;
  initiated_by: string;
  initiated_at: string;
  reason: string;
  other_eligible_staff: number;
  cooling_off_until: string;
  status: "pending" | "confirmed" | "cancelled";
}

export function approvalView(a: ApprovalRow, initiatorEmail: string): ApprovalView {
  return {
    id: a.id,
    kind: a.kind,
    subject: a.subject,
    initiated_by: initiatorEmail,
    initiated_at: a.initiatedAt.toISOString(),
    reason: a.reason,
    other_eligible_staff: a.otherEligibleStaff,
    cooling_off_until: new Date(a.initiatedAt.getTime() + COOLING_OFF_MS).toISOString(),
    status: a.status,
  };
}

/**
 * 除发起人以外，具备某项能力、未被封禁的员工数量。
 * `tombstone.large` 的确认能力取决于原因代码，调用方传入具体能力。
 */
export async function otherEligibleStaff(
  tx: Tx,
  capability: StaffCapability,
  initiatorId: string,
): Promise<number> {
  const rows = await tx
    .select({ id: authUser.id, role: authUser.role })
    .from(authUser)
    .where(
      and(
        ne(authUser.id, initiatorId),
        eq(authUser.banned, false),
        sql`${authUser.role} IS NOT NULL`,
      ),
    );
  return rows.filter((r) => staffCan(parseRoles(r.role), capability)).length;
}

export async function createApproval(
  tx: Tx,
  input: {
    id: string;
    kind: FourEyesKind;
    capability: StaffCapability;
    subject: string;
    payload: Record<string, unknown>;
    reason: string;
    staff: Staff;
    now: Date;
    requestId?: string;
  },
): Promise<ApprovalView> {
  const others = await otherEligibleStaff(tx, input.capability, input.staff.user_id);
  const [row] = await tx
    .insert(staffApprovals)
    .values({
      id: input.id,
      kind: input.kind,
      subject: input.subject,
      payload: { ...input.payload, capability: input.capability },
      reason: input.reason,
      initiatedBy: input.staff.user_id,
      initiatedAt: input.now,
      otherEligibleStaff: others,
    })
    .returning();
  if (!row) throw new Error("approval insert returned no row");
  await appendAudit(tx, {
    at: input.now,
    actor: { kind: "staff", id: input.staff.user_id },
    action: "approval.request",
    subject: `approval:${row.id}`,
    requestId: input.requestId ?? null,
    after: { kind: input.kind, subject: input.subject, other_eligible_staff: others },
  });
  return approvalView(row, input.staff.email);
}

export type ConfirmOutcome =
  | { ok: true; row: ApprovalRow; selfConfirmedAfterCoolingOff: boolean }
  | { ok: false; status: 403 | 404 | 409; code: string };

/**
 * 检查并锁定一个待确认请求。通过后由调用方在同一事务中执行操作，再调用 `markConfirmed`。
 */
export async function lockForConfirm(
  tx: Tx,
  id: string,
  staff: Staff,
  now: Date,
): Promise<ConfirmOutcome> {
  const [row] = await tx
    .select()
    .from(staffApprovals)
    .where(eq(staffApprovals.id, id))
    .for("update");
  if (!row) return { ok: false, status: 404, code: "not_found" };
  if (row.status !== "pending") return { ok: false, status: 409, code: "approval.not_pending" };
  const capability =
    (row.payload as { capability?: StaffCapability }).capability ?? APPROVAL_CAPABILITY[row.kind];
  if (!staffCan(staff.roles, capability))
    return { ok: false, status: 403, code: "admin.forbidden" };
  const check = canConfirm(
    {
      kind: row.kind,
      initiated_by: row.initiatedBy,
      initiated_at: row.initiatedAt.getTime(),
      other_eligible_staff: row.otherEligibleStaff,
    },
    staff.user_id,
    now.getTime(),
  );
  if (!check.ok) return { ok: false, status: 403, code: check.code };
  return { ok: true, row, selfConfirmedAfterCoolingOff: row.initiatedBy === staff.user_id };
}

export async function markDecided(
  tx: Tx,
  input: {
    row: ApprovalRow;
    status: "confirmed" | "cancelled";
    staff: Staff;
    now: Date;
    reason: string;
    selfConfirmedAfterCoolingOff?: boolean;
    requestId?: string;
  },
): Promise<void> {
  await tx
    .update(staffApprovals)
    .set({
      status: input.status,
      decidedBy: input.staff.user_id,
      decidedAt: input.now,
      updatedAt: input.now,
    })
    .where(eq(staffApprovals.id, input.row.id));
  await appendAudit(tx, {
    at: input.now,
    actor: { kind: "staff", id: input.staff.user_id },
    action: input.status === "confirmed" ? "approval.confirm" : "approval.cancel",
    subject: `approval:${input.row.id}`,
    requestId: input.requestId ?? null,
    after: {
      kind: input.row.kind,
      reason: input.reason,
      ...(input.selfConfirmedAfterCoolingOff ? { self_confirmed_after_cooling_off: true } : {}),
    },
  });
}
