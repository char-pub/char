# char.pub 安全设计（v0）

> 状态：Draft，2026-09-22。前提：**所有代码仓库都是 public 的**。所以安全必须建立在一个假设上：攻击者掌握全部源码、路由和数据结构，只是拿不到密钥和凭证。
> 相关文档：[架构](architecture.md) · [Admin 控制](admin.md) · [测试策略](testing.md)。

---

## 1. 安全目标

| 编号 | 目标 | 对应决策 |
|---|---|---|
| G1 | 私有内容（Draft、Private Release、Import 原件）不会泄露，也不能被探测是否存在 | D-043、D-083 |
| G2 | 任何人都不能以他人身份发布或篡改 Release；已发布内容不可变，并且可以验证 | D-040、D-044、D-071、D-074 |
| G3 | 法律要求下架的内容能被真正删除，不留任何可分发的副本 | D-042、D-082 |
| G4 | 不存储、不分发 CSAM，并按法律要求报告 | D-011、D-084 |
| G5 | 用户隐私：EXIF / GPS 被剥离；个人数据最小化；支持 GDPR 删除 | D-084、D-042 |
| G6 | 平台不被滥用：垃圾内容、刷量、爬虫和资源耗尽都受到限制 | D-065、D-086 |
| G7 | Admin 权限不被滥用或盗用：最小权限、双重防护，所有操作可追溯 | 本文 §6、admin.md |
| G8 | 供应链安全：依赖、CI 和发布产物都可信 | 本文 §10 |

非目标：`narrator` 模式下的 visibility **不是**安全边界（D-053）。它只是给 Runtime 的提示，UI 上也不得宣称它提供隔离。

---

## 2. 资产与信任边界

| 资产 | 敏感度 | 存放位置 |
|---|---|---|
| OAuth / 会话 token、API Token、GitHub App 私钥、R2 凭证 | 极高 | 只在 Railway / Cloudflare secrets 中；数据库里只存哈希 |
| 法律请求材料（申请人身份、反通知） | 极高 | `legal_requests`：字段加密，只有 `legal` 角色可读 |
| CSAM 事件记录与隔离证据 | 极高 | 独立的隔离存储；只有 `legal` 角色能访问；按法律要求留存 |
| Private Draft / Release / Import 原件 | 高 | private 桶 + Postgres |
| 用户邮箱、IP（只存哈希）、登录记录 | 中 | Postgres |
| Public Release | 公开，但必须保证完整性 | public 桶 + CDN |

信任边界：

1. 浏览器 / CLI / Action → Cloudflare 边缘：完全不可信的输入。
2. Cloudflare → Railway 源站：必须验证请求确实经过 Cloudflare 转发（§5）。
3. `api` / `admin` → Postgres / R2：凭证按最小权限划分。
4. worker → GitHub / CSAM provider：出站调用，只访问白名单域名，并设置超时。
5. 解析器边界：CCv3 PNG、`char.yaml`、JSON、图片全部是不可信输入（§7）。

---

## 3. 威胁模型（STRIDE 摘要）

