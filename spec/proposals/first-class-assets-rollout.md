# 一等创作资产完整接入：执行记录

状态：实施中。用户已授权上一轮全部剩余能力；Client 明确为 CLI、SDK、Publish Action；作者测试只做确定性组装验证。正式契约随实现写入规范与 schema。本文件保留阶段、接口协调和未完成项，不能把计划当成已交付。

## 范围与边界

- 打通 Preset 创建、编辑、发布、读取、预览、版本 Diff、Contribution 与 CLI/Action。
- 开放 Style、Scenario、Persona、Relationship，并提供各自必需的 slots、cast、bindings 编辑与预览。
- 新增独立 `prompt-module`，支持精确版本引用、模块依赖、来源与锁；Policy 继续与 Creative 分开。
- Scenario 可锁定 Preset、Runtime Profile、Assembler 与 tokenizer 配置；真实 Session 不进入搭配配置。
- 作者明确编写公开的合成 Session 与确定性期望，作为作品的 assembly tests；不调用真实模型、不处理模型凭据或计费。
- CCv3 policy 显式导入为独立 Preset，导出需显式选用并报告损失；原文不会自动公开。
- 统一 Web、Server、CLI、SDK 与 Action 的产物契约，保留内容 `/ir` 等已有读取接口。
- 不创建新的 Experience/Composition Creation，不引入可执行插件，不部署、不发布 npm、不推送远端。

## 共享接口决定

### Policy 模块

`type: "prompt-module"` 使用 `prompt_module: {version, blocks, imports?}`；Preset 使用已有 `policy` 加 `imports?`。导入为 `{id,use,pin:{release,semantic_digest}}`，只允许 Preset→Module、Module→Module，没有 Creative bind/override。

imports 按声明顺序 DFS，依赖块先于本地块；同一 ref/Release 首次出现决定位置并只注入一次。先检测环再去重，同一 ref 的不同 Release 拒绝。沿用规模限制，所有加载快照重算摘要。模块全局块 ID 为 `@namespace/module#block`，本地 Preset 块保留 ID；解析块附 origin。作者输入与解析输出的 block schema 分开。

### 发布与读取产物

新增统一 `CreationArtifact` 判别结构：

```text
version: "0-draft"
kind: "content" | "preset" | "prompt-module"
root: {ref, release, semantic_digest}
lock / lock_digest / meta / assets
kind=content: ir: ContextIR, assembly?: ResolvedAssembly
kind=preset: preset: ResolvedPreset
kind=prompt-module: module: ResolvedPromptModule
```

`buildCreation(ResolveInput)` 返回 `{artifact,json,digest,lock,warnings,resolved?}`；json 为完整 artifact，resolved 只为内容兼容旧 ResolveOutput。`checkPublish` 添加 artifact，内容分支暂留 resolved。聚合锁覆盖内容、策略、配置和测试依赖，公共/私有、状态、许可、评级、资产和黑名单检查不能因产物类型而遗漏。

内容 IR 的 lock 只描述 Creative 图；聚合 artifact 锁与它分开。跨图同一作品多版本拒绝，发布快照保存全部实际依赖。`/artifact` 返回统一产物，`/ir` 保留只读内容语义；不适用导出必须明确拒绝，不能永远 202。

### 搭配与作者测试

Scenario `assembly` 锁定精确 Preset 和 profile、assembler、tokenizer；不允许 history/memory/state 等 Session 字段。测试 fixture 显式使用 self 或外部精确根与 Preset，包含合成 Session、固定执行配置、成功消息摘要/Trace 断言或错误代码。self 避免作品摘要内嵌自身摘要的循环。未知执行版本/tokenizer 显式失败，不静默 fallback。

### Contribution

新增 `configuration` change domain，原子 set/unset `policy`、`prompt_module`、`assembly`、`assembly_tests`，同字段并发变更冲突，合并后整体 canonical 校验。首版不冒充提供块级文本自动合并。

## 阶段与验收

- [x] A. Core schema、模块解析、聚合产物、发布完整性、配置 Contribution。
- [x] B. SDK 的搭配执行、作者 fixture runner、严格 tokenizer/version 校验、CCv3 纯转换。
- [x] C. Server migration、创建/依赖权限/worker/read/export/avatar/search、配置 Contribution 与导入恢复。
- [x] D. CLI init/check/build/preview/test/publish、Action 与 Server 源摘要一致。
- [x] E. Web 新类型编辑、Preset/模块/组合/作者测试、版本与贡献、选择预览、导入导出。
- [x] F. 新类型发布到真实 CAS 的集成回归、私有依赖/评级/下架、跨客户端兼容、浏览器关键旅程。
- [ ] G. 全量门禁、生成物同步、llmdoc:update、干净工作区与明确交付报告。

完成条件是各入口真实使用闭环，而非枚举存在、接口返回成功或文件存在。任何未完成项继续保持未勾选。conformance 人工 expected、运营和远端部署仍按原审批边界处理。

## 协作分工

Core owner：schema、canonical、policy graph、build/publish、merge 与核心测试。
Server owner：contracts、DB migration、Registry/API/worker 与集成测试。
Web owner：作者与消费界面、Web API adapter 与浏览器测试。
主 agent：契约协调、CLI/Action、assembler SDK/作者测试、CCv3、规范与最终集成；稳定 llmdoc 由 recorder 收尾。


## 验证进展

- Core 模块、锁定搭配、发布完整性和 Contribution 全集已通过；新增策略 Diff 同时显示依赖与来源变化。
- SDK / CLI / Action / CCv3 针对性测试通过；消息测试摘要排除附件传输 URL，保留内容 digest。
- 模块展开与作者测试已在 Node、Chromium、workerd 使用相同断言通过，未接受任何 draft expected。
- 全仓类型和依赖边界检查通过。Server 集成及跨主体、成熟内容、导出缓存和级联下架回归通过；Web 138 项单测、7 条新能力关键浏览器旅程通过。完整 CI 正在执行，随后同步 llmdoc。
