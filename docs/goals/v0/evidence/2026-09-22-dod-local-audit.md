# DOD 本地证据审计（2026-09-22）

审计对象：commit `45986f4`（访客验证与 CCv3 导入合并之后）。只审计可以在本地验证的条目；需要 CI、GitHub、staging、用户授权或人工审阅的部分只标注“被阻塞”。本文件不勾选 DOD，只给出结论与缺口，供决定是否打勾。

结论的含义：

- **可打勾**：条目的每一条要求都有当前通过的测试或可重复的记录作证据，验证方式与 DOD 的要求一致。
- **缺口**：有要求没有证据、只有部分证据，或验证方式与 DOD 的要求不符。每个缺口注明“实现缺失”或“只缺测试”。
- **被阻塞**：除了需要外部输入的部分（通常是一致性用例预期输出的人工接受），其余证据的情况单独说明。

## 运行的命令

均在 worktree 根目录执行，依赖通过 `pnpm install --frozen-lockfile` 安装。

| 命令 | 结果 |
|---|---|
| `pnpm exec vitest run --project unit --project server-unit` | 40 个文件，1075 个测试通过，0 失败 |
| `pnpm exec vitest run --project web --project admin` | 9 个文件，43 个通过 |
| `pnpm exec vitest run --project conformance-node --project conformance-browser --project conformance-workerd` | 103 个通过，81 个 todo（三个运行时各 27 个用例“能运行不崩溃”，预期输出尚未接受，比较项为 todo） |
| `pnpm exec vitest run --project integration` | 27 个文件，564 个通过（Testcontainers：Postgres 16 + MinIO） |
| `pnpm conformance:draft` | 27 个用例全部生成草稿（草稿目录被 git 忽略，未提交） |
| `pnpm conformance:precheck` | 8 个 IR 草稿全部 `ok`（001、002、003、004a、007、011、012b、013a） |

以下各节引用的测试名均来自上述运行的报告（vitest JSON reporter），状态均为 passed。

## 总表

| 条目 | 结论 | 证据摘要 | 缺口 |
|---|---|---|---|
| M0-4 | 缺口 | `pnpm infra:up` / `infra:down` 与 README 步骤存在 | 没有根目录 `pnpm dev`，server 没有开发启动脚本；没有干净环境走查记录（实现缺失） |
| M1-1 | 缺口 | `ids.test.ts` 54 个表驱动用例覆盖全部 7 种标识符 | fragment_id 单段 64 / 65 字符的长度边界未测（只缺测试） |
| M1-2 | 被阻塞 + 缺口 | zod schema 覆盖 §3～§13 全部类型；JSON Schema 防漂移与 draft 2020-12 校验通过 | 需要 schema 快照的人工审阅；Release / Contribution schema 没有直接的接受 / 拒绝用例（只缺测试） |
| M1-3 | 缺口 | NFC、行尾、默认值、JCS、digest 格式的单测；键序、缩进、NFC/CRLF 三条性质测试 | “默认值”只有示例测试没有性质测试；缺 semantic digest 公式的独立已知答案用例（只缺测试） |
| M1-4 | 可打勾 | `check.test.ts` 72 个用例覆盖未知占位符、`{{{{`、stable target、§3.1 全部类型、必需 slot | — |
| M2-1 | 被阻塞 | Resolver 单测覆盖 early binding、params、select、override、instance_key、participant / late slot、排序、EffectiveMeta、graph.removed、diagnostics；8 个 IR 草稿预检通过 | 字节级比对依赖一致性预期输出的人工接受；除此之外齐全 |
| M2-2 | 被阻塞 | 9 条规则 + 黑名单各有反例单测；11 个 publish 草稿给出预期错误码 | 一致性 publish 用例待人工接受；除此之外齐全 |
| M2-3 | 可打勾 | `diff.test.ts` 21 个用例 | — |
| M2-4 | 可打勾 | `merge.test.ts` 86 个用例，含幂等与顺序无关两条性质测试 | — |
| M3-1 | 可打勾 | `import.test.ts` 33 个、`containers.test.ts` 33 个（含 3 组 fuzz）、3 个合成样本 | 样本集只有同一张卡的 3 种容器（建议扩充，非阻塞） |
| M3-2 | 被阻塞 | `export.test.ts` 15 个（Loss Report、`extensions.char_pub`、往返） | 用例 010 待人工接受；除此之外齐全 |
| M3-3 | 被阻塞 | `assemble.test.ts` 47 个覆盖 locale、late binding、visibility、activation、budget、Session Overlay、Trace | Assembler 一致性用例待人工接受；除此之外齐全 |
| M3-4 | 可打勾 | token counter 标注 tokenizer，估算时标 `estimated` | — |
| M4-1 | 可打勾 | `db-permissions.test.ts` 13 个、`migrate.test.ts` 3 个、`schema.test.ts` 5 个 | — |
| M4-2 | 缺口 | GitHub OAuth 完整回调、`__Host-` cookie、Origin 白名单、封禁吊销、个人 Token | Discord / Google 登录只有配置解析测试，没有登录流程测试（只缺测试） |
| M4-3 | 缺口 | `authorize()` 越权矩阵 181 个自动生成用例；路由注册守卫测试；admin 能力矩阵 271 个 | 守卫是 vitest 静态扫描而不是 lint 规则；只扫描 `api/routes`，不覆盖 admin 路由；只识别 `app/api/router` 变量名（检查缺失） |
| M4-4 | 可打勾 | `cas.test.ts` 15 个 | — |
| M4-5 | 可打勾 | `queue.test.ts` 11 个 | — |
| M4-6 | 缺口 | 限流、kill switch、请求体上限有集成测试；源站校验与安全响应头有进程内 HTTP 测试和手工容器检查 | 源站校验与安全响应头没有集成测试（只缺测试） |
| M5-1 | 可打勾 | `api-access.test.ts` namespace 组 | — |
| M5-2 | 可打勾 | `api-access.test.ts` 草稿组 + `api-publish.test.ts` 9 个 | — |
| M5-3 | 可打勾 | `read-api.test.ts` 14 个 + `export.test.ts` 2 个 | — |
| M5-4 | 可打勾 | `search-api.test.ts` 13 个 + `search.test.ts` 9 个 | — |
| M5-5 | 可打勾 | `tombstone-cascade.test.ts` 10 个（A → B → C） | — |
| M6-1 | 可打勾 | `image.test.ts` 22 个 + `upload-pipeline.test.ts` 15 个 | — |
| M6-2 | 可打勾 | `csam.test.ts` 4 个 + `csam-hit.test.ts` 6 个 | — |
| M6-3 | 可打勾 | `contributions-api.test.ts` 21 个 + `guests-api.test.ts` 16 个 | — |
| M7-1 | 缺口 | 验签、delivery 去重、入队、按数字 ID 绑定、对账逻辑都有测试 | payload 为手写而不是录制；定时对账的调度注册没有测试（只缺测试） |
| M7-2 | 缺口 | 清单第 1～9 条都有本地 JWKS 表驱动测试与集成测试，反例齐全 | 第 10 条（claim 写入 Release 的 `published_by`）没有断言（只缺测试） |
| M7-2b | 缺口 | 冻结、拒绝发布、通知审计、重新绑定、换仓库、全程审计 | `repository.transferred` payload 为手写而不是录制（只缺测试） |
| M7-3 | 可打勾 | `cli.test.ts` 12 个 + `remote.test.ts` 5 个 + 本地端到端记录 | — |
| M9-1 | 缺口 | Access JWT、角色矩阵、四眼、审计校验、公开 api 上 admin 路由 404 | “admin 进程只挂载 admin 路由”没有直接测试（只缺测试） |