| # | 威胁 | 场景 | 缓解措施 | 验证 |
|---|---|---|---|---|
| T1 | 仿冒发布者（repojacking） | 原仓库改名或删除后，攻击者注册同名仓库，用 OIDC 发布 | binding 与 OIDC 校验只认 `repository_id` + `repository_owner_id`，名称只用于展示（D-071）；ref 必须在 `publish_refs` 允许列表中 | 集成测试：改名后同名仓库发布返回 403 |
| T2 | 伪造或滥用 OIDC token | 自签 JWT、错误的 audience、重放；fork 作者借 `pull_request_target` 以 base 仓库身份发布 | 按 §4.4 的校验清单：`iss`、JWKS 签名（只接受 RS256）、`aud` 固定为 `https://api.char.pub`、`exp` / `nbf` / `maxTokenAge`、`jti` 一次性、`event_name` 白名单（拒绝 `pull_request_target` / `pull_request` / `dynamic`）、请求中的 commit 必须等于 `sha` claim | 用本地 JWKS 签发各类非法 token 做表驱动测试 |
| T3 | 相信客户端提供的摘要 | Action 上报 `sourceDigest`，但实际上传的是另一份内容 | Registry 用 App token 在 `sha` 对应的 commit 上重新读取源文件并重算 digest，不一致时拒绝发布；写入 CAS 时也重算哈希。因此 v0 要求 OIDC 发布的仓库必须已安装 GitHub App 并完成绑定（D-117） | 集成测试：摘要不一致返回 422 |
| T4 | 越权访问（IDOR） | 猜 `rel_…` / `cr_…` / digest 读取私有内容，或修改他人的 Creation | 集中式授权层（§4.3）；不可访问的私有资源一律返回 `404`；private 桶只能通过签名 URL 访问；public 桶只存公开对象 | 为每个路由自动生成“他人资源”越权测试 |
| T5 | 探测内容是否存在 | 用 digest 访问 public CDN，判断某段私有文本是否存在 | public 桶只包含 Public Release 引用的对象（D-083）；API 对未授权请求不区分“不存在”和“无权限” | 安全测试 |
| T6 | CSRF / 跨站 | 恶意页面代替用户发请求 | 会话 cookie 设为 `SameSite=Lax`、`HttpOnly`、`Secure`、host-only；所有写请求校验 `Origin`，只接受白名单；CORS 白名单精确匹配，不用通配符 | 测试：非白名单 Origin 被拒 |
| T7 | staging 攻击 production | 两者同属一个 site，SameSite 挡不住 | cookie 使用 `__Host-` 前缀，不设置 Domain；两个环境的 Origin 白名单互不包含；密钥与 OAuth App 各自独立 | 配置测试 |
| T8 | XSS / 内容注入 | 用户写的 Markdown 或 HTML、SVG、恶意 display_name | 前端用 React 转义；Markdown 渲染时禁用原始 HTML，并用 DOMPurify 清洗；**不接受 SVG 上传**（v0 把 SVG 转为 PNG 或直接拒绝）；设置严格的 CSP（`script-src 'self'`，不允许 inline）；用户内容不在 `www` 同源下渲染任意 HTML | CSP 报告 + 单元测试 |
| T9 | 恶意文件 / 解析炸弹 | PNG 解压炸弹、超大 tEXt chunk、polyglot 文件、JSON 深层嵌套、YAML 别名炸弹 | 按 magic bytes 识别类型；sharp 设置 `limitInputPixels`；PNG chunk 设大小上限；JSON 设深度和大小上限；YAML 禁用 alias 并限制大小；解析在 worker 中进行，并设超时 | fuzz 测试 + 样本集 |
| T10 | SSRF | `provider: http` 类型的 Source 或 linked asset 让服务器访问内网 | v0 不启用 `http` Source 的服务端抓取；GitHub 读取只走固定的 API 域名；将来启用时要求 DNS 解析后的 IP 不属于私网，并禁止重定向到私网 | 设计审查 |
| T11 | 暴力破解 / 撞库 / 批量注册 / 账号接管 | 登录、magic link、注册、Token；攻击者用同邮箱的另一个 provider 接管账号 | 只用 OAuth 登录，不支持密码；关闭按邮箱的隐式账号关联（`disableImplicitLinking`），第二个登录方式只能由已登录用户显式关联；magic link 的 token 只存哈希且限流；Turnstile 保护注册和匿名写操作；Better Auth 的限流存到 Postgres；Cloudflare Rate Limiting 作为第二层 | 限流测试 |
| T12 | 滥用与刷量 | Agent 批量发布或提交 Contribution | 按账号、namespace、IP 哈希、guest 限流（D-065）；新账号有冷却期；Agent 提交打上 `agent: true` 标记；kill switch | 限流测试 |
| T13 | 资源耗尽（DoS） | 超大请求体、深度依赖图、巨型 Lorebook | 请求体上限；依赖闭包的深度、节点数、fragment 数都设上限（写入 core 配置）；Resolver 设超时；任务设并发上限；边缘有 WAF | 边界测试 |
| T14 | 密钥泄露 | 仓库是公开的，有人误提交 `.env` | gitleaks 作为 pre-commit hook 并在 CI 中运行，同时开启 GitHub push protection；只提交 `.env.example`；密钥泄露时按 runbook 立即轮换 | CI |
| T15 | 源站被绕过 | 直接访问 `*.up.railway.app`，绕过 WAF 和 Access，并伪造 `cf-connecting-ip` 绕过限流 | 源站校验（§5）；Railway 的公网域名只绑定自定义域名；只有通过源站校验的请求才信任 `cf-connecting-ip`；admin 进程只接受带有效 Access JWT 的请求 | 集成测试 |
| T16 | 审计被篡改 | 内部人员或被入侵的应用删除审计记录 | 应用数据库角色对 `audit_log` 没有 UPDATE / DELETE 权限；记录之间用哈希链；每天把链头哈希锚定到 R2 private 桶的 `ops/audit-anchors/` 前缀 | 测试：UPDATE 被拒 |
| T17 | 供应链攻击 | 恶意依赖、被篡改的 Action | lockfile + `pnpm install --frozen-lockfile`；Renovate 加延迟合并；第三方 Action 固定到 SHA；启用 CodeQL 和依赖审查；npm 发布附带 provenance | CI 配置 |
| T18 | Admin 账号被盗 | 员工的 GitHub 账号被钓鱼 | Access 要求 GitHub 身份 + `char-pub` 组织成员，组织强制 2FA（D-120）；admin 进程校验 Access JWT 和应用内角色；Access 会话 8 小时过期；所有操作写审计；有新登录时通知 | admin.md §2 |
| T19 | 许可 / 再分发违规 | 依赖了 NC 许可的内容却声明可商用，或再分发不允许再分发的文本 | 发布时强制检查许可（D-046）；`license_check = fail` 时不允许发布 | core 单元测试 |
| T20 | Prompt 注入 | Creation 文本里藏有针对 Runtime 或 Agent 的指令 | char.pub 本身不运行模型；IR 只是数据；在文档中提醒 Runtime 把 IR 当作不可信内容；Assembler 的输出不执行任何内容 | 文档 |

