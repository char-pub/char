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
- char.pub 作为 OAuth / OIDC Provider（“Sign in with char.pub”）：**Deferred**。

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
| O-7 | Preset 的 Canonical 结构（v0.5 前） |

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

Admin 使用独立的子域（`admin.char.pub` + `admin-api.char.pub`）和独立的 `admin` 进程，公开的 `api` 进程不挂载任何 admin 路由。防护分三层：Cloudflare Access、应用内员工会话 + 角色、强制 TOTP 2FA。详见 `docs/design/admin.md`。

> 2FA 部分 Superseded by D-120（2026-09-22）：v0 的多因素认证由 Cloudflare Access 负责，应用内不做 TOTP。

### D-114 Staging 域名 — Accepted

staging 使用 `char.pub` 的一级子域（`staging.char.pub`、`staging-api.char.pub` 等），好让 Universal SSL 证书直接覆盖。环境之间靠 host-only cookie、严格的 Origin 白名单和互相独立的凭证隔离。

### D-115 O-1 / O-2 的实现取值 — Accepted（规范仍为 v0-draft）

实现按草案的倾向取值：canonicalization 使用 RFC 8785 JCS + Unicode NFC + 行尾统一为 `\n`（canonical-model §14）；`namespace` / `name` 只允许 ASCII slug，另设 `display_name` 支持任意 Unicode（canonical-model §2.1）。这些取值在 IR 冻结（D-054）前仍可修改，修改时必须同步更新一致性测试集。

### D-116 先完成 DoR，再写代码 — Accepted

实现开始前，`docs/goals/v0/` 下的 VISION / DOR / DOD / LOOP / PROGRESS 与 `docs/design/` 下的架构、安全、Admin、测试文档必须就绪，由用户确认后才进入编码。


### D-117 OIDC 发布必须先安装 GitHub App — Accepted

通过 GitHub Action（OIDC）发布的仓库，必须已经安装 char.pub GitHub App 并完成 Source Binding。Registry 用 installation token 在 OIDC `sha` claim 对应的 commit 上重新读取源文件并重算 digest，与请求不一致时拒绝发布；不采信 Action 上报的摘要（D-074 “Build at Source, Index at Registry” 的补充）。

OIDC 的信任边界：token 只能证明“绑定的仓库在允许的 ref 和事件上运行了某个 workflow”，不能证明运行的是 `char-pub/publish`。服务端校验清单见 `docs/design/security.md` §4.4：`aud` 固定为 `https://api.char.pub`；`event_name` 只允许 `push` / `workflow_dispatch` / `release`，拒绝 `pull_request_target`；`jti` 一次性；请求的 commit 必须等于 `sha`。另外修正一处事实：GitHub OIDC token **包含** `sha` claim（2026-09-22 核实）。

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
