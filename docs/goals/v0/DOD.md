# DOD：char.pub v0

## Acceptance basis

[VISION.md](VISION.md) 描述了约定的成果。一个条目只有在**当前状态**有证据时才能打勾，证据可以是：命令加结果、可重复的用户流程加观察到的结果，或写明审阅人和结论的明确人工审阅。证据链接统一记在 [PROGRESS.md](PROGRESS.md)。之后的改动如果使某条证据失效，要重新打开对应条目。

命令约定：以下命令在仓库根目录执行，需要 Node 22 LTS 以上、pnpm 和 Docker；具体版本由 M0 锁定，写在 `package.json#engines` 与 `packageManager` 中。

## Global acceptance

- **G-1 回归**：在最终提交上 `pnpm ci:all` 全部通过（lint、typecheck、依赖边界、unit、property、conformance ×3 运行时、integration、security、build、gitleaks、CodeQL、依赖审查）。
- **G-2 覆盖率**：达到 [测试策略 §3](../../design/testing.md#3-覆盖率门禁) 的门槛（SC-16）。
- **G-3 文档一致**：`DECISIONS.md`、`spec/`、`docs/design/` 与实现一致。所有新增决策都写入 DECISIONS；规范有改动时，一致性测试集同步更新。
- **G-4 无密钥**：gitleaks 扫描全部历史为 0 条发现；仓库中只有 `.env.example`（SC-14）。
- **G-5 人工验收**：用户在 staging 上按“端到端验收”走一遍，并在 PROGRESS 中记下“验收通过”及日期。
- **G-6 生产可用**：production 各域名可访问，冒烟测试通过，Railway 备份已启用（SC-15）。

## Acceptance items

### M0 仓库与工程基线

- [ ] **M0-1** monorepo 骨架（pnpm workspace、TS project references、Vitest、lint、依赖边界规则）就绪；`pnpm ci:all` 在空实现上通过。验证：CI 运行记录。
- [ ] **M0-2** 公开仓库安全基线：`LICENSE`（Apache-2.0）、`spec/LICENSE`（CC-BY-4.0）、`SECURITY.md`、`CODEOWNERS`、Renovate、CodeQL、依赖审查、gitleaks（CI + pre-commit）；所有 workflow 声明 `permissions: contents: read`，第三方 Action 固定到 SHA。验证：CI 记录 + 文件审阅。覆盖：SC-14。
- [ ] **M0-3** 组织与仓库设置：组织强制 2FA（这也是 Admin MFA 的前提，D-120），开启 secret scanning 与 push protection，`main` 分支保护。验证：`gh api` 输出。前置：用户授权修改组织设置（DOR B-4）。覆盖：SC-12、SC-14。
- [ ] **M0-4** 本地一键环境 `docker compose up`（Postgres 16 + MinIO）加 `pnpm dev`，README 写明步骤。验证：在干净机器上按步骤跑一遍。

### M1 Core：标识符、canonical、digest、schema

- [ ] **M1-1** 标识符语法与解析（namespace / name / label / fragment_id / creation_ref / local_ref / full_ref），含所有边界用例。验证：表驱动单元测试。依据：canonical-model §2、D-115。
- [ ] **M1-2** Canonical Model 的 zod schema 覆盖 canonical-model §3～§13 的全部类型，包括 v0 只有模型的类型；导出 JSON Schema 到 `spec/schema/`。验证：单元测试 + schema 快照审阅。覆盖：SC-1。
- [ ] **M1-3** canonicalize：NFC、行尾归一、省略默认值、JCS；`fragment.digest` 与 `semantic_digest` 按 canonical-model §14 计算；输出 `sha256:<hex>`。验证：单元测试 + fast-check 性质测试（键序、缩进、默认值、NFC 等价输入得到相同 digest）。覆盖：SC-2。
- [x] **M1-4** `char check` 规则：未知占位符、`{{{{` 转义、只能 override `stable: true` 的 target、各类型的最小要求（§3.1）、必需 slot。验证：单元测试。覆盖：SC-4 的一部分。

### M2 Core：Resolver、Context IR、发布校验、Diff、Contribution 合并

- [ ] **M2-1** Resolver → Context IR：early binding、params、select、override 及其优先级、instance_key、participant / late slot 的 key、排序规则（IR §6.1）、EffectiveMeta 汇总（rating 取最大值、license、attribution）、graph.removed、diagnostics。验证：一致性测试集中的 Resolver 用例做字节级比对。覆盖：SC-2、SC-3、SC-13。
- [ ] **M2-2** 发布校验 §12.1 的 9 条规则，另加 `blocked_digests`；每条规则都有反例。验证：单元测试 + 一致性测试集中的 publish 用例。覆盖：SC-4、UC-12、UC-7 反例。
- [x] **M2-3** Context Diff（IR §13）：added / removed / modified 字段、origin_changes、meta_changes，rating 或 license 变化要打上高亮标记。验证：单元测试。覆盖：SC-7、UC-3。
- [x] **M2-4** Contribution 三方合并（canonical-model §13）：按键比较，服务端计算 `sensitive`，已应用的变更跳过，冲突时报出冲突对象，同一个 Contribution 内不允许重复的键，AssetSlot 与其 variant 的变更视为同一个键。验证：表驱动测试 + 幂等性质测试。覆盖：SC-6、UC-5。
- [ ] **M2-5** 一致性测试集：IR §15 的 13 个用例加 9 个发布反例，在 Node、浏览器和 workerd 三种运行时中全部通过，且输出字节一致。验证：`pnpm test:conformance`。覆盖：SC-2、SC-3。

### M3 CCv3 与 Assembler

- [x] **M3-1** CCv3 / PNG 导入（canonical-model §15）：包括 ID 稳定性判定、`stable: false` 的派生临时 ID 与碰撞处理、只记录 policy 字段名、Import Report。验证：单元测试 + 样本集 + fuzz。覆盖：SC-8、UC-2。
- [ ] **M3-2** CCv3 导出与 Loss Report（IR §14），以及 `extensions.char_pub`。验证：往返用例（一致性测试集用例 10）。覆盖：SC-8。
- [ ] **M3-3** 参考 Assembler：locale 回退、late binding、visibility（narrator 与 per-agent）、activation（always / keyword / semantic 降级 / manual）、budget（pinned 超出预算时报错，不截断 fragment）、Session Overlay、Trace。验证：一致性测试集的 Assembler 用例（只比较 decision / reason）。覆盖：SC-3、SC-7。
- [x] **M3-4** 浏览器端 token 估算：结果注明使用的 tokenizer；只是估算时标记 `estimated: true`。验证：单元测试。覆盖：SC-7。

### M4 服务端基础

- [x] **M4-1** 数据库 schema 与迁移（architecture §5）：应用使用非 owner 角色；`audit_log` 对应用只有 INSERT / SELECT 权限。验证：集成测试（UPDATE / DELETE 被拒）。覆盖：SC-12。
- [ ] **M4-2** Better Auth：GitHub / Discord / Google 登录；`__Host-` cookie；Origin 白名单；封禁后立即吊销全部会话和 Token；个人 Token（只存哈希，带 scope）。验证：集成测试。覆盖：SC-9、SC-12。
- [ ] **M4-3** 集中式授权 `authorize()`，并用 lint 规则保证每个路由都经过它；自动生成越权测试矩阵（他人资源、匿名访问 → 404 / 403）。验证：安全测试。覆盖：SC-9、UC-7。
- [x] **M4-4** CAS 存储层：写入前重算哈希；按 public / private 分桶；只签发短期 URL；worker 负责把对象复制到 public 桶。验证：集成测试（MinIO）。覆盖：SC-9。
- [x] **M4-5** pg-boss 任务：业务写入与入队在同一事务内（或采用 outbox）；任务幂等（`singletonKey`）；失败重试与死信。验证：集成测试（中途失败时两边都不落库或都落库）。
- [ ] **M4-6** 源站校验中间件、安全响应头、请求体上限、应用内限流（存储在 Postgres）、kill switch 中间件。验证：集成测试。覆盖：SC-15、UC-10。

### M5 Registry 功能

- [x] **M5-1** Namespace：注册、保留名、改名后旧名永久重定向且不可被重新注册。验证：集成测试。覆盖：UC-11。
- [x] **M5-2** Creation 草稿（乐观锁）→ Revision → Release 发布（带 Idempotency-Key；同一 label 相同内容幂等、不同内容返回 409）→ 写入 lock、reverse_edges、release_fragments、blob_refs。验证：集成测试。覆盖：SC-1、SC-4、UC-1。
- [x] **M5-3** 读取与下载 API：tombstoned 返回 410 和原因；yanked 返回 warning；public IR 跳转到 CDN；private 需要鉴权，否则 404；CCv3 lazy build（202 + Retry-After）。验证：集成测试。覆盖：SC-5、SC-9、UC-1。
- [x] **M5-4** 搜索（D-088 / V-8 方案）：mature 过滤在服务端强制；CJK 查询可用，包括一到两个字的查询。验证：集成测试 + 中文、日文样例。覆盖：SC-13、UC-6。
- [x] **M5-5** yank 与 tombstone 级联：预览影响范围、在一个事务中改状态、删除副本、清除 CDN 缓存（本地用替身）、`blocked_digests` 阻止重新发布。验证：集成测试（A → B → C 依赖链）。覆盖：SC-5、UC-8。

### M6 上传管线与 Contribution

- [x] **M6-1** 上传状态机：按 magic bytes 识别类型、像素和大小上限、剥离 EXIF、转 webp 和缩略图、拒绝 SVG 和 polyglot 文件；只有 `ready` 可被引用。验证：集成测试 + 恶意样本集。覆盖：SC-11、UC-9。
- [x] **M6-2** `CsamScanner` 接口：v0 默认 `noop` 实现（记录“未扫描”，D-121）；命中路径（quarantined、锁定账号、证据写入 evidence 桶、创建事件）用测试替身验证；员工手动标记 CSAM 也走同一条路径；存量补扫任务就位。验证：集成测试。PhotoDNA 的真实接入在审核通过后完成（DOR X-9，不阻塞 v0）。覆盖：SC-11、UC-9。
- [x] **M6-3** Native → Native Contribution 的完整 API：按 contribution_policy 授权、访客提交、`agent: true` 标记与过滤、限流、接受时重新校验 License 与 `rights_ack`、写入 provenance / contributors。验证：集成测试。覆盖：SC-6、UC-5、UC-10。

### M7 GitHub Source、CLI 与 Action

- [ ] **M7-1** GitHub App 的 webhook：验签、按 delivery 去重、入队；Source Binding 按数字 ID 绑定；定期对账。验证：集成测试（用录制的 payload）。覆盖：SC-10。
- [ ] **M7-2** OIDC 发布（security §4.4 的 10 条清单）：校验 iss / aud / 签名 / exp / jti / event_name，commit 必须等于 `sha`；按 `repository_id` + `repository_owner_id` + ref 匹配 binding；未安装 App 时拒绝（D-117）；Registry 在该 commit 重新读取源码并重算 digest。验证：本地 JWKS 表驱动测试，覆盖改名劫持、`pull_request_target`、重放、摘要不一致等反例。覆盖：SC-10、UC-4。
- [ ] **M7-2b** 仓库 transfer 后 binding 冻结（D-118）：冻结期间发布被拒并通知作者；作者确认后可以重新绑定或换用新仓库；全程写审计。验证：集成测试（用录制的 `repository.transferred` payload 和对账场景）。覆盖：SC-10、UC-4。
- [x] **M7-3** `char` CLI：init / check --fix（生成稳定 ID 并写回）/ build / preview / login（个人 Token）/ publish。验证：CLI 集成测试。覆盖：SC-1。
- [ ] **M7-4** `char-pub/publish` Action：在 staging 上用一个真实测试仓库完成一次发布。验证：Action 运行记录 + Registry 查询。前置：DOR B-3。覆盖：UC-4。

### M8 前端

- [ ] **M8-1** Web：浏览与搜索（默认隐藏 mature，开启时需要确认）、作品页（effective rating 与来源说明、依赖、反向依赖、attribution）、账号设置。验证：Playwright 测试。覆盖：SC-13、UC-6。
- [ ] **M8-2** Native 编辑器（Character / World / Lorebook，渐进式展示）、CCv3 导入向导（展示 Import Report）、发布流程（展示 Publish Report）。验证：Playwright 测试。覆盖：UC-1、UC-2。
- [ ] **M8-3** Context Preview（在浏览器中运行 Assembler，展示 Trace 解释）与 Context Diff；页面标注所用 tokenizer 或估算。验证：Playwright 测试 + 人工审阅。覆盖：SC-7、UC-3。
- [ ] **M8-4** Contribution 审阅界面：冲突标记；敏感变更单独确认（不能一键全部接受）。验证：Playwright 测试。覆盖：SC-6、UC-5。
- [ ] **M8-5** Admin SPA：[admin.md §6](../../design/admin.md#6-admin-功能清单v0) 的全部模块。验证：Playwright 测试 + 权限矩阵测试。覆盖：SC-12。

### M9 Admin 后端、安全加固与部署

- [ ] **M9-1** admin 进程：只挂载 admin 路由；校验 Access JWT；员工会话与角色（MFA 由 Access 与组织 2FA 保证，D-120）；四眼确认；哈希链审计与校验工具。验证：集成测试（角色矩阵自动生成用例）+ 在公开 api 上访问 admin 路由返回 404。覆盖：SC-12、UC-8、UC-10。
- [ ] **M9-2** 部署 staging（Railway 的 staging environment、Workers Static Assets、R2 staging 桶、Access、WAF、Transform Rule、Turnstile，以及 Cloudflare CSAM Scanning Tool），冒烟测试通过。验证：`scripts/smoke.ts` 输出。前置：DOR B-1、B-5、B-6。覆盖：SC-15。
- [ ] **M9-3** 边缘防护核验：直接访问源站（不经 Cloudflare）被拒；admin-api 不经 Access 被拒；限流生效。验证：curl 记录。覆盖：SC-15、T15。
- [ ] **M9-4** 开启 Railway Postgres 备份，并完成一次恢复演练（把备份恢复到一个新实例，比对行数和样本数据）。验证：演练记录。前置：DOR B-1。覆盖：SC-15、UC-13。
- [ ] **M9-5** Runbooks：密钥轮换、CSAM 命中、DMCA 处理、数据泄露、DoS / kill switch、数据库恢复、break-glass。验证：人工审阅。
- [ ] **M9-6** 部署 production，冒烟测试通过。验证：冒烟测试输出。前置：用户确认上线。覆盖：G-6。

### M10 内容与收尾

- [ ] **M10-1** `@commons` 种子库：20～50 个 World / Lorebook，许可清晰（CC0 / CC-BY），全部通过发布校验；至少被一个示例 Character 引用。验证：Registry 查询 + 人工审阅。前置：DOR B-7（内容来源）。覆盖：SC-17。
- [ ] **M10-2** npm 发布 `@char-pub/core` / `ccv3` / `assembler` / `cli`（使用 trusted publishing 并附 provenance）。验证：npm 页面显示 provenance。前置：DOR B-8。

## End-to-end acceptance

- [ ] **E2E-1**（UC-1、UC-6、UC-13 除外的前端流程）在 staging 上：新用户用 GitHub 登录 → 创建 Level 0 Character → 发布 1.0.0 → 匿名访问作品页，下载 IR 与 CCv3（附 Loss Report）。验证：Playwright 测试 + 人工走查。
- [ ] **E2E-2**（UC-2）上传一张合成 CCv3 PNG → 导入草稿并查看 Import Report → 发布 → 导出，并比对 Loss Report。验证：Playwright 测试。
- [ ] **E2E-3**（UC-3、UC-12）创建 World（intrinsic）+ Lorebook（keyword），由 Character 引用 → 查看 Preview 的解释 → 升级依赖 → 查看 Diff；构造菱形依赖，发布失败。验证：Playwright 测试 + 人工审阅 Preview。
- [ ] **E2E-4**（UC-4）测试仓库安装 App → 绑定 → Action 发布成功 → 仓库改名后，由另一个 owner 新建的同名仓库发布被拒 → 把测试仓库 transfer 到另一个账号，发布被冻结，作者确认后恢复。验证：staging 联调记录。
- [ ] **E2E-5**（UC-5、UC-10）第二个账号提交 Contribution → 作者修改另一个 fragment → 自动 rebase 并接受；构造冲突；敏感变更需要单独确认；`agent: true` 的提交可被过滤；超过限流后被拒。验证：Playwright 测试。
- [ ] **E2E-6**（UC-7、UC-9）发布 private Release → 另一个账号访问得到 404 → public 依赖 private 被拒；上传带 GPS 信息的图片，结果不含元数据；员工手动标记一张测试图片为 CSAM，走完隔离、证据保全和事件流程（不使用真实 CSAM 素材）。验证：集成测试 + staging 记录。
- [ ] **E2E-7**（UC-8、UC-10、UC-11）员工通过 Access 登录（未加入 char-pub 组织的账号被拒）→ 对 A → B → C 依赖链中 C 的 fragment 执行 tombstone → CDN 返回 404、resolve 返回 410、审计日志完整 → 切换 kill switch 后 5 秒内生效 → 注册 `@commons` 被拒。验证：staging 演练记录。
- [ ] **E2E-8**（UC-13）从 Railway 备份恢复出数据库并完成数据比对。验证：演练记录（与 M9-4 相同）。

## Coverage

| VISION | 验收条目 |
|---|---|
| SC-1 | M1-2、M5-2、M7-3、E2E-1、E2E-2、E2E-4 |
| SC-2 | M1-3、M2-1、M2-5 |
| SC-3 | M2-1、M2-5、M3-3 |
| SC-4 | M1-4、M2-2、M5-2 |
| SC-5 | M5-3、M5-5、E2E-7 |
| SC-6 | M2-4、M6-3、M8-4、E2E-5 |
| SC-7 | M2-3、M3-3、M3-4、M8-3、E2E-3 |
| SC-8 | M3-1、M3-2、E2E-2 |
| SC-9 | M4-2、M4-3、M4-4、M5-3、E2E-6 |
| SC-10 | M7-1、M7-2、M7-2b、E2E-4 |
| SC-11 | M6-1、M6-2、E2E-6 |
| SC-12 | M4-1、M4-2、M8-5、M9-1、E2E-7 |
| SC-13 | M2-1、M5-4、M8-1 |
| SC-14 | M0-2、M0-3、G-4 |
| SC-15 | M4-6、M9-2、M9-3、M9-4、G-6 |
| SC-16 | G-2 |
| SC-17 | M10-1 |
| UC-1 | M5-2、M5-3、M8-2、E2E-1 |
| UC-2 | M3-1、M8-2、E2E-2 |
| UC-3 | M2-3、M8-3、E2E-3 |
| UC-4 | M7-2、M7-2b、M7-4、E2E-4 |
| UC-5 | M2-4、M6-3、M8-4、E2E-5 |
| UC-6 | M5-4、M8-1 |
| UC-7 | M2-2、M4-3、E2E-6 |
| UC-8 | M5-5、M9-1、E2E-7 |
| UC-9 | M6-1、M6-2、E2E-6 |
| UC-10 | M4-6、M6-3、M9-1、E2E-5、E2E-7 |
| UC-11 | M5-1、E2E-7 |
| UC-12 | M2-2、E2E-3 |
| UC-13 | M9-4、E2E-8 |