---

## 4. 身份认证与授权

### 4.1 认证方式

| 主体 | 方式 | 说明 |
|---|---|---|
| 创作者（Web） | Better Auth：GitHub / Discord / Google OAuth；Email Magic Link 可选 | 不提供密码登录；`user.id` 使用 UUIDv7（D-089） |
| CLI / Agent | 个人 Token `cp_pat_<随机 32 字节 base62>` | 数据库只存 sha256；有 scope 和过期时间；可随时吊销；最后使用时间只精确到小时，避免高频写入 |
| GitHub Action | GitHub OIDC → 换取短期发布 token | 只能发布它所绑定的 Creation；10 分钟有效；一次性 |
| 经验证的访客 | Turnstile + 邮箱验证 → `guest_id` | 只能在 `contribution_policy = anyone` 时提交 Contribution（D-065） |
| 员工 | Cloudflare Access（GitHub 身份 + `char-pub` 组织成员，组织强制 2FA）+ 应用内 GitHub OAuth + 角色 | v0 不做应用内 TOTP（D-120），见 admin.md |
| 服务之间 | Railway 私有网络 | worker 没有入站端口；Postgres 不暴露到公网 |

### 4.2 会话与 Cookie

- 会话存储在 Postgres（Better Auth），**不启用 cookieCache**，保证封禁和吊销立即生效（Better Auth 曾出现 cookieCache 导致的 2FA 绕过漏洞，已修复）。Better Auth 锁定在 ≥ 1.7.5，只启用必需的插件，并订阅它的安全公告。Cookie 名为 `__Host-charpub.session`，属性为 `Secure`、`HttpOnly`、`SameSite=Lax`、`Path=/`，不设置 Domain。
- 由于 cookie 是 host-only，它**只发往 `api.char.pub`**。前端 `www.char.pub` 请求时带上 `credentials: 'include'`，CORS 对 `https://www.char.pub` 精确放行。`www` 与 `api` 同属一个 site，所以 `SameSite=Lax` 的 cookie 在这种跨子域请求中会被发送。
- 所有写请求都必须带匹配白名单的 `Origin`（Better Auth 的 `trustedOrigins` 加上我们自己的中间件双重检查）。
- 会话 30 天过期，有活动时滚动续期；修改邮箱、绑定或解绑 provider、创建 Token 这类敏感操作要求最近 10 分钟内重新验证。
- 用户被封禁时，立即吊销该用户的所有会话和 Token（Better Auth 的 admin 插件支持）。

