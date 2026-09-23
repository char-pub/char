/**
 * Contribution 集成测试的公共工具：在写路径的测试环境上再挂载 Contribution 路由，
 * 并提供建作品、改草稿、发 Contribution 的快捷方法。
 *
 * 访客：访客验证流程还没有接入，这里用一个只存在于测试中的解析器读取 `x-test-guest` 头，
 * 把请求当作已验证的访客（访客记录预先写入 guests 表）。
 */
import { uuidv7 } from "uuidv7";
import type { Services } from "../src/api/app.js";
import { register as contributions } from "../src/api/routes/contributions.js";
import { REGISTRY_WRITE_MODULES } from "../src/api/routes/write.js";
import { createApi } from "../src/api/server.js";
import { generateToken, hashToken } from "../src/auth/tokens.js";
import type { Principal } from "../src/authz/authorize.js";
import { apiTokens, guests } from "../src/db/schema/index.js";
import { encodeId } from "../src/registry/ids.js";
import type { Cas } from "../src/storage/cas.js";
import { type ApiHarness, createHarness, ORIGIN, type Requester } from "./api-harness.js";
import type { TestDatabase } from "./helpers.js";

export interface ContributionHarness extends ApiHarness {
  capp: ReturnType<typeof createApi>;
  asUser(userId: string): Requester;
  asGuest(guestId: string): Requester;
  anonymous(): Requester;
  token(userId: string, opts?: { agent?: boolean; scopes?: string[] }): Promise<Requester>;
  createGuest(guestId: string, name: string): Promise<void>;
  /**
   * 新建一个作品并发出第一个 Revision。每个账号只能拥有一个个人 namespace，所以每次都新建
   * 一个 owner；返回 owner、作品路径与 Revision ID。
   */
  setupCreation(
    ns: string,
    name: string,
    working: Record<string, unknown>,
  ): Promise<{
    owner: string;
    path: string;
    revision: string;
  }>;
  /** 读取草稿并用 mutate 修改后保存。 */
  editDraft(
    owner: string,
    path: string,
    mutate: (w: Record<string, unknown>) => void,
  ): Promise<void>;
  draft(
    owner: string,
    path: string,
  ): Promise<{ version: number; working: Record<string, unknown> }>;
}

export async function createContributionHarness(
  t: TestDatabase,
  cas: Cas,
): Promise<ContributionHarness> {
  const base = await createHarness(t, cas);
  const services: Services = base.services;
  const sessionPrincipal = async (req: Request): Promise<Principal | null> => {
    const user = req.headers.get("x-test-user");
    if (user) return { kind: "user", user_id: user, banned: false };
    const guest = req.headers.get("x-test-guest");
    if (guest) return { kind: "guest", guest_id: guest, disabled: false };
    return null;
  };
  const capp = createApi({
    services,
    originSecrets: [],
    allowedOrigins: [ORIGIN],
    sessionPrincipal,
    modules: [...REGISTRY_WRITE_MODULES, contributions],
  });

  const requester = (auth: Record<string, string>): Requester => {
    const send = (
      method: string,
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) =>
      Promise.resolve(
        capp.request(path, {
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

  const asUser = (id: string) => requester({ "x-test-user": id });

  async function draft(owner: string, path: string) {
    const r = await asUser(owner).get(`${path}/draft`);
    return (await r.json()) as { version: number; working: Record<string, unknown> };
  }

  return {
    ...base,
    capp,
    asUser,
    asGuest: (g) => requester({ "x-test-guest": g }),
    anonymous: () => requester({}),
    async token(userId, opts = {}) {
      const token = generateToken();
      await t.app.db.insert(apiTokens).values({
        id: uuidv7(),
        userId,
        name: opts.agent ? "agent" : "cli",
        prefix: token.slice(0, 12),
        tokenHash: hashToken(token),
        scopes: opts.scopes ?? ["contributions:write", "creations:read", "creations:write"],
        agent: opts.agent ?? false,
      });
      return requester({ authorization: `Bearer ${token}` });
    },
    async createGuest(guestId, name) {
      await t.app.db
        .insert(guests)
        .values({ guestId, displayName: name, verifiedAt: new Date(), verificationKind: "test" });
    },
    async setupCreation(ns, name, working) {
      const owner = await base.createUser(`owner-${ns}`);
      const me = asUser(owner);
      const nsRes = await me.post("/v1/namespaces", { slug: ns });
      if (nsRes.status !== 201) throw new Error(`namespace failed: ${await nsRes.text()}`);
      const cr = await me.post(`/v1/namespaces/${ns}/creations`, {
        name,
        type: "character",
        display_name: "Alice",
      });
      if (cr.status !== 201) throw new Error(`creation failed: ${await cr.text()}`);
      const path = `/v1/creations/@${ns}/${name}`;
      const d = await draft(owner, path);
      const put = await me.put(`${path}/draft`, { working }, { "if-match": String(d.version) });
      if (put.status !== 200) throw new Error(`draft save failed: ${await put.text()}`);
      const rev = (await (await me.post(`${path}/revisions`, {})).json()) as { id: string };
      // 没有公开 Release 的作品对非成员不可见，贡献者也就无从提交。
      const pub = await me.post(
        `${path}/releases`,
        { revision: rev.id, label: "0.1.0", visibility: "public" },
        { "idempotency-key": `setup-${ns}-${name}-0001` },
      );
      if (pub.status !== 202) throw new Error(`publish failed: ${await pub.text()}`);
      await base.runPublishJobs();
      return { owner, path, revision: rev.id };
    },
    async editDraft(owner, path, mutate) {
      const d = await draft(owner, path);
      const working = structuredClone(d.working);
      mutate(working);
      const r = await asUser(owner).put(
        `${path}/draft`,
        { working },
        { "if-match": String(d.version) },
      );
      if (r.status !== 200) throw new Error(`draft edit failed: ${await r.text()}`);
    },
    draft,
  };
}

export function userTypeId(uuid: string): string {
  return encodeId("user", uuid);
}