合计：可打勾 17 项；缺口 11 项（其中 M1-2 同时被阻塞）；被阻塞 4 项（M2-1、M2-2、M3-2、M3-3）。

## 按优先级排序的缺口

1. **M4-3 路由授权守卫**（检查缺失，安全相关）：把守卫扩展到 `apps/server/src/admin/routes/` 与 `admin/ops-routes.ts`；改为基于语法树识别任何 Hono 实例上的 `get / post / put / patch / delete / all / on / route` 调用，而不是按变量名匹配；另外决定“CI 中强制执行的静态检查测试”是否等同于 DOD 要求的 lint 规则，并写进 DECISIONS（或实现一个 Biome GritQL 插件规则）。
2. **M0-4 本地一键环境**（实现缺失）：增加 server 的开发启动脚本（例如用 `tsx watch` 以 `@char-pub/source` 条件分别启动 api 与 worker，先执行 migrate），根目录 `pnpm dev` 并行启动 server 与 web；README 写明步骤；在全新 clone 上按 README 走一遍并记录。
3. **M7-1 / M7-2b 录制的 payload**（只缺测试）：采用 `@octokit/webhooks-examples` 中 GitHub 官方的示例 payload（`push`、`installation`、`installation_repositories`、`repository.renamed`、`repository.transferred`）作为夹具，用测试密钥重新签名后走一遍 `parseDelivery`、`normalizeEvent` 和 binding 流程；另加一个测试，断言 worker 启动时注册了定时对账任务。
4. **M4-2 Discord / Google 登录**（只缺测试）：按 GitHub 回调测试的方式，为 Discord 与 Google 各模拟 token 与 userinfo 端点，走完登录回调，断言创建用户、记录外部身份并下发 cookie。
5. **M7-2 清单第 10 条**（只缺测试）：在 `github-oidc-publish.test.ts` 的成功发布用例中读取 `releases.published_by`，断言保存了 `repository_id`、`repository_owner_id`、`sha`、`ref`、`workflow_ref`、`job_workflow_ref`、`run_id`、`run_attempt`、`actor_id`、`event_name`、`jti`。
6. **M9-1 admin 进程的挂载范围**（只缺测试）：断言 admin 进程上 `/v1/search`、`/v1/creations/...`、`/v1/namespaces` 等公开路由返回 404，并且注册表里的每条路径都以 `/v1/admin/` 开头（`/healthz` 除外）。
7. **M4-6 源站校验与安全响应头的集成测试**（只缺测试）：用真实的 api 进程配置（设置 `ORIGIN_AUTH_SECRET`，连 Testcontainers 数据库），断言缺少或错误的 `X-Origin-Auth` 返回 403、正确时正常路由、`/healthz` 豁免，并检查响应里的安全头。
8. **M1-3 默认值性质测试与已知答案**（只缺测试）：用 fast-check 随机把默认值（`importance: "normal"`、`references: []`、默认 activation 字段等）显式写入或省略，断言 digest 不变；另加一个已知答案用例，独立按公式 `sha256(JCS({ creation 去掉 fragments, fragment_digests }))` 计算并与 `semantic_digest` 比较。
9. **M1-2 Release / Contribution schema**（只缺测试，另需人工审阅）：为 `ReleaseSchema` 与 `ContributionSchema` 各加一组接受 / 拒绝用例，并比对 JSON Schema 的判定；之后请用户审阅 `spec/schema/` 快照。
10. **M1-1 fragment 单段长度边界**（只缺测试）：在 `ids.test.ts` 的 fragment id 表中加入单段 64 字符（通过）与 65 字符（拒绝）。

