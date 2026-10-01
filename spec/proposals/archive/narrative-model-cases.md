# 创作模型案例检验

> **Superseded（2026-09-30）**：本文是讨论过程记录，现行规则以 [Char Story v1-draft](../../story-v1.md) 与 [DECISIONS](../../../DECISIONS.md) D-162 至 D-174 为准。文中“已确认”的取舍已按统一规范修订，二者冲突时以统一规范为准。

日期：2026-09-26。状态：**讨论稿 / Proposed**。

本文是[创作体系与系统架构总稿](creative-platform-architecture.md)第 15 节“阶段 2：用具体作品检验模型”的产出。它用七个案例逐一写出完整的静态作品，检查总稿第 14.1–14.2 节已确认的方向能否自然表达这些作品，并记录由此暴露的问题。

示例使用现行 Canonical Model 的 YAML 写法；标注 `# 新` 的是候选字段，名称和形状都未定稿，不是可用的导入格式。每个案例按同一标准检查：

- 每个对象能指出所属层次（可复用定义 / 本作品安排 / 运行实例）和持有者；
- 引用明确，没有靠标题或文本猜测的关联；
- 同一正文只在一处编辑；
- 作者没有被迫填写与该作品无关的字段；
- Runtime 能从定义中得到明确输入。

发现的问题标为 **F-n**，在文末汇总，作为阶段 3 收敛内容结构的输入。

## 案例 1：轻量角色

**作品**：作者发布一个角色“Mika”，只有名字、介绍、说话方式、开场白和头像。没有剧情、没有资料集。

```yaml
type: character
ref: "@lin/mika"
display_name: Mika
summary: 深夜便利店的店员，嘴硬心软。
fragments:
  - id: core
    kind: character
    content: { type: text, text: "Mika，二十出头，在深夜便利店打工……" }
  - id: voice
    kind: examples
    content: { type: dialogue, lines: [...] }
bootstrap:
  greeting: "又是你？今天买什么。"
assets:
  - slot: avatar
```

| 对象 | 层次 | 是否新增 |
|---|---|---|
| Character `@lin/mika` | 可复用定义 | 现有 |
| 两个 Fragment、greeting、头像 | 可复用定义 | 现有 |

**检查结果**：不需要任何新字段。Scene、Beat、条件、知情、description 都不出现。

**F-1**：description 必须是可选的。`always` 激活的片段本来就会进入上下文，不需要目录入口；只有按需取用的片段和分组才值得写 description。编辑器可以在作者给 semantic 或 keyword 片段时提示补写，但发布校验不应要求。

## 案例 2：多角色开放情境

**作品**：“午夜电台”。三位已发布的角色在同一间直播间：主持人 Rei、嘉宾 Sora、调音师 Ken，玩家作为打进热线的听众。没有预设剧情，每个人各有目的。其中“保安”由同一个角色 `@lin/guard` 扮演两次（前门和后门各一个）。

```yaml
type: scenario
ref: "@lin/midnight-radio"
cast:
  - key: rei
    who: "@lin/rei"
    role: lead
    part: 电台主持人，节目今晚是最后一期        # 新：本作品中的身份
  - key: sora
    who: "@lin/sora"
    role: support
    part: 受邀嘉宾，想借节目澄清一段传闻
  - key: ken
    who: "@lin/ken"
    role: support
    part: 调音师，知道节目停播的真正原因
  - key: guard-front
    who: "@lin/guard"
    role: support
    part: 前门保安
  - key: guard-back
    who: "@lin/guard"
    role: support
    part: 后门保安
  - key: caller
    who: { late: persona }
    role: user
scenes:                                         # 新
  - id: live
    description: 最后一期直播，热线接通之后
    where: 直播间，凌晨一点
    cast: [rei, sora, ken, caller]
    opening: "距离节目结束还有五十分钟……"
    goals:
      rei: 体面地做完最后一期
      sora: 借热线把传闻说清楚
      ken: 不让停播原因在直播中泄露
```

