# 剧情结构 v1：核心字段收敛稿

> **Superseded（2026-09-30）**：本文是讨论过程记录，现行规则以 [Char Story v1-draft](../../story-v1.md) 与 [DECISIONS](../../../DECISIONS.md) D-162 至 D-174 为准。文中“已确认”的取舍已按统一规范修订，二者冲突时以统一规范为准。

日期：2026-09-26。状态：**讨论稿 / Proposed**，不修改现行 schema 与规范。

本文是[创作体系与系统架构总稿](creative-platform-architecture.md)第 15 节“阶段 3：收敛内容结构”的第一轮产出。输入是总稿第 14.1–14.2 节已确认的方向、第 16 节的易用性目标，以及[案例检验](narrative-model-cases.md)中的 F-1 至 F-35。

本轮按依赖顺序收敛六块：总体约定、参与者扩展、Scene、知情声明、条件语言 v1、开局 `starts`，最后给出投稿的合并单位。Beat、Plotline、Ending 的完整字段在本轮一并定下，因为条件和开局都引用它们；资料分组、Knowledge Source、Style 作用范围、Preset v2 留到下一轮。

每个字段都按同一组属性说明：

| 属性 | 含义 |
|---|---|
| 必填 | 是 / 否 / 条件必填 |
| 层级 | 作者最早在哪一级遇到它（L0–L3，见总稿 16.2） |
| 编辑器入口 | 普通作者在哪里填写 |
| 校验 | 发布前的静态检查 |

所有新字段都计入 `semantic_digest`（F-24），下文不再逐项重复。

## 1. 总体约定

### 1.1 新结构放在 `story` 块中

Scene、Beat、Plotline、Ending、变量、知情声明和开局统一放在 Scenario 的 `story` 块里，而不是散落在 Creation 顶层。案例检验中的示例写在顶层，定稿时按本节调整。

```yaml
type: scenario
cast: [...]            # 现有字段，扩展见第 2 节
story:                 # 新，可选
  version: 1
  vars: {...}
  items: [...]
  events: [...]
  timelines: [...]
  scenes: [...]
  beats: [...]
  plotlines: [...]
  endings: [...]
  knowing: {...}
  starts: [...]
```

这样做的理由：

- **版本化**：`story.version` 同时是条件语言和剧情结构的版本。runtime 遇到不认识的版本必须明确报告不支持（总稿 14.2 的扩展口）。
- **能力声明可以自动得出**：作品有没有 `story`、用了哪些节点，构建时就能算出所需能力，作者不用手写（F-31）。
- **轻量作品不受影响**：L0 角色和不需要剧情结构的 Scenario 完全不出现 `story`。
- **消费视图清楚**：Context IR 继续承载片段内容；`story` 作为同一内容产物中的独立部分传给 runtime，不伪装成片段。这与总稿 12.3 “IR 是一种模型消费视图”的方向一致。

`story` 只允许出现在 `type: scenario` 上。人物、世界、资料集保持可复用定义，不持有剧情安排。

### 1.2 局部 ID 与引用

每类剧情对象有自己的 ID 空间，ID 格式沿用 fragment 段的写法（小写字母、数字、`-`、`_`）：

| 对象 | ID 空间 | 在条件中的写法 |
|---|---|---|
| 参与者 | cast key（现有） | `alice` |
| Scene | `story.scenes[].id` | `scene/lobby` |
| Beat | `story.beats[].id` | `beat/doubt` |
| Ending | `story.endings[].id` | `ending/open` |
| Item | `story.items[].id` | `item/key` |
| Event | `story.events[].id` | `event/guest-left` |
| Timeline | `story.timelines[].id` | —（不在条件中引用） |
| 变量 | `story.vars` 的键 | `var/trust` |
| 片段 | 本作品 fragment ID，或依赖中的 `@ns/name#id` | `#secret-helped`、`@djj/inn-lore#back-door` |

规则：

- 字段本身已经限定了对象类型时直接写 ID，例如 `scene.beats: [doubt]`、`scene.cast: [alice]`。只有条件和效果这类可以引用多种对象的位置才加类型前缀。
- 剧情结构中指代人物一律使用 cast key，不写 Creation 公共标识（F-23）。
- 引用依赖中的片段时，该依赖必须在本作品的解析闭包中；Release 锁定版本后引用随之固定。

### 1.3 description 的必填规则

