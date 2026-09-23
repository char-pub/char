/**
 * API 集成测试的工具：用真实的数据库、对象存储和队列组装一个 API 实例，直接用
 * `app.request()` 调用，不需要监听端口。
 *
 * 登录：测试用一个只存在于这里的 session 解析器，读取 `x-test-user` 头来模拟浏览器会话。
 * 生产代码中没有这个后门——它只通过 `createApi({ sessionPrincipal })` 在测试里注入。
 */
import type { Hono } from "hono";
import { uuidv7 } from "uuidv7";
import type { Env, Services } from "../src/api/app.js";
import { REGISTRY_WRITE_MODULES } from "../src/api/routes/write.js";
import { createApi } from "../src/api/server.js";
import type { Principal } from "../src/authz/authorize.js";
import { authUser, featureFlags } from "../src/db/schema/index.js";
import { JobQueue } from "../src/jobs/queue.js";
import type { Cas } from "../src/storage/cas.js";
import { handlePublish, type PublishDeps } from "../src/worker/publish.js";
import type { TestDatabase } from "./helpers.js";

export const ORIGIN = "https://www.char.pub";
export const TEST_PUBLIC_BASE = "https://assets.char.pub/cas/sha256";

export interface ApiHarness {
  app: ReturnType<typeof createApi>;
  services: Services;
  queue: JobQueue;
  clock: { now(): Date; advance(ms: number): void };
  publishDeps: PublishDeps;
  /** 以某个用户的浏览器会话发请求。 */
  as(userId: string | null): Requester;
  /** 以个人 Token 发请求。 */
  withToken(token: string): Requester;
  createUser(name: string): Promise<string>;
  setFlag(key: string, enabled: boolean): Promise<void>;
  /** 执行队列中所有待处理的 publish 任务（直接调用处理函数）。 */
  runPublishJobs(): Promise<string[]>;
  close(): Promise<void>;
}

export interface Requester {
  get(path: string, headers?: Record<string, string>): Promise<Response>;
  post(path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
  put(path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
  patch(path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
  delete(path: string, headers?: Record<string, string>): Promise<Response>;
}

/** `extraModules`：除写路径外还需要的路由模块（例如搜索），按需加入。 */
export async function createHarness(
  t: TestDatabase,
  cas: Cas,
  extraModules: readonly ((app: Hono<Env>) => void)[] = [],
): Promise<ApiHarness> {
  const queue = new JobQueue({ connectionString: t.appUrl, max: 4 });
  queue.boss.on("error", () => {});
  await queue.start();
  let now = new Date("2026-09-22T12:00:00.000Z");
  const clock = {
    now: () => new Date(now),
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
  const db = t.app.db;
  const disabled = async () => {
    const rows = await db.select().from(featureFlags);
    return new Set(rows.filter((r) => !r.enabled).map((r) => r.key)) as Awaited<
      ReturnType<Services["flags"]>
    >;
  };
  const services: Services = {
    db,
    cas,
    queue,
    clock,
    ids: { uuid: () => uuidv7() },
    flags: disabled,
    publicAssetBaseUrl: TEST_PUBLIC_BASE,
  };
  const sessionPrincipal = async (req: Request): Promise<Principal | null> => {
    const id = req.headers.get("x-test-user");
    return id ? { kind: "user", user_id: id, banned: false } : null;
  };
  const app = createApi({
    services,
    originSecrets: [],
    allowedOrigins: [ORIGIN],
    sessionPrincipal,
    modules: [...REGISTRY_WRITE_MODULES, ...extraModules],
  });

  const requester = (auth: Record<string, string>): Requester => {
    const send = (
      method: string,
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) =>
      Promise.resolve(
        app.request(path, {
          method,
          headers: {
            ...auth,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
            ...(method === "GET" ? {} : { origin: ORIGIN }),
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    return {
      get: (p, h) => send("GET", p, undefined, h),
      post: (p, b, h) => send("POST", p, b ?? {}, h),
      put: (p, b, h) => send("PUT", p, b ?? {}, h),
      patch: (p, b, h) => send("PATCH", p, b ?? {}, h),
      delete: (p, h) => send("DELETE", p, undefined, h),
    };
  };

  const publishDeps: PublishDeps = {
    db,
    cas,
    clock,
    publishDisabled: async () => (await disabled()).has("publish"),
    publicAssetBaseUrl: TEST_PUBLIC_BASE,
  };

  return {
    app,
    services,
    queue,
    clock,
    publishDeps,
    as: (userId) => requester(userId ? { "x-test-user": userId } : {}),
    withToken: (token) => requester({ authorization: `Bearer ${token}` }),
    async createUser(name) {
      const id = uuidv7();
      await db.insert(authUser).values({ id, email: `${name}@example.test`, name });
      return id;
    },
    async setFlag(key, enabled) {
      await db
        .insert(featureFlags)
        .values({ key, enabled })
        .onConflictDoUpdate({ target: featureFlags.key, set: { enabled } });
    },
    async runPublishJobs() {
      const outcomes: string[] = [];
      for (;;) {
        const jobs = await queue.boss.fetch<{ release_id: string }>("publish", { batchSize: 10 });
        if (!jobs || jobs.length === 0) break;
        for (const job of jobs) {
          outcomes.push(await handlePublish(publishDeps, job.data));
          await queue.boss.complete("publish", job.id);
        }
      }
      return outcomes;
    },
    async close() {
      await queue.stop();
    },
  };
}
