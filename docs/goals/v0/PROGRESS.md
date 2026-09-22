# PROGRESS（执行记录）

## Current state

- Goal：按 `DECISIONS.md` 与 `spec/` 从头实现 char.pub v0，包括成熟选型、架构、安全、admin 控制和单元测试（2026-09-22 用户提出）。用户已通过 `/goal` 授权持续执行 LOOP，并允许用 subagent / workflow 加速。
- Package：`docs/goals/v0/`
- Status：**实现中（M0 本地完成，M1 进行中）**。只做了本地 commit，没有 push（force push 覆盖 `char-pub/char` 需要用户单独确认，B-10）。
- Current work：
  - 主会话：core Resolver → Context IR（M2-1）与发布校验（M2-2）。
  - 并行 subagent（各自在独立 worktree，完成后合并）：core check 规则 + JSON Schema 导出（M1-4、M1-2）；Contribution 合并 + Context Diff（M2-4、M2-3）；`packages/ccv3`（M3-1、M3-2）；`packages/assembler`（M3-3、M3-4）；`apps/server` 数据库 / CAS / 队列（M4-1、M4-4、M4-5）。
- Acceptance：DOD 条目尚未打勾。M0-1 / M0-2 本地检查已通过，但验收要求 CI 运行记录，需等首次推送后才能取得（依赖 B-10）。
- Blockers：见 [DOR § Blockers](DOR.md#blockers)。本地开发不受影响。
- Next useful work：合并 subagent 结果 → Resolver 与一致性测试集（M2-5，需要人工审阅预期输出）→ server 的 Auth / authz / API（M4-2、M4-3、M5）。

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
