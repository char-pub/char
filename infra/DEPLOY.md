# 部署：主站（production）

本文件列出部署 char.pub 需要的外部资源与配置步骤。**创建或修改会产生费用或对外可见的资源、部署到主站，都需要先得到用户的明确同意**；这里只记录做法，不代表已经执行。

v0 只有一个线上主站，不设 staging。上线前的验证依靠 CI 全量回归（`pnpm ci:all`）、本地一键环境（`pnpm dev`）与全栈 E2E（`pnpm e2e:fullstack`）；Railway 在每次部署前自动执行数据库迁移，迁移失败则不部署。在主站上做演练时使用测试账号、测试仓库与合成数据，结束后清理。

所有密钥都只放在 Railway variables 与 Cloudflare secrets 中，本文件不包含任何密钥值。变量名见仓库根目录的 `.env.example`。

## 1. 域名规划

| 用途 | 域名 |
|---|---|
| Web SPA | `www.char.pub`（Workers Static Assets） |
| Admin SPA | `admin.char.pub`（Workers Static Assets + Access） |
| 公开 API | `api.char.pub` → Railway `api` |
| Admin API | `admin-api.char.pub` → Railway `admin`（Access） |
| 公共资源 | `assets.char.pub`（R2 public 桶自定义域名） |

所有域名都开启 Cloudflare 代理（橙色云），都是 `char.pub` 的一级子域，`*.char.pub` 的 Universal SSL 证书可以直接覆盖。SSL/TLS 模式为 Full (strict)。

## 2. Railway

资源定义在 `.railway/railway.ts`（Railway 的 Infrastructure as Code）：一个 Postgres 18，加上同一个镜像（`apps/server/Dockerfile`）的三个 service。`scripts/railway-config.test.ts` 检查每个进程拿到的变量与服务端实际读取的一致，且密钥都不以字面值出现。

- `api`：`node dist/main.js api`；每次部署前执行 `node dist/main.js migrate`（owner 角色），迁移失败则不部署。
- `admin`：`node dist/main.js admin`。
- `worker`：`node dist/main.js worker`，没有公网域名。
- 密钥都是 `preserve()`：定义里只有变量名，值由人工在 Railway 中设置。变量名与含义见 `.env.example`。

步骤（创建 project、apply 都会产生费用或对外可见的资源，需要用户同意）：

```sh
railway login                         # 已登录可跳过
railway init --name char-pub          # 在 Hushed Chat workspace 下创建 project（需用户同意）
railway link                          # 选择 char-pub / production
railway config plan                   # 预览：应当只有新建，不应出现删除
railway config apply                  # 创建 Postgres 与三个 service（需用户同意）
```

apply 创建的 service 没有 GitHub 部署触发器，合并到 main 不会自动部署。apply 之后对每个 service 执行一次：

```sh
railway service source connect --repo char-pub/char --branch main --service api
railway service source connect --repo char-pub/char --branch main --service admin
railway service source connect --repo char-pub/char --branch main --service worker
```

project 只有 `production` 一个 environment。

apply 之后、第一次部署之前：

- 应用角色：用 owner 连接执行一次 `CREATE ROLE charpub_app LOGIN PASSWORD '<生成的口令>'`，再把 api、admin、worker 的 `DATABASE_URL` 设为这个角色的连接串（迁移用的 `DATABASE_MIGRATION_URL` 已在定义中引用 Postgres 的 owner 连接串）。
- 逐个设置其余密钥。不要把值写进 shell 历史：用 `railway variable set <KEY> --stdin --service <name>` 从标准输入读取，或在控制台里填写。
- 自定义域名不能写在 Railway 定义里，service 创建后用 CLI 添加，命令会输出需要的 CNAME 与 TXT 记录：

  ```sh
  railway domain api.char.pub --service api --port 8080          # 需用户同意
  railway domain admin-api.char.pub --service admin --port 8080
  ```

- 移除 Railway 分配的 `*.up.railway.app` 域名，或者保证它同样要求 `X-Origin-Auth`（服务端已强制校验）。

首次部署后执行一次引导（在 worker 上执行，例如 `railway ssh --service worker -- 'cd /app && node dist/main.js bootstrap …'`）：