| 对象 | 层次 | 是否新增 |
|---|---|---|
| 四位 Character | 可复用定义 | 现有 |
| `cast[].part` | 本作品安排 | 新 |
| Scene `live` 及 `goals` | 本作品安排 | 新（Q1） |
| 本次直播里谁说了什么 | 运行实例 | Runtime |

**检查结果**：开放情境只需要一个 Scene，不写 Beat、分支、结局或条件，满足“开放情境无需写任何条件”。

**F-2**：`cast[].role`（lead / support / user）与“本作品中的身份”不是一回事。前者是 AI 与玩家的控制分工，后者是故事里的角色身份。建议保留 `role` 原义，新增 `part` 表达故事身份，避免改旧字段含义。

**F-3**：目的有两个层次。“ken 不想让停播原因泄露”贯穿整部作品，“本场体面做完”只在这一场成立。建议 `cast[].goal` 表达作品级目的，`scene.goals` 表达本场目的，二者都以 cast key 为索引；同时存在时一起提供给 Runtime，不互相覆盖。

**F-4**：同一 Character 担任两个参与者时，现有 Override 挂在 Reference Edge 上，而 `cast` 与 `references` 是两个列表，“给前门保安追加一段设定”没有明确的写法。建议让 Cast Member 可以带自己的 `override`（语义与 Edge Override 相同，只作用于该参与者），或者要求 Cast Member 显式指向一条 Edge。前者对作者更直接。

**F-5**：`scene.cast` 必须是作品 `cast` 的子集，由 Resolver 校验；不在场的参与者（两位保安）不进入本场上下文，但可以在后续场次出现。

## 案例 3：带重要转折的故事

**作品**：“雨夜旅馆”。Alice 是旅馆老板，Bob 是调查员，玩家以自己的身份入住。主线“追查失踪者”，人物线“Alice 是否愿意承担风险”。三个场次、若干 Beat、三个候选结局，使用条件语言 v1。

```yaml
type: scenario
ref: "@djj/rainy-inn"
cast:
  - { key: alice, who: "@djj/alice", role: lead, part: 旅馆老板, goal: 保护昨夜离开的旅客 }
  - { key: bob, who: "@djj/bob", role: support, part: 调查员, goal: 查清旅客去向 }
  - { key: guest, who: { late: persona }, role: user, part: 被困的住客 }

vars:                                            # 新（条件语言 v1）
  trust: { type: int, init: 0, min: 0, max: 100, description: 玩家与 Alice 之间的信任 }
  items: { type: set, of: item, init: [] }

scenes:
  - id: lobby
    description: 停电后的大厅盘问
    where: 大厅，暴风雪封路的夜里
    cast: [alice, bob, guest]
    opening: "灯灭的一瞬间，前台的铃响了一下……"
    goals:
      bob: 让每个人交代昨夜十一点后的行踪
    beats: [doubt, first-trust]
  - id: back-door
    description: 旅馆后门与河边小路
    cast: [alice, guest]
    when: { any: [{ reached: beat/doubt }, { has: [var/items, item/key] }] }
    beats: [confession]
  - id: river
    description: 河边小路的尽头
    cast: [alice, bob, guest]
    when: { visited: scene/back-door }

beats:
  - id: doubt
    strength: possible
    description: 玩家开始怀疑 Alice 的证词
  - id: first-trust
    strength: suggested
    description: Alice 对玩家放下一点戒备
    effects: [{ add: [var/trust, 20] }]
  - id: confession
    strength: possible
    description: Alice 承认帮旅客离开
    when: { cmp: [var/trust, ">=", 60] }

plotlines:
  - id: missing-guest
    description: 追查失踪者
    scenes: [lobby, back-door, river]
  - id: alice-risk
    description: Alice 是否愿意承担风险
    beats: [first-trust, confession]

endings:
  - id: escape-together
    strength: possible
    priority: 2
    description: Alice 带玩家从河边离开，把真相交给 Bob 之外的人
    when: { all: [{ reached: beat/confession }, { judge: 玩家承诺替旅客保密 }] }
  - id: truth-out
    strength: possible
    priority: 1
    description: 真相在大厅里公开
    when: { all: [{ reached: beat/doubt }, { not: { reached: beat/confession } }, { visited: scene/river }] }
  - id: open
    strength: suggested
    priority: 0
    description: 暴风雪停下，每个人带着各自的秘密离开
```

