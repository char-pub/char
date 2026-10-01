# 消费契约 v1：Context Engine 的输入与输出

> **Superseded（2026-09-30）**：本文是讨论过程记录，现行规则以 [Char Story v1-draft](../../story-v1.md) 与 [DECISIONS](../../../DECISIONS.md) D-162 至 D-174 为准。文中“已确认”的取舍已按统一规范修订，二者冲突时以统一规范为准。

日期：2026-09-26。状态：**讨论稿 / Proposed**，不修改现行 schema 与参考实现。

本文是[创作体系与系统架构总稿](creative-platform-architecture.md)第 15 节“阶段 4：收敛消费契约”的产出。它把总稿第 10 节的五个候选契约写成具体结构，接上阶段 3 的[剧情结构 v1](story-structure-v1.md)和[资料与 Prompt 组织 v1](content-and-prompt-v1.md)，并用雨夜旅馆手工演练一轮上下文准备。

完成标准来自总稿第 15 节：**不写 Runtime 也能手工演练一次上下文准备。**

## 1. 范围与归属

```text
Release 产物 ──► 内容适配 ──► Context Catalog ─┐
                                              ├─► Selector ──► SelectionPlan ─┐
Runtime ──────► 本轮会话视图 (TurnView) ───────┘                               ├─► Assembler ──► Prepared Context ──► Runtime
                                                     Preset / Runtime Profile ─┘
```

| 契约 | 提供者 → 消费者 | 本文章节 |
|---|---|---|
| 发布产物 | char.pub → runtime / Engine | 沿用现有 CreationArtifact，新增 `story`、`groups`、`sources`，见第 2 节 |
| Context Catalog | 内容适配 → Selector | 第 3 节 |
| TurnView（本轮会话视图） | Runtime → Engine | 第 4 节 |
| SelectionPlan | Selector → Assembler | 第 5 节 |
| Prepared Context | Assembler → Runtime | 第 6 节 |

按总稿第 3 节的归属：这些契约的规范由 char.pub 维护，与发布物格式一起版本化；参考实现放在本仓库，供编辑器预览、作者测试和官方 runtime 复用。第三方 runtime 可以换用自己的 Engine 实现，只要输入输出遵守本文。

**分工的核心**：Catalog 和 SelectionPlan 之间是唯一允许非确定性的地方（判定模型）。Catalog 由产物和 TurnView 确定性地算出；SelectionPlan 固定后，Assembler 的输出也是确定的。这使 Trace 可以重放（第 7 节）。

## 2. 发布产物的新增部分

现有内容产物包含 Context IR。v1 在同一产物中并列新增三部分，不塞进 IR 的片段列表：

| 部分 | 来源 | 内容 |
|---|---|---|
| `ir` | 现有 | 片段、依赖实例、参与者、资产；片段新增 `description`、`perspective`、`about`、`source`，以及参与者实例归属（见剧情结构 v1 第 2.2 节） |
| `story` | Scenario 的 `story` 块 | 原样保存，所有引用已解析为完整 ID（`@ns/name#id` 或本作品局部 ID） |
| `catalog_index` | Resolver 计算 | 分组树与 Knowledge Source 目录（不含资料正文，正文在 asset 中） |
| `capabilities` | Resolver 计算 | 所需能力列表（剧情结构 v1 第 7 节、资料与 Prompt v1 第 8 节） |

`catalog_index` 在发布时算好，是为了让每轮构建 Catalog 时不必重新遍历整个依赖闭包。它是纯函数结果，与 `semantic_digest` 一一对应。

## 3. Context Catalog

Catalog 是**某一轮、某个视角**下可供选择的内容目录。它由产物与 TurnView 确定性地算出，每轮都可以不同：换场次、知情变化或换视角都会改变 Catalog。

### 3.1 结构

