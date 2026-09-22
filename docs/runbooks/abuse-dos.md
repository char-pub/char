# Runbook：服务滥用、DoS 与 kill switch

## kill switch 一览

在 admin 的“运行开关”页面切换，每次切换都要填写理由并写审计。切换后 5 秒内在所有进程生效。

| 开关 | 关闭后的效果 |
|---|---|
| `signups` | 不能注册新用户与新 namespace |
| `uploads` | 不能签发上传 URL，不能导入 |
| `publish` | 所有发布（网页与 GitHub Action）返回 503；队列中的发布任务暂停 |
| `contributions` | 不能提交 Contribution |
| `github_sync` | 继续接收 webhook 并入队，但暂停处理 |
| `guest_access` | 访客验证与访客贡献关闭 |
| `read_only` | 全站只读（维护模式），所有写接口返回 503 |

## 批量垃圾内容

1. 确认来源：同一账号、同一 IP 哈希段、同一 namespace，还是 `agent: true` 的自动提交。
2. 针对性处置优先于全局开关：封禁账号（会立即吊销其全部会话和 Token）、隐藏 Creation、拒绝 Contribution。
3. 来源分散时，临时关闭对应功能（例如 `contributions` 或 `signups`）。
4. 调紧应用内限流（按账号、namespace、IP 哈希、访客）。

## DoS

1. 在 Cloudflare 查看流量：是打在 `api.char.pub` 还是静态资源上。
2. Cloudflare 侧：开启 Under Attack 模式或针对路径的 WAF 规则；`/v1/auth/*` 的限流规则可以临时调低阈值。
3. 源站侧：确认源站校验生效（绕过 Cloudflare 直连 Railway 域名应返回 403）。
4. 必要时打开 `read_only`，保证公开读取（Release、IR、资源）继续可用——它们大多由 CDN 缓存。
5. 事后恢复开关，并记录处置经过。

## 恢复

逐个恢复开关，每恢复一个观察 10 分钟的错误率与队列积压（admin 任务面板）。