被阻塞、需要用户处理的部分：一致性预期输出的人工审阅与接受（`pnpm conformance:review`，然后 `pnpm conformance:accept <case> --reviewer <name>`），它解锁 M2-1、M2-2、M3-2、M3-3（以及范围外的 M2-5）；M1-2 的 schema 快照人工审阅。

## 各条目详情

### M0-4 本地一键环境

要求：
1. `docker compose up` 启动 Postgres 16 + MinIO：根目录 `pnpm infra:up`（`docker compose -f infra/docker-compose.yml up -d --wait`）存在，README 写明。
2. `pnpm dev` 启动开发环境：**不存在**。根目录没有 `dev` 脚本；只有 `apps/web` 与 `apps/admin` 有 `vite` 的 `dev`；`apps/server` 没有开发启动脚本（只能构建镜像或 `node dist/main.js`）。
3. 在干净机器上按 README 走一遍：没有记录。

本次没有运行 `pnpm infra:up`：compose 项目名由目录名决定，在 worktree 中启动会与主工作区的容器同名，可能干扰正在运行的其他工作。

结论：缺口（实现缺失）。

### M1-1 标识符语法

要求与证据（`packages/core/src/ids.test.ts`，54 个）：
- namespace：`a`、`cyber-punk`、39 字符通过；40 字符、空串、首尾连字符、大写、下划线、中文、点号拒绝。
- name：64 字符通过、65 字符拒绝，大写、尾连字符、空格拒绝。
- label：`1.0.0`、`1.2.0-beta.1+build.5`、64 字符通过；65 字符、空串、`/`、空格拒绝。
- fragment_id：1～4 段通过、5 段拒绝；空段、首尾斜杠、大写、首尾下划线拒绝。
- creation_ref：带与不带 label 解析；缺 `@`、缺 name、空 label、`#`、大写、双 `@` 拒绝；格式化往返。
- local_ref / full_ref：`parses local refs`、`parses full refs`。
- 内部 TypeID 与 digest 格式也有用例。

缺口：fragment_id 单段的最大长度（64 字符）没有边界用例。

结论：缺口（只缺测试，极小）。

### M1-2 Canonical Model schema 与 JSON Schema

要求：
1. zod schema 覆盖 canonical-model §3～§13 的全部类型，包括 v0 只有模型的类型：`packages/core/src/schema/creation.ts`、`release.ts`、`ir.ts` 导出 Creation、Fragment（content / activation / visibility / locale）、ReferenceEdge（selector / override / pin）、Slot / Param / Binding、AssetSlot / Variant、Bootstrap / Greeting、CreationMeta、Provenance、CastMember（Scenario）、Release、Change / Contribution，以及 Context IR 相关类型。`CREATION_TYPES` 包含 relationship、scenario、persona、style、preset。
2. 导出 JSON Schema 到 `spec/schema/`：`json-schema.test.ts` 的 `published JSON Schema spec/schema/*.schema.json matches the zod definition`（4 个文件）与 `is a valid draft 2020-12 schema`（4 个）；creation schema 与 zod 对 6 个样例的接受 / 拒绝一致。
3. 只有模型的类型能通过校验：`check.test.ts` 中 `accepts a scenario with a cast`、`accepts a relationship template`、`allows {{self}} in a persona`、preset 只给 info。
4. Context IR schema：Resolver 在输出前用 `ContextIRSchema` 校验，全部 Resolver 用例都经过它。

缺口：
- `ReleaseSchema`、`ContributionSchema` 没有直接的接受 / 拒绝用例，只有防漂移比较。
- 验证方式要求“schema 快照审阅”，这是人工审阅，尚未进行。

结论：被阻塞（人工审阅）+ 缺口（只缺测试）。

