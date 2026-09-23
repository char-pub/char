# PROGRESS（执行记录）

## Current state

- Goal：按 `DECISIONS.md` 与 `spec/` 从头实现 char.pub v0，包括成熟选型、架构、安全、admin 控制和单元测试（2026-09-22 用户提出）。用户已通过 `/goal` 授权持续执行 LOOP，并允许用 subagent / workflow 加速。
- Package：`docs/goals/v0/`
- Status：**实现中（M0～M8 的本地实现大部分完成）**。只做了本地 commit，没有 push（force push 覆盖 `char-pub/char` 需要用户单独确认，B-10）。
- Current work：
  - 已合并（本地 main）：core；assembler；ccv3；contracts；cli（含 login / publish）；publish Action；web SPA；Admin SPA（全部接口接入）；一致性测试集（27 个用例全部可起草，等待人工审阅）；server 的数据库 / 队列 / CAS / 审计、Better Auth、授权、HTTP 中间件、读取 / 搜索 / yank / tombstone 级联、上传管线与 CSAM 命中路径、Registry 写路径与发布 worker、admin 业务路由（四眼、法律请求、员工）、CCv3 导出 worker、bootstrap 命令、GitHub webhook / Source binding / OIDC 发布 / 同步与对账、Contribution API；单镜像五命令；runbooks；部署指南；冒烟测试脚本。
  - 并行 subagent：web 接 Registry API（含 `/v1/me` 与全栈 E2E）。
  - 下一步：Contribution 审阅 UI（M8-4）、访客验证（Turnstile + 邮箱）、服务端导入 API → 一致性用例人工审阅 → 等用户授权后部署 staging。
