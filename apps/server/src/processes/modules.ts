/**
 * 公开 API 挂载的路由模块，以及 worker 进程处理的任务队列。
 * 新增路由模块或任务处理函数时在这里登记。
 */
import type { Hono } from "hono";
import type { Env, Services } from "../api/app.js";
import { bindingsModule } from "../api/routes/github-bindings.js";
import { webhookModule } from "../api/routes/github-webhook.js";
import { oidcPublishModule } from "../api/routes/oidc-publish.js";
import { register as read } from "../api/routes/read.js";
import { register as search } from "../api/routes/search.js";
import { register as uploads } from "../api/routes/uploads.js";
import { REGISTRY_WRITE_MODULES } from "../api/routes/write.js";
import { register as yank } from "../api/routes/yank.js";
import { parseEnv, WorkerEnvSchema } from "../env.js";
import type { GitHubDeps } from "../github/deps.js";
import type { GitHubSource } from "../github/source.js";
import { QUEUE_NAMES } from "../jobs/definitions.js";
import { CloudflarePurger, LoggingPurger } from "../ops/cdn.js";
import { noopScanner } from "../upload/csam.js";
import { runGitHubReconcile, runGitHubSync, type SyncJob } from "../worker/github.js";
import { registerPublishWorker, requeuePendingPublishes } from "../worker/publish.js";
import { dispatchTombstoneJob, type TombstoneQueueJob } from "../worker/tombstone-dispatch.js";
import { registerUploadWorkers } from "../worker/upload.js";

export const API_MODULES: readonly ((app: Hono<Env>) => void)[] = [
  ...REGISTRY_WRITE_MODULES,
  read,
  search,
  yank,
  uploads,
];

/** GitHub 集成的路由模块：只有配置了 GitHub App 时才挂载。 */
export function githubApiModules(gh: GitHubDeps): ((app: Hono<Env>) => void)[] {
  return [webhookModule(gh), bindingsModule(gh), oidcPublishModule(gh)];
}

/** 注册 GitHub 同步与对账任务。对账每 6 小时一次。 */
export async function startGitHubWorkers(services: Services, source: GitHubSource): Promise<void> {
  const deps = { db: services.db, source, now: () => services.clock.now() };
  await services.queue.work<SyncJob>(QUEUE_NAMES.githubSync, async (job) => {
    await runGitHubSync(deps, job.data);
  });
  await services.queue.work(QUEUE_NAMES.githubReconcile, async () => {
    await runGitHubReconcile(deps);
  });
  await services.queue.boss.schedule(QUEUE_NAMES.githubReconcile, "23 */6 * * *");
}

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
  await registerPublishWorker(services.queue, {
    db: services.db,
    cas: services.cas,
    clock: services.clock,
    publishDisabled: async () => (await services.flags()).has("publish"),
    publicAssetBaseUrl: services.publicAssetBaseUrl,
  });
  // 发布开关关闭期间被推迟的任务，在开关恢复后重新入队；每 5 分钟检查一次。
  await services.queue.work(QUEUE_NAMES.publishRequeue, async () => {
    if ((await services.flags()).has("publish")) return;
    await requeuePendingPublishes(
      services.db,
      services.queue,
      new Date(now().getTime() - 5 * 60_000),
    );
  });
  await services.queue.boss.schedule(QUEUE_NAMES.publishRequeue, "*/5 * * * *");
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
