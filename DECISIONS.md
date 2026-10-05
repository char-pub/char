# char.pub Architecture Decisions (v0.2)

本文件记录 char.pub 经过四轮 Review 后形成的架构决策。

- 规范细节见 [`spec/canonical-model.md`](spec/canonical-model.md) 与 [`spec/context-ir-v0.md`](spec/context-ir-v0.md)。
- 每条决策有稳定编号，后续修改只追加 `Superseded by D-xxx`，不重排编号。

状态约定：

| 状态 | 含义 |
|---|---|
| **Accepted** | 已拍板，编码可以依赖 |
| **Verify** | 方向已定，但依赖的外部事实（价格、限额、政策、第三方能力）尚未核实 |
| **Deferred** | 明确推迟，但数据模型需预留 |
| **Open** | 尚未决定 |

---

## 0. 一句话

> char.pub is an open registry, collaboration network and interoperability layer for AI creations.
> 对外：Characters, worlds and stories。对内：Creation。

> **GitHub 可以托管 Char，char.pub 可以发现 Char，Agent 可以理解 Char，Runtime 可以运行 Char，但没有任何一个平台拥有 Char。**

---

## 1. 产品与定位

### D-001 Creator First，Agent / Developer First-class — Accepted

产品入口优先普通创作者；协议、CLI、SDK 同时把 Agent 和开发者当作一等用户。
创作层使用 Character / World / Lore 等创作者语言；Module / Package / Resolver 等工程概念只出现在高级层（Progressive Disclosure）。

### D-002 入口优先级 — Accepted

```text
普通创作者      → Native（Web Creator）
现有生态        → CCv3 / PNG Import
技术作者 / Agent → GitHub / CLI / GitHub Action
```

GitHub 是 **first-class Source Provider，不是默认 authoring 入口**。Native Hosting 进入 v0。

### D-003 对外定位与对内定义分层 — Accepted

架构定义为“开放 AI 创作的 Registry、协作网络和互操作层”；对外叙事仍以 Character 为主。

### D-004 v0 明确不做 — Accepted

好感度 / RPG 属性 / 战斗系统；复杂 Workflow Engine；完整自主 Agent Framework；自建 Git Hosting；完整聊天平台；char.pub 作为 OIDC Provider（见 D-089）。

> 部分 Superseded：作者声明的剧情变量见 D-163；char.pub 作为 OAuth 授权服务器见 D-171。
底层模型不得阻止这些能力未来出现。

---

## 2. 内容政策

### D-010 Spec 中立，Registry 拥有 Policy — Accepted

Char Spec 只描述内容属性，不决定什么可以创作：

```yaml
rating: general | teen | mature | explicit
content_warnings: [violence, sexual-content, ...]
rights: ...        # 原创 / 同人 / 授权
license: ...       # SPDX / CC
provenance: ...
```

char.pub Registry 另有 Content Policy。其他 Registry 可以制定不同政策，格式不受影响。

### D-011 char.pub 允许合法成人虚构内容 — Accepted

- 默认隐藏 mature / explicit，需要用户主动开启。
- 硬边界：涉及未成年人的性内容、违法内容、侵权内容，不因 rating 字段而获得许可。
- 所有进入 char.pub 存储的图片必须经过 CSAM 扫描（D-084）。
- 必须在上线前具备 DMCA / 法律下架流程（D-042 tombstone）。

### D-012 GitHub 不能承载全部 RP 内容 — Verify

GitHub Acceptable Use Policy 限制色情内容（含文本）。因此成人内容必须能落在 Native / R2 Source。
待核实：GitHub AUP 原文措辞；Cloudflare 对合法成人内容的 ToS；支付渠道（Stripe 等）对成人内容的限制——后者会影响 Mirrored 模式收费。

---

## 3. 核心对象模型

### D-020 核心对象 — Accepted

```text
静态：Creation · Fragment · Reference Edge · Asset · Release · Contribution
运行：Session（Runtime 所有，char.pub 不托管）
```

- **Scenario 是一种 Creation**，没有第二种 Scenario。
- `Composition` 不再是一等对象，只作为动词（resolve / compose）或内部类型 `ResolvedScenario`。

### D-021 v0 开放的 Creation 类型 — Accepted

v0 开放：**Character、World、Lorebook**。
数据模型预留：Relationship、Scenario、Persona、Style、Preset（v0.5 开放）。

### D-022 Identity ≠ Location — Accepted

- 公共标识：`@namespace/name`，版本 `@namespace/name@label`。
- 内部标识：UUID。namespace 改名、Source 迁移不改变内部 identity。
- GitHub URL 不是 identity。

### D-023 Fragment ID 稳定性 — Accepted

所有可能被引用、覆盖、激活、隐藏、diff 的内容都是 Fragment，必须有 ID；长期可引用的 Fragment 还必须有稳定 ID（例：`@cyberpunk/night-city#lore/arasaka`）。
不以文件路径、数组 index、Markdown heading 作为长期 identity。

| Source | ID 来源 |
|---|---|
| Native / Web | 系统生成并持久化 |
| CLI / Git | 作者书写，或 `char check --fix` 生成并写回，由作者提交 |
| Legacy Import（CCv3 等） | 尽量保留源 ID |
| 无 ID 的只读导入 | 确定性派生临时 ID，`stable: false` |

**`stable: false` 的 Fragment 可以运行，但不能成为外部长期 Override Target。**

### D-024 Reference Edge — Accepted

Dependency 升级为 Reference Edge：

```yaml
use: "@commons/childhood-friend"
bind: { a: "#alice", b: { late: persona } }
params: { reunited_after: "10 years" }
mode: default          # intrinsic | default
select: [...]          # 选取部分 fragment（可选）
override: {...}        # fragment 级覆盖（可选）
```

图中只有两种边：

| 边 | 含义 | 是否参与 Resolve |
|---|---|---|
| `depends_on` | 运行时需要（由 Reference Edge 产生） | 是 |
| `derived_from` | 创作来源（Fork / Remix / Import） | 否 |

Fork、Remix 是产品操作，最终都只产生 `derived_from`。

### D-025 Slot 与两阶段 Binding — Accepted

Creation 可以声明 `slots`（带 `accepts` 类型约束）。Binding 分两阶段：

- **Early binding**：Resolver 绑定已知 Creation（`#alice`）。
- **Late binding**：Assembler 在 Session 开始时绑定（User / Persona）。

Context IR 必须允许存在未绑定（late）slot。

### D-026 params 只允许纯值替换 — Accepted

v0 文本插值只支持 `{{self}}`、`{{user}}`、`{{slot:<name>}}`、`{{param:<name>}}` 的纯值替换；Binding 可使用 `{{self}}` 与 Scenario 的 `{{cast:<key>}}`。不允许 if、loop、expression、script。Creation 是数据，不是程序。

> 剧情条件与效果作为另一种受限数据树的边界见 D-163；本条对文本模板的限制不变。

### D-027 intrinsic / default — Accepted

- `intrinsic`（UI：Core）：身份的一部分，例如 Geralt → Witcher World。
- `default`（UI：Recommended）：推荐值，Scenario 可以替换。

替换 intrinsic 不得静默成功，必须提示并二选一：`Create Remix` 或 `Force Override`。
Force Override 只允许在 Scenario 内进行，并在 provenance 中标记 `au: true`。

### D-028 两个 Override Stack，严格分离 — Accepted

```text
Creative Resolution（静态，Resolver，回答“什么是真的”）
  Creation → Edge Override → Scenario Override
        ↓
     Context IR（不可变）
        ↓
Session Overlay（动态，Assembler）
  Session State / Memory / Active Variant / Late Binding

Context Policy Resolution（回答“真相如何进入模型”）
  Creation Context Hint → Scenario Context Policy → Preset → Runtime Profile
```

- **Preset 永远不能修改 Creative Truth。**
- **Session 可以 Overlay IR，但不能修改 IR。** 运行状态永远不反写 Creation。

### D-029 单图单版本 — Accepted

一个 Resolved Graph 中，同一 Creation 只允许一个 Release。菱形依赖出现不同 Release 时报错并给出解释，不自动选择。

### D-030 Locale 变体独立于版本 — Accepted

同一 Creation 的多语言内容是 locale 变体，不是新版本，也不是 Remix。翻译不污染 provenance。

---

## 4. 版本与 Release

### D-040 版本号只是 label，锁定靠 digest — Accepted

- `1.2.0` 是作者给的 label，不承诺 SemVer 语义。
- v0 不支持 range（无 `^1.2`）。
- 依赖锁定 = `creation_id + release_id + semantic_digest`。
- 编辑态可 `follow: latest`；Publish 时必须解析为精确 Release。
- 升级价值由 **Context Diff** 表达（token 增减、fragment 增删改），而非版本号。

### D-041 双 digest + fragment 级 digest — Accepted（算法 Open）

| digest | 对象 | 用途 |
|---|---|---|
| `source_digest` | 原始 Source bytes | 完整性 |
| `semantic_digest` | canonical semantic model | Build Cache、Context Diff、Contribution、Release 比较 |
| fragment digest | 单个 Fragment 的 canonical 序列化 | 三方合并、CAS key |

格式改动（缩进、键序）不改变 semantic_digest。
Open：canonicalization 算法（候选：RFC 8785 JCS + Unicode NFC + 行尾归一）。

### D-042 Release 三态 — Accepted

```text
active ──→ yanked      内容仍可用；不建议新依赖
   └─────→ tombstoned  metadata / digest / edge 保留；payload 移除
yanked ──→ tombstoned  法律删除也适用于已 yank 的内容
```

- tombstoned 用于 DMCA、法律要求、严重政策违规、GDPR。
- 解析遇到 tombstoned 必须显式报错（含原因），不得静默跳过。
- yanked 不影响已锁定的依赖方。

### D-043 Public 只能依赖 Public，文本闭包入 Release — Accepted

- Public Release 只能依赖 Public Release。
- `Release.visibility: public | private` 记录发布时的可见性；本规则按 Release 而非当前 Draft 或 Creation 判断。
- Release 保存：自身文本 + **完整文本依赖闭包** + manifest + license / provenance + digests；Context IR 必须可从该快照、lock 与 Resolver 版本确定性生成，允许按需生成并缓存（D-056）。
- 借助 CAS（D-081），闭包存储按 fragment 去重，成本接近零。
- 这解决 left-pad 问题；代价是 char.pub 再分发依赖文本，因此 D-046 的许可检查是发布前置条件。

### D-044 Release 是 Registry 概念 — Accepted

- 同一 commit 可发布多个 Creation 的 Release（`char publish alice --version 1.2.0`）。
- Git tag 只是可选映射，不是数据模型。
- 同一 Creation 的同一 label 不可指向不同内容；重复发布拒绝。

### D-045 Asset 可用性分级 — Accepted

| Tier | 内容 | 策略 |
|---|---|---|
| 1 | Cover / Avatar 缩略图 | 必须 Mirror |
| 2 | Public Release 中 `role: context` 的 Asset | 默认 Mirror |
| 3 | Gallery / 大媒体 | linked / cached / mirrored，由作者与 Registry 策略决定 |

Release 标注 `availability: complete | linked`。
**Linked = integrity guaranteed, availability best-effort.**

### D-046 License — Accepted

- 使用 SPDX 表达式与 Creative Commons，不自创许可证。
- Code / Creation / Asset License 分别声明；同一 Creation 内 Asset 可有独立 License。
- `char check` 与发布流程检查：Creation 和 Asset 的许可兼容性（如依赖 NC 却声明可商用）、文本与镜像 Asset 是否允许再分发（D-043 前提）。
- Dependency Graph 保留 attribution。

---

## 5. Resolver / Context IR / Assembler

### D-050 Compiler 拆为两层，Context IR 是核心开放标准 — Accepted

```text
Creation Graph → Resolver/Linker（确定性，可缓存）→ Context IR
──────────────────── Runtime Boundary ────────────────────
Context IR + Preset + Runtime Profile + Session → Assembler（每轮）→ Model Messages
```

- 不再笼统使用 “Context Compiler” 一词。
- **Context IR 是比 `char.yaml` 更重要的开放标准。** 冻结顺序：Canonical Model → Reference Edge → Context IR → `char.yaml`。
- `char.yaml` 只是 Canonical Model 的一种 authoring syntax。

### D-051 Assembler 输入契约 — Accepted

```text
Assembler Input = Context IR + Resolved Preset? + Runtime Profile + Session
```

Preset 可省略，此时使用 Runtime 的默认 layout。IR 中的 `placement` 只是 **hint**；最终进入 system / user / before-history / after-history 由 Preset 与 Runtime 决定。

### D-052 Greeting 属于 Session Bootstrap — Accepted

Greeting / Alternate Greeting 不是 Context Fragment，而是 IR 中独立的 `bootstrap` 段：负责创建 Session 的初始消息。

### D-053 Runtime Mode 与 Visibility — Accepted

Runtime Profile 声明 `mode: narrator | per-agent`。

- `per-agent`：visibility 可以作为隔离边界。
- `narrator`：visibility 只是“扮演某角色时不应使用此信息”的提示，**不是 security boundary**。Spec 必须明确写出。
- 作者写的静态 private lore 属于 Creation；运行时产生的 private memory 属于 Session。

### D-054 IR “冻结”标准 — Accepted

IR 在拥有**两个独立消费者实现**之前保持 `v0-draft`：

1. CCv3 Exporter（有损 Assembler）
2. 一个真实 Runtime（首选 SillyTavern 扩展）

### D-055 聊天流量不经过 char.pub — Accepted

Assembler 存在于 Runtime SDK、第三方 Runtime、浏览器 Playground 中，不是 char.pub 后端服务。
char.pub 只承担 Search、Resolve Release、下载 IR、下载 Asset。

### D-056 导出与 Lazy Build — Accepted

- 导出 CCv3 必须附带 **Loss Report**（被展平的依赖、丢弃的 fragment、不支持的 slot / visibility）。
- 构建产物按需生成并缓存：`key = semantic_digest + lock_digest + target + compiler_version`。

### D-057 Token 计数依赖 tokenizer — Accepted

Context Preview 必须指定目标 tokenizer / 模型；缺省时显示估算值并标注。服务端不运行重型 tokenizer，Preview 优先在浏览器 / CLI 计算。

### D-058 Runtime 接入范围 — Accepted

v0 交付可下载的 Context IR、CCv3 Exporter 与浏览器参考 Assembler / Preview。真实第三方 Runtime 消费者用于验证 IR 冻结条件（D-054），不阻塞 v0-draft 发布；`Open in` 深链、Runtime 注册与专用扩展不进入 v0 必做范围。GitHub Action 使用 OIDC **向 char.pub 发布**（D-074），与 char.pub 作为第三方 OAuth / OIDC Provider（D-089，Deferred）是不同能力。

> 部分 Superseded by D-172（“开始游玩”入口）与 D-171（OAuth 授权服务器）。

---

## 6. Contribution

### D-060 Contribution 是 Change Proposal — Accepted

- Contribution 不是 Creation；目标是**改进你的作品**，结果仍是原 Creation 的新 Release。
- Remix 是**创造我的作品**，产生新 Creation + `derived_from`。

### D-061 变更类型 — Accepted

`fragment`（add / modify / remove）、`edge`（use / bind / params 增删改）、`asset`（slot / variant 增删改）、`metadata`。
**rating、license、content_warnings 的变更必须单独高亮，不得与普通 diff 一并接受。**

### D-062 Fragment 级三方合并 — Accepted

```text
逐个 change 比较稳定对象 ID / 字段路径的 base_digest 与当前 digest：
未被其他人改动 → 自动 rebase；两边改动同一对象 → Conflict
```

Fragment 使用 fragment digest；edge、asset、metadata 也各有 canonical 值 digest。v0 不做 fragment 内文本三方合并；add / remove / 已应用的判定见 canonical-model §13。

### D-063 Canonical 层统一，传输层允许不对称 — Accepted

| 贡献者 → 目标 | 传输 |
|---|---|
| Native → Native | char.pub 内部 |
| GitHub → GitHub | GitHub PR（char.pub 索引展示） |
| Native → GitHub | 保存为 Native Contribution；接受后提供 patch / `char contrib apply <id>`，作者自己提交 |

未来用户主动开启写权限集成后，可自动开 PR。

### D-064 贡献权利 — Accepted

- 默认 inbound = outbound：贡献内容按目标 Creation 的 License 授权，提交时明示。
- 目标为 All Rights Reserved 时，需要贡献者显式授权确认。
- Contributor 进入 Release attribution 与 provenance。

### D-065 防滥用 — Accepted

- 作者设置开放度：所有人（含经验证访客）/ 登录用户 / 邀请 / 关闭。
- Agent 提交的 Contribution 必须标记 `agent: true`，可单独过滤。
- 按账号、访客来源与 namespace 限流。

### D-066 Native 不实现 Git — Accepted

Native 只需要 Draft、Revision History、Release、Contribution。不做 branch / commit DAG / merge-base。

### D-067 Contribution 的 v0 范围 — Accepted

- 数据模型 v0 冻结。
- v0 实现 Native → Native。
- Native → GitHub 的 patch / CLI 交付及 GitHub PR 索引与展示：v0.5（Deferred）；D-063 定义目标传输语义，不代表 v0 全部实现。

---

## 7. GitHub 集成

### D-070 GitHub App 最小权限 — Accepted

v0：`Metadata: Read`、`Contents: Read`。v0.5 增加 `Pull requests: Read`。
写权限作为单独、用户主动开启的 integration，不并入基础 App。

### D-071 按数字 ID 绑定 — Accepted

Source Binding 与 OIDC 发布校验一律使用 `repository_id` / `repository_owner_id`。`owner/repo` 名称只用于展示。防止改名后同名仓库被抢注劫持发布（repojacking）。

### D-072 Webhook + 对账 — Accepted

订阅 `push`、`repository`、`installation_repositories`。Webhook 可能丢失，需要周期性 reconciliation。默认追踪 default branch，可配置。

### D-073 不保存临时 URL — Accepted

保存 `provider + repository_id + commit + path + digest`，需要时由 Source Adapter 动态 resolve；不保存 `download_url`。

### D-074 Publish Action + OIDC — Accepted

`char-pub/publish` Action 在 Source 端完成 check / resolve / build，通过 GitHub OIDC（audience = char.pub）换取短期发布权限。Build at Source, Index at Registry。用户无需保存长期 Secret。

---

## 8. 基础设施

> **Cloudflare serves the commons; Railway runs the registry; R2 preserves the artifacts.**

### D-080 Cloudflare Edge + Railway Core + R2 Blob — Accepted

D1 不作为核心数据库（单库容量上限与串行执行不适合集中式 Registry 图模型）。

```text
www.char.pub     Cloudflare Pages / Workers
api.char.pub     Railway（经 Cloudflare 代理，D-086）
assets.char.pub  Cloudflare R2 + CDN
```

### D-081 Postgres = State，R2 = Content，Content-addressed — Accepted

- Postgres：users、namespaces、creations、fragments（元数据）、edges、releases、contributions、source_bindings、asset metadata、social、jobs。
- R2：Release Snapshot、依赖文本闭包、Context IR、导入 / 生成的 CCv3、Assets。
- R2 对象 key 为内容哈希：`cas/sha256/<2>/<digest>`。**Fragment 的 CAS key 即其 fragment digest**，不维护第二套哈希。

### D-082 blob 反向引用与 tombstone 级联 — Accepted

Postgres 维护 `blob_refs(digest → release_id)`：每个 Release 对其闭包中的 fragment digest，以及包含内容的 Snapshot、IR、导出物和源上传对象 digest 都建立反向引用。删除一个 fragment 时先查出所有关联 Release，再清理这些 Release 的全部可分发产物。

- `blob_refs` 必须覆盖 fragment、Release Snapshot、IR、导出产物及其共享依赖，不能只记录 Release 的直接对象。某 payload 因法律原因删除时，所有包含或引用它的 Release 同步进入 tombstoned；删除其所有可分发副本并失效 CDN 缓存，不得出现内容静默消失或仍可从旧产物取得的 Release。
- 无引用 blob 由 GC 回收。

### D-083 Public / Private 分桶 — Accepted

- `public` 桶：仅 Public Release 引用的对象，CDN 直出。
- `private` 桶：仅经 API 签发的短期 URL 访问。

防止通过猜测或泄露 digest 读取私有内容、或探测内容是否存在。Private → Public 发布时由 worker 复制对象。

### D-084 上传管线 — Accepted

浏览器 presigned PUT 直传 R2，不经 API 转发。上传对象状态：`uploaded → processing → ready | rejected`，只有 `ready` 可被 Release 引用。processing 必须包含：

1. **剥离 EXIF**（防 GPS 等隐私泄露）
2. 转码（webp）与缩略图
3. CSAM 扫描（候选：Cloudflare CSAM Scanning Tool — Verify）

### D-085 Monolith + Worker + Postgres，无 Redis — Accepted

```text
Railway Project
├── api      Auth / Registry / Creation / Contribution / GitHub / Release / Search
├── worker   Import / GitHub Sync / Resolve / Build / Asset 处理 / 索引
└── postgres
```

- 任务队列使用现成的 Postgres 队列库（pg-boss 一类），不自写重试 / 退避 / 死信。
- 业务写入与 outbox 事件同事务。
- 服务间走 Railway 私有网络。

### D-086 api.char.pub 经 Cloudflare 代理 — Accepted

DNS 开启 Proxied 回源 Railway，获得 DDoS、WAF、Rate Limiting、Turnstile 校验。不使用 Worker 转发全部 API。
Worker 只做适合 Edge 的事：OG 图、重定向、短链、下载重定向、公开 resolve 缓存（后期）。

### D-087 可迁移性 — Accepted

只依赖标准 Docker 镜像与标准 Postgres；不依赖 Railway 专有功能。每日 `pg_dump` 至 R2（异供应商备份）。

> 备份部分 Superseded by D-111（2026-09-22）：v0 不做每日 `pg_dump` 至 R2，改用 Railway Postgres 自带备份。可迁移性要求不变。

### D-088 搜索 v0 留在 Postgres — Accepted（CJK Verify）

v0 基于 Postgres 做 name / description / tags / author / type 搜索。中日文分词需验证（`pg_trgm` 或应用层分词）。Meilisearch / Typesense / 语义搜索推迟。

### D-089 Auth — Accepted（Better Auth 能力 Verify）

- Better Auth + Postgres；首批 GitHub、Discord、Google，Email Magic Link 可选。
- 内部 `user.id = UUID`；外部身份表 `(user_id, provider, provider_subject)`。
- Better Auth 是实现，不是 Spec；更换 IdP 不改变内部 user ID。
- char.pub 作为 OAuth / OIDC Provider（“Sign in with char.pub”）：**Deferred**。Superseded by D-171。

### D-090 反向依赖物化 — Accepted

