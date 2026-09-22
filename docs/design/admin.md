# char.pub Admin 控制设计（v0）

> 状态：Draft，2026-09-22。Admin 负责运营、审核与法律合规，**不参与**作品创作。
> 相关文档：[架构](architecture.md) · [安全](security.md)。

---

## 1. 目标

1. 让少数员工能安全地处理举报、法律下架、滥用和运维事件。
2. 每一项权力都有明确的角色、理由和审计记录，而且可以追溯、尽量可以撤销。
3. 即使 admin 账号失守，影响也有限：多层防护、最小权限、所有操作可追溯。
4. 仓库是公开的，所以 admin 的安全不能依赖隐藏路径。

---

## 2. 访问控制：三层防护

```text
第 1 层  Cloudflare Access（admin.char.pub、admin-api.char.pub）
         策略：GitHub 身份 + char-pub 组织成员（或员工允许名单）
         char-pub 组织强制成员开启 2FA → MFA 由 GitHub 保证（D-120）
         会话 8 小时；Access JWT 附带在每个请求上
第 2 层  admin 进程
         校验 Cf-Access-Jwt-Assertion（签名、aud、iss、email）
         + 应用内会话（GitHub OAuth，与创作者端使用独立的 cookie 和域名）
第 3 层  应用内角色
         每个 admin 端点都检查角色（§3），并要求填写操作理由、写入审计
         v0 不在应用内做 TOTP / passkey step-up（D-120）；管理员增多或
         出现安全事件时，再恢复应用内二次验证
```

- admin 进程**只挂载 admin 路由**，公开的 `api` 进程完全没有这些路由（architecture §4）。
- 员工账号就是普通 `auth_user` 加上 staff 角色；提升为员工只能由 `owner` 在 admin 后台操作，或者通过引导命令完成（见 §7），并写入审计日志。
- 员工也可以作为创作者使用 www 站点，但在 www 上**不拥有任何管理权限**（staff 角色只在 admin 进程中生效）。

---

## 3. 角色与权限矩阵

角色可以叠加。`owner` 拥有全部权限。

| 能力 | viewer | moderator | trust_safety | legal | admin | owner |
|---|---|---|---|---|---|---|
| 查看举报、Creation、Release、用户概况 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 认领和处理普通举报（驳回、隐藏、强制评级） | | ✓ | ✓ | | ✓ | ✓ |
| 隐藏或恢复 Creation（从搜索和作品页下线，不删除） | | ✓ | ✓ | | ✓ | ✓ |
| 代作者 yank Release | | ✓ | ✓ | | ✓ | ✓ |
| 封禁或解封用户、吊销会话和 Token | | | ✓ | | ✓ | ✓ |
| 查看 CSAM 事件与隔离区；提交 NCMEC 报告 | | | ✓（只读） | ✓ | | ✓ |
| 登记和处理法律请求（DMCA、法院命令、GDPR） | | | | ✓ | | ✓ |
| **Tombstone**（法律或严重违规下架） | | | ✓（严重违规） | ✓（法律） | | ✓ |
| Namespace 治理（保留名、冻结、转让、改名仲裁） | | | | | ✓ | ✓ |
| Kill switch（注册、上传、发布、Contribution、GitHub 同步） | | | ✓ | | ✓ | ✓ |
| 查看任务队列；重试或取消任务 | | | | | ✓ | ✓ |
| 查看和导出审计日志 | ✓（只看自己的操作） | | | ✓ | ✓ | ✓ |
| 管理员工与角色 | | | | | | ✓ |

- 需要**四眼原则**（两名员工）的操作：级联影响超过 50 个 Release 的 tombstone；解封被 CSAM 锁定的账号；删除 owner 角色。v0 的实现方式是：第一名员工发起，第二名员工确认；如果只有一名员工，则强制等待 24 小时冷静期并通知 owner。
- 所有写操作都必须填写 `reason`（至少 10 个字符），如果与法律请求相关，还要关联 `legal_request_id`。

---

## 4. 法律下架与 Tombstone 级联

### 4.1 流程

```text
登记 legal_request（申请人信息加密存储，记录截止日期）
  → 评估：确定对象（fragment digest / Release / Creation / Asset）
  → 预览影响范围（dry-run）：
       • 通过 blob_refs 找出包含该对象的所有 Release（包括依赖闭包中的，D-082）
       • 列出会失效的 IR、导出物、缩略图、CDN URL
       • 列出受影响的下游作者（通过 reverse_edges）
  → 执行（在有效的 Access 会话内；满足条件时需要四眼确认）：
       事务：releases → tombstoned（status_reason 使用一套公开的原因代码）
            blobs → withheld；写 blocked_digests；写 moderation_actions 和 audit_log
       任务：从 public / private 桶删除对象 → 按 URL 清除 CDN 缓存 → 核验（HEAD 返回 404）
  → 通知：作者、受影响的下游作者（只告知原因代码，不透露申请人信息）
  → 反通知窗口（DMCA）：legal 角色可以恢复，前提是对象还没有被 purge
```

### 4.2 状态与恢复