F-1 要求 description 不普遍必填。本轮的规则是：**给别人（runtime、判定模型、其他作者）判断用的对象必填，只是组织内容的对象选填。**

| 对象 | description | 原因 |
|---|---|---|
| Beat | 必填 | runtime 要据此判断变化是否发生（F-7） |
| Ending | 必填 | 同上，且无条件结局只能靠它被选中（F-8） |
| 变量 | 必填 | 判定模型和作者预览要知道它指什么（F-9） |
| `starts` 中的开局 | 仅在有多个开局时必填 | 玩家据此选择 |
| Scene | 选填，缺省使用 `title` | 场次有标题、地点和开局已足够识别 |
| Plotline | 选填 | 只做组织 |

编辑器可以让 agent 起草必填的 description，作者确认后才写入草稿（总稿 16.2）。

### 1.4 文本字段

`title`、`description`、`part`、`goal` 等给人和模型看的文字使用现有 `LocalizedText`，支持多语言变体。`opening` 这类会进入上下文的文字使用 `TemplateText`，允许 `{{cast:<key>}}` 等纯值替换（D-026 不变）。

## 2. 参与者扩展

在现有 `CastMember { key, who, role? }` 上增加三个字段。`role` 保持原义：它表示由 AI 还是玩家控制，不表示故事身份（F-2）。

```yaml
cast:
  - key: alice
    who: "@djj/alice"
    role: lead
    part: 旅馆老板
    goal: 保护昨夜离开的旅客
  - key: guard-back
    who: "@lin/guard"
    role: support
    part: 后门保安
    override:
      - op: add
        fragment:
          id: back-shift
          kind: character
          content: { type: text, text: "负责后门夜班，曾在河边见过可疑的光。" }
  - key: guest
    who: { late: persona }
    role: user
    part: 被困的住客
```

| 字段 | 必填 | 层级 | 编辑器入口 | 校验 |
|---|---|---|---|---|
| `part` | 否 | L1 | 场次卡片上的参与者列表（F-27） | 无 |
| `goal` | 否 | L1 | 同上，“贯穿全剧的目的” | 无 |
| `override` | 否 | L3 | 参与者详情 → “只在本作品中修改这个角色” | 见下 |

### 2.1 `goal` 与 `scene.goals`

`cast[].goal` 是贯穿整部作品的目的，`scene.goals` 是只在某一场成立的目的。两者同时存在时一起提供给 runtime，不互相覆盖（F-3）。编辑器在场次卡片上把两者并排显示，数据分开存放。

### 2.2 参与者级 `override`

语义与 Reference Edge 上的 Fragment Override 相同（`add` / `replace` / `remove` / `patch`），只作用于这一个参与者实例（F-4）。

- **应用顺序**：被引用 Creation 原文 < Edge override < Scenario override < 参与者 override。同一层对同一 target 有多个 override 时报错，沿用现有规则。
- **改编标记**：对 intrinsic 设定做 `replace` / `remove` 仍需 `force: true`，并在来源中标记 `au: true`（D-027）。
- **限制**：`who` 为 late binding（如玩家 persona）时不允许 `override`，因为发布时不知道对方内容；只能写 `part` 和 `goal`。
- **同一角色担任多个参与者**：每个参与者各自形成一个实例，片段 ID 在实例内唯一。

**兼容影响**：现有 Resolver 以 Release 为单位合并同一角色，Context IR 中的片段没有“属于哪个参与者实例”的标记。引入参与者 override 需要 IR 为片段增加实例归属，这一项放到阶段 6 的兼容方案中处理。没有使用参与者 override 的作品，IR 输出保持不变。

## 3. Scene

```yaml
story:
  scenes:
    - id: lobby
      title: 停电后的大厅
      description: 暴风雪封路的夜里，众人在大厅被追问旅客去向
      time: 深夜，停电后
      where: 旅馆大厅
      cast: [alice, bob, guest]
      opening: "灯灭的一瞬间，前台的铃响了一下。{{cast:bob}} 举起手电……"
      goals:
        bob: 让每个人交代昨夜十一点后的行踪
      beats: [doubt, first-trust]
      lore: ["@djj/inn-lore#back-door"]
      items: [key]
    - id: back-door
      title: 后门与河边小路
      cast: [alice, guest]
      when: { any: [{ reached: beat/doubt }, { has: [var/items, item/key] }] }
      beats: [confession]
```

