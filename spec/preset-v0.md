# Char Preset v0-draft

Status: **v0-draft**。本文定义 Preset 协议与纯计算参考实现；模块依赖、统一发布产物、锁定搭配与作者测试见 [组装资产契约](assembly-assets-v0.md)。

## 1. 身份与边界

Preset 是 `type: "preset"` 的 Creation，共享作品身份、元数据和 semantic digest。它的 `policy` 提供声明式运行策略，不能改变 Creative Truth。Creative 内容中的 `instruction` 继续表示作者的扮演说明，不能用来绕过策略边界。

Preset 必须有 `policy`，其他 Creation 禁止声明此字段。Preset 禁止非空 `fragments`、`references`、`slots`、`params`、`cast`，禁止 bootstrap 和 context assets；允许 presentation assets 作为展示资料。空的可选集合依现有 Canonical 规则省略。策略只处理文本，不使用展示资源进行模型输入。

内容 `resolve` 对 Preset 根和实际加载的 Preset 依赖返回 `resolve.preset_not_content`。统一发布流程通过 `buildCreation` 生成独立策略产物，不生成丢失策略的空 IR。`meta.recommended_presets` 仍只是推荐作品身份，不自动选用、锁定或下载 Preset。

## 2. Canonical Policy

```ts
interface PresetPolicy {
  version: "0-draft"
  imports?: { id: Segment; use: CreationRef; pin: {release: ReleaseId; semantic_digest: Digest} }[]
  blocks: {
    id: Segment
    text: string
    position: "main" | "after-history"
    enabled?: boolean // 默认 true
  }[]
  layout: PresetRegion[]
  region_budgets?: Partial<Record<CreativeRegion, number>>
  requires: { system_role: true; multiple_system_messages?: true }
}
```

规则：

- 对象严格校验，未知字段拒绝。`blocks` 可以为空，但不能省略；ID 在一个 Preset 内唯一，作者修改文本或位置时应保留 ID。
- `text` 不得为空或只含空白。它是字面文本，`{{user}}` 等内容不执行插值，也不执行脚本、表达式或外部调用。
- 布局必须完整列出下表区域，每项恰好一次；缺失、未知或重复区域均拒绝。
- `region_budgets` 只接受 Creative 区域，值是非负安全整数。零表示该区域没有可用预算；未指定表示没有局部上限。
- `requires` 必须明确声明 system role；多 system 消息需求可以显式声明，能力不能通过缺省值假定成立。
- 支持精确引用独立 `prompt-module`，规则见组装资产契约；不支持 Preset 继承。块没有独立 Release。

| 区域 | 内容 | 可设区域上限 |
|---|---|---|
| `system:character` | 根角色 | 是 |
| `system:cast` | 其他角色 | 是 |
| `session:bindings` | Session 绑定描述 | 否 |
| `system:persona` | Persona | 是 |
| `system:world` | 世界 | 是 |
| `system:scenario` | 情境 | 是 |
| `system:relationship` | 关系 | 是 |
| `system:knowledge` | 知识 | 是 |
| `system:style` | 文风 | 是 |
| `system:instruction` | 作品扮演说明 | 是 |
| `system:examples` | 对话示例 | 是 |
| `session:memory` | 会话记忆 | 否 |
| `session:state` | 会话状态 | 否 |
| `session:variants` | 当前资产变体 | 否 |
| `history` | 原样消息历史 | 否 |

上表顺序同时作为默认布局区域顺序。显式 Preset 可将内容区域置于 history 前或后，不支持在历史内部插入，也不改写历史的角色和时间顺序。main 块始终位于全部区域之前，after-history 块位于全部区域之后（包括移到历史后的 Creative 区域）。同一 position 的块保持声明顺序。

### 2.1 规范化与摘要

文本沿用 Unicode NFC、统一换行和去行尾空白。省略 `enabled: true` 和空 `region_budgets`，保留 `enabled: false`。块数组和 layout 数组的顺序参与语义；不得排序后再哈希。整个规范化 policy 随 Creation manifest 参与 semantic digest。未含 policy 的既有 Creation 摘要算法不变。

JSON Schema 导出布局集合、条件字段与内容域限制；按块 ID 的唯一性仍需语义检查，不能仅凭结构 schema 判断有效。

## 3. 独立解析与信任边界

```ts
resolvePreset({
  creation: unknown,          // 完整作品快照，不能只有 policy
  release: ReleaseId,         // 精确发布 ID
  semantic_digest: Digest,    // 必须提供的期望摘要
  dependencies?: ReleaseInput[] // 精确模块快照闭包
}): ResolvedPreset

interface ResolvedPreset {
  ref: CreationRef            // 无 label
  release: ReleaseId
  semantic_digest: Digest
  resolver: { name: string; version: string }
  policy: ResolvedPolicy     // blocks 已展开，并带 origin
  lock: LockEntry[]
  lock_digest: Digest
}
```

解析器严格校验入参，将完整 Creation 重新规范化并执行静态检查；确认 Preset 类型并重新计算 semantic digest，与期望值不等时拒绝。返回规范化 policy 和独立策略身份。读取数据、访问权限、发布状态、Release ID 与快照的权威映射由调用方和 Registry 负责，纯解析器没有 IO，不凭摘要证明访问授权或作者真实性。