- `withheld`：停止分发，但隔离区可能保留一份，用于法律留存或反通知恢复。
- `purged`：彻底删除，不可恢复。按法律依据和留存期限，由 GC 任务执行。
- 恢复只能在 `withheld` 状态下进行，且会生成新的审计记录。Release 从 tombstoned 恢复为原状态，是规范之外的**运营例外**，需要 owner 加四眼确认，并在 DECISIONS 中登记（v0 默认不开放这个入口）。
- 解析端的行为：遇到 tombstoned Release 时返回 `410` 和原因代码（D-042），不会静默跳过。

### 4.3 原因代码（公开）

`legal.dmca`、`legal.court_order`、`legal.gdpr`、`policy.minor_sexual`、`policy.illegal`、`policy.non_consensual`、`policy.malware`、`author.request`。

---

## 5. Kill Switch 与运行开关

`feature_flags` 表中的开关（每 5 秒读取一次缓存，也可以通过 `LISTEN/NOTIFY` 立即生效）：

| key | 作用 | 关闭时的表现 |
|---|---|---|
| `signups` | 新用户注册 | 返回 `503` 和 problem 代码 `feature.disabled` |
| `uploads` | 签发上传 URL 与 import | 同上 |
| `publish` | 所有发布（Native + OIDC） | 同上；已在队列中的任务会暂停 |
| `contributions` | 提交 Contribution | 同上 |
| `github_sync` | webhook 处理和对账 | 仍然接收 webhook 并入队，但暂停消费 |
| `guest_access` | 访客验证与访客贡献 | 同上 |
| `read_only` | 全站只读（维护模式） | 所有写接口返回 `503` |

每次切换都要填写理由、写入审计日志，并通知值班人员。

---

## 6. Admin 功能清单（v0）

| 模块 | 功能 |
|---|---|
| 仪表盘 | 待处理举报和法律请求、截止日期、队列积压、失败任务、CSAM 事件、kill switch 状态 |
| 举报队列 | 按类别和严重度排序；认领；查看上下文（作品、Release、历史处置、举报人信用）；执行动作（驳回、隐藏、强制评级、yank、升级为 T&S 或 legal 处理） |
| 内容 | 查看任意 Creation 或 Release（包括私有内容，但每次查看都写入审计日志）；隐藏或恢复；强制评级；yank；发起 tombstone |
| 用户 | 查看账号、身份、Namespace、Token、会话和处置历史；封禁（可设期限）；吊销会话和 Token；锁定上传 |
| Namespace | 保留名管理；冻结；转让；改名仲裁；查看 redirect |
| 法律 | 登记请求；截止日期提醒；影响预览；执行；反通知；导出案件记录 |
| CSAM 事件 | 事件列表；隔离证据（legal 权限才能访问）；NCMEC 报告状态；按留存期限追踪 |
| 任务 | 查看 pg-boss 队列（按状态和类型）；重试、取消；查看失败原因 |
| 开关 | Kill switch 列表与切换 |
| 审计 | 查询、过滤、导出；校验哈希链 |
| 员工 | 管理员工与角色（只有 owner 可用）；强制登出 |

**不做**：代替用户编辑作品内容（员工不能修改 Creative Truth，最多做到隐藏、评级、下架）；v0 不提供模拟登录（impersonation）。Better Auth admin 插件的 `impersonate` 权限不授予任何角色，以后如果需要，必须只读、有时限并写入审计。

**实现方式**：角色、封禁（会同时吊销会话）、会话吊销、用户列表直接使用 Better Auth admin 插件，用 `createAccessControl` 定义上面的角色。插件本身没有审计日志，所有 admin 端点都要经过我们的中间件，在同一事务内写入 `audit_log`。

---

## 7. 引导与应急

- 第一个 owner：运维人员在 Railway 上执行一次性命令 `pnpm --filter server admin:bootstrap --github-login <login>`（通过 `railway run` 在对应环境中执行），把已注册的用户提升为 owner。命令会写入审计日志，并且只在还没有任何 owner 时才能成功。
- 应急恢复（break-glass）：如果所有 owner 都失去访问能力，唯一的办法是用 Railway 控制台的数据库权限，执行 `docs/runbooks/break-glass.md` 中的 SQL。执行时必须写一条 `system` 类型的审计记录，事后复盘。

---

## 8. 验收要点（由 DOD 引用）

1. 权限矩阵：每个角色对每项能力都有 allow 和 deny 的测试，由矩阵自动生成用例。
2. 没有有效 Access JWT、或角色不足的请求访问 admin-api 时被拒；公开的 api 进程上不存在 admin 路由（404）。
3. Tombstone 级联：在 staging 构造依赖链 A → B → C，对 C 中的一个 fragment 执行 tombstone；预期 A、B、C 的相关 Release 全部变为 tombstoned，CDN 返回 404，resolve 返回 410 和原因代码，审计日志完整。
4. Kill switch 切换后在 5 秒内生效。
5. 应用数据库角色对审计日志执行 UPDATE / DELETE 会失败；哈希链校验能发现被篡改的记录。
