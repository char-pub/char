# PROGRESS（执行记录）

## Current state

- Goal：按 `DECISIONS.md` 与 `spec/` 从头实现 char.pub v0，包括成熟选型、架构、安全、admin 控制和单元测试（2026-09-22 用户提出）。当前阶段只做 DoR 与初步准备，不写业务代码（D-116）。
- Package：`docs/goals/v0/`
- Status：**DoR 已完成，Q-1～Q-6 均已回答**。还没有写任何代码，也没有 commit。
- Current work：DoR 文档包（VISION / DOR / DOD / LOOP / PROGRESS）和 `docs/design/`（architecture / security / admin / testing）已经写好。
- Acceptance：DOD 条目全部未勾选（还没有开始实现）。
- Blockers：见 [DOR § Blockers](DOR.md#blockers)。剩下的阻塞项都属于部署、推送或外部账号，**不阻塞 M0～M8 的本地开发**。
- Next useful work：
  1. 用户确认可以开始实现。
  2. 开始 M0：monorepo 骨架、CI 和安全基线，在本地提交。
  3. 接着做 M1、M2（core 与一致性测试集），这部分风险最高，而且完全不依赖外部资源。

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

