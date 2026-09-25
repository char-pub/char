# char.pub

**面向 AI 创作的开放 Registry、协作网络与互操作层。**

[English](README.md) · **简体中文**

创作角色、世界、世界书、关系、情境、用户身份、文风、Preset 与 Prompt Module，组合可复用的内容和策略，发布其他工具能够理解和运行的版本。

> GitHub 可以托管 Char，char.pub 可以发现 Char，Agent 可以理解 Char，Runtime 可以运行 Char，但没有任何一个平台拥有它。

[Canonical Model](spec/canonical-model.md) · [Context IR](spec/context-ir-v0.md) · [组装资产与作者测试](spec/assembly-assets-v0.md) · [架构](llmdoc/execution-model.mdx) · [发布就绪条件](llmdoc/engineering/release-readiness.mdx)

## 可以做什么

- **选择适合自己的创作入口。** 使用 Web 编辑器、导入 CCv3 卡片或 PNG，或通过 GitHub、CLI 和 Publish Action 创作。这些入口共享同一个规范化内容模型。
- **组合并发布作品。** 引用世界与世界书的指定版本，检查依赖，发布带有内容摘要的不可变 Release。
- **固定并验证运行搭配。** 在 Scenario 中锁定精确 Preset、运行配置与实现版本；用公开合成 Session 测试激活、顺序、预算与可见性，无需调用模型。
- **通过审阅进行协作。** 用 Contribution 提交修改，检查冲突和敏感变更，接受到草稿后再发布。
- **理解最终生成的上下文。** 预览解析后的内容及其来源，查看组装 Trace，用 Context Diff 比较版本差异。
- **在不同 Runtime 中使用内容。** 无需登录即可下载公开 Context IR 与资产；也可导出 CCv3，并通过 Loss Report 了解转换损失。

Registry 管理内容、权限和发布状态；Runtime 应用消费发布后的上下文并运行对话。纯计算 Core 和参考 Assembler 支持 Node、浏览器与 Workers，职责边界见[执行模型](llmdoc/execution-model.mdx)。

## 项目状态

char.pub 正在向 **v0** 推进。Canonical Model 与 Context IR 仍是**草案规范**。一致性测试的预期输出仍需人工接受，草案测试运行成功不代表协议已经冻结。

目前实现包含 Registry、创作者 Web、Admin、CLI 与 GitHub 发布流程。最终验收还涉及人工审阅、主站端到端验证、备份恢复、运营配置和包发布，具体门槛见[发布就绪条件](llmdoc/engineering/release-readiness.mdx)。

## 本地运行

准备 **Node.js ≥ 22.12**（CI 使用 Node 24）、[`package.json`](package.json) 指定版本的 **pnpm**，以及已启动且支持 Compose 的 **Docker**。

```sh
git clone --recurse-submodules https://github.com/char-pub/char.git
cd char
pnpm install
pnpm dev
```

如果已有仓库，先执行 `git submodule update --init`。前端依赖 brand-assets 子模块中的品牌资源。

`pnpm dev` 会按需启动本地 Postgres、MinIO 和 Mailpit，执行数据库迁移，然后启动 API、worker 与 Web 开发服务器。打开 **http://localhost:5173**。

在另一个终端创建本地账号：

```sh
pnpm dev:login alice
```

按照命令输出，在浏览器控制台执行登录指令。这个本地快捷入口无需配置 OAuth App。

| 服务 | 本地地址 |
| --- | --- |
| Web | http://localhost:5173 |
| API | http://127.0.0.1:3000 |
| worker 健康检查 | http://127.0.0.1:3001/healthz |
| Mailpit 收件箱 | http://127.0.0.1:58025 |
| MinIO 控制台 | http://127.0.0.1:59001 |
| Postgres | `127.0.0.1:54329` |

API 与 worker 在源码变化后自动重启，Web 使用 Vite 热更新。本地凭据在 [`infra/docker-compose.yml`](infra/docker-compose.yml)，自动生成的开发密钥保存在 Git 忽略的 `.dev/state.json`。可用根目录 `.env` 覆盖本地配置，变量名称见 [`.env.example`](.env.example)。

端口被占用时：

```sh
DEV_API_PORT=3200 DEV_WORKER_PORT=3201 DEV_WEB_PORT=5174 pnpm dev
```

运行 `pnpm dev:login` 时使用相同的覆盖值。Ctrl-C 停止应用进程，`pnpm infra:down` 停止容器。Admin 与生产环境集成需单独配置，见[部署指南](infra/DEPLOY.md)。