### 4.3 授权模型

所有授权判断都集中在一个纯函数 `authorize(principal, action, resource) → allow | deny(404|403)` 中，放在 `apps/server/src/authz/`，**路由中不允许写内联的权限判断**。CI 用一条 lint 规则检查：路由 handler 必须经过 `authz` 中间件。

资源级规则（节选）：

| 动作 | 允许 |
|---|---|
| 读 Public Release / IR / Asset | 任何人（包括匿名） |
| 读 Private Release、Draft、Import Report | namespace 的 owner 或 maintainer（org 以后再加 reader） |
| 编辑 Draft、创建 Revision、发布 | namespace 的 owner 或 maintainer；namespace 必须是 active 状态，账号未被封禁，对应的 kill switch 未关闭 |
| yank 自己的 Release | namespace 的 owner 或 maintainer |
| tombstone | **只有员工**（admin.md）。作者自己想删除时，走“请求删除”，由员工处理，或用 GDPR 流程 |
| 提交 Contribution | 按 `contribution_policy`：anyone（含经验证访客）、signed-in、invited 或 closed |
| 接受 / 拒绝 Contribution | 目标 namespace 的 owner 或 maintainer；`sensitive` 变更需要单独确认 |
| 通过 OIDC 发布 | 与 binding 匹配的 `repository_id` + `repository_owner_id` + 允许的 ref |

### 4.4 GitHub OIDC 发布校验清单

依据 `.llmdoc-tmp/research/auth-github.md` §2（2026-09-22 核实）：

1. 用 `jose` 的 `createRemoteJWKSet` 拉取 `https://token.actions.githubusercontent.com/.well-known/jwks`；`algorithms: ["RS256"]`。
2. `iss` 精确等于 `https://token.actions.githubusercontent.com`；v0 不支持 GHES 与企业自定义 issuer。
3. `aud` 精确等于 `https://api.char.pub`（staging 为 `https://staging-api.char.pub`），与 `char-pub/publish` Action 同步。
4. `clockTolerance` 60 秒，`maxTokenAge` 10 分钟。
5. `jti` 写入 `oidc_jti`，保留到过期之后；每个 token 只能换一次发布凭证。
6. `repository_id` 与 `repository_owner_id`（claim 是字符串，统一转成 bigint）同时匹配 Source Binding；**不解析 `sub`**。
7. `ref` 在 binding 的 `publish_refs` 中（默认 default branch 与 `refs/tags/*`）；作者可以额外要求 `ref_protected`、指定 `environment`，或要求 `job_workflow_ref` 匹配官方 reusable workflow。
8. `event_name` 只允许 `push`、`workflow_dispatch`、`release`。
9. 请求体里的 commit 必须等于 `sha` claim；Registry 用 App token 在该 commit 读取源文件并重算 digest（T3）。
10. `published_by.oidc` 保存 `repository_id`、`repository_owner_id`、`sha`、`ref`、`workflow_ref`、`job_workflow_ref`、`run_id`、`run_attempt`、`actor_id`、`event_name`、`jti`。

