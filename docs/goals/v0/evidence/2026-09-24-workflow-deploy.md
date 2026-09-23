# 创作流程补齐：主站更新记录

用户于 2026-09-24 授权更新文档及主站。功能与部署配置经 [PR #7](https://github.com/char-pub/char/pull/7) 合并，部署源提交为 `abf4e35674db60cba5776cef98f3e67cb5977244`。

## 发布前验证

- 本地 `pnpm ci:all` 全部通过：unit 1248、web/admin 组件 176、一致性 103（81 项既存 todo 等人工接受）、服务端集成及单元 1364、web e2e 57、admin e2e 107；类型、依赖、构建、Action dist、gitleaks 均通过。
- `pnpm e2e:fullstack` 3 项通过，包括草稿头像刷新后读取、公开头像读取、导入确认与导出、贡献 rebase。
- [PR CI](https://github.com/char-pub/char/actions/runs/35905331763) 与 [main CI](https://github.com/char-pub/char/actions/runs/35906143929) 全部通过。CodeQL 和依赖审查通过。
- 前端重新做 production 构建，并通过两个 `wrangler deploy --dry-run`；web 编入现有生产 Turnstile site key，admin 的 mock 开关关闭。
- 上线前发现 api 缺少删除申请加密密钥：部署定义增加 `preserve()`，通过标准输入安全配置与 admin 相同的现有密钥，没有轮换旧密钥。新增配置回归测试通过；不在日志和仓库保存密钥值。

## 部署

合并后未观察到自动部署记录，使用 `railway redeploy --from-source --yes` 从已配置的 GitHub main 触发三个服务；确认部署源都是上述提交。

| 服务 | 部署 ID | 结果 |
|---|---|---|
| api | `f8ba6717-ecfc-40b2-b375-6e98baf6a8f4` | SUCCESS，迁移完成，容器内 healthz 200 |
| admin | `1b44a71d-64e0-4b59-86c7-7b2582635db6` | SUCCESS |
| worker | `3a9483cd-0840-4989-a0bd-c1155b161a56` | SUCCESS，容器内 healthz 200 |

前端由相同代码的 production 构建部署：

- Web `charpub-web`：`49ab233b-2823-4220-a031-17f1ac838d1b`，`www.char.pub`。
- Admin `charpub-admin`：`c0928195-9aa5-4cff-909b-f357c321078e`，`admin.char.pub`。
- Web 线上入口文件及其 SHA-256 与本地 production 产物一致。

## 线上验证

`pnpm smoke --env production` 于 `2026-09-23T19:08:37Z` 全部通过：

- Web 200，CSP / HSTS / nosniff 正常。
- API healthz 200；匿名搜索 200；不存在接口返回 404 problem+json。
- admin-api 与 admin SPA 在未通过 Access 时均返回 302 登录跳转。

额外只读检查：

- API 容器确认 `LEGAL_ENCRYPTION_KEY` 已配置，不输出值；healthz 200。
- `GET /v1/me/deletion-requests` 未登录返回 `401 auth.required`，确认新路由存在且鉴权生效。
- 既有 `@djj/char-djj-test@1.0.0` 返回 `source.kind=github`、仓库/commit/path 摘要与 `publisher.kind=github_actions`，没有原始 OIDC claims。
- worker 容器内 healthz 200。

回退参照：更新前 Web 版本为 `2ef09746-9b56-4f96-beec-15cc8ac6d75c`，Admin 版本为 `30a505b4-52c5-4ab1-aa59-528097410153`；后端旧提交为 `24c3cb6`。本次没有新增数据库迁移或执行删除申请。

## 保持待办

运营主体与公开联系邮箱仍未确定。删除入口受理申请，不立即删除内容。本次只读冒烟不代替 DOD 中人工审阅、主站写入演练、备份恢复与公开开放确认，未新增验收勾选。
