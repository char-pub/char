/**
 * admin 集成测试的公共环境：测试数据库、MinIO、任务队列、本地签发的 Cloudflare Access JWT，
 * 以及每种员工角色各一名员工。公开 API 也一并组装，用来验证处置在公开读取中的效果。
 */
import { randomBytes } from "node:crypto";
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { uuidv7 } from "uuidv7";
import { createAdmin } from "../../src/admin/app.js";
import type { StaffRole } from "../../src/admin/roles.js";
import { adminModules } from "../../src/admin/routes/index.js";
import type { Services } from "../../src/api/app.js";
import { register as registerRead } from "../../src/api/routes/read.js";
import { register as registerSearch } from "../../src/api/routes/search.js";
import { createApi } from "../../src/api/server.js";
import type { Principal } from "../../src/authz/authorize.js";
import { authUser } from "../../src/db/schema/index.js";
import { JobQueue } from "../../src/jobs/queue.js";
import { createTestDatabase, type TestDatabase, testCas } from "../helpers.js";
import { TEST_PUBLIC_BASE } from "./harness.js";

const TEAM = "https://char-pub.cloudflareaccess.com";
const AUD = "admin-aud";
export const ORIGIN = "https://admin.char.pub";

export const ROLES: readonly StaffRole[] = [
  "viewer",
  "moderator",
  "trust_safety",
  "legal",
  "admin",
  "owner",
];

export interface AdminHarness {
  t: TestDatabase;
  queue: JobQueue;
  services: Services;
  legalKey: Uint8Array;
  /** 每种角色的员工：邮箱与 user id。 */
  staff: Record<StaffRole, { email: string; id: string }>;
  /** 以某名员工的身份调用 admin API。 */
  call(
    email: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: Record<string, unknown> }>;
  /** 调用公开 API。 */
  publicRequest(path: string, user?: string): Promise<Response>;
  setNow(d: Date): void;
  now(): Date;
  addStaff(email: string, roles: StaffRole[]): Promise<string>;
  close(): Promise<void>;
}

export async function createAdminHarness(): Promise<AdminHarness> {
  const t = await createTestDatabase();
  const queue = new JobQueue({ connectionString: t.appUrl, max: 4 });
  queue.boss.on("error", () => {});
  await queue.start();
  let now = new Date("2026-09-22T12:00:00Z");
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "k", alg: "RS256" };
  const services: Services = {
    db: t.app.db,
    cas: testCas(),
    queue,
    clock: { now: () => now },
    ids: { uuid: () => uuidv7() },
    flags: async () => new Set(),
    publicAssetBaseUrl: TEST_PUBLIC_BASE(),
  };
  const staff = {} as Record<StaffRole, { email: string; id: string }>;
  const emails = new Set<string>();
  const addStaff = async (email: string, roles: StaffRole[]) => {
    const id = uuidv7();
    await t.app.db
      .insert(authUser)
      .values({ id, email, name: email.split("@")[0] ?? email, role: roles.join(",") });
    emails.add(email);
    return id;
  };
  for (const r of ROLES) {
    const email = `${r}@char.pub`;
    staff[r] = { email, id: await addStaff(email, [r]) };
  }
  const legalKey = new Uint8Array(randomBytes(32));
  const admin = createAdmin({
    services,
    access: {
      teamDomain: TEAM,
      audience: AUD,
      // 名单按引用传入，测试中新增的员工也能通过 Access 校验。
      allowedEmails: emails,
      jwks: createLocalJWKSet({ keys: [jwk] }),
      now: () => now,
    },
    originSecrets: [],
    allowedOrigins: [ORIGIN],
    modules: adminModules(legalKey),
  });
  const api = createApi({
    services,
    originSecrets: [],
    allowedOrigins: ["https://www.char.pub"],
    sessionPrincipal: async (req): Promise<Principal | null> => {
      const id = req.headers.get("x-test-user");
      return id ? { kind: "user", user_id: id, banned: false } : null;
    },
    modules: [registerRead, registerSearch],
  });
  const sign = (email: string) => {
    const iat = Math.floor(now.getTime() / 1000);
    return new SignJWT({ iss: TEAM, aud: AUD, sub: email, email, iat, exp: iat + 3600 })
      .setProtectedHeader({ alg: "RS256", kid: "k" })
      .sign(privateKey);
  };
  return {
    t,
    queue,
    services,
    legalKey,
    staff,
    async call(email, method, path, body) {
      const headers: Record<string, string> = {
        origin: ORIGIN,
        "cf-access-jwt-assertion": await sign(email),
      };
      if (body !== undefined) headers["content-type"] = "application/json";
      const res = await admin.request(path, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      return {
        status: res.status,
        json: (text ? JSON.parse(text) : {}) as Record<string, unknown>,
      };
    },
    publicRequest: (path, user) =>
      Promise.resolve(api.request(path, { headers: user ? { "x-test-user": user } : {} })),
    setNow: (d) => {
      now = d;
    },
    now: () => now,
    addStaff,
    async close() {
      await queue.stop();
      await t.drop();
    },
  };
}

/** 以 admin 应用为参数返回路由列表，供权限矩阵测试使用。 */
export function adminAppForInspection(legalKey: Uint8Array) {
  const services = {} as Services;
  return createAdmin({
    services,
    access: {
      teamDomain: TEAM,
      audience: AUD,
      allowedEmails: new Set(),
      jwks: createLocalJWKSet({ keys: [] }),
    },
    originSecrets: [],
    allowedOrigins: [],
    modules: adminModules(legalKey),
  });
}