被依赖关系在发布时写入物化表（`reverse_edges`），“谁用了 Night City”不做实时递归查询。

---

## 9. v0 范围

### D-100 v0 证明三件事 — Accepted

| 核心 | v0 要证明 |
|---|---|
| **Open Creation** | Native / CCv3 Import / GitHub 都能成为 Creation |
| **Composition** | Reference Edge + early binding + Fragment ID 能真正 resolve，并锁定为 Release |
| **Open Context** | 输出 Context IR v0-draft；CCv3 Exporter、浏览器参考 Assembler、Context Preview + Context Diff；真实 Runtime 消费者用于后续冻结验证 |

另含：小规模高质量 `@commons` 种子库（20–50 个 World / Lorebook）；Style 待该类型在 v0.5 开放后加入。

### D-101 模型先行，功能后开 — Accepted

以下能力 v0 不对创作者开放，但**数据模型必须在 v0 存在**；相关一致性用例可先验证模型与 Resolver，不代表对应的创作者 UI 已上线：
`slots`、late binding、`params`、override、visibility、Relationship / Scenario / Persona / Style / Preset 类型。Contribution 的 Native → Native 流程按 D-067 在 v0 开放，其余传输路径推迟。

---

## 10. 待核实（Verify）清单

| # | 事项 | 影响 |
|---|---|---|
| V-1 | GitHub AUP 对色情文本的原文限制 | D-012 |
| V-2 | Cloudflare（R2 / CDN）对合法成人内容的 ToS | D-011、D-080 |
| V-3 | Stripe 等支付渠道对成人内容的政策 | Mirrored 收费 |
| V-4 | R2 价格与免费额度、egress 政策 | 成本模型 |
| V-5 | Railway 套餐价格、Volume 上限、Postgres HA / PITR | D-080、D-087 |
| V-6 | Better Auth 的 Postgres 与作为 OAuth 客户端登录的支持；Provider 插件留待 Deferred 阶段核实 | D-089 |
| V-7 | GitHub App 读取来自 fork 的 PR head 所需权限 | D-067（v0.5） |
| V-8 | Postgres 中日文搜索方案 | D-088 |
| V-9 | Cloudflare CSAM Scanning Tool 对 R2 / 自定义管线的适用性 | D-084 |

## 11. 待决定（Open）清单

| # | 事项 |
|---|---|
| O-1 | canonicalization 算法（D-041） |
| O-2 | Fragment ID 与 Creation 名称的字符集 / 语法（见 canonical-model §2） |
| O-3 | Namespace 治理：抢注、GitHub 改名、组织转让、保留名（`@commons` 等） |
| O-4 | Registry Content Policy 正文 |
| O-5 | `char.yaml` authoring syntax（在 IR 之后冻结） |
| O-6 | 第二个 IR 消费者的最终选择 |
| O-7 | Preset 的最小 Canonical 结构与参考组装由 D-159 定义；独立模块、发布 UI 与完整运行搭配锁定延后 |

---

## 12. 实现决策（2026-09-22 追加）

以下决策来自实现前的准备讨论，不改变前面的规范语义，只约束实现方式。

### D-110 仓库、可见性与 License — Accepted

- GitHub 组织：`char-pub`。v0 monorepo 使用 `char-pub/char`，按本文档从头实现，覆盖该仓库原有的早期原型（覆盖需要 force push，执行前由用户再次确认）。
- 除特别敏感的数据外，所有仓库一律 public。因此密钥不进 git，安全设计假设攻击者掌握全部源码。
- License：代码使用 Apache-2.0；规范正文与一致性测试集使用 CC-BY-4.0。

### D-111 v0 数据库备份使用 Railway 自带功能 — Accepted

v0 只启用 Railway Postgres 自带的备份功能，不做每日 `pg_dump` 至 R2 的异供应商备份，原因是成本。等有真实用户和预算后再重新评估异供应商备份。D-087 中“只依赖标准 Postgres、可以随时手动 `pg_dump` 迁出”的要求保持不变。

### D-112 前端形态 — Accepted

`www.char.pub` 与 `admin.char.pub` 都是 Vite + React SPA，部署在 Cloudflare Pages。OG 图、短链等需要 SEO 或服务端渲染的能力由边缘 Worker 负责（D-086）。

> 部署方式 Superseded by D-119（2026-09-22）：改用 Workers Static Assets。

### D-113 Admin 隔离 — Accepted

Admin 使用独立的子域（`admin.char.pub` + `admin-api.char.pub`）和独立的 `admin` 进程，公开的 `api` 进程不挂载任何 admin 路由。防护分三层：Cloudflare Access、应用内员工会话 + 角色、强制 TOTP 2FA。当前设计见 [Admin 权限边界](llmdoc/operations/admin-authority.mdx)。

> 2FA 部分 Superseded by D-120（2026-09-22）：v0 的多因素认证由 Cloudflare Access 负责，应用内不做 TOTP。

### D-114 Staging 域名 — Accepted

staging 使用 `char.pub` 的一级子域（`staging.char.pub`、`staging-api.char.pub` 等），好让 Universal SSL 证书直接覆盖。环境之间靠 host-only cookie、严格的 Origin 白名单和互相独立的凭证隔离。

### D-115 O-1 / O-2 的实现取值 — Accepted（规范仍为 v0-draft）

实现按草案的倾向取值：canonicalization 使用 RFC 8785 JCS + Unicode NFC + 行尾统一为 `\n`（canonical-model §14）；`namespace` / `name` 只允许 ASCII slug，另设 `display_name` 支持任意 Unicode（canonical-model §2.1）。这些取值在 IR 冻结（D-054）前仍可修改，修改时必须同步更新一致性测试集。

### D-116 先完成 DoR，再写代码 — Accepted

实现开始前，愿景、就绪条件、验收标准、执行循环、进度记录与架构、安全、Admin、测试设计必须就绪，由用户确认后才进入编码。

> 2026-09-24 文档迁移：原启动文档和进度证据保留在 Git 历史；持续有效的设计进入 `llmdoc/`，验收门槛见 [发布就绪与人工验收](llmdoc/engineering/release-readiness.mdx)。本条保留最初启动阶段的决策，不要求后续改动重建旧文档目录。


### D-117 OIDC 发布必须先安装 GitHub App — Accepted

通过 GitHub Action（OIDC）发布的仓库，必须已经安装 char.pub GitHub App 并完成 Source Binding。Registry 用 installation token 在 OIDC `sha` claim 对应的 commit 上重新读取源文件并重算 digest，与请求不一致时拒绝发布；不采信 Action 上报的摘要（D-074 “Build at Source, Index at Registry” 的补充）。

OIDC 的信任边界：token 只能证明“绑定的仓库在允许的 ref 和事件上运行了某个 workflow”，不能证明运行的是 `char-pub/publish`。服务端校验约束见 [GitHub 来源与发布信任链](llmdoc/source/github-source-and-publish.mdx)：`aud` 固定为 `https://api.char.pub`；`event_name` 只允许 `push` / `workflow_dispatch` / `release`，拒绝 `pull_request_target`；`jti` 一次性；请求的 commit 必须等于 `sha`。另外修正一处事实：GitHub OIDC token **包含** `sha` claim（2026-09-22 核实）。

### D-118 仓库转移后冻结 Binding，等作者确认 — Accepted

收到 `repository.transferred` 事件，或者对账时发现 `repository_owner_id` 与 binding 不一致：

1. binding 进入 `frozen` 状态，该 binding 的一切发布（OIDC 与 webhook 同步）被拒绝，返回 `binding.frozen`，并通知 Creation 的 namespace owner。
2. 作者在 char.pub 上确认后，二选一：
   - **重新绑定**：接受新的 owner，binding 的 `repository_owner_id` 更新为新值，恢复 active；
   - **换用新仓库**：解除当前 binding，绑定另一个仓库（按新仓库的数字 ID 重新建立 binding）。
3. 作者不确认，binding 就一直保持 frozen。已发布的 Release 不受影响。每次状态变化都写入审计日志。

仓库改名（`repository.renamed`）只更新展示用的名称，不冻结（D-071）。

### D-119 前端部署使用 Workers Static Assets — Accepted

`www` 与 `admin` 两个 SPA 用 Cloudflare Workers Static Assets 部署（SPA fallback），不用 Pages。这是 Cloudflare 目前推荐新项目采用的方式，也便于和 OG 图、短链等边缘逻辑放进同一个 Worker。

### D-120 v0 的 Admin 多因素认证交给 Cloudflare Access — Accepted

初期管理员很少，v0 不在应用内实现 TOTP / passkey step-up。

- Cloudflare Access 的策略要求：登录方式为 GitHub，并且是 `char-pub` 组织成员（或在员工允许名单中）；`char-pub` 组织开启“强制成员 2FA”。这样 MFA 由 GitHub 保证。
- admin 进程仍然要校验 `Cf-Access-Jwt-Assertion`（签名、aud、iss、email）并检查应用内角色，不信任未经 Access 的请求。
- 敏感操作靠 Access 会话时长（8 小时）加操作理由和审计日志约束，不再要求应用内重新验证。
- 创作者账号不强制 2FA。管理员数量增加，或者出现安全事件时，重新评估是否恢复应用内 step-up。

### D-121 PhotoDNA 接入前，图片上传不做公开前扫描 — Accepted（临时）

PhotoDNA Cloud Service 审核通过之前，上传的图片在 EXIF 剥离、转码和类型 / 大小检查通过后，直接进入 `ready`，可以公开，不等 CSAM 扫描。美国法不要求服务商主动扫描（18 U.S.C. 2258A(f)），但知情后必须报告并保全证据。为此同时要求：

1. `assets.char.pub` 所在的 zone 开启 Cloudflare CSAM Scanning Tool，作为被动检测；命中通知邮件要有人负责接收。
2. 举报入口、隔离（quarantine）、证据保全（security §7.4）和 NCMEC 报告流程在上线前就要可用。
3. 上传管线保留 `CsamScanner` 接口，默认实现为 `noop`（记录“未扫描”）。PhotoDNA 审核通过后切换过去，并对所有存量图片补扫一遍。
4. 尽快提交 PhotoDNA 申请。

### D-122 合规基线：美国 + 欧盟 — Accepted（运营主体待定）

v0 按美国与欧盟的要求设计：DMCA 下架与反通知、18 U.S.C. 2258A（经 REPORT Act 修订）、GDPR，以及 EU DSA 对托管服务的 notice-and-action、处置理由说明、联系方式等基本要求。运营主体（个人还是公司，注册在哪里）以后再定，定下来之后要复核这条决策。

### D-123 CCv3 解析自己实现，不依赖 Character Foundry — Accepted

CCv3 / PNG 的容器解析、映射、导出和 Loss Report 都自己实现，依据 kwaroran `SPEC_V3.md`。PNG chunk 读写、zip 等底层工作用成熟的小库。Character Foundry 可以作为实现参考，但不作为依赖：它是单人维护，normalizer 会把数组下标写成 id（与 D-023 冲突），PNG 导出也默认不写 `ccv3` chunk。

### D-124 Railway 部署位置 — Accepted

char.pub 的 Railway project 建在 `Hushed Chat` workspace 下（用户确认是 Pro 套餐）。D-111 的原生备份依赖 Pro 套餐，第一次部署时要确认备份和 PITR 选项确实可用。


### D-125 本地开发统一使用 pnpm — Accepted

2026-09-22 用户要求：本地开发一律使用 pnpm（依赖安装、脚本运行、workspace 管理），CI 同样使用 pnpm。版本由根 `package.json#packageManager` 锁定，仓库只提交 `pnpm-lock.yaml`，不提交 `package-lock.json` / `yarn.lock`。

### D-126 semantic_digest 中的 fragment 列表保留声明顺序 — Accepted（规范修正，待用户复核）

canonical-model §14 原文写 `fragment_digests: sorted[(id, digest)]`。但 Context IR 规定“同一 Creation 内保持 canonical 中的 fragment 顺序”，Build Cache 的 key 又是 `semantic_digest + lock_digest + …`。如果排序，只调换 fragment 顺序会得到相同的 semantic_digest，却生成不同的 IR，缓存会返回错误结果。

实现取值：manifest 中的 `fragment_digests` 是按**声明顺序**排列的 `[id, digest]` 列表。调换 fragment 顺序会改变 semantic_digest（它确实改变了 IR）。fragment ID 在 Creation 内唯一，所以列表仍然没有歧义。spec 已同步修改；一致性用例按此编写。

### D-127 内部 ID 的外部编码使用 TypeID — Accepted

内部 ID 的载荷是 UUIDv7（数据库列类型 `uuid`），API 与 Canonical JSON 中使用 TypeID 编码：`<prefix>_<26 位 Crockford base32>`，例如 `cr_01h455vb4pex5vsknk084sn02q`。前缀：`ns`、`cr`、`rel`、`rev`、`usr`、`ctb`、`upl`。TypeID 是公开规范（jetify-com/typeid），有成熟的多语言实现；core 只校验格式，ID 由调用方生成后传入。

### D-128 GitHub 数字 ID 在 JSON 中用十进制字符串 — Accepted

GitHub 的 `repository_id`、`repository_owner_id` 等在 OIDC claim 中本来就是字符串，数值可能超过 JSON 安全整数范围。Canonical JSON、IR 与 API 中统一用十进制字符串（`"123456"`），数据库中用 `bigint`。这落实了 DOR F-1 对 spec 类型的修正。

### D-129 `char check` 与 Resolver 的规范细化 — Accepted（实现取值，待用户复核）

实现时对规范中没有写明的细节做了如下取值。它们在 IR 冻结前都可以修改，修改时同步更新一致性用例。

1. **`{{self}}` 的范围**：模板文本和 binding 中的 `{{self}}` 只能出现在 character / persona 类型的 Creation 里，其他类型报错。override 替换进来的内容在**被引用** Creation 的语境中渲染，所以替换 Lorebook 条目的文本里不能写 `{{self}}`。
2. **`force: true`**：只能出现在 Scenario 中。对 `default` 依赖的 replace / remove 不需要 force；对 `intrinsic` 依赖中 world / character 类 fragment 的 replace / remove 必须在 Scenario 内并带 force，结果标记 AU。
3. **根实例的 slot**：直接发布 Relationship 这类模板时没有 edge 可以绑定，它的 slot 全部作为 late slot 出现在 IR 中。非根实例上未绑定的必需 slot 报错；可选 slot 变成 late slot，只在被内容使用时才变成必需。
4. **early binding 的目标必须在依赖图中**：`bind: { a: "@x/y" }` 要求 `@x/y` 也被某条 edge 引用并 pin 住，这样它的内容和版本是锁定的，否则报 `resolve.binding_not_in_graph`。
5. **locale 变体的 `activation_keys`** 并入 keyword 激活的关键词列表，这样用任何语言聊天都能触发。
6. **IR 中的 asset**：闭包中每个实例的所有 asset（包括 presentation）都进入 `IR.assets`，因为头像、封面需要展示；只有 `role: context` 的 asset 可以被 fragment 引用。
7. **scene visibility 不写 scene 时**，IR 中记为 `instance:<instance-key>`，表示“只在这个引用实例的场景中”。
8. **License 兼容性（近似判断，不是法律意见）**：依赖 NC 而自身允许商用 → warn；修改了 ND 依赖 → fail；依赖 All-Rights-Reserved 且不是同一权利人 → fail；修改了 SA 依赖但用了不同许可 → warn；不认识的 `LicenseRef-*` → warn。OR 表达式取对使用者最有利的一项，AND 取最严格的一项。
9. **模板转义**：连续的 `{` 按 4 个一组还原为字面量 `{{`，剩余 1 个是字面量 `{`，2 个开始占位符，3 个是字面量 `{` 加占位符。这样 `{{{self}}` 之类相邻写法也没有歧义。

### D-130 Contribution 合并与 Context Diff 的细化 — Accepted（实现取值，待用户复核）

1. **拒绝空变更和“设为默认值”的 set**：after 与 base 相同的变更，以及把字段设成默认值的 set（例如 `contribution_policy: signed-in`、空 tags），判为不合法。canonical 形式会省略默认值，这类变更重放时既不等于 base 也不等于 after，会被误判为冲突、破坏幂等性。要清空字段必须用 `unset`。
2. **敏感范围扩到 asset**：新值里有 variant 单独声明 license 或 rating 的 asset 变更也标记为敏感，必须单独确认。这比规范原文（只列 metadata 的 rating / license / content_warnings）更严格。
3. **显式授权**：目标 license 表达式中只要出现 `LicenseRef-*`（包括保留所有权利），贡献者就必须显式授权（`rights_ack.explicit_grant`）。
4. **有冲突就不产出结果**：一个 Contribution 只要有一个冲突，合并结果为空，不能生成新 Revision；各变更的状态照常返回，供 UI 标注。给不存在的 slot 添加 variant 视为冲突。
5. **Diff 的 lock_changes**：IR 只有 lock 的 digest，所以由调用方传入两边的 lock（含 label）；不传时按 `graph.nodes` 的 Release ID 比较，显示 Release ID。
6. **token_delta**：`always` 统计 always 激活或 pinned 的 fragment；`potential` 统计全部 fragment（关键词全部命中、semantic 与 manual 都启用时的上界）。只按 default locale 计算。

### D-131 参考 Assembler 的实现取值 — Accepted（实现取值，待用户复核）

参考 Assembler 只需满足 Assembler 契约的语义要求，以下是它在规范没有写明处的取值。第三方 Runtime 可以做不同选择。

1. **locale 回退**：每个 fragment 在 Trace 中只有一条记录；纳入但内容回退到 default locale 时 reason 为 `locale-fallback`。locale 按 BCP 47 lookup 匹配，不区分大小写。
2. **semantic 激活**：参考实现不做语义检索。Session 显式启用时按 manual 纳入（reason `manual`）；否则跳过，reason 为 `semantic`，与 `inactive` 区分。
3. **keyword 默认值**：扫描最近 2 条消息（与 SillyTavern World Info 默认值一致），logic 默认 any，默认不区分大小写，默认不要求整词。整词边界是 Unicode 字母、数字或下划线，因此中日文开启整词匹配后通常匹配不到。
4. **预算**：对话历史与 Session Overlay（绑定对象描述、memory、state、当前 variant）先从预算中扣除，它们总是纳入。
5. **late binding 检查**：绑定对象类型不在 accepts 中时报 `assemble.late_slot_kind_mismatch`；文本引用了未绑定的 optional slot 也报错，保证输出不残留占位符。
6. **scene 可见性**：只在 `session.scene` 匹配时纳入，不匹配时 reason 为 `visibility`。Session 因此多一个 `scene` 字段。
7. **图片**：只有 `role: context` 的资源作为附件交给模型；presentation 资源即使被引用也按 `unsupported-media` 处理。
8. **运行时能力**：`system_role: false` 时 system 内容改用 user 角色；`multiple_system_messages: false` 时合并成一条。
9. **默认文案**：narrator 模式下 private 内容的标注、示例对话 / memory 小节标题默认是英文，可通过参数替换。
10. **tokenizer**：不认识的 tokenizer 名退回估算，Trace 标注 `estimated: true`。

### D-132 `char.yaml` 的 v0 书写形式 — Accepted（O-5 的临时取值，IR 冻结后再定稿）

CLI 与 GitHub Source 需要一种文件格式，所以 v0 先采用最直接的形式：**`char.yaml` 就是 Canonical Creation 的 YAML 表示**，外加少量书写便利。这样不需要第二套 schema，`char check` 与 Registry 用同一套校验。

1. 文件内容解析为 YAML（只允许 JSON 兼容的子集：禁用自定义 tag、锚点合并键之外的别名展开设上限，防止“billion laughs”），然后按 Canonical Creation 校验。
2. 书写便利（由 CLI 在 canonicalize 之前展开，不进入 canonical 形式）：
   - 文本字段可以写 `./path.md`：以 `./` 开头、以 `.md` / `.txt` 结尾的字符串，读取同目录下的文件内容（路径不能跳出项目根目录）。
   - fragment 可以省略 `stable`，默认 `true`；省略 `id` 时由 `char check --fix` 生成稳定 ID 并写回文件。
   - `id`（内部 Creation ID）可以省略，由 Registry 在首次发布时分配；本地构建使用基于 ref 的确定性占位 ID。
3. 一个仓库可以有多个 Creation：`char.yaml` 可以放在任意子目录，CLI 用 `--path` 指定。
4. `char build` 的输出与 Registry 用同一个 Resolver，因此本地构建的 IR 与 Registry 生成的 IR 字节一致（占位 ID 除外）。

### D-133 数据库、队列与审计的实现取值 — Accepted

1. **三个 schema**：`app` 放业务表，`pgboss` 放任务队列，`migrations` 放迁移记录。应用角色对 `migrations` 没有任何权限。
2. **队列只由迁移创建**：应用角色不能新建或删除 pg-boss 队列（对 `queue`、`version` 表没有 INSERT / DELETE），应用启动时 pg-boss 设为 `migrate: false`。
3. **任务幂等**：队列使用 exclusive 策略加 `singletonKey` 去重；处理函数用 `runOnce(tx, key, …)` 把幂等记录（`job_effects` 表）和业务效果写在同一事务中，重复投递时直接跳过。重试 5 次、指数退避（5 秒起，最长 600 秒），耗尽后进入 `<queue>.dead`。
4. **审计哈希链**：用事务级 advisory lock 串行追加；`hash = sha256(JCS({prev_hash, at, actor, action, subject, request_id, ip_hash, before, after}))`，即 prev_hash 放在被哈希的对象里。security 设计文档中的 `prev_hash ‖ JCS(本条)` 写法据此统一。
5. **R2 兼容**：S3 客户端设 `requestChecksumCalculation / responseChecksumValidation = WHEN_REQUIRED`（R2 不支持 SDK 默认附加的 CRC 校验头），完整性由我们自己的 sha256 保证。签名 PUT 把 Content-Length 与 Content-Type 纳入签名。
6. **GitHub 数字 ID**：数据库用 `bigint`，服务端代码用 JS `bigint`，JSON 中用十进制字符串（D-128）。webhook payload 里超过安全整数范围的 ID 直接拒绝，不用丢了精度的值匹配。
7. **auth_user**：迁移直接建 `app.auth_user`（Better Auth user 表加 admin 插件字段），其他表外键指向它；接入 Better Auth 时用字段映射复用。
8. **测试隔离**：集成测试整轮只起一套容器，迁移做在模板库里，每个测试文件用 `CREATE DATABASE … TEMPLATE` 复制独立的库并行运行。

### D-134 GitHub OIDC 与 webhook 的实现取值 — Accepted

