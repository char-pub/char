# DOR（Definition of Ready）：char.pub v0

> 更新：2026-09-22。本文件列出实现 v0 之前需要就绪的条件：已拍板的决策与依据、技术选型、外部前置条件和阻塞项。每个未解决的缺口都标出它阻塞的 DOD 条目。
> 调研原件（本地临时缓存，未入库）：`.llmdoc-tmp/research/{auth-github,infra-compliance,libraries}.md`，另有 ChatGPT 讨论记录 `chat-transcript.md`。

## Requirements and decisions

### 已拍板（可以依赖）

| 来源 | 内容 |
|---|---|
| `DECISIONS.md` D-001～D-101 | 产品、内容政策、对象模型、版本、Resolver / IR / Assembler、Contribution、GitHub、基础设施、v0 范围（v0.2，经四轮 Review） |
| D-110 | 仓库在 `char-pub/char`（覆盖旧原型，force push 前需再次确认）；除特别敏感的数据外一律 public；代码用 Apache-2.0，规范用 CC-BY-4.0 |
| D-111 | v0 只启用 Railway Postgres 自带的备份，不做 `pg_dump` 到 R2 |
| D-112 | Web 与 Admin 都用 Vite + React SPA |
| D-113 | Admin 放在独立子域，三层防护（2FA 部分已被 D-120 取代） |
| D-114 | 预留环境使用 `char.pub` 的一级子域（v0 已改为只有一个主站，不设 staging） |
| D-115 | O-1 用 JCS + NFC + 行尾归一；O-2 的 name 只允许 ASCII slug，另设 `display_name` |
| D-116 | 先完成 DoR，再写代码 |
| D-117 | OIDC 发布必须先安装 GitHub App；Registry 自己回源并重算 digest |
| D-118 | 仓库 transfer 后 binding 冻结，等作者确认：重新绑定或换用新仓库 |
| D-119～D-124 | Workers Static Assets；Admin MFA 交给 Access；PhotoDNA 前图片直接放行（临时）；合规基线为美国 + 欧盟；CCv3 自己实现；Railway 用 Hushed Chat workspace（Pro） |
| 用户原则 | 优先用成熟方案，基本确认可用即可，实现中再微调；合规与安全类事实必须核实 |

聊天记录中讨论过、但已**明确不在 v0 范围**的内容：Runtime Registry、`Open in`、Launch Intent（D-058）；char.pub 作为 OIDC Provider（D-089）；可执行扩展（Stage / Trigger 类插件，属于不同的信任域）；Supabase 方案（已被 Railway + Better Auth 取代，D-085 / D-089）；Cloudflare D1（D-080）。

### 调研后需要修正或补充的规范事实（写代码前同步进 DECISIONS / spec）

| # | 事实（2026-09-22 核实） | 影响 | 处理 |
|---|---|---|---|
| F-1 | GitHub OIDC token **包含** `sha` claim；ID 类 claim 是字符串 | D-074、canonical-model `GitHubOIDCClaims` | 已写入 D-117 和 security §4.4；M7 开始前更新 spec 中的类型：ID 用 bigint，字段按 security §4.4 第 10 条 |
| F-2 | GitHub AUP 明确禁止文字形式的色情内容 | D-012 / V-1 | V-1 关闭：成人内容只能走 Native / R2；GitHub Source 声明 `explicit` 时，`char check` 给出提示 |
| F-3 | Better Auth 的 2FA 默认不拦截 social / magic link / passkey 登录；admin 插件没有强制 2FA，也没有审计 | D-089、D-113 | v0 的 MFA 交给 Cloudflare Access + 组织 2FA（D-120）；审计由我们写入（admin §6） |
| F-4 | Cloudflare CSAM 工具只扫描已公开并经过缓存的内容 | D-084 / V-9 | 公开前扫描改用可主动调用的服务（PhotoDNA 优先），Cloudflare 工具作为第二道防线（security §7.2） |
| F-5 | 2258A(h) 要求报告 NCMEC 后把证据保全 1 年 | D-082 | 新增 `evidence` 桶，与 GC 隔离（security §7.4） |
| F-6 | CCv3 lorebook entry 的 `id` 没有持久性保证，SillyTavern 缺 id 时用数组下标填充 | canonical-model §15 | 导入时一律 `stable: false`，源 id 只记在 provenance（规范原文已允许这种做法，不必修改） |
| F-7 | CCv3 规范要求 PNG 导出**必须**写 `ccv3` chunk | IR §14 | 导出时写 `ccv3`，为兼容性同时写 `chara`（v2） |

