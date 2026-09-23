/**
 * char.pub 在 Railway 上的资源定义。
 *
 * 同一个镜像（apps/server/Dockerfile，构建上下文是仓库根目录）按不同的启动命令跑成三个
 * service，另有一个 Postgres 18。staging 与 production 两个 environment 共用这份定义，区别只在
 * 域名与桶名。
 *
 * - api：公开 API；每次部署前先用 owner 角色执行数据库迁移，迁移失败则不部署。
 * - admin：只接受经过 Cloudflare Access 的请求。
 * - worker：任务消费者，没有公网域名；它的健康检查只监听本机端口，所以不配置 Railway 健康检查。
 *
 * 密钥一律是 `preserve()`：值只保存在 Railway 中，按 infra/DEPLOY.md 手工设置，不会写进仓库。
 * 每个进程只拿到它自己会读取的变量，例如 worker 没有登录与源站校验的密钥。
 * 应用的 `DATABASE_URL` 使用非 owner 的 `charpub_app` 角色，也属于手工设置的值；只有迁移用的
 * owner 连接串直接引用 Railway Postgres 提供的变量。
 *
 * 自定义域名（api、admin-api）不能在这里声明，Railway 要求在 service 创建后用
 * `railway domain <域名> --service <name> --port 8080` 添加，见 infra/DEPLOY.md。
 *
 * 用法：`railway link` 选择 project 与 environment 后，`railway config plan` 预览变更，
 * 确认后 `railway config apply`。创建或修改会产生费用、对外可见的资源前需要先征得同意。
 */
import { database, defineRailway, github, preserve, service } from "railway/iac";

const REPO = "char-pub/char";
/** 进程监听的端口；添加自定义域名时把流量转到这个端口。 */
export const PORT = 8080;

/** 各环境的公开域名：production 为 `<name>.char.pub`，staging 为 `staging-<name>.char.pub`。 */
export function publicHost(name: string, production: boolean): string {
  return production ? `${name}.char.pub` : `staging-${name}.char.pub`;
}

export default defineRailway((ctx, project) => {
  const prod = ctx.isEnvironment("production");
  const env = prod ? "production" : "staging";
  const host = (name: string) => publicHost(name, prod);
  const www = prod ? "https://www.char.pub" : "https://staging.char.pub";
  const adminSpa = prod ? "https://admin.char.pub" : "https://staging-admin.char.pub";
  const apiOrigin = `https://${host("api")}`;

  // Railway 官方的 postgres-ssl 镜像。主版本固定为 18，与本地环境和集成测试使用的版本一致。
  const db = database("postgres", "postgres", {
    image: "ghcr.io/railwayapp-templates/postgres-ssl:18",
    output: "DATABASE_URL",
    defaultMountPath: "/var/lib/postgresql/data",
  });

  /** 三个进程共同的配置：构建、运行环境、数据库。 */
  const common = {
    RAILWAY_DOCKERFILE_PATH: "apps/server/Dockerfile",
    NODE_ENV: "production",
    LOG_LEVEL: "info",
    PORT: String(PORT),
    DATABASE_URL: preserve(),
  };

  /** 有公网入口的进程（api、admin）只接受带源站校验头的请求。 */
  const edge = {
    ORIGIN_AUTH_SECRET: preserve(),
    ORIGIN_AUTH_SECRET_PREVIOUS: preserve(),
  };

  /** 对象存储：每个进程使用各自权限范围的 R2 凭证。 */
  const storage = {
    S3_ENDPOINT: preserve(),
    S3_REGION: "auto",
    S3_ACCESS_KEY_ID: preserve(),
    S3_SECRET_ACCESS_KEY: preserve(),
    S3_BUCKET_PUBLIC: `charpub-${env}-public`,
    S3_BUCKET_PRIVATE: `charpub-${env}-private`,
    S3_BUCKET_UPLOADS: `charpub-${env}-uploads`,
    S3_BUCKET_EVIDENCE: `charpub-${env}-evidence`,
    PUBLIC_ASSETS_BASE_URL: `https://${host("assets")}`,
  };

  /** 登录与访客验证只在 api；GitHub 集成在 api（webhook、OIDC 发布）与 worker（同步任务）。 */
  const auth = {
    BETTER_AUTH_SECRET: preserve(),
    BETTER_AUTH_URL: apiOrigin,
    AUTH_TRUSTED_ORIGINS: www,
    GITHUB_CLIENT_ID: preserve(),
    GITHUB_CLIENT_SECRET: preserve(),
    DISCORD_CLIENT_ID: preserve(),
    DISCORD_CLIENT_SECRET: preserve(),
    GOOGLE_CLIENT_ID: preserve(),
    GOOGLE_CLIENT_SECRET: preserve(),
  };
  // GitHub 集成与访客验证都是“要么全配、要么全不配”：只配一部分时进程拒绝启动。所以这两组里
  // 即使是可以写死的值（例如 OIDC audience 就是 API 地址）也留给人工，和同组的密钥一起设置。
  const githubApp = {
    GITHUB_APP_ID: preserve(),
    GITHUB_APP_PRIVATE_KEY: preserve(),
    GITHUB_WEBHOOK_SECRET: preserve(),
    GITHUB_WEBHOOK_SECRET_PREVIOUS: preserve(),
    OIDC_AUDIENCE: preserve(),
  };
  const guests = {
    TURNSTILE_SECRET_KEY: preserve(),
    SMTP_URL: preserve(),
    EMAIL_FROM: preserve(),
    GUEST_HMAC_KEY: preserve(),
  };
  /** 自动处置的系统执行者与 CDN 缓存清除，只有 worker 使用（也用于执行 bootstrap）。 */
  const worker = {
    SYSTEM_ACTOR_ID: preserve(),
    CF_ZONE_ID: preserve(),
    CF_PURGE_TOKEN: preserve(),
  };

  const source = github(REPO, { branch: "main" });

  const api = service("api", {
    source,
    start: "node dist/main.js api",
    preDeploy: "node dist/main.js migrate",
    healthcheck: "/healthz",
    env: {
      ...common,
      ...edge,
      ...storage,
      ...auth,
      ...githubApp,
      ...guests,
      // 部署前的迁移以 owner 身份执行，结束时把最小权限授予应用角色。
      DATABASE_MIGRATION_URL: db.env.DATABASE_URL,
      DATABASE_APP_ROLE: "charpub_app",
    },
  });

  const admin = service("admin", {
    source,
    start: "node dist/main.js admin",
    healthcheck: "/healthz",
    env: {
      ...common,
      ...edge,
      ...storage,
      CF_ACCESS_TEAM_DOMAIN: preserve(),
      CF_ACCESS_AUD: preserve(),
      STAFF_EMAILS: preserve(),
      ADMIN_ORIGINS: adminSpa,
      LEGAL_ENCRYPTION_KEY: preserve(),
      // 可选：强制员工登出时一并吊销 Cloudflare Access 会话，两项同时设置或同时留空。
      CF_ACCESS_ACCOUNT_ID: preserve(),
      CF_ACCESS_API_TOKEN: preserve(),
    },
  });

  const jobs = service("worker", {
    source,
    start: "node dist/main.js worker",
    env: { ...common, ...storage, ...githubApp, ...worker },
  });

  return project("char-pub", { resources: [db, api, admin, jobs] });
});
