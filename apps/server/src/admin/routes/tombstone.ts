/**
 * 法律下架与严重违规处置（tombstone），以及需要两名员工确认的请求。
 *
 * - 下架对象用一个字符串描述，便于从界面或日志中直接粘贴：
 *   `fragment:sha256:…`、`asset:sha256:…`、`release:<id>`、`creation:<id>`、
 *   `@ns/name`（整个 Creation）、`@ns/name@label`（某个 Release），或者裸的 `sha256:…`
 *   （按 fragment 处理，找不到时按 asset 处理）。
 * - 原因代码决定需要的权限：`legal.*` 需要法律下架权限并且必须关联法律请求；
 *   其他原因需要严重违规处置权限。
 * - 影响超过 50 个 Release 时不会立即执行，而是创建待确认请求，由另一名具备相同权限的
 *   员工确认后执行（四眼原则）。
 */
import { CharError, isCharError } from "@char-pub/core";
import { and, desc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import type { Executor, Tx } from "../../db/client.js";
import {
  authUser,
  creations,
  namespaces,
  releaseFragments,
  releases,
  staffApprovals,
} from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import {
  executeTombstone,
  previewTombstone,
  TOMBSTONE_REASONS,
  type TombstonePreview,
  type TombstoneReason,
  type TombstoneSubject,
} from "../../registry/tombstone.js";
import { type AdminContext, type AdminEnv, adminRoute } from "../app.js";
import {
  APPROVAL_CAPABILITY,
  approvalView,
  createApproval,
  lockForConfirm,
  markDecided,
} from "../approvals.js";
import { FOUR_EYES_THRESHOLD_RELEASES, type StaffCapability, staffCan } from "../roles.js";
import { parseId, publicId } from "./common.js";
import { executeRoleChange } from "./staff.js";
import { executeUnban } from "./users.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** 把下架对象的字符串描述解析成结构化的对象。无法识别时返回 null。 */
export async function parseSubject(db: Executor, raw: string): Promise<TombstoneSubject | null> {
  const s = raw.trim();
  const [prefix, ...rest] = s.split(":");
  const value = rest.join(":");
  if (prefix === "fragment" && DIGEST.test(value)) return { kind: "fragment", digest: value };
  if (prefix === "asset" && DIGEST.test(value)) return { kind: "asset", digest: value };
  if (prefix === "release") {
    const id = parseId("release", value);
    return id ? { kind: "release", release_id: id } : null;
  }
  if (prefix === "creation") {
    const id = parseId("creation", value);
    return id ? { kind: "creation", creation_id: id } : null;
  }
  if (DIGEST.test(s)) {
    const [f] = await db
      .select({ d: releaseFragments.digest })
      .from(releaseFragments)
      .where(eq(releaseFragments.digest, s))
      .limit(1);
    return f ? { kind: "fragment", digest: s } : { kind: "asset", digest: s };
  }
  const m = /^@([a-z0-9-]+)\/([a-z0-9-]+)(?:@([0-9A-Za-z.+-]+))?$/.exec(s);
  if (!m) return null;
  const [row] = await db
    .select({ id: creations.id })
    .from(creations)
    .innerJoin(namespaces, eq(namespaces.id, creations.namespaceId))
    .where(and(eq(namespaces.slug, m[1] ?? ""), eq(creations.name, m[2] ?? "")));
  if (!row) return null;
  if (!m[3]) return { kind: "creation", creation_id: row.id };
  const [rel] = await db
    .select({ id: releases.id })
    .from(releases)
    .where(and(eq(releases.creationId, row.id), eq(releases.label, m[3])));
  return rel ? { kind: "release", release_id: rel.id } : null;
}

function subjectLabel(s: TombstoneSubject): string {
  switch (s.kind) {
    case "fragment":
    case "asset":
      return `${s.kind}:${s.digest}`;
    case "release":
      return `release:${publicId("release", s.release_id)}`;
    case "creation":
      return `creation:${publicId("creation", s.creation_id)}`;
  }
}

/** 界面使用的影响范围摘要；完整的对象列表在 `detail` 中。 */
function previewView(p: TombstonePreview) {
  return {
    subject: subjectLabel(p.subject),
    releases: p.releases.map((r) => ({
      id: publicId("release", r.release_id),
      ref: r.ref,
      label: r.label,
      via: r.via,
      status: r.status,
    })),
    objects: p.objects.length,
    cdn_urls: p.cdn_urls,
    /** 受影响的下游作者，以其 namespace 表示。 */
    downstream_authors: p.downstream_namespaces.map((n) => `@${n}`),
    requires_four_eyes: p.releases.length > FOUR_EYES_THRESHOLD_RELEASES,
    detail: { objects: p.objects, block: p.block },
  };
}

function capabilityFor(reason: unknown): StaffCapability {
  return typeof reason === "string" && reason.startsWith("legal.")
    ? "tombstone.legal"
    : "tombstone.policy";
}

const SubjectSchema = z.strictObject({ subject: z.string().trim().min(1).max(300) });
const RequestSchema = z.strictObject({
  subject: z.string().trim().min(1).max(300),
  reason_code: z.enum(TOMBSTONE_REASONS),
  reason: z.string().trim().min(10).max(2000),
  legal_request_id: z.uuid().optional(),
});
const DecideSchema = z.strictObject({ reason: z.string().trim().min(10).max(2000) });

interface TombstonePayload {
  subject: TombstoneSubject;
  reason_code: TombstoneReason;
  note: string;
  legal_request_id?: string;
}

async function runTombstone(tx: Tx, c: AdminContext, p: TombstonePayload, actorId: string) {
  return executeTombstone(tx, c.var.services.queue, {
    subject: p.subject,
    reason_code: p.reason_code,
    note: p.note,
    actor: { staff_user_id: actorId },
    ...(p.legal_request_id ? { legal_request_id: p.legal_request_id } : {}),
    now: c.var.services.clock.now(),
    request_id: c.var.requestId,
    action_id: c.var.services.ids.uuid(),
    publicAssetBaseUrl: c.var.services.publicAssetBaseUrl,
  });
}

function charProblem(c: AdminContext, e: unknown): Response {
  if (isCharError(e)) {
    const status = e.code === "tombstone.subject_not_found" ? 404 : 422;
    return problem(c, status, e.code, e.detail);
  }
  throw e;
}

/** 能确认某种请求的能力；下架请求的能力取决于原因代码。 */
function confirmCapability(
  kind: keyof typeof APPROVAL_CAPABILITY,
  payload: unknown,
): StaffCapability {
  const stored = (payload as { capability?: StaffCapability } | null)?.capability;
  return stored ?? APPROVAL_CAPABILITY[kind];
}

const DECIDE_CAPABILITIES = [
  "tombstone.policy",
  "tombstone.legal",
  "users.ban",
  "staff.manage",
] as const;

export function registerTombstone(app: Hono<AdminEnv>): void {
  adminRoute(app, {
    method: "post",
    path: "/v1/admin/tombstones/preview",
    capability: ["tombstone.policy", "tombstone.legal"],
    readOnly: true,
    body: SubjectSchema,
    handler: async (c, { body }) => {
      const subject = await parseSubject(c.var.services.db, body.subject);
      if (!subject) return problem(c, 422, "tombstone.invalid_subject");
      try {
        const p = await previewTombstone(c.var.services.db, subject, {
          publicAssetBaseUrl: c.var.services.publicAssetBaseUrl,
        });
        return c.json(previewView(p));
      } catch (e) {
        return charProblem(c, e);
      }
    },
  });

  adminRoute(app, {
    method: "post",
    path: "/v1/admin/tombstones",
    capability: "tombstone.policy",
    capabilityOf: (raw) =>
      capabilityFor((raw as { reason_code?: unknown } | undefined)?.reason_code),
    body: RequestSchema,
    handler: async (c, { body }) => {
      const { db } = c.var.services;
      const subject = await parseSubject(db, body.subject);
      if (!subject) return problem(c, 422, "tombstone.invalid_subject");
      const payload: TombstonePayload = {
        subject,
        reason_code: body.reason_code,
        note: body.reason,
        ...(body.legal_request_id ? { legal_request_id: body.legal_request_id } : {}),
      };
      try {
        return await db.transaction(async (tx) => {
          const preview = await previewTombstone(tx, subject, {
            publicAssetBaseUrl: c.var.services.publicAssetBaseUrl,
          });
          if (preview.releases.length > FOUR_EYES_THRESHOLD_RELEASES) {
            const approval = await createApproval(tx, {
              id: c.var.services.ids.uuid(),
              kind: "tombstone.large",
              capability: capabilityFor(body.reason_code),
              subject: subjectLabel(subject),
              payload: { ...payload, affected_releases: preview.releases.length },
              reason: body.reason,
              staff: c.var.staff,
              now: c.var.services.clock.now(),
              requestId: c.var.requestId,
            });
            return c.json({ executed: false, approval }, 202);
          }
          const r = await runTombstone(tx, c, payload, c.var.staff.user_id);
          return c.json({
            executed: true,
            action_id: r.action_id,
            preview: previewView(r.preview),
          });
        });
      } catch (e) {
        return charProblem(c, e);
      }
    },
  });

  adminRoute(app, {
    method: "get",
    path: "/v1/admin/approvals",
    capability: DECIDE_CAPABILITIES,
    handler: async (c) => {
      const status = new URL(c.req.url).searchParams.get("status") ?? "pending";
      if (!["pending", "confirmed", "cancelled"].includes(status)) {
        return problem(c, 422, "request.invalid");
      }
      const rows = await c.var.services.db
        .select({ a: staffApprovals, email: authUser.email })
        .from(staffApprovals)
        .innerJoin(authUser, eq(authUser.id, staffApprovals.initiatedBy))
        .where(eq(staffApprovals.status, status as "pending"))
        .orderBy(desc(staffApprovals.initiatedAt))
        .limit(100);
      // 只列出当前员工有能力确认的请求。
      const mine = rows.filter(({ a }) =>
        staffCan(c.var.staff.roles, confirmCapability(a.kind, a.payload)),
      );
      return c.json({ items: mine.map(({ a, email }) => approvalView(a, email)) });
    },
  });

  adminRoute(app, {
    method: "post",
    path: "/v1/admin/approvals/:id/confirm",
    capability: DECIDE_CAPABILITIES,
    noLegalRequest: true,
    body: DecideSchema,
    handler: async (c, { body }) => {
      const id = c.req.param("id") ?? "";
      if (!/^[0-9a-f-]{36}$/.test(id)) return problem(c, 404, "not_found");
      const now = c.var.services.clock.now();
      try {
        return await c.var.services.db.transaction(async (tx) => {
          const lock = await lockForConfirm(tx, id, c.var.staff, now);
          if (!lock.ok) return problem(c, lock.status, lock.code);
          const row = lock.row;
          const payload = row.payload as Record<string, unknown>;
          if (row.kind === "tombstone.large") {
            await runTombstone(tx, c, payload as unknown as TombstonePayload, row.initiatedBy);
          } else if (row.kind === "unban.csam") {
            await executeUnban(tx, c, String(payload.user_id), row.reason);
          } else {
            const done = await executeRoleChange(
              tx,
              c,
              String(payload.user_id),
              payload.roles as string[],
              row.reason,
            );
            if (!done.ok)
              throw new CharError({ code: done.code, subject: String(payload.user_id) });
          }
          await markDecided(tx, {
            row,
            status: "confirmed",
            staff: c.var.staff,
            now,
            reason: body.reason,
            selfConfirmedAfterCoolingOff: lock.selfConfirmedAfterCoolingOff,
            requestId: c.var.requestId,
          });
          return c.json({ ok: true, kind: row.kind });
        });
      } catch (e) {
        return charProblem(c, e);
      }
    },
  });

  adminRoute(app, {
    method: "post",
    path: "/v1/admin/approvals/:id/cancel",
    capability: DECIDE_CAPABILITIES,
    noLegalRequest: true,
    body: DecideSchema,
    handler: async (c, { body }) => {
      const id = c.req.param("id") ?? "";
      if (!/^[0-9a-f-]{36}$/.test(id)) return problem(c, 404, "not_found");
      const now = c.var.services.clock.now();
      return c.var.services.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(staffApprovals)
          .where(eq(staffApprovals.id, id))
          .for("update");
        if (!row) return problem(c, 404, "not_found");
        if (row.status !== "pending") return problem(c, 409, "approval.not_pending");
        const mayCancel =
          row.initiatedBy === c.var.staff.user_id ||
          staffCan(c.var.staff.roles, confirmCapability(row.kind, row.payload));
        if (!mayCancel) return problem(c, 403, "admin.forbidden");
        await markDecided(tx, {
          row,
          status: "cancelled",
          staff: c.var.staff,
          now,
          reason: body.reason,
          requestId: c.var.requestId,
        });
        return c.json({ ok: true });
      });
    },
  });
}