| 对象 | 层次 | 是否新增 |
|---|---|---|
| `vars`、`scenes`、`beats`、`plotlines`、`endings` | 本作品安排 | 新 |
| 当前变量值、已达成的 Beat、所在场次 | 运行实例 | Runtime |

**检查结果**：同一个 Beat（`first-trust`）被场次和人物线引用，没有复制正文；场次同时属于主线，人物线只引用 Beat，两种组织方式可以共存。没有预写任何台词。

**F-6**：“进入场次”不需要单独的转移边。`scene.when` 表达“什么时候可以进入”，剧情线的 `scenes` 顺序只是作者预期的讲述顺序，不是强制执行顺序。场次可以重新进入，`visited` 用于表达“去过”。这与总稿“叙事组织可以有环”的立场一致。

**F-7**：Beat 什么时候算“达成”需要明确。Beat 自身的 `when` 只是达成的前提；前提满足后，是否真的发生仍由 Runtime 判断（通常结合模型判定），确认之后才执行 `effects`。Beat 的 description 就是给 Runtime 和判定模型看的“这个变化是什么”，因此对 Beat 而言 description 实际上必填。

**F-8**：没有 `when` 的结局（`open`）表示“随时可以收束到这里”。建议约定：没有 `when` 的结构只作为候选方向提供给 Runtime，不会被条件求值自动选中；有 `when` 的按 priority 排序。

**F-9**：变量也需要 description。Runtime 执行效果时不需要它，但判定模型和作者预览需要知道 `trust` 指什么；变量名本身不足以说明含义。

## 案例 4：长资料与世界书共存

**作品**：World“港城”附带一份很长的《港城建筑与历史》手册（Markdown，约三万字），以及作者整理的 Lorebook“旅馆资料集”，其中分组“建筑”“旧案”“传闻”。雨夜旅馆引用它们，并在场次中直接关联部分条目。

```yaml
type: world
ref: "@djj/port-city"
fragments:
  - id: core
    kind: world
    content: { type: text, text: "港城是一座靠河运兴起的城市……" }
sources:                                          # 新：Knowledge Source
  - id: handbook
    title: 港城建筑与历史
    description: 城中主要建筑的年代、结构与相关旧事，适合回答“某处怎么走、以前发生过什么”
    asset: handbook-md
    sections:                                     # 可选的目录层级
      - { id: inn, title: 河畔旅馆, description: 旅馆的平面、改建和地下通道 }
      - { id: river, title: 河道与码头, description: 河道走向、渡口和夜间航运 }
assets:
  - slot: handbook-md
```

```yaml
type: lorebook
ref: "@djj/inn-lore"
description: 河畔旅馆的建筑细节、二十年前的旧案和住客间流传的说法    # 新：集合级
groups:                                           # 新
  - id: building
    description: 旅馆的结构和出入口
    entries: [back-door, cellar]
  - id: old-case
    description: 二十年前的失踪旧案
    entries: [case-1999]
  - id: rumor
    description: 住客和居民之间的传闻
    entries: [haunted-door]
fragments:
  - id: back-door
    kind: knowledge
    description: 后门的位置、通往哪里                # 新：片段级
    content: { type: text, text: "旅馆后门在厨房尽头，通往河边小路……" }
    activation: { mode: semantic }
    source: { use: "@djj/port-city", section: handbook/inn }   # 新：出处
  - id: haunted-door
    kind: knowledge
    description: 关于后门闹鬼的说法
    perspective: rumor                            # 新：信息视角
    content: { type: text, text: "老住客说，雨夜后门会自己打开。" }
    activation: { mode: semantic }
```

在雨夜旅馆的场次中：

```yaml
scenes:
  - id: back-door
    lore: ["@djj/inn-lore#back-door"]              # 直接关联，不经目录筛选
```

