# 组装资产与确定性作者测试 v0-draft

本契约补充 [Preset](preset-v0.md)，共享 Creation、Release、许可、评级、Contribution 和权限体系。所有解析函数为无 IO 的纯计算；模型生成、私有会话存储、Registry 授权不属于解析器职责。

## Prompt Module

`type: "prompt-module"` 必须声明 `prompt_module: {version: "0-draft", blocks, imports?}`。块使用 Preset authoring block 结构，只提供字面策略文本、启停和 main / after-history 位置。模块不能声明布局、预算或运行能力，不能包含 Creative 内容和 context assets。presentation assets 仍可用。

Preset 的 `policy.imports` 与 Module 的 `prompt_module.imports` 使用相同结构：

```ts
interface PolicyImport {
  id: Segment;
  use: UnversionedCreationRef;
  pin: { release: ReleaseId; semantic_digest: Digest };
}
```

只允许 Preset → Module、Module → Module。导入数组的顺序有语义，按声明顺序 DFS，先展开依赖，再追加本地块。相同 ref 的相同 Release 只注入一次，第一条路径决定顺序；不同 Release 的菱形依赖拒绝。检测环先于已访问去重；图深度和规模有界。每份快照都重算摘要，并验证 ref、精确 Release pin、类型和状态。

解析后的模块块 ID 为 `@namespace/module#block`，Preset 本地 ID 保持原 segment。块 origin 包含 ref、release、semantic_digest、block 和 via。ResolvedPreset / ResolvedPromptModule 携带精确模块锁和锁摘要。空模块和禁用块仍然参与依赖授权、许可、评级与下架传播。

## 统一产物

`buildCreation(ResolveInput)` 返回 `BuildCreationOutput`：`artifact / json / digest / lock / warnings`，内容分支额外提供旧 `resolved`。`digest` 是完整产物摘要；作品摘要取 `artifact.root.semantic_digest`，两者不可混用。

`CreationArtifact` 公共字段为 version、root、lock、lock_digest、meta、assets，分为三类：

| kind | 专属内容 |
|---|---|
| content | `ir: ContextIR`，可选 `assembly: ResolvedAssembly` |
| preset | `preset: ResolvedPreset` |
| prompt-module | `module: ResolvedPromptModule` |

聚合 lock 覆盖 Creative、模块、搭配和作者测试的全部精确依赖，同一 ref 不能跨领域选择不同 Release。Context IR 的锁仍只描述 Creative 图，切换 Preset 不改写内容 IR。聚合 meta 与 assets 用于发布完整性、有效评级、许可、资源就绪和实际 CAS 复制，不能只检查内容分支。

Registry Release 详情提供 `artifact_digest`，`/artifact` 读取统一产物。旧 `/ir` 保留内容语义；策略作品明确返回不适用错误。公共作品不能依赖私有作品；即使根作品私有，发布者也必须有权读取每个私有依赖。能够加载 CAS 字节不代表获得访问授权。

## Scenario 锁定搭配

只有 Scenario 可声明：

```ts
assembly: {
  version: "0-draft";
  preset: {ref: string; release: string; semantic_digest: string};
  profile: RuntimeProfile;
  assembler: {name: string; version: string};
  tokenizer: {name: string; version: string};
}
```

它固定内容搭配、精确 Preset、运行 Profile 和实现版本。history、memory、state、真实用户身份等 Session 字段不进入此结构。`buildCreation` 将 preset 解析为 ResolvedPreset；SDK `assembleArtifact({artifact, session})` 使用锁定配置，Session 由调用方提供。它不承诺相同模型回复。

旁白模式不要求存在 `self` participant，支持 Scenario / World 等根作品。按角色组装仍必须指向存在的 participant；必需的 late slot 始终需要独立绑定。显式无效 participant 在两种模式下均拒绝。

## 作者测试

Preset 与 Scenario 可附带 `assembly_tests`。这些是作者主动编写、随作品公开的合成测试数据，编辑器不得自动捕获真实 Session。