- `bootstrap --system-actor`：创建自动处置使用的系统账号（ID 取 `SYSTEM_ACTOR_ID`）；
- 第一个员工用 GitHub 登录一次 www 之后，`bootstrap --owner <邮箱>` 把这个账号提升为 owner（只在还没有 owner 时有效）。之后的员工由 owner 在 admin 中管理，同时把邮箱加入 `STAFF_EMAILS` 与 Cloudflare Access 策略；
- `bootstrap --system-namespace commons --member <邮箱>`：创建 `@commons` 并加入维护种子内容的成员。

开启 Postgres 备份，第一次部署时确认备份与 PITR 选项可用。

## 3. Cloudflare R2

四个桶：`charpub-public`、`charpub-private`、`charpub-uploads`、`charpub-evidence`。

- `public` 绑定自定义域名 `assets.char.pub`，关闭 `r2.dev`。
- `uploads` 设置生命周期规则：1 天后删除。
- `evidence` 不绑定任何域名。
- 三组 S3 凭证（R2 API token，按桶限定权限）：
  - api：uploads 的 PUT 签发、private 的 GET 签发；
  - worker：public / private / uploads 读写，另一个只写 evidence 的 token；
  - admin：删除与读取元数据。
- CORS（uploads 桶）：只允许 `https://www.char.pub` 的 `PUT`，允许 `Content-Type`、`Content-Length`、`x-amz-checksum-sha256` 头。
- CORS（public 桶）：只允许 `https://www.char.pub` 的 `GET`、`HEAD`，不带凭据。浏览器会直接从 `assets` 域名读取 Context IR（公开下载会重定向过去）。
- CORS（private 桶）：只允许 `https://www.char.pub` 的 `GET`。私有内容用 API 签发的短期 URL 读取，URL 指向 R2 的账号端点 `<account>.r2.cloudflarestorage.com`。拿到账号端点后，把 web 的 CSP（`apps/web/public/_headers` 的 `connect-src`）从 `*.r2.cloudflarestorage.com` 收窄到这个具体域名。

```sh
wrangler r2 bucket create charpub-public     # 需用户同意（会产生费用）
wrangler r2 bucket create charpub-private
wrangler r2 bucket create charpub-uploads
wrangler r2 bucket create charpub-evidence
```

CORS 与生命周期规则的 JSON 与命令见 `infra/r2/`。

## 4. Cloudflare 边缘配置

zone 的写操作经由 tool-bridge 的 Cloudflare API 工具执行（本机不保存 Cloudflare token），或者由用户在控制台操作。R2 的桶、对象与自定义域名用 wrangler。

### DNS

- `api` / `admin-api`：CNAME 到 Railway 提供的目标域名，代理开启；另加 Railway 要求的 `_railway-verify.<名字>` TXT 记录。
- `www` / `admin`：由 Workers 自定义域名自动创建（这些名字事先不能有 CNAME）。
- `assets`：由 R2 自定义域名自动创建。

### zone 规则（WAF、限流、源站校验）

这三类规则的内容在 `infra/cloudflare/`，用 `pnpm cf:rules` 对比线上状态，`pnpm cf:rules --apply` 写入（只改本仓库管理的规则）。源站校验的值从本机的 `~/.charpub-secrets/production-origin-auth-secret` 读取。下面是在控制台手工操作时的做法。

### Transform Rule：源站校验

Rules → Transform Rules → Modify Request Header：

- 规则名称：例如 `origin auth`。
- 条件：选“自定义筛选表达式”，点“编辑表达式”，填 `http.host in {"api.char.pub" "admin-api.char.pub"}`。
- 动作：选 Set static，header 名 `X-Origin-Auth`，值为 `ORIGIN_AUTH_SECRET`。Set 会覆盖客户端自带的同名头，所以不需要另加 Remove。

服务端只接受带正确值的请求，所以绕过 Cloudflare 直接访问 Railway 域名会得到 403。

### WAF 与限流

- 启用 Free Managed Ruleset。
- 自定义规则：只允许 `GET HEAD POST PUT PATCH DELETE OPTIONS`；admin 与 admin-api 可选按国家或地区限制。
- Rate Limiting Rule（Free 套餐一条）：`api.char.pub` 的 `/v1/auth/*`，按 IP，10 秒内超过 20 次则阻断 10 秒。
- 应用内限流另行生效（Postgres 存储）。

### Cloudflare Access（Zero Trust 免费版）