### M1-3 canonicalize 与 digest

要求与证据（`packages/core/test/canonical.test.ts`，25 个）：
- NFC：`normalizeText applies NFC`；NFC 后键冲突被拒绝。
- 行尾归一与行尾空白：`unifies line endings and strips trailing whitespace per line`，且保留缩进。
- 省略默认值：`fragment digest ignores explicitly written defaults`、`strips keyword activation defaults`、`canonicalizeCreation ignores defaults at creation level`（示例测试）。
- JCS：`sorts keys and has no whitespace`；`matches a known sha256 of the empty object`。
- fragment digest 与 semantic digest：`changes when content, activation or a locale variant changes`、`semantic digest depends on fragment order`、manifest 中 `fragment_digests` 与 fragment digest 一致；声明的 digest 不符时拒绝。
- `sha256:<hex>` 格式：`accepts a Level 0 character and returns stable digests`。
- 性质测试（fast-check）：`key order does not change the semantic digest`、`CRLF, trailing spaces and NFD vs NFC do not change the digest`、`JSON pretty-printing does not change the digest`（缩进）。

缺口：
- DOD 列出的四项性质（键序、缩进、默认值、NFC 等价）中，“默认值”只有示例测试，没有性质测试。
- 没有独立按公式计算 semantic digest 的已知答案用例；目前只校验了空对象的 sha256 和 manifest 结构。一致性用例的 digest 在接受后可以部分弥补。

结论：缺口（只缺测试）。

### M1-4 `char check` 规则

证据（`packages/core/test/check.test.ts`，72 个）：
- 未知占位符：`templates rejects unknown placeholder`，另有未闭合、非法 slot 名、未声明 slot / param。
- `{{{{` 转义：`templates accepts the {{{{ escape`；`template helpers tokenizes placeholders and brace runs unambiguously`（resolve 测试）。
- 只能 override `stable: true` 的 target：`checkOverrideTargets rejects an unstable target`，以及 missing target、add 冲突、intrinsic 身份 fragment 需要 scenario + force。
- 各类型最小要求（§3.1 的 character、world、lorebook、relationship、scenario、persona、style、preset）：`type requirements` 组 9 个用例全部覆盖。
- 必需 slot：`checkEdgeBindings rejects a missing required slot`。
- CLI 层：`packages/cli/test/cli.test.ts` 的 `check --fix` 用例。

结论：可打勾。

### M2-1 Resolver → Context IR

单元证据（`packages/core/test/resolve.test.ts` 33 个、`resolve-more.test.ts` 18 个）：
- early binding：`binds a slot to another character in the graph and uses it as a speaker`、`binds {{self}} early and the persona late`。
- params：`uses the param default and rejects wrong types or unknown params`。
- select：`select.include keeps only matching fragments and records the rest as removed`、`supports prefix wildcards in exclude`。
- override 与优先级：`replace, remove and add`、5 个非法 override 用例、`forbids replacing an intrinsic world outside a scenario`、`allows force override of an intrinsic character inside a scenario and marks AU`。override 的 target 只能是被直接引用的 Creation 的 fragment，所以每个 instance 只受它的入边一层 override 影响，§5.3 的“原始内容 < edge override < scenario override”由结构保证；同一层重复 target 报错（`rejects two overrides of the same target on one reference`）。
- instance_key：`gives two instances of the same release distinct keys (no collisions)`、`allows the same release along two paths as two instances`。
- participant / late slot 的 key：`maps early and late cast members to participants and speakers`、`unused optional late slots drop both the late slot and its participant`、`publishes the template itself with its slots as late slots`。
- 排序：`orders fragments depth-first with edges sorted by id`；预检也检查排序。
- EffectiveMeta：`aggregates rating, licenses and lock, and explains origin`（rating 取最大并列出来源）、`aggregates independent asset rating and license`、`collects contributors and import omissions`。
- graph.removed 与 diagnostics：select 与 override 用例检查 `graph.removed`，多处断言 `diagnostics` 代码。
- 确定性：`is byte-for-byte deterministic and independent of input formatting`。

一致性：27 个用例在 Node、Chromium、workerd 中全部能运行；8 个 IR 草稿通过预检（排序、digest 重算、key 公式、悬空引用）。字节级比对要在预期输出被人工接受之后才会执行（目前为 todo）。

结论：被阻塞（一致性预期输出的人工接受）；除此之外证据齐全。

### M2-2 发布校验

单元证据（`packages/core/test/publish.test.ts`，21 个）：`one counter-example per rule` 组覆盖第 1～9 条（第 8 条另有非商用组合的 warning），`rejects blocked content even under a new name` 与 `rejects blocked content anywhere in the dependency closure` 覆盖黑名单。

一致性草稿的结果与规则一一对应：101 `publish.unpinned`、102 `publish.tombstoned_dependency`、103 / 013b `publish.public_depends_on_private`、104 `publish.diamond_conflict`、105 `check.override_target_unstable`、106 `check.required_slot_unbound`、107 `publish.asset_not_ready`、108 `license.dependency_not_redistributable`、109 `publish.label_taken`；006a 通过并带 `publish.yanked_dependency` 警告。