1. **jti** 保留到 exp 之后再加 60 秒；只有全部检查通过后才占用 jti，所以被拒绝的请求不会消耗它。
2. **publish_refs 模式**：只支持精确匹配与尾部 `/*`，模式必须以 `refs/` 开头。
3. **可选的 binding 约束**：`require_ref_protected`、`environment`、`job_workflow_ref`（要求官方 reusable workflow）。`source_bindings` 表需要对应的列。
4. **检查顺序**：先比对 `repository_id` + `repository_owner_id`（不一致报 `binding.mismatch`），再看 binding 是否 frozen（报 `binding.frozen`）。
5. **webhook**：用 `@octokit/webhooks-methods` 验签（官方包、零依赖、常量时间比较，支持轮换期间新旧 secret 并存）；body 先按严格 UTF-8 解码，保证与原始字节一致。签名缺失或无效返回 401；未订阅的事件在验签通过后返回 2xx 并忽略，避免 GitHub 重试。

### D-135 CCv3 导入导出的实现取值 — Accepted（第 1 条由 D-150 确认）

1. **导入卡片的默认权利声明（用户已确认保持现状，见 D-150）**：导入时 license 默认为 `LicenseRef-All-Rights-Reserved`（最保守）。`rights` 在 schema 中没有“未知”取值，目前临时填 `original`，并把 license / rights / rating 三项列入 Import Report 的 `needs_confirmation`，由导入向导要求用户确认。**未确认前服务端拒绝发布**（发布路由检查 Import Report 的待确认项）。备选方案是在 schema 的 `rights` 中增加 `unknown`，这属于规范变更，需要用户决定。
2. **`{{self}}` 在导出中的写法**：IR 中 `{{self}}` 已被 Resolver 替换为角色名，所以导出的正文里是名字；只有对话中的说话人会还原成 `{{char}}`。CCv3 的“随角色名变化”效果因此丢失，Loss Report 不单独列出这一项（它不改变含义）。
3. **semantic / manual 激活**：导出时丢弃并记入 Loss Report（规范允许降级为 always、keyword 或丢弃，丢弃最不会改变作品含义）。
4. **secondary key 逻辑**：按 SillyTavern 的 `selectiveLogic` 映射，0 → `any`，3 → `all`；1 和 2（NOT 语义）无法表达，secondary 被丢弃并记入报告。
5. **导入降级**：`use_regex` 与没有 key 的条目改为 manual；`enabled: false` 改为 manual（不丢弃）；`@@activate` → always，`@@dont_activate` → manual。
6. **多段 `mes_example`**：拆成 `examples/1..n`，编号依赖段落顺序，所以 `stable: false`；只有一段时是稳定的 `examples`。
7. **未知宏**（如 `{{random:…}}`）：导入时转义为字面量并记入报告，导出时原样还原。
8. **不做网络 IO**：远程 URL 资源不下载，报告中标注未导入；`user_icon` 不导入（属于用户的 persona）。PNG 头像交给上传管线前已去掉 tEXt / EXIF，`system_prompt` 原值不会随图片流出。
9. **conformance 与 Assembler 的 Resolver 修正**：可选且未被使用的 late slot 不进入 IR 时，它对应的 participant 也不再出现（一致性用例 012b 发现，已修复）。

### D-136 Better Auth 集成的实现取值 — Accepted

1. **不启用 Better Auth 的 admin 插件**：它会在公开 API 上挂出冒充用户、改角色、删除用户等接口，与“公开 api 进程不挂载任何管理功能”相冲突。封禁由服务端的 `banUser` 完成（同一事务内标记封禁、删除全部会话、吊销全部个人 Token、写审计），另用 session 创建钩子阻止已封禁用户建立新会话；封禁到期后自动恢复。这取代了 DOR 中“用 admin 插件管理封禁字段”的写法。
2. **`__Host-` cookie**：Better Auth 只会自动加 `__Secure-` 前缀，所以关闭自动前缀，把 `__Host-charpub.` 直接写进 cookie 名字（会话 cookie 为 `__Host-charpub.session`），并强制 Secure、HttpOnly、SameSite=Lax、Path=/、无 Domain。
3. **登录限流**存在独立的 `auth_rate_limit` 表（Better Auth 的格式），与应用自己的 `rate_limits` 分开。客户端 IP 取 `cf-connecting-ip`。
4. **不启用密码登录**；~~自动关联账号要求本地邮箱已验证~~（被 D-148 第 1 条取代：不做隐式关联）；OAuth token 加密入库；显式开启 Origin 与 CSRF 检查（Better Auth 在测试环境默认跳过）。
5. **数据最小化**：session 的 ip_address 列保留但不写入。
6. user id 使用 UUIDv7（`advanced.database.generateId`）。

### D-137 读取、搜索、上传、下架与部署形态的实现取值 — Accepted

读取与搜索：
1. **Release 地址**：规范路径是 `/v1/creations/@ns/name/releases/:label`；`@ns/name@label` 以 308 重定向过去。改名后 GET 请求 301 到新地址并保留路径后缀；写接口不跟随改名，直接 404。
2. **公众可见**：只算发布任务已完成（`publish_state = done`）的 Release；Creation 只要有一个 public 且未 tombstoned 的 Release 就对公众可见。
3. **缓存**：公开读接口 `public, max-age=60, s-maxage=300`；IR 与导出物的重定向永久缓存（immutable）；私有内容 `private, no-store`；搜索只缓存匿名请求，带 `Vary: Cookie, Authorization`。CCv3 导出缓存 key 为 `ccv3:ccv3-export@<版本>:<semantic_digest>:<lock_digest>`，导出实现变化时递增版本号。
4. **搜索**：一到两个字的 CJK 查询用应用层 unigram / bigram 数组 + GIN，三个字及以上用 pg_trgm；查询先做 NFKC 归一（半角假名可以命中全角）；LIKE 通配符转义。mature / explicit 需要用户开启并记录确认时间，两者缺一仍然隐藏。

下架（tombstone）：
5. **停止分发的对象**：受影响 Release 的快照、IR、导出物，加上被下架对象本身；整体下架一个 Release 或 Creation 时还包括它直接引用的 fragment 与 asset。仍被未受影响的 Release 引用的共享对象保留。
6. **黑名单**：下架 fragment / asset 时写它自己的 digest；整体下架时写直接受影响 Release 的 semantic digest。
7. **CSAM 处置后的下架**由 worker 自动执行：CSAM 路径入队下架请求，worker 按内容逐个执行 tombstone（执行者为系统账号，原因 `policy.minor_sexual`），再删除副本并清除 CDN 缓存。每个对象的操作 ID 由原操作 ID 确定性派生，重复投递安全。

上传与 CSAM：
8. **系统执行者账号**：自动处置记录的执行者是一个预置在 `auth_user` 中的系统账号（`SYSTEM_ACTOR_ID`），部署时创建。
9. **证据先于处置写入**：先把原件写入证据桶，再在一个事务中完成隔离、黑名单、处置记录、事件、审计、封禁与下架入队，提交后才删除可分发副本。事务失败时证据保留在桶里（宁可多保全）。证据保全期限在报告时由 legal 设为报告日加 1 年。
10. **错误码**：配额超限为 `rate_limited`（429，带 Retry-After）；命中黑名单统一返回 `upload.rejected`，不说明原因。

部署形态：
11. **一个镜像四个命令**：`api` / `admin` / `worker` / `migrate`，非 root 运行；production 缺少 `ORIGIN_AUTH_SECRET` 时进程拒绝启动。
12. **pg-boss 权限**：应用角色不能删除队列；只能向 `pgboss.queue` 插入迁移登记过的队列名（行级安全策略），因为 pg-boss 的调度器每次启动都会调用 `create_queue`；可以更新 `pgboss.version` 那一行（调度器记录 cron 时间）。pg-boss 的后台错误只记录，不会让进程崩溃。

### D-138 Registry 写路径的实现取值 — Accepted

1. **新建草稿的默认值**：`license: LicenseRef-All-Rights-Reserved`、`rating: general`、`default_locale: en`。在作者选择之前取最保守的许可：作者本人可以发布，别人不能再分发。
2. **服务端强制字段**：草稿里的 `id`、`ref`、`type` 由服务端填写，客户端提交的值被覆盖。`ref` 跟随 namespace 的当前名字。
3. **Idempotency-Key**：在同一 Creation 内唯一；同一个 key 用于不同的 label 或 revision 返回 422 `request.idempotency_key_reused`。失败的发布释放 label（唯一约束只作用于未失败的 Release）。
4. **发布开关关闭时**：已入队的发布任务推迟（不失败、不消耗重试次数），Release 保持 pending；worker 每 5 分钟检查一次，开关恢复后重新入队。
5. **存储格式**：Revision 的每个 fragment 以“去掉 digest 字段的 fragment 的 JCS”存储，key 就是 fragment digest；manifest 的 key 就是 semantic digest。Release 快照为 `JCS({ snapshot_version: 1, root, dependencies: [{ release, ref, semantic_digest, creation }] })`，dependencies 按 ref 排序、包含完整闭包，不含可变状态。
6. **反向依赖**：`reverse_edges` 只记录直接依赖；传递依赖在 `release_locks` 与 `release_fragments` 中。
7. **同一权利人**：被发布 Creation 所在的 namespace，加上发布者所属的全部 namespace。
8. **依赖快照已被删除时**（例如 tombstone 后清理了副本），发布直接失败，报 `publish.tombstoned_dependency` 或 `publish.dependency_unavailable`。
9. **namespace 数量**：v0 每个账号一个个人 namespace；内置保留名约 35 个，与 `reserved_names` 表合并检查。
10. **搜索列**在发布与 namespace 改名时于同一事务内刷新。

### D-139 admin 业务路由的实现取值 — Accepted

1. **admin 路由的能力声明**：一个路由可以声明多个可选能力（具备任一即可）；下架按原因代码决定所需能力（`legal.*` 需要法律下架权限，其余需要严重违规下架权限）；影响范围预览等只读的 POST 不要求理由；登记法律请求本身、手动标记 CSAM、确认四眼请求不要求关联法律请求。
2. **强制评级**：只能调高（否则 422 `admin.rating_can_only_increase`）；读取与搜索中的 effective rating 取发布时的值与强制评级中较高者，搜索过滤按它执行。它是 Registry 层的覆盖，不改变任何 Release 的 digest。
3. **四眼请求**：请求中保存确认所需的能力；确认与执行在同一事务里，执行失败则请求保持 pending；只有一名合格员工时，发起人在 24 小时冷静期后可以自己确认，审计中标记 `self_confirmed_after_cooling_off`；发起人可以取消自己的请求。
4. **CSAM 锁定的账号**不能被普通封禁覆盖（409），防止借“重新封禁再解封”绕过四眼。
5. **员工管理**：系统中至少保留一名 owner；员工不能封禁自己。
6. **法律请求**：申请人信息用 AES-256-GCM 在应用层加密（随机 12 字节 nonce），密钥为 `LEGAL_ENCRYPTION_KEY`；列表不返回申请人信息，每次查看详情写一条 `legal.view` 审计。
7. **死信任务重试**：把原任务数据重新投递到业务队列，再把死信任务标记为完成；普通失败任务用 pg-boss 的 retry。
8. **admin 列表响应**统一为 `{ items, next_cursor? }`；tombstone 预览中的下游作者以 `@namespace` 表示，不暴露邮箱。

### D-140 GitHub Source 与 OIDC 发布的实现取值 — Accepted

1. **通知**：v0 没有站内通知系统，需要通知作者的事件（仓库转移导致绑定冻结等）写一条 `binding.owner_notified` 审计记录，后续通知系统从审计中补发。
2. **可见性**：OIDC 主体可以看到它绑定的 Creation，即使该 Creation 还没有 public Release。
3. **Revision 来源**：由 GitHub 同步或 OIDC 发布产生的 Revision，`author_kind` 为 `source`。
4. **默认跟踪**：新绑定默认 `tracked_ref = refs/heads/main`，允许发布的 ref 为 `refs/heads/main` 与 `refs/tags/*`。
5. **状态码**：OIDC token 无效（签名、audience、过期）为 401 `oidc.*`；重放、事件类型不允许、commit 不在允许的 ref 上、绑定不存在或已冻结为 403；源文件内容问题（解析失败、digest 不一致）为 422。
6. **jti 的消耗时机**：token 与绑定都校验通过之后才写入 `oidc_jti`，避免无效请求占用 jti。
7. **可选发布约束**（要求 ref 受保护、指定 environment、指定 job workflow）在校验时生效，但 v0 不提供设置它们的 API。
8. **绑定的对外表示**不包含内部 ID，只有仓库的 GitHub 数字 ID、展示名、路径与 ref 配置。

### D-141 Contribution API 的实现取值 — Accepted

1. **访客提交**：访客需要 `guests.verified_at` 已设置才能提交；访客验证入口（Turnstile + 邮箱）尚未实现，测试中用仅测试环境生效的 `x-test-guest` 头模拟。
2. **可见性**：非成员看不到没有 public Release 的 Creation，也就不能对它提交 Contribution。
3. **限流先于校验**：先按账号或访客限流，再按目标 namespace 限流，然后才解析请求体。
4. **接受规则**：敏感变更必须逐项列出确认，不接受通配符（`contribution.sensitive_wildcard`）；按合并后的许可重新检查 rights_ack；作者草稿在预览之后被修改时返回 409 `draft.version_conflict`；非 open 状态返回 403 `contribution.not_open`。
5. **接受的结果**：生成一个 `author_kind = contribution` 的 Revision；合并后内容与已有 Revision 完全相同时复用它；贡献者去重后写入 provenance。
6. **邀请**：`policy = invited` 时由 `contribution_invites` 表决定谁可以提交；作者通过 contribution-settings 与 invites 路由管理。
7. **Agent Token**：`api_tokens.agent` 为 true 的 Token 提交的 Contribution 一律标记为 agent，请求体里的 `agent: false` 不能覆盖。

### D-142 CCv3 导入的实现取值 — Accepted

1. **接口**：`POST /v1/imports {upload, namespace, name}` 返回 202；同一个 upload 以相同参数重复提交返回同一个导入，换目标返回 409 `import.upload_used`；同一个名字同时只能有一个进行中的导入。创建导入行、入队与审计在同一事务内。按账号限流（每小时 30 次）。
2. **可见性**：导入记录与 Import Report 只有发起人能看到，其他人一律 404。报告里保留 `system_prompt` 等字段的原值（只给发起人看），草稿的 provenance 只记字段名。
3. **发布前必须确认**：`POST /v1/imports/:id/confirm {rating, rights, license}` 写入草稿并让草稿 version 加一；确认之前发布返回 422 `publish.import_unconfirmed`。确认页上的默认值沿用 ccv3 包的现有取值（默认 rights 仍待用户决定）。
4. **原件不重新编码**：purpose 为 import 的 PNG 在上传阶段只校验完整性与黑名单，因为角色数据在 PNG 的文本 chunk 里，重编码会丢失。
5. **卡片中的图片**走与普通上传相同的流程（黑名单、重新编码、CSAM 扫描），全部处理完才写入。单张图片无法处理时跳过并写进报告；命中黑名单或扫描命中时整个导入以 `import.rejected` 结束，不说明原因；扫描服务不可用时重试，不跳过扫描。
6. **错误码**：`import.unsupported_format`、`import.too_large`、`import.parse_failed`、`import.digest_mismatch`、`import.name_taken`、`import.upload_unavailable`，具体原因放在 `error_detail`。
7. **存储与引用**：原件与 Import Report 存 private 桶，由 `imports.source_digest` / `imports.report_digest` 引用（`blob_refs` 只能指向 Release）。以后的 CAS 回收必须把这两列当作有效引用。
8. **追溯上传者**：`uploads.result.derived` 记录从一次上传中取出的图片 digest，员工单独标记其中一张图片为 CSAM 时也能找到上传者。

### D-143 经验证访客的实现取值 — Accepted

1. **配置**：`TURNSTILE_SECRET_KEY`、`SMTP_URL`、`EMAIL_FROM`、`GUEST_HMAC_KEY` 要么全配、要么全不配；只配一部分时进程拒绝启动。全不配时访客验证关闭（503 `guest.not_configured`），任何环境都不会跳过校验。邮件通过 SMTP 发送，服务商部署时再选。
2. **Turnstile**：要求 `success`、`hostname` 属于受信任的 web 来源、`action = guest_verification`；超时 5 秒；网络错误或响应异常一律视为失败。
3. **顺序与限流**：先按 IP 限流（每小时 10 次），再校验 Turnstile，再按邮箱限流（每小时 3 次）；确认接口按 IP 限流（每小时 30 次）。申请一律返回 202，不透露邮箱是否验证过。
4. **验证邮件**在请求内同步发送，不经过任务队列，因为任务数据会落库，而明文 token 只应该出现在邮件里；发送失败时作废 token 并返回 503。邮件是纯文本，不包含访客填写的内容。
5. **不存明文邮箱**：只存 `HMAC(GUEST_HMAC_KEY, 归一化邮箱)`，同一邮箱找回同一个访客。这把密钥单独配置、不轮换（轮换会让所有访客失去对应关系），不从会定期轮换的 `BETTER_AUTH_SECRET` 派生。
6. **token 与会话**：验证 token 与会话 token 都是 32 字节随机数，库里只存 sha256；验证 token 30 分钟过期、一次性。访客会话 cookie `__Host-charpub.guest`，30 天固定过期、不续期。
7. **身份优先级**：个人 Token > 登录会话 > 访客 cookie。
8. **停用与开关**：停用的访客除退出外一律 403 `guest.disabled`，重新验证不会解除停用；`guest_access` 开关关闭时验证与访客提交都返回 503。每次确认写一条 `guest.verified` 审计。

### D-144 web 接入 Registry API 的实现取值 — Accepted

1. **账号接口**：`GET /v1/me` 未登录返回 401；`GET /v1/me/creations` 返回当前用户所在 namespace 的全部作品（包括没有发布的草稿），最多 500 条；`PUT /v1/me/settings` 只接受浏览器会话，个人 Token 返回 `token.not_allowed`。开启成人内容必须带 `confirm_adult: true`，关闭时清空确认时间，每次修改写审计。
2. **CORS**：`/v1/*` 只放行受信任的 web 来源，允许携带 cookie；允许的请求头为 `content-type`、`if-match`、`idempotency-key`，暴露 `etag`、`retry-after`，预检缓存 600 秒。
3. **凭据**：web 只依赖 HttpOnly cookie，localStorage 不存任何凭据。读取 public IR 时不带凭据（会跨域重定向到 CDN），private 带凭据。
4. **API 地址**：`VITE_API_BASE_URL` 为空时与页面同源，本地由 Vite 的 dev / preview 代理转发 `/v1`；生产默认 `https://api.char.pub`。
5. **编辑器第一层**除名字、头像等字段外，还有一个“正文”字段（角色的 Description、世界的 About this world、世界书的第一条条目），因为每种类型至少需要一个对应的 fragment，不通过检查的草稿服务端不保存。自动保存 800ms 防抖，带 If-Match；遇到 409 停止自动保存并提示重新加载。
6. **发布**：Idempotency-Key 按（revision、label、visibility）生成，重试时复用；Publish Report 每秒轮询一次，最多 90 次。
7. **成人内容的直接链接**：搜索与浏览在服务端过滤；直接打开 mature / explicit 作品的链接时，由前端先遮挡，用户确认后才显示。读取接口本身不拦截，因为 public IR 本来就放在 CDN 上，拦截接口起不到作用。
8. **默认作者**：新建 Creation 时，初始草稿的 `authors` 为创建者（署名取法见 D-148 第 3 条），作者之后可以修改；导入的草稿保留卡片中的作者。authors 为空时，作品页显示发布者 `@namespace`。
9. **CSP**：`connect-src` 包含 API、`assets` / `staging-assets` 域名和 R2 账号端点（部署前用通配，拿到账号端点后收窄）；头像只显示首字母，不为第三方头像放开 `img-src`。

### D-145 定期清理、导入失败处理、admin 访客管理、本地邮件的实现取值 — Accepted

1. **定期清理**：worker 每小时运行一次清理任务，删除过期的访客验证记录与访客会话、过期的 OIDC jti、超过 30 天的 webhook 投递记录（只用于去重；GitHub 只能重投最近的事件）、超过最长限流窗口的限流计数，以及一天内没有请求的 Better Auth 限流行。按主键分批删除，每批最多 1000 行、每张表每次最多 100 批，剩下的留给下一次；每次运行写一行结构化日志，不写审计。
2. **导入重试用尽**：最后一次尝试失败时，把导入标记为 failed（`import.internal_error`），保留原件，任务照常进入死信。不在死信队列上挂处理器，因为它会消费死信任务，admin 就无法再重投。只有 `internal_error` 的失败可以被重投恢复；卡片本身的问题（解析失败等）是终态。已知限制：最后一次尝试如果超时或 worker 进程退出，导入仍会停在 processing，从死信重投可以恢复。
3. **admin 访客管理**：`GET /v1/admin/guests`（最新在前，按状态与显示名过滤）、`GET /v1/admin/guests/:id`、`POST …/disable`、`POST …/enable`。需要操作理由，所需能力与封禁用户相同；写处置记录与审计；停用时在同一事务中删除该访客的全部会话；重复停用不产生新记录。响应中没有邮箱，也没有邮箱 HMAC。
4. **Turnstile 测试密钥**：Cloudflare 公开的“始终通过”测试密钥返回的结果只在 `NODE_ENV=development` 时被接受（跳过 hostname 与 action 检查），其他环境一律按 `testing-key` 拒绝，防止生产误配测试密钥后校验失效。
5. **本地邮件**：docker compose 加入 Mailpit（SMTP 127.0.0.1:51025，Web UI / API 127.0.0.1:58025）；本地访客验证的配置写在 README，`.env.example` 不包含测试密钥。

### D-146 继承值不参与默认值省略；https URL 的校验 — Accepted（待用户复核）

1. **规范歧义**：规范化时“值等于默认值的字段要省略”中的默认值，只指字段自身固定的默认值，不包括从其他字段继承来的值。AssetVariant 的 `license`、`rating` 缺省时继承 Creation 的值；如果作者显式写出与 Creation 相同的值，这个字段保留，digest 与省略时不同。原因：显式写出的值是作者对这个变体的独立声明，Creation 之后改了许可或评级，它也应该保持不变；而且如果省略与否取决于另一个字段的当前值，digest 就不再只由字段本身决定。现有一致性用例不受影响。
2. **只允许 https 的 URL**（Release 的 http 来源、asset 外链 locator）在 zod 与导出的 JSON Schema 中一致：都要求以小写 `https://` 开头。大写的 `HTTPS://` 以前 zod 会接受，现在两边都拒绝，避免外部实现按 JSON Schema 校验时与服务端结论不同。

### D-147 web 端 Contribution、访客与导入的实现取值 — Accepted

