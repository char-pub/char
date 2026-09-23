# 本地开发环境走查（M0-4，2026-09-22）

目标：按 README 的“Local development”步骤，从一份全新的 clone 开始跑通本地开发环境。

## 环境

- macOS（Darwin 24.5），Node 26.9，pnpm 12.5.1，Docker Compose v5.5.1。
- 从本地 main（`7de65dc` 之前的 `e41717d`）`git clone` 到 `/tmp/charpub-clean`，没有 `.dev/`、`node_modules/` 与构建产物。
- 与真正干净的机器的差别：Docker 镜像、pnpm store 与正在运行的 compose 容器是本机共用的；本机 3000 端口被其他程序占用，所以 api 与 worker 用了 `DEV_API_PORT=3200 DEV_WORKER_PORT=3201`。

## 步骤与结果

| 步骤 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile` | 成功 |
| `pnpm infra:up` | 退出码 0；连续运行两次都成功，uploads 桶只有一条生命周期规则 |
| `pnpm test` | 55 个文件，1283 个测试通过 |
| `pnpm dev` | migrate 完成；复用本地库中已有的系统账号；api、worker、web 就绪，打印访问地址 |
| `pnpm dev:login cleanrun` | 创建本地账号，`GET /v1/me` 验证会话有效 |
| `GET http://localhost:5173/` | 200 |
| 浏览器（Playwright Chromium）按提示在控制台设置 cookie | `/v1/me` 返回 200；刷新后页头显示账号菜单，`/me` 显示“My creations” |
| Ctrl-C | `pnpm dev` 以 0 退出，没有残留进程，端口释放 |
| `pnpm dev:smoke`（同一套检查的脚本版本） | web 200、经代理的 `/v1/search` 200、匿名 `/v1/me` 401、worker 健康检查 200、`dev:login` 会话有效、以 0 退出，6 项全部 ok |

## 走查中发现并修复的问题

1. **`pnpm infra:up` 每次都失败**：Compose v5 的 `up --wait` 把以 0 退出的一次性初始化容器（建桶）也当作失败。改为只等待常驻服务，再用 `compose run --rm` 执行建桶；`pnpm dev` 与全栈 E2E 改为调用 `pnpm infra:up`。
2. **生命周期规则重复累积**：每次初始化都会给 uploads 桶再加一条相同规则（本机已累积 6 条）。改为只在没有规则时添加，并清理了本机的重复规则。
3. **系统账号 ID 不一致时的报错不可读**：bootstrap 以前直接报数据库唯一约束错误。现在报 `bootstrap.system_actor_mismatch` 并给出已有账号的 ID（有集成测试）；本地开发时 `pnpm dev` 自动采用库里已有的 ID（多个 clone 或 worktree 共用一个本地数据库时会遇到）。
4. **端口被占用时的行为**：以前 api 崩溃后要等 60 秒超时，并留下 worker 与 web 进程。现在启动前检查端口，被占用时立即报错并提示用哪个变量换端口；任何一个进程提前退出时，其余进程一并停止。

## 仍未满足的部分

DOD 要求“在干净机器上按步骤跑一遍”。CI 新增的 `dev-env` job 在全新的 runner 上执行 `pnpm install`、`pnpm infra:up`、`pnpm dev:smoke`，第一次运行记录出来之后（需要先推送到 GitHub）才能勾选 M0-4。