服务端也有对应的集成测试：`api-publish.test.ts` 的 tombstoned 依赖、asset 未就绪、label 幂等与 409。

结论：被阻塞（publish 用例的预期输出待人工接受）；除此之外证据齐全。

### M2-3 Context Diff

证据（`packages/core/test/diff.test.ts`，21 个）：added / removed 并排序、不同路径视为不同 instance、content / activation / visibility / importance / placement_hint / locales 六种字段变化、多字段按固定顺序列出、`reports origin changes even when content is unchanged`、`compares effective metadata and marks rating / license for highlighting`、lock 变化、token 增量、与 fragment 顺序无关。

结论：可打勾。

### M2-4 Contribution 三方合并

证据（`packages/core/test/merge.test.ts`，86 个）：
- 按键比较的表驱动三方判定：fragment、edge、asset slot、asset variant、metadata 的 add / modify / remove / set / unset，各自覆盖 applied、already_applied、conflict。
- 服务端计算 `sensitive`：`is computed by the server regardless of what the client claims`，rating / license / content_warnings 为敏感，tags / display_name 不是；需要逐项确认。
- 已应用的变更跳过：`already_applied` 各用例与 `does not ask to confirm sensitive changes that are already applied`。
- 冲突报出对象：`returns null result and lists conflicts when anything conflicts`、`reports slot_missing`。
- 同一 Contribution 内不允许重复键：`rejects two changes with the same key`。
- AssetSlot 与其 variant 视为同一键：`rejects a whole-slot change together with a variant change of the same slot`，以及 `allows variant changes of different slots and different variants of one slot`。
- 幂等性质测试：`re-applying the same contribution skips every change and keeps the digest`、`is deterministic and independent of change order`。

结论：可打勾。

### M3-1 CCv3 / PNG 导入

证据（`packages/ccv3/test/import.test.ts` 33 个、`containers.test.ts` 33 个、`fixtures.test.ts` 4 个）：
- ID 稳定性判定：`maps description / personality / scenario to fragments with stable IDs`；lorebook 条目 `imports lorebook entries as unstable knowledge fragments`。
- 派生临时 ID 与碰撞：`records the ID derivation table and dropped entries`，同名条目得到 `lore/lamp-2`。
- 只记录 policy 字段名：`omits policy fields: only names in provenance, values only in the report`。
- Import Report：`records unknown placeholders and dropped fields`、`uses conservative meta defaults and asks for confirmation`。
- 样本集：`synthetic-mira.json`、`.png`、`.charx` 三个合成样本都能干净导入。
- fuzz：`never throws anything but CharError for random bytes or mutated cards`、`for random JSON-shaped cards`，以及 PNG 与 zip 容器的变异输入。
- 服务端导入：`apps/server/test/import-api.test.ts` 14 个。

附注：样本集只是同一张卡的三种容器，建议补几张结构不同的合成卡（多 lorebook、V1 / V2、缺字段），不影响结论。

结论：可打勾。

### M3-2 CCv3 导出与 Loss Report

单元证据（`packages/ccv3/test/export.test.ts`，15 个）：`produces a complete loss report`、`records attribution, licenses and IR provenance`（断言 `extensions.char_pub`）、`does not write policy fields unless a preset is chosen`、V2 兼容卡、PNG 内嵌、往返 `import → canonical → IR → export`。服务端：`export.test.ts` 2 个、`read-api.test.ts` 的延迟构建。

一致性用例 010 能在三种运行时运行，比较待预期输出被接受。

结论：被阻塞（用例 010 待人工接受）；除此之外证据齐全。

### M3-3 参考 Assembler

单元证据（`packages/assembler/test/assemble.test.ts` 47 个、`units.test.ts` 15 个）：
- locale 回退：`prefers session locale over profile locale over the default`、`matches a more specific requested tag to its base language`、BCP 47 查找链。
- late binding：`late slots` 组 6 个。
- visibility：`narrator mode includes private fragments with an explicit note`、`per-agent mode excludes private fragments not addressed to the current participant`。
- activation：always、keyword（大小写、整词、扫描窗口、secondary keys）、semantic 未启用时按 manual 处理并记录 `skipped:semantic`、manual 需显式开启。
- budget：`fails loudly when pinned fragments alone exceed the budget`、`skips whole fragments that do not fit`（不截断）。
- Session Overlay：`adds memory, state and active variants as separate messages without touching fragments`。
- Trace：`trace lists every fragment in IR order, then session blocks and history`。

一致性中的 Assembler 用例（例如 009、012c）待人工接受。

结论：被阻塞（Assembler 用例待人工接受）；除此之外证据齐全。

### M3-4 token 估算

证据：`units.test.ts` 的 `estimate counter is marked as an estimate`、`loads exact encodings on demand`、`profile selection falls back to the estimate for unknown names`；`diff.test.ts` 的 `defaults the tokenizer label to estimate`；`export.test.ts` 的 `uses the injected token estimator`、`estimates tokens for Latin and CJK text`。

