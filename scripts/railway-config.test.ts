/**
 * Railway 资源定义（`.railway/railway.ts`）的静态检查：在 staging 与 production 两种上下文中
 * 执行定义，确认每个进程拿到的变量与服务端实际读取的变量一致、必需的变量都在、密钥不以
 * 字面值写进仓库。这样改了服务端的环境变量而忘了改部署定义时，单元测试就会失败。
 */
import { createRailwayContext, project } from "railway/iac";
import { describe, expect, it } from "vitest";
import program, { PORT, publicHost } from "../.railway/railway.js";
import {
  AdminEnvSchema,
  AuthEnvSchema,
  EdgeEnvSchema,
  GitHubEnvSchema,
  GuestEnvSchema,
  MigrationEnvSchema,
  ServerEnvSchema,
  WorkerEnvSchema,
} from "../apps/server/src/env.js";

type Shape = Record<string, { safeParse(v: unknown): { success: boolean } }>;
const keys = (s: { shape: Shape }) => Object.keys(s.shape);
/** 没有默认值、也不是可选的变量。 */
const required = (s: { shape: Shape }) =>
  Object.entries(s.shape)
    .filter(([, v]) => !v.safeParse(undefined).success)
    .map(([k]) => k);

/** 每个进程在启动时解析的变量组；可选组（GitHub、访客验证）要么全配、要么全不配。 */
const PROCESSES = {
  api: {
    schemas: [ServerEnvSchema, EdgeEnvSchema, AuthEnvSchema, MigrationEnvSchema],
    optionalGroups: [GitHubEnvSchema, GuestEnvSchema],
  },
  admin: { schemas: [ServerEnvSchema, EdgeEnvSchema, AdminEnvSchema], optionalGroups: [] },
  worker: { schemas: [ServerEnvSchema, WorkerEnvSchema], optionalGroups: [GitHubEnvSchema] },
} as const;

/** Railway 本身读取的变量（构建用的 Dockerfile 路径）。 */
const PLATFORM = new Set(["RAILWAY_DOCKERFILE_PATH"]);
const SECRET = /SECRET|PASSWORD|TOKEN|PRIVATE_KEY|_KEY$|DATABASE_URL|SMTP_URL|STAFF_EMAILS/;

interface Variable {
  type: string;
  value?: string;
}
interface Resource {
  type: string;
  name: string;
  image?: string;
  deploy?: { startCommand?: string; preDeployCommand?: string[]; healthcheckPath?: string };
  networking?: { customDomains?: Record<string, { port?: number }> };
  variables?: Record<string, Variable>;
}

async function load(environment: string): Promise<Map<string, Resource>> {
  const def = (await program(createRailwayContext({ environment }), project)) as unknown as {
    resources: Resource[];
  };
  return new Map(def.resources.map((r) => [r.name, r]));
}

describe.each(["staging", "production"])("railway definition (%s)", (environment) => {
  it("declares Postgres 18 and the three processes of one image", async () => {
    const r = await load(environment);
    expect([...r.keys()].sort()).toEqual(["admin", "api", "postgres", "worker"]);
    expect(r.get("postgres")?.image).toMatch(/postgres-ssl:18$/);
    for (const name of ["api", "admin", "worker"] as const) {
      expect(r.get(name)?.deploy?.startCommand).toBe(`node dist/main.js ${name}`);
      expect(r.get(name)?.variables?.RAILWAY_DOCKERFILE_PATH?.value).toBe("apps/server/Dockerfile");
    }
    expect(r.get("api")?.deploy?.preDeployCommand).toEqual(["node dist/main.js migrate"]);
  });

  it("listens on the port the custom domains are added with, and declares no domain itself", async () => {
    const r = await load(environment);
    for (const name of ["api", "admin", "worker"] as const) {
      expect(r.get(name)?.variables?.PORT?.value).toBe(String(PORT));
      // Railway 不接受在定义里注册自定义域名，域名在 service 创建后用 CLI 添加。
      expect(r.get(name)?.networking?.customDomains ?? {}).toEqual({});
    }
    const prod = environment === "production";
    expect(publicHost("api", prod)).toBe(prod ? "api.char.pub" : "staging-api.char.pub");
  });

  it("gives every process exactly the variables it reads, and all required ones", async () => {
    const r = await load(environment);
    for (const [name, p] of Object.entries(PROCESSES)) {
      const vars = Object.keys(r.get(name)?.variables ?? {});
      const allowed = new Set([
        ...PLATFORM,
        ...p.schemas.flatMap(keys),
        ...p.optionalGroups.flatMap(keys),
      ]);
      expect(
        vars.filter((v) => !allowed.has(v)),
        `${name}: unknown variables`,
      ).toEqual([]);
      const needed = [...p.schemas.flatMap(required), "ORIGIN_AUTH_SECRET"].filter(
        (k) => name !== "worker" || k !== "ORIGIN_AUTH_SECRET",
      );
      expect(
        needed.filter((k) => !vars.includes(k)),
        `${name}: missing variables`,
      ).toEqual([]);
      for (const group of p.optionalGroups) {
        const present = keys(group).filter((k) => vars.includes(k));
        expect([0, keys(group).length], `${name}: partial group`).toContain(present.length);
        // 可选组在人工设置密钥之前必须整体为空：组里有一个字面值，进程就会因为“只配了一部分”
        // 而拒绝启动。
        const literal = present.filter((k) => r.get(name)?.variables?.[k]?.type === "literal");
        expect(literal, `${name}: literal value in an all-or-none group`).toEqual([]);
      }
    }
  });

  it("never writes a secret as a literal value", async () => {
    const r = await load(environment);
    for (const svc of r.values()) {
      for (const [k, v] of Object.entries(svc.variables ?? {})) {
        if (SECRET.test(k)) expect(v.type, `${svc.name}.${k}`).not.toBe("literal");
      }
    }
  });
});
