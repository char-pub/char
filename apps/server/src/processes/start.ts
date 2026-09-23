/**
 * 按进程类型组装依赖并启动。所有配置都来自环境变量，启动时一次性校验。
 *
 * - api：公开 API，挂载创作者与读取路由、Better Auth 登录、GitHub webhook。
 * - admin：只挂载 admin 路由，每个请求校验 Cloudflare Access JWT。
 * - worker：消费任务队列；HTTP 只在 127.0.0.1 上提供健康检查。
 */
import { createRemoteJWKSet } from "jose";
import { uuidv7 } from "uuidv7";
import { createAdmin } from "../admin/app.js";
import { adminModules } from "../admin/routes/index.js";
import { parseLegalKey } from "../admin/routes/legal.js";
import type { Services } from "../api/app.js";
import { createApi } from "../api/server.js";
import { createAuth, sessionPrincipalResolver } from "../auth/better-auth.js";
import { SmtpEmailSender } from "../auth/email.js";
import { GUEST_TURNSTILE_ACTION, GuestHasher, type GuestServices } from "../auth/guest.js";
import { CloudflareTurnstile } from "../auth/turnstile.js";
import { createDatabase } from "../db/client.js";
import {
  AdminEnvSchema,
  AuthEnvSchema,
  authProvidersFromEnv,
  EdgeEnvSchema,
  GitHubEnvSchema,
  GuestEnvSchema,
  githubConfigFromEnv,
  guestConfigFromEnv,
  originSecretsFromEnv,
  parseEnv,
  RuntimeEnvSchema,
  ServerEnvSchema,
} from "../env.js";
import type { GitHubDeps } from "../github/deps.js";
import { GitHubAppSource } from "../github/source.js";
import { JobQueue } from "../jobs/queue.js";
import { githubJwks } from "../oidc/github.js";
import { FlagCache } from "../ops/flags.js";
import { Cas, casConfigFromEnv } from "../storage/cas.js";
import { API_MODULES, githubApiModules, startGitHubWorkers, startWorkers } from "./modules.js";

export interface Started {
  fetch: (req: Request) => Response | Promise<Response>;
  /** 只监听这个地址（worker 进程只在本机提供健康检查）。 */
  hostname?: string;
  shutdown: () => Promise<void>;
}

function baseServices(kind: "api" | "admin" | "worker") {
  const env = parseEnv(ServerEnvSchema);
  const database = createDatabase(env.DATABASE_URL, { max: env.DATABASE_POOL_MAX });
  const queue = new JobQueue({
    connectionString: env.DATABASE_URL,
    supervise: kind === "worker",
    schedule: kind === "worker",
  });
  const flags = new FlagCache(database.db);
  const services: Services = {
    db: database.db,
    cas: new Cas(casConfigFromEnv(env)),
    queue,
    clock: { now: () => new Date() },
    ids: { uuid: () => uuidv7() },
    flags: () => flags.current(),
    publicAssetBaseUrl: `${env.PUBLIC_ASSETS_BASE_URL.replace(/\/+$/, "")}/cas/sha256`,
  };
  return { env, database, queue, services };
}

export async function startProcess(kind: "api" | "admin" | "worker"): Promise<Started> {
  const { database, queue, services } = baseServices(kind);
  await queue.start();
  const shutdown = async () => {
    await queue.stop();
    await database.close();
  };

  if (kind === "api") {
    const edge = parseEnv(EdgeEnvSchema);
    const authEnv = parseEnv(AuthEnvSchema);
    const auth = createAuth({
      db: database.db,
      secret: authEnv.BETTER_AUTH_SECRET,
      baseURL: authEnv.BETTER_AUTH_URL,
      trustedOrigins: authEnv.AUTH_TRUSTED_ORIGINS,
      providers: authProvidersFromEnv(authEnv),
      ipAddressHeaders: ["cf-connecting-ip"],
    });
    const gh = githubFromEnv();
    const guests = guestsFromEnv(authEnv.AUTH_TRUSTED_ORIGINS);
    const app = createApi({
      services: guests ? { ...services, guests } : services,
      originSecrets: originSecretsFromEnv(edge),
      allowedOrigins: authEnv.AUTH_TRUSTED_ORIGINS,
      sessionPrincipal: sessionPrincipalResolver(auth),
      authHandler: (req) => auth.handler(req),
      modules: gh ? [...API_MODULES, ...githubApiModules(gh)] : API_MODULES,
    });
    return { fetch: app.fetch, shutdown };
  }

  if (kind === "admin") {
    const edge = parseEnv(EdgeEnvSchema);
    const adminEnv = parseEnv(AdminEnvSchema);
    const team = adminEnv.CF_ACCESS_TEAM_DOMAIN.replace(/\/+$/, "");
    const app = createAdmin({
      services,
      access: {
        teamDomain: team,
        audience: adminEnv.CF_ACCESS_AUD,
        allowedEmails: new Set(adminEnv.STAFF_EMAILS),
        jwks: createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`)),
      },
      originSecrets: originSecretsFromEnv(edge),
      allowedOrigins: adminEnv.ADMIN_ORIGINS,
      modules: adminModules(parseLegalKey(adminEnv.LEGAL_ENCRYPTION_KEY)),
    });
    return { fetch: app.fetch, shutdown };
  }

  await startWorkers(services);
  const gh = githubFromEnv();
  if (gh) await startGitHubWorkers(services, gh.source);
  return {
    fetch: (req) =>
      new URL(req.url).pathname === "/healthz"
        ? Response.json({ ok: true })
        : new Response("not found", { status: 404 }),
    hostname: "127.0.0.1",
    shutdown,
  };
}

/**
 * 读取 GitHub 集成的配置。没有配置时（本地开发）返回 null：api 不挂载 GitHub 路由，
 * worker 不注册 GitHub 任务。
 */
function githubFromEnv(): GitHubDeps | null {
  const cfg = githubConfigFromEnv(parseEnv(GitHubEnvSchema));
  if (!cfg) {
    process.stdout.write("github integration is not configured; GitHub routes and jobs are off\n");
    return null;
  }
  return {
    source: new GitHubAppSource({ appId: cfg.appId, privateKey: cfg.privateKey }),
    webhookSecrets: cfg.webhookSecrets,
    oidcAudience: cfg.oidcAudience,
    jwks: githubJwks(),
  };
}

/**
 * 读取访客验证的配置。没有配置时返回 null，访客验证接口返回 503。Turnstile 的 hostname
 * 允许列表取前端 Origin 白名单中的域名：widget 只会出现在这些页面上。
 */
function guestsFromEnv(webOrigins: readonly string[]): GuestServices | null {
  const cfg = guestConfigFromEnv(parseEnv(GuestEnvSchema));
  const { NODE_ENV } = parseEnv(RuntimeEnvSchema);
  if (!cfg) {
    process.stdout.write("guest verification is not configured; guest routes return 503\n");
    return null;
  }
  return {
    turnstile: new CloudflareTurnstile({
      secret: cfg.turnstileSecret,
      allowedHostnames: webOrigins.map((o) => new URL(o).hostname),
      action: GUEST_TURNSTILE_ACTION,
      // 本地开发可以用 Cloudflare 的测试密钥；其他环境收到测试密钥的结果一律拒绝。
      allowTestingKeys: NODE_ENV === "development",
    }),
    email: new SmtpEmailSender(cfg.smtpUrl, cfg.emailFrom),
    hasher: new GuestHasher(cfg.hmacKey),
  };
}
