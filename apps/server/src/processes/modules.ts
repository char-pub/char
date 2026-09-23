/**
 * 公开 API 挂载的路由模块，以及 worker 进程处理的任务队列。
 * 新增路由模块或任务处理函数时在这里登记。
 */
import type { Hono } from "hono";
import type { Env, Services } from "../api/app.js";
import { register as read } from "../api/routes/read.js";
import { register as search } from "../api/routes/search.js";
import { register as uploads } from "../api/routes/uploads.js";
import { register as yank } from "../api/routes/yank.js";
import { parseEnv, WorkerEnvSchema } from "../env.js";
import { QUEUE_NAMES } from "../jobs/definitions.js";
import { CloudflarePurger, LoggingPurger } from "../ops/cdn.js";
import { noopScanner } from "../upload/csam.js";
import { dispatchTombstoneJob, type TombstoneQueueJob } from "../worker/tombstone-dispatch.js";
import { registerUploadWorkers } from "../worker/upload.js";

export const API_MODULES: readonly ((app: Hono<Env>) => void)[] = [read, search, yank, uploads];

/** 注册 worker 的任务处理函数。 */
export async function startWorkers(services: Services): Promise<void> {
  const env = parseEnv(WorkerEnvSchema);
  const now = () => services.clock.now();
  await registerUploadWorkers(services.queue, {
    db: services.db,
    cas: services.cas,
    queue: services.queue,
    scanner: noopScanner,
    now,
    newId: () => services.ids.uuid(),
    systemActorId: env.SYSTEM_ACTOR_ID,
  });
  const cdn =
    env.CF_ZONE_ID && env.CF_PURGE_TOKEN
      ? new CloudflarePurger(env.CF_ZONE_ID, env.CF_PURGE_TOKEN)
      : new LoggingPurger();
  await services.queue.work<TombstoneQueueJob>(QUEUE_NAMES.tombstoneCascade, (job) =>
    dispatchTombstoneJob(
      {
        db: services.db,
        cas: services.cas,
        cdn,
        now,
        queue: services.queue,
        systemActorId: env.SYSTEM_ACTOR_ID,
        publicAssetBaseUrl: services.publicAssetBaseUrl,
        newId: () => services.ids.uuid(),
      },
      job.data,
    ),
  );
}
