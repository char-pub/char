# PROGRESS（执行记录）

## Current state

- Goal：完成 char.pub v0；本轮按用户“先把功能实现”的指示，补齐 web 重设计后留下的功能缺口。
- Package：`docs/goals/v0/`
- Status：主站已上线，web 重设计已合并（PR #5）。本轮功能补齐已通过 PR #7 合并并部署主站（abf4e35）；不再维护 staging。
- Current work：GitHub App 安装与仓库绑定、删除申请及后台详情、导入确认恢复、草稿与列表头像、贡献统计和冲突标记、发布来源与 Agent Token 已实现；全量回归、知识同步和主站更新已完成，线上冒烟 6 项通过。
- Acceptance：DOD 当前 35 条已勾选、22 条未勾选。本轮不代替人工审阅或主站验收，不新增验收勾选。
- Remaining：一致性用例与界面/runbook 人工审阅、主站端到端验收（包含第二账号的 GitHub 转移/改名反例）、备份恢复演练、commons 种子库、npm 发布、公开开放确认。具体依赖见 DOD / DOR。
- 等待用户：运营主体名称和公开联系邮箱尚未确定（2026-09-24 用户答复）；政策页面明确保留待补项。部署和对外发布依照 LOOP 单独授权。

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

### 2026-09-22 经验证访客、CCv3 导入 API

- Work：合并经验证访客（subagent：Turnstile 校验、SMTP 验证邮件、访客会话 cookie，替换测试专用的访客头）与 CCv3 导入（subagent：`POST/GET /v1/imports`、导入确认、import worker，卡片中的图片走普通上传的处理与扫描）。迁移分别为 0008、0009（导入分支用 drizzle-kit 重新生成，SQL 与原分支一致）。
- 发现并修复：Contribution 合并后 Action 打包产物没有重新生成，`ci:all` 的产物检查失败；已重建，并在 pre-commit 增加产物检查（用一次会改变产物的改动验证能拦截）。新旧产物对同一项目 dry-run 得到相同的 semantic digest。
- Verification：`pnpm ci:all` 在合并前的 main 上除产物检查外全部通过（单测 1042、web / admin 43、一致性 103 通过 / 81 todo、集成 + server 单测 1015、build），产物修复后单独复跑通过；合并后 `pnpm test` 1118 个通过，集成测试 564 个通过（27 个文件），lint / typecheck / deps / `check:action-dist` 通过。
- Decisions：D-142（CCv3 导入）、D-143（经验证访客）。

### 2026-09-22 web 接 API、Admin SPA 全模块、DOD 本地审计

- Work：
  - 合并 web 接 Registry API（subagent：登录菜单、浏览与搜索、作品页、编辑器与自动保存、发布流程、设置与个人 Token、`/v1/me`、CORS、全栈 E2E `pnpm e2e:fullstack`）。
  - 合并 Admin SPA 全模块覆盖（subagent：新增四眼请求页、员工页；法律、CSAM、举报、内容等页面接入全部已有接口；修复 `@@namespace` 显示与 mock 规则偏差）。
  - DOD 本地证据审计（subagent）：32 个本地条目逐条对照测试并实际运行，17 条可打勾，11 条有缺口，4 条等待一致性用例的人工接受。抽查了 M4-1（应用角色 UPDATE / DELETE / TRUNCATE `audit_log` 被拒）、M5-4（中文与日文的两字查询）、M6-1（SVG、polyglot、像素炸弹样本）的证据，与报告一致。
  - `ci:all` 加入 web 与 admin 的 Playwright（`pnpm test:e2e`）；部署指南补充 public / private 桶的 CORS 与 CSP 收窄步骤。
- Verification：`pnpm test` 1156 个通过；集成测试 574 个通过（28 个文件）；`pnpm test:e2e`：web 3 个通过（截图与全栈用例默认跳过），admin 93 个通过；全栈 E2E 由 subagent 在本机 Docker 上跑通 UC-1（注册 namespace → 编辑 → 上传头像 → 发布 → 匿名访问 → 搜索 → 下载 IR 并校验）。
- Decisions：D-144（web 接入 API）。
- DOD：按审计结论勾选 17 条。

### 2026-09-22 服务端遗留项、core 测试缺口、一键本地环境

