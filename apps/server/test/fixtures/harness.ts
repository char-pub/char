/**
 * 在测试数据库和 MinIO 上组装一个完整的公开 API，用 `app.request()` 直接发请求。
 * principal 通过测试专用的请求头 `x-test-user` 注入，代替真实的登录会话。
 */
import { uuidv7 } from "uuidv7";
import type { Services } from "../../src/api/app.js";
import { register as registerRead } from "../../src/api/routes/read.js";
import { register as registerSearch } from "../../src/api/routes/search.js";
import { register as registerYank } from "../../src/api/routes/yank.js";
import { createApi } from "../../src/api/server.js";
import type { Principal } from "../../src/authz/authorize.js";
import { JobQueue } from "../../src/jobs/queue.js";
import { createTestDatabase, type TestDatabase, testCas, testStorageEnv } from "../helpers.js";

export const TEST_PUBLIC_BASE = () => `${testStorageEnv().PUBLIC_ASSETS_BASE_URL}/cas/sha256`;

export interface Harness {
  t: TestDatabase;
  queue: JobQueue;
  services: Services;
  request(path: string, init?: RequestInit & { user?: string }): Promise<Response>;
  close(): Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const t = await createTestDatabase();
  const queue = new JobQueue({ connectionString: t.appUrl, max: 3 });
  queue.boss.on("error", () => {});
  await queue.start();
  const services: Services = {
    db: t.app.db,
    cas: testCas(),
    queue,
    clock: { now: () => new Date() },
    ids: { uuid: () => uuidv7() },
    flags: async () => new Set(),
    publicAssetBaseUrl: TEST_PUBLIC_BASE(),
  };
  const app = createApi({
    services,
    originSecrets: [],
    allowedOrigins: ["https://www.char.pub"],
    sessionPrincipal: async (req): Promise<Principal | null> => {
      const id = req.headers.get("x-test-user");
      return id ? { kind: "user", user_id: id, banned: false } : null;
    },
    modules: [registerRead, registerSearch, registerYank],
  });
  return {
    t,
    queue,
    services,
    request: (path, init = {}) => {
      const headers = new Headers(init.headers);
      if (init.user) headers.set("x-test-user", init.user);
      if (init.body !== undefined && !headers.has("content-type"))
        headers.set("content-type", "application/json");
      return Promise.resolve(app.request(path, { ...init, headers }));
    },
    close: async () => {
      await queue.stop();
      await t.drop();
    },
  };
}