- Acceptance：DOD 条目尚未打勾。M0-1 / M0-2 本地检查已通过，但验收要求 CI 运行记录，需等首次推送后才能取得（依赖 B-10）。
- Blockers：见 [DOR § Blockers](DOR.md#blockers)。本地开发不受影响。
- 等待用户：一致性用例审阅与接受；复核 D-126 / D-129 / D-130；决定 D-135 第 1 条（CCv3 导入的默认 rights）；授权 force push、组织设置、staging 资源、OAuth App 与 GitHub App 创建。

## Evidence and decision history

### 2026-09-22 DoR 准备

- Work：
  - 把设计文档从 `/Users/djj/code/char_pub` 复制到工作区。
  - 读取 ChatGPT 分享页上的完整讨论记录（`.llmdoc-tmp/research/chat-transcript.md`），并与 DECISIONS 核对：内容一致；聊天里提到的 Runtime Registry、可执行扩展等，都已确认不在 v0 范围内。
  - 做了只读的环境检查：railway、wrangler、gh 都已登录；`char.pub` 的 NS 在 Cloudflare；npm scope 未注册；组织没有强制 2FA，也没有开 push protection。
  - 完成三项调研（auth-github、infra-compliance、libraries）。库选型那项按用户要求提前收尾。
  - 写好 VISION / DOD / LOOP / DOR / PROGRESS，以及 architecture / security / admin / testing 四份设计文档。
- Verification：这是文档工作，没有可执行的验收。人工审阅待用户完成。
- Decisions：
  - D-110～D-118 已追加到 `DECISIONS.md`：仓库、License、备份、SPA、Admin 隔离、staging 域名、O-1 / O-2 的取值、先完成 DoR、OIDC 发布强制安装 App、transfer 后冻结 binding。
  - D-087 的备份部分被 D-111 取代。
  - 用户原则：选型要成熟，基本确认即可（已存入记忆）。
- Remaining：
  - 用户回答 Q-1～Q-6。
  - DOR F-1 中 spec 类型的修正，在 M7 开始前完成。
  - `llmdoc/` 目录还不存在；等有代码之后，建议运行 `/llmdoc:init`。

### 2026-09-22 用户回答 Q-1～Q-6

- Decisions：写入 D-119～D-124，分别是：Workers Static Assets；Admin MFA 交给 Cloudflare Access 与组织 2FA；PhotoDNA 接入前图片直接放行（临时）；合规基线为美国 + 欧盟；CCv3 自己实现；Railway 用 `Hushed Chat` workspace（Pro）。D-112 的部署方式和 D-113 的 2FA 部分已标注 Superseded。
- 同步修改了 architecture / security / admin / VISION / DOD / DOR。
- 影响验收的改动：M6-2 改为 noop scanner 加命中路径的测试替身；M9-1 去掉应用内 TOTP；M0-3 的组织强制 2FA 成为 Admin MFA 的前提。


### 2026-09-22 M0 骨架与 core 起步

- Work：
  - M0：pnpm workspace + catalog（`minimumReleaseAge` 3 天、install 脚本白名单）、TypeScript 6 project references、Vitest 4 projects、Biome、dependency-cruiser（core 禁止 node 内置模块和未审阅的依赖，并禁止 `Date` / `fetch` / `process` / `crypto` 全局）、lefthook + gitleaks pre-commit、CI / CodeQL / dependency-review / Scorecard workflow（Action 全部固定到 SHA，默认 `contents: read`；Scorecard 不对外发布结果）、LICENSE / spec/LICENSE / SECURITY.md / CODEOWNERS / Renovate / `.env.example`、`infra/docker-compose.yml`（Postgres 16 非 C locale + pg_trgm + 非 owner 应用角色；MinIO 使用 quay.io 镜像，因为 Docker Hub 的 `minio/minio` 已不可拉取）。
  - core：标识符语法、Canonical Model / Release / Contribution / Context IR 的 zod schema、canonicalize 与 digest、模板解析、IR key 计算。
- Verification：
  - `pnpm ci:all`（空实现）通过：lint、typecheck、deps、unit、build、gitleaks（git + dir 均 0 条发现）。
  - 规则探针：在 core 中写 `Date.now()` 被 Biome 拒绝；import `node:fs` 被 dependency-cruiser 拒绝。
  - `docker compose up`：Postgres 以 `charpub_app` 登录成功，`datcollate = en_US.UTF-8`，`pg_trgm` 已安装；MinIO 四个桶创建成功。
  - core 单元测试 80 个通过，包括键序、CRLF / 行尾空白 / NFD、JSON 缩进三类 fast-check 性质测试。
- Decisions：D-125（pnpm）、D-126（semantic_digest 中 fragment 列表保留声明顺序，**规范修正，请用户复核**）、D-127（内部 ID 用 TypeID）、D-128（GitHub 数字 ID 用十进制字符串）。
- 用户指示：代码注释和 llmdoc 要自包含，不堆砌章节 / 决策编号（已写入 LOOP 约束与记忆）。
- Remaining：M0-1 / M0-2 需要 CI 运行记录；M0-3 需要用户授权修改组织设置；M0-4 需要在干净环境按 README 走一遍。

### 2026-09-22 core 核心逻辑与授权

- Work：Resolver（图加载、绑定环境、渲染、元数据汇总）、发布校验（9 条规则 + 下架黑名单，每条都有反例）、check 规则 / license / JSON Schema（subagent）、Contribution 合并与 Context Diff（subagent）、server 的 `authorize()` 与 HTTP 中间件。
- Verification：`pnpm lint`、`pnpm typecheck`、`pnpm deps` 通过；`pnpm test` 共 580 个单测通过。覆盖率（`vitest --coverage`）：canonical 97.6% 行 / 93.7% 分支；Resolver 各文件 94–98% 行；merge.ts 100% 行 / 98.4% 分支；authorize.ts 98.9% 行 / 97.9% 分支；publish.ts 98.3% 行。JSON Schema 快照防漂移测试通过。
- Decisions：D-129（check / Resolver 细化）、D-130（合并 / Diff 细化），均标注“待用户复核”。
- 尚不能打勾：M1-2 需要 schema 快照的人工审阅；M1-3 / M2-1 / M2-5 需要一致性测试集在三运行时通过并经人工审阅预期输出；M2-2 需要一致性测试集的 publish 用例；M4-3 还缺“每个路由都经过 authorize”的 lint 规则（路由尚未编写）。

### 2026-09-22 Assembler、CLI、Action、contracts

- Work：合并参考 Assembler（subagent，62 个测试，行覆盖 99%）；新增 `packages/contracts`、`packages/cli`、`actions/publish`。
- Verification：`pnpm test` 共 660+ 个单测通过；CLI 构建后 `node packages/cli/dist/bin.js --help` 可用；`char check --fix` 在临时目录端到端写回 ID 并保持幂等；Action 打包产物在临时目录用 dry-run 运行成功（输出 semantic digest，不调用网络）；`pnpm check:action-dist` 证明提交的 dist 与源码一致。
- Decisions：D-131（参考 Assembler 取值）、D-132（`char.yaml` v0 书写形式）。
- 尚不能打勾：M7-3 还缺 `login` / `publish`（依赖 server API）；M7-4 需要 staging 与真实 GitHub App（B-3）。

### 2026-09-22 server 基础合并、web 骨架、runbooks

- Work：合并数据库 / 队列 / CAS（subagent，54 个集成测试）、OIDC / webhook（subagent，OIDC 分支覆盖 98.7%，webhook 97.1%）、web SPA（subagent）；新增上传图片处理（sharp 0.34.5：0.35 还在 3 天冷却期内）、`CsamScanner`、员工角色矩阵、Access JWT 校验、API 骨架、7 份 runbook。
- Verification：`pnpm test` 922 个通过；`pnpm test:integration` 通过（Testcontainers：Postgres 16 + MinIO）；`pnpm build` 通过，web 产物 `index.html` 只有一个外链 module script；上传处理分支覆盖 96.7%；本地用 `vite preview` + Playwright 查看 Playground，发现 Trace 表 reason 列在 1200px 宽度被截断，已修复并复查截图。
- Decisions：D-133（数据库 / 队列 / 审计）、D-134（OIDC / webhook）。security 文档的审计哈希公式已与实现统一。
- 尚不能打勾：M9-5 runbooks 需要用户人工审阅。

### 2026-09-22 一致性测试集、CCv3、admin、GitHub binding

- Work：
  - 合并一致性测试集基础设施（subagent，27 个用例，Node / Chromium / workerd 三端）与 `packages/ccv3`（subagent，85 个测试）。ccv3 的往返测试改为使用真实 Resolver。
  - 修复 Resolver bug：可选且未被使用的 late slot 不进入 IR 时，它的 participant 仍然留在 IR 中（一致性用例 012b 起草时发现，已加回归测试）。
  - 新增一致性预检 `pnpm conformance:precheck`（排序、digest 重算、key 公式、悬空引用、签名 URL）与审阅表生成 `pnpm conformance:review`。
  - admin 进程骨架（Access JWT + 员工角色 + 操作理由）、kill switch 与审计路由；Postgres 限流与 5 秒开关缓存；GitHub webhook 事件落库、binding 生命周期（转移冻结、重新绑定 / 解绑、对账补偿）、数据库 jti 存储；web 的 wrangler 配置（dry-run 通过）；`infra/DEPLOY.md`。
- Verification：
  - `pnpm test` 1015 个单测通过；`pnpm test:conformance` 98 passed / 81 todo（draft 用例只运行不比较）。
  - `pnpm conformance:precheck`：8 个 IR draft 全部通过；篡改 fragment 文本与 participants 顺序后预检能报出 digest 不符与排序错误。
  - 集成测试：admin 9 个（包括公开 api 上访问 admin 路由返回 404）、限流与开关 6 个、GitHub binding 11 个，全部通过。
  - `wrangler deploy --dry-run --env staging`（apps/web）通过，未实际部署。
- Decisions：D-135（CCv3 取值；**导入卡片的默认 rights 待用户决定**）。
- 待用户审阅：`pnpm conformance:review` 生成 `spec/conformance/REVIEW.md`；审阅后用 `pnpm conformance:accept <case> --reviewer <name>` 接受。在接受之前 M2-5 不能打勾。

### 2026-09-22 Better Auth、读取 / 上传 / 下架、进程入口

- Work：合并 Better Auth（subagent，21 个集成测试，含完整的 GitHub OAuth 回调模拟）、Registry 读路径与 CJK 搜索与 tombstone 级联（subagent）、上传管线与 CSAM 命中路径（subagent）；新增 `processes/`（单镜像四命令）、`apps/server/Dockerfile`、CDN purge、tombstone 任务分发；把路由与 worker 接进进程。
- 发现并修复：pg-boss 的调度器每次启动都会插入内部队列并更新版本行，原来的权限收紧会让 worker 启动即崩溃（容器实测发现）。改为用行级安全只允许插入已登记的队列名；pg-boss 后台错误改为记录而不崩溃。
- Verification：`pnpm test` 1046 个通过；集成测试 159 个通过（15 个文件）；容器内实测：`migrate` 成功；`api` 在 production 缺少 `ORIGIN_AUTH_SECRET` 时拒绝启动，配置后不带 `X-Origin-Auth` 返回 403，带正确值时正常路由，`/healthz` 豁免；`worker` 启动后本机健康检查返回 ok。
- Decisions：D-136（Better Auth）、D-137（读取 / 搜索 / 下架 / 上传 / 部署形态）。

### 2026-09-22 Registry 写路径与本地端到端

- Work：合并 Registry 写路径（subagent，31 个新集成测试）；迁移重新编号为 0004；api 进程挂载写路由，worker 运行发布任务并定时重新入队被推迟的发布；接入 Admin SPA 骨架（subagent）；GitHub App 源码读取与共享的 char.yaml 解析。
- Verification：`pnpm test` 1077 个通过；集成测试 190 个通过（18 个文件）；本地容器端到端见 [evidence/2026-09-22-local-e2e-publish.md](evidence/2026-09-22-local-e2e-publish.md)（CLI 发布 → worker → 匿名下载 IR，内容寻址校验、幂等、409、搜索）。
- 发现并修复：发布后作品搜不到（发布任务没有写搜索列）；GitHub 内容 API 的路径中 `/` 被编码（模拟 GitHub 的测试发现）；Action 打包产物在 CLI 重构后过期（`check:action-dist` 拦下，已重新构建并用 dry-run 验证）。
- Decisions：D-138（写路径）。

### 2026-09-22 admin 业务路由、CCv3 导出、bootstrap、GitHub Source、Contribution API

- Work：
  - 合并 admin 业务路由（subagent：举报、内容、带四眼确认的下架、用户、namespace、CSAM、法律请求、任务、员工）与 Admin SPA 全部接口的接入；mock 规则与服务端对齐（强制评级只能调高、CSAM 锁定的账号不能被重新封禁）。
  - CCv3 导出 worker：按需从已存储的 IR 生成卡片与 Loss Report，结果按内容缓存，下架后不再提供。
  - `bootstrap` 命令：创建系统账号、把第一个员工提升为 owner，都写审计，可重复执行；部署指南补充引导步骤。
  - 合并 GitHub Source（subagent：webhook 入口、binding 路由、OIDC 发布、同步与对账任务）与 Contribution API（subagent：提交、列表、合并预览、接受 / 拒绝 / 撤回、邀请、Agent Token）。两个分支的迁移分别重新编号为 0006、0007（用 drizzle-kit 重新生成，SQL 与原分支一致）。
- Verification：`pnpm test` 1085 个通过；集成测试 534 个通过（25 个文件）；`pnpm lint` / `pnpm typecheck` / `pnpm deps` 通过。
- Decisions：D-139（admin 路由）、D-140（GitHub Source 与 OIDC 发布）、D-141（Contribution API）。
- 尚不能打勾：M7-4 需要真实 GitHub App（B-3）；M8 还缺 Contribution 审阅 UI 与访客验证入口。