结论：可打勾。

### M4-1 数据库 schema 与迁移

证据（集成）：`db-permissions.test.ts` 的 `connects as a non-owner role`、`can insert and select audit_log`、`cannot UPDATE audit_log`、`cannot DELETE from audit_log`、`cannot TRUNCATE audit_log`、不能改表结构、不能读迁移记录、`has all expected tables`；`migrate.test.ts` 的幂等与 `uses a role that is neither superuser nor able to bypass row security`；`schema.test.ts` 的约束。

结论：可打勾。

### M4-2 Better Auth

证据（`auth-better-auth.test.ts` 21 个、`auth/env.test.ts` 15 个、`api-access.test.ts`）：
- GitHub 登录：`signs in with GitHub: creates a UUIDv7 user, records the external identity and sets the session cookie`，以及 state 不符、不受信任的回调地址、未配置的 provider、没有密码注册。
- `__Host-` cookie：`uses the __Host- prefix with Secure, HttpOnly, SameSite=Lax, Path=/ and no Domain`。
- Origin 白名单：两个 `origin allow-list` 用例。
- 封禁后立即吊销：`revokes all sessions and tokens at once and writes an audit record`。
- 个人 Token：`are created with a browser session, shown once, scoped and revocable`。

缺口：Discord 与 Google 登录只有配置解析测试（`enables only fully configured providers`、`requires client id and secret together`）和“未配置时拒绝”，没有登录流程测试。

结论：缺口（只缺测试）。

### M4-3 集中式授权

证据：
- `authorize()` 越权矩阵：`apps/server/src/authz/authorize.test.ts` 181 个用例，按动作 × principal × 资源状态自动生成（含 fast-check），断言他人资源与匿名访问拿不到私有内容、私有资源一律 404；`authorize-namespace.test.ts`、`authorize-source.test.ts`。
- 路由都经过授权：`routes-guard.test.ts` 的 `every route module registers routes through route()` 与 `detects a direct registration`。
- admin 路由：`admin-matrix.test.ts` 271 个用例，由注册表逐条生成角色 × 路由的判定。
- HTTP 层的“他人 / 匿名”行为：`api-access.test.ts`、`read-api.test.ts`、`contributions-api.test.ts`、`import-api.test.ts` 等。

缺口：
- DOD 要求用 lint 规则保证；现在的实现是一个随 `pnpm test` 与 `ci:all` 运行的静态扫描测试，需要决定是否接受，或改为真正的 lint 规则。
- 扫描范围只有 `apps/server/src/api/routes/`，不包括 `apps/server/src/admin/routes/` 与 `admin/ops-routes.ts`；admin 路由依赖 `adminRoute()` 注册表生成矩阵，直接调用 `app.get(...)` 注册的 admin 路由不会被发现。
- 正则只识别名为 `app`、`api`、`router` 的变量，其他变量名上的直接注册会漏过。

结论：缺口（检查缺失）。

### M4-4 CAS 存储层

证据（`cas.test.ts`，15 个）：`putBlob rejects content that does not match the declared digest`（写入前重算）、`private objects cannot be read anonymously but can with a signed URL`、`signed GET URLs are limited to five minutes`、`copyToPublic makes an object anonymously readable and marks it public`、签名 PUT 的长度与类型限制、幂等写入。

结论：可打勾。

### M4-5 pg-boss 任务

证据（`queue.test.ts`，11 个）：`a rolled back transaction leaves neither the business row nor the job`、`a committed transaction persists both the business row and the job`、`the same singletonKey is only queued once while pending`、`runOnce applies an effect once even if the job is delivered twice`、`once retries are exhausted, moved to the dead letter queue`、指数退避。

结论：可打勾。

### M4-6 源站校验、安全头、请求体上限、限流、kill switch

证据：
- 应用内限流（Postgres）：`ops.test.ts` 的 4 个限流用例（含并发不丢计数）；各业务测试中的 429。
- kill switch：`ops.test.ts` 的开关缓存、`admin.test.ts` 的 `takes effect within 5 seconds`、`api-publish.test.ts` 的 503，以及上传、Contribution、访客的开关用例。
- 请求体上限：`api-access.test.ts` 的 `accepts drafts up to 5 MiB but not ordinary bodies over 1 MiB`（集成）、`middleware.test.ts` 的 413。
- 源站校验：`middleware.test.ts` 的 `rejects requests without the edge secret`、`accepts current and previous secrets during rotation, and exempts health checks`（进程内 HTTP 测试）；PROGRESS 记录了容器内手工检查（缺头 403、正确值放行）。
- 安全响应头：`middleware.test.ts` 的 `sets strict headers`（进程内 HTTP 测试）。

缺口：源站校验与安全响应头没有集成测试（集成测试的 api-harness 不设置源站密钥，也不检查响应头）。

结论：缺口（只缺测试）。

### M5-1 Namespace