1. **提交的基线**：贡献者在最新 public Release 的 canonical 内容上编辑，浏览器按 Release 的内容算出每个变更的 `base_digest`。请求里的 `sensitive` 只是为了满足请求格式，是否敏感由服务端判定。v0 的提交界面支持文本段落、评级与标签；依赖、资源与其他元数据的变更暂时没有界面（API 已支持）。
2. **授权方式**：作品许可为 `LicenseRef-*` 时要求贡献者显式授权（`explicit_grant`），其余许可按同一许可授权（`inbound_equals_outbound`）。
3. **审阅**：只有“会应用”的敏感变更需要逐项勾选，没有“全部接受”；提交时只发送勾选过的键。有冲突时不能接受；草稿在审阅期间被改时提示重新加载预览。
4. **访客验证后的返回地址**存在 localStorage，只接受 `/c/` 开头的站内路径，不含任何凭据；验证链接中的 token 读出后立即从地址栏清除。构建时没有 `VITE_TURNSTILE_SITE_KEY` 就不提供访客入口。CSP 的 `script-src` 与 `frame-src` 放行 `https://challenges.cloudflare.com`。
5. **导入向导**完全走服务端：上传原件 → 创建导入 → 轮询 → 展示 Import Report（被省略的字段只显示名字）→ 逐项确认评级、权利与许可 → 进入编辑器。需要确认的字段一律留空，由作者显式选择。web 不再依赖 `@char-pub/ccv3`。
6. **署名**：authors 为空时显示发布者 `@namespace`。

### D-148 账号关联、路由授权规则、默认署名与安全响应头 — Accepted

1. **OAuth 不做隐式账号关联**（纠正 D-136 第 4 条）：用另一个登录方式登录时，即使邮箱相同、且邮箱已验证，也不会并入已有账号；第二种登录方式只能由已登录用户显式关联。原因：security 设计对账号接管的防护要求关闭按邮箱的隐式关联，D-136 的写法与之不符，实现时写成了“邮箱已验证就自动关联”。集成测试验证：打开隐式关联时，攻击者的第三方账号会被并入受害者账号。
2. **路由授权规则**：`apps/server/src` 中所有 HTTP 路由必须通过 `route()`（admin 为 `adminRoute()`）注册，由 Biome 的 GritQL 插件在 `pnpm lint` 中强制。规则按调用形状识别（不依赖变量名），测试文件除外；少数合法例外（辅助函数本身、健康检查、Better Auth 挂载点、CORS）用 `biome-ignore lint/plugin` 标注理由，例外清单由测试逐文件核对。
3. **默认署名**用创建者的个人 namespace（`@name`）加用户 ID，不使用登录提供方给的显示名。原因：显示名可能是真实姓名，而署名会随 Release 永久公开；作者想署真名可以自己修改。
4. **安全响应头**包在源站校验的外层，被拒绝的请求（403）也带全部安全头。
5. **像素上限**：图片元数据从文件头读取（不解码像素），超出像素上限时明确返回 `upload.too_many_pixels`；真正解码时仍强制上限。
6. **已知限制**：`asset_meta` 以重新编码后的 WebP digest 为键；两张不同的原图重新编码后恰好得到相同字节时，扫描状态沿用先写入的那一条。实际只会发生在几乎相同的图片上，暂不处理。

### D-149 Release source 与 Contribution 辅助接口的实现取值 — Accepted

1. **`GET /v1/creations/@ns/name/releases/:label/source`** 返回 Release 对应 Revision 的 canonical 内容（从私有桶的 manifest 与 fragment 重建，加载时校验 digest），供贡献者作为提交的基线。可见性与读取 Release 完全一致：private 对无权限者 404，tombstoned 410，yanked 200 并带 warning。
2. **缓存**：public 的 source 与 Release 详情一样使用 `public, max-age=60, s-maxage=300`，不做永久缓存。原因：下架只会从 CDN 清除内容寻址的对象，永久缓存的 API 响应会继续提供已下架的内容。private 为 `private, no-store`。
3. **邀请名单**只有作者可见（沿用作者设置的权限，需要登录成员；只有 `creations:read` 的 Token 不能读），最多 1000 条。
4. **Contribution 作者的展示**：登录用户附带显示名与个人 namespace，不返回邮箱；provenance 中仍只存用户 ID。访客的列表只包含自己提交的 Contribution。

### D-150 用户决定（2026-09-22）：推送、staging、种子内容、导入默认权利 — Accepted

用户在同一次问答中给出以下决定：

1. **推送**：授权在 `pnpm ci:all` 全量通过后，把本地 main force push 覆盖 `char-pub/char`（旧原型）。
2. **staging**：授权在 `Hushed Chat` workspace 创建 Railway project `char-pub` 与 staging environment，apply `.railway/railway.ts`（Postgres 16 + api / admin / worker），并创建四个 R2 staging 桶；apply 前先向用户展示 plan。DNS、Access、Turnstile、OAuth App、GitHub App 仍由用户操作。production 部署不在本次授权内。
3. **`@commons` 种子内容**：AI 辅助撰写原创 CC0 内容，全部通过发布校验并附一个引用它们的示例 Character；用户逐条人工审校后才发布。
4. **导入卡片的默认权利声明**：保持 D-135 第 1 条的现状（license 默认 `LicenseRef-All-Rights-Reserved`，rights 暂填 `original`，导入向导强制逐项确认，未确认前服务端拒绝发布）；规范不增加 `rights: unknown`。

### D-151 admin 后端补齐的实现取值 — Accepted

1. **反通知恢复窗口**：收到反通知后第 12 个工作日起可以恢复，第 14 个工作日为最晚期限（周一至周五，UTC，不维护节假日表；任意连续 14 个工作日最多有两个美国联邦假日，因此窗口总在法定的 10～14 个工作日内）。超过最晚期限仍允许恢复，结果与审计注明 `late`。反通知只适用于已处置的 DMCA 请求；登记投诉方起诉之后不能再恢复。
2. **DMCA 默认先隐藏**：隐藏可以在收到反通知后恢复，tombstone 不可逆。恢复只撤销这个法律请求造成的隐藏；同一 Creation 还有其他有效隐藏时保持隐藏。
3. **CSAM 隔离证据的下载**经 admin 进程转发：签发一次性凭据（5 分钟、只限签发给的员工、只能使用一次），下载时重新校验内容 digest，响应固定为附件、`no-store`、`nosniff`。不签发存储端的签名 URL，因为签名 URL 在有效期内谁拿到都能用。只有 legal 与 owner 有 `csam.evidence` 能力。
4. **导出**（案件记录、审计）一律用 POST：必须填写理由，导出本身写审计。审计导出为 NDJSON，每批最多 10000 条，按 id 向前翻页。
5. **namespace 转让**一律四眼确认；接收方已有个人 namespace 时返回 409 `namespace.limit`；system namespace 不可转让；执行前重新检查，发起后 owner 已变化时返回 422 `approval.stale`。
6. **锁定上传**用独立的 `upload_locks` 表，不改 Better Auth 的用户表；被锁定的用户上传与导入返回 403 `upload.locked`。
7. **强制员工登出**先调用 Cloudflare Access 的吊销接口，再在一个事务里删除应用会话并写审计；Access 调用失败时应用会话照样删除，结果写进响应与审计。
8. **admin-api 的 CORS** 只允许 `ADMIN_ORIGINS`，携带凭据；Access 应用需要放行预检请求（部署指南已写明）。

### D-152 Postgres 主版本改为 18；Railway 自定义域名的添加方式 — Accepted

1. **Postgres 18**（用户决定，2026-09-22）：staging 的 Railway Postgres 由 `postgres-ssl` 模板创建为 18.6，本地 compose 与 Testcontainers 原来是 16。用户决定全面改用 18：Railway 定义、本地 compose（`postgres:18-bookworm`）、集成测试都使用 18。在 18 上重新运行：集成测试 1292 个（包括中文、日文与一到两字的 CJK 搜索）、全栈 E2E 3 个、`pnpm dev` 冒烟全部通过。本地 compose 使用新卷 `pgdata18`，因为 18 的镜像改变了数据目录位置，旧版本的数据目录不能被直接沿用。
2. **自定义域名不在 Railway 定义中声明**：Railway 的 Infrastructure as Code 不支持注册自定义域名，定义只固定进程端口（8080）；api 与 admin 的域名在 service 创建后用 `railway domain <域名> --service <name> --port 8080` 添加。

### D-153 `@commons` 种子内容的取值 — Accepted

1. **内容**：12 个 World、12 个 Lorebook（其中 2 个与设定无关、可以通用）和 1 个示例 Character（`@commons/wren-the-harbor-guide`，引用一个 World、一个 Lorebook 与通用天气 Lorebook 中的条目）。全部为原创 CC0-1.0、rating `general`，作者署名 `char.pub commons`，附简体中文的显示名与简介。
2. **AI 辅助的标记**：每个 Creation 设 `provenance.authored_by_agent: true`。规范中没有自由文本的来源说明字段，“AI 辅助起草、待人工审校”只写在 YAML 注释与 `content/commons/README.md`、`REVIEW.md` 中，不进入 canonical 形式。
3. **校验**：`pnpm commons:check` 按依赖顺序模拟发布，并对每个 Creation 运行与 Registry 相同的发布校验（不把任何 namespace 视为同一权利人，因此每个 Creation 都必须允许再分发）；另外检查种子内容自己的约束（CC0、general、作者署名、不含链接与邮箱）。单元测试保证草稿始终通过，并保证 `REVIEW.md` 中的 digest 与当前内容一致。
4. **发布前提**：用户按 `REVIEW.md` 逐条审校（原创性、适龄、措辞）并签名后才发布。示例 Character 的 digest 会在依赖被固定到真实 Release 之后改变。
5. **发布途径**：`@commons` 是 system namespace，只能由 `bootstrap --system-namespace commons --member <邮箱>` 创建，并把指定的已注册用户加为 maintainer（写审计，可重复执行）。它没有 owner，因此不能改名或转让；普通用户注册不到这个名字，也不能在里面发布。maintainer 用个人 Token 按普通 API 发布，经过与其他作品相同的发布校验。

### D-154 Cloudflare 边缘规则由仓库管理 — Accepted

1. **规则即代码**：`char.pub` zone 上的 WAF 方法白名单、登录接口限流与源站校验头，以 JSON 的形式放在 `infra/cloudflare/`，由 `pnpm cf:rules` 同步（默认只读并比较差异，`--apply` 才写入）。脚本只替换本仓库管理的规则（`ref` 以 `charpub_` 开头），同一阶段中其他规则原样保留；部署初期在控制台手工建的 staging 源站校验规则被同内容的托管规则接管。
2. **staging 与 production 共用一个 zone**：方法白名单与登录限流各一条，同时覆盖两个环境的主机名（Free 套餐的限流规则只能有一条）；源站校验按环境各一条，值分别来自本机的 `staging-` / `production-origin-auth-secret`，不进入仓库，也不在只读比较时离开本机。
3. **限流参数**：`/v1/auth/*`，按 IP 与数据中心计数，10 秒内 20 次，超出阻断 10 秒（Free 套餐允许的最短窗口与时长）。应用内另有按账号、namespace、IP 哈希与访客的限流，边缘规则只挡最粗的滥用。
4. **Turnstile**：为 char.pub 单独创建两个 widget（`char.pub staging` 只允许 `staging.char.pub`，`char.pub production` 只允许 `www.char.pub`，模式 managed），不复用账户里已有的 widget，因为它的 secret 可能已被其他项目使用。
5. **调用方式**：Cloudflare 的写操作经由 tool-bridge 的 Cloudflare API 工具执行，本机不保存 Cloudflare token；R2 的对象与自定义域名仍用 wrangler。

### D-155 v0 只有一个线上主站，不设 staging — Accepted（用户决定，2026-09-23）

1. **决定**：初期不维护单独的 staging 环境，只有一个主站（`www` / `api` / `admin` / `admin-api` / `assets.char.pub`），减少费用和需要同步的配置。这取代 D-114 中的 staging 域名规划，以及 D-150 第 2 条中创建 staging 资源的授权。
2. **做法**：staging 里还没有任何用户数据（只有迁移与系统账号，四个桶为空），所以删除后按 production 重建，而不是改名沿用：Railway 删除 `staging` environment，只用 `production`；R2 桶名不再带环境名（`charpub-public` 等）；Cloudflare 规则、Turnstile widget、DNS 记录、web Worker 与 staging 专用的本机密钥一并删除。
3. **上线前的验证**：没有 staging 之后，依靠 CI 全量回归、本地 `pnpm dev` 与全栈端到端测试，以及 Railway 部署前自动迁移、迁移失败不部署。在主站上的端到端演练使用测试账号、测试仓库与合成数据，结束后清理。
4. **防止误操作**：Railway 定义在 `production` 以外的 environment 中执行时直接报错（有测试覆盖）。以后如果需要预发布环境，必须使用与主站完全独立的凭证。
5. **验收条目**：DOD 中“在 staging 上”的条目改为“在主站上”；M9-6 改为主站正式对外开放前的最终确认。已勾选的条目不受影响。

### D-156 OIDC 发布比对 Action 算法下的 digest — Accepted（缺陷修复）

1. **问题**：第一次在主站用真实 GitHub Action 做 OIDC 发布时，一律返回 `publish.source_digest_mismatch`。char.yaml 通常不写内部 Creation ID，Action 在 CI 里用 CLI 由 ref 派生的占位 ID 计算 semantic digest；Registry 重新读取源文件后用真实 ID 计算，两者必然不同。集成测试的“Action 上报值”也借用了 Registry 的计算方式，所以没有发现。
2. **修复**：Registry 读取源文件时同时按 Action 的算法（不替换 ID）算出 `reported_digest`，只用它与 Action 上报的值比对；存入 Revision 与 Release 的内容仍然使用真实 ID。防护不变：比对的仍是 Registry 自己在 OIDC token 指定的 commit 上读取的内容，Action 上报的值只用于尽早发现不一致。
3. **回归测试**：用 Action 实际调用的 `buildLocal` 构建同一份源文件，断言它的 digest 等于 `reported_digest`（修复前失败）；集成测试改为按 Action 的方式计算上报值，并分别校验 Release 的 digest 与上报值。

### D-157 web 重新设计：信息架构、品牌视觉与配套接口 — Accepted（用户决定，2026-09-23）

1. **范围**：重组信息架构、换成品牌视觉、统一组件，同时补上服务端已支持但 web 没有入口的功能（yank、作者主页、GitHub 绑定状态、namespace 改名、移动端导航、全局搜索），以及服务端缺的接口（公开举报、贡献拒绝理由、按 @namespace 邀请、搜索按 namespace 过滤）。原 Web 设计与 Pencil 画板保留在 Git 历史，持续有效的设计依据见 [Web 创作端的责任](llmdoc/web/creator-experience.mdx)。
2. **视觉**：向 `vendor/brand-assets` 对齐，取代 2026-09-23 “配色与字体暂不改动”的要求。浅色为主：Sand 底、Ink 文字，深色用 Night；主操作是橙底配 Ink 文字（橙底白字对比度不够）；危险操作用单独的红色，不再和强调色混用。品牌的三个节点色固定对应作品类型：Character 橙、World 紫、Lorebook 蓝，卡片、徽章、依赖列表、token 占比条都按这个规则着色。字体换成 Plus Jakarta Sans 与 JetBrains Mono，用 `@fontsource` 自托管，因为 CSP 不允许第三方字体。logo、字标与 lockup 直接引用子模块文件，不在仓库里复制。
3. **作品页结构**：作品的公开页面收进一个外框（头部加标签页 Overview / Context preview / Versions / Contributions / Settings）。版本对比并入 Versions，旧的 `/diff` 重定向过去。贡献开放度与邀请只在 Settings 标签里设置，编辑器不再提供这个入口；草稿里的 `contribution_policy` 字段原样保留。作者主页是 `/c/$ns`。
4. **界面语言**：只做英文，排版给中日文留出长度和换行空间，以后再接 i18n。
5. **主题**：浅色 / 深色 / 跟随系统三态，默认跟随系统。为避免首屏闪烁，用一个同源外链脚本在渲染前设置主题（CSP 不允许 inline script）。
6. **邀请名单只显示 @namespace**：按 @namespace 邀请之后，作品所有者可以邀请任何有个人 namespace 的人，而 OAuth 显示名可能是真名，所以邀请名单不再返回 `display_name`，与“默认署名不用 OAuth 显示名”的规则一致（D-148 第 3 条）。
7. **公开举报**：`POST …/reports`（作品）与 `POST …/releases/:label/reports`（版本），原因分六类，与 admin 举报队列一致。匿名举报必须通过 action 为 `report` 的 Turnstile，访客验证的 token 不能混用；看不到的对象与不存在一样返回 404；成功一律 202，不透露后续处理。匿名举报复用访客验证的 Turnstile 配置，没有配齐时返回 503、提示登录后举报（用户决定保持这个做法）。
8. **GitHub 绑定**：web 只显示已有绑定的状态，冻结时可以确认继续使用或解绑，也可以直接解绑。新建绑定需要 GitHub App 安装流程拿到 installation 与仓库的数字 ID，web 还没有这个流程，页面上只做说明，不提供手填 ID 的表单。
9. **设计文件入库（历史）**：旧 Pencil 设计稿的 `fileToken` 是文件 UUID，不是凭据。2026-09-24 删除旧设计稿后，gitleaks 仍保留原路径与该字段的精确放行，用于 Git 历史扫描；其他文件和字段照常扫描。


### D-158 补齐重设计后的功能入口与授权 — Accepted（用户指示，2026-09-24）

1. **范围**：按用户“先把功能实现”的指示，补齐删除申请、GitHub 仓库连接、导入确认恢复、头像、贡献统计、发布来源与 Agent Token；不代替人工验收或主站部署。
2. **删除申请**：浏览器登录用户提交明确确认的账号删除或有编辑权限作品的移除请求，进入既有加密法律队列；支持本人查询状态，管理人员查看申请理由。这里是请求受理，执行继续由工作人员按既有流程审查。
3. **GitHub 绑定**：以登录账号已关联的 GitHub 数字 ID 为身份依据，查找、绑定及重新绑定均验证其对安装仓库的当前写入权限，不以知道安装 ID 或仓库 ID 作为授权。
4. **头像存储**：草稿预览要求图片来自当前用户已处理的上传记录，不能用草稿内任意 digest 读取他人私有对象。公开发布时同步把 IR 引用的镜像资产复制到公共 CAS，确保发布后的图片链接可用。
5. **待定信息**：用户尚未确定运营主体和公开联系邮箱，政策页面保留待补提示，不捏造身份或联系方式。

### D-159 Preset 协议与参考实现 — Accepted（用户指示，2026-09-25）

1. **交付顺序**：按用户“开始实现”的指示，先完成 Preset 协议、纯计算参考解析与组装、策略 Diff、Schema 和验证。Web 创作、Registry 发布读取、CLI build/publish/preview、policy Contribution 和 CCv3 policy 转换后续接入；不改变 v0 仅开放三种创作类型的决定。
2. **独立 Policy**：`preset` Creation 声明专门的 `policy`，参与 semantic digest；它不包含 Creative fragments、内容依赖、slots、params、cast、bootstrap 或 context assets。允许展示资源。Creative `instruction` 仍是扮演说明，不承载运行策略。Preset 经 `resolvePreset` 验证完整快照摘要后单独输入 Assembler，不进入内容 IR 或内容 lock；内容 Resolver 明确拒绝 Preset 根与依赖。
3. **首版结构**：有稳定 ID 的字面提示词块、main/after-history 位置、完整区域布局、Creative 区域预算上限和明确的 Runtime 能力需求。首版不引入独立 Prompt Module、继承、外部模块引用、脚本或变量插值。字段与边界见 [Preset 规范](spec/preset-v0.md)。
4. **预算与兼容**：显式 Preset 先扣固定输入，再预留全部可见 pinned，之后按重要性、布局、区域内 IR 顺序选择完整片段；同时校验最终消息文本成本，格式差额进入 Trace。system 能力必须明确；不能跨 history 合并 system 文本。无 Preset 时保持旧默认布局、预算优先顺序与能力降级语义。
5. **组合与版本**：Scenario 继续承担创作组合职责，不增加 Experience/Composition 类型。推荐 Preset 不自动选用或锁版本；实际策略身份写入 Trace。完整运行搭配锁定和独立模块需要后续单独设计。
6. **验收边界**：新增跨 Runtime fixture 保持 draft；实质断言验证消息、预算、身份与拒绝行为。自动执行不代替人工接受 expected，也不等同于线上发布或真实第三方 Runtime 验收。

### D-160 补齐全部一等创作资产与各端接入 — Accepted（用户指示，2026-09-26）

1. **范围**：用户授权补齐 Preset 完整使用链路、Style/Scenario/Persona/Relationship 创作消费、独立 Prompt Module、完整搭配锁定及作者测试，再统一调整 Web、Server 和 Client。Client 已明确为 CLI、SDK、Publish Action。该授权取代 D-021 与 D-159 对本次创作类型接入的延期安排，不改变内容治理、部署或对外发布授权边界。
2. **模块**：独立类型为 `prompt-module`，只有 Policy 内容。Preset 与 Module 可精确引用 Module；按声明顺序遍历依赖、先依赖后本地，同 Release 只注入一次，同作品不同版本和依赖环拒绝。模块来源与聚合锁必须可审计。
3. **统一产物**：内容 IR、ResolvedPreset 与 ResolvedPromptModule 通过判别式 CreationArtifact 分发，共享 Release、权限、依赖完整性、资产、许可和评级检查；内容 IR 保持独立，不将运行策略伪装成 Creative 片段。
4. **搭配**：Scenario 继续是唯一组合 Creation。assembly 锁定策略及运行配置，真实 Session 保持 Runtime 私有；推荐与精确配置分别表达。
5. **作者测试**：用户明确选择确定性的组装验证，包括激活、顺序、预算、可见性及错误预期。作者只能显式编写并发布合成输入，不自动复制真实会话，不调用真实模型、不引入模型凭据和费用。
6. **协作与兼容**：新增配置 Contribution domain，第一版整字段原子三方合并。CCv3 Policy 只在显式选择后转换，并保留权利确认和损失说明；旧内容作品的读取、导出、发布和权限流程继续兼容。
7. **验收**：按 [完整接入执行记录](spec/proposals/first-class-assets-rollout.md) 完成核心、服务端、各客户端和完整旅程验证；部署、npm 发布、人工接受 conformance expected 不包含在本次实现授权内。

### D-161 可组合的静态创作定义与独立 Runtime — Accepted（用户确认，2026-09-26）