- Work：
  - 合并服务端遗留项（subagent：每小时清理过期数据；导入最后一次失败时标记 failed 且可从死信恢复；admin 停用 / 恢复访客；本地 Mailpit；Turnstile 测试密钥只在 development 生效）。
  - 合并 core 测试缺口（subagent，新增 126 个用例：标识符长度边界、Release / Contribution schema 的接受 / 拒绝表、digest 已知答案向量与默认值性质测试）。测试发现只允许 https 的 URL 在导出的 JSON Schema 里丢失了协议限制，已修复并重新生成 `spec/schema/`。
  - `pnpm dev` / `pnpm dev:login` / `pnpm dev:smoke`：一条命令启动 api、worker、web；不需要 OAuth app 也能登录；CI 新增 `dev-env` job 在全新 runner 上运行冒烟。
  - 走查中发现并修复：`pnpm infra:up` 在 Compose v5 下每次都失败；生命周期规则重复累积；系统账号 ID 不一致时报错不可读；端口被占用时的等待与残留进程。
- Verification：`pnpm test` 1283 个通过；集成测试 616 个通过（31 个文件）；一致性 103 通过 / 81 todo；全新 clone 的走查与 `pnpm dev:smoke` 6 项全部通过，见 [evidence/2026-09-22-local-dev-walkthrough.md](evidence/2026-09-22-local-dev-walkthrough.md)。
- Decisions：D-145（清理、导入失败、访客管理、本地邮件）、D-146（继承值不参与默认值省略，**待用户复核**；https URL 校验）。
- 尚不能打勾：M0-4 需要 CI `dev-env` 的首次运行记录（依赖推送，B-10）。

### 2026-09-22 推送、CI、staging 资源

- 用户决定（D-150）：授权 force push、创建 Railway + R2 staging、种子内容由 AI 辅助撰写后人工审校、导入默认权利保持强制确认；随后决定 Postgres 全面改用 18（D-152）。
- 推送：`pnpm ci:all` 中除 secrets 外每一步都通过；secrets 检查报出的是 `pnpm dev` 写在 git 忽略目录 `.dev/` 里的本地密钥，已把该目录加入 gitleaks 允许名单并单独复跑通过。推送前发现远端 main 有 4 个当天的新提交（旧原型，npm 工程），向用户确认后才覆盖，原内容已备份。推送 `c601fa2` 后 GitHub 上 `ci`（check + dev-env）、`codeql`、`scorecard` 全部成功（run 35822700874）。
- Railway：在 `Hushed Chat` 创建 project `char-pub`（6b80b92a-…）与 environment `staging`，按用户看过的 plan（4 项新建，无修改或删除）apply `.railway/railway.ts`。模板创建的 Postgres 是 18.6，用户决定全面改用 18；在 18 上重跑集成测试 1292 个、全栈 E2E 3 个、`pnpm dev` 冒烟全部通过，apply 后再次 plan 显示已同步。创建 `charpub_app` 角色（口令在本机生成、经 stdin 传入，不进 git 与日志），设置了三个进程的 `DATABASE_URL` 以及本地可生成的密钥（会话签名、源站校验、法律加密、系统账号 ID），本地副本保存在仓库之外的 `~/.charpub-secrets/`（权限 0600）。
- R2：创建 `charpub-staging-{public,private,uploads,evidence}`；uploads 1 天过期；public、private、uploads 的 CORS 按 `infra/r2/` 设置；`r2.dev` 保持关闭。
- 尚缺（需要用户）：R2 S3 API token（当前 wrangler 登录没有创建 API token 的权限）；Cloudflare zone 写权限（DNS、Transform Rule、WAF）；Access 应用；Turnstile widget（wrangler 有 `challenge-widgets.write`，可以代为创建）；OAuth App；GitHub App；SMTP 服务商。在这些值设置之前，三个进程因缺少 S3 变量而无法启动（启动日志只列出缺少的变量名）。

### 2026-09-22 staging：进程上线

- 用户在控制台创建 R2 的 S3 凭证（范围为四个 staging 桶）。我从仓库根目录的临时文件把它移到仓库外的 `~/.charpub-secrets/`，没有进入 git；从本机实测 public / private / evidence 三个桶读写删除正常。uploads 桶从本机的 TLS 握手被本地网络重置（本机 DNS 解析到 198.18.x 的代理地址，只有这个主机名被拦）；从 Railway 容器内访问同一个主机名正常，所以不是凭证或桶的问题。
- 经 stdin 把 S3 凭证与 endpoint 写入 api、admin、worker。
- 发现并修复：Railway 定义里 `OIDC_AUDIENCE` 是字面值，而 GitHub 集成的其余变量尚未设置，“要么全配、要么全不配”的检查让 api 与 worker 拒绝启动。改为 `preserve()`，并在定义的测试中禁止这类分组里出现字面值（先确认新测试在旧定义上失败）。
- 结果：api、worker、postgres 为 Online；api 的 pre-deploy 迁移完成（11 个迁移）。在 api 容器内验证：`/healthz` 200；不带 `X-Origin-Auth` 的 `/v1/search` 返回 403 `origin.forbidden`，带正确值返回 200。在 worker 上执行 `bootstrap --system-actor`，写入系统账号与审计记录。admin 因缺少 Cloudflare Access 的三个变量而未启动，符合预期。
- 仍需用户：Cloudflare Access 应用（`CF_ACCESS_TEAM_DOMAIN`、`CF_ACCESS_AUD`、`STAFF_EMAILS`）；自定义域名的 DNS、Transform Rule、WAF；OAuth App；GitHub App；Turnstile；SMTP。

