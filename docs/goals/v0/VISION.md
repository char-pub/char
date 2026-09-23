# Vision：char.pub v0

> 目标包：`docs/goals/v0/`。规范依据：[`DECISIONS.md`](../../../DECISIONS.md)（v0.2，D-001～D-101，以及 2026-09-22 追加的 D-110 起）、[`spec/canonical-model.md`](../../../spec/canonical-model.md)、[`spec/context-ir-v0.md`](../../../spec/context-ir-v0.md)。
> 设计文档：[架构](../../design/architecture.md) · [安全](../../design/security.md) · [Admin 控制](../../design/admin.md) · [测试策略](../../design/testing.md)。

## Goal

char.pub 是面向 AI 创作（Character、World、Lorebook……）的开放 Registry、协作网络和互操作层（D-003）。

现在的 RP 创作被锁在各个聊天平台里：作品不能引用别的作品，也不能锁定版本、接受他人贡献，或在任意 Runtime 中运行。v0 要用一个可上线、可审计的实现证明三件事（D-100）：

1. **Open Creation**：通过 Native Web 编辑、CCv3 / PNG 导入和 GitHub 仓库三种入口，都能得到同一种 Canonical Creation。
2. **Composition**：Reference Edge、early binding 和稳定的 Fragment ID 能真正完成 resolve，并锁定成不可变 Release。
3. **Open Context**：输出 Context IR v0-draft，配套 CCv3 Exporter 和 Loss Report、浏览器参考 Assembler、Context Preview 与 Context Diff。

面向的用户（D-001、D-002）：

- 不懂 Git 的普通创作者：用 Web 编辑器创作，或导入 CCv3。
- 技术型作者和 Agent：用 GitHub、CLI、Action 和 API。
- Runtime 开发者：不登录就能下载 Public Release 的 IR 和 Asset。
- 运营与审核人员：在 Admin 后台处理举报、法律下架和滥用。

## Outcome and scope

v0 完成后应存在以下成果：

| 编号 | 成果 | 依据 |
|---|---|---|
| O1 | `@char-pub/core`：同一份代码可在 Node、浏览器和 Cloudflare Workers 中运行。包含 Canonical Model schema、标识符语法、canonicalization 与 digest、发布校验、Resolver → Context IR、Context Diff、Contribution 三方合并、参考 Assembler 与 Trace、CCv3 导入/导出与 Loss Report | D-020～D-062，spec 全文 |
| O2 | 公共一致性测试集 `spec/conformance/`：覆盖 context-ir §15 的 13 个首批用例；Resolver 用例做字节级比对 | D-054，IR §15 |
| O3 | Registry 后端（Railway）：`api`、`worker`、`admin` 三个进程共用一个镜像，数据在 Postgres，内容进 R2 CAS。提供账号、Namespace、Creation 草稿与 Revision、Release 发布与三态、resolve / 下载、搜索、反向依赖、Native → Native Contribution、上传管线、个人 Token | D-080～D-090，D-042～D-046，D-067 |
| O4 | GitHub Source：只读 GitHub App、Source Binding（按数字 ID 绑定）、Webhook + 对账、`char` CLI，以及通过 OIDC 发布的 `char-pub/publish` Action | D-070～D-074 |
| O5 | Web（www.char.pub，Vite + React SPA）：浏览 / 搜索（默认隐藏 mature）、作品页、Native 编辑器（Character / World / Lorebook）、CCv3 导入、发布、Context Preview / Diff、Contribution 审阅、账号设置 | D-002，D-011，D-057，D-100 |
| O6 | Admin（admin.char.pub）：受 Cloudflare Access（GitHub 组织成员 + 组织强制 2FA）和应用内角色保护，提供举报队列、法律下架（tombstone 级联）、用户处置、Namespace 治理、kill switch、任务面板和审计日志 | D-011，D-042，D-082，D-110 起 |
| O7 | 运维：一个线上主站（production），不设 staging；上线前的验证依靠 CI 全量回归、本地一键环境与全栈 E2E。Cloudflare 边缘防护，启用 Railway Postgres 备份并完成恢复演练，CI 安全门禁 | D-086，D-087，D-111 |
| O8 | `@commons` 种子库：20～50 个高质量的 World / Lorebook | D-100 |