1. **平台职责**：char.pub 是创作内容的发布平台，重点是创作生态与环境。发布物可以完全是静态定义；平台的内容抽象必须能表达提示词之外的创作结构，不能把全部作品能力限定为提示词片段的管理与拼接。
2. **创作表达范围**：应支持作者在作品中定义剧情、可分支的选项、结局和多角色。声明这些创作结构属于本项目的内容模型与发布契约；具体 schema 和解释语义仍待设计，本条不代表相关能力已经实现。
3. **组合是基础能力**：作者应能组合自己喜欢的 Character 等已有创作内容，编写并发布自己的剧情。作品组合、角色在剧情中的参与及其引用关系应由内容模型表达，不应只能通过复制和改写提示词实现。
4. **运行边界**：实际执行由独立 Runtime 项目负责，包括具体会话状态、模型调用及游玩过程。char.pub 提供静态创作定义与消费契约；支持剧情结构不意味着 char.pub 承担运行器或会话托管。
5. **后续设计边界**：本条确认产品方向与职责，不预先决定新增 Creation 类型、剧情图或状态机表示、条件求值语言、Context IR 的调整方式，也不承诺不同 Runtime 生成相同剧情结果。后续围绕可组合的创作定义评审这些抽象，不能从 Runtime 的某个执行实现反推为已接受的内容规范。

### D-162 剧情结构与消费契约的统一规范 — Accepted（用户确认，2026-09-30）

1. **单一规范**：[`spec/story-v1.md`](spec/story-v1.md) 是剧情结构、资料组织、Style 作用范围、Preset `"1-draft"`、视角过滤、Context Catalog / TurnView / SelectionPlan / Prepared Context、作者工作流的现行规范。2026-09-26 起的讨论稿移入 `spec/proposals/archive/` 并标为 Superseded，只作为过程记录。本条细化 D-161 第 5 条：原先留待设计的抽象，现以该规范为准。
2. **一次写全、分两批冻结**：A 批（description、分组、参考资料、Scene、无条件 Beat 与 Ending、开局、Style 范围、Preset `"1-draft"`、消费契约、视角规则、Contribution 扩展）是稳定候选；B 批（变量、条件、效果、`judge`、Item、Event、Timeline、知情声明）是 experimental。
3. **experimental 的含义**：B 批字段同样计入 `semantic_digest`；使用它们的作品在能力列表中带 `experimental` 标识，发布前作者确认，作品页向玩家显示。冻结前语义变更以新的 `story.version` 引入，既有 Release 不重写、仍可读取和校验。官方 runtime 通过全部 B 批一致性 fixture 并完成真实作品验证后，由新条目宣布冻结。

### D-163 条件与效果是受限数据树；允许作者声明的剧情变量 — Accepted（用户确认，2026-09-30）

1. **与纯值替换的边界**：文本模板继续只允许纯值替换（D-026 不变）。条件与效果是另一种受限数据：结构化 JSON/YAML 节点树，只有 `all`/`any`/`not`、进度、知情、有界整数/枚举/集合/布尔变量比较与 `judge` 命题；没有循环、函数、算术、外部调用，求值必然终止。
2. **参考求值器归 char.pub**：条件与效果的语义由 `packages/core` 中的纯函数参考求值器唯一定义，编辑器预览、一致性 fixture 与官方 runtime 共用。游玩中的求值、Beat 与场次的确认、效果执行仍由 Runtime 完成；char.pub 不托管会话、不在服务端推进游玩。
3. **修订 D-004**：作者在作品中声明的变量（如信任值、持有物品）作为 experimental 能力进入范围。平台仍不提供内置的好感度、RPG 属性或战斗系统语义。

### D-164 视角与可见性由一个决策函数给出 — Accepted（用户确认，2026-09-30）

1. **概念分离、决策统一**：visibility（内容能给哪些视角看）与知情声明（故事中谁知道什么）保持两个概念；Catalog、Assembler、预览与 Trace 共用一个纯函数 `viewOf`，按一张有序决策表返回 可见 / 隐藏计数 / 无关，并附原因码，编辑器据此向作者解释。
2. **Runtime 专用文字**：Scene description，Beat、Ending、Event、变量、Item 的 description 与 `judge` 命题，默认不进入 per-agent 视角的生成上下文；它们给 Runtime、判定模型使用，narrator 视角下仅在 Runtime 请求时作为方向提示提供。需要角色看到的内容写成片段并用知情声明控制。
3. **per-agent 规则**：参与者 `part` 是公开身份，对在场者可见；`goal` 与场次目的只给本人；他人设定只提供标 `outward` 的片段；参考资料只在标 `shared` 时对角色可见。per-agent 是 L3 能力，新规则只在作品有 `story` 或使用 Preset `"1-draft"` 时生效。
4. **知情三态**：声明保留 知道 / 不知道 / 未声明；所有消费端把“未声明”当作“不知道”，第三态只用于编辑器提示、差异与投稿。
5. **场次可见性**：新增 `visibility.scope: story-scene` 指向 `story.scenes`；旧 `scope: scene` 保持指向 fragment 的原义，有 `story` 的 Scenario 不能再使用旧写法。

### D-165 Catalog 的分配、预算与选材开关 — Accepted（用户确认，2026-09-30）

1. **`always` 不是必需**：`activation: always` 的片段在 Catalog 中不经选材直接成为候选，预算不足时仍可整条跳过，与现行 Assembler 一致。必须放下、放不下即报错的只有 `pinned` 与当前场次的必需项（开局局面、在场参与者的身份、本视角可见的目的）。
2. **keyword 选材需显式开启**：关键词未命中的 keyword 片段，只有标 `selectable: true` 时才交给 Selector。description 只说明用途，不改变激活语义；补写或由 agent 起草 description 不会让片段变得可被模型选中。
3. **回退只有 `skip`**：判定提供方不可用时只保留必需内容与直接关联，不提供“全部注入”。

### D-166 新结构使用 `"1-draft"` 产物 — Accepted（2026-09-30）

1. 没有使用任何新结构的作品继续产出 `"0-draft"` CreationArtifact 与 Context IR，逐字节不变。
2. 使用新结构的作品产出 `"1-draft"` 产物；IR 媒体类型为 `version=1-draft`。它是 `"0-draft"` 的超集，只认识旧版本的严格消费者会明确拒绝，而不是悄悄丢失剧情结构。
3. `catalog_index` 由解析闭包决定，对应 `lock_digest`，不参与 `semantic_digest` 计算。

### D-167 Preset `"1-draft"` 与官方默认 Preset — Accepted（用户确认，2026-09-30）

1. Preset / Module `"1-draft"` 以块的 `default_at` 加 Preset 的 `placements` 取代块自带位置；同一块可以显式装配多次，去重只合并同一模块 Release 的重复依赖路径。`"0-draft"` 行为不变。
2. **官方默认 Preset 是公开作品**：`@commons/default-preset` 作为普通公开 Release 发布并经过同样的审校。使用新结构且未锁定 Preset 的作品，在发布构建时由 Registry 把当时的默认 Preset 精确 Release 写入产物 `default_policy`；运行时不解析“最新版”。旧作品没有 Preset 时仍用现行默认布局。

### D-168 开场文字四处共存 — Accepted（用户确认，2026-09-30）

`scene.opening`（局面，只进上下文）、`starts[].greeting`（开局的第一条消息，可内联或引用问候语 ID）、`bootstrap.greetings` 的默认项与备选项共存。支持剧情的 Runtime 按“所选开局的 greeting → 默认问候语 → 无开场消息”确定第一条消息；有 `story` 时未被开局引用的备选问候语不作为开局选项。不支持剧情的 Runtime 与 CCv3 导出继续按现行规则使用 `bootstrap.greetings`，作为有意保留的降级路径。

### D-169 剧情对象投稿与引用集合合并 — Accepted（用户确认，2026-09-30）

扩展 D-061、D-062：新增 `story`、`story-order`、`cast`、`group`、`source` 变更类型。这些对象按字段三方合并：标量字段两边改动不同即冲突；引用列表（场次的人物、Beat、资料，剧情线的场次，分组条目，知情名单等）按集合合并，各自增删互不冲突；相对顺序只在两边都改变且结果不同时冲突。合并后重跑全部静态校验，任何错误都视为冲突且不产出结果（与 D-130 一致）。

### D-170 试玩使用草稿构建而非 Release — Accepted（用户确认，2026-09-30）

试玩对草稿 Revision 执行与正式发布相同的检查，产出带 `origin: draft-build` 的临时产物，通过短期签名地址访问，缺省 7 天过期。它不可被依赖、不可搜索、不占用版本号、不进入版本列表，也不改变 Release 的不可变与三态生命周期（D-042）。

### D-171 char.pub 作为 OAuth 2.1 授权服务器 — Accepted（用户确认，2026-09-30）；OIDC 登录 — Verify

1. **取代 D-089 中“char.pub 作为 OAuth / OIDC Provider：Deferred”与 D-004 中的对应排除项**：char.pub 提供 Authorization Code + PKCE（S256 必须）的 OAuth 2.1 授权，让 Runtime 代表用户读取私有 Release 与草稿构建、创建新作品或 Remix 草稿、提交 Contribution。
2. **没有特权客户端**：官方 runtime 与第三方 Runtime 都是手动注册的普通客户端，使用同一组 scope（`profile`、`creations:read`、`drafts:write`、`contributions:write`）；token 能力不超过用户自身权限。
3. **v1 不开放发布类 scope**：发布、修改可见性、许可与分级只能由用户在 char.pub Web 或 CLI 完成。
4. “Sign in with char.pub”（OIDC）使用同一授权服务器；所依赖认证库的 Provider 能力待核实。

### D-172 官方 runtime 与“开始游玩”入口 — Accepted（用户确认，2026-09-30）

官方 agent runtime 是独立项目，是默认、体验最完整的消费端，但只通过公开契约与 D-171 的授权接入；聊天流量仍不经过 char.pub（D-055）。作品页与分享卡片提供“开始游玩”，打开官方 runtime 或用户选择的已授权 Runtime。这取代 D-058 中“`Open in` 深链不进入必做范围”的部分；Runtime 注册目录与专用扩展仍不在范围内。

### D-173 作品级协作者 — Accepted（用户确认，2026-09-30）

owner 可以给单部作品添加协作者。协作者可以编辑草稿、创建草稿构建与试玩、审阅投稿；正式发布、改可见性、改许可与分级、管理协作者、删除作品只属于 owner。并发编辑沿用 If-Match / 409，不做实时协同；协作者加入时确认贡献按作品许可授权，并在 Release contributors 中署名。组织 namespace 不在本条范围。

### D-174 剧情能力的兼容基线 — Accepted（用户确认，2026-09-30）

实现剧情规范前，先对 `spec/conformance` 全部用例、`packages/assembler` 作者 fixture 与 `@commons` 候选作品记录产物字节与 `messages_digest` 作为基线。所有改变旧作品输出的新规则（per-agent 新过滤、`outward`、新区域、新去重规则、官方默认 Preset）只在作品使用新结构或选用 Preset `"1-draft"` 时生效；基线变化视为回归，不能通过更新 expected 吸收。


### D-175 Story v1 无用户阶段的破坏性改造 — Accepted（用户授权，2026-09-30）

用户明确项目没有用户，可做任意破坏性重构，并要求执行 Story v1 及评审修补。取代 D-174 的旧产物/消息逐字节不变要求，以及 D-166/D-167/D-168 中为旧消费者维护双路径的约束；采用统一新版模型、产物与消费路径，迁移本仓库示例和工具，不为旧格式维护第二套引擎。内容身份、许可、来源、访问授权、纯计算和可重放仍是约束。此授权不自动执行生产清库、部署、公开发布或远端强推。执行包：`spec/goals/story-v1/`。

### D-176 开放局面、行动建议和实例引用 — Accepted（按用户授权落实评审，2026-09-30）

Scene.cast 是默认在场安排，Runtime 可以提供本轮实际在场 cast 子集；没有覆盖时使用作者默认。作者可声明行动建议（稳定 ID、玩家可见文字、意图、可选出现条件），自由输入始终允许，选择不自动推进剧情或执行效果。临时新 NPC/新 Scene 暂不成为发布对象。参与者实例不依赖 override 是否存在；`cast:<key>#<fragment>` 精确引用角色实例中的片段，歧义的公共片段引用发布失败。

### D-177 剧情状态和判定语义 — Accepted（按用户授权落实评审，2026-09-30）

条件内部保留 true/false/unknown；not unknown=unknown，all/any 使用三值组合，只有最终 true 可执行。Beat/计划事件/Ending 默认一次确认，重复确认拒绝且不执行效果；stop 结局后推进操作拒绝。初始化和进入场次均检查进入条件；Runtime 决定动作是否发生，纯求值器验证并返回新状态。任何失败不部分提交状态。

### D-178 选材输入与计划绑定 — Accepted（按用户授权落实评审，2026-09-30）

完整 TurnView 仅供可信 Engine 计算，Selector 使用视角投影，不能自动收到完整 vars/knowing/judgments/overlay。目录说明必须适合其暴露视角。作品与分组只可展开，正文只可选择 fragment/source/section；直接关联资料分节进入 direct。Plan 校验产物内容摘要、锁、turn、实际 policy 和目录摘要。深度从作品节点计为0，默认4允许三层分组及叶子；完整展开同样受预算/深度限制。


### D-179 独立 Harness 与决策提供方 — Accepted（用户追加，2026-09-30）

用户要求把 Jev/Laya 这类决策模型纳入设计，并拆分 harness monorepo，为 Runtime 准备，可使用 deepseek-ai/deepseek-harness。已固定上游提交并clone到独立 `/Users/djj/code/char-harness`（用户如指定位置则迁移），保留许可与上游来源。创作定义/纯求值/确定组装由 char.pub 包提供，Harness通过发布包/pack产物消费；不复制 schema。模型网络访问、决策adapter、状态确认与会话日志属于Harness。Laya身份待链接，不猜协议。模型可见输入必须可从日志重放，Prepared Context 与上游Session投影只能有一个消息组织权威。


### D-180 准备流程的初始化、回放与作者测试边界 — Accepted（实现细化，2026-09-30）

1. 新会话显式初始化Story；消费已有TurnView时拒绝缺失或非法状态，不默默重置到开场。实例模板在发布构建时编译，运行时只填充late身份。
2. SelectionPlan携带discovery模式，使关闭目录的none/skip计划可精确重放；跳过选材不免除required/direct正文校验与预算。
3. 随作品发布的fixture保存固定CatalogRef选择，构建产物后生成完整Plan，避免artifact_digest递归包含自身。准备阶段非法输入属于setup failure，不能被expected错误码认可。
4. preset省略表示继承发布搭配，显式null表示默认布局；作者fixture省略preset按其测试定义使用默认布局。
5. per-agent覆盖与绑定描述由明确投影提供；完整overlay不进入角色视角，他人仅使用outward_description，离场绑定不自动注入描述。网络/文件正文加载留在调用方，Assembler按发布身份复核。


### D-181 Preset 1 定义、装配实例与导入索引 — Accepted（实现细化，2026-09-30）

作者块使用default_at/purpose；解析Module保留定义，解析Preset生成带position的装配实例。显式placement以定义身份+at+as组成唯一ID，origin和本次placement分开保留，Trace与Diff不合并重复正文。嵌套导入用逐层import ID路径；不同别名指向同一定义时仍执行同一重复装配规则。解析器只缓存每Release局部定义和导入，按需逐段查找，不枚举指数增长的菱形路径。selection是上限，Runtime不能放宽；规范化省略max_depth=4后，消费仍恢复4。


### D-182 默认策略属于固定构建输入 — Accepted（实现细化，2026-09-30）

发布任务首次创建时持久化精确默认Preset身份；worker重试和按快照重建不得重新读取当前默认配置。Core将其作为独立构建依赖纳入聚合lock/meta/assets及发布检查，不伪造Creative引用边、不改变作者semantic_digest。内容产物内联解析后的default_policy及其精确身份，consumer不取latest。覆盖D-180关于内置默认布局的临时说明：preset null最终选择产物default_policy。官方候选需普通审阅发布，离线模拟Release ID只用于开发检查。


### D-183 严格产物与源身份校验分离 — Accepted（实现细化，2026-09-30）

统一Artifact/IR/assembly/Policy为1-draft；没有assembly或精确default_policy的完整内容构建失败。Core/CLI提供独立的源读取+canonical/check入口，CLI/Action发布计算作者摘要时使用它，有声明的作者测试仍执行，不把0项测试包装成隐式完整构建。正式构建由Registry固定策略后独立重验。草稿预览从无缓存的公开默认端点取得一次精确身份；离线示例和测试显式携带合成策略，不进入生产默认配置。


### D-184 统一公开组装入口与内部渲染 — Accepted（落实 D-175/D-178/D-182，2026-09-30）

公开 `assemble` 等价 `prepareContext`，要求完整 Artifact + Profile + TurnView；旧 IR/session 入口和隐式无策略布局删除。内部 `renderPrepared` 必须收到已验证 admission 与策略，只负责渲染、布局和精确预算，不重复判定 visibility/activation。省略或明确指定策略均使用相同 admission 顺序，布局只改变位置；消息标题、分隔符、策略字面文本计入预算。包入口不导出底层 renderer 或 admission 构造类型。Conformance 的 assembler 用例从显式完整构建输入运行，比较 Trace 与最终 messages_digest；旧 expected 保留到人工审阅，不能因为无旧格式兼容要求就自动接受候选输出。


### D-185 Slot 早绑定引用既有参与者 — Accepted（落实实例身份语义，2026-09-30）

Conformance实际消息审阅发现，关系slot按公共作品ref绑定Bob时旧Resolver另造participant，导致同一Bob同时列入知道和不知道。早绑定是角色引用：复用已解析的唯一参与者身份；同ref对应多个不同参与者时拒绝为`resolve.ambiguous_participant`，作者须使用`{{cast:key}}`明确实例。不能以显示名去重，也不能选择第一个匹配。此修复会改变受影响IR及消息摘要，候选必须重新生成并审阅。


### D-186 Story 开局初始化与本地化模板 — Accepted（落实 Story v1 §8，2026-09-30）

`startSession`采用完整产物输入，返回已初始化TurnView与可选OpeningMessage；实际opening已加入history，Runtime不再追加。多个开局必须明确选择，有Story时不允许用独立greeting_id绕过starts；无问候语正常返回null。初始化仍由Core验证条件并原子应用状态。旁白不伪造speaker:self。Story opening与内联greeting允许locale map且默认语言必需，ref保留；编译为text/locales，每种语言独立替换early名称与保留late占位符。CLI/Web的新预览按该规则生成消息，完整快照不被重置。

### D-187 CCv3 从完整产物导出 — Accepted（落实 Story v1 §19.3，2026-09-30）

导出器消费完整Artifact，携带Story、目录和固定策略；旧IR-only签名删除。开局消息按starts顺序和§8.2规则映射到first_mes/alternate_greetings；场次opening是scenario上下文。无消息开局保持空位置。不可表达的结构逐项列入Loss Report。默认使用产物锁定assembly/default_policy，可显式覆盖；导出语言可指定。Registry任务读取同一发布产物，导出器版本升级，缓存绑定根Release、输出桶、内容/锁摘要、版本、语言与精确策略，防止同内容不同Release的来源混淆和跨桶误用。selectable/about/source等不能表示的新属性同样逐项报告损失。


### D-188 自动能力声明与显式支持检查 — Accepted（落实 Story v1 §15，2026-09-30）

所有Artifact必填排序去重capabilities，按实际产物/策略计算，不接受作者手写。catalog指片段description、分组、作品description或selectable，不因普通片段存在就声明。变量声明和starts.reached同样需要实验story.conditions，补齐仅有初始化状态时的能力缺口；有效cast remove保留by.cast来源。未知ID由支持检查报告unsupported；降级须Runtime明确列出能力与原因，Core不决定运行策略。

### D-189 参考正文的存储、授权与按需加载 — Accepted（落实 Story v1 §4/13，2026-09-30）

Source要求mirrored、8 MiB内的合法UTF-8文本；text/plain/markdown走既有上传队列，保留原字节，图片尺寸对文本为空，不伪称已扫描图片内容。发布前检查全部Source摘要和锚点；验摘要之后才移除BOM、规范化换行。根Source的授予只来自发布者自己的ready上传、同作品已发布资产或授权精确依赖；namespace成员不自动共享私有上传。无用户publisher的OIDC只接受已有作品或依赖授予，新的作品级上传授予尚待实现。

读取API绑定精确Release和Catalog Source ID，先授权，再验正文；不接受任意digest/URL，no-store。sourceRequests只给出本轮有效选材的加载清单；Web先展示当前视角说明，固定选择后才取正文，校验身份及hash，过期异步响应不覆盖当前上下文。CLI/GitHub的Markdown include仅展开明确正文/本地化文字字段，locator/origin/source、结构化data及引用保持字面数据，不自动读取它们声明的路径。


### D-190 独立 Harness 先消费可校验 SDK 快照 — Accepted（落实 D-179，2026-09-30）

char.pub使用sdk:pack构建Core/Assembler/Contracts后产生tarball与SHA-256清单，保留Apache许可证。Harness把外部包快照放third_party/charpub，与MIT Cordis源码vendor分开；根pnpm overrides固定直接和间接Core为同一包。当前0.0.0为未发布开发快照，manifest明确source_dirty，不能仅凭HEAD复建；发布前需正式版本与源码检查点。

Harness新增私有experimental离线回放库，通过公开包执行初始化/纯状态操作/固定选材/最终消息。练习数据可序列化重算，使用命令ID幂等和摘要链/head发现非一致编辑；它不是持久Session，也不是防恶意重签的真实性证明。源码与plain Node编译出口分别验证。真实profile/Session日志/模型调用尚待实现，不把离线日志当第二套正式会话存储。


### D-191 Jev 的概率决策、暴露预算与回放证据 — Accepted（落实 D-179/D-190，2026-09-30）

Harness使用固定版本官方TypeSafe SDK，明确分开judgeStory与selectContext。前者按作者target/path查找真实judge叶子，概率落入显式真/假阈值之间即undetermined，不自动确认状态；后者使用批量Noul支持多选/空选，先看说明再逐级展开。Jev不获得完整Artifact/TurnView/变量/知情/绑定/overlay/候选正文；调用方仍负责history/focus的视角适配。

SDK先验证每个expand的目录深度和成本，再发送该次新目录；总请求预算另外覆盖重复history/focus、问题文本和包裹字段。显式超时覆盖整个操作与响应body，固定不自动重试。故障选材skip且清空候选选择，保留已曝光记录；故障判定undetermined；用户取消直接拒绝结果，不能当作降级成功。

离线日志v2保留完整Plan及独立decision evidence。记录完整无运输字段请求、经过验证的typed结果、模型身份/usage、可取得的原始JSON摘要及非秘密配置；网络地址只记录摘要，凭据不进入证据。judge绑定命令前态，selection绑定应用操作后的状态。非fixed/none选材和非fixed/manual判定必须有匹配证据。旧练习v1不兼容，模型开局receipt尚未实现并明确拒绝，不伪称整个Runtime已完成。