### 2026-09-23 M0 的 CI 证据

- 四次推送的 ci（check + dev-env）、codeql、scorecard 全部成功；`check` 在 runner 上跑完整的 `pnpm ci:all`，`dev-env` 在全新 runner 上跑 README 的本地开发步骤。据此勾选 M0-1、M0-4。见 [evidence/2026-09-23-m0-ci.md](evidence/2026-09-23-m0-ci.md)。
- M0-2 暂不勾选：用探测 PR（#1，已关闭）触发依赖审查，失败原因是仓库没有开启 Dependency graph；Renovate 只有配置，组织没有安装 App。都需要用户修改仓库或组织设置。

### 2026-09-23 staging：web、公共资源域名与边缘规则

- web 部署到 `https://staging.char.pub`（Workers Static Assets，自定义域名由 deploy 自动绑定），构建时指定 staging API 与 staging Turnstile site key；SPA 深层路由 200，安全响应头齐全，页面能调用 staging API。
- R2 public 桶绑定 `staging-assets.char.pub`：匿名读取 200，CORS 只对 `https://staging.char.pub` 返回允许头，对其他来源不返回。
- 用户同意后经 tool-bridge 的 Cloudflare API 工具操作账户：
  - `pnpm cf:rules --apply` 写入方法白名单、登录限流、staging 与 production 两条源站校验规则，接管了手工建的 staging 规则；再次比较显示与仓库一致。
  - 外部验证：经 Cloudflare 的 `/v1/search` 200；`TRACE` 405、`PROPFIND` 403；并发请求登录接口时出现 429（响应来自 Cloudflare 边缘或应用内 Better Auth 限流，GraphQL 防火墙事件在 Free 套餐下不可查询，无法区分）；直连 Railway 仍为 403。
  - 创建 `char.pub staging` 与 `char.pub production` 两个 Turnstile widget，secret 存在本机 `~/.charpub-secrets/`，不进仓库。
- 冒烟测试：web、api 相关 4 项全部通过；admin 相关 2 项等 Cloudflare Access。
- 未解决：页面被插入 Cloudflare Web Analytics 的 beacon 脚本，被 CSP 拦下（只有一条控制台报错）。zone 的 RUM 已关闭，账户下的 Web Analytics 站点里也没有 char.pub，来源尚未查明。

### 2026-09-23 改为单一主站

- 用户决定不设 staging（D-155）。删除 Railway 的 staging environment（4 个服务与数据库，删除前确认只有系统账号、没有作品与 Release）、四个 staging R2 桶（删除前确认为空）与其自定义域名、web 的 staging Worker、staging 的 DNS 记录与 Turnstile widget、本机的 staging 密钥文件。
- 仓库改为单一主站：Railway 定义只针对 production（其他 environment 直接报错）；R2 桶名 `charpub-*`；Cloudflare 规则只含主站主机名（已 `cf:rules --apply` 并复核）；web / admin 的 wrangler 与 CSP、冒烟测试默认目标、DOD / 部署指南 / 设计文档 / runbook 都已改写。`pnpm test` 1307、`pnpm test:e2e` web 23 / admin 107 通过。
- production 的 Railway plan：4 项新建、无修改与删除，**等待用户同意后 apply**。
- 需要用户：为新的 `charpub-*` 桶重新创建 R2 S3 凭证（桶在 apply 之后创建）；Cloudflare Access 应用；OAuth App；GitHub App；SMTP。

### 2026-09-23 主站上线（公开部分）