**检查结果**：Knowledge Source 不需要先转成 Lorebook；条目用 `source` 指回手册章节，正文只在条目里写一次。Engine 可以按“资料集 description → 分组 description → 条目 description → 正文”逐层展开，也可以从手册目录直接取某一节。

**F-10**：分组需要显式对象。只靠片段 ID 前缀（`lore/building/*`）没有地方放分组的 description，也无法让一个条目同时出现在两个分组。分组只引用条目，不持有正文。

**F-11**：Knowledge Source 的 `sections` 应当可选。短资料不分节，Engine 直接把整份资料当一个候选；长资料的分节可以由作者写，也可以由编辑器从标题生成后经作者确认。但分节的 ID 和 description 要跟随 Release，不能在运行时临时切分后再当作稳定引用。

**F-12**：场次的 `lore` 直接关联表示“本场适用且相关”，Engine 跳过相关性判定，但**仍然**要做可见性和知情过滤。直接关联不等于授权所有参与者知道。

**F-13**：`perspective: rumor` 的条目进入上下文时需要保持其视角，否则模型会把“据说后门闹鬼”当作事实。这属于渲染规则：Assembler 需要按视角加上标注（例如“传闻：”），标注方式由 Preset 决定，但不能省略。

## 案例 5：作用范围不同的风格

**作品**：雨夜旅馆整体采用“克制悬疑”旁白风格；Alice 说话另加“带点自嘲”的口吻；大厅停电那一场额外强调压迫感。同时有两个 Preset：P1 面向长上下文模型，P2 面向小模型。两者都使用指导模块 M“给玩家留下行动空间”，P2 还在末尾再提醒一次。

```yaml
# 雨夜旅馆（Scenario）中的引用
references:
  - id: noir
    use: "@djj/restrained-noir"                 # Style
    mode: default
    scope: narration                             # 新：作用范围
  - id: wry
    use: "@lin/wry-voice"                        # Style
    mode: default
    scope: { cast: alice }
    combine: add                                 # 新：add 补充 / replace 替换同范围的其他 Style
  - id: tension
    use: "@djj/blizzard-tension"                 # Style
    mode: default
    scope: { scene: lobby }
    combine: add
```

```yaml
# P2（Preset）
policy:
  version: 2                                     # 新：策略契约版本
  modules:
    - { use: "@djj/leave-room", at: main }
    - { use: "@djj/leave-room", at: after-history, as: reminder }   # 同一模块第二次装配
```

P1 写成 `version: 2` 时只装配一次；没有 `version` 的旧 Preset 继续使用块自带的 main/after-history 和现行去重规则。

| 对象 | 层次 | 是否新增 |
|---|---|---|
| 三个 Style、模块 M | 可复用定义 | 现有 |
| Style 引用上的 `scope` / `combine` | 本作品安排 | 新 |
| Preset 的 `version: 2` 与 `modules[].at` | 可复用定义（策略） | 新（Q5） |

**检查结果**：同一个 Style 可以在别的作品里用于不同范围；模块 M 的正文只有一份，在两个 Preset、三个位置上使用。

**F-14**：Style 的作用范围应当写在现有 Reference Edge 上，而不是另起一个 `styles` 列表。Style 本来就通过引用进入作品，范围只是这次引用的使用方式。

**F-15**：`combine: replace` 只替换**同一范围内的其他 Style**，不能用来去掉 Character 自己的说话方式片段。人物本身的口吻属于人物设定；要改它应当走 Override，并按 D-027 留下改编标记。否则换一个 Style 就会悄悄改变人物，违背“换 Style 不改变作品事实”。

**F-16**：同一模块在一个 Preset 中装配两次时，每次装配需要自己的标识（示例中的 `as: reminder`），Trace 才能说明“这段文字是第几次、以什么身份出现”。未写 `as` 时按位置自动生成。

**F-17**：范围重叠时的顺序需要固定：旁白 → 场次 → 参与者，由宽到窄；同一范围按引用声明顺序。Style 之间的自然语言矛盾不靠顺序解决，编辑器应当在预览里把同一范围的多个 Style 并列展示，让作者看到组合结果。

## 案例 6：角色知情不对称

