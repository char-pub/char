# char.pub 架构设计（v0）

> 状态：Draft，2026-09-22。规范依据是 [`DECISIONS.md`](../../DECISIONS.md) 和 [`spec/`](../../spec/)，本文只描述**实现架构**，不重复规范内容。
> 与本文互相引用的文档：[安全设计](security.md)、[Admin 控制](admin.md)、[测试策略](testing.md)、[技术选型依据](../goals/v0/DOR.md#technical-readiness)。

---

## 1. 系统上下文

```text
                     ┌──────────────── Cloudflare（边缘） ────────────────┐
 创作者 / 访客 ─────▶│ www.char.pub      Workers Static Assets（Vite SPA）│
                     │ assets.char.pub   R2 public 桶 + CDN（只读）         │
 Runtime / Agent ───▶│ api.char.pub      Proxied → Railway api             │
                     │ admin.char.pub    Workers Static Assets + Access    │
 运营人员 ──────────▶│ admin-api.char.pub Proxied + Access → Railway admin │
                     │ 边缘 Worker：OG 图、短链、下载重定向、重定向        │
                     │ WAF · Rate Limiting · Turnstile · Transform Rules   │
                     └───────────────┬─────────────────────────────────────┘
                                     │ HTTPS（附带源站校验头，见 security §5）
                     ┌───────────────▼──────── Railway Project ────────────┐
 GitHub ───webhook──▶│ api      （公开 API，含 /v1/github/webhook）          │
   ▲                 │ admin    （仅 admin 路由，只接受 Access 流量）         │
   │ App/Contents    │ worker   （无公网入口：pg-boss 任务消费者）            │
   └─────────────────│ postgres （仅私有网络）                                │
                     └───────────────┬─────────────────────────────────────┘
                                     │ S3 API（R2 专用凭证，按桶最小权限）
                     ┌───────────────▼─────────────────────────────────────┐
                     │ R2：public / private / uploads / evidence 四个桶     │
                     └─────────────────────────────────────────────────────┘
```

核心边界：

1. **聊天流量不经过 char.pub**（D-055）。char.pub 只负责 Search、Resolve Release、下载 IR、下载 Asset。
2. **Resolver 是一个纯库**：同一份 `@char-pub/core` 在 CLI、GitHub Action、worker 和浏览器中运行，结果字节级一致（IR §1）。
3. **Assembler 不在服务端**：Preview 在浏览器或 CLI 中运行（D-057）。
4. **三个进程共用一个镜像**：`api`、`admin` 和 `worker` 是同一个 Docker 镜像的三个入口，保持 Monolith 的简单（D-085），但 admin 路由**不挂载**在公开的 `api` 上。

---

## 2. 仓库结构（`char-pub/char` monorepo）

```text
char/
├── packages/                 # 可发布的库（npm scope @char-pub）
│   ├── core/                 # 规范实现：零 IO、同构、确定性
│   ├── ccv3/                 # CCv3 / PNG / CHARX ↔ Canonical（Legacy Import 层）
│   ├── assembler/            # 参考 Assembler + Trace + Token 估算（浏览器 / CLI）
│   ├── contracts/            # HTTP API 的 zod schema（server、web、cli、client 共享）
│   ├── client/               # 类型安全的 API client（web / cli / action 使用）
│   └── cli/                  # `char` 命令：init / check --fix / build / publish / login
├── apps/
│   ├── server/               # Node：api / admin / worker 三个入口，同一个镜像
│   ├── web/                  # www.char.pub：Vite + React SPA
│   ├── admin/                # admin.char.pub：Vite + React SPA
│   └── edge/                 # Cloudflare Worker：OG 图 / 短链 / 下载重定向
├── actions/publish/          # char-pub/publish GitHub Action（发布时同步到独立仓库）
├── spec/                     # 规范正文 + conformance/ + 生成的 JSON Schema
├── docs/                     # design/、goals/、runbooks/
└── infra/                    # docker-compose（本地）、Railway / wrangler 配置、Cloudflare 规则说明
```

### 2.1 包依赖规则（CI 强制）

```text
core ◀── ccv3 ◀── assembler(仅类型) 
  ▲        ▲          ▲
  │        │          │
contracts ─┘          │
  ▲                   │
client ◀── cli / web / admin / actions
  ▲
server（额外依赖 db 层、R2、pg-boss、Better Auth）
```

- `core` **不能**依赖 `node:*`、`fetch`、`Date.now()`、`Math.random()` 或任何 IO；时钟和 ID 生成器通过参数注入。这是 IR 能做到字节级确定的前提。
- `core` 的哈希使用 `@noble/hashes` 的同步 sha256（经过审计，三端行为一致），不用 WebCrypto：WebCrypto 只有 async 接口，会把整条 Resolver 管线变成 async。
- 排序一律按 UTF-16 code unit 比较，与 JCS 保持一致，**禁止**使用 `localeCompare`（它依赖运行环境的 locale）。
- `apps/*` 之间不能互相 import，共享代码只能通过 `packages/*`。
- 规则由 dependency-cruiser（或同类工具）加上 `tsconfig` project references 在 CI 中检查。

---

## 3. 运行时拓扑与环境

v0 只有一个线上主站（production），不设 staging。上线前的验证依靠 CI 全量回归（`pnpm ci:all`）、本地一键环境（`pnpm dev`）与全栈 E2E；Railway 在每次部署前自动执行迁移，迁移失败则不部署。

| 组件 | 主站（production） | 本地 |
|---|---|---|
| Web SPA | `www.char.pub`（Workers Static Assets，D-119） | Vite dev server（`pnpm dev`） |
| Admin SPA | `admin.char.pub`（Workers Static Assets + Access） | Vite dev server |
| 公开 API | `api.char.pub` → Railway `api` | `pnpm dev`（从 TypeScript 源码启动） |
| Admin API | `admin-api.char.pub` → Railway `admin` | `node dist/main.js admin` |
| Worker | Railway `worker`（无域名） | `pnpm dev` |
| Postgres | Railway Postgres（私有网络） | docker compose |
| 对象存储 | R2 `charpub-{public,private,uploads,evidence}` | MinIO（S3 兼容） |
| 数据库备份 | Railway Postgres 自带备份（D-111） | 无 |
| 公共资源 | `assets.char.pub`（R2 自定义域名） | MinIO 直出 |

- 所有域名都是 `char.pub` 的一级子域，Universal SSL 的 `*.char.pub` 证书可以直接覆盖。
- `www`、`api`、`admin`、`admin-api` 同属一个 site，SameSite cookie 无法在它们之间隔离，所以会话 cookie 一律是 host-only（`__Host-` 前缀、不设 Domain），写请求还要通过严格的 Origin 校验（security §4.2）。admin 的会话由 Cloudflare Access 签发，与 www 的会话互不相通。
- Railway 只有一个 environment（`production`），一个 project，三个 service 加一个 Postgres。project 建在 `Hushed Chat` workspace（Pro 套餐，D-124）。
- 以后如果需要预发布环境，按同一份 Railway 定义新建 environment，并为它单独准备密钥、OAuth App、GitHub App、R2 桶与数据库，不与主站共享任何凭证。

---

## 4. 进程职责

| 进程 | 职责 | 不做什么 |
|---|---|---|
| `api` | Auth（Better Auth）、公开读 API、创作者写 API、上传签发、GitHub webhook 接收（验签后入队）、OIDC 发布换票 | 不挂载 admin 路由；不做重 CPU 的图片处理；不同步调用 GitHub 的批量 API |
| `admin` | 员工登录（GitHub OAuth；MFA 由 Cloudflare Access 保证，D-120）、审核队列、下架、封禁、Namespace 治理、kill switch、审计查询 | 不对公网开放（只接受经过 Cloudflare Access 的请求） |
| `worker` | pg-boss 消费者：发布构建（Resolver → IR → CAS）、上传处理（EXIF / 转码 / CSAM 扫描）、GitHub 同步与对账、CCv3 lazy build、tombstone 级联、public 桶复制、GC、审计链头锚定、搜索索引维护 | 不暴露 HTTP 服务（只开放本地健康检查端口） |

所有进程启动时都会用 zod 校验环境变量，缺项或格式错误时直接退出（fail fast）。

---

## 5. 数据模型（Postgres）

### 5.1 约定

- 主键使用 UUIDv7，业务前缀只在 API 层编码（如 `cr_…`、`rel_…`），数据库列类型为 `uuid`（canonical-model §2.2）。
- 公共标识（`@ns/name`）通过 `namespaces.slug`、`creations.name` 与内部 ID 解耦。改名时写入 redirect 表，旧名永久保留（O-3）。
- 所有表都有 `created_at`，需要的表加 `updated_at`；软状态使用 `status` 枚举，不做物理删除（审计需要）。
- 迁移用 drizzle-kit 生成 SQL 并提交到仓库。只允许前进式迁移，生产环境迁移由 `api` 的 pre-deploy 命令执行。
- 应用使用**非 owner** 的数据库角色连接；`audit_log` 对这个角色只开放 `INSERT` / `SELECT`（security §8）。

### 5.2 表清单

**身份与账号**（Better Auth 管理的表加 `auth_` 前缀）

| 表 | 关键列 | 说明 |
|---|---|---|
| `auth_user` | id(uuid), email, name, image, role, banned, ban_reason, ban_expires, two_factor_enabled | Better Auth 的 user 表 + admin 插件字段；`id` 由我们生成的 UUIDv7 注入（D-089） |
| `auth_account` | user_id, provider_id, account_id | 即 `(user_id, provider, provider_subject)`；更换 IdP 不影响 user.id |
| `auth_session` / `auth_verification` / `auth_two_factor` | — | 由 Better Auth 管理 |
| `user_settings` | user_id, show_mature, mature_confirmed_at, locale | mature 显示需用户主动开启（D-011） |
| `api_tokens` | id, user_id, name, prefix, token_hash, scopes[], expires_at, last_used_at, revoked_at | 个人 Token，只保存 sha256 哈希，给 CLI / Agent 使用 |
| `guests` | guest_id, display_name, verified_at, verification_kind, disabled_at | D-065 中的“经验证访客”；v0 用 Turnstile + 邮箱验证 |

**Namespace 与 Creation**

| 表 | 关键列 | 说明 |
|---|---|---|
| `namespaces` | id, slug, kind(user/org/system), status(active/suspended), created_by | `slug` 语法见 canonical-model §2.1 |
| `namespace_members` | namespace_id, user_id, role(owner/maintainer) | v0 只实现个人 namespace，org 先保留模型 |
| `namespace_redirects` | old_slug(PK), namespace_id, created_at | 旧名永久占用，不可被重新注册 |
| `reserved_names` | slug(PK), reason, created_by | `commons`、`admin`、`api`、`www`、品牌名等 |
| `creations` | id, namespace_id, name, type, display_name(jsonb), summary(jsonb), rating, tags[], contribution_policy, status(active/hidden/suspended), head_revision_id, latest_release_id, search 列 | `(namespace_id, name)` 唯一 |
| `creation_redirects` | namespace_id, old_name, creation_id | 改名后保留旧名重定向 |
| `creation_drafts` | creation_id(PK), working(jsonb), base_revision_id, version(int), updated_by, updated_at | 可变的工作副本，用乐观锁（`version`）防止覆盖 |
| `revisions` | id, creation_id, parent_id, manifest_digest, semantic_digest, author(user/contribution), message, created_at | 不可变；内容通过 CAS 引用（§6） |
| `revision_fragments` | revision_id, fragment_id, digest, kind, stable, position | Contribution 三方比较和 Diff 使用 |

**Release 与依赖**

| 表 | 关键列 | 说明 |
|---|---|---|
| `releases` | id, creation_id, label, visibility, status(active/yanked/tombstoned), status_reason, source(jsonb), source_digest, semantic_digest, lock_digest, snapshot_digest, context_ir_digest, availability, effective_rating, license_check, published_by(jsonb), created_at | `(creation_id, label)` 唯一（D-044）；除 `status*` 外不可修改 |
| `release_locks` | release_id, dep_creation_id, dep_release_id, semantic_digest, via(jsonb) | 完整依赖闭包（§12.1） |
| `reverse_edges` | dep_creation_id, dep_release_id, dependent_creation_id, dependent_release_id, mode, rel | 发布时物化写入（D-090） |
| `release_fragments` | release_id, owner_ref, fragment_id, digest | 闭包中的所有 fragment，用于 tombstone 级联 |
| `build_artifacts` | cache_key(PK), target, blob_digest, created_at | `key = semantic_digest + lock_digest + target + compiler_version`（D-056） |

**内容寻址存储索引**

| 表 | 关键列 | 说明 |
|---|---|---|
| `blobs` | digest(PK), size, media_type, kind(fragment/manifest/snapshot/ir/export/asset/thumbnail/upload), in_public, in_private, status(present/withheld/purged), created_at | R2 对象的元数据 |
| `blob_refs` | digest, release_id, role | D-082：覆盖 fragment、snapshot、IR、导出物、源上传物，以及闭包中共享的依赖 |
| `blocked_digests` | digest(PK), reason, action_id | 被下架内容的哈希黑名单，阻止重新上传或发布 |
| `uploads` | id, owner_user_id, status(uploaded/processing/ready/rejected/quarantined), declared_type, size, staging_key, result(jsonb), reject_reason, expires_at | 上传状态机（D-084） |
| `asset_meta` | digest(PK), width, height, media_type, scan_status, scan_provider, scanned_at | 只有 `ready` 且扫描通过的资源可被引用 |

**Contribution**

| 表 | 关键列 | 说明 |
|---|---|---|
| `contributions` | id, target_creation_id, number, author(user_id / guest_id), agent, title, description, status, base_revision_id, base_semantic_digest, transport(jsonb), rights_ack(jsonb), decided_by, decided_at, result_revision_id | `(target_creation_id, number)` 唯一 |
| `contribution_changes` | contribution_id, change_key, on, op, base_digest, after(jsonb), sensitive, merge_state | `change_key` 在同一 Contribution 内唯一；`sensitive` 由服务端计算（§13） |

**GitHub Source**

| 表 | 关键列 | 说明 |
|---|---|---|
| `github_installations` | installation_id(PK), account_id, account_login, account_type, suspended_at, removed_at | |
| `source_bindings` | id, creation_id, repository_id(bigint), repository_owner_id(bigint), installation_id, path, tracked_ref, publish_refs[], display_full_name, status(active/frozen/unbound), frozen_reason, last_seen_commit | 按数字 ID 绑定（D-071）；名称只用于展示；仓库 transfer 后进入 frozen，等作者确认（D-118） |
| `webhook_deliveries` | delivery_id(PK), event, received_at, processed_at, status | 按 delivery ID 去重 |
| `oidc_jti` | jti(PK), expires_at | 防 OIDC token 重放 |

**社区、审核与运维**

| 表 | 关键列 | 说明 |
|---|---|---|
| `favorites` | user_id, creation_id | v0 社交功能只做收藏 |
| `reports` | id, reporter(user/guest/anon), subject_type, subject_id, category, details, status, assignee, created_at | 举报队列 |
| `legal_requests` | id, kind(dmca/court/gdpr/other), requester(加密 jsonb), received_at, subjects(jsonb), status, deadline, counter_notice(加密 jsonb) | 只有 `legal` 角色可读（admin §3） |
| `moderation_actions` | id, actor_id, action, subject, reason, legal_request_id, params, blast_radius, created_at, reverted_by | 每次处置的业务记录 |
| `audit_log` | id(bigserial), at, actor(jsonb), action, subject, request_id, ip_hash, before, after, prev_hash, hash | 追加写入 + 哈希链（security §8） |
| `feature_flags` | key(PK), enabled, reason, updated_by, updated_at | kill switch（admin §5） |
| `rate_limits` | 由限流库管理 | Postgres 作为存储，不引入 Redis（D-085） |
| pg-boss 的 schema | 由 pg-boss 管理 | 任务队列 |

### 5.3 搜索（D-088）

- v0 方案（V-8，2026-09-22 在 PG16 上实测，见 `.llmdoc-tmp/research/libraries.md`）：
  - `pg_trgm` GIN 索引：处理三个字以上的查询和拉丁语系文本（Railway 默认镜像自带）。
  - 应用层生成的 unigram / bigram `text[]` 列加 GIN 索引：处理一到两个字的 CJK 查询（pg_trgm 在这种查询上用不了索引）。
  - 数据库 locale 不能是 `C`（否则 trigram 会丢掉 CJK 字符），建库时检查。
  - 不引入 pg_bigm / PGroonga：它们需要自建镜像，会失去 Railway 的 HA 和 PITR。
- 搜索结果按 `user_settings.show_mature` 和 effective rating 过滤；这个过滤在服务端强制，不交给客户端。

---

## 6. 对象存储（R2）布局

| 桶 | 访问方式 | 内容 | 生命周期 |
|---|---|---|---|
| `…-public` | `assets.char.pub` CDN 直出，只读 | **只有** Public Release 引用的对象：fragment、snapshot、IR、导出物、Asset、缩略图 | 由 GC 回收 |
| `…-private` | 只经 API 签发的短期 GET URL 访问（≤ 5 分钟） | 草稿 Revision 的 manifest / fragment、Private Release 的全部对象、Import 原件与 Import Report | 由 GC 回收 |
| `…-uploads` | 只接受 presigned PUT（≤ 10 分钟，限定长度与类型） | 未经处理的上传原件 | 24 小时自动过期 |
| `…-evidence` | 不绑定域名，不签发 URL；只有 worker 专用凭证可写，只有 `legal` 角色经 admin 读取 | CSAM 事件的证据保全（security §7.4） | 按法定留存期（报告后 1 年）由专门任务删除 |

- presigned URL 只能走 R2 的 S3 endpoint，不能用自定义域名；R2 也不支持 POST 表单上传，所以上传统一用 presigned PUT。`r2.dev` 在生产环境禁用。
- 对象 key：`cas/sha256/<前 2 位>/<64 位 hex>`（D-081）。fragment 的 key 就是它的 fragment digest，manifest 的 key 就是 `semantic_digest`，因为两者恰好都是对象内容的哈希。
- **写入前先在内存中重算哈希**，不一致就拒绝，杜绝“key 与内容不符”的对象。
- Private → Public 发布时，由 worker 把对象复制到 public 桶（D-083），并在同一个任务中写入 `blobs.in_public = true`。
- 数据库备份不放 R2：v0 只启用 Railway Postgres 自带的备份功能（D-111，用户 2026-09-22 决定，出于成本考虑）。R2 异供应商备份推迟，等有真实用户和预算后再评估。
- 给 R2 分配三组 S3 凭证：`api` 只能签发 uploads 的 PUT 和 private 的 GET；`worker` 可以读写 public / private / uploads，另有一组只能写 evidence 的凭证；`admin` 只有删除和查看元数据的权限。R2 支持按桶限定 token 权限。

---

## 7. 关键流程

### 7.1 Native 编辑 → 发布

```text
编辑器 ──PUT /v1/creations/@ns/n/draft (If-Match: version)──▶ api
   api：zod schema 校验 → core.check → 写 creation_drafts（乐观锁）
编辑器 ──POST …/revisions──▶ api
   api：canonicalize → 各 fragment 写入 private CAS → 写 revisions / revision_fragments
编辑器 ──POST …/releases {label, visibility, revision}（Idempotency-Key）──▶ api
   api 在同一事务中：
     • 占用 (creation_id, label)，状态为 pending（D-044）
     • pg-boss 入队 publish(release_id)
worker(publish)：
     • 加载 revision + 依赖 Release 的 snapshot（按 pin）
     • core.publishChecks：§12.1 的 9 条规则 + blocked_digests + kill switch
     • core.resolve → Context IR（确定性）
     • 写 snapshot / IR 到 CAS（public 或 private 桶）
     • 写 release_locks、reverse_edges、release_fragments、blob_refs
     • releases.status = active；写 audit_log
     • 失败时：release 标记为 failed，释放 label，把错误写入 Publish Report
```

说明：规范里 Release 只有三态（D-042），`pending` / `failed` 只是**发布任务**的实现状态。它们不对外暴露为 Release status，只出现在 Publish Report 中。

### 7.2 CCv3 导入

```text
浏览器 ──POST /v1/uploads {type, size, sha256}──▶ api → 返回 presigned PUT（uploads 桶）
浏览器 ──PUT 原件──▶ R2
浏览器 ──POST /v1/imports {upload_id}──▶ api → 入队 import
worker：下载原件 → 大小 / 类型 / 结构校验 → packages/ccv3 解析
       → Canonical Creation 草稿 + Import Report（system_prompt 等只记录字段名）
       → 内嵌头像进入 §7.4 的上传管线 → 写 creation_drafts
```

### 7.3 GitHub 绑定与 OIDC 发布

```text
安装 App（Metadata:Read + Contents:Read）──webhook──▶ api：验签 → 按 delivery 去重 → 入队
作者在 char.pub 绑定：creation ⇄ (repository_id, repository_owner_id, path, publish_refs)
push ──webhook──▶ worker(sync)：用 installation token 按 commit 读取 char.yaml
                               → check → 更新 Source 索引（不发布）
GitHub Action：char check / resolve / build → 申请 OIDC token（aud = char.pub）
             → POST /v1/publish/oidc {envelope}
api：验证 JWT（iss、aud、exp、签名、jti）
   → 按 repository_id + repository_owner_id 找到 binding，校验 ref 是否在允许列表
   → worker 用 App token 按声明的 commit 重新读取源文件并重算 digest（不相信 Action 传来的摘要）
   → 走 §7.1 的发布流程
另有周期性对账任务：比对 installation 的仓库列表与 binding，补偿丢失的 webhook（D-072）
repository.transferred 或对账发现 owner_id 变化 → binding 冻结，等作者确认：重新绑定，或换用新仓库（D-118）
OIDC 发布要求仓库已安装 App 并完成绑定（D-117）
```

### 7.4 上传管线（D-084）

```text
uploaded ──worker──▶ processing
  1. 大小上限；按 magic bytes 识别真实类型（只允许 png / jpeg / webp / gif）
  2. sharp 解码（限制像素上限，防解压炸弹）→ 剥离全部元数据 → 转 webp + 生成缩略图
  3. CSAM 哈希扫描（通过 provider 接口实现，见 security §7）
  4. 结果写入 private CAS；更新 asset_meta
  ├─▶ ready        （可被 Release 引用）
  ├─▶ rejected     （格式错误等，原件删除）
  └─▶ quarantined  （命中 CSAM：原件转入隔离存储，锁定账号，进入事件流程）
```

### 7.5 读取与下载

- `GET /v1/creations/@ns/name[@label]`：返回元数据。tombstoned 时返回 `410`，响应体用 problem+json 说明原因（D-042）；yanked 时正常返回，并附带 `warning` 字段。
- `GET …/ir`：Public Release 用 `302` 跳到 `assets.char.pub/cas/…`，可以长期缓存（immutable）；Private Release 需要鉴权，返回签名 URL，未授权时一律 `404`。
- `GET …/export/ccv3`：先查 `build_artifacts`；没有缓存时入队 lazy build，返回 `202` 和 `Retry-After`。
- 公开读接口不需要任何凭证（D-055），并设置 `Cache-Control`，让 Cloudflare 缓存。

### 7.6 Tombstone 级联（D-082）

详见 [admin.md §4](admin.md#4-法律下架与-tombstone-级联)。简要流程：

1. 计算影响范围：用 `blob_refs` 找出所有受影响的 Release。
2. 在一个事务中：把这些 Release 设为 tombstoned，把相关 blob 标记为 withheld，写入 `blocked_digests` 和审计日志。
3. worker 从 public / private 桶删除可分发副本，并按 URL 清除 CDN 缓存。
4. 根据法律依据，决定原件是进入受限的留存区还是立即删除。

---

## 8. HTTP API 约定

- 基础地址 `https://api.char.pub/v1`；OpenAPI 文档由 `packages/contracts` 生成，公开发布。
- 错误统一用 RFC 9457 `application/problem+json`，并带稳定的 `code`（例如 `release.tombstoned`、`publish.diamond_conflict`）。
- 写接口支持 `Idempotency-Key`；发布接口要求必须提供（D-044：同一内容重复发布是幂等的，不同内容则返回 409）。
- 并发编辑用 `ETag` / `If-Match` 做乐观锁。
- 列表接口用 cursor 分页，单页上限 100。
- 鉴权方式：Web 用 session cookie；CLI / Agent 用 `Authorization: Bearer cp_pat_…`；Action 用 OIDC 换取的短期发布 token（绑定到 binding，10 分钟有效）。
- 所有请求都带 `X-Request-Id`，贯穿日志、审计和任务。
- 请求体上限：JSON 1 MiB，草稿 5 MiB；文件上传不经过 API（D-084）。

---

## 9. 任务队列与一致性

- 任务队列使用 pg-boss（D-085），不自己实现重试、退避和死信。
- **业务写入和入队在同一事务内完成**：`boss.send(name, data, { db: fromDrizzle(tx, sql) })` 复用当前事务，事务回滚时任务也一起回滚（2026-09-22 核实，pg-boss 12.33）。所以不需要单独的 outbox 表和转发器。
- 任务必须幂等：用 `singletonKey`（例如 `publish:<release_id>`）加上状态检查，保证重复执行不会产生副作用。
- 定时任务用 pg-boss 的 schedule：对账每 6 小时一次，GC 每天一次，审计链头锚定每天一次，过期 upload 清理每小时一次。

---

## 10. 可观测性

- 结构化 JSON 日志（pino），字段包括 `request_id`、`user_id`（哈希后）、`route`、`status` 和 `latency`；不记录 cookie、token 或正文内容。
- 健康检查：`/healthz` 表示进程存活；`/readyz` 表示依赖可用（数据库和 R2）。
- 指标：v0 先用 Railway 自带的指标，外加 pg-boss 队列深度与失败数（admin 任务面板中展示）。
- 错误跟踪：可选接入 Sentry 免费额度，是否接入由用户决定（DOR 中登记）。
- 告警：发布失败率、队列积压、CSAM 命中、登录失败激增等事件，通过邮件或 Discord webhook 通知运营者。

---

## 11. 配置与密钥

- 仓库只提交 `.env.example`（只写变量名和说明）。真实值存放在 Railway variables 和 Cloudflare secrets 中（仓库是 public 的）。
- 每个环境一套密钥，至少包括：`DATABASE_URL`、`BETTER_AUTH_SECRET`、各 OAuth client、GitHub App 私钥与 webhook secret、R2 的三组凭证、`ORIGIN_AUTH_SECRET`（源站校验）、Cloudflare Access 的 team 域名与 AUD、Turnstile secret、CSAM provider 凭证。
- 密钥轮换步骤写在 `docs/runbooks/rotate-secrets.md`（M9 交付）。
