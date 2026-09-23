# 本地端到端：CLI 发布 → api → worker → 匿名读取

日期：2026-09-22。环境：本机 `infra/docker-compose.yml`（Postgres 16 + MinIO），服务端使用
`apps/server/Dockerfile` 构建的镜像，`api` 与 `worker` 各跑一个容器，`migrate` 先执行一次。
认证用一个直接写入数据库的个人 Token（OAuth App 尚未创建，见 DOR B-5），这条路径覆盖的是
Token 认证 + 发布 + 读取，不覆盖浏览器登录。

## 步骤与结果

| 步骤 | 命令 / 请求 | 结果 |
|---|---|---|
| 迁移 | `docker run … charpub-server:dev migrate` | `migrations complete` |
| 健康检查 | `GET /healthz` | `{"ok":true}` |
| 创建 namespace | `POST /v1/namespaces {slug: e2e}` | `{"slug":"e2e","kind":"user","status":"active"}` |
| 创建 Creation | `POST /v1/namespaces/e2e/creations` | `{"ref":"@e2e/alice","type":"character",…}` |
| 发布 1.0.0 | `char publish --label 1.0.0`（真实 CLI 构建产物） | `publish pending`，数秒后 Release `active` |
| 匿名下载 IR | `GET /v1/creations/@e2e/alice/releases/1.0.0/ir` | 302 到 public 桶 CAS 地址，`Cache-Control: public, max-age=31536000, immutable` |
| 内容寻址校验 | `shasum -a 256` 下载的 IR | 等于 CAS key `e0618ab7…77ead` |
| IR 内容 | fragment 文本、greeting | `Alice is a courier in Night City.`；`Hi {{late:user}}, you're late again.` |
| 同 label 同内容 | 再次 `char publish --label 1.0.0` | `already published`（幂等） |
| 同 label 不同内容 | 修改 description 后发布 1.0.0 | `publish.label_taken`（409） |
| 新 label | `char publish --label 1.1.0` | 1.1.0 与 1.0.0 都是 `active` |
| 匿名搜索 | `GET /v1/search?q=alice` | **第一次运行返回空**，修复后返回 `['@e2e/alice']` |

## 发现的问题

发布后作品搜不到：发布任务没有写搜索列（只有测试夹具写）。已修复：发布与 namespace 改名时
在同一事务内刷新搜索列，并在集成测试中加入断言（commit “refresh search columns on publish
and namespace rename”）。修复后重新构建镜像、再次发布 1.2.0，`alice`、`e2e`、`Alice` 三个查询
都能命中。