信任模型要说清楚：OIDC token 只能证明“绑定的仓库在允许的 ref 和事件上运行了某个 workflow”，**不能**证明运行的是 `char-pub/publish` 这个 Action。能写入该仓库默认分支的人，就能发布。

### 4.5 通用规则

- 私有资源无权访问时统一返回 `404`（防止枚举）；资源公开但操作无权限时返回 `403`。
- Token 的 scope：`creations:read`、`creations:write`、`releases:publish`、`contributions:write`。scope 与用户权限**取交集**。

---

## 5. 边缘与源站防护

- 所有自定义域名都开启 Cloudflare Proxied：包括 `www`、`api`、`assets`、`admin`、`admin-api` 以及 staging 对应的域名。
- **源站校验**：Cloudflare 用 Transform Rule 给回源请求加上一个 header `X-Origin-Auth: <随机 secret>`，Railway 服务**拒绝**不带正确 header 的请求（用常量时间比较）。secret 定期轮换，轮换时新旧两个值同时有效一段时间。Railway 分配的 `*.up.railway.app` 域名在上线后移除，或者同样校验这个 header。
- admin-api 的第二道校验：验证 `Cf-Access-Jwt-Assertion`，包括签名（Access 的 JWKS）、`aud` 和 `iss`，并确认邮箱在允许名单中。
- WAF：启用免费套餐的托管规则。自定义规则包括：限制请求方法；admin 和 admin-api 只允许特定国家或地区访问（可选）；对 `/v1/auth/*` 设置更严格的限流。
- Rate Limiting Rules：Free 套餐只有 1 条规则（按 IP、10 秒窗口），用在 `/v1/auth/*` 上。**主要限流在应用内实现**（存储在 Postgres），按账号、namespace、IP 哈希、guest 计数。
- WAF 托管规则：Free 套餐只有 Free Managed Ruleset，OWASP 规则集需要 Pro，v0 不依赖它。
- Turnstile：注册、magic link、匿名举报、访客验证这几处在服务端校验 token。
- 安全响应头：全站 HSTS（包括 preload）、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`Permissions-Policy`，以及 CSP（§3 T8）。`assets.char.pub` 额外设置 `Content-Disposition` / `Content-Type` 并加 `nosniff`，防止被当作 HTML 渲染。

---

## 6. 数据保护

- 传输：全程 TLS；Railway 私有网络走 WireGuard。
- 静态存储：R2 与 Railway volume 由平台加密；`legal_requests` 的敏感字段在应用层用 AES-GCM 加密，密钥放在 secrets 中。数据库备份使用 Railway 自带的备份功能（D-111），由平台负责加密。
- 最小化：IP 地址只存 HMAC 哈希（按月轮换 salt），用于限流和滥用分析；日志里不出现 email、token、cookie 或正文内容。
- GDPR 删除（D-042）：
  1. 删除账号 PII，用户转为 `deleted` 状态。
  2. 该用户的 Public Release 默认保留，因为其他作品的依赖要能继续解释；署名改为“已删除用户”。
  3. 如果用户要求删除作品本身，按 tombstone 流程处理。
  4. 私有内容直接删除。
- 数据导出：v0 提供“下载我的全部 Creation”（JSON + CAS 对象）。

---

## 7. 上传与内容安全

### 7.1 上传约束

| 项 | v0 限制 |
|---|---|
| 图片类型 | PNG、JPEG、WebP、GIF（静态帧）；按 magic bytes 识别，不信任扩展名和 `Content-Type` |
| SVG | 不接受；v0 示例中的 SVG 在构建时转为 PNG |
| 单文件大小 | 头像、封面 ≤ 8 MiB；CCv3 PNG ≤ 20 MiB；JSON ≤ 5 MiB |
| 像素 | `limitInputPixels` ≤ 40 MP；输出最长边 ≤ 2048 |
| presigned PUT | 10 分钟有效；限定 `Content-Length`、`Content-Type`，并校验 `x-amz-checksum-sha256` |
| 每用户配额 | 每天上传次数和总字节数上限（可配置），新账号更低 |