### D-192 独立 Roleplay Driver 与 Session 请求投影 — Accepted（落实 D-179/D-190，2026-09-30）

上游默认agent/request只能选择路由，SessionMessageProjection只能改既有消息节点，不能替换任意数量/顺序的PreparedContext。因此独立roleplay driver复用Session事件/JSONL和LLM服务，以roleplay/requested中的精确有序消息为唯一请求输入，不挂默认agent-loop/systemPrompt/tools，也不通过通用surface重复注入history。

opened一次固定完整SDK输入；requested记录拟议命令、原始及实际路由、Plan/状态/消息摘要并先flush再请求模型；只有成功settled提交完整post-state和助手历史。失败/取消不推进拟议事实，恢复pending记interrupted但不自动重发。同command ID和原始路由幂等，改变复用拒绝。存储append/flush失败可能已写入，不能宣称rollback；同ID先按日志核对。取得存储header后必须完成opened，避免晚取消留下无法恢复的空会话。

助手response只更新history，不为未发生的下一请求重复预留输出预算。ReplayStep.prepared_turn明确最后一次Plan/messages对应的输入，下一命令重新准备。生成成功要求唯一且末尾的stop、非空文本；工具/媒体输出拒绝。当前history是共享场景对话，不声称私聊受众隔离。DSH对prepared assistant的传输来源暂用明确的合成char.pub/prepared-history，原SDK来源与实际生成route单独保留，不伪称历史模型元数据无损。

基础bundle只挂Session、LLM、JSONL、roleplay driver，存储根/超时/事件与流上限显式配置，提供方和调用入口由应用添加。新增必需事件经持久目录/类型确认工具登记；旧读取器不认识事件时拒绝。默认Web/SDK、完整CLI分发、自动动作理解与模型开局receipt仍未完成。

### D-193 Style 呈现顺序、嵌套范围与公共人物引用歧义 — Accepted（落实 Story v1 §5/§10，2026-09-30）

Style 在 Preset 区域内按旁白、场次、参与者呈现，同一声明者按引用声明顺序与自身片段顺序；不同声明者维持引用实例遍历先后。排序只作用于最终呈现，不改变required/direct/selected预算入选优先级，最终格式成本使用相同排序计算。普通内容仍保持既有位置。

嵌套Style继承最近外层使用的作用范围和顶层组合归属；可选style_use.path按外→内保存实际声明实例owner/order/combine。外层replace覆盖其所有内层文本；内层replace仅作用于同层同owner使用，不删除父Style自身文字。根Style保留独立根层，避免第一条真实边与根文本共享替换域。此为可见性边界：Alice文风的内层文本不能变成Bob可见的旁白。

dialogue/private.to/perspective里的公共SpeakerRef同样必须唯一：除Character自身引用保持当前实例外，多个候选participant key直接报resolve.ambiguous_participant，要求显式cast/slot。这会拒绝旧实现曾任取首项的含糊内容，不为无用户项目维持错误兼容。

### D-194 声明实例闭包与 about 的静态链接索引 — Accepted（落实 Story v1 §3/§4，2026-09-30）

公共内容/Source引用与本地引用一样受声明实例约束：先按graph.edges遍历自身及实际可达依赖，再验证目标唯一性。外层兄弟作品不能补齐依赖漏掉的声明；同一Creation重复引用时，其内部自身公共引用分别绑定本实例。不能用via前缀代替图可达性，因为多cast具有相同作者路径。

about明确分为片段地址（#id/@work#id/cast:key#id）、人物地址（cast:key，含late）和作品地址（裸@work）；不猜裸作品为人物，不扩展到group/source/story。CatalogIndex.about可选保存from/ref/typed target，IR保留原字符串；目标缺失/歧义/被select或override移除时构建拒绝。只有实际输出片段的链接进入索引，能力声明包含catalog.v1。

关联索引服务作者链接和差异审阅，不参与激活、knowing或视角权限，也不原样发送给Selector。可见线索指向秘密不会自动提供秘密目录或正文。旧实现接受的悬空about及依靠兄弟补全的Source将构建失败，已向用户同步此破坏性修正。间接cast的角色所有权/词法引入/引用可达性仍另做完整改造，不以禁用跨Scenario复用替代目标。

### D-195 间接 cast 的实例归属与词法引入 — Accepted（落实 Story v1 §5/§13，2026-09-30）

先验证未展开cast的作者引用树（锁、版本、环、深度和实例上限），再按每个Scenario实例的who规划唯一作者路径。零路径拒绝、多条作者路径报ambiguous_cast_path；已有内层多cast不算多条作者路径。物化阶段为角色复制完整子树，共用World前缀保持一份，避免只有participant没有正文的phantom实例。

内部parent明确表示词法introducedBy，children只表示reference可达；角色由cast.owner归属。IR保留graph.edges并增加独立cast_edges及cast.introduced_by，Catalog闭包沿两类实际边去重遍历。跨Scenario角色副本不回接内层reference边，不继承内层参与者override；原入边bind/params/select/override及外部明确角色身份保留，内部self绑定到副本。

原路径的词法父候选必须在复制前固定，派生副本不能写回本层或任一祖先的作者路径观察表。审计先发现同层声明顺序依赖，再发现跨Middle派生副本污染Top；最终以冻结候选和cross-copy隔离observer修复。真正多个原词法父实例仍报ambiguous_cast_context，不按生成顺序选一个。

Environment按真实cast实例索引建participant与avatar；公共slot/speaker引用限各自词法闭包，显式slot/cast可保留外部明确绑定。Edge override与cast override分别使用真正声明者作权限及provenance；间接intrinsic覆盖由Scenario cast force授权，不错归World。无旧字节兼容，相关产物/Plan摘要及SDK快照须重建；当前Harness旧不可变快照不被悄悄覆盖。

### D-196 草稿构建的真实来源身份与公共校验 — Accepted（落实 Story v1 §18，2026-09-30）

保留发布ExactRef，新增严格互斥的草稿根{ref,semantic_digest,origin:{kind:draft-build,build_id:dbld_,revision:rev_,expires_at:UTC}}。根内容/资产/图节点与Preset/Module/块/Trace/CCv3均保留同一来源，不通过内部临时Release伪装草稿；依赖仍只有Release。Core只处理调用者给定身份，不生成ID、不读时间，也不把身份格式解析当作Registry授权。

checkDraftBuild复用checkPublish的全部纯内容门禁，没有label/Release或发布幂等字段。目标检查始终private，但并不豁免资产、许可、黑名单、精确依赖与类型规则。角色override同Edge override进入改编许可判断，避免以cast途径绕过不可改编限制。服务端还需独立执行授权、正文/锚点、作者测试与持久状态机。

PublishedResolvedPreset不仅要求顶层release，块来源也必须published；发布读取requirePublishedArtifact遍历内容/资产/图与assembly、default_policy两条策略，不允许草稿来源藏在未生效策略里。Registry读缓存核对root Release与semantic digest；Web Release读取/依赖选择器拒绝草稿。Source归属比较明确的BuildIdentity，不比较可能同时undefined的.release。

草稿请求If-Match沿现有整数draft.version，服务端原子固定Revision；复用限定同作品、Revision、精确策略、builder及有效生命周期，权限/资产状态每次验证。异步任务表/TTL/签名读取、前端上传资料与真实草稿预览仍未实现，Web/CLI旧LOCAL_RELEASE路径须在后续接入中移除，不能把本轮身份底座称为作者闭环完成。

### D-197 全部根托管资产的授予与历史来源核验 — Accepted（落实 Story v1 §14/§18，2026-09-30）

Registry在发布复制或草稿读取字节前统一调用assertRootAssetOwnership，覆盖三类产物中全部根mirrored资产，包括presentation、未被Source引用的context和策略展示资产。全局assetMeta ready只证明处理状态，不能证明当前作者有权使用文件。根linked不触发平台私有文件读取，也不能为相同digest的mirrored声明提供授予。

合法授予来自本人ready上传的服务端结果（blob、thumbnail与成功导入derived）、已经按当前主体逐项授权的精确依赖中的mirrored资产，或同作品成功且未tombstone发布中的mirrored资产。blob_refs含linked记录，因此只用来定位历史候选，必须回读固定发布产物确认availability后才授予。namespace成员身份、已知digest或私有CAS存在均不足以取得授予。OIDC无用户上传授予，保持同作品历史/授权依赖两条渠道。

通用授予在Core资产状态/黑名单/许可检查及依赖授权之后执行；Source正文完整性/锚点仍另外验证。无用户项目不兼容旧的无授予声明，新错误asset.not_authorized取代Source专用拒绝。集成fixture也必须记录真实形态的已完成上传，不能只插入ready资产元数据。当前发布worker已接入，草稿worker尚待实现并复用同一门禁。

### D-198 Registry 草稿构建的事务、私有 payload 与删除边界 — Accepted（落实 Story v1 §18.1，2026-10-01）

草稿构建独立draft_builds表和draft.build/requeue/expire队列，不生成Release。请求锁creation_drafts核对整数version，在同一事务内固定Revision、记录精确default policy和builder、入队并审计；createRevision接受Executor以便组合到该事务。相同作品语义Revision/config的pending或ready可以复用，ready仍重做当前闭包授权/资产/黑名单/许可及摘要检查。配额按作品，在同一草稿锁下检查。

worker重新读取账户封禁、namespace成员与作品状态，使用集中授权；read_only推迟，定时重投恢复。纯内容、根资产授予、全部Source正文/锚点和作者测试完成后写产物。临时异常由队列重试，最后失败写业务终态。功能开关在进入事务前取得，避免持有业务连接再等待另一个池连接造成并发饥饿；对象权限仍在事务中重读。

产物存private bucket的draft-builds/dbld/name专属路径，name为固定白名单，写入同名不同字节拒绝。digest保存在构建记录并在读取时重新计算。过期清理不删除任何共享CAS资产，只删专属payload并清详细报告，保留来源收据。签名最高900秒且不超过剩余寿命，响应private,no-store；SigV4签名按对象存储实际时间，业务clock只用于有效期。

构建worker、GET签发、ready复用和DELETE共享build行锁。删除先提交不可访问终态，再立即清理专属payload；存储失败返回202且周期重试。DELETE先做集中可见性检查再owner判断，私有存在性不以403泄漏。已签共享资产URL可在TTL内继续有效，不承诺瞬时撤销，也不以删除共享字节实现撤销。仅owner提前删除；作品协作者/OAuth后续沿集中授权补齐，当前namespace成员模型不称为目标协作模型已完成。

### D-199 保存快照驱动的草稿预览与账号隔离 — Accepted（落实 Story v1 §17/§18，2026-10-01）

Web草稿预览先取得同一次成功保存的{working,version}，再请求Registry构建并按dbld轮询、下载校验摘要与origin。删除浏览器loadAssemblyInput/LOCAL_RELEASE构建路径；作者测试同样使用真实草稿构建报告，服务端报告保存实际assembly_tests结果，builder契约升story-v1.2避免复用没有测试回执的旧记录。Context准备、人工选材和最终消息预览仍在浏览器，不调用模型。

自动保存使用唯一串行drain promise。多个flush等待同一drain，逐个提交保存期间的新修改，返回已确认的saved snapshot及匹配版本，失败停止而不循环重试。卸载或账号已变化时不继续发送排队修改，也不返回旧快照。身份检查读取当前QueryClient缓存，不仅依赖React effect卸载时序；异步完成可能早于界面重挂。

草稿查询key加入账号，公共作品详情可读不代表私有草稿可读；新账号必须重新请求草稿。DraftPreview、作者测试、上传和Source预览均在异步边界检查身份/请求与取消信号。停止等待不删除已开始的服务端构建；迟到结果不能重新出现。已加载预览在编辑变化时明确标旧，再构建时清掉旧产物。

资料入口先录标题/description，上传保留UTF-8原始字节（BOM/CRLF不改），ready后一次functional update追加context asset与Source。仅Core允许的Character/Scenario/World/Lorebook显示入口；第一层新增整篇资料，已有sections保留。处理未完成可续查，不重复上传。移除Source同步移除无其他引用的asset声明，避免之后public发布仍复制看似已移除的文档；共享引用保留，Undo恢复定义，服务器共享字节不删除。

本次旧Contribution表单仍允许编辑作者fixture，但没有可编辑作品的保存上下文时不伪造Release执行；该投稿专用预览需后续Contribution切片完成。不能将这项暂时限制或当前namespace成员权限称为完整M5验收。

D-199补充：锁定assembly的Scenario新建作者fixture时显式填写该Preset的ExactRef并在界面显示，不改动§14.2中“fixture省略Preset表示default_policy”的规范语义。选中已有锁定内容也在未指定策略时预填明确引用；不让不可用的默认选择产生无法运行的测试。上传步骤还须绑定渲染时的文件所有账号并逐步检查，不能在点击时把刚切换的新账号当成旧文件的所有者。

### D-200 诚实的本地编译来源与完整 Trace 根身份 — Accepted（落实 Story v1 §18，本地创作保留，2026-10-01）

CLI删除LOCAL_RELEASE，采用local-build/input_digest来源。它不是Registry草稿，无dbld/rev/expiry，也不伪造发布。纯Core createLocalBuildInput以char.pub/local-input/v1域固定canonical根和全部提供的真实Release快照、策略/URL/Resolver配置，JCS摘要保留URL原字符串语义。规范等价输入统一去重和编译，冲突不能借排序掩盖；文件路径、时间和额外fixture参数不计入。Artifact digest仍单独标识实际输出，Resolver当前开发版本0.0.0不冒称二进制实现签名。

三类产物的根和来源允许Release、Registry Draft或Local；ExactRef、pin、依赖lock及默认/assembly策略仍限定Published。Registry checkDraftBuild运行时严格只认DraftBuildOrigin，Web draftArtifact校验kind，Source加载只将draft-build映射到dbld端点，本地产物要求调用方供正文。published guard持续遍历所有嵌套来源，local块或资产不能隐藏在Release根下。

Trace.ir增加真实build身份和semantic digest，与原root地址、lock_digest共同保存，避免只有opening时没有任何根provenance；保持root字符串地址供现有界面读取。本地身份传播不改变剧情求值、选材与消息内容规则，版本/Trace schema的破坏性更新是无用户阶段的有意选择。

独立审计发现摘要对等价dep去重、实际编译仍原样比较并拒绝的问题；现helper返回规范输入，buildCreation的local分支也使用同一标准，CLI给作者fixture的deps保持一致。离线本地来源切片不替代DOD要求的授权构建消费，也不代表独立Harness已使用新SDK快照。

### D-201 Story 作者工作区、引用保护与可恢复的局部撤销 — Accepted（落实 Story v1 §17，2026-10-01）

Scenario新增以场次、剧情线、时间线组织的工作区，Cast/bindings/Preset装配保留在可直接定位展开的设置区。第一层可写场次、人物part/全局goal/本场goal及开局；变化、行动建议、结局、事件和引用编排逐步出现。名称与正文可编辑，对象ID稳定；场次人物缺省全部与显式空名单保持不同语义。建议行动仍只表达意图，不偷偷写效果或执行状态。

删除前按Core实际语法检查入站引用，涵盖条件、知情、剧情线、并列时间线、资料视角/Style范围以及self作者fixture；普通正文、转义宏与外部fixture的同名ID不算引用。角色绑定只提供runtime角色与已选角色引用，普通slot绑定继续支持自身/cast宏。新界面不能给Cast提供SDK必然拒绝的self/cast宏或任意World/Style引用。

Undo只恢复被移除的对象或字段，保留期间其他修改；以删除前baseline和当前输入比较，允许找回原本未写完的正文，拒绝重新引入删除以来新增的引用错误，失败保留Undo供恢复依赖后重试。公开角色撤销还检查其原依赖是否仍在；依赖改变时提示恢复依赖或重新选版本，不伪造解析闭包。对多语言字段的清空必须保留其他语言；需要清除全部语言时明确操作并提供字段级撤销。

开局卡片展示作者模板与来源规则，实际模板解析、参与者绑定和第一条消息由真实Registry草稿构建后的SDK Preview给出。不能把未构建working里的文字称作已生效消息。多个开局必填title/description，界面必须提供完整入口。此切片不宣称变量/物品/知情/结构化规则编辑、Source分节、投稿协作或完整M5完成；已有高级数据编辑普通字段时保留。

D-201补充：新建草稿不写入“Describe ...”提示正文；Persona/Style/Relationship与Character一样由作者填写必需内容，Scenario可直接使用Story而无重复背景片段。Undo中的结构校验不能因为无关正文尚未填完而跳过；bootstrap引用和真实模板token引用始终检查，草稿完整时再叠加权威Creation检查。浏览器模拟与全栈的环境构建输出目录隔离，避免不同API配置互相覆盖。

### D-202 类型化剧情规则与本地逻辑预演 — Accepted（落实 Story v1 §9/§17，2026-10-01）

Story作者工作区增加渐进展开的变量、物品、知情声明，以及完整Core条件和效果编辑器。变量支持bool/int/enum/set，集合区分固定字符串成员与物品；值、目标、初值及上下界依真实声明编辑。条件支持全部/任一/否定、在场与进度、知情、类型化比较和自然语言judge；效果有顺序，支持赋值、增减、集合增删与获知信息。开局效果标明在声明初值之后、进入首场次之前应用；变化/计划事件/结局效果只在确认后应用。作者输入未完成或非法时明确显示尚未应用，不静默修成其他值。

删除变量/物品前检查Core真实引用、开局效果、场次、嵌套规则及self fixture；普通字符串集合的同名成员不算物品引用。规则与知情编辑保留其他语言及原高级字段。Undo使用删除前baseline与恢复候选比较，并保护其后改动；失效本地对象拒绝恢复、保留恢复入口。公开资料可能来自传递闭包，不以直接references列表否定原合法引用；权威闭包检查仍在构建中完成。

草稿Preview增加固定答案的本地逻辑预演，直接调用Core initStoryState/validateStoryState/evaluateCondition/enterScene/confirm/setPresent，不重写一套状态机。judge有真、假、未确定三值；手动答案与状态进入实际上下文预览。开局入场判定与当前判定分开保留，已开始预演不因当前答案改变而重新判断开局。显式confirm成功才写状态，重复效果不执行，停止结局后禁止推进；建议行动不写效果。合法预览变量可修改，但不改作者初值和Artifact。

预演沿用评级遮挡，换账号/根身份/semantic digest或开局时重置，不混用外部完整snapshot。本地预演无模型调用、不写Runtime会话、不代替独立Harness。Jev/Laya的模型决策与会话推进仍属于独立Runtime；本轮不改Core协议，不需要刷新已验收SDK快照。完整作者测试保存、资料分节/导航、协作与OAuth仍按原DOD推进。

### D-203 引用式资料库、同源分节解析与独立正文替换 — Accepted（落实 Story v1 §4/§17，2026-10-01）

World/Lorebook将Reference library放到主工作区，其他Creative在高级条目区复用。左侧All/Ungrouped/分组导航，右侧成员与正文；成员可多归属，嵌套仅写group引用。checkContentCollections公开为只依赖实际集合字段的纯校验，无关正文未完成不阻止合法目录操作；复用现有三层/无环规则。过滤FragmentsEditor只过滤渲染，仍更新完整数组。被引用片段不改ID/删除，移除后撤销不覆其他改动，缺失新的出站目标时保留Undo。

contentReferences按实际语法扫描groups、Story资料/知情/条件/效果、片段about/source及self fixture选择/正文/Trace。普通正文、外部作品和不同实例的同名ID不算本地链接；Source整体删除包括其分节引用。场次关联资料从真实本地目录选取，外部引用明确要求依赖并在构建中验证，不凭编辑器列表推断闭包。

SourceSections支持稳定ID、title/description/anchor/出处及局部恢复；生成标题必须先预览、确认追加，保留原分节/多语言。作者主动选择本地文件后按当前资产digest+size验证；不从任意digest拉取私有字节。Core listSourceHeadings/extractSourceSections复用materializeSourceText同一parser，后者仍先校验MIME/role/asset identity/digest，再返回正文；前两者仅本地作者工具，不成为授权证明。原字节摘要与规范化文本解析分开，BOM/CRLF、围栏、标题层级、NFC重复标题和text范围保持原语义。

替换文件先检全部既有锚点，再走真实ready上传，最后按当前Source/旧asset身份及当前sections重检一次提交。分配新slot，只将目标Source移过去；旧slot仍有Source/media引用则保留，无引用才移除其声明，不删共享CAS。新default只替换媒体类型和blob，保留旧license/rating/alt与其他variants，不继承旧locator。Undo保留其他metadata编辑；当前正文、sections或资产槽变更时拒覆盖并保留恢复机会。每个异步边界绑定render actor与操作身份，取消只停止本地绑定，不承诺回收在途上传。

本轮Core变更是共享纯校验/API提取，没有修改wire schema或语义。Harness继续固定已验证SDK快照，不将新作者工具出口冒称外部consumer已升级；后续有消费需要再发布新的不可变快照。完整about导航、角色视角入口、投稿协作/OAuth与最终DOD仍未完成。

### D-204 条目语义编辑、双向关联与受视角限制的作者预览 — Accepted（落实 Story v1 §4/§12/§17，2026-10-01）

FragmentMetadata提供本地化description、canon/rumor/claim/belief、SpeakerRef、Source出处、keyword selectable，以及高级outward和visibility。编辑未涉及的字段/locale保留；清空全部语言、替换声明有字段级Undo，当前字段或目标变化时不覆盖。outward放高级视角，已有声明自动展开；selectable需要说明且只在keyword上允许，改变激活前显式关闭，outward开启时不直接改成不支持的kind。私有/场次规则和知情仍由Core/Assembler决定，不把outward当授权。

Speaker picker使用真实user/self/slot/cast语法并过滤非法local edge，公开身份要构建解析。Source支持Core本地/显式source前缀、公开作品和cast作用域的Source/section别名；编辑器不以直接依赖列表否定间接闭包。外部引用显示待构建检查，不伪造已解析身份。出处不自动插入资料正文。

草稿about用稳定片段/参与者/作品导航：#fragment与本作@ref#fragment按同一目标反查，cast:key是参与者，cast:key#fragment仍是该角色作品里的片段。分组过滤只影响当前视图，跨组导航切到All并定位真实卡片。移除关联的Undo保留其他编辑，目标删除/角色换绑/外部依赖变化时拒恢复悬空引用；首次实现遗漏cast:#分支已独立审阅关单。FragmentsEditor更新按原稳定ID在最新数组中定位，只应用本次变更字段，防止过滤和旧render覆盖其他编辑。

