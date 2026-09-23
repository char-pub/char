/**
 * `POST /v1/github/webhook`：接收 GitHub App 的事件投递。
 *
 * 这个接口没有用户身份，授权完全依靠 HMAC 签名：先按原始字节验签（绝不先解析 JSON），
 * 签名错误返回 401；不在订阅列表里的事件返回 200 并忽略，避免 GitHub 不断重试。
 * 验签通过后在一个事务里按 delivery ID 去重并应用事件；push 事件为每个跟踪该分支的
 * binding 入队一次同步任务（只检查，不发布）。
 */
import { isCharError } from "@char-pub/core";
import type { Hono } from "hono";
import { appendAudit } from "../../audit/audit.js";
import type { GitHubDeps } from "../../github/deps.js";
import { applyWebhookEvent } from "../../github/events.js";
import { problem } from "../../http/middleware.js";
import { QUEUE_NAMES } from "../../jobs/definitions.js";
import { MAX_WEBHOOK_BODY_BYTES, normalizeEvent, parseDelivery } from "../../webhook/github.js";
import { type Env, route } from "../app.js";

export const WEBHOOK_PATH = "/v1/github/webhook";
export const MAX_WEBHOOK_REQUEST_BYTES = MAX_WEBHOOK_BODY_BYTES;

export interface SyncJobData {
  binding_id: string;
  commit: string;
}

export function webhookModule(gh: GitHubDeps): (app: Hono<Env>) => void {
  return (app) => {
    route(app, {
      method: "post",
      path: WEBHOOK_PATH,
      authorize: async () => ({ public: true, loaded: null }),
      handler: async (c) => {
        const { db, queue, clock } = c.var.services;
        const raw = new Uint8Array(await c.req.arrayBuffer());
        const [current, ...previous] = gh.webhookSecrets;
        let delivery: Awaited<ReturnType<typeof parseDelivery>>;
        try {
          delivery = await parseDelivery(c.req.raw.headers, raw, {
            current: current ?? "",
            previous,
          });
        } catch (e) {
          if (!isCharError(e)) throw e;
          // 验签之前的任何失败都当作未认证：不向调用方透露更多信息。
          const status = e.code === "webhook.body_too_large" ? 413 : 401;
          return problem(c, status, e.code);
        }
        if (delivery.status === "ignored") return c.json({ ignored: true });

        let normalized: ReturnType<typeof normalizeEvent>;
        try {
          normalized = normalizeEvent(delivery.event, delivery.payload);
        } catch (e) {
          if (!isCharError(e)) throw e;
          // 签名正确但内容不符合预期：记下来并返回 2xx，重试也不会变好。
          return c.json({ ignored: true, reason: e.code });
        }
        const now = clock.now();
        const effects = await applyWebhookEvent(db, {
          delivery_id: delivery.delivery_id,
          event: delivery.event,
          normalized,
          now,
        });
        if (effects.duplicate) return c.json({ duplicate: true });

        if (effects.sync.length > 0 || effects.frozen.length > 0) {
          await db.transaction(async (tx) => {
            for (const s of effects.sync) {
              await queue.enqueue(
                tx,
                QUEUE_NAMES.githubSync,
                { binding_id: s.binding_id, commit: s.commit } satisfies SyncJobData,
                { singletonKey: `sync:${s.binding_id}:${s.commit}` },
              );
            }
            // 冻结的 binding 需要作者确认。v0 没有站内通知表，先写一条面向 namespace owner 的
            // 审计记录，作者在 binding 页面会看到冻结状态与原因。
            for (const f of effects.frozen) {
              await appendAudit(tx, {
                at: now,
                actor: { kind: "system", id: "github-webhook" },
                action: "binding.owner_notified",
                subject: `creation:${f.creation_id}`,
                requestId: delivery.delivery_id,
                after: { binding: f.binding_id, reason: "repository transferred" },
              });
            }
          });
        }
        return c.json({ ok: true, synced: effects.sync.length, frozen: effects.frozen.length });
      },
    });
  };
}
