# char.pub 测试策略（v0）

> 状态：Draft，2026-09-22。
> 原则：规范行为由**表驱动的单元测试 + 公共一致性测试集**锁定；涉及数据库、存储和鉴权的行为用**真实 Postgres 和 S3 兼容存储**做集成测试，不 mock 数据库。

---

## 1. 测试分层

| 层 | 范围 | 工具 | 运行时机 |
|---|---|---|---|
| L1 单元测试 | `packages/*` 的纯函数：标识符语法、canonicalize、digest、schema、发布校验、Resolver、Diff、合并、Assembler、CCv3 映射 | Vitest | 每次提交 |
| L1+ 性质测试 | 格式无关性（键序、缩进、默认值省略、NFC、行尾）；resolve 的确定性；合并的幂等性（已应用变更再次应用时跳过） | Vitest + fast-check | 每次提交 |
| L2 一致性测试 | `spec/conformance/` 下的 13 个首批用例及后续补充；Resolver 输出做**字节级**比对，Assembler 只比较 decision / reason | Vitest 运行器（在 Node 中） + 浏览器（Vitest browser mode 或 Playwright）+ workerd（`@cloudflare/vitest-pool-workers`） | 每次提交 |
| L3 集成测试 | `apps/server`：路由、授权、事务、pg-boss 任务、R2 交互、OIDC 与 webhook 校验 | Vitest + Testcontainers（Postgres 16 + MinIO）；OIDC 使用本地 JWKS；GitHub API 使用 msw 录制的响应 | 每次提交（CI） |
| L3+ 安全测试 | 越权访问矩阵（对每个路由自动生成“他人资源”和“匿名访问”用例）、CSRF / Origin、限流、源站校验、admin 三层防护 | 同 L3 | 每次提交 |
| L4 端到端 | 关键用户流程：UC-1～UC-8 | Playwright，针对本地全栈（docker compose）运行 | 合并到 main 时 + 发布前 |
| L5 冒烟 / 演练 | staging 上的真实 Cloudflare、Railway、R2、GitHub App | `scripts/smoke.ts` + 人工演练记录 | 部署后 / 里程碑验收 |
| Fuzz | CCv3 PNG、JSON 和 YAML 解析器，图片管线 | fast-check 生成器 + 恶意样本集 | 每晚 |

---

## 2. 一致性测试集格式（context-ir §15）

```text
spec/conformance/
├── README.md                  # 格式说明；以 CC-BY-4.0 公开
├── cases/
│   └── 001-level0-character/
│       ├── case.json          # { id, title, kind: "resolver"|"assembler"|"publish"|"ccv3", spec_refs: ["IR §5", "D-025"] }
│       ├── input/             # canonical creations + releases（JSON）
│       └── expected/
│           ├── context-ir.json       # Resolver 用例：字节级比对
│           ├── trace.json            # Assembler 用例：只比较 decision / reason
│           ├── error.json            # 预期失败：code + subject
│           └── loss-report.json      # CCv3 用例
└── runner/                    # 可复用的运行器，其他实现也可以调用
```

- 预期结果一律**人工审阅后提交**。生成器只能用来起草，不能用“把当前输出写成预期”的方式跳过审阅（避免把 bug 固化成规范）。
- 每个用例在 `spec_refs` 中注明它验证的决策或规范条款，便于追溯。
- 首批 13 个用例与 IR §15 一一对应；另外为 §12.1 的 9 条发布校验各补一个反例用例。

---

## 3. 覆盖率门禁

| 范围 | 行覆盖率 | 分支覆盖率 |
|---|---|---|
| `packages/core`、`packages/ccv3`、`packages/assembler` | ≥ 90% | ≥ 85% |
| `apps/server` | ≥ 80% | ≥ 75% |
| 安全关键模块：`core/canonical`、`core/digest`、`core/merge`、`server/authz`、`server/oidc`、`server/webhook`、`server/upload` | ≥ 95% | ≥ 95% |
| `apps/web`、`apps/admin` | 不设门禁；关键逻辑（Preview 渲染、Diff 高亮、敏感变更确认）需要有组件测试 | — |

覆盖率只是底线，不作为目标。对安全关键模块，每个 PR 都要附上被拒绝路径的测试。

---

## 4. 测试数据与环境

- 本地和 CI 都用 `docker compose`（Postgres 16 + MinIO）；也可以用 Testcontainers，每个测试文件分配一个独立的 schema 或数据库，以便并行运行。
- 时钟和 ID 通过注入控制（core 本身不读取时钟），测试中固定。
- 测试不访问任何外部网络：GitHub、OIDC、CSAM provider、Turnstile 全部使用本地替身；这些替身必须按真实协议实现，例如 JWKS 签名和 HMAC 验签都要真算。
- CCv3 样本：自己构造的合成卡，外加许可明确（CC0 或 CC-BY）的真实卡；不向仓库提交来源或许可不明的第三方卡片。

---

## 5. CI 流水线（GitHub Actions）

```text
lint（biome 或 eslint）+ typecheck（tsc -b）+ 依赖边界检查
  → unit + property（Vitest，带覆盖率）
  → conformance（Node + browser + workerd）
  → integration + security（Testcontainers）
  → build（所有 apps / packages）+ docker build（server）
  → gitleaks + CodeQL + dependency-review（并行）
合并到 main：+ e2e（Playwright）→ 构建产物
发布：手动触发 → 部署 staging → 冒烟测试 → 人工 promote 到 production
```

所有 job 都显式声明 `permissions: contents: read`；只有发布相关的 job 才授予 `id-token: write`。