### 用户已回答（2026-09-22）

| # | 问题 | 回答 → 决策 |
|---|---|---|
| Q-1 | Railway 套餐 | 用 `Hushed Chat` workspace，Pro 套餐 → D-124（第一次部署时确认备份和 PITR 可用） |
| Q-2 | PhotoDNA 审核通过前的图片 | 直接放行，不等扫描 → D-121（临时）：Cloudflare 被动扫描 + 举报 + 隔离 / 保全 / 报告流程兜底，接入 PhotoDNA 后补扫存量 |
| Q-3 | 法域 | 先按欧美 → D-122：合规基线为美国 + 欧盟，运营主体以后再定 |
| Q-4 | 前端部署 | Workers Static Assets → D-119 |
| Q-5 | CCv3 解析 | 自己实现，不依赖 Character Foundry → D-123（按用户“可以手动实现，但先不依赖它”理解） |
| Q-6 | 2FA | v0 由 Cloudflare Access 负责 → D-120：Access 要求 GitHub + `char-pub` 组织成员，组织强制 2FA；应用内不做 TOTP |

### 可逆的实现假设（不需要用户决定，出问题时直接调整）

- Magic Link 在 v0 不开放注册，只作为已有账号的登录方式（`disableSignUp`）；访客验证单独用 Turnstile + 邮箱。
- 外部身份直接使用 Better Auth 的 `account` 表，外面再包一层视图 `external_identities`，这样以后换掉 Better Auth 时不影响 user.id。
- 员工和创作者都用 GitHub OAuth App 登录，与 Source 用的 GitHub App 分开。
- 访客贡献（D-065 anyone）在 v0 保留模型，默认的 contribution_policy 是 signed-in。

## Technical readiness

### 现有状态

- 工作区 `/Users/djj/.superset/projects/char_pub`（origin `/Users/djj/code/char_pub`，还没有任何 commit）。目前只有 `DECISIONS.md`、`spec/`、`docs/`、`.gitignore`。
- 远端 `char-pub/char` 上是旧原型（4 个 commit，npm workspaces，自己定义的 `char.yaml`）。用户要求忽略它、从头实现，代码不复用。
- 本地工具：Node 26.9、pnpm 12.5、Docker 29.8、psql 16、git 2.55、gh 2.101、railway 5.59、wrangler 4.136、机器是 arm64。

### 技术选型（成熟优先，基本确认即可）