| 字段 | 必填 | 层级 | 编辑器入口 | 校验 |
|---|---|---|---|---|
| `id` | 是 | L1 | 自动生成，可改 | 在场次中唯一 |
| `title` | 是 | L1 | 场次卡片标题 | 非空 |
| `description` | 否 | L1 | 卡片副标题 | 无 |
| `time` / `where` | 否 | L1 | 卡片上的时间、地点 | 无 |
| `cast` | 否，缺省为全部参与者 | L1 | 卡片上勾选在场人物 | 必须是作品 `cast` 的子集（F-5） |
| `opening` | 否 | L1 | “开场局面” | 模板占位符必须能解析 |
| `goals` | 否 | L1 | 在场人物旁的“本场目的” | 键必须在本场 `cast` 中 |
| `beats` | 否 | L2 | 卡片内的“可能的变化”列表 | 引用存在 |
| `lore` | 否 | L2 | “本场相关资料” | 引用在闭包中 |
| `items` | 否 | L3 | “本场出现的物品” | Item 存在 |
| `events` | 否 | L2 | “本场相关的事件” | Event 存在 |
| `when` | 否 | L3 | “什么时候可以进入”条件构建器 | 条件语言 v1 校验 |

语义：

- **`opening` 不是第一条消息。** 它描述场次开始时的局面，进入上下文；玩家看到的第一条消息来自 `starts` 或现有 `bootstrap`（第 6 节）。
- **`lore` 直接关联**：Engine 跳过相关性判定，但仍做可见性与知情过滤（F-12）。
- **`when` 是可进入条件**，不是自动跳转。条件满足后是否真的进入由 runtime 判断。没有 `when` 的场次随时可以进入。场次可以重复进入（F-6）。
- **不在场的参与者不进入本场上下文**，但仍属于作品，可以在后续场次出场。

**兼容影响**：现有 `visibility: { scope: "scene", scene?: FragmentId }` 中的 `scene` 指向一个 fragment。`story.version: 1` 的作品中，该字段改为指向 `story.scenes[].id`；没有 `story` 的旧作品保持原义。这一项同样放到阶段 6 处理。

## 4. 知情声明

`story.knowing` 以片段为键，每条信息一个声明。以信息为键，是为了让投稿以“一条信息的知情安排”为单位合并（第 8 节）。

```yaml
story:
  knowing:
    "#secret-helped":
      start:
        knows: [alice]
        not: [bob]
      enter:
        river: { knows: [bob] }     # 进入 river 场次时，bob 已经知道
    "@djj/inn-lore#case-1999":
      start:
        knows: "*"                  # 所有参与者都知道
```

| 字段 | 必填 | 层级 | 编辑器入口 | 校验 |
|---|---|---|---|---|
| 键（信息） | 是 | L3 | 在资料或秘密条目上点“谁知道这件事” | 片段在闭包中 |
| `start.knows` / `start.not` | 至少一项 | L3 | 参与者勾选：知道 / 不知道 / 未声明 | cast key 存在；同一人不能同时出现在两边 |
| `enter.<scene>.knows` | 否 | L3 | 场次卡片上的“进入时谁已经知道” | 场次存在；cast key 存在 |

语义：

- **三态**：参与者出现在 `knows` 为知道，出现在 `not` 为不知道，都没出现为未声明（Q3）。`"*"` 表示作品中的全部参与者。
- **受控范围**：只有出现在 `knowing` 中的信息受知情控制；其他片段只按 visibility 处理（F-18）。
- **`enter` 只能增加知情，不能写 `not`。** 进入场次时“让某人忘记”不是合理的创作语义；需要这种效果时应当拆成不同信息。`enter` 在 runtime 进入该场次时生效；如果那时对方已经知道，不产生变化。
- **运行中的变化**由 runtime 维护，初值来自 `start`；条件效果 `learn` 也可以增加知情（第 5 节）。runtime 在本轮会话视图中把当前知情状态交给 Engine（F-22）。

渲染规则：

| 消费模式 | 知道 | 不知道 / 未声明 |
|---|---|---|
| per-agent，为某参与者准备上下文 | 可以看到标题、description 与正文 | 全部不暴露（F-19） |
| narrator | 全部可见，并附上“谁知道、谁不知道”的说明（F-20） | 同左 |

