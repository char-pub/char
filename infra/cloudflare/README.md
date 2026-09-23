# Cloudflare zone 规则（char.pub）

下面是 `char.pub` zone 上由本仓库管理的规则。这些 JSON 是实际下发到 Cloudflare 的规则内容，改动时先改这里，再用 `pnpm cf:rules`（dry run）核对，确认后加 `--apply` 写入。

| 文件 | 阶段 | 作用 |
|---|---|---|
| `waf-custom.json` | `http_request_firewall_custom` | 只允许 API 用到的 HTTP 方法，其余一律拦截 |
| `ratelimit.json` | `http_ratelimit` | 登录接口按 IP 限流（Free 套餐只能有一条规则、10 秒窗口） |
| `origin-auth.json` | `http_request_late_transform` | 回源时附加 `X-Origin-Auth`；值不在仓库中，从本机文件读取 |

应用内另有按账号、namespace、IP 哈希与访客计数的限流（存储在 Postgres），这里只挡最粗的滥用。
