/**
 * 任务面板：各队列的积压与失败情况、死信队列中的任务，以及重试与取消。
 *
 * 失败的任务在重试次数耗尽后进入对应的死信队列（`<队列名>.dead`）。重试死信中的任务会把它
 * 重新投递回原队列；取消只能针对还没有完成的任务。每次重试或取消都写审计。
 */
import type { Hono } from "hono";
import { z } from "zod";
import { appendAudit } from "../../audit/audit.js";
import { problem } from "../../http/middleware.js";
import { DEAD_LETTER_SUFFIX, QUEUE_NAMES } from "../../jobs/definitions.js";
import { type AdminContext, type AdminEnv, adminRoute } from "../app.js";
import { isUuid, staffActor } from "./common.js";

const BUSINESS_QUEUES: readonly string[] = Object.values(QUEUE_NAMES);
const ALL_QUEUES = new Set([
  ...BUSINESS_QUEUES,
  ...BUSINESS_QUEUES.map((q) => `${q}${DEAD_LETTER_SUFFIX}`),
]);

const Body = z.strictObject({
  /** 任务所在的队列；缺省时在各个死信队列中查找。 */
  queue: z.string().max(100).optional(),
  reason: z.string().trim().min(10).max(2000),
});

interface JobRef {
  queue: string;
  id: string;
}

/** 找到任务所在的队列：给了队列名时只查这个队列，否则依次查各个死信队列与业务队列。 */
async function locate(c: AdminContext, id: string, queue?: string): Promise<JobRef | null> {
  const boss = c.var.services.queue.boss;
  const candidates = queue
    ? [queue]
    : [...BUSINESS_QUEUES.map((q) => `${q}${DEAD_LETTER_SUFFIX}`), ...BUSINESS_QUEUES];
  for (const q of candidates) {
    if (!ALL_QUEUES.has(q)) continue;
    const job = await boss.getJobById(q, id);
    if (job) return { queue: q, id };
  }
  return null;
}

async function act(
  c: AdminContext,
  action: "retry" | "cancel",
  id: string,
  body: z.output<typeof Body>,
) {
  if (!isUuid(id)) return problem(c, 404, "not_found");
  if (body.queue && !ALL_QUEUES.has(body.queue)) return problem(c, 404, "not_found");
  const ref = await locate(c, id, body.queue);
  if (!ref) return problem(c, 404, "not_found");
  const boss = c.var.services.queue.boss;
  const job = await boss.getJobById<object>(ref.queue, id);
  if (!job) return problem(c, 404, "not_found");
  if (action === "retry") {
    if (ref.queue.endsWith(DEAD_LETTER_SUFFIX)) {
      // 死信中的任务：按原数据重新投递回业务队列，然后把死信标为完成。
      const origin = ref.queue.slice(0, -DEAD_LETTER_SUFFIX.length);
      await boss.send(origin, job.data as object);
      await boss.complete(ref.queue, id);
    } else if (job.state === "failed") {
      await boss.retry(ref.queue, id);
    } else {
      return problem(c, 409, "job.not_failed");
    }
  } else {
    if (job.state === "completed" || job.state === "cancelled") {
      return problem(c, 409, "job.already_finished");
    }
    await boss.cancel(ref.queue, id);
  }
  await c.var.services.db.transaction((tx) =>
    appendAudit(tx, {
      at: c.var.services.clock.now(),
      actor: staffActor(c),
      action: `job.${action}`,
      subject: `job:${ref.queue}:${id}`,
      requestId: c.var.requestId,
      before: { state: job.state },
      after: { reason: body.reason },
    }),
  );
  return c.json({ ok: true, queue: ref.queue });
}

export function registerJobs(app: Hono<AdminEnv>): void {
  adminRoute(app, {
    method: "get",
    path: "/v1/admin/queues",
    capability: "jobs.manage",
    handler: async (c) => {
      const boss = c.var.services.queue.boss;
      const stats = await boss.getQueues([...ALL_QUEUES]);
      const byName = new Map(stats.map((s) => [s.name, s]));
      return c.json({
        items: BUSINESS_QUEUES.map((name) => {
          const s = byName.get(name);
          const dead = byName.get(`${name}${DEAD_LETTER_SUFFIX}`);
          return {
            name,
            queued: s?.readyCount ?? 0,
            active: s?.activeCount ?? 0,
            failed: s?.failedCount ?? 0,
            dead: (dead?.queuedCount ?? 0) + (dead?.activeCount ?? 0),
          };
        }),
      });
    },
  });

  adminRoute(app, {
    method: "get",
    path: "/v1/admin/jobs/failed",
    capability: "jobs.manage",
    handler: async (c) => {
      const boss = c.var.services.queue.boss;
      const out: {
        id: string;
        queue: string;
        error: string;
        attempts: number;
        failed_at: string;
      }[] = [];
      for (const name of BUSINESS_QUEUES) {
        const dead = await boss.findJobs(`${name}${DEAD_LETTER_SUFFIX}`, { queued: true });
        for (const j of dead) {
          const output = (j.output ?? {}) as { message?: string };
          out.push({
            id: j.id,
            queue: `${name}${DEAD_LETTER_SUFFIX}`,
            error: typeof output.message === "string" ? output.message.slice(0, 500) : "failed",
            attempts: j.retryCount,
            failed_at: (j.createdOn ?? new Date(0)).toISOString(),
          });
        }
      }
      out.sort((a, b) => (a.failed_at < b.failed_at ? 1 : -1));
      return c.json({ items: out.slice(0, 200) });
    },
  });

  for (const action of ["retry", "cancel"] as const) {
    adminRoute(app, {
      method: "post",
      path: `/v1/admin/jobs/:id/${action}`,
      capability: "jobs.manage",
      noLegalRequest: true,
      body: Body,
      handler: (c, { body }) => act(c, action, c.req.param("id") ?? "", body),
    });
    adminRoute(app, {
      method: "post",
      path: `/v1/admin/jobs/:queue/:id/${action}`,
      capability: "jobs.manage",
      noLegalRequest: true,
      body: Body,
      handler: (c, { body }) =>
        act(c, action, c.req.param("id") ?? "", { ...body, queue: c.req.param("queue") ?? "" }),
    });
  }
}