```ts
interface AssemblyFixture {
  id: Segment;
  root: "self" | ExactRef;
  preset?: "self" | ExactRef;
  profile: RuntimeProfile;
  session: Session;
  assembler: {name: string; version: string};
  tokenizer: {name: string; version: string};
  expected:
    | {kind: "success"; messages_digest?: Digest;
       trace?: {source: string; included?: boolean; reason?: string}[]}
    | {kind: "error"; code: string};
}
```

成功预期至少提供消息摘要或非空 Trace 断言。Trace 的 source 对应 entry.id，例如 `preset:main` 或完整 IR fragment ID；未找到 source 是失败。`messages_digest` 使用 `digestAssemblyMessages` 对有序消息数组（含来源、附件内容摘要和描述）计算 canonical 摘要；附件 URL 是部署相关的传输地址，不进入测试摘要，使本地、CDN 和私有签名读取可验证同一内容。

Scenario 测试的 root 可为 self；Preset 测试需要外部精确内容根，preset 可为 self。self 避免把自己的摘要放入自己语义体的循环。所有外部引用进入聚合依赖图。fixture 的 profile 和 preset 是显式测试配置；省略 preset 表示默认策略，不自动继承内容根的 assembly 配置。

SDK `runAssemblyFixture({fixture, root, dependencies})` 返回单项结果，`runAssemblyTests({root, dependencies})` 执行根作品附带的全部测试。结果有 id、ok、issues，可包含 messages_digest、trace、error。结果不会修改作者期望；仅记录摘要不等于批准新基线。发布 worker 在写入成功状态前执行，失败阻止发布。

运行器严格核对实现身份：

| 实现 | 当前版本 |
|---|---|
| `@char-pub/assembler` | `0.0.0` |
| `estimate` | `tokenx@2.1.0` |
| `o200k_base`、`cl100k_base` | `gpt-tokenizer@4.0.0` |

版本不匹配、pin 不匹配、缺依赖和无效配置属于 setup failure，不能用 expected error 将它们算成通过。只有实际 `assemble` 的稳定错误码可满足错误预期。未知 tokenizer 不回退估算；estimate 本身可复现，但仍然只是估算。

## Contribution 与 CCv3

新增 `on: "configuration"`，原子 set/unset policy、prompt_module、assembly、assembly_tests。使用 base digest 三方合并；同字段两个不同修改冲突。必需策略字段不可 unset，合并后重新校验整份 Creation。此版本不提供块级自动合并。

CCv3 导入默认继续省略 system_prompt / post_history_instructions 原文。明确选用 `importPolicyPreset(report, options)` 才产生独立身份与已确认权利元数据的 Preset，并保留源卡作者署名；Registry 确认事务持久保存关联，重试可恢复。策略文本保持字面形式。

CCv3 导出显式传 `exportCCv3(ir, {resolvedPreset})`，启用 main / after-history 块分别合并到对应字段；禁用块不导出。布局、能力、区域预算、模块溯源及宏解释差异写入 Loss Report，不声称无损转换。Server 的精确策略选择同样检查读取权限，策略身份与输出桶可见性进入导出缓存键。导出保留内容和策略的完整署名、许可、最高有效评级与内容警告；只有 ResolvedPreset 而缺少元数据时，损失报告明确说明评级未验证及署名需补充。

Registry 导出接口缺省保持原包装文件兼容；`?part=card` 下载独立 CCv3 JSON，`?part=loss` 返回真实损失报告。两种部分读取均复核权限并使用 `private, no-store`，尚未生成时保持 202。

## 客户端

CLI `init --type` 覆盖九类作品；`build` 写 artifact.json 与 lock.json，并保留内容 context-ir.json 或类型对应策略文件。`preview --preset <char.yaml>` 显式选策略，`--session <json>` 提供逐槽绑定；Scenario 有锁定搭配且未显式覆盖时使用它。`test` 执行作者测试，不调用模型。`--dep` 可重复提供精确 Release 快照。

Publish Action 使用 artifact.root.semantic_digest 与 Server 源重读核对，支持 newline-separated `dependencies` 快照路径，dry-run 同样构建和测试。Action、CLI 不自行解析 latest 标签为 pin，不替代 Server 的授权、幂等、许可或状态检查。
