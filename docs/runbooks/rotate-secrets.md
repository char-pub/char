# Runbook：密钥轮换

适用于定期轮换和怀疑泄露两种情况。怀疑泄露时跳过“提前通知”，直接执行，并在完成后按[数据泄露](data-breach.md)预案评估影响。

所有密钥都只存放在 Railway variables 和 Cloudflare secrets 中，仓库里只有 `.env.example`。每次轮换都在 admin 审计日志里记录一条（操作人、密钥名称、原因），**不要记录密钥值**。

## 总览

| 密钥 | 频率 | 影响 | 能否无缝轮换 |
|---|---|---|---|
| `ORIGIN_AUTH_SECRET` | 90 天 | 源站拒绝未带正确 header 的请求 | 能：新旧两个值同时有效 |
| R2 凭证（api / worker / admin 三组） | 90 天 | 对象存储读写 | 能：先建新凭证再删旧的 |
| GitHub App 私钥 | 按需 | 读取仓库内容、对账 | 能：GitHub 允许同时存在多把私钥 |
| GitHub webhook secret | 按需 | webhook 验签 | 能：验签支持新旧值并存 |
| OAuth client secret（GitHub / Discord / Google） | 按 provider 要求 | 用户登录 | 大多数 provider 允许两个 secret 并存 |
| `BETTER_AUTH_SECRET` | 每年 | **所有会话失效**，用户需要重新登录 | 不能 |
| Turnstile secret | 按需 | 注册、访客验证 | 能：Cloudflare 支持轮换窗口 |
| SMTP 凭证（`SMTP_URL`） | 按服务商要求 | 访客验证邮件 | 能：先在服务商处建新凭证再删旧的 |
| `GUEST_HMAC_KEY` | 不轮换（只在泄露时更换） | 更换后已验证的访客无法再被同一邮箱找回，只能重新验证成为新访客 | 不能 |
| 数据库口令 | 按需 | 应用连接数据库 | 需要短暂重启 |

## 通用步骤

1. 生成新值：`openssl rand -base64 48`（不要用在线工具，不要贴进聊天记录）。
2. 先在本地用新值启动一次（写进 git 忽略的 `.env` 后运行 `pnpm dev`），确认格式正确、服务能启动。v0 只有一个线上主站，没有预发布环境可以先试。
3. 在 Railway `production` environment 的 service 上设置新值（`railway variables --set` 或控制台），先设置到“新值”变量，不删旧值。
4. 部署（Railway 会滚动重启）。
5. 运行冒烟测试：`pnpm smoke --env production`。
6. 确认新值生效后删除旧值，再部署一次。
7. 在审计日志登记。

## 各密钥的要点

### `ORIGIN_AUTH_SECRET`

服务同时接受 `ORIGIN_AUTH_SECRET` 与 `ORIGIN_AUTH_SECRET_PREVIOUS` 两个值。

1. 把当前值复制到 `ORIGIN_AUTH_SECRET_PREVIOUS`，把新值写入 `ORIGIN_AUTH_SECRET`，部署。
2. 在 Cloudflare 的 Transform Rule（回源请求头 `X-Origin-Auth`）中改为新值。
3. 用 `curl -H "X-Origin-Auth: <旧值>" https://<railway 域名>/v1/...` 确认旧值仍被接受；等 Cloudflare 规则生效后，确认经 Cloudflare 的请求正常。
4. 清空 `ORIGIN_AUTH_SECRET_PREVIOUS`，部署，确认旧值被拒绝（403 `origin.forbidden`）。

### R2 凭证

1. 在 Cloudflare R2 控制台为同一组桶新建一个 API token，权限与旧 token 相同（api：只签发 uploads 的 PUT 与 private 的 GET；worker：读写 public / private / uploads，另有一个只写 evidence 的 token；admin：删除与读元数据）。
2. 更新 Railway 变量，部署，冒烟测试（上传一张图片、读取一个 private 对象的签名 URL）。
3. 在 R2 控制台删除旧 token。

### GitHub App 私钥

1. 在 GitHub App 设置页生成新私钥（此时新旧两把同时有效）。
2. 更新 `GITHUB_APP_PRIVATE_KEY`，部署，触发一次对账任务确认能拿到 installation token。
3. 在 GitHub 删除旧私钥。

### `GUEST_HMAC_KEY`

它把访客邮箱映射成数据库里的 `email_hmac`，平时不轮换。泄露时更换：拿到这把密钥的人可以用候选邮箱逐个比对 `email_hmac`，但仍然拿不到明文邮箱列表。

1. 生成新值（`openssl rand -base64 32`），更新变量并部署。
2. 已有访客的会话不受影响；同一邮箱下次验证时会得到一个新的访客 ID。
3. 在审计日志登记，并按[数据泄露](data-breach.md)预案评估影响。

### `BETTER_AUTH_SECRET`

这会让所有会话失效。选择低峰时段，提前在站内公告。

1. 更新变量并部署。
2. 确认登录流程正常。
3. 个人 Token 不受影响（它们只以 sha256 哈希存储，不依赖这个密钥）。

## 怀疑泄露时的附加动作

- 立即轮换，不等待低峰期。
- 检查审计日志和访问日志中泄露时间窗口内的异常操作。
- 如果泄露的是数据库口令或 R2 凭证，按[数据泄露](data-breach.md)预案评估是否需要通知用户。
- 复盘：密钥是怎么泄露的（日志、截图、CI 输出、第三方服务），修复根因。