```ts
interface ContextCatalog {
  view: { mode: "narrator" | "per-agent"; for?: CastKey; scene?: SceneId }
  required: CatalogRef[]          // 必须纳入的内容，不交给 Selector
  direct: CatalogRef[]            // 作者直接关联的内容，跳过相关性判定
  candidates: CatalogNode[]       // 可供 Selector 选择的目录树
  withheld: WithheldCount         // 因可见性 / 知情被过滤掉的数量，只计数，不列出内容
}

interface CatalogNode {
  ref: CatalogRef
  kind: "work" | "group" | "fragment" | "source" | "section"
  title: string
  description?: string           // 缺省规则见资料与 Prompt v1 第 1 节
  perspective?: Perspective
  about?: string[]
  children?: CatalogNode[]       // 可继续展开的子项；未展开时只给数量
  child_count?: number
  est_tokens: number             // 正文的 token 估算；目录阶段不代表最终成本
  importance: "normal" | "opportunistic"
  activation_hint?: "keyword" | "semantic"   // 片段原来的激活方式，供 Selector 参考
}

type CatalogRef =
  | { fragment: string }          // 完整片段 ID，含实例归属
  | { group: string }
  | { source: string; section?: string }
```

### 3.2 三个集合的分配规则

对产物中的每一段内容，按下面的顺序判断，第一条命中的决定它的去向：

| 顺序 | 条件 | 去向 |
|---|---|---|
| 1 | visibility 对当前视角不可见，或知情声明使当前参与者不应看到（per-agent） | 过滤，计入 `withheld` |
| 2 | 场次限定（`visibility.scope = scene`）且不是当前场次 | 过滤，不计数 |
| 3 | 不在场的参与者的人物设定 | 过滤，不计数 |
| 4 | `importance: pinned`，或 `activation: always` | `required` |
| 5 | 当前场次的 `opening`、`place`；在场参与者的 `part`；当前生效的 Style 核心说明；per-agent 模式下当前参与者本人的 `goal` 与 `scene.goals`，narrator 模式下全部参与者的目的 | `required` |
| 6 | 当前场次 `lore`、`items` 关联的内容 | `direct` |
| 7 | 当前场次 `beats` 中尚未达成的 Beat 及候选结局的 description（runtime 请求时） | `direct` |
| 8 | `activation: keyword` 且本轮命中 | `direct` |
| 9 | `activation: manual` 或 `semantic` 且 TurnView 的 `enabled` 中列出 | `direct` |
| 10 | 其余 `keyword`、`semantic` 片段，分组、资料、分节 | `candidates` |
| 11 | 其余 `manual` 片段 | 不进入 Catalog（只能显式启用） |

说明：

- **规则 1 最先执行**，所以 `required` 与 `direct` 中的内容也要先通过可见性与知情过滤（F-12）。例外是 narrator 模式：按 D-053，visibility 只是提示，内容保留，但附上知情说明（F-20）。
- **`withheld` 只计数**，帮助作者预览时发现“这个角色看不到 3 条资料”，不透露具体内容。
- **pinned 的旧语义不变**：它在过滤之后无条件进入 `required`（总稿 12.3 第 5 条）。
- **keyword 命中进入 `direct`**：关键词是作者写的确定规则，不需要再让模型判断，保持与现有 Assembler 行为一致。
- **分组的可见性**：分组下的全部条目都被过滤后，分组本身也不出现（资料与 Prompt v1 第 2 节）。
- **参考资料**：per-agent 模式下，只有标为 `visibility: shared` 的资料进入 Catalog（第二轮取舍 5）。
- **他人的目的**（P-1）：per-agent 模式下，为参与者 A 准备上下文时，其他参与者的 `goal` 和 `scene.goals` 不进入 Catalog，也不计入 `withheld`。作者需要让别人知道某个目的时，写成条目并用 `knowing` 控制。
- **他人的设定**（P-3）：per-agent 模式下，为参与者 A 准备上下文时，其他参与者的人物片段只有标记为 `outward: true` 的才进入 Catalog，按原有激活方式分配；其余不进入，不计入 `withheld`。A 本人与 narrator 模式不受影响，见第 3.4 节。

### 3.3 展开

`candidates` 默认只展开到作品与第一层分组，其余以 `child_count` 表示。Selector 需要看更深一层时，向适配层请求展开某个节点；展开结果仍是 CatalogNode，仍然经过同样的过滤。展开次数和总目录成本受 Preset `selection.catalog_budget` 与 `max_depth` 约束。

小作品可以一次性全部展开：总目录估算低于 `catalog_budget` 时，适配层直接给出完整树。