**作品**：仍是雨夜旅馆。秘密条目“Alice 昨夜帮旅客从后门离开”：开场时 Alice 知道，Bob 不知道，玩家未声明。旁白视角可以知道全部；如果 Runtime 以 per-agent 方式分别驱动 Alice 和 Bob，Bob 的视图里不能出现这条秘密，连 description 也不能出现。

```yaml
fragments:
  - id: secret-helped
    kind: knowledge
    description: 昨夜旅客离开的真实经过
    content: { type: text, text: "Alice 在十一点半打开后门，把旅客送到河边……" }
    activation: { mode: always }

knowing:                                          # 新：知情声明（Q3）
  - info: secret-helped
    scope: work                                   # 作品开场起成立；也可写 { scene: lobby }
    knows: [alice]
    not: [bob]
    # guest 未出现 = 未声明
```

在 back-door 场次中，Alice 坦白后，由 Runtime 更新“guest 知道 secret-helped”；下一轮 Engine 从本轮会话视图中得到这项变化。

| 对象 | 层次 | 是否新增 |
|---|---|---|
| 秘密条目 | 本作品安排 | 现有（Fragment） |
| `knowing` 声明 | 本作品安排 | 新 |
| 当前谁知道什么 | 运行实例 | Runtime（初值来自声明） |

**F-18**：需要明确“受知情控制”的范围。如果所有条目都要求声明知情，作者会被迫为每条世界常识写一遍“所有人都知道”。建议规则：**只有出现在 `knowing` 声明里的信息才受知情控制**；没有任何知情声明的条目只按 visibility 处理（缺省 shared）。

**F-19**：受知情控制的信息在 per-agent 视图中的处理：声明为“知道”的参与者可以看到；声明为“不知道”和“未声明”的都不暴露，包括标题和 description。这是保守的渲染选择，不改变声明本身：“未声明”仍然保留，Runtime 可以据此决定玩家是否可能从别处得知。条件语言中 `knows` 对“未声明”返回假，与此一致。

**F-20**：narrator 模式下旁白可以看到全部信息。按 D-053，这时 visibility 只是提示；知情声明也一样，需要在渲染时附上“Alice 知道，Bob 不知道”一类的说明，让模型扮演 Bob 时不使用这条信息。说明的写法由 Preset 决定，但不能省略。

**F-21**：知情声明与 visibility 可能冲突，例如某条目 `visibility: private, to: [alice]`，知情声明却写了 Bob 知道。Resolver 应当给出警告：visibility 限制的是“谁的上下文能看到这段内容”，Bob 知道但看不到正文，Runtime 无法让他据此行动。

**F-22**：“本轮会话视图”契约需要包含知情状态的变化（相对于声明初值的增量）。这是 Engine 从 Runtime 获得的输入，不写回作品。

## 案例 7：改编与版本变化

分四种情况检查。

**(a) 引用的角色发布了新版本。** 雨夜旅馆锁定 `@djj/alice@1.2`。Alice 作者发布 1.3：改了 `core` 正文、改了 `voice` 的 description、删掉了一个片段 `childhood`。雨夜旅馆作者选择升级时，编辑器按类别展示差异：正文变化、description 变化、结构变化（片段删除）。如果本作品的 Override 或知情声明指向了被删除的 `childhood`，升级在校验阶段报错，而不是静默丢失。

**(b) 另一位作者改编整部剧情。** “雪夜旅馆”Remix 雨夜旅馆：复制场次、Beat、结局，删掉 `river` 场次，新增一个结局。原结局 `truth-out` 的条件里有 `visited: scene/river`，Remix 发布前的校验会指出这个引用失效。来源记录保留对雨夜旅馆原 Release 的引用。

**(c) 替换一个参与者。** 作者把 Bob 换成另一位调查员 Carol：只改 `cast[bob].who`。场次、目的、知情声明、条件都通过 cast key `bob` 引用参与者，因此仍然有效。编辑器应当列出所有提到这个 key 的位置（`part`、`goal`、`scene.goals`、`knowing`），让作者判断 Carol 是否适合这些安排。