Assembler 校验 ResolvedPreset 的结构；调用方必须先通过 `resolvePreset` 验证不可信快照。ResolvedPreset 不携带全部作品元数据，Assembler 不能用 policy 单独重新计算完整作品摘要。它与已解析内容 IR 一样是调用方提供的解析结果，不是带签名的权限凭证。

内容 IR 与策略身份分别记录；切换策略不改变 IR 或它的锁摘要。策略的独立 lock 固定模块依赖，统一产物的聚合 lock 另覆盖搭配与作者测试依赖。复现组装还需要相同 Session、Profile、Assembler 和 tokenizer；不承诺模型生成文本确定。

## 4. Assembler 行为

### 4.1 能力与消息

显式 Preset 要求 `profile.capabilities.system_role === true`。若 `requires.multiple_system_messages` 为 true，Profile 也必须显式为 true；缺省或 false 返回 `assemble.preset_incompatible`。

没有显式要求多 system 消息时，Runtime 仍可通过显式 true 支持它。否则只允许合并相邻 system 消息；若历史将 system 消息分成多个组，必须报不兼容，不能跨历史挪动文本。合并时保留所有来源和附件。最终只有一个 system 组时允许使用单 system Runtime。

没有选 Preset 的调用保留既有行为：固定默认布局、IR 顺序预算选择、无 system role 时使用 user，以及不支持多个 system 消息时的合并。

### 4.2 可见性、激活与预算

1. 先按现有 IR 规则过滤可见性和激活；Preset 不能重新加入被排除的片段。在 narrator 模式，private 只是带知情者标注的内容，不能宣称隔离。
2. 有效预算为 context window 减输出预留，再扣历史、Session 内容和所有启用的策略块。这些固定内容不会裁剪；若本身超预算，显式 Preset 返回 `assemble.fixed_over_budget`。
3. 预留全部可见 pinned 候选。全局放不下返回 `assemble.pinned_over_budget`；某个 Creative 区域的 pinned 合计超过区域上限返回 `assemble.preset_region_over_budget`。
4. 剩余候选按 normal、opportunistic 两级选择。显式 Preset 按 layout 顺序，再按区域内 IR 顺序选择；同时满足全局与区域剩余预算才整条纳入，否则整条跳过。
5. 区域上限不是预留份额；Session、历史、策略块只在固定成本计数一次，不重复计入 Creative 区域预算。零 token 的可呈现媒体仍按现有规则处理。

显式 Preset 的全局成本取“各来源文本计数之和”与“最终各消息文本计数之和”中的较大值，纳入拼接分隔符和示例区域标题；固定内容、全部 pinned 和每次加入普通候选后均需满足该预算。最终文本计数高于来源计数的差额记为 `assembly:formatting` Trace entry，使 `total_tokens` 仍等于 included entry 总和。此保守口径不会利用合并时偶然减少的 token 多纳入内容。局部区域上限仅约束片段本身，格式差额计入全局预算。

未指定 Preset 时保留原有逐来源计数以兼容默认布局。两种模式均不计消息协议封装和图片实际计费，消费者需由 Runtime 预留这些成本；`estimated` 表示计数器是否为估算器，不代表远端计费保证。

### 4.3 Trace

Trace 增加可选 `preset: {ref, release, semantic_digest, resolver}`，参考实现选用 Preset 时始终输出。每个策略块一条 `preset:<id>` entry，region 为 `preset:main` 或 `preset:after-history`；禁用块为 skipped/inactive、零预算成本，启用块为 included/always。

每个 Creative 片段仍恰好一条 entry，并保留来源、区域和原因。entry 顺序为 IR 片段、Session 块、history、策略块及可选 `assembly:formatting`；它是审计列表，不是最终消息顺序，消息顺序以 `messages` 为准。

参考实现始终输出 `assembler: {name, version, layout}`，layout 为 `default-v1` 或 `preset-v1`；字段在 schema 中可选以继续读取旧 Trace。

## 5. 策略差异

`diffPresets(from, to)` 比较两个经过结构校验与策略规范化的 ResolvedPreset，独立于 Creative Context Diff。输出包含两侧 ref、Release、semantic digest；按稳定块 ID 列出 added、removed、modified（text、position、enabled），并报告共有块相对顺序是否改变及 version、layout、region_budgets、requires 的变化。

`lock_changes` 显示精确依赖和路径变化，`origin_changes` 显示共有块的来源变化；模块升级但文本相同也有明确记录。两字段在 schema 中可选以兼容旧 Diff，参考实现始终输出。

字段列表和 ID 列表按稳定字符串顺序输出。缺省 enabled 与 true、空 budgets 与缺省等价；单纯新增或删除不当作共有块重排。该 Diff 只表达策略差异，作品的名称、许可、评级等完整元数据不在 ResolvedPreset 内，不能据此宣称完整作品未发生变化。输入身份不是完整性验证的替代，调用方仍应先使用独立解析器。

## 6. 验证与交付范围

协议用例覆盖布局、独立身份、默认行为、区域预算、能力拒绝和摘要不匹配，跨 Node、浏览器和 workerd 执行。新增 fixture 保持 draft；实质测试验证消息和 Trace，不自动接受 expected，不把执行成功等同于人工认可基线。

Registry、Web、CLI、SDK 与 Publish Action 使用同一统一产物契约；交付和验收记录见 [执行记录](proposals/first-class-assets-rollout.md)。CCv3 策略转换必须显式选择，导出不能表达的布局、预算与能力要求进入损失报告。