- 用户同意后 apply production：Postgres 18.6 与 api / admin / worker；建 `charpub_app` 角色，写入数据库连接串与本机生成的密钥（会话签名、源站校验、法律加密、系统账号 ID）。用户在控制台为新的 `charpub-*` 桶创建 R2 凭证并放在仓库根目录的 `.env`（git 忽略）；我复制到仓库外的 `~/.charpub-secrets/production-r2.env` 后写入三个进程，并在本机与 Railway 容器内验证四个桶可读写。
- 自定义域名 `api.char.pub`、`admin-api.char.pub`：DNS 记录经 Cloudflare API 创建，Railway 同步 ACTIVE。`assets.char.pub` 绑定 public 桶。web 部署到 `www.char.pub`。`bootstrap --system-actor` 完成。
- 冒烟测试：web 与 api 4 项通过；admin 2 项等 Cloudflare Access。边缘防护：直连源站 403、伪造头无效、方法白名单生效、公共资源 CORS 只放行 www。详见 [evidence/2026-09-23-production-deploy.md](evidence/2026-09-23-production-deploy.md)。
- 仍需用户：Cloudflare Access 应用（admin 与 admin SPA）；GitHub OAuth App（登录）；GitHub App（Source 与 OIDC 发布）；SMTP（访客验证）；Dependency graph、Renovate、secret scanning / push protection、分支保护、组织 2FA（M0-2、M0-3）；M8-3 截图与一致性用例的人工审阅。

### 2026-09-23 品牌 logo

- 引入 `char-pub/brand-assets` 作为子模块（`vendor/brand-assets`，固定在 4cec283）。web 与 admin 的顶栏、页脚标志改为品牌几何（线条用 `currentColor`，浅色为 Ink、深色为 White）；favicon、ico 与 Apple touch icon 由 Vite 插件从子模块提供，仓库不保存副本，子模块缺失时构建直接报错并提示命令。CI 拉取子模块。按用户要求，配色与字体暂不改动。
- 已部署到 `www.char.pub`，三个图标地址 200；该提交的 ci / codeql / scorecard 通过。
- 清理：所有 subagent 已结束，只保留主 worktree；main 的上游改为 `github/main`。

### 2026-09-23 主站全部上线

- 用户提供 GitHub App 私钥、webhook secret、App ID、SMTP（Resend，`char.pub` 已验证），并在 Railway 中配置了 OAuth App 与部分 Access 变量。我把文件从仓库根目录移到 `~/.charpub-secrets/`，写入 api / worker，发件人 `char.pub <no-reply@char.pub>`，写入 Turnstile secret 与 `GUEST_HMAC_KEY`。
- 修正 Access 策略（组织成员限制之前没有生效）、更正 admin 的 Access 变量；admin 与 admin SPA 上线。冒烟测试 6 项全部通过，勾选 M9-2、M9-3，证据见 [evidence/2026-09-23-production-deploy.md](evidence/2026-09-23-production-deploy.md)。
- `bootstrap --owner shuaiqijianhao@qq.com` 与 `--system-namespace commons --member shuaiqijianhao@qq.com` 完成。
- GitHub App 装在 `Disdjj/char-djj`（用户指定的测试仓库，不用 blog），下一步在其中做 M7-4 / E2E-4。

### 2026-09-23 M7-4 与公开 IR 跨域

- 在用户指定的测试仓库 `Disdjj/char-djj` 上完成真实 OIDC 发布：`@djj/char-djj-test@1.0.0`（tag v1.0.0）。首次运行暴露出每次 OIDC 发布都会失败的 digest 比对缺陷，修复合并为 PR #3（D-156）。反例：从不允许的分支发布被拒（`binding.ref_not_allowed`）。勾选 M7-4，见 [evidence/2026-09-23-m7-4-oidc-publish.md](evidence/2026-09-23-m7-4-oidc-publish.md)。
- Railway 服务重新连接 GitHub 源后才会在合并时自动部署（部署指南已补充）。
- 用户报告公开 IR 跨域失败：公开下载 302 到 assets 后浏览器 Origin 变为 `null`。public 桶 CORS 改为允许任何来源的只读请求，浏览器中复验通过。
- 需要第二个账号的 E2E-4 反例（改名劫持、仓库转移冻结）按用户决定之后再测。

### 2026-09-23 web 重新设计