证据（`api-access.test.ts`）：需要登录、每个账号一个 namespace、非法 slug；保留名 commons / admin / api / www / official / staging；已占用；`renames with a permanent redirect; the old name cannot be registered again`；只有 owner 能改名。`read-api.test.ts` 的 `redirects renamed namespaces and creations permanently`。admin 的保留名管理见 `admin-routes.test.ts`。

结论：可打勾。

### M5-2 草稿 → Revision → Release

证据：`api-access.test.ts` 的 `uses optimistic locking and requires If-Match`、`rejects drafts with check errors`；`api-publish.test.ts` 的 `walks from sign-in to an active public release`、`materializes the closure and blob references`（断言 `release_fragments`、`blob_refs`）、`is idempotent for the same label and content, and refuses different content`、`requires an Idempotency-Key`、`records locks and reverse edges`（断言 `release_locks`、`reverse_edges`）、`stores revision content so it can be rebuilt byte-for-byte`；`api-closure.test.ts` 的 A → B → C 闭包。

结论：可打勾。

### M5-3 读取与下载

证据（`read-api.test.ts`，14 个）：`returns 410 with the public reason code for tombstoned releases`、`returns yanked releases with a warning`、`redirects public IR to the immutable CDN URL, which serves the exact bytes`、`gives members a short-lived signed URL for private IR, and nobody else`、`hides private releases from others with 404, even by exact label`、`schedules a build once and answers 202 with Retry-After until it is cached`；`export.test.ts` 的导出任务。

结论：可打勾。

### M5-4 搜索

证据（`search-api.test.ts` 13 个、`search.test.ts` 9 个）：`finds one-character queries`、`finds two-character queries across Chinese and Japanese`、`matches words in summaries and full-width input`、三字以上走 trigram、LIKE 转义；`hides mature creations and creations inheriting mature dependencies by default`、`requires the confirmation timestamp, not just the flag`、不公开缓存个性化结果；只出现已发布的 public 内容。

结论：可打勾。

### M5-5 yank 与 tombstone 级联

证据（`tombstone-cascade.test.ts`，10 个，A → B → C 依赖链）：`previews every release that contains the fragment, including downstream ones`、`walks reverse edges when a release is tombstoned as a whole`、`tombstones, withholds, blocks and audits in one transaction, then removes copies`（CDN 替身收到被清除的 URL）、`makes resolve fail with the reason`、`blocks republishing the same content under a new name`；yank 的成员校验、理由、警告与审计。

结论：可打勾。

### M6-1 上传状态机

证据：`image.test.ts`（22 个）按文件头识别 png / jpeg / webp / gif，不识别 SVG / HTML；转 webp 并生成缩略图；`strips EXIF including GPS, and applies the orientation`；像素炸弹、超大文件、动画、截断与伪造文件、polyglot 被拒。`upload-pipeline.test.ts`（15 个，集成）：`rejects SVG disguised as PNG`、`rejects a PNG + ZIP polyglot`、`rejects a pixel bomb`、sha256 不符、按用途限制类型与大小、新账号配额。只有 ready 可被引用：`publish.test.ts` 的规则 7 与 `api-publish.test.ts` 的 `fails when an asset is not ready`。恶意样本在测试中运行时生成。

结论：可打勾。

### M6-2 CsamScanner

证据：`csam.test.ts` 的 `noop scanner records 'not scanned' and lets the image through`、`an unavailable provider never auto-approves`；`csam-hit.test.ts` 的 `quarantines, preserves evidence, locks the uploader and blocks the content`、再次上传被拒、应用角色不能删除事件记录、员工标记已被 Release 引用的 asset 走同一路径并入队下架、`rescanning existing assets once a real scanner is connected`、worker 执行下架并清除 CDN 缓存。

结论：可打勾。

### M6-3 Native → Native Contribution

证据：`contributions-api.test.ts`（21 个）：signed-in / closed / invited / anyone 四种策略的授权；`marks agent-token submissions as agent, even if the body says otherwise`，以及按 `agent` 过滤列表；`rate limits per account`；`re-checks the grant against the license at acceptance time`、`requires an explicit grant when the target reserves all rights`；接受后 provenance 的 contributors 与下一个 Release 的 IR 中出现贡献者；自动 rebase、冲突、敏感变更逐项确认。`guests-api.test.ts`（16 个）：验证邮箱后访客可以提交，signed-in / invited 策略下被拒，访客开关关闭时停止。

结论：可打勾。

### M7-1 GitHub App webhook

证据：
- 验签：`webhook/github.test.ts` 的 `parseDelivery: signature` 组（原始字节、轮换、篡改、只有 sha1、大小写、截断、重复头等），`github-webhook-api.test.ts` 的 `rejects missing, malformed and wrong signatures with 401`。
- 按 delivery 去重与入队：`a push on the tracked branch enqueues one sync; a duplicate delivery is applied once`。
- 按数字 ID 绑定：`records the installation and binds by numeric ids`、`owner ids come from GitHub, never from the request`、`a push from a different owner with the same repository id is ignored`。
- 对账：`reconciliation freezes bindings whose owner changed without a webhook`、`records bindings whose repository the installation can no longer access`。