说明的具体写法由 Preset 决定，但不能省略。

冲突检查：片段 `visibility: private` 列出的对象里没有某个声明为“知道”的参与者时，Resolver 给出警告（F-21）。

## 5. 条件语言 v1

本节把总稿 14.2 的“条件语言 v1”写成可实现的规则。条件与效果都是数据树。

### 5.1 变量

```yaml
story:
  vars:
    trust:
      type: int
      init: 0
      min: 0
      max: 100
      description: 玩家与 Alice 之间的信任
    mood:
      type: enum
      values: [calm, tense]
      init: calm
      description: 大厅里的气氛
    items:
      type: set
      of: item
      init: []
      description: 玩家持有的物品
    lights_on:
      type: bool
      init: false
      description: 旅馆是否已恢复供电
```

| 类型 | 必填属性 | 取值 |
|---|---|---|
| `bool` | `init` | true / false |
| `int` | `init`、`min`、`max` | 整数，`min ≤ init ≤ max`，范围在 −2^31 到 2^31−1 |
| `enum` | `values`、`init` | `values` 中的一项 |
| `set` | `of: item` 或 `values`，以及 `init` | `of: item` 时为 `story.items` 中的 Item 子集；否则为 `values` 的子集 |

`values` 中的名称使用与 ID 相同的格式。物品、线索这类有自己含义、会被场次和资料提到的东西，应当声明为 Item（5.6），再用 `of: item` 的集合变量表示“持有哪些”；只是标记状态的名称（如已拜访过的房间编号）可以继续用 `values`。

变量都属于整部作品（总稿确认），没有场次级作用域。

### 5.2 条件节点

条件是下列节点之一，写成只有一个键的对象：

| 节点 | 形式 | 为真的情况 |
|---|---|---|
| `all` | `{ all: [条件, ...] }` | 全部为真；空列表为真 |
| `any` | `{ any: [条件, ...] }` | 至少一个为真；空列表为假 |
| `not` | `{ not: 条件 }` | 子条件为假 |
| `in` | `{ in: scene/<id> }` | 当前正在该场次 |
| `visited` | `{ visited: scene/<id> }` | 曾经进入过该场次（包括当前） |
| `reached` | `{ reached: beat/<id> }` | 该 Beat 已被 runtime 确认达成 |
| `ended` | `{ ended: ending/<id> }` | 已进入该结局 |
| `happened` | `{ happened: event/<id> }` | 背景事件恒为真；计划事件已被 runtime 确认发生 |
| `knows` | `{ knows: { who: <cast key>, info: <片段> } }` | 该参与者当前知道这条信息；“未声明”视为假 |
| `is` | `{ is: [var/<bool 变量>] }` | 布尔变量为真 |
| `cmp` | `{ cmp: [var/<int>, <运算符>, <整数>] }` | 比较成立；运算符为 `=` `!=` `<` `<=` `>` `>=` |
| `eq` | `{ eq: [var/<enum>, <取值>] }` | 枚举变量等于该取值 |
| `has` | `{ has: [var/<set>, <取值 或 item/<id>>] }` | 集合包含该取值；`of: item` 的集合必须写 `item/<id>` |
| `judge` | `{ judge: <LocalizedText> }` | 由 runtime 或判定提供方判断；未判定为假 |

v1 不支持变量之间比较，`cmp` 的右侧只能是整数常量。`fn`、`expr` 两个节点名保留，v1 校验时报错。

校验：

- 引用的场次、Beat、结局、变量、信息、参与者必须存在；
- 节点与变量类型匹配（`cmp` 只用于 int，`eq` 只用于 enum，`has` 只用于 set，`is` 只用于 bool）；
- 常量在变量的取值范围内（`cmp` 的整数不要求在 min/max 内，允许写 `trust > 100` 这类恒假条件，但给出警告）；
- 复杂度：嵌套超过 8 层或单个条件节点超过 64 个时给出警告，提示作者拆分或改用变量；嵌套超过 32 层或节点超过 512 个时报错，这个硬上限只用于防止滥用和保护 runtime。

### 5.3 效果节点

效果是节点列表，按顺序执行：