PreviewRelatedLinks只消费真实同job ContextAssemblyInput及已解析catalog_index.about；两端均在当前可见且实际暴露的目录中才展示，不借trusted index主动展开group或泄漏隐藏标题、原ref、反向数量。参与者必须在场并满足viewOf；重复依赖按完整instance身份区分，不能用短ref合并。链接只focus当前产物内元数据，不fetch、不改selection/turn/消息。

预览补Optional entries，description先展示，候选必须通过fixedSelection同一校验，可通过其合法展开路径选材；required/direct不冒作可选。手动勾选沿原settings.selection进入真实prepareContext，keyword未命中但selectable时可选，manual/普通未命中keyword不能偷激活。Source选择、可选条目与相关目录均放在MatureGate内。仅导航已暴露目录与主动固定选材的展开行为明确区分。本轮Web消费既有契约，Core/schema/独立Harness快照未改。

### D-205 从真实预览保存可重放作者测试，精确输入贯通内容身份 — Accepted（落实 Story v1 §14.2/§17，2026-10-01）

所有Creative与Preset可附assembly_tests，Prompt Module保持不直接持有；公开JSON Schema同步。PreviewPanel只把同job成功结果与最终ContextAssemblyInput（实际策略/Profile/counter、完整TurnView、固定Plan和授权加载的Source原文）交保存。createPreviewFixture重prepare严格比较本次结果，再以固定引用/顺序重prepare验证消息摘要；保存不带含自身artifact_digest的Plan，content用root:self，Preset用preset:self及真实已发布content ExactRef，draft/local不伪装跨作品Release。固定实际策略ExactRef，不让后续默认策略静默更换本测试。聚合图同ref单Release约束保持，明确版本冲突不改期望。

作者显式保存新测试才取当前messages_digest建立期望；之后runner不自动更新。DraftPreview先核对render actor、当前working、操作锁及owner dbld有效期，候选按实际JSON {working}请求检查共享5 MiB上限，超限不写入本地。通过canonical schema准备后追加唯一ID并flushSnapshot确认，保存失败保留本地内容并说明未确认；成功提示单独跑作者测试。旧job/卸载/换账号后的通知不回填，新编辑和过期preview不能保存。界面说明并可查看固定选材及完整原文，包括未选章节，均属于可随作品发布的合成输入。

Core Creation规范化新增结构上下文精确域：fixture.session整个TurnView（含record keys）及source_texts原文字串。不能把原CRLF/NFD/尾空白归一；否则Source hash失配，且history go\r\nnow可能被改成go\nnow后新激活keyword。普通作者正文及公开normalizeValue继续原prose语义，伪造诊断path/对象键不能获得例外。精确域进入Creation语义摘要/manifest，各轮canonical保持一致。

原文契约贯通发布snapshot和Contribution：已canonical Creation外壳直接JCS，合并复制不重新normalize；normalizeContributionChange仅对应configuration assembly_tests结构采用精确域，configurationDigest在Core三方current/after、Web生产base_digest和Registry输入同步。仅换行不同的会话变更不能吞掉或漏冲突。build重复identity比较用canonical Creation精确JSON与规范化envelope；同Release不同精确fixture拒绝，普通prose规范等价允许。local-build原有digestJson(canonical JSON)保持正确，无需另一套摘要算法。

这是无用户阶段有意采用的规范化契约修正，含相关raw输入的作品摘要会改变。Source材料不改原文件、不把旧normalized数据假装恢复原字节。Node/Chromium/workerd用同一实际fixture回放验证；独立Harness仍固定旧SDK快照，尚未据此宣称升级。完整授权协作、跨作品多角色发布与最终验收仍按DOD推进。


### D-206 作品级协作授权、许可同意与不可变版本署名 — Accepted（落实 Story v1 §17.7，2026-10-01）

个人 namespace owner 对单作品邀请另一位个人 namespace owner。授权记录独立于 namespaceMembers，acceptedAt 非空且确认的 license 必须与当前草稿一致；只有 acceptedAt 不足以授权，其他导入/Source 路径改变许可也必须立即使旧授权失效。owner 直接保存或接受投稿改变许可时主动清同意并更新邀请许可；其他路径留下旧邀请可通过重新邀请更新。相同许可重邀保留已有同意。邀请及署名使用公开 namespace 或公开用户 ID，不自动公开 OAuth 登录名称。

个人 namespace maintainer 不再具有作品 owner 权限；system namespace maintainer 保留显式平台维护能力。owner 负责发布、可见性、敏感内容声明、GitHub source、管理协作者和删除；accepted collaborator 可普通编辑、dbld、私有读取和审阅投稿。直接 PUT 与接受 Contribution 共同保护 authors/provenance、license/rating/rights/warnings/contribution_policy 和资产显式 license/rating。服务器追加已接受投稿的权威 contributor 不算协作者伪改 provenance，其余字段仍比较。

每个私有数据面需要作品权限与当前凭证 scope 的交集：公开父作品不豁免 private proposals 列表，me/creations 在 SQL LIMIT 前过滤真实 owner 或当前有效协作，防先取500条后过滤造成遗漏。中央 account.list_creations 动作要求 creations:read。UI 使用 CreationDetail permissions，不从 namespace 名字推导权限；同一规则用于编辑器与投稿审阅入口。

邀请接受/撤权/PUT/Revision/dbld 采用 creation→draft/build 的锁序，并在获得作品锁后读取当前权限；worker 再检查请求者状态。不同 requester 的 pending 构建不共用授权生命周期。撤权阻止新的签名/读写，不承诺撤回已下载内容或仍在 TTL 内的签名，不删除 CAS。工作资产 grant 只收录实际声明且 actor 有权上传的 ready digest（包括已处理衍生文件），不把上传历史或 namespace 作为资产授权。

creationContributors 记录实际协作者修改，Revision 创建时固化公开 handle 署名到 revisionContributors；Registry Release 元数据读取该快照，版权 authors 保持独立。撤权及登录名称变化不重写旧署名。OIDC source Revision 不盲目继承网页协作的署名。此处完成 Registry 元数据，不将其宣称为独立 Harness 的新消费验收。

Web 提供 owner 邀请/移除/重新邀请和个人设置中的明确许可同意。协作者无发布或敏感设置操作，审阅敏感提案交 owner；撤权后保存进入明确 denied 状态，停止后续队列、保留最新本地内容供复制。真实双账号浏览器覆盖该生命周期。并发版本冲突仍用409，按对象差异重应用尚在后续作者工作流范围。

本轮无用户阶段有意收紧旧 namespace-maintainer 权限，新增0016数据库迁移仅在隔离测试/E2E库应用；未生产迁移。OAuth 授权与Token撤销的后台持久证明、对象级剧情投稿和M5/M6剩余范围继续推进，不以协作切片替代整个M4完成。


### D-207 对象级剧情投稿、可信基线字段合并与实际结果审阅 — Accepted（落实 Story v1 §16/§17.6，2026-10-01）

Contribution新增story、story-order、cast、group、source。Story覆盖scene/beat/plotline/ending/start/choice/item/event/timeline/var/knowing；补上规范原先遗漏的choice和choices顺序、Scene.choices引用集合，避免现编辑器选项无法投稿。原fragment/edge/asset/metadata/configuration保持对应比较单位，不能把整个story塞进configuration冒充字段合并。新增结构化HTTP提交显式changes_version:1，其他版本或旧客户端不声明却使用新类型时拒绝。

Core mergeContribution(target,changes,baseCreation)第三参数是可信不可变基线，新类型必需。Registry按提案绑定的baseSemanticDigest从CAS读原Revision并校验存储摘要，不接收客户端自报完整基线。作品id/ref/type及每个原对象base_digest必须匹配；摘要只能证明一致，不能代替三方字段值。标题/说明/条件/效果等结构字段按整字段比较，Scene.goals逐cast键比较；引用集合分别应用增删及共同元素顺序规则，两边不同重排报告<field>@order。knowing的*和Scene.cast省略的全体语义不能当空集合；有效的constructor/prototype作者ID也不能因实现字典访问方式被误拒。

story-order不能新增或删除对象，必须覆盖提案对象变更后的全部成员且不重复。新Story对象可建立version1/scenes，全部Story对象明确删除且没有并发新增时才移除story；不能删除场次后把仍有其他结构的非法Story静默丢弃。修改只在完整结果静态有效时返回产物；冲突不部分应用。Core checkCreation统一核查本地资料/分组/片段/角色引用，不为merge复制另一套特殊门禁；外部闭包仍在build时核查。Schema错误、悬空、非法条件/效果与知情冲突作为invalid_result+具体diagnostics返回；深层条件在递归规范化前先检查限额。

投稿表单复用StoryWorkspace、cast编辑、资料分组与Source组件，helper双向保存story/cast/groups/sources/references/assets和既有配置字段。临时不完整字段保留在本地、阻止提交并显示诊断；未支持的字段或非Story列表重排明确报错，不静默丢失。现有文本片段移除会先列出引用阻挡。Story编辑器置于提交form外，避免内部按钮无意触发提交。

提交前及owner/collaborator审阅均可本地编译候选，依赖由公开API按精确Release读取并重算摘要/作品身份核验；不自动跟随latest。createLocalBuildInput产生真实local-build身份，PreviewPanel使用同一Core/Assembler输出实际消息与剧情预演，不写目标草稿或造Release。参考资料可从浏览器选择原文件，须匹配artifact文本资产digest，保留BOM/CRLF/NFD/尾空白；不上传正文，不用未授权的草稿正文接口。用户/稿件变化与迟到文件结果不得回填另一身份或版本。

当前私有稿的合并状态、current快照、draft_version与merged结果只给owner和有效协作者；投稿者看自己的原提案，不得借preview获取未发布变化。审阅After对新对象展示merged最终值，Before取同次merge的current快照；不能显示raw after却标为Will apply，也不能用另一时刻的独立草稿GET冒充同一基线。截图曾发现Scene时间在真实messages保留Midnight而卡片误显Evening，现以最终merged卡片断言和真实浏览器重验关单。接受仍由Registry重新读取、检查权限/敏感字段和版本并原子写Revision，不改变旧Release。

0017仅扩展持久化change_target枚举，迁移在隔离测试库和E2E库验证。更严格本地引用校验有意拒绝原先漏检的悬空定义，旧有效引用不降级；规范schema与Action分发随公开Core API更新。OAuth、Remix/续作、Runtime回流、Harness升级与完整最终验收仍属于原目标，不能由此宣称M4/M5/M6整体完成。


### D-208 Runtime OAuth 授权、完整初始草稿与排队凭证 — Implemented（按 D-171 落实，2026-10-01）

使用与现有 Better Auth 相同的 `@better-auth/oauth-provider@1.7.5` 官方插件处理 Authorization Code + S256 PKCE、opaque access token 和 refresh rotation。公开客户端由用户会话手动注册，回调精确匹配 HTTPS 或 HTTP loopback；不开放动态注册、secret、client credentials、OIDC/userinfo/email 或原生管理 HTTP。资源 scopes 为 profile、creations:read、drafts:write、contributions:write；offline_access 只许可离线续期。access 1小时，refresh 30天且重放使同族失效。OIDC 登录仍为 Verify，不把 OAuth 切片当登录完成。

Provider 的读改写放入同一个数据库事务，并按 clientId 获取 advisory transaction lock。授权码兑换、refresh、consent、撤销和删除客户端共享锁；重验当前 consent 与账号封禁，撤销同时移除 access/refresh/consent 与未兑换授权码。事务绑定 auth adapter，避免外层持锁、内层另取连接造成连接池死锁。协议使用库的验签与哈希，不自制授权码协议；只广告真正开放的元数据。签名查询串必须按浏览器原始字节传递，路由器解析结果不能替代它。

中央授权明确 OAuth 动作上限，scope 和用户真实作品权限共同成立才放行。profile 只回公开 TypeID/个人 namespace；私有读取含已存在 dbld/产物/实际 Source，但不含 raw draft。drafts:write 仅在本人个人 namespace 创建新稿，contributions:write 仅提交投稿；不能发布、PUT既有草稿、创建/删除dbld、管理协作或账户。Bearer 优先且无效时401，不回退 Cookie；普通 Better Auth 账号接口拒绝 Bearer。跨站协议表单与 Bearer CORS 不允许 credentials，普通会话仍检查可信 Origin。GitHub 发布 OIDC 保留独立验证入口。

新建作品 API 可带完整 working，canonical/check 后强制新身份、外层标题与公开 namespace 作者。OAuth 的真实 client_id 写入 creations/contributions 行，初始 provenance.client_id 与接受投稿后的 contributors.client_id；删除应用不抹历史来源。新作品初始许可/分级不等于修改已有作品授权；来源字段是描述性内容，不能充当凭证。授权管理与同意页由会话操作，异步响应按 actor/request 隔离，撤销不承诺回收下载内容或使旧签名URL瞬间过期。

PAT发起的dbld持久保存token行ID与入队scope，worker重查有效期/撤销/账号/作品权，并以当前scope与原快照交集执行；不存明文，不将scoped请求还原为完整会话。请求构建同时要求读写，不同token/session隔离pending复用。0018增加Provider表，0019保存内容来源，0020增加构建凭证并使无可信来源的旧pending/ready临时构建过期。破坏性影响已向用户说明；迁移只在隔离测试库验证。完整作者工作流、独立Runtime消费与最终DOD仍待。


### D-209 Remix/续作、精确来源依赖与独立剧情 — Implemented（按 Story §9.12/17.6，2026-10-01）

来源依赖和内容引用分开：derived_from可携ref/release/semantic_digest/relation精确身份，新增sequel关系；完整身份进入聚合依赖/锁/许可/评级/署名与Registry权限，但不进入Creative IR图或再次实例化源Scenario。旧只有release的导入备注仅展示，不变成授权凭证。这样Remix保持原约束，续作复制的角色是新作品的实例，不靠重复展开前作或新增借用cast语法实现。部分取代D-024只展示来源的规定：实际内容/策略/test单版本图与各份来源历史图独立验证，允许新作品升级依赖同时保留来源旧pins。聚合锁以Release身份保留多个历史版本，asset元信息与许可计算按确切身份，不能按ref错取旧/新版本。

Core deriveCreation从精确源定义与调用者分配的新identity准备草稿。Remix复制完整定义，原依赖pins与署名保留，相对依赖按原namespace绝对化、自身资料引用转新ref，作者测试保留原预期供重跑。续作复制可寻址背景、角色、资料与精确依赖；新Story只从静态vars/items/knowing初值和所选ending.effects起草，旧剧情事件、进度、开场白、作者测试不继承；assembly只有策略配置可继承。原scene作用域不放宽，必要旧scene只留id/title空场次供作者安排，避免自动把受限资料移到新场次。新scene不自动将所有背景设为lore，沿用原激活和渐进目录选材；复制定义不等于强制全文进上下文。

来源单独参与modified:true许可检查，源资产许可/评级保留约束；仅由来源可达的asset不得作为新产物下载字节公开。Registry新派生API只收source/kind/目标地址标题/可选ending/权利确认；重新授权active精确Release，追加新作者，真实OAuth客户端覆盖顶层client_id。0021持久verified source，后续PUT/Revision/dbld/publish不能删除它；资产grant限于新稿实际复制且源产物root声明的mirrored bytes。OAuth仍只有新草稿权限，私有来源还需read；无自动发布。

Web依当前精确Release与根定义/实际复制资产许可显示Remix/续作，非active版本隐藏；续作说明静态效果和背景场次限制，权利须明确确认。失败保留输入，账号/版本/关闭弹窗使迟到响应失效。完整端到端证据及本轮门禁在PROGRESS维护；不将派生工作流代替独立Runtime消费或最终全部DOD。

D-209发布索引补充：0022将release_locks唯一键细化到精确depReleaseId，release_fragments唯一键及worker索引包含digest，保留历史与当前同一片段的全部摘要；来源历史仍参与私有/下架/禁止改编与受阻字节检查，不能因不渲染而省略。迁移只改约束，不删已有数据。

D-209许可细化：派生修改的是根定义，不将全部聚合依赖一律标记modified。根许可须可改编；原字节复制的根资产须可再分发。未修改的ND Character可以继续被可改编Scenario引用；实际override和每个精确历史版本的许可由Core按对应操作检查。这样界面与服务端不误禁合法的现有组合语义。

### D-210 独立 Harness 的公开 Registry 消费 — Implemented（2026-10-01）

新增按稳定 Release ID 读取详情和产物的公开入口，复用已有 ReleaseDetail 契约、授权、缓存和生命周期语义。作品改名不修改旧产物根身份；当前详情地址与发布时精确 pin 地址分别解释，不让 Runtime 通过标签或私有数据库推断版本。草稿仍只消费既有 ready 构建，OAuth 不获得创建构建或读取可变原稿的额外权限。

独立 Harness 在现有 private runtime 包中提供 Registry client，安装真实不可变 SDK pack，采用标准 OAuth 库处理 PKCE 与协议；不新建产品 launcher，不跨仓导入源码。凭据只在连接内存，产物按收据摘要验原字节，Source 按 sourceRequests 渐进读取。CAS 跳转不带 Bearer，刷新轮换、撤销与处置须防并发复活；写回须有显式确认，不自动发布。

跨仓 E2E 使用测试专用子进程接收真实 loopback OAuth 回调，父进程不接收 token/code/verifier；随后进入真实 Loader、roleplayRuntime 和 JSONL，固定模型仅证明集成与持久化。此证据不等于线上模型质量或完整 Runtime 产品入口。安装新 SDK 前保存旧安装产生的实际 Replay/JSONL，历史快照保持原字节。实现与最终验收在 PROGRESS 分开记录。

### D-211 草稿冲突的对象比较与重新应用 — Implemented（2026-10-01）

按Story §17.7补普通作者的409恢复。Web保留最后成功保存基线与最新本地Working，显式读取服务器快照；以稳定对象身份分解差异，用户决定同对象双改的取舍，再用读取到的精确version执行普通PUT。远端单改保留，独立对象增删可并存，真正顺序双改另行选择；保存期间再冲突不能覆盖新版本或丢弃已选内容。

不将未完成Working送入Core Contribution canonical/merge：后者需要可信Revision、对象schema和完整静态校验，会改变或拒绝半成品。Web恢复只准备候选，不成为保存授权或校验权威。对象内部按整体选择，作者看到本地/最新/基线，不承诺文字级自动合并。原始作者测试和Source文本保持精确字节语义，未知字段保留，id/ref/type取最新服务器；不新增后端绕过接口。

读取、刷新、丢弃、重应用有编辑器实例与请求代次隔离，旧比较不能写新账号或新作品。重新保存409再次比较，422给可编辑候选和诊断，401/403/404停止并保本地复制。完整实现和真实双页验收记录在PROGRESS；此切片不替代M5剩余作者工作流验收。

### D-212 条件范围诊断与可移植 Story 一致性用例 — Implemented（2026-10-01）

补Story §9.3已有约定：对声明有效的整数闭区间，六种cmp运算符若对整个范围恒定则发story.condition_constant warning，定位到具体节点并说明true/false及范围。边界与单值域也检查，不能用两端相等误判区间内的等号/不等号。只是作者诊断，不改求值、不阻止保存；类型/范围非法仍按原错误处理。

按§14.2将求值、视角、Catalog/组装三类输入接入同一conformance bundle与draft/review/accept流程。纯runner真实调用Core/Assembler，输出逐步状态/错误、view原因与Catalog/Plan/messages/Trace身份。操作输入与输出保不可变；作者手写的关键断言和未审阅完整expected分别表达，执行生成结果不冒充人工真值。旧draft与新Story fixture都不得自动review或accept。

修订§21过时单版本表述以明确实际依赖域与来源历史域，不改D-209实现。现有SDK发布包/独立Harness快照的更新时间分别记录，不把主仓源码验证当独立已安装包验证。最终证据在PROGRESS维护。

### D-213 运行时精确快照身份 — Implemented（2026-10-01）

公开prepareContext与sourceRequests复现：history/focus只改CRLF/NFD/尾空白，通用digestOf按作者正文归一，旧Plan仍被接受；Selector实际输入和history消息已经不同。独立Harness探针也发现命令重试/Replay head、decision receipt与持久请求消息使用相同归一规则，原文变化可能未被身份校验发现。范围是运行时快照身份，不改变作者正文Canonical定义。

Core新增digestExactJSON，复用纯JSON验证、JCS与sha256，保字符串值和字典键，只保留JSON对象键序/undefined可选属性/-0的标准等价。Assembler的完整Plan输入绑定、Trace Plan摘要和最终消息摘要改用它；附件运输URL继续按既有消息身份定义排除。已canonical数据摘要不变，不为变更普遍重写旧记录。

Harness使用同一公开helper修正运行时拥有的输入、命令、事件/消息、幂等和决策证据。无schema结构变化不造持久化ack或改已提交generation；含旧规范化摘要而无法通过新精确校验的记录明确拒绝，保原文件，不fallback旧算法或重算head。升级guide说明备份及显式新Session流程，实际历史代表样本须重新验证，不能仅凭类型兼容推断。

可移植206复用此前成功场景的完整Plan验证文本变化拒绝与键序变化可重放；plan_from仅为fixture执行器引用已成功结果的工具，不成为Creation或Runtime语法。所有规范expected继续人工门禁，不自动改期望吸收摘要变化。最终证据在PROGRESS维护。

### D-214 作者预览来源与原生非文本编辑 — Implemented（2026-10-01）

作者预览把同一次startSession返回的opening及其来源与实际Turn/history一起保留。scene.opening是场次上下文，不补成assistant首句；显式提供完整Turn时不再初始化/猜测opening。当前草稿构建的来源可以定位到同作品真实对象和字段，自动展开Story视图/资料分组；草稿修改后旧产物仍保原文，来源按钮禁用，重新构建后恢复。编辑器打开默认语言字段，保其他翻译，不根据预览语言改作者默认语言。Preset预览引用的外部作品与公开产物不伪装成本地草稿来源。

定位使用稳定对象ID，语义[ID]与schema点式数组下标分别处理，只定位当前存在且唯一的对象；未知对象退到容器。每次定位请求只消费一次，完成后作者可自由切页签/分组，不被旧请求拉回。依赖作品来源不越过身份边界猜本地对象。

Fragment的text/dialogue/media/structured和locale变体在原生编辑器表达；media引用已有context资产及变体，不扩展上传类型。替换内容显式操作并可局部Undo，后续修改/依赖变化不得被Undo覆盖。structured JSON先编辑缓冲，再Apply或Discard；未应用数据不进入Working，明确阻止构建、测试保存与发布，离页确认，折叠/过滤保留缓冲。Basics不会以空text覆盖已有非文本内容。

消息预览按真实profile能力展示附件元数据或alt文本；锁定产物的profile仍锁定。Trace详情展示编译源定义，不能把默认源内容冒称已选语言的最终消息；图片单独入选可为0文本token仍存在附件。附件身份展示不自动获取运输URL，Runtime的视角过滤及隐私Trace边界不因作者界面改变。本切片无Core/SDK/schema变化，不重打包独立Harness。最终证据见PROGRESS。