| 领域 | 选型 | 理由 / 备注 |
|---|---|---|
| 运行时 | Node 24 LTS（`engines` 下限 22.12） | pg-boss、canonicalize、Testcontainers 都要求 ≥ 22 |
| 语言 | TypeScript 5.9 / 6.x 的最后一个稳定版 | TS 7（原生实现）等生态兼容后再升级 |
| 包管理 | pnpm workspace + catalog | 支持 `minimumReleaseAge` 等供应链防护 |
| Schema | zod 4（`z.toJSONSchema` 导出 JSON Schema） | 与 Hono、Drizzle、Better Auth 都兼容 |
| 规范化 | `canonicalize`（RFC 8785 作者的实现）+ `normalize('NFC')` | 三端都能跑；大整数在 schema 层禁止 |
| 哈希 | `@noble/hashes`（同步 sha256） | 三端一致，不用把管线改成 async |
| ID | `uuidv7` | canonical-model §2.2 |
| HTTP | Hono 4 + `@hono/node-server` + `@hono/zod-openapi` | 与 Edge Worker 共用写法，OpenAPI 直接从 zod 生成 |
| ORM / 迁移 | Drizzle ORM 0.45 + drizzle-kit | SQL 迁移可以 review；v1 正式版发布后再迁移 |
| 队列 | pg-boss 12（`db: fromDrizzle(tx, sql)`，事务内入队） | 不需要单独的 outbox；锁定 minor 版本 |
| Auth | Better Auth ≥ 1.7.5（admin、magic link 插件；v0 不启用 2FA / passkey，D-120） | 不开 cookieCache；限流存到数据库；订阅安全公告 |
| JWT / OIDC | `jose` 6 | GitHub OIDC 与 Cloudflare Access JWT 的校验 |
| GitHub | `@octokit/app` + `@octokit/webhooks` | 官方包，ESM-only |
| 对象存储 | `@aws-sdk/client-s3` + `s3-request-presigner`（R2 的 S3 endpoint） | 本地用 MinIO |
| 图片 | sharp 0.35（`autoOrient` → 默认剥离元数据 → webp；显式设置 `limitInputPixels`） | 有 linux x64 / arm64 预编译包 |
| CCv3 | 全部自写（D-123）：容器解析用 `png-chunks-extract` / `png-chunk-text` 一类的小库和 `fflate`；映射、导出、Loss Report 自己实现 | 依据 kwaroran `SPEC_V3.md` |
| Token 估算 | `tokenx`（默认）+ 按需加载的 `gpt-tokenizer` | D-057 |
| 前端 | Vite + React 19 + TanStack Router / Query + Tailwind 4 + shadcn/ui（Radix） | 部署在 Workers Static Assets（D-119） |
| Markdown | `react-markdown`（禁用原始 HTML）+ DOMPurify | security T8 |
| 日志 | pino | 结构化日志 |
| 测试 | Vitest 4.1（projects 模式）+ fast-check + Testcontainers + Playwright + `@cloudflare/vitest-plugin` | Cloudflare 的测试插件还不支持 Vitest 5 |
| Lint / 格式 | Biome + dependency-cruiser | 一个工具同时做 lint 和格式化；依赖边界单独检查 |
| 供应链 | secret scanning + push protection + CodeQL + Dependabot alerts + Renovate + gitleaks CLI + Scorecard | 公开仓库免费 |
| 数据库 | Railway 官方 `postgres-ssl` 镜像（major tag），只启用 `pg_trgm` | 保留 HA / PITR 的可能；locale 不能是 C |
| 搜索 | pg_trgm + 应用层 unigram / bigram 数组 GIN 索引 | V-8 已在 PG16 上实测 |

### 验证能力

- 本地：Docker 可以运行 Postgres 与 MinIO；Playwright 可以跑浏览器用例。
- CI：GitHub Actions（公开仓库免费）。
- 云：Railway CLI 已登录（有 TokenRoll、Hushed Chat 两个 workspace）；wrangler 已登录（DJJ 账号，token 对 zone 只有 `zone (read)` 权限）；gh 已登录（Disdjj，是 char-pub 的 admin）。

## External prerequisites