缺口：
- DOD 要求用录制的 payload；测试中的 payload 是在测试文件里按 GitHub 格式手写的，没有使用录制或官方示例。
- 定时对账由 worker 启动时注册（每 6 小时），但没有测试断言调度已注册。

结论：缺口（只缺测试）。

### M7-2 OIDC 发布

安全设计中的 10 条清单与证据（`oidc/github.test.ts` 66 个、`github-oidc-publish.test.ts` 16 个）：
1. 远程 JWKS、只接受 RS256：`builds a remote JWKS for GitHub without fetching`、拒绝 RS512、HS256 伪造、alg none、未知 kid、其他密钥签名。
2. iss：`rejects wrong issuer`、`rejects missing issuer`。
3. aud：`rejects wrong audience`、`rejects audience list without ours`。
4. 时钟容差与最大 token 年龄：`accepts tokens within the clock tolerance`、`rejects issued too long ago`、未来签发、过期。
5. jti：`authenticates once and rejects a replay of the same token`、`does not consume the jti when the request is rejected`、`claims each jti once, even concurrently, and purges expired ones`、`each token works once`。
6. repository_id + repository_owner_id：`rejects: repository re-created under the same name`、`rejects: owner changed`、`a repository re-created under the old name cannot publish (rename hijack)`。
7. ref 与可选约束：`refMatches` 表、`rejects: ref not allowed`、`ref must be protected`、`environment required`、`reusable workflow required`、`rejects refs outside the binding's publish refs`。
8. event_name：拒绝 pull_request_target、pull_request、schedule，接受 workflow_dispatch 与 release。
9. commit 等于 sha，并在该 commit 重读源码重算 digest：`rejects a request for a commit other than the token's sha`、`rejects content that does not match the digest the workflow reported`、`load-source.test.ts` 的 `matches a local build`。
10. 保存 claim：`accepts a valid token and returns only the claims we need` 断言提取的 11 个 claim；**但没有测试断言它们被写入 Release 的 `published_by`**。

未安装 App 时拒绝：`a deleted installation cannot publish`、`rejects a repository that has no binding`。

结论：缺口（只缺测试，第 10 条）。

### M7-2b 仓库 transfer 后冻结

证据：`github-binding.test.ts` 的 `a transfer freezes the binding until the author confirms`、`rebinding accepts the new owner`、`reconciliation freezes on owner mismatch; unbinding allows switching to a new repository`、`every state change is audited and the chain is intact`；`github-webhook-api.test.ts` 的 `a transfer freezes the binding and notifies the owner; sync skips frozen bindings`；`github-oidc-publish.test.ts` 的 `a transfer freezes the binding; rebinding to the new owner restores publishing`、`after unbinding, the old repository cannot publish; a newly bound one can`；`webhook/github.test.ts` 的 `repository.transferred from a user or an organization`。

缺口：`repository.transferred` 的 payload 是手写的，不是录制的。

结论：缺口（只缺测试）。

### M7-3 `char` CLI

证据：`packages/cli/test/cli.test.ts`（12 个，在临时目录的真实文件系统上执行命令）：init 三种类型并通过 check / build；`check --fix reports missing ids without --fix, then writes stable ids back and is idempotent`、标题冲突时生成唯一 ID；build 与 preview（含本地依赖快照与 trace）；char.yaml 的安全限制。`remote.test.ts`（5 个，模拟 Registry）：login 校验并以 0600 保存、环境变量优先；publish 上传草稿、创建 Revision、带 Idempotency-Key 发布，以及错误报告。真实 CLI 对真实 api / worker 容器的发布见 [2026-09-22-local-e2e-publish.md](2026-09-22-local-e2e-publish.md)（幂等、409、新 label）。

结论：可打勾。

### M9-1 admin 进程

证据：
- Access JWT：`admin/access.test.ts` 7 个；`admin.test.ts` 的 `rejects requests without a valid Access JWT`、`rejects Access users who are not staff or are banned`。
- 角色：`admin/roles.test.ts` 101 个；`admin-matrix.test.ts` 271 个，由注册表逐条生成“角色 × 路由”的判定。
- 四眼：`admin-routes.test.ts` 的 `four eyes for more than 50 affected releases creates a pending approval instead of executing`、`lets a sole eligible staff member confirm only after the cooling-off period`、CSAM 锁定账号解封需要第二人。
- 哈希链审计与校验：`audit.test.ts` 7 个（篡改字段、重算哈希、删除条目都能被发现）；`admin.test.ts` 的 `owner sees all entries and can verify the chain`。
- 公开 api 上访问 admin 路由：`admin routes are not mounted on the public api` 返回 404。

缺口：“admin 进程只挂载 admin 路由”没有直接测试（没有断言 admin 进程对公开路由返回 404，也没有断言注册的路径都在 `/v1/admin/` 下）。

结论：缺口（只缺测试）。