规则 9 与规则 11 保持现有 `manual` 的含义：只在用户或 runtime 显式启用时加入，不交给模型判断。未命中的 `keyword` 片段进入 `candidates`，是 v1 的新行为：有 description 时，判定模型可以在关键词没有命中时仍然选中它。不希望这样的作者可以不写 description，没有 description 的节点不出现在交给判定模型的目录中（资料与 Prompt v1 第 1 节）。

### 3.4 `outward`：外在描述

`outward` 是片段上的新属性，表示“别人能观察到的部分”：外貌、公开身份、举止、别人都知道的经历。

```yaml
fragments:
  - id: appearance
    kind: character
    outward: true
    content: { type: text, text: "三十出头，总穿着深色毛衣，说话前习惯先笑一下。" }
  - id: core
    kind: character
    content: { type: text, text: "Alice 谨慎、有同情心，内心对二十年前的旧案一直有愧……" }
```

| 属性 | 必填 | 层级 | 编辑器入口 | 校验 |
|---|---|---|---|---|
| `outward` | 否，缺省 false | L2 | 人物片段卡片上的“别人看得到” | 只允许出现在 `character`、`persona`、`examples` 片段上 |

规则：

- 只在 per-agent 模式为**其他**参与者准备上下文时生效。本人、旁白、narrator 模式照常提供全部设定。
- 玩家的 persona 也适用：为 Alice 准备上下文时，只提供玩家 persona 中标 `outward` 的片段。
- 没有任何 `outward` 片段的参与者，其他人只看到 `part` 和 `display_name`。编辑器在作品启用 per-agent 时提示“其他角色看不到这个人物的任何描述”，并建议把外貌等拆成单独片段。
- Level 0 Character 只有一段 `character` 片段，默认不是 `outward`。导入 CCv3 时不自动标记，避免把内心设定当作外在描述。
- 参与者级 `override` 可以用 `patch` 修改 `outward`，让同一角色在不同作品中暴露不同内容。

**兼容影响**：现行参考 Assembler 在 per-agent 模式下把所有在场人物设定都放进 `system:character`。引入本规则后，旧作品在 per-agent 模式下的输出会变少。处理方式放到阶段 6：以产物能力或 Preset 版本区分，旧 Preset `"0-draft"` 保持现行行为。

## 4. TurnView：本轮会话视图

TurnView 是 runtime 交给 Engine 的本轮状态。它扩展现有 `Session`，现有字段保持原义。

```ts
interface TurnView {
  // 现有 Session 字段
  locale?: string
  bindings: Record<string, LateBindingValue>
  history: HistoryMessage[]
  enabled?: string[]                  // 即现有 manual_enabled
  overlay?: SessionOverlay            // memory / state / active_variants
  for_participant?: CastKey           // per-agent 模式下为谁准备
  scene?: SceneId                     // story.version 1 时指向 story.scenes

  // 新增：story 运行状态（仅作品有 story 时）
  story?: {
    start: StartId                    // 本次游玩使用的开局
    visited: SceneId[]                // 含当前场次
    reached: BeatId[]
    ended: EndingId[]
    vars: Record<VarName, boolean | number | string | string[]>
    knowing: Record<InfoRef, { knows: CastKey[] }>   // 当前知情状态的完整快照
  }

  // 新增：判定所需的上下文
  focus?: string                      // runtime 提供的本轮关注点摘要，可选
  judgments?: JudgmentRecord[]        // 本轮已经做出的 judge 判定，用于重放
}
```

规则：

- **`story` 是快照，不是增量。** 总稿 F-22 说的是“知情变化需要传给 Engine”；用完整快照比增量更简单，也更不容易出错。runtime 自己保存历史与增量，Engine 每轮只看当前状态。
- **`knowing` 只列出受知情控制的信息**，即出现在作品 `story.knowing` 中或被 `learn` 效果改变过的信息。未列出的参与者按“不知道”渲染，与 story v1 第 4 节一致。
- **变量值必须合法**：类型与声明一致，int 在 min/max 内，set 元素属于声明的取值或 Item。Engine 发现非法值时报错，不自行修正。
- **`focus` 是可选的提示**，例如“玩家在问河边有没有别的出口”。没有时 Selector 使用最近的历史消息。它只影响选材，不进入最终消息。
- **Engine 不改写 TurnView。** 条件求值、Beat 确认、效果执行都由 runtime 完成，结果写进下一轮的 TurnView（总稿第 11 节）。