| # | 资源 | 当前状态（2026-09-22 只读检查） | 依赖它的工作 | 由谁完成 |
|---|---|---|---|---|
| X-1 | GitHub 组织 `char-pub` | 已存在，免费套餐；**没有强制 2FA**，新仓库**没有**默认开启 push protection | M0-3 | 用户授权后我用 gh 修改，或用户自己改 |
| X-2 | 仓库 `char-pub/char` | public，里面是旧原型 | M0 首次推送（需要 force push） | 用户确认后执行 |
| X-3 | 域名 `char.pub` | NS 已托管在 Cloudflare，还没有任何 DNS 记录 | M9-2 | 部署时创建；wrangler 当前的 token 对 zone 只读，需要用户授权或自己配置 DNS、WAF、Transform Rule |
| X-4 | Railway project `char-pub`（只有 `production` 一个 environment） | 还不存在；workspace 已确定为 `Hushed Chat`（Pro） | M9-2、M9-4 | 部署阶段征得用户同意后用 CLI 创建 |
| X-5 | R2 桶 `charpub-{public,private,uploads,evidence}` | 还不存在（账号下有 2 个无关的桶） | M4-4 联调、M9-2 | 部署前创建（会产生少量费用） |
| X-6 | OAuth App：GitHub / Discord / Google，各一个（回调地址指向主站 API） | 还不存在 | M4-2 联调、M9-2 | 用户在各平台后台创建（需要用户的账号），我提供回调地址 |
| X-7 | GitHub App（只读 Metadata + Contents，一个） | 还不存在 | M7-1 联调、M7-4 | 用户用 manifest 流程创建，或授权我用 gh 创建 |
| X-8 | Cloudflare Access（Zero Trust 免费版，最多 50 人）、Turnstile、CSAM Scanning Tool（需要一个经过验证的通知邮箱） | 还没配置 | M9-1 联调、M9-2 | 用户开通 Zero Trust；我提供配置 |
| X-9 | PhotoDNA Cloud Service 申请 | 还没申请 | 接入真实 provider（v0 之后，D-121） | 用户申请；不阻塞 v0 |
| X-10 | NCMEC CyberTipline ESP 注册 | 还没注册 | 上线前的合规流程（D-121 放行图片之后，这一项更重要） | 用户 |
| X-11 | npm 组织 `@char-pub` | scope 还没注册 | M10-2 | 用户创建 npm org |
| X-12 | `@commons` 种子内容来源 | 未定 | M10-1 | 用户决定：自己撰写、AI 辅助撰写后人工审校，还是征集 CC0 / CC-BY 内容 |

密钥的存放位置见 [security §9](../../design/security.md#9-密钥管理)。本文件不记录任何密钥值。

## Acceptance readiness

- M0～M8 的大部分验收只需要本地环境（Docker + Playwright）和 GitHub Actions，**现在就可以开始**。
- GitHub OIDC、webhook、Access JWT、Turnstile、CSAM provider 在本地都用协议级测试替身（真实签名、真实 HMAC），不依赖外部账号。
- 需要真实外部资源的验收：M7-4、M9-2～M9-4、M9-6、E2E-4、E2E-6（CSAM 部分）、E2E-7、E2E-8，以及 G-5 / G-6。
- 人工验收人：用户（G-5 以及所有标注“人工审阅”的条目）。

## Blockers

| # | 受影响的 DOD 条目 | 缺少什么 | 如何解决 |
|---|---|---|---|
| B-1 | M9-2、M9-4、E2E-8、G-6 | 在 `Hushed Chat` 创建 Railway project 的授权（X-4） | 部署阶段征得用户同意 |
| B-3 | M7-4、E2E-4 | GitHub App（X-7）和一个测试仓库 | 用户创建或授权 |
| B-4 | M0-3、D-120 | 修改组织设置的授权（X-1）：组织强制 2FA、push protection | 用户授权 |
| B-5 | M9-2 | OAuth Apps（X-6） | 用户创建 |
| B-6 | M9-2、M9-3 | Cloudflare zone 写权限、Access / Turnstile / CSAM 工具（X-3、X-8） | 用户授权或自己配置 |
| B-7 | M10-1 | 种子内容来源（X-12） | 用户决定 |
| B-8 | M10-2 | npm org（X-11） | 用户创建 |
| B-10 | M0 首次推送 | force push 覆盖 `char-pub/char` 前的确认（X-2） | 用户确认 |

已解决：B-2（D-121）、B-9（D-122）、B-11（D-119、D-123）。

M0～M5 的本地工作**不受**上述阻塞项影响（B-10 只影响推送，不影响本地提交），所以用户确认 DoR 之后就可以开始。