- 用户确认后按 `docs/design/web.md` 重做 web（D-157）：功能拆分与 11 条操作路径、UI 方向、Pencil 设计稿 `docs/design/web.pen`（23 个画板），然后实现。
- **基础层**：品牌 token（Sand / Night / Ink，橙紫蓝对应三种作品类型），Plus Jakarta Sans 与 JetBrains Mono 自托管，浅色 / 深色 / 跟随系统三态且首屏不闪烁；补齐 shadcn 组件（Select、Dialog、Sheet、Tabs、Toast 等）；顶栏加全局搜索和移动端抽屉，登录改成对话框；统一的空状态、出错、404 / 410、骨架屏与全站只读提示。sonner 在运行时插入的 `<style>` 被 CSP 拦截，改为把样式打包进 CSS。
- **页面**：首页（真实的最近发布）、探索、作者主页 `/c/$ns`；作品外框加五个标签（Overview、Context preview、Versions 含版本对比、Contributions、Settings），举报与 yank 对话框，成人内容遮挡在会话内对该作品保持显示；新建、导入（评级 / 权利 / 许可必须显式选择）、整页编辑器（搜索式依赖选择器、发布前检查栏）、发布对话框；贡献列表、提交与审阅（敏感变更逐项确认、显示拒绝理由）；我的作品；账户设置（namespace 改名、成人内容、Token）。
- **服务端**：搜索按 namespace 过滤；公开举报接口；贡献拒绝理由存进 `contributions.decision_reason`（迁移 0011，并从审计日志补回已有的理由）；按 @namespace 邀请贡献者，邀请名单只返回 @namespace。
- **验证**：`pnpm ci:all` 全部通过（单元 1241、web / admin 单测 174、conformance 103、集成 1349、web e2e 56、admin e2e 107）；全栈 e2e 3 个通过；浅色、深色与移动端逐页截图对照设计稿。
- **接口缺字段、这次没做的**：搜索结果与我的作品没有头像（卡片用类型色加首字母）；Release 没有来源与发布者字段；贡献列表没有各状态数量、变更数与冲突标记；Token 列表不显示 Agent 标记；web 不能新建 GitHub 绑定（缺 GitHub App 安装流程）；“请求删除”暂时链接到 `/policy`；未发布过的头像换设备后无法预览。
- **原有的不一致，未改**：web 限制头像 10 MB，security.md 写的是 8 MiB，服务端对上传统一只限 20 MB；导入后未确认就去发布（`publish.import_unconfirmed`）时，web 上没有回到导入确认的入口。
- M8-3 的截图（`evidence/m8/`）是重设计之前的样子，人工审阅前需要重新截取。

### 2026-09-24 补齐用户侧功能

- 完成 GitHub App 安装入口、账号关联、仓库查找与绑定表单；查找、绑定、转移后重绑定都校验当前登录账号关联的 GitHub 数字身份和仓库写入权限，拒绝仅凭 installation/repository ID 绑定他人仓库。
- 删除入口改为提交申请、回执与本人状态列表，接入既有法律请求队列；请求正文加密，管理后台可查看申请人、类型与理由。提交申请不会立即删除账号或作品。
- 导入中断后可从编辑器返回确认向导；评级、权利和许可继续要求显式选择。前端限制统一为图片 8 MiB、JSON 5 MiB、PNG/CHARX 20 MiB（服务端原本已有该区分，上一条记录“统一只限 20 MB”不准确）。
- 草稿头像通过鉴权接口获取本人已处理上传的签名地址，支持页面刷新；搜索和我的作品展示头像。修复公开发布 worker 漏复制镜像图片到公共存储的缺陷。
- 贡献列表补充各状态数量、变更数与仅成员可见的当前冲突标记；我的作品显示待处理贡献数；版本列表显示来源与发布者摘要；Token 创建和列表支持 Agent 标记。
- Verification：本地完整浏览器流程 3 项通过（创建/上传/刷新/发布/匿名读取、导入确认/发布/导出、贡献 rebase 与敏感变更确认）。`pnpm ci:all` 全部通过：单元 1247、web/admin 组件 176、一致性 103（另有 81 项既存 todo 等人工接受）、服务端集成及单元 1364、web e2e 57、admin e2e 107；lint、类型、依赖、构建、Action dist 一致性、gitleaks 均通过。
- Remaining：本轮尚未部署；运营主体及联系邮箱待用户确定。此前人工审阅、主站验收、备份恢复和发布任务维持待办。

### 2026-09-24 文档同步与主站更新

- 用户授权更新文档并上线；补部署说明、共享删除密钥配置与回归测试。API 使用与 admin 相同的现有法律加密密钥，安全传递且未输出值。
- [PR #7](https://github.com/char-pub/char/pull/7) 检查通过后合并为 `abf4e35`；main CI 通过。三个 Railway 服务从 GitHub 源部署到该提交，两套 Cloudflare 前端 production 构建均上线。
- `pnpm ci:all` 再次全部通过（unit 1248，其余数量同上一条）；全栈 3 项通过；线上冒烟 6 项通过，额外验证新增删除申请鉴权、公开版本来源字段、worker 健康及 Web 产物一致性。
- 具体版本、部署 ID 和证据见 [主站更新记录](evidence/2026-09-24-workflow-deploy.md)。运营主体与联系邮箱仍待确定；人工审阅及其余 DOD 未完成项不变。