## 5. SelectionPlan

SelectionPlan 是 Selector 的输出。Selector 可以是规则、判定模型（如 Jev）或两者组合；参考实现提供一个不调用模型的 Selector（第 5.3 节）。

### 5.1 结构

```ts
interface SelectionPlan {
  input: {
    artifact: { root: string; lock_digest: Digest }
    catalog_digest: Digest            // 本轮 Catalog 的内容摘要
    turn_digest: Digest               // 本轮 TurnView 的摘要
    policy?: { release: ReleaseId; semantic_digest: Digest }   // 使用的 Preset
  }
  selector: { name: string; version: string; config_digest?: Digest }
  selected: Selection[]
  decisions: Decision[]
  fallback?: "skip"                   // 若发生回退则记录
}

interface Selection {
  ref: CatalogRef                     // 必须出现在本轮 Catalog 的 candidates 中
  form: "body" | "section"            // v1 只支持完整正文或资料的一节
  rank: number                        // 选择优先级；不等于最终消息位置
}

interface Decision {
  ref: CatalogRef
  action: "expand" | "select" | "reject"
  score?: number                      // 提供方给出的分值，量纲由 selector 定义
  confidence?: number
  note?: string                       // 简短理由，供作者预览
}
```

### 5.2 校验

Assembler 接收 SelectionPlan 前必须校验，任何一条不满足都拒绝整个 Plan：

1. `input.catalog_digest` 与本轮 Catalog 一致；
2. 每个 `selected[].ref` 都在本轮 Catalog 的 `candidates` 中（含已展开节点），不能选中 `withheld`、不存在或越界的内容（总稿 context-engine 草案第 5 节）；
3. `required` 与 `direct` 不需要也不允许出现在 `selected` 中，它们总是纳入；
4. `form: section` 只能用于 `source` 节点，且分节存在。

v1 不支持作者提供的“简版正文”（总稿 8.1 的合法简版）；`form` 预留扩展。

### 5.3 参考 Selector

参考实现提供两个不调用模型的 Selector，用于编辑器预览、作者测试和降级：

| 名称 | 行为 |
|---|---|
| `none` | 不从 `candidates` 选任何内容；与选材回退 `skip` 的结果相同 |
| `fixed` | 按作者或测试给定的 ref 列表选择；用于 fixture 与手工演练 |

选材回退 v1 只有 `skip`（P-4）：关键词命中的片段已经在 `direct` 中，另设 `keyword` 回退没有额外效果。

### 5.4 判定提供方的接入

使用判定模型的 Selector（如基于 Jev）由 runtime 或第三方提供，不属于参考实现。它们的输入只能是本轮 Catalog 与 TurnView 中允许的部分：

- per-agent 模式下，不能把旁白视角的 Catalog 交给判定模型再过滤；Catalog 本身就是按视角算出的；
- 判定模型的输出必须转换为 SelectionPlan 并通过第 5.2 节校验；
- 故事中的 `judge` 命题判定与选材判定是两件事：前者由 runtime 做，结果写进 TurnView 的 `judgments`；后者由 Selector 做，结果写进 SelectionPlan。

## 6. Prepared Context

Assembler 的输入与现有 D-051 一致，另加 Catalog 与 SelectionPlan：

```text
Assembler Input = 产物 + Resolved Preset? + Runtime Profile + TurnView + Catalog + SelectionPlan
```

输出沿用现有的 messages 与 AssemblyTrace，扩展 Trace：

```ts
interface PreparedContext {
  messages: ModelMessage[]
  trace: AssemblyTrace & {
    selection?: { plan_digest: Digest; selector: { name: string; version: string } }
    story?: { scene?: SceneId; start: StartId }
  }
}
```

Trace 条目的 `reason` 新增：

| reason | 含义 |
|---|---|
| `required` | 来自 Catalog 的 `required`（规则 4 中已有 `always`、`pinned` 的沿用原值） |
| `scene` | 当前场次的开局、目的、地点 |
| `direct` | 场次 `lore` / `items` 的直接关联 |
| `selected` | SelectionPlan 选中 |
| `withheld` | 因可见性或知情过滤（只在作者预览的 Trace 中列出具体条目，发给第三方的 Trace 只计数） |
| `fallback` | Selector 不可用，按 `skip` 回退后未纳入 |