Creator UI 对 v0 未开放的类型只保留模型：Relationship、Scenario、Persona、Style、Preset 的数据模型与 Resolver 行为在 v0 就要存在，并通过一致性用例验证，但不提供创作界面（D-101）。

## Non-goals

- 好感度、RPG 数值、战斗、Workflow Engine、自主 Agent Framework、自建 Git 托管、聊天平台（D-004、D-055）。
- char.pub 作为 OAuth / OIDC Provider（D-089 Deferred）；Runtime Registry、`Open in` 深链、Launch Intent（D-058 不属于 v0 必做）。
- GitHub PR 的索引与展示，以及 Native → GitHub 的 patch / `char contrib apply`（v0.5，D-067）。
- Preset 的 Canonical 结构（O-7，v0.5）；v0 的 Assembler 使用默认 layout。
- 语义搜索、Meilisearch / Typesense、Redis（D-085、D-088）。
- 付费和 Mirrored 模式收费（V-3）。
- 可执行扩展（类似 Stage / Trigger 的代码插件）：它与声明式 Creation 属于不同的信任域，不在 v0 范围内。
- 真实第三方 Runtime 消费者（例如 SillyTavern 扩展）：用于日后冻结 IR，不阻塞 v0-draft（D-054、D-058）。

## Success criteria

| ID | 可观测结果 | 可证明它的证据 |
|---|---|---|
| SC-1 | Native、CCv3 导入、GitHub 三种入口得到的 Creation 都通过同一套 Canonical schema 校验，并能发布为 Release | 集成测试 + 主站手工流程 |
| SC-2 | 相同 Release、lock 和 Resolver 版本在 Node、浏览器和 Workers 中生成**字节一致**的 Context IR；只改格式（缩进、键序、行尾）不改变 `semantic_digest` | 一致性测试集在三种运行时中通过；property-based 测试 |
| SC-3 | 13 个一致性用例全部通过，覆盖 binding、override、菱形依赖、yanked / tombstoned、locale、visibility、budget、CCv3 往返、多路径实例、late slot、public 依赖 private 等场景 | `pnpm test:conformance` |
| SC-4 | 发布校验 §12.1 的 9 条规则都能强制执行；每条规则至少有一个被拒绝的反例 | core 单元测试 + API 集成测试 |
| SC-5 | Release 三态行为符合 D-042：tombstone 能级联删除所有可分发副本并清除 CDN 缓存；解析遇到 tombstoned 时返回明确错误和原因 | 集成测试 + 主站演练 |
| SC-6 | Native → Native Contribution 按 canonical-model §13 合并：未冲突的变更自动 rebase，冲突被标出；敏感 metadata 必须单独确认；贡献者写入 provenance | 表驱动单元测试 + E2E |
| SC-7 | 用户能在浏览器中看到 Context Preview（附 Trace 解释）和 Context Diff；token 数注明所用 tokenizer，只是估算时明确标注 | E2E + 人工验收 |
| SC-8 | CCv3 导出附带 Loss Report；`system_prompt` / `post_history_instructions` 不进入 Creation / IR，Import Report 中有记录 | 单元测试 + 往返用例 |
| SC-9 | 私有内容不会泄露：未授权请求一律返回 404；public 桶里只有 Public Release 引用的对象；IR 中不含签名 URL；public Release 不能依赖 private Release | 安全集成测试 |
| SC-10 | GitHub 发布防 repojacking：OIDC 声明必须匹配绑定的 `repository_id` / `repository_owner_id` 和允许的 ref；Registry 自行读取源码并重算 digest | 集成测试（本地签发 JWKS）+ 主站联调 |
| SC-11 | 上传管线：只有 `ready` 状态的对象能被引用；EXIF / GPS 已剥离；非法类型、像素炸弹、多格式混合文件（polyglot）被拒绝；`CsamScanner` 接口就位（PhotoDNA 接入前是 noop，D-121），public CDN 开启 Cloudflare CSAM 被动扫描，隔离 / 证据保全 / 报告流程可用 | 集成测试 + 人工核验 |
| SC-12 | Admin 行动（下架、封禁、强制评级、Namespace 处置、kill switch）只有通过 Cloudflare Access 且具备相应角色的员工能执行；每次行动都在同一事务内写入追加型审计日志 | 权限矩阵测试 + 主站演练 |
| SC-13 | mature / explicit 内容默认隐藏，用户主动开启后才可见；effective rating 取依赖闭包与 Asset 中的最大值，并解释来源 | 单元测试 + E2E |
| SC-14 | 公开仓库安全基线：仓库中无密钥（gitleaks 与 push protection 通过）；CI 包含 CodeQL、依赖审查，Action 用 SHA 固定；只读默认权限；主分支受保护 | CI 记录 + 仓库设置截图 / API 输出 |
| SC-15 | 运维：主站各域名可访问；Railway Postgres 备份已启用，且完成一次恢复演练；源站只接受经 Cloudflare 转发的流量 | 演练记录 + 命令输出 |
| SC-16 | 测试门禁：core 行覆盖率 ≥ 90%、server ≥ 80%；安全关键模块（authz、OIDC、webhook、canonical、merge）分支覆盖率 ≥ 95%；CI 全绿 | CI 覆盖率报告 |
| SC-17 | `@commons` 发布 20～50 个 World / Lorebook，全部许可清晰，且被至少一个示例 Character 引用 | Registry 查询 + 人工审阅 |