### 7.2 处理管线

1. worker 下载原件，重新计算 sha256 并与声明值比对，然后查 `blocked_digests`。
2. 类型检查、大小和像素限制。
3. sharp 重新编码：默认不保留任何元数据（EXIF、GPS、ICC 以外的所有块），然后输出 webp 和缩略图。**所有对外分发的图片都是重新编码后的版本，原件从不分发。**
4. CSAM 扫描：通过 `CsamScanner` 接口实现，可替换 provider（V-9，2026-09-22 核实，见 `.llmdoc-tmp/research/infra-compliance.md` §4）。
   - **公开前扫描**用一个能主动调用的哈希匹配服务。首选 Microsoft PhotoDNA Cloud Service：对合格机构免费，但需要第三方审核，只支持图片。Thorn Safer（约 $30,720/年）和 Hive（仅 Enterprise）超出预算。
   - **Cloudflare CSAM Scanning Tool 不能充当这一步**：它只扫描经过 CDN 缓存、已经公开的内容，没有主动提交的 API，也扫不到 private 桶。它免费，所以作为 `assets.char.pub` 的**第二道防线**开启，命中通知每天发邮件，要有人负责接收。
   - **PhotoDNA 审核通过之前（D-121，临时）**：`CsamScanner` 使用 `noop` 实现，只记录“未扫描”，图片在其他检查通过后直接 `ready`。靠 Cloudflare CSAM 工具被动检测、用户举报和员工处置兜底。PhotoDNA 接入后，对所有存量图片补扫一遍。
   - 命中：进入 `quarantined` 状态，原件转入**证据保全区**（§7.4）；用户被锁定；创建事件工单；由 `legal` 角色尽快向 NCMEC CyberTipline 报告；不通知上传者具体原因。
   - 接入真实 provider 之后，provider 暂时不可用时上传停在 `processing`，**不自动放行**。积压超过阈值时告警，由运营者决定是否暂时关闭上传（kill switch）。
5. **CCv3 PNG 导入时的内嵌图片也要完整走这条管线。**

### 7.4 证据保全与 tombstone 的关系

18 U.S.C. 2258A(h)（经 2024 年 REPORT Act 修订）要求：向 CyberTipline 报告后，把内容和“合理可获取”的上下文保全 **1 年**，存放在安全、限制员工访问、符合 NIST CSF 的位置。这与 D-082“删除全部可分发副本”并不冲突，但需要一条单独的路径：

- 独立的 `…-evidence` R2 桶：不绑定任何域名，不签发 URL；只有 worker 的专用凭证可写，只有 `legal` 角色可以通过 admin 读取，而且每次读取都写审计。
- 证据对象不登记在 `blob_refs` 中，GC 看不到它们；到期删除由单独的任务按留存期执行，并写审计。
- CSAM 引起的 tombstone：可分发副本照常删除（D-082），证据副本进入保全区。
- 合规基线是美国 + 欧盟（D-122）：DMCA、2258A、GDPR、EU DSA 的 notice-and-action 与处置理由说明。运营主体确定后复核。

### 7.3 内容政策执行（D-010、D-011）

- `rating` 与 `content_warnings` 由作者声明；effective rating 取依赖闭包中的最大值（canonical-model §9）。
- 默认隐藏 mature 和 explicit 内容：用户要在设置中主动开启，并确认已满 18 岁。v0 是自我声明；严格的年龄验证待法律评估（O-4 与各地法规）。
- 员工可以**强制调高**某个 Creation 的 rating（admin.md）。强制评级是 Registry 层的覆盖，不修改 Creation 本身，也不改变已发布 Release 的 digest。
- 硬边界（涉及未成年人的性内容、违法内容、侵权内容）不会因为 rating 字段而被放行，由举报、审核和 tombstone 处理。

---

## 8. 审计