预算规则沿用现有 Assembler：`required` 必须全部放下，放不下时报错（与现有 `assemble.pinned_over_budget` 相同）；`direct` 与 `selected` 按 `normal → opportunistic`、再按 `rank` 整条纳入或跳过。渲染时按资料与 Prompt v1 的规则附加视角标注与知情说明。

## 7. 重放与确定性

固定以下输入后，Prepared Context 必须完全相同：

- 产物（`lock_digest`）、Preset（Release 与 digest）、Runtime Profile、tokenizer；
- TurnView（`turn_digest`）；
- SelectionPlan。

Catalog 由产物和 TurnView 算出，不需要单独固定；SelectionPlan 中的 `catalog_digest` 用于检查两边一致。

重放**不需要**重新调用判定模型，也不保证生成模型给出相同回答（总稿第 10 节）。`judge` 命题的判定结果在 TurnView 的 `judgments` 中，因此条件求值同样可以重放。

## 8. 手工演练：雨夜旅馆的一轮

用前面各稿中的雨夜旅馆，不调用任何模型，手工走一遍。

### 8.1 输入

作品：`@djj/rainy-inn`，引用 `@djj/alice`、`@djj/bob`、`@djj/inn-lore`（含分组“建筑 / 历史 / 旧案 / 传闻”）、`@djj/port-city`（含手册 `handbook`，分节 `inn`、`river`）、Style `restrained-noir`（旁白）与 `wry-voice`（Alice）。

TurnView：

```yaml
for_participant: bob            # per-agent，为 Bob 准备上下文
scene: lobby
story:
  start: guest
  visited: [lobby]
  reached: [doubt]
  ended: []
  vars: { trust: 20, items: [] }
  knowing:
    "#secret-helped": { knows: [alice] }
history:
  - { role: user, text: "河边那条路，晚上还能走吗？" }
focus: 玩家在问河边小路能否通行
```

### 8.2 构建 Catalog（第 3.2 节规则）

| 内容 | 命中规则 | 去向 |
|---|---|---|
| `#secret-helped`（Alice 帮旅客离开） | 1：知情声明中 Bob 不知道 | `withheld` |
| Bob 的 `core` | 4：always | `required` |
| `wry-voice`（Alice 的口吻） | 5：参与者范围 Style；per-agent 下只给 Alice | 过滤（不是 Bob 的视角） |
| `restrained-noir` 核心说明 | 5：旁白 Style | `required` |
| lobby 的 `opening`、`goals.bob`、`place: #lobby` | 5 | `required` |
| 参与者 `part`（alice、bob、guest） | 5 | `required` |
| Bob 本人的 `goal`；Alice 的 `goal` | 5；P-1 | Bob 的进入 `required`；Alice 的不进入 |
| Alice 的 `appearance`（`outward`）；Alice 的 `core`、`voice` | 3.4 | `appearance` 进入 `required`；`core`、`voice` 不进入 |
| `@djj/inn-lore#back-door` | 6：lobby 的 `lore` | `direct` |
| Item `key` | 6：lobby 的 `items` | `direct` |
| Beat `first-trust` 的 description | 7：本场未达成的 Beat | `direct` |
| `#haunted-door`（传闻，keyword: 后门） | 8：本轮消息没有“后门” | 进入 10 → `candidates` |
| 分组“建筑”“历史”，条目 `cellar`、`case-1999` | 10 | `candidates` |
| 手册 `handbook` | per-agent 且未标 `visibility: shared` | 过滤，计入 `withheld` |

`withheld` 共 2 项。

**演练中发现的问题 1**（已按 P-1 解决）：Alice 的作品级 `goal`“保护昨夜离开的旅客”本身就透露了秘密。初稿规则会把它交给 Bob；现在他人的目的不进入 per-agent 视角。

**演练中发现的问题 2**：Bob 的视角看不到手册，但玩家问的正是“河边那条路”，手册 `river` 一节最相关。这是第二轮取舍 5（资料默认只给旁白）的直接后果：在 per-agent 模式下，公开的世界资料也要作者逐个标为 shared。

### 8.3 选择

使用 `fixed` Selector 模拟判定结果：