### D-215 作者目录诊断与消费 Trace 分离 — Implemented（2026-10-01）

草稿预览和本地投稿预览显式启用独立作者目录面板。面板从实际本轮输入的createPreparationCatalog读取required/direct、受预算和深度约束的初始candidates，以及fragment/source的visibility原因；不把内部nodes全集冒充已展开目录，不读取Source正文，不生成选材Plan。Story角色目标等未纳入visibility的对象不伪造诊断，当前面板明确其隐藏列表覆盖片段和资料。

最终消息的Trace统一采用consumer projection，包括未锁定的公共预览。隐藏对象标识、标题、原因只出现在已授权创作产物的作者检查面板，不通过diagnostics:'author'回填Runtime Trace，也不写入Selector、Plan或作者测试。面板置于现有评级/账号/job边界内，当前视角改变后按新输入重算，失败显示真实目录错误而不放宽预算。公共PreviewPanel默认不开作者检查；DraftPreview与ProposalPreview显式启用。不改变Core/Assembler协议或Runtime隐私规则。

### D-216 Runtime 本地 Ending 提案与显式投稿确认 — Implemented（2026-10-01）

闭合一条真实回流路径：已发布Scenario的真实持久Session→外部模型或用户整理的单个新Ending→本地审阅→明确权利与内容确认→一次OAuth投稿→原作者Web审阅/接受。独立Harness负责Session和本地提案；char.pub继续只接收静态对象变更，不托管模型/游玩。完整续作携运行态的初值映射另需实现，不能用现静态derive代替。

使用既有releaseSource精确发布源返回的Registry Revision与canonical作者定义，复用公开Core对象canonical/merge/check，生成新Ending及明确集合顺序，不复制Web通用diff算法，不造scene.endings等不存在字段。只新增不存在ID；不自动把当前状态写成源作品初值或自动注入条件。分级、提示和许可保留原版本metadata；服务端按当前适用许可再检查，客户端不承诺精确许可pin。

候选包含实际将提交的请求、目标当前地址、精确Release/Revision/源码摘要、原版本metadata与本地committed head身份；不会把Session/history/Source/Plan/凭据塞进请求。工厂绑定候选实例及精确JSON摘要，提交时检查候选、权利声明、Session已提交head与授权代次，只有明确新确认才派发。授权变更须在最终POST前经过await access再次核对，避免同一客户端改账号后沿用旧确认；刷新同主体不等于换账号。工厂固定捕获Registry与inspect服务，不能在候选准备后替换服务容器、借相同数字代次换到另一客户端。Session以提交前本地重读时的head为校验点；通过后提案仍绑定该已确认历史快照，不承诺网络等待期间冻结Session或保持全程最新，后续游玩不暗改提案。

同步锁定一次候选的派发，取消/双击不产生重复提交；派发后成功、失败或结果未知均不自动重试同候选。进程内防重复不是跨重启幂等凭据，不新增持久化协议或伪称Registry提供了投稿幂等键。实际HTTP请求和Web接受证据、失败及取消反例见PROGRESS终态。此切片完成独立库的单Ending投稿路径；确认RPC不是成品Runtime GUI，也不代表完整聊天自动整理或携运行态续作已完成。

### D-217 Runtime 合成预览输入的本地交接 — Implemented（2026-10-01）

以独立RuntimePreviewInput承载完整已提交Story状态、用户明确提供的合成history/bindings和实际组装profile，不直接序列化Turn或Session日志；不沿用生成前prepared_turn猜当前状态/视角。交接固定完整BuildRef、lock、精确产物JSON摘要、Preset和tokenizer；任何跨Release/dbld/local身份变化先拒绝，不自动转latest或root:self。

Core提供严格schema/type/1MiB上限及JSON Schema，Assembler提供无IO、无时钟的结构/身份校验。Runtime独立库的prepare/export绑定真实Session已提交head与候选摘要，文件不含Sessionid/head/确认标记。用户主动整理history、绑定与视角，状态中的变量/knowing也可能私密，应全文审阅；不以白名单保证用户自己写入的文本绝无秘密。

Web按当前已授权产物本地读文件，先审阅再确认Load；旧file读取、账号或产物变化、另一文件使确认失效。载入使用完整turn+真实profile/tokenizer，不再开局初始化；隐藏旁路Session/Rehearsal控件防止看似可改但实际无效。新选材从空集合开始，仍可显式选资料；Exit恢复旧设置。导入与保存作者测试分开，只有当前有效dbld/未改草稿才能按现路径保存root:self并worker重跑；旧Release不静默移植到新draft。

本切片无新增HTTP接口/托管游玩/自动迁移。共享SDK以新固定snapshot接入独立Harness，保留所有旧SDK和Session日志字节；最终真实浏览器及门禁见PROGRESS。匹配dbld的导出/导入/独立保存作者测试闭环已验证；跨版本重映射与完整Runtime客户端仍不是本切片完成项。

### D-218 从已审阅的当前局面起草续作 — Implemented（2026-10-01）

运行状态转创作使用既有受授权的派生入口，仅向sequel增加from_play。请求白名单为当前scene、present、完整vars与knowing、明确整理的新opening；与静态ending互斥，Remix拒绝该字段。外层source仍绑定精确发布定义，Registry检查实际Artifact根身份。该请求创建新的作者起点，不证明历史真实，也不承担原Artifact/Session的无损恢复，因此不增加执行产物摘要、聊天记录或Runtime日志字段。

新Story保留当前scene ID和背景关联，用present设置cast，用vars.init和knowing.start表达已审阅局面；不复制旧start.set、knowing.enter、场次条件/目标或可执行剧情。原opening由新文本替换；bootstrap、旧进度与作者测试清空。其他背景/Style引用的场次保留空场次，不放宽作用域。保留旧剧情的状态Remix/无损续存仍是独立未完项，不能把当前单续作切片作为其验收。

独立Harness使用固定Registry与committed Session读取器准备候选，展示完整请求、目标、来源、许可和重置语义，再单独确认提交。沿用候选实例/精确摘要、head/state、授权代次与一次派发规则；不在本地伪造服务端尚未分配的Creation身份，不走createWorkingDraft绕过来源约束。提交只产生本人新私有草稿，不覆盖原作、不发布、不修改原Session。

agent标记描述创作历史：明确agent请求或agent PAT只能追加true，省略/false不清除源true。OAuth本身不等于AI，真实client_id由服务端身份写入。Web展示已有agent标记和精确派生来源，普通编辑不自动清除，也不添加额外发布确认。Core/Registry/Editor专项、独立Harness及真实OAuth派生→Web编辑→worker预览闭环均已通过，最终证据在PROGRESS维护。该结果不代表完整Runtime客户端或模型自动整理质量验收。

### D-219 按原始成功标准审计剩余范围 — Recorded（2026-10-01）

完成D218后用VISION/S1–S7/U1–U9、完整Story规范与当前源码逐项对照；历史PROGRESS中的反复待办不是新增用户要求。独立Harness VISION与H1/H2明确基础准备、最小消费入口且不承诺完整游戏客户端。撤销历史进度口径将默认Web/SDK分发、完整客户端与自动模型开局receipt作为本次硬完成条件的扩张；保留这些实际限制和后续Runtime路线。spec8.2/9.5所要求的纯开局、多开局显选、真实greeting/locale、先检查scene.when及未知判定拒绝/显式judgments重试仍须验证，不能因没有自动模型开局而删掉它们。

归档创作流程确有“续作或Remix以当前局面为新起点”，因此Remix去向仍待按该用户流程核对；未找到“原剧情与全部Session历史无损续存”的原始承诺，不将该更强语义默认为完成条件。D218只证明续作新起点，并未证明状态Remix已实现。

Laya已从原项目和模型卡找到匹配候选NandhaKishorM/laya（convaiinnovations/laya），以此作为实现假设，原生HTTP与客户端源码证据见scratch。尚未完成adapter或实际推理，不能仅因其宣称Jev兼容就把换baseURL当作接入成功；需独立provider身份、真实响应字段/限额与既有证据回放。该候选选择可替换，不声称用户已确认仓库。

### D-220 可见目录线索与视角优先级 — Implemented（2026-10-01）

规范4.3/13.2承诺about作目录线索，旧Catalog完全丢弃perspective/about/activation_hint，造成作者已写的相关性描述无法帮助Selector。片段候选现在携已声明的perspective、实际keyword/semantic模式及从resolved index投影的about；只保留当前视角可见且同实例的目标，参与者还须在场。不可见的claim/belief归属省略整个属性，不冒改canon；关联线索不激活或展开目标。初始目录、展开、预算与Plan摘要使用同一DTO，无另行未计费模型输入。

viewOf按12.2第一命中规则报告原因：他人goal先于不在场，知情/private先于其他角色Style。Style替换按第10节先去除已被替换层，场次与参与者在场范围为结构过滤；规范表补清此规则。该修正会改变部分withheld计数/目录摘要，不能重写既有Session或伪称旧Plan全部兼容。公开SDK与独立Harness实际消费、历史恢复边界另行验收。

新7877e378 SDK已通过独立Harness实际消费与118项相关回归；三代历史代表样本原字节保持，未重算Plan或head。Jev可见请求快照仅两处新增keyword activation_hint，审阅实际diff后更新该测试快照。双语升级说明位于独立仓roleplay-catalog-metadata指南；代表样本通过不承诺所有旧目录Plan兼容，证据见PROGRESS。

### D-221 以实际构建审阅实验能力并发布固定版本 — Implemented（2026-10-01）

落实Story2.1/17.5已有作者确认要求。PublishDialog打开后通过saveSnapshot/buildSavedDraft取得真实ready Artifact，从其capabilities列出实验项；普通作品不增加checkbox。确认绑定账号、草稿精确内容和构建收据，最终发布receipt.origin.revision，不再另建可能来自更新草稿的Revision。构建失败/过期可重新准备，raw JSON未应用仍沿现blocked与saveSnapshot守卫；不新增后端approval字段或SDK/API普遍许可步骤。

发布前须同步核对即时账号和到期状态，render时ready不能替代该检查。关闭、改稿、换账号使旧确认失效。幂等键沿用revision/label/visibility组合；网络结果未知不声称未发布，也不重置原键，用户可显式核查/重试同一请求。新准备仍需要新的明确Publish操作。作品页实验标识仅来自当前精确Artifact，不猜未加载或其他版本。新增真实浏览器验证未确认零POST、确认后精确revision及匿名实验标识；完整项目最终门禁仍待剩余规范工作，不能据此标记整个M5完成。

### D-222 独立Laya适配与概率弃权 — Implemented（2026-10-01）

以公开匹配的上游NandhaKishorM/laya、固定HTTP/router/confidence协议源码为候选接入。独立Harness提供createLayaDecisions，provider为laya/systemone；Jev仍用官方SDK及原有身份/配置/请求语义。两者只共享私有Noul判断、渐进选材和证据流程，不把Laya冒标为Jev，不在char.pub引入网络、模型凭据或会话。

Laya配置明确选择english/multilingual/typed-decisions或auto，记录响应的实际model/routing；显式选择与实际routing不符时拒绝该结果。上游low_confidence即使伴随高noul也转为undetermined，选材不选不展开；不得把上游弃权变成确定事实。问答数、状态字符、请求/响应字节、max_len/head_max_len和概率策略均明确配置并进入非秘密证据；局部字符与SDK估算预算不证明上游分词窗口完整覆盖。超时、取消和无效响应沿现未知/skip语义，响应体停发也主动取消reader，不因清理等待而卡住，不自动重试模型请求。

实HTTP仅为本地loopback与固定概率替身，验证transport/codec/完整记录/Plan回放；未下载模型权重或调用在线推理，不声称质量、阈值校准或实际模型运行已验。沿现DecisionRecord结构记录实际请求和已验证响应，地址只存摘要，凭据不入记录。没有增加Session事件或改历史generation；新增公共导出导致当前派生持久目录的来源行号变化，类型hash/语义不变，工具确认changes=[]后仅再生当前工件。完整回归及文档证据见PROGRESS。

### D-223 多角色作者建议与资料共享 — Implemented（2026-10-01）

按12.4从真实ContentArtifact生成不共享资料、缺公开外观与goal知情建议，只放在作者且评级已放行的检查区，不进入消费Catalog/模型输入，不增加发布阻塞。goal仅列条件性建议，不自动判断语义或调用模型。参与者按实例区分；late绑定的outward_description和真实角色outward片段均计入。预览Session增加公开描述字段，完整description仍私有。

一键shared只修改当前精确构建对应的根资料；引用作品资料显示所属作品，不伪改依赖。账号、工作稿、构建到期及编辑器接受更新在操作时核验；修改使旧预览/发布审阅失效。撤销仅恢复同一资料未再次改动的内容，并保留其他字段的后来编辑。草稿预览与纯helper已验证；W1真实发布浏览器链另验证shared→旧审阅失效→重建→固定新Revision发布，完成W3切片，不代表整个M5已验收。

### D-224 作品页使用完整构建元数据 — Implemented（2026-10-01）

作品页的评级解释、许可、署名、内容提示与依赖锁统一读取匹配所选ReleaseID和语义摘要的Artifact。Creative IR只辅助内容图展示；来源与策略可只出现在完整闭包，不允许据IR部分数据解释整体评级。等待Artifact时保留Release.effective_rating，不短暂降级；失败/旧版缺完整Artifact明确展示不完整并提供适用重试。

完整能力列表来自实际Artifact。锁内同作品不同精确Release独立保留；无法映射准确标签时不链接到latest。元数据读取不附带Source正文下载。真实构建fixture复现修前评级解释错误，修后15项组件测试与类型/格式通过，证据见PROGRESS；本切片不代表整个发布/试玩旅程已验收。

### D-225 发布前完整定义分类比较 — Implemented（2026-10-01）

发布审阅绑定本次保存快照和明确选定的前一发布基线，精确读取并验证作者定义与Artifact，而非用Creative IR替代完整定义。按稳定对象/字段显示正文、description及结构变化，覆盖作者元数据、开局与Source资产字节变化；比较不下载资料正文。基线加载失败、账号/草稿/基线变化或到期时废弃旧审阅；历史ref改名不是身份不匹配。最终仍发布已审阅Revision。真实浏览器R1→三类编辑→审阅→固定Revision发布已通过，未新增审批后端。

### D-226 按读取权限分析对象引用影响 — Implemented（2026-10-01）

Core纯函数从真实Artifact与发布Snapshot分析删除对象，ID改名按remove+add处理。Registry作者专用接口以真实dbld Revision和同作品基线为界，release_locks只作候选筛选，实际包含和显式引用分别列出。只分页当前可读下游；中间定义来源另授权，底层异常不向客户端暴露嵌套身份。不可读下游不影响计数/游标；无新表/后台服务。旧锁保持，报告不预测模型实际选材或全部动态行为。

Core6项、真实DB4项及发布全栈1项通过，缺快照/完整性/授权变化不能伪装无影响。新public helper随真实SDK分发，未改变Artifact/IR/历史Session结构；本轮SDK消费的最终全量回归仍待后续W4冻结。

### D-227 平台到独立Runtime的启动交接 — Implemented（2026-10-01）

平台提供公开作品“Start playing”和当前草稿“Try draft in Runtime”；后者先保存并完成真实草稿构建，再选择目标Runtime、开局、语言和视角。目标是用户明确配置的真实launch URL，不从OAuth callback推断，也不虚构已部署的官方地址。锁定assembly的视角保持；多开局明确选择，角色使用真实participant实例key。

跨仓RuntimeLaunchRequest放在Contracts，是严格静态定位信封：format/version、Registry规范origin、精确Release或dbld的root身份、lock_digest、locale、可选start及view。不携凭据、正文、Session、bindings或approved标记。通过目标页URL fragment传递，平台不开聊天API、不托管会话。Runtime核对本地既定Registry配置并独立OAuth，再校验精确产物/到期/能力，用户明确开始后创建Session；新dbld提示新会话，不改旧日志。HTTP仅允许loopback开发，其他入口用HTTPS。

独立Harness通过named dsh profile加可选loopback app，不新增package bin。当前consumer的Session要求Story，入口明确只支持带Story的Scenario；其他内容由支持它的Runtime消费，当前Harness明确unsupported，不伪造剧情/迁移旧Session。真实模型由本地配置的已有provider承担；离线固定provider验收不能声称在线质量通过。实际dsh→公开compiled app→平台/OAuth→生成→新dbld重开→旧tab拒绝与日志保持链已验收。入口还明确限estimate、文本与noneSelection，未启用已独立存在的Jev/Laya适配器、自动剧情动作或开发者变量编辑，不把入口闭合宣称完整游戏客户端。

### D-228 选角来源与现场创建的完整发布路径 — Implemented（2026-10-01）

ArtifactPicker支持搜索、本人作品和收藏；先选作品，再选实际active Release并校验精确产物，草稿不作为依赖。收藏按当前账号保存作品身份，不是版本锁或额外授权；读取与分页重新过滤已失去权限的作品。复用现有唯一收藏表，无新迁移。

现场Character创建收集作者明确选择的评级、权利和许可，按已有working请求原子保存，读取真实Draft，再复用发布审阅。发布成功后作者另选具体Release才回填Scenario；关闭后保留可恢复草稿，不自动发布或删除。切换来源/账号后迟到响应不回填。真实浏览器创建Scenario→现场角色→发布→精确回选→刷新→收藏重选持久链通过，证据见PROGRESS。

### D-229 已接受agent起草来源不可由普通编辑清除 — Implemented（2026-10-01）

最后范围审计发现agent Contribution的数据库row保存标记，但接受合并未将它投影到草稿，普通owner保存也可遗漏已有authored_by_agent。按17.9补最小历史保留：接受agent=true投稿后将草稿authored_by_agent单向置true；人工投稿不制造agent参与；普通保存删除已有true时返回422，原稿/版本不变，保持请求与服务端摘要一致。client_id只记录真实OAuth来源，贡献者引用和派生精确来源独立保留。owner及协作者接受→普通编辑→Revision→worker发布源保留标记已通过真实DB验收，不改变Schema。

### D-230 明确agent PAT不能直接发布 — Implemented（2026-10-01）

17.9的禁止发布同时适用于principal.agent=true的PAT。集中authorize在可见性/原scope检查后拒绝creation.publish，即使该token含releases:publish且属于owner；不预留Release或标签。普通未标agent的CLI/CI Token与既有受绑定OIDC沿原发布权限。创建Token的UI说明限制，勾agent时去掉并禁用发布scope。此为已有agent令牌权限的破坏性收紧，已向用户同步，不涉及生产迁移。

权限矩阵217与真实API20项通过；新集成证明agent读稿仍可用、发布403、owner可立即使用同标签正常提交。服务端/Web类型通过；不把本规则误说为平台能检测所有模型使用，也不在请求中增加通用审批标记。

### D-231 半成品工作稿的本地 AI 候选审阅 — Implemented（2026-10-01）

补齐17.9五类辅助任务在未发布工作稿中的路径。平台生成仅含选定对象及作者提供上下文的文件请求，作者在外部服务生成候选，再导入或粘贴；不托管模型或凭据。请求与候选绑定作品、完整Working精确摘要及任务摘要，使用任务专属严格schema，不接受通用写入指令或自称批准字段。Review零写，独立Apply经普通编辑器/If-Match保存并标记agent参与；内容、身份或候选变化后重审。

资料原文件须核实际bytes；人物外在与内在拆分保留原私有元数据，扩大受众需明确选择；新增Beat同批关联指定Scene。不完整稿使用真实局部引用/条件/集合检查，不伪造CanonicalCreation或绕过服务端。Undo只恢复本次修改，拒覆盖后来修改或造成新悬空，保留agent历史。普通协作者仅可单向增加authored_by_agent:true，其他敏感来源字段仍受保护；该标记是作者声明，不是平台认证模型身份。

五类本地流程53项相关回归、协作来源20项真实DB及真实浏览器下载→Review零PUT→Apply→刷新持久链通过。公开局部引用检查接口随固定SDK交独立Harness，131项消费回归通过。固定候选不证明在线生成质量；具体命令与日志见PROGRESS。

### D-232 本地启动须能完成真实创作消费动作 — Implemented（2026-10-01）

用户实操证明health200不能代替本地可用。标准pnpm dev在本地数据库/存储范围内通过真实发布流程准备并固定开发用默认Preset，复启复用同版本；显式DEFAULT_PRESET优先，其他环境必须明确配置，不引入生产隐式fallback、不发布待人工审阅的Commons内容集、不覆盖既有非本脚本管理作品。缺默认策略时作者界面明确说明服务配置原因，不能引导用户反复改稿。

RuntimeLaunch保留新标签页操作，并增加同一校验与精确信封的当前标签页入口，供弹窗受限宿主使用。独立Harness空入口提供真实Registry链接及操作步骤，手动JSON归高级区；页面和表单明确前景/背景，避免透明页面在深色宿主变成不可读的黑底黑字。真实工作区浏览器从创建与保存草稿、构建、跳转、授权读取到开场和回复框均验证；无模型key，未冒称生成质量已验。规范人工expected/Commons门槛继续独立保留。

### D-233 显式玩家控制与独立的玩家界面投影 — Implemented（2026-10-05）

Dogfooding暴露role:user虽表示控制分工，却没有唯一的Session控制映射；角色姓名与Persona正文不能补足这一契约。新增可选story.player与experimental能力story.player-control，只对主动声明作品要求根cast中恰有一个role:user且与该key一致。Core解析到原有participant；新的玩家输入显式带受控speaker，Assembler拒绝错绑user history并注入必需且计预算的控制声明。隐式user、late Persona与模板原义保持；旧Artifact/Session不推断、不迁移，Remix/Sequel保留显式关系。

玩家界面使用Assembler纯projectPlayerView，从受控cast自己的per-agent视角只投影当前场次、在场NPC公开信息、显式已知且当前可见的knowledge、Core可用Choice和已达成公开里程碑。portrait须显式outward并符合视角，late只读outward_description；无公开画像则省略。NPC私目标、原始变量/条件/判定提示、未来人物和未获知资料不进入DTO。旧无player的作品保守使用implicit user，presence未知且known为空。该helper不调用模型、读取Source或把目录可检索当成玩家已知；可读资料的自然语言质量仍属于作者责任。

同时按既有契约修DF06/DF07：selected仍是最终正文权威，但ref的最后显式reject不得与入选正文矛盾；保留缺select记录的旧Plan与增量/skip记录。initialStoryTurn与startSession多开局均须显式start。全Core/Assembler 970项、三运行时conformance 322项通过（105项既有todo保留），类型/schema/格式通过；没有改conformance expected或历史SDK快照。固定SDK交独立Harness消费，本决策不代表真实模型质量或生产部署已验收。