- 每条审计记录包含：`at`、`actor`（user / staff / system / oidc，以及 id）、`action`、`subject`、`request_id`、`ip_hash`、`before`、`after`（只记录字段差异，不含正文）、`prev_hash`、`hash = sha256(prev_hash ‖ JCS(本条记录))`。
- 必须记录的事件：登录失败激增、Token 创建或吊销、发布、yank、tombstone、封禁、角色变更、Namespace 处置、强制评级、kill switch、法律请求的状态变化、审计导出。
- 写入方式：与业务变更**在同一事务内**写入。应用数据库角色对 `audit_log` 只有 `INSERT` / `SELECT` 权限。
- 每天由 worker 把链头哈希写入 R2 private 桶的 `ops/audit-anchors/<日期>`（只有几十个字节，成本可以忽略），同时提供一个校验工具，可以检查整条链是否完整。

---

## 9. 密钥管理

| 密钥 | 存放位置 | 轮换 |
|---|---|---|
| `BETTER_AUTH_SECRET` | Railway variables | 每年一次，或怀疑泄露时立即轮换（所有会话失效） |
| OAuth client secrets | Railway variables | 按 provider 要求 |
| GitHub App 私钥 / webhook secret | Railway variables | GitHub 支持同时存在多把私钥，可以无缝轮换 |
| R2 凭证 ×3 | Railway variables | 每 90 天 |
| `ORIGIN_AUTH_SECRET` | Railway variables + Cloudflare Transform Rule | 每 90 天，轮换期间新旧值同时有效 |
| Turnstile / CSAM provider | Railway variables | 按需 |

Wrangler 的 secrets 使用 `wrangler secret put` 设置，不写进 `wrangler.toml`。本地开发只用本地生成的假密钥。

---

## 10. 公开仓库与供应链

- GitHub 组织层面：强制所有成员开启 2FA；默认成员权限为 read；只有 owner 能把仓库改为 public 或 private；新仓库默认开启 secret scanning 和 push protection。
- `char-pub/char` 仓库：
  - 保护 `main` 分支：必须通过 PR 合并、CI 必须通过、禁止 force push（首次覆盖旧仓库那一次之后立即启用）；提交签名作为可选项。
  - `CODEOWNERS`：`apps/server/src/authz/**`、`**/security/**`、`.github/**`、`infra/**` 的改动必须由 owner 审阅。
  - Actions 的 `GITHUB_TOKEN` 默认只读；从 fork 发来的 PR 不能访问 secrets；避免使用 `pull_request_target`。
  - 第三方 Action 都固定到 commit SHA，由 Renovate 负责更新。
  - 启用 CodeQL、依赖审查（dependency-review）和 OpenSSF Scorecard。
  - `SECURITY.md`：提供漏洞私密报告渠道（GitHub Private Vulnerability Reporting），并写明 90 天披露政策。
- npm 发布：`@char-pub/*` 包通过 GitHub Actions 使用 trusted publishing（OIDC）发布，并附带 provenance，不使用长期有效的 npm token。
- 部署：Railway 从 GitHub 或 CLI 部署；生产部署需要人工确认（v0 阶段由运营者手动执行 `railway up` 或点击 promote）。

---

## 11. 事件响应

`docs/runbooks/` 中提供以下预案（在 M9 交付）：

1. 密钥泄露：轮换密钥 → 吊销相关会话和 Token → 检查审计日志 → 通知受影响用户。
2. CSAM 命中：隔离 → 锁定账号 → 按法定流程报告 → 留存证据 → 复盘。
3. 收到 DMCA 或法律请求：登记 → 评估 → tombstone → 通知作者 → 处理反通知。
4. 数据泄露：遏制 → 评估影响 → 按法规通知（GDPR 72 小时） → 复盘。
5. 服务被滥用或遭受 DoS：打开 kill switch → 调紧 WAF 和限流 → 清理滥用内容。
6. 数据库损坏：从 Railway Postgres 备份恢复（演练记录见 DOD）。
