/**
 * 法律请求（DMCA、法院命令、GDPR 等）的登记与查看，只有 legal 与 owner 可以访问。
 *
 * 申请人信息是个人数据，在应用层用 AES-256-GCM 加密后存储：数据库或备份泄露时，
 * 没有密钥也读不到申请人是谁。每条记录使用随机的 12 字节 nonce，密文带认证标签，
 * 被篡改时解密失败。密钥来自环境变量 `LEGAL_ENCRYPTION_KEY`（32 字节，base64）。
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import { appendAudit } from "../../audit/audit.js";
import { legalRequests } from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { type AdminEnv, adminRoute } from "../app.js";
import { isUuid, staffActor } from "./common.js";

export interface EncryptedValue {
  alg: "A256GCM";
  iv: string;
  ct: string;
  tag: string;
}

export function encryptJson(key: Uint8Array, value: unknown): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    alg: "A256GCM",
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptJson(key: Uint8Array, v: EncryptedValue): unknown {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(v.iv, "base64"));
  decipher.setAuthTag(Buffer.from(v.tag, "base64"));
  const pt = Buffer.concat([decipher.update(Buffer.from(v.ct, "base64")), decipher.final()]);
  return JSON.parse(pt.toString("utf8"));
}

/** 解析 base64 编码的 32 字节密钥。 */
export function parseLegalKey(b64: string): Uint8Array {
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("LEGAL_ENCRYPTION_KEY must decode to 32 bytes");
  return new Uint8Array(key);
}

/** 界面展示的状态：把内部的细分状态归并为四种。 */
function uiStatus(s: typeof legalRequests.$inferSelect.status) {
  if (s === "actioned") return "actioned";
  if (s === "counter_noticed") return "counter_notice";
  if (s === "closed" || s === "rejected") return "closed";
  return "open";
}

const CreateSchema = z.strictObject({
  kind: z.enum(["dmca", "court", "gdpr", "other"]),
  requester: z.strictObject({
    name: z.string().trim().min(1).max(300),
    email: z.email().optional(),
    organization: z.string().trim().max(300).optional(),
    address: z.string().trim().max(1000).optional(),
  }),
  received_at: z.iso.datetime({ offset: true }),
  deadline: z.iso.datetime({ offset: true }).optional(),
  /** 涉及的对象：URL、`@ns/name@label` 或内容 digest。 */
  subjects: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
  reason: z.string().trim().min(10).max(2000),
});

export function registerLegal(key: Uint8Array) {
  return (app: Hono<AdminEnv>): void => {
    adminRoute(app, {
      method: "get",
      path: "/v1/admin/legal-requests",
      capability: "legal.manage",
      handler: async (c) => {
        const rows = await c.var.services.db
          .select()
          .from(legalRequests)
          .orderBy(desc(legalRequests.receivedAt))
          .limit(100);
        // 列表不返回申请人信息，查看详情时才解密。
        return c.json({
          items: rows.map((r) => ({
            id: r.id,
            kind: r.kind,
            received_at: r.receivedAt.toISOString(),
            deadline: r.deadline?.toISOString() ?? null,
            status: uiStatus(r.status),
            subjects: r.subjects as string[],
          })),
        });
      },
    });

    adminRoute(app, {
      method: "get",
      path: "/v1/admin/legal-requests/:id",
      capability: "legal.manage",
      handler: async (c) => {
        const id = c.req.param("id");
        if (!isUuid(id)) return problem(c, 404, "not_found");
        const [r] = await c.var.services.db
          .select()
          .from(legalRequests)
          .where(eq(legalRequests.id, id));
        if (!r) return problem(c, 404, "not_found");
        // 每次查看申请人信息都留下审计记录。
        await c.var.services.db.transaction((tx) =>
          appendAudit(tx, {
            at: c.var.services.clock.now(),
            actor: staffActor(c),
            action: "legal.view",
            subject: `legal_request:${id}`,
            requestId: c.var.requestId,
          }),
        );
        return c.json({
          id: r.id,
          kind: r.kind,
          received_at: r.receivedAt.toISOString(),
          deadline: r.deadline?.toISOString() ?? null,
          status: uiStatus(r.status),
          subjects: r.subjects as string[],
          requester: decryptJson(key, r.requester as EncryptedValue),
          counter_notice: r.counterNotice
            ? decryptJson(key, r.counterNotice as EncryptedValue)
            : null,
        });
      },
    });

    adminRoute(app, {
      method: "post",
      path: "/v1/admin/legal-requests",
      capability: "legal.manage",
      noLegalRequest: true,
      body: CreateSchema,
      handler: async (c, { body }) => {
        const id = c.var.services.ids.uuid();
        const now = c.var.services.clock.now();
        await c.var.services.db.transaction(async (tx) => {
          await tx.insert(legalRequests).values({
            id,
            kind: body.kind,
            requester: encryptJson(key, body.requester),
            receivedAt: new Date(body.received_at),
            ...(body.deadline ? { deadline: new Date(body.deadline) } : {}),
            subjects: body.subjects,
            status: "received",
          });
          // 审计中不记录申请人信息。
          await appendAudit(tx, {
            at: now,
            actor: staffActor(c),
            action: "legal.register",
            subject: `legal_request:${id}`,
            requestId: c.var.requestId,
            after: { kind: body.kind, subjects: body.subjects, reason: body.reason },
          });
        });
        return c.json({ id }, 201);
      },
    });
  };
}
