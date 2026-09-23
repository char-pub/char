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

### D-156 web 重新设计：信息架构、品牌视觉与配套接口 — Accepted（用户决定，2026-09-23）

1. **范围**：重组信息架构、换成品牌视觉、统一组件，同时补上服务端已支持但 web 没有入口的功能（yank、作者主页、GitHub 绑定状态、namespace 改名、移动端导航、全局搜索），以及服务端缺的接口（公开举报、贡献拒绝理由、按 @namespace 邀请、搜索按 namespace 过滤）。设计依据是 `docs/design/web.md` 与 `docs/design/web.pen`。
2. **视觉**：向 `vendor/brand-assets` 对齐，取代 2026-09-23 “配色与字体暂不改动”的要求。浅色为主：Sand 底、Ink 文字，深色用 Night；主操作是橙底配 Ink 文字（橙底白字对比度不够）；危险操作用单独的红色，不再和强调色混用。品牌的三个节点色固定对应作品类型：Character 橙、World 紫、Lorebook 蓝，卡片、徽章、依赖列表、token 占比条都按这个规则着色。字体换成 Plus Jakarta Sans 与 JetBrains Mono，用 `@fontsource` 自托管，因为 CSP 不允许第三方字体。logo、字标与 lockup 直接引用子模块文件，不在仓库里复制。
3. **作品页结构**：作品的公开页面收进一个外框（头部加标签页 Overview / Context preview / Versions / Contributions / Settings）。版本对比并入 Versions，旧的 `/diff` 重定向过去。贡献开放度与邀请只在 Settings 标签里设置，编辑器不再提供这个入口；草稿里的 `contribution_policy` 字段原样保留。作者主页是 `/c/$ns`。
4. **界面语言**：只做英文，排版给中日文留出长度和换行空间，以后再接 i18n。
5. **主题**：浅色 / 深色 / 跟随系统三态，默认跟随系统。为避免首屏闪烁，用一个同源外链脚本在渲染前设置主题（CSP 不允许 inline script）。
6. **邀请名单只显示 @namespace**：按 @namespace 邀请之后，作品所有者可以邀请任何有个人 namespace 的人，而 OAuth 显示名可能是真名，所以邀请名单不再返回 `display_name`，与“默认署名不用 OAuth 显示名”的规则一致（D-148 第 3 条）。
7. **公开举报**：`POST …/reports`（作品）与 `POST …/releases/:label/reports`（版本），原因分六类，与 admin 举报队列一致。匿名举报必须通过 action 为 `report` 的 Turnstile，访客验证的 token 不能混用；看不到的对象与不存在一样返回 404；成功一律 202，不透露后续处理。匿名举报复用访客验证的 Turnstile 配置，没有配齐时返回 503、提示登录后举报（用户决定保持这个做法）。
8. **GitHub 绑定**：web 只显示已有绑定的状态，冻结时可以确认继续使用或解绑，也可以直接解绑。新建绑定需要 GitHub App 安装流程拿到 installation 与仓库的数字 ID，web 还没有这个流程，页面上只做说明，不提供手填 ID 的表单。
9. **设计文件入库**：`docs/design/web.pen` 里有 Pencil 写入的 `fileToken`（文件的 UUID），gitleaks 只对 `docs/design/*.pen` 的这个字段放行，其他文件和字段照常扫描。