<details>
<summary>可选：使用本地邮件验证访客</summary>

Mailpit 只接收本地邮件，不会向外投递。需要验证访客流程时，在 Git 忽略的根目录 `.env` 中配置：

```dotenv
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
SMTP_URL=smtp://127.0.0.1:51025
EMAIL_FROM="char.pub (local) <no-reply@localhost>"
GUEST_HMAC_KEY=<base64-encoded 32-byte random key>
```

用 `openssl rand -base64 32` 在本地生成 HMAC 密钥，再使用匹配的公开 Turnstile 测试 site key 启动 Web：

```sh
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA pnpm dev
```

这些 Turnstile 值是公开测试 key，不是凭据。服务端仅在开发环境接受其测试 token。四项服务端变量必须一起配置；全部留空则关闭访客验证。在 http://127.0.0.1:58025 查看邮件。

</details>

## 开发验证

在仓库根目录运行：

| 命令 | 用途 |
| --- | --- |
| `pnpm test` | 各包、服务端、Web 与 Admin 的单元测试 |
| `pnpm typecheck` | TypeScript 检查 |
| `pnpm deps` | 包与应用之间的依赖边界检查 |
| `pnpm test:conformance` | Node、浏览器与 workerd 一致性测试 |
| `pnpm test:integration` | 使用真实服务的后端集成测试 |
| `pnpm e2e:fullstack` | 本地浏览器 → API → worker → 存储的完整流程 |
| `pnpm dev:smoke` | 检查本地启动、登录与退出 |
| `pnpm ci:all` | 完整本地门禁：lint、类型、依赖、测试、构建、E2E、Action 产物与密钥扫描 |

集成与全栈验证需要 Docker；浏览器验证需要 Playwright Chromium，CI 使用 `pnpm --dir spec/conformance exec playwright install --with-deps chromium` 安装。密钥扫描与提交钩子需要安装 `gitleaks`。CodeQL 与依赖审查在 GitHub Actions 中单独运行。

按改动涉及的边界选择检查。协议变更应同步规范与一致性用例，预期输出必须经过人工审阅。具体要求见[验证策略](llmdoc/engineering/verification.mdx)和[工程约定](llmdoc/engineering/working-agreements.mdx)。

## 仓库结构

| 路径 | 职责 |
| --- | --- |
| [`packages/core`](packages/core) | Canonical schema、摘要、发布校验、Resolver、Diff 与 Contribution 合并；零 I/O |
| [`packages/assembler`](packages/assembler) | 参考上下文组装与 Trace |
| [`packages/ccv3`](packages/ccv3) | CCv3 导入、导出与转换报告 |
| [`packages/cli`](packages/cli) | 本地创作与 Registry 命令 |
| [`packages/contracts`](packages/contracts) | 共享 HTTP 契约 |
| [`apps/server`](apps/server) | 公开 API、Admin API 与 worker 进程 |
| [`apps/web`](apps/web) · [`apps/admin`](apps/admin) | 创作者与运营界面 |
| [`actions/publish`](actions/publish) | 通过 OIDC 发布的 GitHub Action |
| [`spec`](spec) | 规范、生成的 JSON Schema 与一致性测试集 |
| [`content/commons`](content/commons) | 种子内容与人工审校流程 |
| [`infra`](infra) · [`.railway`](.railway) | 本地服务、部署与基础设施配置 |
| [`llmdoc`](llmdoc) | 架构、契约、工程约定与运维指南 |

## 查找项目知识

从[执行模型](llmdoc/execution-model.mdx)、[架构决策](DECISIONS.md)，或公开的 [Canonical Model](spec/canonical-model.md) 与 [Context IR](spec/context-ir-v0.md) 规范开始。

探索某个子系统前，先通过 llmdoc 找到相应设计或操作指南：

```sh
npx -y @tokenroll/llmdoc tree
npx -y @tokenroll/llmdoc search "publishing"
npx -y @tokenroll/llmdoc context --files apps/server/src/main.ts
```

llmdoc 是外部工具，不是项目依赖。长期有效的项目知识统一放在 `llmdoc/`，旧设计资产和历史执行记录可从 Git 历史获取。

## 许可证

代码采用 [Apache-2.0](LICENSE)；规范正文与一致性测试集采用 [CC-BY-4.0](spec/LICENSE)。

Logo 与图标来自 [`char-pub/brand-assets`](https://github.com/char-pub/brand-assets) 子模块，遵循该仓库自己的 LICENSE 和 NOTICE，不属于本仓库许可证的授权范围。