```yaml
selector: { name: fixed, version: "1" }
decisions:
  - { ref: { group: "@djj/inn-lore#building" }, action: expand }
  - { ref: { fragment: "@djj/inn-lore#cellar" }, action: reject, note: 与河边无关 }
  - { ref: { fragment: "@djj/inn-lore#haunted-door" }, action: select, note: 涉及后门与河边 }
selected:
  - { ref: { fragment: "@djj/inn-lore#haunted-door" }, form: body, rank: 1 }
```

校验通过：`haunted-door` 在 `candidates` 中；没有选中 `withheld` 或 `required` 的内容。

### 8.4 组装

按 Preset `"1-draft"` 的 layout：

| 区域 | 内容 | reason |
|---|---|---|
| `system:character` | Bob `core`；Alice `appearance`（外在描述） | `always` |
| `system:story` | 三位参与者的 `part`；Bob 自己的 `goal` | `required` |
| `system:scene` | lobby 的时间、地点、开场局面、`goals.bob`、`#lobby` 条目、物品 `key` | `scene` / `direct` |
| `system:knowledge` | `back-door`；`haunted-door`（渲染为“传闻：老住客说，雨夜后门会自己打开。”） | `direct` / `selected` |
| `system:style` | `restrained-noir` 核心说明 | `required` |
| `system:instruction` | Preset 块、`leave-room/core` | — |
| `history` | 本轮消息 | — |
| `after-history` | `leave-room/core` 的 `reminder` 装配 | — |

Trace 中 `#secret-helped` 与 `handbook` 记为 `withheld`；`cellar` 记为 `skipped`，理由来自 Decision。

**演练中发现的问题 3**（已按 P-3 解决）：初稿会把 Alice 的完整 `core` 与 `voice` 交给 Bob，其中可能写着她的内心想法。现在只提供标为 `outward` 的 `appearance`。

### 8.5 重放

保存 `lock_digest`、Preset digest、Profile、TurnView 与 SelectionPlan 后重新组装，得到的消息与 Trace 相同，不需要再次判定。满足第 7 节。

## 9. 演练发现与建议

| 编号 | 问题 | 建议 |
|---|---|---|
| P-1 | 参与者的 `goal`、`scene.goals` 可能泄露秘密 | per-agent 模式下，`goal` 与 `scene.goals` 默认只给该参与者自己；其他参与者只看到 `part`。需要让别人也知道目的时，作者写成普通条目并用 `knowing` 控制 |
| P-2 | 公开世界资料在 per-agent 模式下默认不可见，作者需要逐个标 shared | 维持第二轮取舍（泄密的代价更高），但编辑器在作品启用 per-agent 时提示“这些资料对角色不可见”，并提供一键标为 shared |
| P-3 | per-agent 模式下，其他人物的完整设定是否给当前角色 | 新增规则：为参与者 A 准备上下文时，其他参与者只提供 `part` 与标记为外在描述的片段（新增片段属性 `outward: true`，或约定 `kind: character` 的某个子段）；完整设定只给其本人与旁白。这是新增语义，需要确认 |
| P-4 | `on_unavailable: keyword` 与 `skip` 在 v1 效果相同 | v1 只保留 `skip`，修正资料与 Prompt v1 第 7.3 节 |
| P-5 | 未命中的 keyword 片段现在可能被判定模型选中 | 这是 v1 的新行为，作者不写 description 即可退出；在兼容方案中说明 |

## 10. 本轮取舍（已确认，2026-09-26）

1. **Catalog 分为 `required`、`direct`、`candidates` 三个集合**，按第 3.2 节的顺序分配；过滤最先执行。
2. **TurnView 中的 story 状态是完整快照**，不是增量。
3. **SelectionPlan 只能选 `candidates` 中的内容**，v1 只支持完整正文与资料分节。
4. **参考实现只提供 `none` 与 `fixed` 两个 Selector**，判定模型的 Selector 由 runtime 提供。
5. **P-1**：per-agent 模式下，目的只给本人；需要别人知道时写成条目并用 `knowing` 控制。
6. **P-3**：per-agent 模式下，其他人物只提供 `part` 与标记 `outward: true` 的片段（第 3.4 节）。
7. **P-4**：选材回退只保留 `skip`。