## User cases

| ID | 起点 → 动作 → 期望结果 |
|---|---|
| UC-1 | 不懂 Git 的创作者登录后，只填名字、简介、开场白和头像 → 发布 `1.0.0` → 作品页公开可见；访客不登录也能下载 IR 和 CCv3 |
| UC-2 | 用户上传一张 CCv3 PNG → 得到 Creation 草稿和 Import Report：lorebook 条目在没有持久 ID 时标记为 `stable: false`，`system_prompt` 只记录字段名 → 再导出 CCv3 时附带 Loss Report |
| UC-3 | 作者让 Character 依赖一个 intrinsic 的 World 和一个 keyword 触发的 Lorebook → 发布 → Preview 能解释每个 fragment 为什么加载、来自哪条依赖、被谁覆盖；依赖升级后，Diff 列出 fragment 与 token 的变化 |
| UC-4 | 技术作者安装 GitHub App 并绑定仓库，在 CI 中运行 `char-pub/publish` → 通过 OIDC 发布成功。**反例**：原仓库改名后，别人新建的同名仓库发布被拒；没装 App 的仓库发布被拒；仓库 transfer 后发布被冻结，作者确认重新绑定或换用新仓库后才恢复 |
| UC-5 | 贡献者对某个 fragment 提交 Contribution；作者期间修改了另一个 fragment → 自动 rebase 并接受。**反例**：双方改了同一个 fragment → 标记冲突；改 rating / license 的变更必须单独确认 |
| UC-6 | 一个 general Character 依赖 mature World → effective rating 变为 mature → 默认搜索中不可见；用户在设置中开启后可见，页面说明评级来源 |
| UC-7 | 作者发布 private Release → 只有授权用户能获得短期 URL；其他人无论猜 digest 还是访问 API 都只得到 404。**反例**：public Release 依赖 private Release 被拒 |
| UC-8 | 收到 DMCA 通知 → admin 通过 Access 后，对侵权 fragment 执行 tombstone → 所有包含它的 Release 进入 tombstoned，副本被删除、CDN 缓存失效；依赖方 resolve 时得到带原因的错误；审计日志留有记录 |
| UC-9 | 上传一张含 GPS EXIF 的图片 → 生成的 webp 已无元数据。**反例**：图片被判定为 CSAM（Cloudflare 被动扫描命中、举报，或接入 PhotoDNA 后的扫描命中）→ 内容进入隔离，证据被保全，账号锁定，按事件流程报告 |
| UC-10 | 有人批量提交垃圾 Contribution 或发布 → 被限流；作者可以过滤 `agent: true` 的提交并关闭 Contribution；admin 可以一键关闭上传、注册或发布（kill switch） |
| UC-11 | 有人注册保留名 `@commons` → 被拒；Namespace 改名后，旧名永久重定向且不能被他人注册 |
| UC-12 | 依赖图中出现同一 Creation 的两个 Release（菱形依赖）或 tombstoned 依赖 → 发布失败，错误解释来源路径 |
| UC-13 | 运营者从 Railway Postgres 备份恢复出一套数据库，数据与备份时刻一致 |
