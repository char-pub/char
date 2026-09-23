# 主站部署与边缘防护核验（2026-09-23）

环境：Railway project `char-pub` 的 `production` environment（Hushed Chat workspace），Cloudflare zone `char.pub`。部署的提交：`f6ee736`（`pnpm ci:all` 在本地全量通过后推送，GitHub 上 ci / codeql / scorecard 通过）。

## 资源

| 资源 | 状态 |
|---|---|
| Railway：Postgres 18.6（`postgres-ssl:18`）、api、admin、worker | 按 `.railway/railway.ts` apply（4 项新建，无修改与删除），apply 后再次 plan 显示已同步 |
| 数据库 | `charpub_app` 应用角色（口令本机生成、经 stdin 传入）；api 部署前迁移完成 |
| R2 | `charpub-public` / `-private` / `-uploads` / `-evidence`；CORS 按 `infra/r2/`；uploads 1 天过期；`r2.dev` 关闭；`assets.char.pub` 绑定 public 桶 |
| 自定义域名 | `api.char.pub` → api，`admin-api.char.pub` → admin（端口 8080）；CNAME 与验证 TXT 经 Cloudflare API 创建，Railway 同步状态 ACTIVE |
| web | Workers Static Assets `charpub-web`，自定义域名 `www.char.pub`；构建时编入主站 Turnstile site key |
| Cloudflare 规则 | `pnpm cf:rules` 显示与仓库一致：方法白名单、`/v1/auth/*` 限流、源站校验头 |
| 引导 | `bootstrap --system-actor`：系统账号已创建 |

## 冒烟测试（`pnpm smoke`，目标 production）

| 检查 | 结果 |
|---|---|
| web 返回 SPA 并带安全响应头 | ok：200，CSP / HSTS / nosniff 齐全 |
| api 健康检查 | ok：200 |
| 匿名搜索 | ok：200，0 条 |
| 错误为 problem+json | ok：404 problem+json |
| admin-api 拒绝未经 Access 的请求 | FAIL：admin 进程缺少 Cloudflare Access 配置，尚未启动 |
| admin SPA 在 Access 之后 | FAIL：admin SPA 尚未部署（等待 Access 应用） |

## 边缘防护（M9-3）

| 检查 | 期望 | 结果 |
|---|---|---|
| 经 Cloudflare 访问 `https://api.char.pub/v1/search` | 200 | 200 |
| 经 Cloudflare 并自带伪造的 `X-Origin-Auth` | 伪造值被覆盖，照常 200 | 200 |
| 绕过 Cloudflare、带真实 Host 直连 Railway（`--connect-to`） | 403 `origin.forbidden` | 403 `origin.forbidden` |
| 直连 Railway 分配的默认域名 | 不可用 | 404（默认域名没有路由到 api） |
| `TRACE` / `PROPFIND` | 被拦截 | 405 / 403 |
| `assets.char.pub` 匿名读取公开对象 | 200 | 200 |
| `assets.char.pub` 的 CORS | 只对 `https://www.char.pub` 返回允许头 | `www` 返回允许头；其他来源不返回 |
| 登录接口限流 | 超出后 429 | 规则已启用（`charpub_auth_ratelimit enabled=true`）；在已删除的 staging 上并发 40 次请求出现 429。Free 套餐查不到防火墙事件，无法区分边缘与应用内限流 |
| admin-api 未经 Access 被拒 | Access 拦截 | 待 Access 应用建立后核验 |

结论：M9-3 中“直接访问源站被拒”与“限流规则生效”两项已核验；“admin-api 不经 Access 被拒”待 Access 配置后补验，届时勾选 M9-3。M9-2 需要 admin 与 admin SPA 上线、冒烟测试全部通过后勾选。