| 节点 | 形式 | 作用 |
|---|---|---|
| `set` | `{ set: [var/<x>, <值>] }` | 设为指定值；值的类型与变量一致 |
| `add` | `{ add: [var/<int>, <整数>] }` | 加上该整数（可为负），结果截断到 min/max |
| `put` | `{ put: [var/<set>, <取值 或 item/<id>>] }` | 加入集合，已存在则不变 |
| `drop` | `{ drop: [var/<set>, <取值 或 item/<id>>] }` | 移出集合，不存在则不变 |
| `learn` | `{ learn: { who: <cast key 或 "*">, info: <片段> } }` | 该参与者开始知道这条信息 |

效果可以出现在 Beat、Ending 和开局上（第 6 节）。v1 的效果里不能再嵌套条件。

### 5.4 求值约定

- 条件和效果由 runtime 求值；char.pub 只做 5.2、5.3 的静态校验（总稿确认）。
- 同一时刻有多个 Beat 或场次同时达成时，runtime 逐个确认并按确认顺序执行效果；一次确认的效果执行完毕后，才评估下一个。
- 自然语言命题 `judge` 的判定结果写入 Trace，固定判定结果后求值可以重放。
- char.pub 发布一组条件语言 v1 的一致性 fixture：给定变量值、知情状态、进度和 `judge` 结果，给出期望真假与效果执行结果。官方 runtime 和第三方 runtime 都用它验证。

### 5.5 编辑器入口

普通作者不直接写数据树。编辑器提供：

- 默认入口“用一句话描述条件”，生成 `judge`（F-28）；
- 条件构建器，按“进度 / 知情 / 变量”三类列出可选条件，只列出类型匹配的变量和存在的对象；
- 已有 `judge` 可以一键改写为结构化条件，这是一次普通修改。

### 5.6 Item

Item 是作品中有身份、会被提到的物件或线索，例如钥匙、信件、灯。它是 `story` 里的对象，不是独立发布的 Creation。

```yaml
story:
  items:
    - id: key
      title: 后门钥匙
      description: 厨房尽头那扇后门的铜钥匙，平时挂在前台抽屉里
      lore: ["@djj/inn-lore#back-door"]
    - id: letter
      title: 未寄出的信
      description: 旅客留在房间里的信，写给河对岸的某个人
      reveal: on-reach
```

| 字段 | 必填 | 层级 | 编辑器入口 | 校验 |
|---|---|---|---|---|
| `id`、`title` | 是 | L3 | 作品的“物品与线索”列表 | ID 唯一 |
| `description` | 是 | L3 | 同上 | 非空 |
| `lore` | 否 | L3 | “相关资料” | 引用在闭包中 |
| `reveal` | 否，缺省 `hidden` | L3 | “是否在玩家的物品栏中显示” | 同 6.4；`on-reach` 表示获得后显示 |

规则：

- Item 只描述物件本身；谁持有它由 `of: item` 的集合变量表达，可以有多个这样的变量（例如玩家持有的、Alice 持有的）。
- 场次可以用 `items: [key]` 声明“本场出现的物品”，与 `lore` 一样作为直接关联进入上下文。
- Item 的 description 在物品被提到或持有时提供给 runtime 和模型；它有知情含义时（例如信件内容是秘密），秘密本身应写成片段并用 `knowing` 控制，Item 只描述外观与用途。
- Item 不是 Location 或 Character 的替代，也不能在 v1 中跨作品引用。其他种类的对象（地点等）是否也做成 `story` 对象，放到下一轮与资料结构一起评审。

## 6. Beat、Plotline、Ending 与开局

### 6.1 Beat

```yaml
story:
  beats:
    - id: first-trust
      title: 初步信任
      description: Alice 对玩家放下一点戒备，愿意透露一些自己的事
      strength: suggested
      effects: [{ add: [var/trust, 20] }]
    - id: confession
      title: 坦白
      description: Alice 承认昨夜帮旅客从后门离开
      strength: possible
      when: { cmp: [var/trust, ">=", 60] }
      effects: [{ learn: { who: guest, info: "#secret-helped" } }]
      reveal: on-reach
```

| 字段 | 必填 | 层级 | 编辑器入口 | 校验 |
|---|---|---|---|---|
| `id`、`title` | 是 | L2 | 场次卡片内的变化列表 | ID 唯一 |
| `description` | 是 | L2 | 同上 | 非空 |
| `strength` | 否，缺省 `possible` | L2 | “作者希望：建议发生 / 可能发生 / 必须发生” | 三选一 |
| `when` | 否 | L3 | 条件构建器 | 5.2 |
| `effects` | 否 | L3 | “发生后” | 5.3 |
| `reveal` | 否，缺省 `hidden` | L2 | “是否告诉玩家” | 见 6.4 |