**(d) 同一角色的两个版本同时出场。** 有作者想让“年轻的 Alice（1.0）”和“现在的 Alice（1.3）”同时出现。D-029 规定同一图中同一 Creation 只允许一个 Release，所以这会被拒绝。可行的写法是同一 Release 担任两个参与者，并用 F-4 的参与者级 Override 给年轻 Alice 追加设定；或者把年轻 Alice 发布为独立 Character。

**F-23**：剧情结构中的所有参与者引用都应当使用 cast key，而不是 Creation ref。这使替换参与者、升级角色版本都不会破坏场次、目的、知情和条件。

**F-24**：新增的结构（`part`、`goal`、`scenes`、`beats`、`plotlines`、`endings`、`vars`、`knowing`、`sources`、`groups`、Style 的 `scope`/`combine`、各级 description）都计入 `semantic_digest`，改任何一项都产生新的 Release 身份。差异展示需要把它们分成“正文 / description / 结构”三类，让下游作者判断升级影响。

**F-25**：条件、效果、Override、知情声明中的每一个局部引用都必须在发布时校验存在性。这是条件语言 v1 静态校验的一部分，也覆盖 Remix 删减内容后的悬空引用。

**F-26**：案例 (d) 说明 D-029 在当前需求下仍然够用，暂不需要放宽；参与者级 Override（F-4）是它的配套能力。

## 汇总

### 对已确认方向的影响

七个案例都能用已确认的方向表达，没有推翻 Q1–Q5 或条件语言 v1 的选择。需要补充的是若干具体规则，集中在四处：参与者与本作品安排（F-2、F-3、F-4、F-23）、description 的必填范围（F-1、F-7、F-9）、知情控制的边界（F-18 至 F-22）、Style 范围与改变人物的界限（F-14、F-15、F-17）。

轻量角色（案例 1）和开放情境（案例 2）不需要任何剧情结构字段，满足“复杂结构按需出现”。

### 发现清单

| 编号 | 发现 | 建议 |
|---|---|---|
| F-1 | description 不能成为普遍必填 | 可选；按需取用的片段与分组由编辑器提示补写 |
| F-2 | `cast[].role` 是控制分工，不是故事身份 | 保留 `role` 原义，新增 `part` |
| F-3 | 目的分作品级与场次级 | `cast[].goal` 与 `scene.goals`，都以 cast key 为索引 |
| F-4 | 同一角色担任两个参与者时无法分别改编 | Cast Member 可带自己的 `override` |
| F-5 | 场次参与者需与作品 cast 一致 | `scene.cast` ⊆ `cast`，Resolver 校验 |
| F-6 | 场次转移不需要单独的边 | `scene.when` 表达可进入条件，剧情线顺序只是预期讲述顺序 |
| F-7 | Beat 的“达成”需要定义 | `when` 是前提，达成由 Runtime 确认后执行效果；Beat 的 description 必填 |
| F-8 | 无条件结构的含义 | 只作为候选方向，不会被自动选中 |
| F-9 | 变量含义需要说明 | 变量带 description |
| F-10 | 分组需要放 description 的位置 | Lorebook 新增显式 `groups`，只引用条目 |
| F-11 | 长资料的目录层级 | `sources[].sections` 可选，稳定 ID 跟随 Release |
| F-12 | 场次直接关联资料的语义 | 跳过相关性判定，不跳过可见性与知情过滤 |
| F-13 | 传闻类条目可能被当作事实 | 渲染时按 `perspective` 标注，标注方式由 Preset 决定 |
| F-14 | Style 范围写在哪里 | 写在现有 Reference Edge 上 |
| F-15 | Style 替换可能改变人物 | `replace` 只替换同范围的其他 Style |
| F-16 | 同一模块多次装配需要可追踪 | 每次装配有自己的标识 |
| F-17 | Style 范围重叠时的顺序 | 旁白 → 场次 → 参与者；同范围按声明顺序；预览并列展示 |
| F-18 | 知情控制的范围 | 只有出现在 `knowing` 里的信息受控 |
| F-19 | per-agent 视图如何处理“未声明” | 与“不知道”一样不暴露，声明本身保留三态 |
| F-20 | narrator 模式的知情提示 | 渲染时附上谁知道、谁不知道 |
| F-21 | 知情与 visibility 冲突 | Resolver 警告 |
| F-22 | 运行中知情变化如何传给 Engine | 本轮会话视图包含知情增量 |
| F-23 | 替换参与者和升级版本的稳定性 | 剧情结构一律用 cast key 引用参与者 |
| F-24 | 新结构对版本身份的影响 | 全部计入 digest，差异分“正文 / description / 结构”三类 |
| F-25 | 悬空引用 | 所有局部引用在发布时校验 |
| F-26 | D-029 是否需要放宽 | 暂不需要，参与者级 Override 配套即可 |