- 一个应用，覆盖 `admin.char.pub` 与 `admin-api.char.pub`。
- 身份提供者：GitHub。
- 策略：Include → GitHub Organization `char-pub`；会话 8 小时。
- 记下 Application Audience (AUD) Tag，写入 admin 进程的 `CF_ACCESS_AUD`；团队域名写入 `CF_ACCESS_TEAM_DOMAIN`。
- admin SPA 跨域调用 admin-api：在 Access 应用的 CORS 设置中允许预检请求直接通过（“Bypass options requests to origin”），由 admin 进程按 `ADMIN_ORIGINS` 应答预检；其他请求仍然必须带 Access 会话。
- 强制员工登出时吊销 Access 会话（可选）：创建一个只有 Access: Organizations, Identity Providers, and Groups 编辑权限的 API Token，把账户 ID 与 Token 写入 admin 进程的 `CF_ACCESS_ACCOUNT_ID`、`CF_ACCESS_API_TOKEN`。不配置时强制登出只吊销应用会话，界面会注明。
- `char-pub` 组织开启“要求成员启用双因素认证”（修改组织设置需要用户同意）。

### Turnstile 与访客验证邮件

- 创建 widget，域名 `www.char.pub`，模式 managed；site key 在构建 web 时传入（`VITE_TURNSTILE_SITE_KEY`），secret 写入 api 的 `TURNSTILE_SECRET_KEY`。前端渲染 widget 时 action 设为 `guest_verification`，服务端会核对 action 与页面域名（取 `AUTH_TRUSTED_ORIGINS` 中的域名）。
- 访客验证邮件通过 SMTP 发送，服务商部署时选择（需要能配置 SPF / DKIM 的发信服务，发信域名用 `char.pub`）。把连接串写入 `SMTP_URL`（`smtps://用户名:密码@主机:465`），发件人写入 `EMAIL_FROM`（例如 `char.pub <no-reply@char.pub>`）。
- `GUEST_HMAC_KEY` 用 `openssl rand -base64 32` 生成，之后不要轮换：同一邮箱找回同一个访客依赖它。
- 这四项要么全部配置，要么全部留空（访客验证关闭，接口返回 503）。开通访客贡献前，在 admin 中确认 `guest_access` 开关处于开启状态。

### CSAM Scanning Tool

- Caching → Configuration → CSAM Scanning Tool：对 `char.pub` zone 开启，填写经过验证的通知邮箱，必须有人每天查看（见 `docs/runbooks/csam-hit.md`）。

## 5. 前端（Workers Static Assets）

```sh
# web：API 地址默认就是 https://api.char.pub，只需要传入 Turnstile 的 site key。
VITE_TURNSTILE_SITE_KEY=<site key> pnpm --filter @char-pub/web build
cd apps/web && wrangler deploy                    # 需用户同意

# admin：按当前域名选择 admin-api，不需要构建变量。
pnpm --filter @char-pub/admin build
cd apps/admin && wrangler deploy                  # 需用户同意
```

`apps/web/wrangler.jsonc` 与 `apps/admin/wrangler.jsonc` 已配置 SPA fallback 与自定义域名（deploy 时自动绑定并创建 DNS 记录）；安全响应头由各自的 `public/_headers` 下发。admin 的两个域名都放在 Cloudflare Access 之后。

部署后检查浏览器控制台：Cloudflare 可能往 HTML 里插入 `static.cloudflareinsights.com` 的 beacon 脚本，它会被 CSP 拦下（CSP 不放行任何第三方脚本），只在控制台留下一条报错，不影响页面功能。在 Workers 设置的 Domains / Observability 或 Web Analytics 页面中找到并关闭自动注入；要启用分析，先单独决定并调整 CSP。

## 6. 第三方应用

- OAuth App：GitHub、Discord、Google 各一个。回调地址：`https://api.char.pub/v1/auth/callback/<provider>`；GitHub 的 Homepage 填 `https://www.char.pub`。
- GitHub App：权限只有 Metadata: Read、Contents: Read；订阅 `push`、`repository`、`installation_repositories`；webhook 地址 `https://api.char.pub/v1/github/webhook`。

这些都需要用户用自己的账号创建。

## 7. 冒烟测试与验收

部署后运行 `pnpm smoke --env production`，然后按 DOD 的端到端验收逐项走查。边缘防护核验：

```sh
curl -si https://<railway 域名>/v1/search?q=x               # 期望 403 origin.forbidden
curl -si https://admin-api.char.pub/v1/admin/flags          # 未经 Access，期望被 Access 拦截
```