`when` 是达成前提；前提满足后，是否真的发生由 runtime 判断，确认后才执行 `effects`（F-7）。

`strength` 的含义：

- `suggested`：作者希望出现，runtime 可以主动引导；
- `possible`：可以出现，不主动引导；
- `required`：作品成立所必需。v1 只做静态检查：必须至少被一个场次引用；如果有 `when`，引用的对象必须存在。runtime 是否以及如何保证它发生，由 runtime 自行决定，并在能力声明中说明。

### 6.2 Plotline

```yaml
story:
  plotlines:
    - id: missing-guest
      title: 追查失踪者
      scenes: [lobby, back-door, river]
    - id: alice-risk
      title: Alice 是否愿意承担风险
      beats: [first-trust, confession]
```

`scenes` 与 `beats` 至少有一项，全部是引用。顺序只表示作者预期的讲述顺序，不约束执行（F-6）。Plotline 是 L2 的组织工具，runtime 可以用它向玩家展示进度，但它不参与条件求值。

### 6.3 Ending

```yaml
story:
  endings:
    - id: escape-together
      title: 一起离开
      description: Alice 带玩家从河边离开，把真相交给 Bob 之外的人
      strength: possible
      priority: 2
      when: { all: [{ reached: beat/confession }, { judge: 玩家承诺替旅客保密 }] }
      reveal: on-reach
    - id: open
      title: 雪停之后
      description: 暴风雪停下，每个人带着各自的秘密离开
      strength: suggested
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `id`、`title`、`description` | 是 | |
| `strength` | 否，缺省 `possible` | 同 Beat |
| `priority` | 否，缺省 0 | 多个结局同时满足时，数值大的优先；同优先级由 runtime 选择并记录 |
| `when` | 否 | 没有 `when` 的结局只作为候选方向，不会被条件求值自动选中（F-8） |
| `effects` | 否 | 进入结局时执行，供续作读取最终状态 |
| `reveal` | 否，缺省 `on-reach` | 见 6.4 |
| `after` | 否，缺省 `stop` | `stop`：结束游玩；`continue`：记录结局后允许继续 |

### 6.4 进度展示 `reveal`

| 取值 | 含义 |
|---|---|
| `hidden` | 不告诉玩家（Beat 缺省） |
| `on-reach` | 达成后告诉玩家（Ending 缺省） |
| `listed` | 开始前就向玩家列出标题，达成后标记；适合“收集全部结局”类作品 |

`listed` 只展示标题，不展示 description 和条件，避免剧透（F-30）。

### 6.5 开局 `starts`

```yaml
story:
  starts:
    - id: guest
      title: 以住客身份
      description: 你是被暴风雪困在旅馆的住客，今晚第一次见到其他人
      scene: lobby
      greeting: "你推开门，一阵冷风卷进大厅。"
    - id: after-confession
      title: 坦白之后
      description: 从 Alice 坦白之后开始，适合已经玩过一遍的玩家
      scene: back-door
      set:
        - { set: [var/trust, 70] }
        - { learn: { who: guest, info: "#secret-helped" } }
      reached: [first-trust, confession]
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | |
| `title`、`description` | 多个开局时必填 | 玩家据此选择 |
| `scene` | 否，缺省为第一个场次 | 起始场次 |
| `greeting` | 否 | 起始消息；缺省使用现有 `bootstrap.greeting` |
| `set` | 否 | 起始效果，语法同 5.3，在变量和知情初值之后执行 |
| `reached` | 否 | 视为已达成的 Beat，不执行它们自身的效果 |

规则：

- 只有一个开局时可以省略 `starts`（F-29）；有 `story` 但没有 `starts` 时，从第一个场次开始，使用 `bootstrap`。
- 开局与现有 `bootstrap.alternate_greetings` 的关系：没有 `story` 的旧作品继续使用 alternate greetings；有 `starts` 时，编辑器把 alternate greetings 显示为各开局的 `greeting`，不再单独维护。迁移方式放到阶段 6。

### 6.6 续作

续作是一部新 Scenario，把前作作为依赖引用，复用其角色与资料（F-33）。续作的 `starts` 可以用 `set` 写出前作某个结局之后的变量与知情状态；这是作者写的静态起点，不读取任何玩家的实际游玩结果。