### 按易用性目标重看

用户补充了产品形态：char.pub 类似面向创作者的 npm 与 GitHub，另有官方 agent runtime 让内容运行起来；整体要易于创作、分享、使用与参与（总稿 C-11、C-12 与第 16 节）。按这四点重看七个案例，补充以下发现：

| 编号 | 案例 | 发现 | 建议 |
|---|---|---|---|
| F-27 | 1、2 | 案例 1 是 L0，案例 2 是 L1。编辑器从 L1 起步时，作者只需要选角色、写一个场次；`part`、`goal`、`scene.goals` 应在同一张场次卡片上填写，而不是分散在 cast 和 scene 两处 | 数据分两处存放，编辑器合并展示 |
| F-28 | 3 | 案例 3 的条件对新手偏难。同样的作品应能先只写 Beat 和结局的 description、用 `judge` 表达前提，发布后再逐步换成变量和比较 | 编辑器提供“先用一句话描述条件”的默认入口；从 `judge` 升级为结构化条件是普通修改 |
| F-29 | 3 | 玩家打开雨夜旅馆时，需要选择从哪里开始、以什么身份进入 | 新增 `starts`；单一开局时可省略，默认从第一个场次开始 |
| F-30 | 3 | 结局与 Beat 是否向玩家展示会影响剧透 | 每个 Beat、结局可声明是否展示及何时展示（达成后 / 从不） |
| F-31 | 3、4、6 | 使用了条件语言 v1、知情控制的作品，在不支持这些能力的 runtime 上会静默退化 | 作品声明所需能力，runtime 显示支持程度 |
| F-32 | 3、7 | 其他作者给雨夜旅馆投稿“新增一个结局”，需要以结局为单位合并；投稿引用的 Beat 被原作者同时删除时要能发现 | 剧情对象纳入对象级三方合并；合并后重跑引用校验，悬空引用视为冲突 |
| F-33 | 7 | “雨夜旅馆·续”需要从前作某个结局之后开始，复用 cast 和资料 | 续作是新 Scenario，引用前作作为依赖，用 `starts` 声明起始场次、变量与知情 |
| F-34 | 3、6 | 玩家玩出一个很好的坦白场面，想把它变成新结局投稿给原作者，或存成自己的续作 | 官方 runtime 的“保存为创作草稿”只导出整理后的定义，不上传聊天记录；标注模型生成内容，确认贡献权利，许可不允许改编时只能投稿 |
| F-35 | 全部 | 多人分工写不同场次或角色时，对象级合并已经能减少冲突 | 共同作者直接编辑的权限沿用或扩展 namespace 成员机制，待核对 |

这些发现没有改变前面 F-1 至 F-26 的建议，只增加了 `starts`、展示声明、能力声明和剧情对象的投稿单位四类候选结构。

### 阶段 3 的输入

阶段 3 收敛内容结构时，以本文示例中的 `# 新` 字段和 F-29 至 F-33 的新增结构为候选清单，逐项确定：用途、是否必填、所在对象、是否计入 digest（按 F-24 均计入）、静态校验规则，以及作者层级（L0–L3）、编辑器入口和 Contribution 合并单位。需要优先定稿的是 cast 扩展（`part`、`goal`、`override`）、Scene、知情声明与条件语言 v1，因为其余结构都引用它们。
