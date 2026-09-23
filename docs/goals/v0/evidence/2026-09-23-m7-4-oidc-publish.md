# M7-4：真实仓库的 OIDC 发布（2026-09-23）

测试仓库：`Disdjj/char-djj`（public，用户指定；repository_id 1383234560，owner_id 44730034）。GitHub App `char-pub`（contents / metadata 只读）装在这个仓库上（installation 164021265）。

## 流程

1. 用用户的个人 Token 注册 `@djj`，创建 `@djj/char-djj-test`（character），绑定到仓库：`POST /v1/creations/@djj/char-djj-test/source-binding`，按数字 ID 绑定，跟踪 `refs/heads/main`，允许发布 `refs/heads/main` 与 `refs/tags/*`。
2. 推送 `char.yaml`（CC0 合成角色）与 `.github/workflows/publish.yml`（`permissions: id-token: write`，只用 GitHub OIDC，仓库不存 char.pub 凭证；Action 固定到 `char-pub/char` 的 commit SHA）。App 收到 push，同步任务在该 commit 读取 char.yaml 并检查通过（binding 的 `last_check.ok = true`）。
3. 推送 tag `v1.0.0`，workflow 运行 `char-pub/char/actions/publish`。

## 结果

- 第一次运行失败：`publish.source_digest_mismatch`。原因是 Registry 比对 digest 时用了真实 Creation ID，而 Action 用 CLI 的占位 ID 计算；每一次真实的 OIDC 发布都会失败，集成测试没有覆盖到。修复见 PR #3 与 D-156（回归测试用 Action 实际调用的 `buildLocal`，修复前失败）。
- 修复部署后重跑同一次 run（35851564040）：**success**。`@djj/char-djj-test@1.0.0` 为 active、public，匿名可读；作品页在浏览器里渲染出 IR 内容。
- Release 记录：`source.provider = github`，`source.commit = ad7c3cb…`（tag 指向的 commit），`published_by.oidc` 中 `repository_id = 1383234560`、`repository_owner_id = 44730034`、`ref = refs/tags/v1.0.0`、`event_name = push`、`job_workflow_ref = Disdjj/char-djj/.github/workflows/publish.yml@refs/tags/v1.0.0`、`sha = ad7c3cb…`。
- 反例：从不在 `publish_refs` 中的分支 `feature/not-allowed` 手动触发（带 label 9.9.9），Registry 拒绝：`binding.ref_not_allowed`（run 35853120059）。

结论：M7-4 满足。

## 附带发现并修复

- **Railway 不自动部署**：服务从 IaC 定义创建后没有 GitHub 部署触发器，合并到 main 不会部署。用 `railway service source connect --repo char-pub/char --branch main` 重新连接三个服务后，合并即自动部署（api 部署了 `d38e65a`）。
- **公开 IR 跨域失败**：API 把公开下载 302 重定向到 `assets.char.pub`，浏览器跟随跨站重定向时 Origin 变为 `null`，而 public 桶的 CORS 只允许 www，浏览器拿不到 IR（用户报告）。public 桶改为允许任何来源的 `GET` / `HEAD`（只含公开、按内容寻址的对象，不带凭据）；private 桶仍只允许 www。浏览器中复验：请求 IR 经 302 到 assets 后 200，作品页正常渲染。

## 未完成（留待之后）

E2E-4 中需要第二个账号的反例：仓库改名后由另一个 owner 新建同名仓库发布被拒、仓库转移后绑定冻结与恢复。用户决定之后再测。