v1 不支持直接引用前作的 `story` 对象（例如在续作的条件里写前作的 `beat/confession`）；跨作品的剧情对象引用留待后续版本评审。

### 6.7 Event 与 Timeline

用户确认 v1 同时提供 Event 与 Timeline，时间线只表达相对顺序，不做精确日历。它们解决总稿 7.3 提出的问题：事件发生的顺序与讲述、揭示的顺序不同。

#### Event

```yaml
story:
  events:
    - id: old-case
      title: 二十年前的失踪
      description: 一名住客在雨夜从旅馆消失，至今没有下落
      kind: background
      when_text: 二十年前
      cast: []
      lore: ["@djj/inn-lore#case-1999"]
    - id: guest-left
      title: 旅客离开
      description: 昨夜十一点半，Alice 从后门把一名旅客送到河边
      kind: background
      when_text: 昨夜十一点半
      cast: [alice]
      place: "@djj/inn-lore#back-door"
      knowing_ref: "#secret-helped"
    - id: storm-ends
      title: 雪停
      description: 暴风雪停下，道路重新通行
      kind: planned
      when: { visited: scene/river }
      effects: [{ set: [var/road_open, true] }]
```

| 字段 | 必填 | 层级 | 编辑器入口 | 校验 |
|---|---|---|---|---|
| `id`、`title`、`description` | 是 | L2 | 时间线视图中的事件卡片 | ID 唯一 |
| `kind` | 是 | L2 | “已经发生 / 可能会发生” | `background` 或 `planned` |
| `when_text` | 否 | L2 | 卡片上的时间文字 | 无 |
| `cast` | 否 | L2 | 涉及的人物 | cast key 存在；可以包含不在任何场次出场的参与者 |
| `place`、`lore` | 否 | L2 | 地点与相关资料 | 引用在闭包中 |
| `knowing_ref` | 否 | L3 | “这件事的真相写在哪里” | 片段在闭包中 |
| `when`、`effects` | 仅 `planned` | L3 | 条件构建器 | 条件语言 v1 |

规则：

- **`background`**：故事开始前已经发生的事，条件中 `happened` 恒为真。它是作者设定，不是谁都知道的事实：谁知道真相由 `knowing` 控制。`knowing_ref` 指向写着真相的片段，编辑器在事件卡片上显示该片段的知情安排。
- **`planned`**：作者安排可能发生的事。语义同 Beat：`when` 是前提，是否发生由 runtime 确认，确认后执行 `effects`。二者的区别在于 Beat 是人物关系或剧情走向的变化，Event 是世界中发生的事；runtime 可以把 planned Event 当作“环境推进”，不需要玩家行动触发。
- Event 的 `description` 提供给 runtime 与判定模型，不自动进入生成上下文。背景事件需要让模型知道的内容，应当写在片段中并按知情与可见性规则提供；这避免一个事件的描述绕过知情控制。
- 场次可以用 `events: [...]` 声明本场相关的事件，与 `lore` 一样作为直接关联进入 Catalog，但只提供事件关联的片段，不提供 Event 的 description。

#### Timeline

```yaml
story:
  timelines:
    - id: main
      title: 故事时间
      order:
        - old-case
        - guest-left
        - [scene/lobby, scene/back-door]      # 同一时段，并列
        - scene/river
        - storm-ends
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `id`、`title` | 是 | |
| `order` | 是 | 事件与场次的先后；嵌套列表表示同一时段并列 |

规则：

- Timeline 只引用 Event 与 Scene，不复制内容；同一对象可以出现在多条时间线上，例如“故事时间”和“Alice 的经历”。
- 同一条时间线中一个对象只能出现一次；引用必须存在。
- 顺序表示**发生**的先后，与剧情线（预期**讲述**顺序）无关，也不约束执行（F-6）。玩家今晚才得知昨夜的事，就是 `guest-left` 在时间线上早于 `lobby`，而揭示发生在 `back-door` 场次的 Beat `confession` 中。
- 场次的 `time` 与事件的 `when_text` 仍是文字，时间线只负责排序；v1 不做日期计算和时长。
- Timeline 不参与条件求值，也不进入生成上下文；它服务于作者编辑、预览检查（例如“某场次在时间上早于它引用的事件”时提示）和 runtime 的可选展示。

## 7. 所需能力

构建时根据 `story` 自动计算作品所需能力，写入发布产物（F-31）：

| 能力 | 出现条件 |
|---|---|
| `story.v1` | 存在 `story` |
| `story.conditions` | 任一 `when` 或效果中使用了除 `judge` 之外的节点 |
| `story.judge` | 使用了 `judge` |
| `story.knowing` | 存在 `knowing` 或 `learn` |
| `cast.override` | 任一参与者带 `override` |
| `story.events` | 存在 planned Event |

runtime 根据自己支持的能力显示“完整支持 / 降级运行 / 不支持”。降级规则由 runtime 定义并在界面上说明，例如不支持 `story.conditions` 的 runtime 可以把全部条件当作作者提示交给模型。

## 8. 投稿与合并单位

剧情对象加入 Contribution 的对象级三方合并（D-062），新增一种变更：

```ts
| { on: "story"; kind: "scene" | "beat" | "plotline" | "ending" | "start" | "item" | "event" | "timeline" | "var" | "knowing";
    op: "add" | "modify" | "remove"; id: string;
    base_digest?: Digest; after?: JSONValue }
```

| kind | 合并单位的 ID |
|---|---|
| `scene`、`beat`、`plotline`、`ending`、`start`、`item`、`event`、`timeline` | 对象的 `id` |
| `var` | 变量名 |
| `knowing` | 信息引用（例如 `#secret-helped`） |

`cast` 目前不能通过 Contribution 修改；参与者扩展之后，投稿者可能需要“给某个参与者加一个目的”。建议同时新增 `{ on: "cast", op, key, base_digest?, after? }`，以 cast key 为合并单位。

规则：

1. 两人修改同一对象才冲突；一人新增结局、另一人修改场次互不影响。
2. 合并后重新执行全部静态校验。合并结果中出现悬空引用、类型不符时，视为冲突，整个 Contribution 不产出结果（D-130）。
3. 删除被其他对象引用的场次、Beat、变量时，编辑器在投稿前提示所有引用位置。
4. 列表顺序（场次、Beat 的排列）按对象 ID 合并，不做顺序三方合并；顺序变化作为 `story` 块上的单独元数据变更，冲突时由作者手动选择。

## 9. 兼容影响汇总

以下留到阶段 6 编写完整兼容方案，本轮只列出影响：

| 变化 | 影响 | 初步处理 |
|---|---|---|
| 参与者级 `override` | Context IR 片段需要标注属于哪个参与者实例 | 只有使用该能力的作品输出新字段 |
| `visibility.scope = scene` 指向的对象 | 从 fragment 改为 `story.scenes` | 以 `story.version` 区分新旧含义 |
| `starts` 与 `alternate_greetings` | 开局来源有两处 | 旧作品保持不变；有 `starts` 时编辑器合并展示 |
| 新增 `story` 块 | 发布产物新增部分，旧消费者看不到 | 旧 runtime 忽略时按能力声明显示“不支持” |
| Contribution 新增 `story`、`cast` 变更 | 旧客户端无法展示 | 服务端按版本拒绝旧客户端提交此类变更 |

## 10. 本轮取舍（已确认，2026-09-26）

1. **`story` 块**：剧情结构集中放在 Scenario 的 `story` 下，带版本号，并据此自动计算能力声明。
2. **`knowing.enter` 只能增加知情**：不能在进入场次时声明“某人不知道”。
3. **`strength: required` 首版只做静态检查**：是否保证发生由 runtime 决定。
4. **续作不能跨作品引用剧情对象**：只能用 `starts.set` 写出前作结局后的状态。
5. **引入 Item 对象**（用户选择，替代“预先声明取值”的建议）：物品和线索是 `story.items` 中带 description 的对象，集合变量用 `of: item` 引用它们，见 5.6。
6. **条件复杂度以警告为主**（用户选择，替代“8 层 / 64 节点报错”的建议）：超过 8 层或 64 节点警告，超过 32 层或 512 节点报错。

补充（2026-09-27，阶段 5 中确认）：v1 同时提供 Event 与只表达相对顺序的 Timeline，见 6.7。

下一轮收敛：资料分组与 Knowledge Source、信息视角 `perspective`、Style 的作用范围与组合、Preset v2 的模块装配；并评审地点等其他对象是否与 Item 一样做成 `story` 对象。
