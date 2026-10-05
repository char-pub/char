# Char Story v1-draft：剧情结构、资料组织与消费契约

Status: **v1-draft / 实施中**。本文是剧情创作内容模型、资料与 Prompt 组织、Context Engine 消费契约与作者工作流的统一规范，取代 `spec/proposals/archive/` 中的讨论稿。关键取舍记录在 DECISIONS D-162 起的条目中；讨论过程与被放弃的备选保留在归档稿里，本文只写现行规则。

2026-09-30 执行修订：项目没有用户，用户授权破坏性重构（D-175）。本文是统一新版目标；实现中同步修订 Canonical、IR、Preset 与组装规范，迁移仓库示例和工具，不维持旧格式或旧组装结果的逐字节兼容。来源、许可、访问授权、内容身份和确定性仍须验证。执行与验收状态见 [执行包](goals/story-v1/PROGRESS.md)。

## 0. 阅读路径

| 想了解 | 读 |
|---|---|
| char.pub、Context Engine 与 Runtime 各管什么 | 第 1 节 |
| 哪些结构先稳定、哪些是实验能力 | 第 2 节 |
| 作者能写什么 | 第 3–11 节 |
| 一段内容对某个视角是否可见 | 第 12 节 |
| Runtime / Engine 怎样消费 | 第 13–15 节 |
| 投稿与合并 | 第 16 节 |
| 编辑器、试玩、分享与参与 | 第 17–18 节 |
| 旧作品怎样保持原义 | 第 19 节 |
| 完整示例 | 第 20 节 |

## 1. 范围与职责

### 1.1 三个层次

| 层次 | 例子 | 持有者 |
|---|---|---|
| 可复用创作定义 | Alice 谨慎、善于观察，有自己的背景经历 | Character 作者 |
| 剧情作品中的安排 | 本剧目中 Alice 是旅馆老板，想保护昨夜离开的旅客 | Scenario 作者 |
| 一次实际游玩的状态 | Alice 已向这名玩家透露后门位置 | Runtime 的 Session |

第一层跨作品引用；第二层让复用的内容在具体故事中具有意义；第三层承载真实互动的变化。运行状态永远不反写 Creation，Preset 与 Style 永远不能修改作者设定。

### 1.2 职责边界

| 事项 | char.pub（规范、Registry、参考实现） | Context Engine | Runtime |
|---|---|---|---|
| 人物、世界、资料 | 发布定义、引用、本地改编与使用声明 | 按视角过滤、选材、展开 | 维护本次人物实例 |
| 剧情安排 | 发布场次、Beat、结局、开局与（实验）条件 | 消费 Runtime 给出的当前局面 | 解释玩家行动、确认 Beat 与场次、执行效果 |
| 知情 | 声明起点 | 按当前知情状态提供内容视图 | 更新本次谁知道什么 |
| 条件与效果 | 语法、类型、静态校验、**参考求值器**与一致性 fixture | 不求值 | 游玩中求值并确认剧情事实 |
| Prompt 与 Style | 发布内容与策略、官方默认 Preset | 解析搭配并装配消息 | 选择实际后端 |
| 模型调用与会话 | 不参与，聊天流量不经过 char.pub | 可调用判定提供方做选材 | 调用生成模型、保存会话 |

规范归属与代码位置分开看：Catalog、TurnView、SelectionPlan、Prepared Context 的契约由 char.pub 维护，随发布格式一起版本化；参考实现放在本仓库，供编辑器预览、作者测试和官方 runtime 复用。第三方 Runtime 可以换用自己的 Engine 与求值器，只要通过同一组一致性 fixture。

参考实现的包归属：

| 能力 | 包 | 说明 |
|---|---|---|
| `story` 与新字段的 schema、Resolver 校验、能力计算 | `packages/core` | 纯计算，无 IO |
| 条件与效果的参考求值器 | `packages/core` 的 story 模块 | 纯计算；编辑器预览、一致性 fixture 和官方 runtime 共用 |
| 视角过滤、Context Catalog、参考 Selector、Assembler v1 | `packages/assembler` | 消费产物与 TurnView |
| 草稿构建、OAuth 授权、Contribution 接受 | Registry | 持久状态与权限的权威 |

“char.pub 不承担游玩求值”指 char.pub 不托管会话、不在服务端推进任何人的游玩；提供参考求值器是为了让条件语义有唯一的可执行定义。

### 1.3 官方 runtime

官方 agent runtime 是独立项目，是默认、体验最完整的消费端。它与第三方 Runtime 走同一套公开契约和同一个 OAuth 授权流程（第 18 节），没有私有接口或特权数据通道。第三方 Runtime 可以只支持部分能力，按能力声明（第 15 节）显示“完整支持 / 降级运行 / 不支持”。

## 2. 分批与冻结

本规范一次写全，按两批稳定：

| 批次 | 内容 | 状态 |
|---|---|---|
| A | 作品与片段 description、`selectable`、分组、参考资料、`perspective`、`about`；参与者 `part`/`goal`/`override`；`story` 中的 Scene、无条件的 Beat 与 Ending、Plotline、`starts`；Style 作用范围；Preset `"1-draft"`；Catalog、TurnView、SelectionPlan、Prepared Context；`outward` 与视角过滤；`story-scene` 可见性；Contribution 扩展 | **v1-draft，稳定候选**。字段语义按本文实现，后续调整需要版本化演进 |
| B | 变量、条件、效果、`judge`、Item、Event、Timeline、知情声明 `knowing`；Beat/Ending 的 `when` 与 `effects`、Scene 的 `when`、计划 Event 的 `when` 与 `effects`；`starts.set`/`starts.reached`；结局 `priority` | **experimental**。可以发布与使用，但不承诺在冻结前保持字段形状 |

### 2.1 实验能力的含义

- **计入身份。** B 批字段与 A 批一样计入 `semantic_digest`；实验不代表内容可以在不产生新 Release 的情况下变化。
- **显式标识。** 使用任一 B 批结构的作品，能力列表中出现带 `experimental: true` 的能力项（第 15 节）。编辑器在发布面板显示“使用了实验能力”，作者确认后才能发布；作品页向玩家显示同样的标识。
- **不改写旧 Release。** 冻结前如果 B 批语义需要改变，新规则以 `story.version: 2` 引入；参考工具链继续读取和校验 `story.version: 1` 的既有 Release，不重写、不重新解释。编辑器为草稿提供迁移，迁移结果是作者确认后的新 Release。
- **冻结条件。** 官方 runtime 通过全部 B 批一致性 fixture，并有真实作品完成游玩验证后，由 DECISIONS 新条目宣布冻结；冻结后才承诺向后兼容。

## 3. 通用约定

### 3.1 字段属性写法

每个新字段按同一组属性说明：

| 属性 | 含义 |
|---|---|
| 必填 | 是 / 否 / 条件必填 |
| 层级 | 作者最早在哪一级遇到它，见 3.6 |
| 编辑器入口 | 普通作者在哪里填写 |
| 校验 | 发布前的静态检查 |

所有新字段都计入所属 Creation 的 `semantic_digest`；片段上的新字段同时计入 fragment digest。修改 description 也会产生新的 Release 身份，因为它改变选材依据；这与“版本号只是 label、锁定靠 digest”一致。

### 3.2 局部 ID 与引用

`story` 中每类对象有独立 ID 空间，ID 格式沿用 fragment 段（小写字母、数字、`-`、`_`）。

| 对象 | ID 来源 | 在条件与效果中的写法 |
|---|---|---|
| 参与者 | `cast[].key` | `alice` |
| Scene | `story.scenes[].id` | `scene/lobby` |
| Beat | `story.beats[].id` | `beat/doubt` |
| Ending | `story.endings[].id` | `ending/open` |
| Start | `story.starts[].id` | 不在条件中引用 |
| Plotline | `story.plotlines[].id` | 不在条件中引用 |
| Item（B） | `story.items[].id` | `item/key` |
| Event（B） | `story.events[].id` | `event/guest-left` |
| Timeline（B） | `story.timelines[].id` | 不在条件中引用 |
| 变量（B） | `story.vars` 的键 | `var/trust` |
| 片段 | 本作品 fragment ID 或依赖中的 `@ns/name#id` | `#secret-helped`、`@djj/inn-lore#back-door` |
| 分组 | `groups[].id` | 不在条件中引用 |
| 参考资料 | `sources[].id`，分节写作 `<source>/<section>` | 不在条件中引用 |

规则：

- 字段已经限定对象类型时直接写 ID（`scene.beats: [doubt]`、`scene.cast: [alice]`）；只有条件和效果这类可引用多种对象的位置加类型前缀。
- 剧情结构中指代人物一律使用 cast key，不写 Creation 公共标识。替换参与者或升级依赖版本时，剧情引用保持稳定。
- 引用依赖中的片段、分组或资料时，该依赖必须在本作品解析闭包中；Release 锁定版本后引用随之固定。
- 公共引用的候选范围是声明实例自身及其实际引用可达实例。外层组合增加的兄弟依赖不能补齐本作品未声明的引用；同一作品被引用多次时，各实例内的本地或自身公共引用仍定位各自实例。可达性由实例边确定，不以可能重复的作者路径字符串判断。
- 发布产物通过类型内局部ID与显式story_refs映射定位完整对象；跨作品/参与者信息引用必须解析到唯一完整ID，悬空或歧义引用是发布错误。

### 3.3 文本类型

`title`、`description`、`part`、`goal` 等给人和判定模型看的文字使用现有 `LocalizedText`。会进入生成上下文或展示给玩家的文字（`opening`、`greeting`）使用 `TemplateText`，只允许现有纯值替换（`{{self}}`、`{{user}}`、`{{cast:<key>}}` 等），不允许 if、loop、expression、script。条件与效果是另一种受限数据树（第 9 节），不是文本模板的扩展。

Story 的 `opening` 与内联 `greeting` 也可以写成 locale → 模板字符串的映射；必须包含作品 `meta.default_locale`，其他语言分别编译，早绑定角色名称按对应语言替换。`ref` 是开局问候语引用的保留键，不能作为该映射的语言键。已有 fragment/bootstrap 文本字段形状不变。发布产物中的编译模板统一为 `{ text, locales? }`，其中 text 对应默认语言；消费者按语言标签逐级匹配，未匹配时回退默认文本。

### 3.4 description 规则

description 回答“这里有什么、什么时候有用”，用于 Catalog 发现与作者预览。它不替代正文；截断后的正文不能当作 description。

| 对象 | description | 原因 |
|---|---|---|
| 作品 `Creation.description` | 否，缺省回落到 `summary` | `summary` 是作品页简介，选材需要的说明经常可以相同 |
| 分组 | 是 | 分组存在的意义就是让选择者知道里面有什么 |
| 参考资料与分节 | 资料必填，分节选填 | 资料通常很长，必须有入口 |
| 片段 | 否 | 见下 |
| Beat、Ending | 是 | Runtime 据此判断变化是否发生；无条件结局只能靠它被选中 |
| 变量、Item、Event（B） | 是 | 判定模型和作者预览要知道它指什么 |
| `starts` 中的开局 | 仅在多个开局时必填 | 玩家据此选择 |
| Scene | 否，缺省使用 `title` | 标题、地点和开局局面已足够识别 |
| Plotline、Timeline | 否 | 只做组织 |

片段 description 的缺省：

- `activation: always` 与 `pinned` 片段不需要 description；它们不经过选材。
- `semantic` 片段缺省使用旧 `activation.hint`。适配时读取，不反向改写旧 Release。
- 其余情况缺省为空。空 description 的片段仍可以被关键词、手动启用或场次直接关联纳入，但不会出现在交给判定模型的目录中。`semantic` 片段既没有 description 也没有 `hint` 时，Resolver 给出警告：它实际上无法被选中。

长度上限：片段与分组 200 字、分节 200 字、作品 300 字（按 Unicode 字符计）。超出时报错，不自动截断。

**description 不改变激活语义。** 补写 description 只影响目录展示，不会让 keyword 片段在未命中时变得可被选中；那需要显式的 `selectable`（4.2）。

### 3.5 作者可读的校验信息

校验结果除了机器可读的 code 与字段路径，还必须带定位（哪个场次、哪条结局、哪个条件节点）和修改建议。例如：“结局‘一起离开’的条件引用了不存在的 Beat `confess`；是否指 `confession`？”。

Core 的 detail 说明问题及可执行的修正方式，code/subject 保持机器定位；候选必须来自实际声明，类型错误按变量的真实类型、范围或允许值说明。网页用当前草稿默认语言显示对象标题与稳定 ID，并保留完整字段路径；不从自然语言诊断反解析目标。点击条件诊断定位当前仍存在的实际节点，过期路径回到所属对象，不猜另一个对象或自动修改草稿。

### 3.6 复杂度层级

| 层级 | 作者写什么 | 典型作品 |
|---|---|---|
| L0 | 名字、介绍、开场白、头像 | 轻量角色 |
| L1 | 选几个角色，写一个场次：地点、开局、各自身份与目的 | 多角色开放情境 |
| L2 | 多个场次、Beat、剧情线、候选结局、资料集与分组、参考资料、Style 范围 | 带重要转折的故事 |
| L3 | 变量、效果、条件、知情声明、Item、Event、Timeline、per-agent 视角、参与者级改编、自定义 Preset | 需要严格规则或复杂视角的作品 |

编辑器按层级出现入口：作品用到某一层，相应入口保持显示；没用到时不显示空面板。

## 4. 片段与资料

### 4.1 片段新增属性

```yaml
fragments:
  - id: haunted-door
    stable: true
    kind: knowledge
    description: 关于后门闹鬼的说法
    perspective: rumor
    about: ["#inn-building"]
    source: { use: "@djj/port-city#handbook/inn" }
    activation: { mode: keyword, keys: [后门, 河边] }
    selectable: true
    content: { type: text, text: "老住客说，雨夜后门会自己打开。" }
  - id: appearance
    stable: true
    kind: character
    outward: true
    content: { type: text, text: "三十出头，总穿着深色毛衣，说话前习惯先笑一下。" }
```

| 字段 | 必填 | 层级 | 编辑器入口 | 校验 |
|---|---|---|---|---|
| `description` | 否 | L2 | 条目卡片副标题 | 长度上限 |
| `selectable` | 否，缺省 false | L2 | keyword 条目上的“关键词没命中时也允许 AI 选择” | 只允许出现在 `activation.mode = keyword` 的片段上 |
| `perspective` | 否，缺省 `canon` | L2 | “这是：设定 / 传闻 / 某人的说法 / 某人相信” | 见 4.3 |
| `about` | 否 | L2 | “涉及”：片段、人物或作品 | 引用在闭包中 |
| `source` | 否 | L2 | “出处” | 指向闭包中的资料或分节 |
| `outward` | 否，缺省 false | L3 | 人物片段上的“别人看得到” | 只允许出现在 `character`、`persona`、`examples` 片段上 |

`locale` 变体共享这些属性，不单独声明。

### 4.2 `selectable`

`selectable: true` 表示：关键词本轮没有命中时，这个 keyword 片段仍作为候选交给 Selector。它必须有 description（否则 Selector 看不到它，Resolver 报错）。缺省 false 时，keyword 片段只由关键词决定，与现行行为一致。

`semantic` 片段总是候选，不写 `selectable`；`manual` 片段只能显式启用，不能写 `selectable`；`always` 与 `pinned` 不经过选材。

CCv3 导入不设置 `selectable`。agent 起草 description 不会顺带打开它。

### 4.3 `perspective` 与 `about`

| 取值 | 含义 | 渲染要求 |
|---|---|---|
| 缺省 / `canon` | 作者确定的设定 | 按事实提供 |
| `rumor` | 流传的说法，真假未定 | 标注为传闻 |
| `{ claim: <SpeakerRef> }` | 某人的说法，可能不实 | 标注说话人 |
| `{ belief: <SpeakerRef> }` | 某人真心相信，但不一定是事实 | 标注“某人相信” |

说话人使用现有 `SpeakerRef`：可复用的 Lorebook 中写 `{{slot:x}}` 或 Creation 公共标识，Scenario 中写 `{{cast:x}}`。标注方式由 Preset 决定，但不能省略；参考 Assembler 的默认格式是在正文前加“传闻：”“Alice 的说法：”“Alice 相信：”。`perspective` 只描述信息的性质，与知情无关：Bob 可以知道“Alice 声称十一点锁了门”，但不知道真相。

`about` 列出条目涉及的片段、人物或作品，用于编辑器双向链接、目录中的相关线索和差异提示。它不参与激活，也不表示知情。

地址语法：`#fragment`、`@ns/work#fragment`、`cast:key#fragment` 指片段；`cast:key` 指本声明实例的参与者（含 late 参与者）；裸 `@ns/work` 指一个作品实例，不隐式猜测为人物。重复作品实例存在歧义时拒绝；具体人物应写 `cast:key`。这些链接不指向分组、参考资料或剧情对象。

构建时为实际保留的片段解析 `catalog_index.about`：每项 `{ from: <完整片段ID>, ref: <作者原引用>, target: { fragment } | { participant } | { work } }`。目标必须存在且唯一，选掉或删除的片段不能作为目标；无关联时省略该字段。IR 继续保留作者原文，索引提供可直接链接的完整身份。此索引属于完整发布产物，不能直接作为角色模型可见的目录；链接不会自动展开目标正文、改变目标 visibility 或赋予参与者知情。

### 4.4 资料分组

```yaml
type: lorebook
ref: "@djj/inn-lore"
description: 河畔旅馆的建筑细节、二十年前的旧案和住客间流传的说法
groups:
  - id: building
    title: 建筑
    description: 旅馆的结构和出入口
    entries: [back-door, cellar, lobby]
  - id: history
    title: 历史
    description: 旅馆的来历和发生过的事
    groups: [old-case, rumor]
  - id: old-case
    title: 旧案
    description: 二十年前的失踪旧案
    entries: [case-1999]
  - id: rumor
    title: 传闻
    description: 住客和居民之间的说法
    entries: [haunted-door, case-1999]
```

| 字段 | 必填 | 层级 | 编辑器入口 | 校验 |
|---|---|---|---|---|
| `id`、`title` | 是 | L2 | 资料集左侧分组树 | ID 唯一 |
| `description` | 是 | L2 | 分组标题下 | 非空，长度上限 |
| `entries` | 否 | L2 | 拖动条目进入分组 | 引用本作品的片段 |
| `groups` | 否 | L2 | 拖动分组嵌套 | 引用本作品的分组；不能成环；最多 3 层 |

规则：

- 分组只引用，不持有正文；一个条目可以属于多个分组。
- 分组可以出现在任何 Creative 类型上，主要用于 Lorebook 与 World。
- 没有进入任何分组的条目，在目录中直接挂在作品下；小资料集可以不写分组。
- 分组不参与激活，不改变条目的可见性与知情。按视角过滤后没有可见条目的分组不出现在该视角的目录中，分组 description 也不暴露。
- 被多个顶层分组嵌套的子分组只展开一次，按首次出现的位置显示。

### 4.5 参考资料 `sources`

```yaml
type: world
ref: "@djj/port-city"
sources:
  - id: handbook
    title: 港城建筑与历史
    description: 城中主要建筑的年代、结构与相关旧事，适合回答“某处怎么走、以前发生过什么”
    asset: handbook
    format: markdown
    visibility: { scope: shared }
    sections:
      - { id: inn, title: 河畔旅馆, anchor: "#河畔旅馆", description: 旅馆的平面、改建和地下通道 }
      - { id: river, title: 河道与码头, anchor: "#河道与码头", description: 河道走向、渡口和夜间航运 }
    origin:
      title: 港城地方志（作者自写）
assets:
  - slot: handbook
    role: context
```

| 字段 | 必填 | 层级 | 编辑器入口 | 校验 |
|---|---|---|---|---|
| `id`、`title` | 是 | L2 | “参考资料”列表，上传文件即创建 | ID 唯一 |
| `description` | 是 | L2 | 上传后提示填写，可由 agent 起草 | 非空，长度上限 |
| `asset` | 是 | L2 | 上传的文件 | 指向本作品 `role: context` 的 asset slot |
| `format` | 是 | — | 按文件类型识别 | v1 支持 `markdown`、`text` |
| `visibility` | 否，缺省只给旁白视角 | L3 | “各角色也能查阅” | 只允许 `shared` 或省略 |
| `sections` | 否 | L3 | “生成目录”：按标题生成，作者确认 | ID 唯一；`anchor` 必须在文件中存在 |
| `origin` | 否 | L2 | “出处” | 只是说明 |

规则：

- **正文在 asset 中。** 资产按内容寻址，Release 锁定的就是这份文件；长资料不写进片段，避免撑大 Context IR。参考资料必须使用mirrored文本资产，支持text/plain与text/markdown；单文件上限8 MiB，必须为合法UTF-8，拒绝NUL。上传保持原字节（含BOM/CRLF），发布前从存储读取并核对摘要、类型与全部锚点；不通过时Release失败，不只验证本轮选中的分节。解析锚点前在验摘要后去掉开头BOM并规范化换行。
- **分节 ID 跟随 Release。** markdown 的 `anchor` 是标题，text 的 `anchor` 是行范围（`L120-L240`）。Runtime 不能临时切分后当作稳定引用。加载正文后先核对发布asset的UTF-8内容摘要，再按分节取文；换行在验摘要后统一为LF。Markdown anchor按文件内唯一标题文字匹配，分节包含该标题到下一个同级或更高标题前的内容；重复或不存在的标题拒绝，代码围栏内的标题不参与匹配。纯文本范围是1起始、两端包含的行范围，越界拒绝。
- **`origin` 不是可跟随的链接。** 平台不在运行时抓取外部内容；需要引用外部内容时保存为 asset，照常经过许可检查。
- **资料不是事实。** 资料包含某个说法，不代表作品采纳它为设定；与条目冲突时以条目为准，Preset 的渲染说明告诉模型这一点。
- **使用范围跟随所属作品。** World 的资料在引用它的作品中都可用；Scenario 可以通过场次 `lore` 直接关联某一节。
- **知情。** 资料和分节不能单独声明知情；需要控制“谁知道”的内容，整理成条目后用 `knowing` 声明。per-agent 视角下只有标 `visibility: shared` 的资料可见（第 12 节）。
- 可出现的作品：World、Lorebook、Character、Scenario。

## 5. 参与者

在现有 `CastMember { key, who, role? }` 上增加三个字段。`role`（`lead` / `support` / `user`）表示控制分工，不表示故事身份。

单玩家作品可显式声明 `story.player: <cast key>`（experimental），指定玩家控制的真实参与者。该 key 必须是根作品的 cast，角色必须为 `role: user`，且声明此能力的根 cast 必须恰有一个 `role: user`；不根据姓名、persona 正文或唯一 user 提示猜测映射。构建增加 `story.player-control` 能力，消费端必须明确支持。没有声明的旧作品保持原语义，不把已有 `role: user` 自动绑定到 Session 玩家。

`story.player` 引用原有 cast identity，不创建第二个人物，也不合并或删除 IR 中独立的隐式 `user`、其 Persona late slot 或 `{{user}}` 模板含义。玩家控制哪个故事角色与提供何种运行时 Persona 是两个显式概念。`resolveStoryPlayer(artifact)` 返回 `{ cast_key, participant }` 或旧作品的 `null`；`playerInputMessage(artifact, text)` 为新声明的玩家输入写入该 participant 的 `speaker`，旧作品保留无 speaker 的输入形状。带声明作品的 user history 必须使用这一 speaker，否则准备/投影拒绝 `story.player_speaker_mismatch`；不改写历史。Assembler 把控制归属加入必需且计入预算的 `session:player-control`，模型应把该人物的发言、决定、行动和内心活动留给玩家。Remix/Sequel 保留此声明与 cast 关系。

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
          stable: true
          kind: character
          content: { type: text, text: "负责后门夜班，曾在河边见过可疑的光。" }
  - key: guest
    who: { late: persona }
    role: user
    part: 被困的住客
```

| 字段 | 必填 | 层级 | 编辑器入口 | 校验 |
|---|---|---|---|---|
| `part` | 否 | L1 | 场次卡片上的参与者列表 | 无 |
| `goal` | 否 | L1 | 同上，“贯穿全剧的目的” | 无 |
| `override` | 否 | L3 | 参与者详情 → “只在本作品中修改这个角色” | 见 5.2 |

### 5.1 `part` 是公开身份

`part` 是其他人物也能看到的身份（“旅馆老板”“调查员”）。per-agent 视角下所有在场参与者的 `part` 都提供给当前角色，所以不能写秘密身份（“真凶”）。秘密身份写成片段，用 `knowing` 或 `visibility: private` 控制。编辑器在 `part` 输入框旁提示这一点。

`goal` 与 `scene.goals` 默认只给参与者本人（第 12 节）。两者同时存在时一起提供，不互相覆盖；编辑器在场次卡片上并排显示，数据分开存放。

### 5.2 参与者级 `override`

语义与 Reference Edge 上的 Fragment Override 相同（`add` / `replace` / `remove` / `patch`），只作用于这一个参与者实例。

- **应用顺序**：被引用 Creation 原文 < Edge override < Scenario override < 参与者 override。同一层对同一 target 有多个 override 时报错。
- **改编标记**：对 intrinsic 设定做 `replace` / `remove` 仍需 `force: true`，并在来源中标记 `au: true`。
- **late binding 参与者**（如玩家 persona）不允许 `override`，只能写 `part` 与 `goal`。
- **同一角色担任多个参与者**：每个参与者各自形成一个实例。产物中这些片段带实例归属 `instance: <cast key>`（第 13.1 节）；参与者实例身份不依赖 override 是否存在。片段引用 `cast:<key>#<fragment>` 指向该参与者的独立实例；裸公共片段引用在有多个匹配实例时为发布错误。最终身份必须包含作品实例路径、cast key 和片段 ID。
- **间接角色复用**：`who` 可以指向经 World 或嵌套 Scenario 引入的 Character/Persona 定义。先在角色展开前的作者引用图中确定唯一完整路径，再为每个参与者复制角色及其依赖子树；共用的 World 前缀不复制。两条作者路径即使锁定同一 Release 也存在歧义，因为入边的绑定、参数、选择与覆盖可能不同，构建时报 `resolve.ambiguous_cast_path` 并展示路径。
- **跨 Scenario 复用定义**：外层的新角色保留原引用路径的入边配置，不继承内层某个参与者的 `cast.override`。内层角色保持原身份、正文和作用域；外层副本只归外层 Scenario，不进入内层的引用闭包。`who` 不表达“复制内层指定参与者的全部改编”，不能根据角色名字推断这个额外意图。
- **词法引入与角色归属分开**：入边上的 `bind`、`params`、`select` 和 Edge override 使用原声明实例；参与者 override 的权限与来源属于声明该 cast 的 Scenario。子树里的 `{{self}}` 重映射到新角色；跨复制边界的明确绑定保留原身份。如果原词法父实际对应多个参与者而入口无法唯一确定，报 `resolve.ambiguous_cast_context`。同层或祖先新生成的派生副本不能反向改变原路径候选。
- 可以用 `patch` 修改 `outward`，让同一角色在不同作品中暴露不同内容。
- **早绑定复用身份**：关系等模板的 slot 以公共作品标识早绑定角色时，引用图中唯一已解析的参与者，不因为多了一个 slot 别名就创建新人物。同一作品对应多个角色实例时，裸公共标识有歧义，必须用 `{{cast:<key>}}` 明确角色；不得按首次出现挑选或按显示名合并。
- 同样的歧义规则适用于 dialogue 的 speaker、private 可见范围与 perspective 的 claim/belief；显式 slot/cast 指向具体实例。Character 内部使用自身公共标识时指向当前实例，不跨实例寻找同名人物。

## 6. `story` 块与 Scene

### 6.1 `story` 块

Scene、Beat、Plotline、Ending、开局以及 B 批结构统一放在 Scenario 的 `story` 下：

```yaml
type: scenario
cast: [...]
story:                 # 可选
  version: 1
  scenes: [...]
  beats: [...]
  plotlines: [...]
  endings: [...]
  starts: [...]
  # 以下为 experimental
  vars: {...}
  items: [...]
  events: [...]
  timelines: [...]
  knowing: {...}
```

- `story` 只允许出现在 `type: scenario` 上。人物、世界、资料集保持可复用定义，不持有剧情安排。
- `story.version` 同时是剧情结构与条件语言的版本。Runtime 遇到不认识的版本必须明确报告不支持，不能忽略。
- 没有 `story` 的 Scenario 与现行作品完全相同。
- 发布产物把 `story` 作为与 Context IR 并列的独立部分（第 13.1 节），不伪装成片段。

### 6.2 Scene

```yaml
story:
  scenes:
    - id: lobby
      title: 停电后的大厅
      description: 暴风雪封路的夜里，众人在大厅被追问旅客去向
      time: 深夜，停电后
      where: 旅馆大厅
      place: "@djj/inn-lore#lobby"
      cast: [alice, bob, guest]
      opening: "灯灭的一瞬间，前台的铃响了一下。{{cast:bob}} 举起手电……"
      goals:
        bob: 让每个人交代昨夜十一点后的行踪
      beats: [doubt, first-trust]
      lore: ["@djj/inn-lore#back-door"]
    - id: back-door
      title: 后门与河边小路
      cast: [alice, guest]
      beats: [confession]
```

| 字段 | 必填 | 层级 | 编辑器入口 | 校验 |
|---|---|---|---|---|
| `id` | 是 | L1 | 自动生成，可改 | 唯一 |
| `title` | 是 | L1 | 场次卡片标题 | 非空 |
| `description` | 否 | L1 | 卡片副标题 | 长度上限 |
| `time` / `where` | 否 | L1 | 卡片上的时间、地点文字 | 无 |
| `place` | 否 | L2 | “地点条目” | 指向闭包中的片段 |
| `cast` | 否，缺省为全部参与者 | L1 | 卡片上勾选在场人物 | 必须是作品 `cast` 的子集 |
| `opening` | 否 | L1 | “开场局面” | 模板占位符能解析 |
| `goals` | 否 | L1 | 在场人物旁的“本场目的” | 键在本场 `cast` 中 |
| `beats` | 否 | L2 | 卡片内的“可能的变化” | Beat 存在 |
| `lore` | 否 | L2 | “本场相关资料” | 片段、分组或资料分节在闭包中 |
| `items`（B） | 否 | L3 | “本场出现的物品” | Item 存在 |
| `events`（B） | 否 | L3 | “本场相关的事件” | Event 存在 |
| `when`（B） | 否 | L3 | “什么时候可以进入” | 条件语言校验 |

语义：

- **`opening` 是局面，不是消息。** 它描述场次开始时的状况，进入生成上下文；玩家看到的第一条消息来自开局（第 8 节）。
- **地点用条目表达。** v1 不新增 Location 对象。`where` 是文字，`place` 指向 World 或 Lorebook 中描述地点的条目，可以跨作品复用。编辑器把被 `place` 或 `about` 引用最多的条目显示为“地点”列表。
- **`place`、`lore`、`items`、`events` 是直接关联。** 进入该场次时，它们跳过相关性判定，但仍经过视角过滤（第 12 节）。`lore` 指向分组时，分组下的全部可见条目都作为直接关联。
- **场次可以重复进入。** 没有 `when` 的场次随时可以进入；有 `when` 时，条件满足只表示可以进入，是否真的进入由 Runtime 判断。场次之间不需要单独的转移边。`scene.cast` 是默认在场名单；Runtime 可在 TurnView 的 `present` 中提供已发布 cast 的实际子集，离场和临时跟随不改变静态 Scene。无覆盖时使用 scene.cast，scene.cast 也省略时使用全部 cast。临时新 NPC 与新 Scene 暂不作为本版发布对象。
- **不在场的参与者不进入本场上下文**，但仍属于作品，可以在后续场次出场。

### 6.3 `story-scene` 可见性

现有 `visibility: { scope: "scene", scene?: FragmentId }` 保持原义：`scene` 指向一个 fragment，由 Session 的 `scene` 匹配。新增一个取值：

```yaml
visibility: { scope: story-scene, scene: lobby }
```

| 取值 | 指向 | 可用的作品 |
|---|---|---|
| `scope: scene` | fragment ID（旧义） | 没有 `story` 的作品 |
| `scope: story-scene` | `story.scenes[].id`，必填 | 有 `story` 的 Scenario 及其闭包中被它引用的片段 |

有 `story` 的 Scenario 在自身片段或 override 中使用旧 `scope: scene` 时，Resolver 报错并建议改写为 `story-scene`。可复用作品（Lorebook、World）不写 `story-scene`，因为它们不知道谁的场次；需要按场次限定时，由 Scenario 用 override `patch` 其 visibility。

### 6.4 作者行动建议

`story.choices` 是可选的行动建议列表，每项有稳定 `id`、玩家可见的 `label: LocalizedText`、`intent: LocalizedText`、可选 `when`。场次通过 `choices: [id]` 引用，复用只引用不复制。没有场次引用的建议发布时报错。

选项出现前提由 Runtime 按条件判断；未知不展示。`label` 必须适合展示给玩家，意图用于 Runtime 解释。玩家始终可以自由输入；点击建议仅提交意图，不自动执行效果、不自动确认 Beat、不直接切换场次。实际结果由 Runtime 确认后使用既有状态操作表达。完整选择历史留在 Runtime，不回写 Creation。

## 7. Beat、Plotline 与 Ending

本节的无条件形式属于 A 批；`when`、`effects`、`priority` 属于 B 批（第 9 节）。

### 7.1 Beat

Beat 表达作者希望探索的关键变化：发现矛盾、产生怀疑、建立初步信任、面临抉择。它只说明变化，不指定台词。

```yaml
story:
  beats:
    - id: doubt
      title: 证词矛盾
      description: 玩家注意到 Alice 与 Bob 对十一点后的说法对不上
      strength: suggested
    - id: confession
      title: 坦白
      description: Alice 承认昨夜帮旅客从后门离开
      strength: possible
      reveal: on-reach
```

| 字段 | 必填 | 层级 | 编辑器入口 | 校验 |
|---|---|---|---|---|
| `id`、`title` | 是 | L2 | 场次卡片内的变化列表 | ID 唯一 |
| `description` | 是 | L2 | 同上 | 非空，长度上限 |
| `strength` | 否，缺省 `possible` | L2 | “作者希望：建议发生 / 可能发生 / 必须发生” | 三选一 |
| `reveal` | 否，缺省 `hidden` | L2 | “是否告诉玩家” | 见 7.4 |
| `when`、`effects`（B） | 否 | L3 | 条件构建器 / “发生后” | 第 9 节 |

`strength`：

- `suggested`：作者希望出现，Runtime 可以主动引导；
- `possible`：可以出现，不主动引导；
- `required`：作品成立所必需。v1 只做静态检查：必须至少被一个场次引用。Runtime 是否以及如何保证它发生由 Runtime 自行决定，并在能力支持说明中写明。

Beat 是否“达成”由 Runtime 确认。Beat 的 description 是给 Runtime 与判定模型的判断依据，默认不进入 per-agent 视角的生成上下文（第 12 节），因为它经常直接写出秘密。

### 7.2 Plotline

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

`scenes` 与 `beats` 至少有一项，全部是引用。顺序只表示作者预期的讲述顺序，不约束执行。一个场次可以同时出现在多条剧情线上，不复制正文。Plotline 不参与条件求值；Runtime 可以用它向玩家展示进度。

### 7.3 Ending

```yaml
story:
  endings:
    - id: escape-together
      title: 一起离开
      description: Alice 带玩家从河边离开，把真相交给 Bob 之外的人
      strength: possible
      reveal: on-reach
    - id: open
      title: 雪停之后
      description: 暴风雪停下，每个人带着各自的秘密离开
      strength: suggested
      after: stop
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `id`、`title`、`description` | 是 | |
| `strength` | 否，缺省 `possible` | 同 Beat |
| `reveal` | 否，缺省 `on-reach` | 见 7.4 |
| `after` | 否，缺省 `stop` | `stop`：结束游玩；`continue`：记录结局后允许继续 |
| `when`、`effects`、`priority`（B） | 否 | 第 9 节 |

没有 `when` 的结局是候选方向：Runtime 可以据 description 判断本次游玩是否走向它，不会被条件求值自动选中。

### 7.4 进度展示 `reveal`

| 取值 | 含义 |
|---|---|
| `hidden` | 不告诉玩家（Beat 缺省） |
| `on-reach` | 达成后告诉玩家（Ending 缺省） |
| `listed` | 开始前就向玩家列出标题，达成后标记；适合“收集全部结局”类作品 |

`listed` 只展示标题，不展示 description 和条件。`listed` 的对象标题会被玩家看到，作者应当把它写成不剧透的标题；编辑器在选择 `listed` 时提示。

## 8. 开局与开场文字

### 8.1 `starts`

```yaml
story:
  starts:
    - id: guest
      title: 以住客身份
      description: 你是被暴风雪困在旅馆的住客，今晚第一次见到其他人
      scene: lobby
      greeting: "你推开门，一阵冷风卷进大厅。"
    - id: storm
      title: 停电那一刻
      description: 从灯灭的瞬间开始
      scene: lobby
      greeting: { ref: blackout }
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | |
| `title`、`description` | 多个开局时必填 | 玩家据此选择 |
| `scene` | 否，缺省为第一个场次 | 起始场次 |
| `greeting` | 否 | `TemplateText`，或 `{ ref: <bootstrap greeting id> }` 引用现有问候语 |
| `set`、`reached`（B） | 否 | 起始状态，见 9.6 |

只有一个开局时可以省略 `starts`；有 `story` 但没有 `starts` 时，等同于一个从第一个场次开始、没有 `greeting` 的开局。

### 8.2 开场文字的来源与优先级

开场相关文字有四个来源，它们共存，按下表区分用途：

| 来源 | 用途 | 是否作为消息展示给玩家 |
|---|---|---|
| `scene.opening` | 场次开始时的局面，进入生成上下文 | 否 |
| `starts[].greeting` | 从这个开局进入时的第一条消息 | 是 |
| `bootstrap.greetings[0]` | 现有默认问候语 | 是，见下 |
| `bootstrap.greetings[1..]` | 现有备选问候语 | 是，见下 |

支持 `story.v1` 的 Runtime 这样确定第一条消息：

1. 玩家选定开局；只有一个开局时自动选定。
2. 该开局有内联 `greeting` 时使用它；是 `{ ref }` 时使用对应的 bootstrap 问候语，包括它的 `locale` 变体。
3. 该开局没有 `greeting` 时使用 `bootstrap.greetings[0]`。
4. 两者都没有时，不发送开场消息，直接进入场次。

有 `story` 时，没有被任何开局引用的备选问候语不作为开局选项展示给玩家；它们保留给不支持 `story.v1` 的消费者。不支持 story 的 Runtime 必须报告能力不足；显式选择有损 CCv3 导出时按第19.3节解析各开局实际 greeting，第一项为默认，其余为备选，并记录结构损失。

编辑器在剧情工作区把四处来源合并展示：每个开局卡片显示实际生效的第一条消息及其来源；没有被开局引用的问候语显示在“旧版问候语（给不支持剧情的 runtime）”中。作者希望两类消费者看到相同开场时，用 `{ ref }` 引用同一条问候语，只编辑一处。

`{ ref }` 必须指向存在的问候语 ID；引用某条问候语的开局被删除时，问候语本身保留。

参考 SDK 提供 `startSession({ artifact, bindings, start?, locale?, judgments?, greeting_id? })`，返回 `{ turn, opening }`。多个开局时必须给出 start；单一或隐式开局可省略。有 Story 时禁止独立选择 greeting_id，必须从开局解析实际问候语；没有 Story 的作品可用 greeting_id 选择 bootstrap 备选。

它先执行初始 set/reached/知情与场次进入条件，再创建首条消息。实际选用语言写入 turn.locale，保证后续组装不会被另一个Profile缺省语言改变；锁定搭配的调用方先按有效Profile选定语言再启动。`opening` 为 null 表示没有问候语；旁白消息没有 speaker，不伪造不存在的 self。实际首条消息已经放入 turn.history，Runtime 不应重复追加。该接口只接受新会话输入，不接受已有 history/story 状态来自动补全；继续会话必须直接使用完整 TurnView。`initialStoryTurn` 则仅初始化状态，不生成或追加消息；它与 `startSession` 一样，多开局缺少显式 start 时拒绝 `story.start_required`。

CLI 新预览使用这个入口，多开局需 `--start`；Web 开局选择器默认显示并显式选择第一项。预览中的样例消息排在实际开局消息后，传入完整快照时保持原历史，不重新初始化。


## 9. 状态、条件与效果（experimental）

本节全部属于 B 批。开放情境无需写任何条件；条件是可选附加能力，不是剧情结构成立的前提。

### 9.1 形式与版本

条件与效果写成结构化数据树（YAML/JSON 节点），不是字符串语法：不需要解析器，不存在运算优先级和转义问题，编辑器可以直接映射成条件构建器，Contribution 可以按对象合并。它们没有循环、函数、外部调用，求值必然终止。

条件语言的版本就是 `story.version`。Runtime 遇到不认识的版本或节点必须明确报告不支持，不能忽略或当作真。`fn`、`expr` 两个节点名保留给后续版本，v1 校验时报错。

### 9.2 变量

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
    inventory:
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
| `set` | `of: item` 或 `values`，以及 `init` | `of: item` 时为 Item 子集，否则为 `values` 的子集 |

- 没有浮点数与字符串比较；trust=0.28 这类值写成 0–100 的整数。
- `values` 中的名称使用 ID 格式。
- 变量都属于整部作品，没有场次级作用域。
- 变量都要声明并给初值，运行时不存在未定义变量。
- 每个变量必须有 description。

### 9.3 条件节点

条件是下列节点之一，写成只有一个键的对象：

| 节点 | 形式 | 为真的情况 |
|---|---|---|
| `all` | `{ all: [条件, ...] }` | 全部为真；空列表为真 |
| `any` | `{ any: [条件, ...] }` | 至少一个为真；空列表为假 |
| `not` | `{ not: 条件 }` | 真/假互换；unknown 保持 unknown |
| `in` | `{ in: scene/<id> }` | 当前正在该场次 |
| `visited` | `{ visited: scene/<id> }` | 曾经进入过该场次（包括当前） |
| `reached` | `{ reached: beat/<id> }` | 该 Beat 已被 Runtime 确认达成 |
| `ended` | `{ ended: ending/<id> }` | 已进入该结局 |
| `happened` | `{ happened: event/<id> }` | 背景事件恒为真；计划事件已被 Runtime 确认发生 |
| `knows` | `{ knows: { who: <cast key>, info: <片段> } }` | 该参与者当前知道这条信息 |
| `is` | `{ is: var/<bool> }` | 布尔变量为真 |
| `cmp` | `{ cmp: [var/<int>, <运算符>, <整数>] }` | 比较成立；运算符为 `=` `!=` `<` `<=` `>` `>=` |
| `eq` | `{ eq: [var/<enum>, <取值>] }` | 枚举变量等于该取值 |
| `has` | `{ has: [var/<set>, <取值 或 item/<id>>] }` | 集合包含该取值 |
| `judge` | `{ judge: <LocalizedText> }` | 由 Runtime 或判定提供方判断；未判定为 unknown |

v1 不支持变量之间比较，`cmp` 右侧只能是整数常量；不支持算术、内置函数、变量作用域、定时与计数触发。更复杂的逻辑可以写成 `judge` 命题，或拆成多个变量加效果。

校验：

- 引用的场次、Beat、结局、事件、变量、信息、参与者必须存在；
- 节点与变量类型匹配（`cmp` 只用于 int，`eq` 只用于 enum，`has` 只用于 set，`is` 只用于 bool）；
- `eq`、`has` 的常量必须在声明的取值范围内；`cmp` 的整数可以越出 min/max，但恒真或恒假时给出警告；
- `knows.info` 必须是受知情控制的信息（出现在 `knowing` 中或被某个 `learn` 效果引用），否则报错：未受控的信息没有知情状态可判断；
- 复杂度：嵌套超过 8 层或单个条件超过 64 个节点时警告，提示拆分或改用变量；超过 32 层或 512 个节点时报错。

`story.condition_constant` 警告定位到具体 `cmp` 节点，说明比较在变量声明的整个闭区间内恒真或恒假；包括恰好落在边界的比较和 min=max 的单值变量。区间内的 `=` / `!=` 常量不能仅凭两端结果相同就推断为恒定。类型或范围声明本身无效时先报告声明错误，不推导恒定警告。警告不改写条件、不阻止保存，也不替 Runtime 决定动作。

### 9.4 效果节点

效果是节点列表，按顺序执行：

| 节点 | 形式 | 作用 |
|---|---|---|
| `set` | `{ set: [var/<x>, <值>] }` | 设为指定值；类型与变量一致；int 值必须在 min/max 内 |
| `add` | `{ add: [var/<int>, <整数>] }` | 加上该整数（可为负），结果截断到 min/max |
| `put` | `{ put: [var/<set>, <取值 或 item/<id>>] }` | 加入集合，已存在则不变 |
| `drop` | `{ drop: [var/<set>, <取值 或 item/<id>>] }` | 移出集合，不存在则不变 |
| `learn` | `{ learn: { who: <cast key 或 "*">, info: <片段> } }` | 该参与者开始知道这条信息；已知道则不变 |

效果中不能嵌套条件。效果可以出现在 Beat、Ending、计划事件和开局上。

### 9.5 求值语义

以下语义由参考求值器实现，所有 Runtime 用同一组一致性 fixture 验证（第 14 节）。

1. **状态**由变量值、知情快照、`visited`、`reached`、`ended`、已发生的计划事件、当前场次与已记录的 `judge` 结果组成。
2. **初始化**：变量取 `init`；知情取 `knowing[*].start`；然后执行所选开局的 `set`，再把 `reached` 列出的 Beat 记为已达成（不执行它们自身的效果）；最后进入开局场次。
3. **进入场次**：先把场次加入 `visited` 并设为当前场次，再应用 `knowing[*].enter.<scene>`。
4. **确认达成**：Runtime 确认一个 Beat、计划事件或结局达成时，该对象的 `when` 必须在确认时刻为真（没有 `when` 视为真）；已达成的对象拒绝重复确认，不执行任何效果；否则记入对应集合并按顺序执行其效果。一次确认的效果执行完毕后，才评估下一个。
5. **同时满足**：多个对象在同一时刻满足时，Runtime 逐个确认，按确认顺序执行效果，并在 Trace 中记录顺序。结局按 `priority` 从大到小考虑（缺省 0），同优先级由 Runtime 选择并记录。
6. **`judge`**：Runtime 或判定提供方给出真 / 假 / 未判定；未判定保留为 unknown。`all` 遇 false 为 false，否则有 unknown 为 unknown；`any` 遇 true 为 true，否则有 unknown 为 unknown；`not unknown` 为 unknown。只有最终 true 才能执行，不能把“没有确认同意”解释成“已经拒绝”。结果连同提供方身份记入 TurnView 的 `judgments`，固定后求值可以重放。
7. **结束与原子性**：`after: stop` 的结局设置停止状态；之后进入场次与确认对象均拒绝。查询和导出仍可用，重开通过重新初始化。所有状态操作纯计算并原子返回，失败不改变输入。进入场次（含初始化）必须先验证 `when` 为 true，再更新 visited 与 enter 知情；起始条件未知时返回可定位错误，Runtime 提供判定后可重试。
8. **非法状态**：变量值类型不符或越界、引用不存在的对象时，求值器报错，不自行修正。

### 9.6 开局的起始状态

```yaml
story:
  starts:
    - id: after-confession
      title: 坦白之后
      description: 从 Alice 坦白之后开始，适合已经玩过一遍的玩家
      scene: back-door
      set:
        - { set: [var/trust, 70] }
        - { learn: { who: guest, info: "#secret-helped" } }
      reached: [first-trust, confession]
```

`set` 语法同效果节点，在变量与知情初值之后执行；`reached` 视为已达成的 Beat，不执行它们自身的效果。

### 9.7 带条件的 Beat、Scene 与 Ending

```yaml
story:
  scenes:
    - id: back-door
      when: { any: [{ reached: beat/doubt }, { has: [var/inventory, item/key] }] }
  beats:
    - id: first-trust
      effects: [{ add: [var/trust, 20] }]
    - id: confession
      when: { cmp: [var/trust, ">=", 60] }
      effects: [{ learn: { who: guest, info: "#secret-helped" } }]
  endings:
    - id: escape-together
      priority: 2
      when: { all: [{ reached: beat/confession }, { judge: 玩家承诺替旅客保密 }] }
      effects: [{ set: [var/road_open, true] }]
```

- Scene 的 `when` 是可进入条件，不是自动跳转。
- Beat 与计划事件的 `when` 是达成前提；前提满足后是否发生由 Runtime 判断，确认后才执行 `effects`。
- Ending 的 `effects` 在进入结局时执行，供续作作者参考最终状态。

编辑器的条件入口默认是“用一句话描述条件”，生成 `judge`；旁边提供“用规则表达”，打开按“进度 / 知情 / 变量”分类、只列出存在对象与类型匹配变量的条件构建器。`judge` 改写为结构化条件是一次普通修改。

### 9.8 Item

Item 是作品中有身份、会被提到的物件或线索。它是 `story` 中的对象，不是独立发布的 Creation，v1 不能跨作品引用。

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

| 字段 | 必填 | 说明 |
|---|---|---|
| `id`、`title`、`description` | 是 | |
| `lore` | 否 | 相关资料，引用在闭包中 |
| `reveal` | 否，缺省 `hidden` | `on-reach` 表示持有后在玩家的物品栏中显示；`listed` 不适用于 Item |

- Item 只描述物件本身；谁持有它由 `of: item` 的集合变量表达，可以有多个这样的变量。
- Item 的 description 是物件的外观与用途，按 Runtime 专用文字处理（第 12 节）；场次 `items` 让 Item 关联的 `lore` 片段作为直接关联进入上下文。物件涉及秘密时（例如信件内容），秘密写成片段并用 `knowing` 控制。

### 9.9 Event

Event 是故事世界中发生的事，与 Beat（人物关系或剧情走向的变化）区分。

```yaml
story:
  events:
    - id: guest-left
      title: 旅客离开
      description: 昨夜十一点半，Alice 从后门把一名旅客送到河边
      kind: background
      when_text: 昨夜十一点半
      cast: [alice]
      place: "@djj/inn-lore#back-door"
      truth: "#secret-helped"
    - id: storm-ends
      title: 雪停
      description: 暴风雪停下，道路重新通行
      kind: planned
      when: { visited: scene/river }
      effects: [{ set: [var/road_open, true] }]
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `id`、`title`、`description` | 是 | |
| `kind` | 是 | `background`：故事开始前已发生；`planned`：作者安排可能发生 |
| `when_text` | 否 | 时间文字 |
| `cast` | 否 | 涉及的参与者，可以包含不在任何场次出场的参与者 |
| `place`、`lore` | 否 | 地点与相关资料 |
| `truth` | 否 | 写着真相的片段；编辑器在事件卡片上显示它的知情安排 |
| `when`、`effects` | 仅 `planned` | 语义同 Beat |

- `background` 事件在条件中恒为真。它是作者设定，不是谁都知道的事实：谁知道真相由该片段的 `knowing` 控制。
- `planned` 事件可以被 Runtime 当作“环境推进”，不需要玩家行动触发。
- Event 的 description 是 Runtime 专用文字（第 12 节）。需要让模型知道的内容写在片段中，按可见性与知情规则提供，避免一个事件的描述绕过知情控制。
- 场次 `events` 让事件关联的 `place`、`lore`、`truth` 片段作为直接关联进入 Catalog，不提供 Event 的 description。

### 9.10 Timeline

```yaml
story:
  timelines:
    - id: main
      title: 故事时间
      order:
        - old-case
        - guest-left
        - [scene/lobby, scene/back-door]
        - scene/river
        - storm-ends
```

- `order` 表达**发生**的先后；嵌套列表表示同一时段并列。它与剧情线（预期**讲述**顺序）无关，也不约束执行。
- 条目是 Event ID 或 `scene/<id>`；同一条时间线中一个对象只能出现一次；同一对象可以出现在多条时间线上。
- Timeline 不参与条件求值，不进入生成上下文；它服务于编辑器时间线视图、预览检查（例如“场次在时间上早于它引用的事件”）和 Runtime 的可选展示。v1 不做日期计算与时长。

### 9.11 知情声明 `knowing`

`knowing` 以信息（片段）为键，声明故事开始时谁知道这条信息。

```yaml
story:
  knowing:
    "#secret-helped":
      start:
        knows: [alice]
        not: [bob]
      enter:
        river: { knows: [bob] }
    "@djj/inn-lore#case-1999":
      start:
        knows: "*"
```

| 字段 | 必填 | 编辑器入口 | 校验 |
|---|---|---|---|
| 键（信息） | 是 | 条目卡片上的“谁知道这件事” | 片段在闭包中 |
| `start.knows` / `start.not` | 至少一项 | 参与者勾选：知道 / 不知道 / 未声明 | cast key 存在；同一人不能同时出现在两边 |
| `enter.<scene>.knows` | 否 | 场次卡片上的“进入时谁已经知道” | 场次与 cast key 存在 |

**三态与坍缩规则。** 声明保留三态：出现在 `knows` 为知道，出现在 `not` 为不知道，都没出现为未声明；`"*"` 表示作品中全部参与者。**所有消费端都把“未声明”当作“不知道”**：视角过滤、`knows` 条件、TurnView 快照都只有“知道 / 不知道”两态。第三态只用于：

- 编辑器提示“你还没决定 Bob 是否知道”；
- 投稿与差异展示区分“作者明确说不知道”和“作者没写”；
- 续作与改编作者判断哪些前提是开放的。

其他规则：

- **受控范围。** 只有出现在 `knowing` 中或被某个 `learn` 效果引用的信息受知情控制；其余片段只按 visibility 处理。
- **`enter` 只能增加知情。** 进入场次时“让某人忘记”不是合理的创作语义；需要时拆成不同信息。
- **运行中的变化**由 Runtime 维护，初值来自 `start`，`learn` 效果与 `enter` 增加知情；当前状态通过 TurnView 的完整快照交给 Engine。
- **与 visibility 的关系。** visibility 表示“这段内容能给哪些视角看”，`knowing` 表示“故事中谁知道这件事”。片段 `visibility: private` 列出的对象里没有某个声明为“知道”的参与者时，Resolver 警告：该参与者知道却看不到内容。两者如何共同决定可见性见第 12 节。

### 9.12 续作

续作是一部新 Scenario，把前作作为来源依赖，复用其角色与资料。作者可以按前作某个结局的效果起草 `starts.set`，也可以明确审阅 Runtime 整理的当前局面，将变量与知情写成新作品的静态初值。char.pub 不读取或托管玩家 Session，也不把传入初值当作游玩历史的证明。v1 不支持在续作的条件中引用前作的 `story` 对象；变量与知情的键必须在续作自己的 `story` 中声明。

## 10. Style 的作用范围与组合

Style 仍通过 Reference Edge 引入。Scenario 指向 Style 的边新增两个字段：

```yaml
references:
  - { id: noir, use: "@djj/restrained-noir", mode: default, scope: narration }
  - { id: wry, use: "@lin/wry-voice", mode: default, scope: { cast: alice } }
  - { id: tension, use: "@djj/blizzard-tension", mode: default, scope: { scene: lobby } }
  - { id: plain, use: "@djj/plain", mode: default, scope: narration, combine: replace }
```

| 字段 | 必填 | 取值 | 校验 |
|---|---|---|---|
| `scope` | 否，缺省 `narration` | `narration` / `{ scene: <id> }` / `{ cast: <key> }` | 只允许出现在指向 Style 的边上；场次与参与者必须存在 |
| `combine` | 否，缺省 `add` | `add` / `replace` | `replace` 只替换同一范围内先前的 Style |

规则：

- **组合顺序**：旁白 → 场次 → 参与者；同一范围按边的声明顺序。同一范围有 `replace` 时，只保留最后一个 `replace` 及其后的 `add`。
- 组合顺序是 Preset 布局内的呈现顺序，不改变 Selector 排名与预算入选优先级。不同声明者按引用实例原有遍历顺序组合；每个声明者内部按边的声明顺序，单个 Style 自身片段保持作者顺序并先于其引用的 Style。
- **嵌套 Style** 继承外层使用的角色/场次范围；外层被替换时，其内层 Style 一起被替换。内层 `replace` 只替换同一声明实例内更早的 Style 使用，不删除外层本身的文本或其他引用实例。IR 的 `style_use.path` 保存内层使用的实例 owner、声明顺序和 combine；根 Style 的自身文本属于独立的根层。
- **场次范围**只在当前场次生效；当前场次来自 TurnView。
- **参与者范围**：per-agent 视角下只进入该参与者的上下文；narrator 视角下标注“Alice 的说话方式”后提供。
- **人物自带的口吻不受 `replace` 影响。** Character 自己引用的 Style 属于人物设定；在 Scenario 中替换它需要通过参与者 `override` 并遵守 intrinsic 替换规则。
- Character 与 World 上的 Style 边不写 `scope`：Character 的 Style 是该人物的口吻，World 的 Style 是旁白。
- **渐进展开**：Style 的核心说明使用 `always` 或 `pinned`；长示例可以标为 `semantic` 或 `opportunistic` 并写 description，由 Engine 按预算取用。

编辑器入口（L2）：作品设置中的“文风”列表，每项选择“整体 / 某个场次 / 某个人物”和“补充 / 替换”，旁边预览该范围下最终组合的 Style 文本。

## 11. Preset `"1-draft"` 与官方默认 Preset

Preset 与 Prompt Module 统一升级为 `version: "1-draft"`。现有仓库内容通过迁移把 position 转为 default_at；不保留双版本运行路径。

### 11.1 模块装配

```yaml
policy:
  version: "1-draft"
  imports:
    - { id: leave-room, use: "@djj/leave-room", pin: { release: ..., semantic_digest: ... } }
  blocks:
    - id: tone
      text: 叙述克制，不替玩家做决定。
      default_at: main
  placements:
    - { block: tone, at: main }
    - { block: leave-room/core, at: main }
    - { block: leave-room/core, at: after-history, as: reminder }
```

```yaml
prompt_module:
  version: "1-draft"
  blocks:
    - id: core
      text: 每次回复都给玩家留下行动的空间，不要连续推进多个事件。
      purpose: 防止模型替玩家推进剧情
      default_at: main
```

| 字段 | 所在 | 必填 | 说明 |
|---|---|---|---|
| `blocks[].position` | 两者 | — | `"1-draft"` 中移除，由 `default_at` 与 `placements` 取代 |
| `blocks[].default_at` | 两者 | 是 | 没有被 `placements` 提到时的位置：`main` / `after-history` |
| `blocks[].purpose` | 两者 | 否 | 给作者与 Trace 看的用途说明 |
| `placements` | Preset | 否 | 显式装配；`block` 写本地块 ID 或 `<import id>/<block id>`；嵌套导入逐层追加 import ID（例如 `base/safety/core`） |
| `placements[].at` | Preset | 是 | `main` / `after-history` |
| `placements[].as` | Preset | 否 | 本次装配的标识，缺省为 `at` 的值 |

规则：

- **本地块与导入块规则一致**：没有被 `placements` 提到时按 `default_at` 装配一次；被提到时只按 `placements` 装配，可以多次。
- 保留一个块但暂不使用，沿用 `enabled: false`。
- **去重**：同一模块 Release 经多条依赖路径导入只算一次；`placements` 中的多次装配都保留。同一块同一位置写两次且 `as` 相同时报错，即使通过不同导入别名引用同一定义也一样。定义图按Release保存局部块和导入，不预先枚举全部路径。
- **顺序**：同一位置内按 `placements` 的声明顺序；未被提到的块排在显式装配之后，按现行依赖遍历顺序。
- 所有 Module 必须先迁移为新版再发布；不允许在同一导入闭包混用策略协议版本。
- **已解析结果区分定义与装配**：Resolved Module块保留`default_at`；Resolved Preset块输出实际`position`与唯一装配ID（显式装配为`<definition-id>~<at>~<as-or-at>`）。`origin`保留原始块、精确Release/digest和首次导入路径；`placement`记录本次声明使用的别名路径。Trace保留`policy_origin`、`policy_placement`与`purpose`，重复装配不会覆盖彼此。

### 11.2 新区域

`"1-draft"` 的 layout 在现有区域之外新增：

| 区域 | 内容 |
|---|---|
| `system:scene` | 当前场次的时间、地点文字、开场局面、本场目的、`place` / `lore` / `items` / `events` 直接关联的条目 |
| `system:story` | 在场参与者的 `part` 与本视角可见的 `goal`；narrator 视角下 Runtime 请求时附上候选 Beat 与结局的 description |
| `system:sources` | 选中的参考资料节选 |

新版 layout 必须完整列出全部区域；原布局迁移时明确插入新区域，并审阅新的消息顺序，不在运行时悄悄回落。

### 11.3 选材要求

```yaml
policy:
  selection:
    catalog_budget: 1500
    max_depth: 4
    on_unavailable: skip
```

| 字段 | 缺省 | 说明 |
|---|---|---|
| `catalog_budget` | 由 Runtime 决定 | 目录阶段最多暴露给 Selector 的 token 估算 |
| `max_depth` | 4 | 作品根深度为0，每条父子边加1；默认4覆盖三层分组和叶子 |
| `on_unavailable` | `skip` | 判定提供方不可用时的回退；v1 只有 `skip`：只保留 `required` 与 `direct`，不提供“全部注入” |

`selection` 是要求而不是实现。Runtime可以使用更小的目录/深度限额，不能放宽Preset上限；max_depth省略和显式4行为一致。判定提供方的地址、凭据与型号不进入 Preset。

### 11.4 渲染标注

`"1-draft"` Preset 可以用 `render` 覆盖标注文字，未覆盖时使用参考 Assembler 的默认格式：

| 键 | 用途 | 默认 |
|---|---|---|
| `perspective.rumor` | 传闻前缀 | `传闻：` |
| `perspective.claim` | 某人说法前缀 | `{{speaker}} 的说法：` |
| `perspective.belief` | 某人相信前缀 | `{{speaker}} 相信：` |
| `knowing.narrator` | narrator 视角下的知情说明 | `（知道此事：{{knows}}；不知道：{{unknown}}）` |
| `sources.notice` | 资料不是事实的说明 | `以下为参考资料，与设定冲突时以设定为准。` |

标注可以改写，但不能为空：Resolver 拒绝空字符串。

### 11.5 官方默认 Preset

char.pub 在系统 namespace 发布 `@commons/default-preset`，它是普通的公开 Preset Release（`"1-draft"`），经过与其他作品相同的发布检查和人工审校。

- **适用范围。** 没有锁定 Preset 的内容作品，使用官方默认 Preset。
- **发布时锁定。** Registry 在创建发布任务时持久化选定的默认 Preset 精确 Release 与 `semantic_digest`，worker与重试始终使用同一身份；构建把解析后的策略及精确身份写入产物`default_policy`。Core把它当作普通输入，不自行查找。因此同一个 Release 在任何 Runtime、任何时间都用同一个默认策略，不存在运行时解析的“最新版”。
- **默认 Preset 的更新**由系统 namespace 发布新 Release，并更新 Registry 配置中的当前默认值；只影响之后构建的产物，已发布的 Release 不变。作者也可以在 Scenario 的 `assembly` 中显式锁定其他 Preset。
- **统一默认。** 内容作品没有显式 Preset 时均由构建输入提供锁定的默认策略；简单作品也走相同消费路径。策略作品自身不依赖默认策略。
- **严格产物边界。** Artifact、Context IR、assembly配置与策略协议使用`1-draft`；完整内容产物必须有assembly或default_policy。源文件的canonical/check与完整构建分开：计算作者摘要不需要默认策略，但实际构建、预览和作者测试必须具备精确策略输入。
- **草稿取得默认。** Registry的`GET /v1/default-policy`提供当前可公开读取的精确身份，禁用HTTP缓存；草稿预览一次取值后按该身份加载闭包，不在组装期间重新选择。CLI本地build/preview/test用`--default-policy`提供快照；发布仍由Registry选择并持久化最终策略。
- 第三方 Runtime 下载产物记录的那个 Release 即可复现官方 runtime 的默认行为；官方 runtime 不使用任何未发布的默认策略。

## 12. 视角与可见性

一段内容是否出现在某个视角，由**一个**纯函数 `viewOf(item, view, turn)` 决定。Catalog、Assembler、编辑器预览与 Trace 都调用它，不各自实现过滤。它对每一项内容返回三种结果之一，并附一个原因码：

| 结果 | 含义 | 是否计入 `withheld` |
|---|---|---|
| `visible` | 可以进入该视角的 Catalog；narrator 视角可能附标注 | — |
| `withheld` | 存在于当前局面，但因信息边界对该视角隐藏 | 是，只计数 |
| `excluded` | 结构上与该视角无关（其他场次、不在场、他人的目的等） | 否 |

visibility 与 `knowing` 仍是两个概念：visibility 回答“内容能给哪些视角看”，`knowing` 回答“故事中谁知道这件事”。`viewOf` 把它们放进同一张决策表，作者只需要在预览里看一个结论和一个原因。

### 12.1 适用条件

- 所有新版内容使用12.2的per-agent规则；★标记仅说明与旧实现的差异，不作为运行时分支。迁移人物时需明确标记公开外在描述。
- **per-agent 是 L3 能力。** 编辑器只在作者选择“每个角色只知道自己该知道的”时展示 per-agent 相关入口与提示；缺省的作品体验以 narrator 为准。
- narrator 视角下 visibility 与知情只是提示，不是安全边界；per-agent 视角下它们是隔离边界，前提是 Runtime 真的为每个角色分别调用模型。

### 12.2 per-agent 视角（为参与者 P 准备）

Style 先按第 10 节处理作用范围与替换；已被替换的层不属于当前有效内容，原因记为 `view.style_replaced`。对其余内容按下表顺序判断，第一条命中的决定结果：

| 顺序 | 内容 | 结果 | 原因码 |
|---|---|---|---|
| 1 | Runtime 专用文字：Scene 的 `description`，Beat、Ending、Event、变量、Item 的 description，`judge` 命题，开局的 `title`/`description` | `excluded` | `view.runtime_only` |
| 2 ★ | 其他参与者的 `goal` 与 `scene.goals` | `excluded` | `view.others_goal` |
| 3 | 限定在其他场次的片段（`story-scene` 或旧 `scene` 不匹配当前场次） | `excluded` | `view.other_scene` |
| 4 | 不在当前场次的参与者的人物片段或参与者范围 Style | `excluded` | `view.absent` |
| 5 ★ | 在场的其他参与者的人物片段，且未标 `outward` | `excluded` | `view.not_outward` |
| 6 | 受知情控制的信息，P 当前不知道（含“未声明”） | `withheld` | `view.not_knowing` |
| 7 | `visibility: private` 且 P 不在 `to` 中 | `withheld` | `view.private` |
| 8 ★ | 参考资料或分节，所属资料未标 `visibility: shared` | `withheld` | `view.source_not_shared` |
| 9 | `scope: { cast: X }` 的 Style，X ≠ P | `excluded` | `view.style_other_cast` |
| 10 | 分组，且其下没有 `visible` 的条目或子分组 | `excluded` | `view.group_empty` |
| 11 | 其余内容，包括所有在场参与者的 `part`、P 本人的 `goal` 与 `scene.goals`、在场他人的 `outward` 片段、P 本人的全部设定 | `visible` | — |

第 6 与第 7 条同时适用：P 必须既知道这件事，又在 visibility 允许的范围内。声明为“知道”却被 visibility 排除时，结果仍是 `withheld`，Resolver 在发布时已给出警告。

没有任何 `outward` 片段的在场参与者，对其他人只提供 `part` 与 `display_name`。玩家 persona 同样适用：为 Alice 准备上下文时，只提供 persona 中标 `outward` 的片段。

### 12.3 narrator 视角

| 顺序 | 内容 | 结果 | 标注 |
|---|---|---|---|
| 1 | Runtime 专用文字 | 缺省 `excluded`（`view.runtime_only`）；TurnView 设 `story_guidance: true` 时，Beat 与结局的 description 为 `visible` | 放入 `system:story`，标为“作者的方向提示” |
| 2 | 限定在其他场次的片段 | `excluded` | — |
| 3 | 不在当前场次的参与者的人物片段 | `excluded` | — |
| 4 | 受知情控制的信息 | `visible` | 附“谁知道、谁不知道”的说明，不能省略 |
| 5 | `visibility: private` | `visible` | 按现行规则标注知情者 |
| 6 | 参与者范围的 Style | `visible` | 标注“某人的说话方式” |
| 7 | 其余内容 | `visible` | 按 `perspective` 标注 |

### 12.4 作者预览中的解释

编辑器预览对每项被隐藏的内容显示原因码对应的一句话，例如“Bob 不知道这件事（知情声明：开局时不知道）”“其他角色看不到 Alice 的内心设定：没有标为‘别人看得到’”。作品启用 per-agent 时，发布前检查额外列出：

- 对所有角色都不可见的参考资料，提供一键标为 shared；
- 没有 `outward` 片段的人物，建议把外貌等拆成单独片段（可由 agent 起草拆分）；
- 写在 `goal` 里、别人也应当知道的内容，建议改写为条目并用 `knowing` 控制。

这些是作者侧建议，不属于 Selector 输入，不阻断发布，也不由平台模型猜测 goal 是否应该公开。检查读取本次真实构建及实际视角；未提供公开绑定描述的 late 角色提示在 Session 中填写 `outward_description`，不把完整 `description` 当公开外观。来源作品的资料只能定位其所属作品，不允许在当前草稿中伪改依赖。根作品资料的一键 shared 修改普通工作稿，支持撤销；修改后旧预览与发布审阅失效，需要重新构建。撤销保留其他字段的后续编辑，若该资料已经再次修改则拒绝覆盖。

## 13. 消费契约

```text
发布产物 ──► 视角过滤 + Catalog ─┐
                                ├─► Selector ──► SelectionPlan ─┐
Runtime ──► TurnView ───────────┘                               ├─► Assembler ──► Prepared Context ──► Runtime
                                        Preset / Runtime Profile ┘
```

**唯一允许非确定性的位置**是 Selector（判定模型）。Catalog 由产物与 TurnView 确定性地算出；SelectionPlan 固定后，Assembler 的输出也是确定的，Trace 可以重放。

### 13.0 统一组装路径

使用一个 Catalog / SelectionPlan / Assembler 路径。简单作品可以没有 story、groups 或 sources，但仍按同一视角与预算契约处理。旧源码输入由明确的工具迁移；不维护旧 Assembler 分支。迁移后重新计算身份、引用锁与作者 fixture，不能把旧 digest 当作新内容身份。

### 13.1 发布产物新增部分

CreationArtifact 与 Context IR 统一使用 `"1-draft"`，IR 媒体类型为 `application/vnd.char.context-ir+json; version=1-draft`。严格拒绝不支持的版本，不把新版内容伪装成旧版。引用解析必须保留根与每条依赖实例的完整身份。

IR `graph.edges` 只记录真实作者引用可达关系；存在角色实例时，另以 `graph.cast_edges` 记录 `{ from_instance: <所属Scenario实例>, to_instance: <角色实例>, cast: <key> }`。同作用域的间接角色可同时由原引用边和角色归属边到达，闭包遍历须按实例 key 去重。跨 Scenario 新副本只有外层归属边，不添加到内层引用边中。实例 `cast.introduced_by` 记录原词法父实例与入边 ID；`via` 保留作者路径，不把它当唯一实例身份。

`"1-draft"` 产物在现有内容之外并列新增，不塞进 IR 的片段列表：

| 部分 | 内容 | 身份 |
|---|---|---|
| `ir` | 现有内容；片段新增 `description`、`selectable`、`perspective`、`about`、`source`、`outward`，以及参与者实例归属 `instance` | 随 `semantic_digest` 与 `lock_digest` |
| `story` | Scenario 的静态定义，保留作者局部ID；消费通过story_refs解析跨对象信息 | 计入根作品 `semantic_digest` |
| `story_refs` | participants映射cast key→实际participant key；information映射知情引用→完整IR fragment ID；content映射场次等直接关联引用→CatalogRef（支持分组/资料分节）；templates保存编译后的场次opening与内联start greeting，每项为`{text,locales?}`（`scene/<id>/opening`、`start/<id>/greeting`）；歧义或不存在时报错 | 由根定义和锁定闭包计算，计入完整产物摘要 |
| `catalog_index` | 解析闭包内全部作品的 description、分组树、参考资料与分节目录（不含资料正文）、可选的已解析 `about` 链接 | 由解析闭包决定，对应 `lock_digest`；不参与 `semantic_digest` 计算 |
| `capabilities` | 所需能力列表（第 15 节） | 由上述内容纯计算得出 |
| `default_policy` | 未锁定 Preset 时使用的官方默认 Preset 精确 Release 与 digest（11.5） | 构建输入，计入 `lock_digest` |

`catalog_index` 在发布时算好，避免每轮构建 Catalog 都遍历依赖闭包。它是纯函数结果：相同闭包必然得到相同索引。

### 13.2 Context Catalog

Catalog 是某一轮、某个视角下可供选择的内容目录，每轮都可能不同。

```ts
interface ContextCatalog {
  view: { mode: "narrator" | "per-agent"; for?: CastKey; scene?: SceneId }
  required: CatalogRef[]      // 必须放下，放不下时报错
  direct: CatalogRef[]        // 不经 Selector，按预算纳入或跳过
  candidates: CatalogNode[]   // 交给 Selector 的目录树
  withheld: number            // 只计数
}

interface CatalogNode {
  ref: CatalogRef
  kind: "work" | "group" | "fragment" | "source" | "section"
  title: string
  description?: string
  perspective?: Perspective
  about?: string[]
  children?: CatalogNode[]    // 已展开的子项
  child_count?: number        // 未展开时只给数量
  est_tokens: number          // 目录阶段的估算，不代表最终成本
  importance: "normal" | "opportunistic"
  activation_hint?: "keyword" | "semantic"
}

type CatalogRef =
  | { work: string }                      // 完整作品实例身份；仅可展开
  | { fragment: string }                  // 完整片段 ID，含实例归属
  | { group: string }
  | { source: string; section?: string }
  | { story: "scene" | "part" | "goal" | "beat" | "ending"; id: string }
```

对每一项内容，按顺序判断，第一条命中的决定去向：

| 顺序 | 条件 | 去向 |
|---|---|---|
| 1 | `viewOf` 返回 `withheld` 或 `excluded` | 不进入；`withheld` 计数 |
| 2 | `importance: pinned` | `required` |
| 3 | 当前场次的 `opening`、`time`、`where`；在场参与者的 `part`；本视角可见的 `goal` 与 `scene.goals` | `required` |
| 4 | `activation: always`（`normal` 或 `opportunistic`） | `direct` |
| 5 | 当前场次 `place`、`lore`（含直接关联资料分节），以及 `items`、`events` 关联的片段 | `direct` |
| 6 | narrator 视角且 `story_guidance: true` 时，当前场次未达成的 Beat 与候选结局的 description | `direct` |
| 7 | `activation: keyword` 且本轮命中 | `direct` |
| 8 | `activation: manual` 或 `semantic` 且列在 TurnView 的 `enabled` 中 | `direct` |
| 9 | 有 description 的 `semantic` 片段；有 description 且 `selectable: true`、本轮未命中的 keyword 片段；分组；参考资料与分节 | `candidates` |
| 10 | 其余 `keyword`、`semantic` 片段 | 不进入；Trace 记为跳过，原因同现行（未命中 / 无 description） |
| 11 | 其余 `manual` 片段 | 不进入；只能显式启用 |

说明：

- **`always` 不是必需。** 它表示“不需要选材就是候选”，预算不足时可以整条跳过，与现行行为一致；必须放下的内容用 `pinned`。
- **过滤最先执行。** `required` 与 `direct` 中的内容同样先经过 `viewOf`。
- **分组下的条目**在第 9 条中作为分组的子节点出现；条目自身满足第 2–8 条时，按那一条的去向处理，不再出现在分组下。
- **参考资料分节**没有 description 时，目录中只显示分节标题。

Selector只接收目录DTO `{ view, candidates }`，不接收作者预览中的 `required`、`direct`、`withheld` 或完整的构建中间对象。`catalog_budget` 按这个DTO的JSON表示计算，展开响应按 `{ parent, children }` 的相同表示计费；重放使用相同口径。history/focus属于独立的SelectorView，其请求成本由Runtime/提供方计入整次调用预算。初始目录超过预算时明确报错，调用方可调整预算或选择不调用模型的流程，不能把未计费元数据作为旁路发给模型。

片段候选保留已声明的 `perspective` 和实际 `activation_hint`。`claim`/`belief` 的归属参与者不在当前场景时，省略整个 perspective，不改写为 canon。`about` 从已解析索引投影为完整片段/作品实例 ID 或 `participant:<key>`，不直接发送作者原始引用字符串；只保留当前视角可见的目标，参与者还须在场，作品须在该精确实例内有可见内容或在场参与者。省略隐藏关系不改变片段正文，也不自动激活、展开或选中关联目标。初始目录与后续展开采用同一投影，全部元数据计入目录预算和摘要。

### 13.3 展开

`candidates` 默认只展开到作品与第一层分组，其余以 `child_count` 表示。Selector 可以请求展开某个节点；展开是纯函数，结果仍是经过 `viewOf` 的 CatalogNode。展开次数与总目录成本受 Preset `selection.catalog_budget` 与 `max_depth` 约束。总目录估算低于 `catalog_budget` 且全部节点在 `max_depth` 内时，适配层可以直接给出完整树。每次实际暴露给 Selector 的目录均计入成本；重复暴露也计数。父节点的 description 必须能向其全部可见受众展示；混合秘密的目录应拆分，不能只依赖隐藏叶子。

### 13.4 TurnView：本轮会话视图

TurnView 扩展现有 `Session`，现有字段保持原义：

```ts
interface TurnView {
  // 现有 Session 字段
  locale?: string
  bindings: Record<string, LateBindingValue>
  history: HistoryMessage[]
  manual_enabled?: string[]         // Catalog 中称为 enabled
  overlay?: SessionOverlay
  visible_overlay?: SessionOverlay // Runtime 针对当前角色投影后的覆盖；per-agent 只读此字段
  for_participant?: CastKey
  scene?: string                    // 当前静态场次 ID
  present?: CastKey[]                // 本轮实际在场；省略时用场次默认，显式空数组表示无人

  // 新增：剧情运行状态，仅作品有 story 时
  story?: {
    start: StartId
    visited: SceneId[]              // 含当前场次
    reached: BeatId[]
    ended: EndingId[]
    happened: EventId[]             // 已确认的计划事件（B）
    vars: Record<VarName, boolean | number | string | string[]>   // B
    knowing: Record<InfoRef, CastKey[]>                           // B，当前知道的参与者
    stopped: boolean               // 已确认 stop 结局；后续状态操作拒绝
  }
  story_guidance?: boolean          // narrator 视角下是否提供 Beat 与结局的方向提示
  focus?: string                    // 本轮关注点摘要，只影响选材，不进入最终消息
  judgments?: JudgmentRecord[]      // 本轮已做出的 judge 判定（B）
}

interface JudgmentRecord {
  target: string                    // 条件所在对象，例如 "ending/escape-together"
  path: string                      // 条件树中 judge 节点的 JSON Pointer
  result: "true" | "false" | "undetermined"
  provider: { name: string; version: string }
}
```

规则：

- **`story` 是完整快照，不是增量。** Runtime 自己保存历史与增量，Engine 每轮只看当前状态。
- **`knowing` 只列出受知情控制的信息**，值是当前知道的参与者；未列出的参与者即不知道。
- **状态必须合法**：变量类型与声明一致，int 在 min/max 内，set 元素属于声明取值或 Item，引用的对象存在。非法时报错，不自行修正。
- **Engine 不改写 TurnView。** 条件求值、Beat 确认、效果执行都由 Runtime 完成，结果写进下一轮 TurnView。
- **绑定描述分视角。** `LateBindingValue.description` 是完整描述，`outward_description` 是可对其他角色公开的描述。per-agent只接收自身完整描述与其他在场角色的公开描述；离场角色保留模板所需身份，但不自动注入绑定描述。narrator使用在场角色完整描述与全局overlay。
- **开场初始化是显式操作。** `initialStoryTurn(artifact, start?)` 供新会话和作者预览构造初始快照；消费已有快照的Engine不得用它补全缺失状态。网页可选开场，CLI用`--start`；CLI `--session`传入完整TurnView，与`--start`互斥。

参考 Assembler 的 `projectPlayerView({ artifact, turn })` 提供玩家界面投影，独立于 narrator 的模型上下文。返回 `player`（key、可选 cast_key、name、present、可选 part）、当前 `scene`（id/title 及公开 description/time/where）、当前在场的其他 `participants`（key、可选 cast_key、name、present、可选 part/portrait）、`known`（id/title/text）、当前可用 `choices`（id/label）与已达成公开 `milestones`（kind/id/title）。它只读取当前快照与已有 judgments，不调用模型、加载 Source 或推断事实。

人物 portrait 仅含作者显式 `outward: true` 且通过玩家 per-agent 视角的 character/persona 文本，late 人物只使用 `outward_description`；没有公开画像时省略。线索只来自显式 knowing 已含受控 cast、通过当前场次/私有/知情过滤的 knowledge 文本，不把可检索、pinned 或旁白可见当作玩家已知。里程碑只显示已达成且 reveal 非 hidden 的 Beat/Ending；不提前暴露 listed 结局。私有 goal、场次 goal、变量、条件、判定提示、未来人物或未获知资料不进入 DTO。无 `story.player` 的旧作品保守使用隐式 user 视角，`player.present` 为 null、known 为空，不凭角色名制造身份。作者应把公开画像与线索写成玩家可读资料，把模型扮演指令放在相应私有设置中。

### 13.5 SelectionPlan

```ts
interface SelectionPlan {
  discovery: boolean              // 是否暴露候选目录；none/skip 可关闭，重放必须一致
  input: {
    artifact_digest: Digest         // 完整发布产物，包括正文与全部目录元数据
    lock_digest: Digest
    catalog_digest: Digest          // 初始 Catalog（未展开）的摘要
    turn_digest: Digest
    policy_digest: Digest           // 实际策略、选材限制和tokenizer配置的摘要
  }
  selector: { name: string; version: string; config_digest?: Digest }
  selected: { ref: CatalogRef; form: "body" | "section"; rank: number }[]
  decisions: {
    ref: CatalogRef
    action: "expand" | "select" | "reject"
    score?: number                  // 量纲由 selector 定义
    confidence?: number
    note?: string                   // 简短理由，供作者预览
  }[]
  fallback?: "skip"
}
```

Assembler 接收前必须校验，任何一条不满足都拒绝整个 Plan：

1. 产物内容摘要与锁摘要、`turn_digest`、实际策略（含默认策略）的 Release/digest 和 `input.catalog_digest` 全部与本轮输入一致；任一不同拒绝；
2. 按 `decisions` 中的 `expand` 顺序重放展开，展开次数与成本不超过 Preset 限制；
3. 每个 `selected[].ref` 都在重放后的 `candidates` 中；不能选中 `withheld`、`required`、`direct`、不存在或越界的内容；
4. work/group 是容器，只可 expand 不可选正文；fragment 只能选 body，source 可选 body，含 section 的 source 只能选 section；分节必须存在。重复叶子拒绝，rank 为有限非负整数，按升序及完整 ref 字典序打破同分；v1 不支持简版正文。
5. `selected` 是最终正文清单；若同 ref 存在 select/reject 决策，以最后一项为准，最终 reject 的 ref 不得进入 selected，否则拒绝 `selection.decision_mismatch`。未记录终局决定的旧 Plan 仍可选择；select 暂未进入 selected 的增量展开或 skip 日志也合法，不把决策日志误当最终正文清单。

Plan 的产物、TurnView、Catalog、策略输入摘要，以及 Trace 的 `plan_digest`，使用精确 JSON 快照摘要：对象键按 JCS 排序，但字符串值与字典键不做 NFC、换行或尾空白归一。运行时的 history、focus、overlay、bindings 与判定记录必须绑定实际观测到的内容；即使这些变化没有改变目录，也不能复用旧Plan。仅JSON键序变化、对象中省略未定义的可选属性仍等价。SDK的`digestExactJSON`用于此类快照，`digestOf`继续用于作者正文的规范化语义，不全局更改后者。

`digestAssemblyMessages`同样保留实际消息文本、来源与附件标识的精确字符串，只按既有规则排除附件的临时传输URL。Runtime的命令幂等、请求、结算和决策证据也须绑定精确快照；不能把字节不同的玩家输入当作相同命令，或接受原文已改变而摘要未变的持久记录。旧实现用正文归一规则计算的含特殊文本Plan、消息期望或日志可能不再匹配；必须保留原记录并显式审阅/重新开始，不尝试旧摘要回退、静默重算历史head或自动接受新expected。

`discovery: false`时只计算required/direct及视角过滤，不暴露目录、不产生目录成本；不能带入selected或展开决策。关闭发现阶段的Plan同样绑定完整输入，并可在目录预算为0时重放。模型不可用的skip回退仍须保留required/direct的正常正文校验与预算检查。

参考实现提供两个不调用模型的 Selector，用于编辑器预览、作者测试和降级：`none`（不选任何候选，与回退 `skip` 结果相同）和 `fixed`（按给定 ref 列表选择）。使用判定模型的 Selector 由 Runtime 或第三方提供；它只接收本轮视角 Catalog 与 `SelectorView`：当前视角身份、当前场次 ID、Runtime 为该视角提供的 history 与 focus。完整 TurnView（尤其 vars、knowing、judgments、overlay、bindings）只留在可信 Engine，不序列化给 Selector。Runtime 必须保证提供的 history/focus 符合该视角；不得传入旁白完整记录再让模型自行过滤。

Jev/Laya这类决策模型从首版就作为Harness提供方纳入：HTTP/SDK、凭据、超时和取消属于独立Harness；char.pub提供可验证的请求/结果契约与固定替身。提供方结果需记录模型身份、配置和输入摘要；相关性选择可多选或空选，不将Choice的单选强加给世界书。概率阈值由提供方显式配置，不把结构合法当作判断正确。Laya以公开上游[NandhaKishorM/laya](https://github.com/NandhaKishorM/laya)及[模型卡](https://huggingface.co/convaiinnovations/laya)为具体接入候选；独立Harness须核验其原生响应、实际路由、弃权和输入窗口，不仅替换Jev地址。具体适配与质量证据在独立执行包记录。

故事中的 `judge` 判定与选材判定是两件事：前者由 Runtime 做，结果写进 TurnView 的 `judgments`；后者由 Selector 做，结果写进 SelectionPlan。

提供方的网络证据由Harness单独持有：记录请求、经过验证的概率结果、实际模型身份、配置与输入摘要，不扩充StoryJudgment或把证据注入叙事消息。判定绑定操作前态，选材绑定操作后的上下文；回放必须保留实际Plan身份和展开过程，不能重写成fixed Plan。总请求预算覆盖history/focus和问题文本，目录预算单独约束每次曝光。取消不产生可提交的判定或skip结果；超时/不可用才按显式故障策略回退。

### 13.6 Prepared Context 与预算

```text
Assembler Input = 产物 + Resolved Preset? + Runtime Profile + TurnView + Catalog + SelectionPlan
```

输出沿用现有 messages 与 AssemblyTrace，Trace 扩展：

```ts
interface PreparedContext {
  messages: ModelMessage[]
  trace: AssemblyTrace & {
    selection?: { plan_digest: Digest; selector: { name: string; version: string } }
    story?: { scene?: SceneId; start: StartId }
    view: { mode: "narrator" | "per-agent"; for?: CastKey }
  }
}
```

Trace 条目 `reason` 新增：`required`、`scene`、`direct`、`selected`、`withheld`、`fallback`。交给 Runtime、第三方以及网页最终消息面板的消费 Trace 只计隐藏数量。已授权作者通过独立目录诊断查看隐藏对象与原因；内部显式 author diagnostics 可供调试，不进入 Selector、Plan、最终消息或作者测试。

预算：

1. 先扣历史、Session 与启用策略块等固定成本，再放入全部 `required`；放不下时报错（`assemble.required_over_budget`，其中 pinned 超限沿用 `assemble.pinned_over_budget`）。
2. 其余按 `normal` → `opportunistic` 分两层；每层内先 `direct`（按 IR 顺序），再 `selected`（按 `rank`），整条纳入或跳过。
3. 区域上限、全局成本口径与 `assembly:formatting` 差额沿用现行显式策略规则。

渲染时按 11.4 附加视角标注、知情说明与资料说明。

### 13.7 重放

固定以下输入后，Prepared Context 必须完全相同：产物（`lock_digest`）、Preset（Release 与 digest）、Runtime Profile、tokenizer、TurnView（`turn_digest`）、SelectionPlan。Catalog 由产物与 TurnView 算出，不单独固定。重放不需要重新调用判定模型，也不保证生成模型给出相同回答。

## 14. 参考求值器与一致性 fixture

### 14.1 参考求值器

`packages/core` 的 story 模块提供条件与效果的参考求值器，是 9.5 语义的唯一可执行定义：

| 函数 | 作用 |
|---|---|
| `initStoryState(story, castKeys, startId?, judgments?)` | 按 9.5 第 2 条得到起始状态 |
| `enterScene(story, castKeys, state, sceneId, judgments?)` | 进入场次并应用 `enter` 知情 |
| `evaluateCondition(story, castKeys, state, cond, judgments, target?, path?)` | 返回 true / false / unknown |
| `availableTargets(story, castKeys, state, judgments)` | 列出当前满足前提的场次、Beat、计划事件与结局（结局按 `priority` 排序） |
| `confirm(story, castKeys, state, target, judgments)` | 确认达成并执行效果，返回新状态 |
| `toTurnStory(state)` | 转成 TurnView 的 `story` 快照 |

所有求值入口的 castKeys 来自可信作品定义，不能从待校验的快照中推导。状态操作前校验完整快照，外部条件在递归解析前校验深度/节点上限。

求值器是纯函数，不持有会话，不决定“是否真的发生”——那是 Runtime 的判断。编辑器预览用它显示“当前状态下哪些条件满足”，作者手动设定 `judge` 结果；官方 runtime 可以直接使用它。

### 14.2 fixture

一致性 fixture 放在 `spec/conformance/story-v1/`，分三类：

| 类别 | 输入 | 期望 |
|---|---|---|
| 求值 | `story`、开局、操作序列（进入场次、确认对象、judge 结果） | 每步后的状态、条件真假、错误码 |
| 视角 | 产物、TurnView、视角 | 每项内容的 `viewOf` 结果与原因码 |
| Catalog 与组装 | 产物、Preset、Profile、TurnView、SelectionPlan | Catalog 摘要、Plan 校验结果、`messages_digest` 与 Trace 断言 |

规范 fixture 的 expected 需要人工接受，运行结果不能自动写回；这与作者随作品发布的 assembly_tests 是两种独立基线。第三方 Runtime 与 Engine 通过全部 fixture 后，才可以声明对应能力“完整支持”。

作者测试的 fixture 输入扩展为完整TurnView、可选的固定`selection: CatalogRef[]`与`source_texts`（IR asset ID→精确UTF-8正文）；运行器构建产物之后才产生完整SelectionPlan，避免fixture嵌入包含自身的artifact_digest形成摘要递归。断言仍为有序消息摘要、Trace选择或错误码。非法状态、目录、选择或资料加载错误属于测试初始化失败，不能靠expected错误码让测试通过。

所有Creative类型及Preset都可保存作者测试，Prompt Module不直接持有测试。Creative测试可用`root: self`，Preset测试用已发布内容根的ExactRef与`preset: self`，不将草稿或本地产物伪装成发布依赖。作品规范化对`assembly_tests[*].session`完整快照与`source_texts`正文保留精确字符串；不能改写换行、Unicode或尾空白，也不能改写session字典键，避免关键词/视角输入与原预览不同。其他作者正文继续遵循文本规范化。此规则贯通语义摘要、Revision/发布快照、配置投稿与三方冲突摘要；不同的精确输入不能被归一成同一变更。

参考准备API省略`preset`时优先使用产物assembly搭配，其次使用产物default_policy；显式`preset: null`选择产物锁定的default_policy。作者fixture不指定Preset时使用default_policy；网页选择默认策略也必须显式取消assembly继承。消费完整锁定assembly配置使用`assembleArtifact`。

公开 SDK 的 `assemble` 与 `prepareContext` 使用同一实现，输入为完整 `artifact`、`profile`、`turn`，以及可选的已绑定 `plan`、精确 `source_texts` 等。仅有 Context IR 的旧输入不再接受。视角与激活统一在 Catalog 准备阶段判定，内部 renderer 只接收已验证的 admission 和明确的策略；不存在另一套无策略布局。所有调用都计入最终消息的区域标题和合并分隔符。默认策略与显式策略使用相同的选材预算顺序，布局只负责消息位置，不能另开一套内容优先级。


`sourceRequests(input)`从相同的Catalog/Plan校验得到本轮required/direct/selected资料的加载清单，按asset去重，未选或被视角隐藏的资料不发起加载。网页先显示说明及可选目录，作者固定选择后才加载正文；请求只带精确Release和Source ID，不上传历史或角色绑定。返回身份和正文摘要须与产物一致，最终组装再验证正文；旧设置/作品/账户的迟到响应不得覆盖当前结果。

Registry提供`GET /v1/releases/:release/source-text?source=<完整Source ID>`，先验证根Release读取权限，再从其完整产物定位资料；不接受任意digest/URL。响应`{source,asset,digest,text}`中的text保留原字节可重编码形式，始终private, no-store；被阻止、未知或无权限资料不可读取。发布复制与草稿读取前，所有根mirrored资产都需授予，包括头像、未被Source引用的context及Preset/Module展示资产：发布者自己的ready上传（服务端blob、thumbnail及成功导入derived）、同作品成功且未tombstone发布的mirrored资产，或经当前主体授权的精确依赖中的mirrored资产。全局ready状态不是访问权；linked声明及其历史blob_refs不能授予相同digest的私有字节。历史候选需回读固定发布产物核实mirrored来源。namespace成员关系本身不授予彼此私有上传权限；无用户身份的OIDC发布只复用后两种明确来源，新增资产的作品级上传授予另行接入。通用授予不替代Source正文/锚点验证。

参考Assembler不负责网络或文件IO；调用方提供被纳入的资料正文，按发布asset摘要复核后才提取分节。CLI `--source-texts`接收上述JSON正文映射。Web与Registry需通过作品/构建及资产身份授权读取，不能从任意客户端digest签发下载地址；该读取链路属于平台实现工作。

## 15. 能力声明

构建时根据作品内容自动计算所需能力，写入产物 `capabilities`；作者不手写。

| 能力 | 出现条件 | experimental |
|---|---|---|
| `catalog.v1` | 存在片段 description、分组、作品 description、`selectable` 或编译后的 `about` 链接 | 否 |
| `sources.v1` | 存在 `sources` | 否 |
| `perspective.v1` | 任一片段写了非 `canon` 的 `perspective` | 否 |
| `story.v1` | 存在 `story` | 否 |
| `story.player-control` | 显式声明 `story.player` | 是 |
| `cast.override` | 任一参与者带 `override` | 否 |
| `view.outward` | 任一片段标 `outward` | 否 |
| `style.scope` | 任一 Style 边写了非缺省的 `scope` 或 `combine` | 否 |
| `policy.1-draft` | 锁定的 Preset 或其 Module 使用 `"1-draft"`，或使用官方默认 Preset | 否 |
| `story.conditions` | 声明变量、`starts.reached`，或 `when`/`effects`/`starts.set` 使用非 `judge` 的条件或效果节点 | 是 |
| `story.judge` | 使用了 `judge` | 是 |
| `story.knowing` | 存在 `knowing` 或 `learn` | 是 |
| `story.items` | 存在 Item | 是 |
| `story.events` | 存在 Event 或 Timeline | 是 |

```ts
type Capability = { id: string; experimental?: true }
```

所有Artifact（含策略作品）都必填capabilities，按ID排序去重，由实际产物与生效策略自动推导。未使用的输入快照、被select删除的片段不增加需求；cast override删除操作的来源也计入。作者Creation不能手写能力清单。未知未来ID允许在消费端表示，以便明确报告不支持。

Core的`checkCapabilitySupport`对照Runtime显式支持列表；缺失项即unsupported，包含实验能力。降级只能由Runtime显式提供能力ID和非空原因，返回缺失及降级清单；Core不替Runtime决定降级策略。

Runtime 根据自己支持的能力显示“完整支持 / 降级运行 / 不支持”。降级规则由 Runtime 定义并在界面上说明，例如不支持 `story.conditions` 的 Runtime 可以把全部条件当作作者提示交给模型；不支持 `sources.v1` 的 Runtime 忽略参考资料。第三方有损消费时附带损失说明，沿用导出 Loss Report 的做法。

## 16. 投稿与合并

### 16.1 新增变更类型

现有变更类型（`fragment`、`edge`、`asset`、`metadata`、`configuration`）保持不变。新增：

```ts
type StoryChange =
  | { on: "story"; kind: StoryKind; op: "add" | "modify" | "remove"; id: string;
      base_digest?: Digest; after?: JSONValue }
  | { on: "story-order"; list: "scenes" | "beats" | "plotlines" | "endings" | "starts" | "choices" | "items" | "events" | "timelines";
      base_digest: Digest; after: string[] }
  | { on: "cast"; op: "add" | "modify" | "remove"; key: CastKey; base_digest?: Digest; after?: JSONValue }
  | { on: "group"; op: "add" | "modify" | "remove"; id: string; base_digest?: Digest; after?: JSONValue }
  | { on: "source"; op: "add" | "modify" | "remove"; id: string; base_digest?: Digest; after?: JSONValue }

type StoryKind = "scene" | "beat" | "plotline" | "ending" | "start" | "choice" | "item" | "event" | "timeline" | "var" | "knowing"
```

| kind | 合并单位的 ID |
|---|---|
| `scene`、`beat`、`plotline`、`ending`、`start`、`choice`、`item`、`event`、`timeline` | 对象 `id` |
| `var` | 变量名 |
| `knowing` | 信息引用，例如 `#secret-helped` |
| `cast` | cast key |
| `group`、`source` | 分组或资料 `id` |

片段上的新属性（description、`selectable`、`outward` 等）属于片段本身，通过现有 `fragment` 变更修改。

提交新增结构化变更时，HTTP请求显式声明 `changes_version: 1`；不支持的版本拒绝，缺少声明的旧客户端只能提交既有变更类型。`story-order` 输入可省略 `op`，解析后统一为 `set`。顺序声明必须列出提案应用后该列表的全部对象且各一次，成员增删另用对象变更。

字段合并需要真实基线内容，不能只凭对象摘要猜测。Registry从提案绑定的不可变Revision读取基线，Core校验基线与当前作品身份及各对象的base_digest；客户端不得自报可信基线。新增第一批Story对象时建立version 1；只有全部Story对象明确删除且无并发新增时才移除story，否则无场次等非法结果冲突。

### 16.2 字段级合并与引用集合

`story`、`cast`、`group`、`source` 对象按**字段**做三方合并，而不是整个对象：

- **标量与结构字段**（`title`、`description`、`opening`、`when`、`effects`、`timeline.order` 等）：两边都改且结果不同时冲突；只有一边改时采用该边。
- **引用集合字段**按集合合并，各自的增删互不冲突：

| 对象 | 引用集合字段 |
|---|---|
| Scene | `cast`、`beats`、`choices`、`lore`、`items`、`events` |
| Plotline | `scenes`、`beats` |
| Item | `lore` |
| Event | `cast`、`lore` |
| 分组 | `entries`、`groups` |
| 知情 | `start.knows`、`start.not`、每个 `enter.<scene>.knows` |
| Scene 的 `goals` | 以 cast key 为键的映射，每个键按标量合并 |

集合合并规则：设基线为 B、当前为 C、投稿结果为 A。结果集合为 `(C ∪ (A − B)) − (B − A)`。元素顺序：保留 C 中元素的顺序，新增元素按 A 中的顺序追加。只有一边改变了共同元素的相对顺序时采用该边的顺序；两边都改变且结果不同时，在 `<字段>@order` 上冲突，由作者手动选择。

`story` 中各对象列表本身的顺序通过 `story-order` 变更单独表达，同样只有两边都改变且结果不同时冲突。

### 16.3 合并后校验

1. 合并后重新执行全部静态校验。出现悬空引用、类型不符、同一参与者同时在 `knows` 与 `not` 中等错误时，视为冲突，整个 Contribution 不产出结果。
2. 删除被其他对象引用的场次、Beat、变量、分组时，编辑器在投稿前列出所有引用位置。
3. 服务端按版本拒绝不认识新变更类型的旧客户端提交；旧客户端只能看到“包含不支持显示的变更”。
4. 冲突结果不带可写入产物，逐对象报告 `conflict_fields`；静态校验失败附具体diagnostics。当前私有草稿的合并预览与合并后内容只对owner和有效协作者返回，投稿者能看自己的提案，不能从合并结果获知未发布修改。
5. 投稿前及作者审阅时可以在浏览器编译本地提案预览，使用精确发布依赖与真实默认策略，产物标记local-build；不伪装Release、不改目标草稿。参考资料可选择匹配摘要的本地原文件，保留精确字节并只在本地用于选材和组装。接受时服务端仍重新读取当前草稿并检查版本，浏览器预览不能替代接受事务。

## 17. 作者工作流

### 17.1 新建

新建页先问想做什么，再映射到类型与起始层级：

| 作者选择 | 创建的作品 | 起始层级 | 编辑器首先展示 |
|---|---|---|---|
| 一个角色 | Character | L0 | 名字、介绍、开场白、头像 |
| 一个故事或情境 | Scenario | L1 | 选角色 → 第一个场次卡片 |
| 一个世界或设定集 | World 或 Lorebook | L2 | 世界介绍 → 条目列表与分组 |
| 一种文风 | Style | L0 | 风格说明与示例 |
| 玩家身份 | Persona | L0 | 名字与介绍 |
| 高级：Preset / Prompt Module / Relationship | 对应类型 | — | 现有编辑器 |

“一个故事或情境”的路径：选角色（自己的作品、收藏、搜索，或当场新建只有名字和介绍的角色；选中即成为锁定版本的依赖）→ 写第一个场次（时间地点、开场局面、在场人物及每人的 `part` 与 `goal`）→ 可以直接试玩。此时作品已是完整的 L1 作品，可以发布。

模板就是可以 Remix 的普通官方示例作品，不是特殊机制。

### 17.2 Scenario 的“剧情”工作区

Scenario 编辑器以“剧情”工作区为主；现有 Cast、bindings、推荐 Preset 与 assembly 移到“设置”。

```text
┌ 剧情 ───────────────────────────────────────────────┐
│ 视图：[场次] [剧情线] [时间线]           + 场次  + 结局 │
│                                                      │
│ ┌ 停电后的大厅 ─────────┐  ┌ 后门与河边小路 ────────┐ │
│ │ 深夜 · 旅馆大厅       │  │ 进入条件：怀疑 Alice…  │ │
│ │ Alice 旅馆老板 · 保护…│  │ Alice · 住客           │ │
│ │ Bob 调查员 · 查清去向 │  │ 可能的变化：坦白       │ │
│ │ 可能的变化：怀疑、信任│  └────────────────────────┘ │
│ └───────────────────────┘                              │
│ 开局：以住客身份 · 停电那一刻                          │
│ 结局：一起离开 · 真相公开 · 雪停之后                   │
└──────────────────────────────────────────────────────┘
右栏：人物 · 资料 · 物品 · 变量 · 知情（按层级逐步出现）
```

- **场次视图**：卡片内直接编辑 `part`、`goal`、`scene.goals`（数据分两处存，界面合在一起）。
- **剧情线视图**：按剧情线编辑场次与 Beat 的引用顺序，提供可键盘操作的上移/下移按钮，选中项按该线顺序显示。排序只改这一条线的引用，不改对象定义、其他剧情线或时间线；顺序表示预期讲述次序，不强制玩家行动。拖动交互同样遵守此边界。
- **时间线视图**（B）：事件与场次按相对顺序排列，并列的放在同一列。
- **开局卡片**：显示每个开局实际生效的第一条消息及其来源（8.2）。未构建时明确标为作者模板，实际生效消息须来自构建产物与预览输入；多个开局提供各自的标题与说明。
- **层级出现方式**：L2 由“+ 可能的变化”“+ 结局”“+ 剧情线”或给场次关联资料触发；L3 由条件处的“用规则表达”、右栏“变量 / 知情 / 物品”或选择 per-agent 触发。

对象标题和正文可修改，稳定ID不随标题改动。删除前列出仍引用它的对象与作者测试；撤销恢复只影响对应对象/字段，保留其他修改。撤销时若依赖已移除，保留恢复入口并说明缺失项；原本未填完的正文仍可找回后继续编辑。

变量、物品和知情声明在独立的可折叠区域编辑。条件可从自然语言判定逐步展开为全部、任一、否定及类型化状态比较；效果按顺序表达赋值、增减、集合增删与获知信息。开局效果与确认变化后的效果明确区分。变量类型决定允许输入的值，物品集合不与普通字符串集合混淆；删除变量或物品前检查规则、开局、场次及本作品作者测试的引用。公开资料引用可以来自传递依赖，工作区不以当前直接依赖列表代替构建闭包校验。

其他类型：Character 的片段卡片增加 `outward` 开关（仅作品涉及 per-agent 时显示）与 description；World / Lorebook 左侧分组树、右侧条目卡片，条目上有视角、`about` 与出处，上传文件即创建参考资料；Style 的核心说明与示例分开；Preset / Prompt Module 的块改为 `default_at`，新增 `placements` 列表。

World / Lorebook 的资料库在主工作区显示，其他 Creative 类型可从高级条目区展开。分组导航包含全部和未分组；分组成员与嵌套通过现有对象选择，提供键盘可用的操作，并用相同Core规则拒绝环和超过三层的嵌套。过滤分组只改变显示，编辑仍更新原条目。条目被引用时禁止直接改ID或删除；移出分组不删除正文。场次关联资料提供条目、分组、整篇和分节选择，已有外部引用保留，引用解析与可见性仍由构建和上下文契约决定。

条目卡片可编辑本地化description、信息性质和出处；清空当前语言保留其他翻译。开启selectable前必须有说明，开启后若要移除最后一份说明或改激活方式，先显式关闭；outward与私有/场次可见性放在高级视角区域，已有声明自动展开供修正，不静默丢字段。人物片段的outward不能越过private或知情规则。

about提供“涉及”和“被哪些条目涉及”的双向导航，也能按参与者或作品查询。草稿本地链接按稳定对象ID定位，跨分组跳转先显示目标卡片；外部内容由真实构建解析，不把直接依赖下拉当作闭包。移除链接有局部撤销；目标删除、cast换绑或依赖变更后拒绝盲目恢复。导航不改变激活、知情、正文或资产加载。

### 17.3 预览

编辑器先保存当前修改，取得同一次成功保存的定义和整数version，再请求Registry固定Revision并构建；浏览器下载真实草稿产物后运行上下文预览。仅使用作者构造的合成输入，不调用模型。

保存中、构建中、加载产物分别显示进度；可以停止等待，但不会隐式删除已开始的服务端构建。工作内容改变后显示当前预览来自旧编辑，切换账号/作品或取消后的迟到响应不能覆盖新状态。作者assembly_tests通过同一服务端构建执行并返回实际测试回执；测试里的合成历史属于作品定义，不是Runtime聊天记录。资料正文按视角和作者选材通过dbld授权读取，标题和说明可先显示，未选择正文不下载。

资料上传第一层支持UTF-8文本/Markdown整篇资料：先填标题和description，上传处理ready后一次加入Source与context资产。取消停止本次添加，处理中可以续查；移除独占Source同时移除其无其他引用的资产声明并可撤销，不删除共享存储文件。被场次、出处或作者测试引用的资料/分节先解除引用再移除。

分节区编辑稳定ID对应的标题、说明和锚点，出处独立编辑。标题生成先展示候选，再由作者确认追加；保留原分节ID、语言和说明。选择本地原文件时先验证字节摘要与当前资产一致，再用Core共享解析器生成或检查锚点，不凭digest任意下载私有资料。正文替换复用真实上传处理，ready后才原子更新当前Source，保留Source/分节ID并验证全部既有锚点；新资产保留显式许可、评级、alt及其他变体，不沿用旧blob的locator。共享旧资产的其他对象保持原文件。替换可撤销，期间正文、分节或资产槽发生冲突时拒绝覆盖；取消和迟到结果不能绑定到其他账号、作品或已删除资料。


| 输入 | 作用 |
|---|---|
| 视角 | 旁白 / 某个参与者 |
| 剧情状态 | 开局、当前场次、已达成的 Beat、变量值、知情状态；缺省为所选开局的初始状态 |
| 选择 | `fixed` Selector：作者勾选候选内容模拟判定结果 |

面板分三栏：Catalog（`required`、`direct`、`candidates`，以及被隐藏的内容和原因）、选择、最终消息与 Trace。作者检查使用独立诊断视图；其中隐藏对象的身份和原因不进入最终消费 Trace、Selector、Plan或作者测试。公开消费预览默认不开启作者诊断。候选目录展示实际预算与展开深度下暴露的节点，不以Engine内部完整索引代替已展开目录；打开诊断不选择或下载正文。另有条件检查：用参考求值器列出当前状态下场次、Beat、计划事件与结局的条件是否满足，`judge` 由作者手动设为真、假或未确定；未确定不能当作假后取反触发。

本地逻辑预演使用构建产物与参考求值器，可以切换在场者、设置合法的预览变量、进入可用场次及显式确认变化。只有成功确认才执行效果，重复确认被拒绝，停止结局后不可继续推进；建议行动仅列出，不自动执行效果。开局入场采用当时的判定快照，后续修改当前判定不能偷偷重新判定开局。预演状态只影响当前上下文预览，不改作品初值、构建产物或Runtime会话；换构建与重置时清除。条件问题及剧情内容沿用作品评级遮挡。

可选条目先展示说明，作者勾选后通过同一fixed Selector契约进入实际消息；不显示当前视角不能选择的条目。资料/条目选择和关联导航均在评级遮挡内。预览中的相关链接使用catalog_index.about解析后的完整实例身份，仅展示当前视角与已暴露目录内的两端；不可通过链接显示隐藏目标的标题、原引用或反向数量。点击仅在当前产物元数据内定位，不自动展开目录或选择正文。作者主动选材可以按固定Selector允许的路径展开，与仅查看当前已展开目录的链接导航分开。

任意一次预览输入都可以一键保存为作者测试（assembly fixture）。

保存采用同一次成功预览的最终输入和结果：完整TurnView包含实际开局消息、状态、判定、在场者与绑定；选材保存固定引用及顺序，资料保存所需资产的整篇原始UTF-8正文，策略保存实际使用的精确版本。新测试以本次实际消息摘要建立期望，再经服务端草稿构建重跑；重跑不自动更新期望。旧编辑、过期构建、切换账号及未完成/失败的预览不能保存为当前测试，迟到通知不得出现在另一次预览上。

作者须能看到测试将保存并可能公开的完整资料，包括未选章节；保存前按实际`{working}`请求检查5 MiB限制，超限不改当前草稿。测试追加并确认保存后显示新测试ID，后续可检查固定选材/正文并重跑。精确测试策略仍受聚合图同一ref单一Release约束，默认策略更新引起版本冲突时应显式处理，不能暗换测试策略或期望。

### 17.4 试玩

试玩在官方 runtime（或任何支持的 Runtime）中进行，与预览分开：预览看组装结果、可复现；试玩看实际体验、使用真实模型。

1. 编辑器“试玩”按钮对当前草稿发起一次**草稿构建**（第 18.1 节），通过后在 Runtime 中打开该构建。发布检查失败时不能试玩，编辑器显示与正式发布相同的错误。
2. 作者可以选择开局与视角，也可以在 Runtime 的开发者模式中跳到某个场次或设置变量。
3. 作者修改后再次试玩会产生新的构建，Runtime 提示“有新的试玩版本，是否重新开始”。
4. 试玩中发现问题时，可以把当前状态“保存为预览输入”：导出剧情状态与最近几条消息的摘要，不是完整聊天记录；最近消息作为合成历史保存前需要作者确认。

试玩会话属于 Runtime，char.pub 不保存，聊天流量不经过 char.pub。

平台到Runtime的首次启动使用独立的 `char.pub/runtime-launch` v1定位请求，不复用下方的状态回流文件：

```ts
{
  format: "char.pub/runtime-launch"
  version: 1
  registry_origin: string           // 规范HTTPS origin；本地开发可用loopback HTTP
  source: ExactRef | { ref, semantic_digest, origin: DraftBuildOrigin }
  lock_digest: Digest
  locale: string
  start?: string
  view: { mode: "narrator" } | { mode: "per-agent", for_participant: ParticipantKey }
}
```

请求上限16KiB，字段严格校验，不包含Artifact正文、授权凭据、history、bindings或审批标记。平台用用户选择的实际launch URL，通过`#launch=<encodeURIComponent(JSON)>`打开独立页面；没有配置目标时先填写，不把OAuth callback当启动地址，也不声称存在未部署的官方服务。HTTP初次请求不携fragment；打开使用no-referrer与noopener。单个Runtime是否可用及是否已授权仍由该Runtime实际判断，打开链接不等于会话已开始。

Runtime只使用自身受控配置中的Registry、OAuth和模型端点，拒绝与配置不符的`registry_origin`。取得独立授权后按精确Release/dbld读取，并核对root/lock/到期、开局、参与者实例及能力；不得改读latest或重建新dbld替代过期目标。平台选中的视角遵守作品锁定assembly；临时人物绑定由Runtime收集。已有会话时，新版本须明确新建Session，旧会话不重写；多个页面的操作须绑定所显示的会话，不能因为后台当前会话改变而误发到另一个Session。

#### 本地预览输入交接

共享 `RuntimePreviewInput` 是独立于 `AssemblyFixture` 的本地 JSON 文件，`format: "char.pub/runtime-preview"`、`version: 1`，UTF-8 大小上限 1 MiB。`source` 固定完整 `BuildRef`、`lock_digest` 与 `artifact_json_digest`；后者是 `digestExactJSON` 对完整产物快照的摘要，不是 Registry 存储文件的原始字节摘要。另带实际组装 `profile`、产物中使用的精确 `preset` 和 `tokenizer` 名称/版本，不携带模型 API 配置或凭据。

`turn` 白名单为明确的 `locale`、`bindings`、`history`、`scene`、`present`、完整 `story`，以及可选 `for_participant`、`story_guidance`。场次、在场者及变量/知情/达成/停止状态取自已提交剧情；历史和绑定的姓名/描述须由用户主动提供合成内容并审阅，不能直接复制 Runtime 的聊天或角色私密描述。per-agent 视角必须明确选择，不能从最后一次生成准备缓存猜测。完整状态本身也可能包含秘密，用户须检查全文；不愿带出的状态应重新制作合法合成状态，不能删掉部分必需键冒充原快照。`overlay`、`focus`、模型判定、手动激活、Source 正文、Plan、Session 日志及确认标记不在交接白名单中。

Runtime 的本地准备与导出是两步：准备只返回可审阅候选，导出时核对候选精确摘要、同一已提交 head/状态及取消条件；文件不携带 Session 标识或可充当接收方授权的 `reviewed` 标记。有效同快照可重复导出相同字节，这是本地导出，不套用投稿的一次派发语义。pending 请求不能作为已提交状态；导出不写 Session、不调用模型、不自动上传。

创作端只使用已授权取得的当前产物校验交接文件，不根据文件中的引用自动抓取其他版本。原始根身份（含 dbld 的 build_id/revision/expiry）、语义摘要、依赖锁和完整产物 JSON 摘要须匹配；Preset、tokenizer、locale、场次/参与者/变量/知情、必需绑定及 speaker 也须有效。草稿构建过期时不能重新绑定新构建。SDK 的纯校验器不读取资料、不看系统时钟，也不承诺最终 token 预算可满足；Web/Runtime在各自边界检查过期，实际预览加载真实 tokenizer 后组装。

本地选文件先展示来源、完整状态、合成历史、角色绑定及组装设置；只有本次用户确认后才载入。文件读取期间切账号/产物或选择另一文件使旧审阅失效。载入后保持完整快照和实际 profile，不重新初始化开局；普通会话与剧情预演控件收起，退出导入后恢复原预览。可选资料从空选择开始，作者仍可显式选材，授权正文读取沿原规则进行。

载入不保存草稿或测试。匹配当前 dbld 且草稿未变化时，可再单独“保存为作者测试”，展示可能进入作品的完整 Source 正文并由 Registry 新构建重跑。已发布旧版本的输入可以在匹配版本本地预览，但不能静默改成当前草稿的 `root:self`。跨版本状态重映射需要另一个明确的对照/确认操作，本交接流程不猜测或填初值迁移。


### 17.5 发布与分享

- 发布面板增加：自动计算的能力列表与“使用了实验能力”确认；与上一版本的差异按“正文 / description / 结构”分类，并列出删除或改名的对象被哪些依赖作品引用（仅作者可见的统计）。

能力列表来自当前保存快照经实际草稿构建得到的 Artifact，不从编辑器 JSON 猜测。打开发布面板时准备构建；未就绪、构建失败或过期时不能发布，作者可以重新准备。有实验能力时展示实际列表与本次确认，无实验能力时不增加该确认。确认绑定当前账号、草稿内容与构建；发布使用该构建记录的精确 Revision，不在确认后重新读取最新版。改稿、换账号、关闭或过期使旧确认失效；派发前再次核对即时身份与到期状态。此为编辑器行为，不新增通用 API 审批字段，服务端仍执行原有权限与发布检查。

差异比较完整作者定义：以本次构建对应的保存快照，对照明确选定的已发布版本，而非只比较IR或当前最新版。正文、description与结构分别显示对象和字段；Source正文替换以精确资产摘要表示，不为比较下载整篇资料。首次发布明确无基线；旧版本加载失败或身份不匹配时不能把差异显示为空。作品改址不改变历史发布身份，比较时核对同Creation及精确Release/语义摘要。

对象引用影响接口是作者诊断，要求`creation.read_draft`，不随Runtime的`read_build`权限开放。删除ID与增加ID分别记录，不猜测改名映射。报告只扫描当前作者可读的已发布依赖版本，分页和结果均不含无权读取的下游身份、数量或游标；中间定义的引用来源也独立检查读取权限。报告区分“发布产物实际包含”与“作者字段明确引用”，不扫描自然语言正文，不把闭包索引当使用证据。`included`不代表进入了某轮模型上下文；未发现静态引用也不证明Runtime无影响。旧版本的精确锁不因新发布改变，影响用于评估升级；扫描或依赖快照失败明确报错，不伪装为无影响。

- 作品页与分享卡片提供“开始游玩”，打开官方 runtime（或用户选择的已授权 Runtime）；有多个开局时先选开局。作品页显示所需能力、许可、分级与是否允许改编；许可、分级和内容提示沿依赖闭包汇总展示。

### 17.6 投稿、Remix 与续作

- **投稿**表单嵌入剧情工作区的只读视图：投稿者看到完整作品结构，在上面新增或修改对象，提交前可以预览。作者审阅时按对象显示差异，新结局、新 Beat 以卡片显示，可以直接在预览中试。
- **Remix** 复制作品完整定义到自己的 namespace，记录 `derived_from`（relation `remix`），依赖仍锁定原版本。许可不允许改编时不显示入口，只显示“投稿给作者”。保留原作者署名并追加新作者；依赖的相对地址按原 namespace 固定，自身资料引用指向新作品。作者测试保留原预期，须在新作品中重跑与审阅，不自动接受新的结果。
- **写续作**新建 Scenario，把原作品作为来源依赖，自动带入 cast、背景资料和精确内容依赖；作者选择“从原作哪个结局之后开始”时，编辑器按该结局的 `effects` 预填 `starts.set`，作者可以修改。复制变量、物品声明和静态初值、知情的 `start`；不执行结局条件，也不推断旧开局效果、场次进入效果或玩家进度。新剧情使用独立开局，不继承旧 Beat、结局、时间线、开场白或作者测试。新场次不自动把全部背景声明为直接关联资料，背景继续按原激活方式与渐进目录选材。背景资料与 Style 的场次限制保持；仍被它们引用的旧场次仅保留 ID/标题作为可编辑空场次，不把资料默认放宽到新开局。

#### 精确来源依赖与平台派生入口

`provenance.derived_from` 的每条精确来源为 `{ ref, release, semantic_digest, relation }`，relation 可以是 `remix`、`sequel`、`fork` 或 `import`。只有成对提供 ref 与 semantic_digest 才表示依赖；仅有 release 的历史导入备注仍是展示信息，不能用来授权读取、构建或来源约束，`sequel` 必须有完整精确身份。新 Remix/续作始终产生精确来源。

来源依赖参与聚合锁、可见性、下架、评级、许可与署名检查，但不展开进 Creative IR、Catalog 或模型消息，不再次生成前作角色。来源历史版本与实际内容版本分开验证：保留原作旧依赖的同时，新作品可以升级自己的同 ref 依赖；实际内容、策略及测试图仍拒绝双版本冲突，每份来源历史图也独立校验，不能用历史依赖替代实际输入。新作品复制的角色属于自己的实例；源版本中的剧情不作为运行状态。仅由来源依赖可达的资产不成为新产物下载项，资产的原许可与评级仍约束派生作品。直接内容依赖、Preset 与作者测试按原有各自语义参与构建。来源许可按改编检查，不能改新根许可来绕过前作的禁止改编条款。

`POST /v1/namespaces/:slug/derivations` 接收精确 source、kind、name、display_name、可选 ending 或 from_play、可选 agent 与明确 `rights_ack.inbound_equals_outbound: true`。服务端从已授权的 active Release 读取定义并准备新私有草稿，不接受客户端替代整份作品正文；只在本人个人 namespace 创建，默认进入普通编辑器继续修改。OAuth 使用 drafts:write，读取私有来源还须 creations:read 与用户本身的作品权。已下架或不可读、身份不符、禁止改编的根来源拒绝，新作品不会自动发布。根定义按改编检查，逐字节复制的根资产按再分发检查；未修改的依赖不被一律当作改编，仍按实际覆盖操作与精确版本检查自身许可。

`from_play` 仅用于 `kind: sequel`，与 `ending` 互斥，字段严格限定为 `{ scene, present, vars, knowing, opening }`。标识均按精确源作品的作者定义解释，变量与受控知情必须完整且类型合法；服务端还校验实际来源 Artifact 的 ref、Release 和语义摘要。该请求表达作者确认的新起点，不承担完整产物、聊天或 Session 的重放。

新开局保留当前 scene 的 ID、标题、时间、地点与资料/物品关联，cast 取 present，opening 取明确整理的文本；变量写入 `vars.*.init`，全部受控信息写入 `knowing.*.start.knows`。删除旧场次条件、目标、剧情对象关联以及 knowing.enter；唯一新 start 没有旧 set、reached 或 greeting。旧 Beat、Choice、Event、Ending、Plotline、Timeline、bootstrap 与作者测试不继承；其他仍被背景或 Style 引用的场次保留空场次作用域。新故事只访问开局场次，其余进度为空，允许作者继续写作。该操作不能称为保留旧剧情的无损续存，Remix 暂不接受 from_play。

`agent: true` 或 agent PAT 追加 agent 辅助标记，省略或 false 不抹去来源已有的标记；OAuth 身份本身不等于 agent。编辑器只读显示精确派生来源和已有 agent 标记，普通编辑不自动清除历史事实，也不额外阻止原有发布操作。

平台持久记录已核验的精确来源。PUT、创建 Revision、草稿构建和发布 worker 都要求保留该来源，不能从草稿删除来源来绕过原许可或私有依赖检查。只将新作品实际复制、且原发布产物根确实声明的 mirrored 资产授予新作品；原作者的其他上传和同 namespace 的作品不因此获得授权。原顶层 client_id 不冒称本次派生应用，OAuth 创建时由服务端记录当前真实 client_id；历史贡献者来源保留。

### 17.7 共同创作

作品级协作者：owner 给单部作品添加协作者。

| 操作 | owner | 协作者 |
|---|---|---|
| 编辑草稿、草稿构建与试玩、审阅投稿 | ✓ | ✓ |
| 正式发布、改可见性、改许可与分级、管理协作者、删除作品 | ✓ | — |

- 并发编辑沿用草稿版本冲突检查（If-Match / 409），v1 不做实时协同；冲突时按对象查看差异后重新应用。

编辑器发生409时暂停自动保存，保留包括请求期间继续输入在内的全部本地修改。作者可读取最新草稿，并按“最后成功保存的基线／本地修改／服务器最新版本”查看对象差异。片段、依赖、资产槽、角色、分组、Source和Story对象按稳定ID定位；无有效唯一ID的半成品集合整组比较，不猜测身份。双方修改同一对象且结果不同，须明确选本地或最新版本；对象内部不自动做文本合并，界面说明选择本地将替换整个对象。未在本地修改的对象保留服务器版本，独立对象增删不误判成顺序冲突，真正的共同对象顺序冲突单独选择。

此过程是本地未完成草稿的恢复，不借用Contribution的可信Revision或canonical转换。保留未知字段以及作者测试/资料输入的精确字符串；作品id/ref/type继续取服务器。比较不写入，确认后仅以比较时的服务器version执行普通PUT，服务端授权与完整检查照常生效。期间再出现409，保留本次选择后的内容并以刚才的服务器快照为新基线重做比较；422保留可编辑结果与诊断，撤权保留本地内容供复制。账号切换、离页、重新比较或明确丢弃使旧比较失效；读取失败不丢稿，不自动重试覆盖。
- 协作者的修改记入 Revision，在 Release 的 contributors 中署名，与 authors 分开。
- 协作者加入时确认贡献按作品许可授权，与投稿规则一致。邀请针对另一位个人 namespace 的 owner；只有已接受且确认许可仍与当前草稿一致时才有作品权限。许可改变后需重新确认；同许可重复邀请不清除已有同意，过期许可邀请由 owner 更新。
- 协作授权是单作品关系，不继承个人 namespace 的 maintainer 权限。system namespace 的平台维护权限独立保留。私有草稿、构建、Source、版本和投稿列表逐项检查作品权限及 Token 的 read scope；“父作品公开”不代表其私有投稿公开。
- 协作者只能修改普通创作内容；authors/provenance、许可、权利、评级、内容警告、贡献开放度及显式资产许可/评级由 owner 维护。直接写草稿与接受投稿使用相同约束，不能通过投稿绕过。
- 接受邀请、撤销授权、写草稿与构建在同一作品权限锁下重新检查；异步构建执行时也重新确认请求者权限。撤权后新读取和写入拒绝，已签发下载地址仍遵循原短期有效期；不删除合法共享资产或历史署名。
- 资产共享只涵盖实际绑定到该作品、来源可授权的已完成上传；不共享协作者的全部上传历史，也不授权同 namespace 的其他作品。Revision 固定实际参与编辑者的公开 namespace 署名，Registry Release 元数据暴露 contributors，与版权 authors 分开；撤权或登录名变化不重写旧版本。
- 编辑器按服务端返回的作品能力显示操作；协作者可以编辑、构建和审阅，发布及敏感设置交给 owner。保存因权限变化失败时停止自动重试，保留本地未保存稿供复制；重新进入须重新验证私有读取权限。
- 组织 namespace 不在 v1 范围。

### 17.8 游玩沉淀为创作

玩家在 Runtime 中可以选择“保存为创作”：

1. 选择去向：给原作者投稿（新结局、新 Beat 或新场次），或写成自己的续作 / Remix（许可允许时）。
2. Runtime 在本地整理草稿：把最近的剧情概括成对象，以当前场次、变量和知情状态作为开局。聊天记录本身不上传。
3. Runtime 通过 OAuth（`drafts:write` 或 `contributions:write`）提交已确认的派生起点或对象变更；平台从可信来源构造草稿或投稿。模型参与时记录 agent 标记，玩家在编辑器中修改后再提交或发布。
4. 模型生成的文字需要玩家确认贡献权利，Contribution 标记 agent 参与；分级与内容提示从原作继承，发布时照常检查。

投稿以实际游玩版本的精确 Release 为基线，通过其发布源取得不可变 Revision 与作者定义；不得用最新版本或 IR 反构替代。作品改名后，读取/投稿使用平台回执中的当前地址，原定义与摘要继续保留原身份。

Runtime 在本地展示完整的待提交对象、目标作品/版本、标题及权利声明，确认绑定本次候选、已提交剧情状态和当前授权身份。模型生成候选、Story 中确认结局和用户确认投稿是不同操作。提交前重新核对时，候选、基线、授权身份或所依据的剧情状态已经变化的，需要重新审阅；未完成的模型请求不能当作已完成剧情。核对通过后提案持续绑定已确认的历史快照，不在网络请求期间锁住游玩Session；后续游玩不能暗改该提案，授权身份仍在实际写入派发前复核。传输仅含投稿接口所需的对象变更，不自动上传 Session、聊天历史、Source 正文或决策日志；候选正文自身也须由用户检查后确认。

一次确认至多派发一次写入。发送前取消不写入；发送后超时、断线或响应无法确认时明确表示结果未知，不自动刷新后重发，也不把取消解释为远端未收到。成功只表示创建待审阅投稿，不表示原作者接受、草稿改变或正式发布。权利确认沿用平台现有授权语义：界面展示的原版本许可不是当前草稿许可的固定前置条件，服务端仍在提交和接受时检查适用许可。


### 17.9 agent 辅助

agent 只做起草，所有结果经作者确认才写入草稿，agent 不能发布：

| 场景 | 起草内容 |
|---|---|
| 缺少必填 description | Beat、结局、变量、分组、参考资料的 description |
| 长资料上传 | 按标题生成分节与分节 description |
| 一句话条件 | 对应的规则版本 |
| per-agent 提示 | 把人物介绍拆成外在描述与内心设定 |
| 游玩沉淀 | 场次、Beat、结局的草稿 |

agent 起草的内容在草稿中标注来源；作者编辑或确认不会自动清除历史来源和 agent 参与记录。模型调用发生在 Runtime 或作者选择的服务中，不经过 char.pub 后端，char.pub 不保存模型凭据。

未发布或尚未完整的工作稿也可使用本地候选交接：作者选择任务、目标对象和上下文，审阅完整请求后下载文件，在外部服务生成候选，再导入或粘贴候选。请求只包含所选对象和明确提供的上下文，不默认导出整份工作稿。资料分节由作者选择本地原文件，校验实际字节的摘要、大小、类型和锚点，不自动下载其他私有资料。

请求绑定作品、完整工作稿的精确摘要、目标及任务输入，并附任务专属响应 schema；候选必须对应保留的请求。候选不能提供通用写入路径、可执行指令或自称批准的字段。Review 展示完整修改和诊断但不写稿；Apply 是独立作者动作，通过普通草稿保存与 `If-Match` 写入。工作稿、账号或候选变化后旧审阅失效。半成品可逐项修正，但不能绕过服务端校验。

人物拆分保留原片段 ID、语言和私有元数据；新外在片段默认保持原受众限制，作者明确选择 shared 才扩大受众，不能复制私有说明到外在片段。新增 Beat 必须明确关联场次。撤销只恢复本次修改，保留后来无关编辑及 agent 历史；目标已被修改或删除会造成新悬空引用时拒绝覆盖。

接受带agent标记的投稿时，服务端根据已保存的投稿记录把草稿`authored_by_agent`置为true；普通人工投稿不制造该标记。普通草稿保存不得删除或改为false，违规则明确拒绝并保留原稿及版本，不在后台悄悄修改请求。真实OAuth `client_id`与贡献者引用独立保留。明确标为agent的PAT即使有`releases:publish` scope也不能发布；OAuth客户端沿原授权动作白名单同样没有发布能力。最终发布由有发布权限的作者另行执行。

有普通编辑权限的协作者可单向声明 `authored_by_agent: true`，以保存经本人确认的辅助结果；这不授予修改其他来源字段的权限，也不证明平台验证过模型或服务身份。

## 18. 草稿构建与 Runtime 授权

### 18.1 草稿构建

草稿构建是对某个草稿 Revision 的完整构建，用于试玩，不是 Release。

| 属性 | 规则 |
|---|---|
| 创建 | `POST /v1/creations/@ns/name/draft-builds`，`If-Match` 校验当前草稿整数 version；服务端原子固定不可变 Revision 并返回其 ID。owner 与协作者可创建 |
| 检查 | 与正式发布完全相同：schema、闭包与 pin、资产、许可、黑名单；异步执行，结果可轮询 |
| 产物 | 与 Release 产物同格式，`root.origin` 为 `{ kind: "draft-build", build_id, revision, expires_at }`，根没有 label 与 Release ID |
| 身份 | 在同作品、Revision、精确策略和 builder 契约内按 `semantic_digest + lock_digest` 复用有效结果；授权与资产当前状态不能因缓存而跳过 |
| 可见性 | 不可被依赖、不可搜索、不出现在版本列表；只对 owner、协作者及其授权的 OAuth 客户端可读 |
| 访问 | 产物与资产通过短期签名地址下载（15 分钟）；私有桶存储 |
| 过期 | 缺省 7 天后删除 payload；owner 可以手动提前删除 |
| 限额 | 每部作品同时保留的构建数与每小时创建数有上限，具体值随运营配置 |

草稿构建不改变 Release 的不可变与三态生命周期：没有“删除 Release”的操作，也不会为试玩占用版本号空间。

身份细则：Release 根仍为 `{ ref, release, semantic_digest }`；草稿根为 `{ ref, semantic_digest, origin }`，二者严格互斥。`build_id` 使用 `dbld_` TypeID，`revision` 使用 `rev_`，`expires_at` 为明确的 UTC 时间；Core 不读时钟，生命周期由 Registry 执行。根片段/资产来源、IR 根节点、草稿 Preset/Prompt Module 及其块来源同样保留此 `origin`，不能在内部填充临时 Release ID。属于已发布依赖的来源继续携带真实 `release`。

`ExactRef`、Reference/Module pin、依赖 lock、锁定 assembly/default policy 仍只允许已发布 Release。草稿 Preset 可以作为作者预览显式传入的策略，Trace 与 CCv3 扩展保留其草稿来源；不能把它作为发布依赖或默认策略。已发布资源读取与依赖选择器须拒绝根或嵌套来源中的草稿标识，不能只检查顶层。

Core 的 `checkDraftBuild` 与 `checkPublish` 共用 schema、依赖 pin/闭包、资产状态、许可和黑名单检查。前者不接收 Release/label，也没有发布幂等语义；构建复用由独立任务生命周期处理。服务端仍须补齐依赖授权、资料正文/锚点及作者测试，不以纯 Core 检查代替完整构建。

Registry 路径：

- `GET /v1/draft-builds/:build`：轮询 `pending / ready / failed / expired / deleted`、真实 origin、草稿 version、摘要与检查报告。
- `GET /v1/draft-builds/:build/artifact`：重新验证权限和当前状态后，302 到专属私有产物的签名地址。
- `GET /v1/draft-builds/:build/source-text?source=<完整 Source ID>`：从可信产物定位并核验正文，不接受客户端 digest。
- `GET /v1/draft-builds/:build/assets?asset=<完整 asset ID>`：只为可信产物内的 mirrored 资产签名。
- `DELETE /v1/draft-builds/:build`：仅 owner，先提交不可访问状态，再删除专属 payload；存储失败返回 202，由清理任务重试。

构建请求在同一数据库事务中锁定草稿 version、固定 Revision、插入构建记录并入队。默认 Preset 只在请求时确定，重试不读取新的全局默认。构建、缓存复用、签发下载与删除共享构建记录锁，避免删除后凭旧 ready 状态继续签发。worker 在执行时重新检查请求者当前权限与封禁；read_only 时推迟，恢复后重投入队。临时错误按队列重试，最终失败必须写终态报告。

产物放在 build 专属的 private 路径，七天到期后清理该路径及详细报告；Revision 与共享上传/依赖资产不因草稿过期而删除。签名有效期为 `min(15 分钟, 剩余构建寿命)`，对象响应也为 `private, no-store`。删除专属产物后旧产物地址失效；已经签发的共享资产地址可能在剩余短期 TTL 内继续有效，不能为撤销它而删除他人正在使用的共享字节。读取接口始终重新授权；不把签名 URL 当长期身份。

默认每部作品保留 20 个有效构建、每小时最多新建 60 个，通过 `DRAFT_BUILD_MAX_RETAINED` / `DRAFT_BUILD_MAX_PER_HOUR` 配置。复用不产生新构建配额，但不会绕过当前授权和内容检查。身份收据可保留用于错误追踪，过期不等于删除作者的 Revision 历史。

#### 18.1.1 本地离线构建

CLI `build / preview / test` 保持离线工作，不为本地文件创建 Registry Revision 或任务。它们使用第三种明确来源：`origin: { kind: "local-build", input_digest }`，没有 Release、`dbld`、Revision 或 expiry。来源不是读取权限，也不能作为 dependency pin 或 Registry 下载凭据。

`input_digest` 采用 `char.pub/local-input/v1` 域，绑定完整 canonical 根定义、按真实 Release 排序的全部提供依赖快照（含语义摘要、可见性、状态和原因）、精确默认策略、公共资产 URL 配置与 Resolver 身份。规范等价依赖去重，真实冲突拒绝；构建与摘要使用同一份规范化输入。文件路径、运行时间、机器身份和fixture运行参数不进入摘要；未被闭包使用但明确提供的依赖仍是输入的一部分。URL等配置按原始JSON字节语义参与摘要，不进行正文的文本归一化。

Core `createLocalBuildInput` 提供上述纯输入准备，普通 `buildCreation` 对本地根重新核验摘要；完整产物另有独立Artifact摘要。输入摘要不能证明Registry检查通过，也不等于产物摘要。根/片段/资产/图节点、显式本地Preset及其块、Trace与CCv3扩展都保留local-build来源；依赖、默认策略与锁定assembly仍只有真实发布身份。

Trace.ir保留root作品地址，并必须带semantic_digest、lock_digest及真实release或origin，使只有开场白而没有片段的预览也能追溯到完整根来源。本地资料正文通过CLI的`--source-texts`显式提供并按资产原字节摘要校验；网页不能把local-build映射成草稿正文请求。Registry的草稿校验/收据只接受draft-build，发布读取只接受完整发布来源。

### 18.2 OAuth 授权

char.pub 作为 OAuth 2.1 授权服务器，让 Runtime 代表用户访问受保护的资源。官方 runtime 与第三方 Runtime 都是普通注册客户端，使用同一流程、同一组 scope，没有预置特权。

| 项 | 规则 |
|---|---|
| 流程 | Authorization Code + PKCE（S256 必须）；支持公开客户端 |
| 客户端注册 | 开发者在设置页手动注册，精确匹配 redirect URI；动态注册不在 v1 |
| 元数据 | `/.well-known/oauth-authorization-server` 与 `/.well-known/oauth-authorization-server/v1/auth`；issuer 为 API 的 `/v1/auth` |
| access token | opaque token，1 小时；显式申请 `offline_access` 才获得 30 天 refresh token，逐次轮换，重放使同族失效 |
| 权限上限 | token 的能力不超过用户自身权限，也不超过所授予的 scope |

Scope：

| scope | 允许 |
|---|---|
| `profile` | `GET /v1/profile`，只返回公开用户 ID 与个人 namespace，不返回登录姓名、邮箱、设置 |
| `creations:read` | 读取用户有权访问的私有 Release 与草稿构建 |
| `drafts:write` | 在用户自己的 namespace 创建新作品草稿或 Remix 草稿，不能修改已有草稿、不能发布 |
| `contributions:write` | 以用户身份提交 Contribution |

v1 没有发布、修改可见性、许可或分级的 scope：这些操作只能由用户在 char.pub Web 或 CLI 中完成。通过 OAuth 创建的草稿与 Contribution 在来源中记录 `client_id`。

`offline_access` 只表示用户允许离线续期，不增加资源能力。授权页明确显示应用、精确回调地址与每项权限；设置页管理自己注册的公开客户端与已授权应用。注册、授权决定与撤销管理必须使用用户会话。redirect URI 只接受精确 HTTPS 或显式注册的 HTTP loopback 地址，无通配符、任意端口匹配、fragment 或 URL 凭据。协议端点使用元数据所公布的地址；公开客户端无 secret。

`drafts:write` 的 `POST /v1/namespaces/:slug/creations` 可带完整初始 `working`，服务端执行 canonical/check，强制 identity、公开 namespace 作者署名和真实 `provenance.client_id`。新内容的初始许可和分级是新作品定义的一部分；它不赋予修改既有作品的能力。`contributions:write` 的应用身份由服务端记录，接受后进入 `provenance.contributors[].client_id`，删除客户端不抹去历史来源。来源字段是描述，不是访问凭证。

`creations:read` 可读取当前用户拥有或获有效单作品协作权的既有草稿构建收据、产物及其实际声明的 Source；不能读取可变原始草稿，也不能创建或删除构建。公开内容继续按公共读取规则访问。Bearer 身份优先且与 Cookie 隔离：未知/失效 Bearer 返回 401，不退回已登录会话；OAuth 有明确动作上限，即使出现其它 scope 也不能扩权。跨站 token/revoke 表单和 Bearer API 使用无 Cookie 的 CORS，普通会话写入仍执行可信 Origin 校验。

撤销授权或删除客户端使 access、refresh、consent 和尚未兑换的授权码失效。同一客户端的授权码兑换、轮换和撤销通过数据库事务锁串行，防止并发重复签发或撤销后复活。撤销不承诺回收已经下载的内容或让既有短期签名 URL 瞬间失效。

后台草稿构建保留 PAT 的行 ID 和请求时 scope 快照，不保存明文凭据；worker 执行时重查撤销、过期、封禁和作品权限，只使用当前 scope 与快照的交集。创建构建需同时具备读写权限，不同凭证不复用同一排队任务。无法证明旧任务凭证来源的临时构建过期后重新构建，不恢复成完整会话权限。

当前实现采用 Better Auth 的官方 OAuth Provider 插件；未开放 OIDC `openid`、email、ID token、userinfo、动态注册或 client credentials。“Sign in with char.pub”的 OIDC 仍是独立待验事项，不能将本节 OAuth 授权验收当作登录能力完成。

### 18.3 独立消费者与精确内容读取

独立 Runtime 通过公开 HTTP 契约获取内容，使用发布的 SDK 包执行纯语义；不能导入 char.pub 仓库源码或直接访问 Registry 数据库。官方 Harness 与其他客户端适用相同的权限和校验。

- `GET /v1/releases/:release` 返回现有 Release 详情结构；`GET /v1/releases/:release/artifact` 返回对应产物。两者按稳定 Release ID 定位，重新检查当前作品权限和版本状态，不要求先由版本标签反查。无权访问私有版本返回 404，tombstoned 返回 410；yanked 沿用已有读取警告，消费者明确决定是否接受。
- 详情中的 `ref` 是作品当前地址；不可变产物中的 `root.ref` 是发布时地址。改名后不能以当前地址替换旧产物的身份。消费精确 pin 时核对 Release ID、semantic digest 与产物根身份，并以详情中的 artifact digest 核验下载的原始字节。
- 草稿消费者核对 ready 收据的 build ID、origin、到期时间、semantic digest、lock digest 和 artifact digest；签名 URL 只是本次下载地址。缺少可验证摘要的旧产物不能由客户端自行补出可信收据。
- Source 仅按 SDK `sourceRequests` 的结果读取，校验来源、asset ID、摘要及原始 UTF-8 文本，不因目录可发现就下载全部正文，不将 BOM、CRLF、NFD 或尾空白归一化。

OAuth 凭据属于客户端连接状态，不能写进 Story、PreparedContext、Session 事件、Replay 或模型消息。下载产物发生重定向时，后续存储请求不携带 Registry Bearer；网络请求须有大小、超时和取消边界。轮换 refresh 不可盲目重试；撤销、失效或处置后，迟到响应不能恢复授权。客户端只在用户明确确认后创建新草稿、派生或提交 Contribution，沿用本节 scope 上限。

跨仓验收可使用独立测试进程承接真实 loopback 回调，令牌只在该进程内存中。浏览器负责注册与同意授权；测试固定模型提供方用于证明公开读取、上下文准备和真实会话持久化连通，不代表在线模型质量或产品游玩界面已经验收。

本地跨仓验收使用 `E2E_HARNESS_ROOT=/path/to/char-harness pnpm e2e:harness`，外部仓需先构建 runtime 包与测试桥。普通 `pnpm e2e:fullstack` 独立验证平台，不要求存在外部 checkout；跨仓用例有自己的配置，缺少前置条件明确失败，不通过静默跳过来计为验收成功。

## 19. 兼容与演进

### 19.1 无用户阶段的统一升级

D-175 取代旧字节兼容要求。迁移 Canonical、产物、策略、客户端、示例和 fixture 到一套一致的新契约；允许删除旧路径。先保存现有测试结果用来发现无关回归，语义变化则按新版规范更新有针对性的测试，不以保持旧字节阻挡设计。

### 19.2 仍需保持的不变量

- 已有未提交工作保留，内容与许可/来源不静默丢失。
- 内容摘要核对真实语义，发布引用精确锁定，不接受陈旧 pin。
- Core 无 IO；条件、视角、固定选择与组装可确定性重放。
- 私有/协作/OAuth 权限在服务端验证，不能由 UI 或引用闭包绕过。
- 仓库示例/导出/schema/SDK/CLI/Action 跟随升级；能力不足和有损导出明确报告。
- production 清理、部署、公开发布和人工接受规范 expected 仍按授权边界执行。

### 19.3 CCv3 导出

| 新结构 | 导出方式 | Loss Report |
|---|---|---|
| Scene、Beat、Ending、Plotline | 第一个开局场次的 `opening` 与在场人物的 `part`/`goal` 写入 scenario 文本；其余丢弃 | 列出丢弃的场次、Beat、结局 |
| `starts` | 按8.2解析各开局实际 greeting；第一个导出为默认问候语，其余写入 alternate greetings | 开局的 `set`、`reached` 丢弃 |
| 分组与 description | 丢弃分组；条目保留 | 列出丢弃的分组 |
| 参考资料 | 不导出正文 | 列出资料 |
| `perspective` | 标注写进条目正文 | 记录已转为正文 |
| `knowing`、`outward`、per-agent 规则 | 丢弃 | 列出受影响的信息与人物 |
| 变量、条件、效果、Item、Event、Timeline | 丢弃 | 逐项列出 |
| Style 作用范围 | 全部 Style 叠加 | 记录范围丢失 |

导出 SDK `exportCCv3` 接受完整 CreationArtifact，使用显式覆盖或产物锁定的 assembly/default_policy；仅传 IR 的旧入口不再接受。`locale` 可选择导出语言，缺省作品默认语言。Registry 导出任务读取同一完整产物，缓存同时绑定根Release、输出桶、内容/锁摘要、导出器版本、语言和显式策略；`?locale=<语言标签>` 无效时返回 400。Scene opening 只映射到 scenario 文本，不能替代玩家首条问候语。无消息的开局保留空位置，不能把后面的问候语提升为默认。

### 19.4 实施顺序

1. 按执行包补齐规范并保存现有工程验证证据，采用19.1的统一升级。
2. A 批：schema 与校验、`"1-draft"` 产物、`viewOf`、Catalog、Preset `"1-draft"`、参考 Selector、预览、草稿构建、OAuth、Contribution 扩展、编辑器。
3. B 批：参考求值器、fixture、条件构建器与预览中的条件检查，标为 experimental。
4. 官方 runtime 接入并通过 fixture 后，按 2.1 冻结 B 批。

## 20. 完整示例：雨夜旅馆

```yaml
type: scenario
ref: "@djj/rainy-inn"
display_name: 雨夜旅馆
summary: 暴风雪封路的旅馆里，一名旅客昨夜消失了
description: 多角色悬疑情境：老板 Alice、调查员 Bob 与被困的住客，围绕昨夜离开的旅客展开
references:
  - { id: alice, use: "@djj/alice", mode: intrinsic }
  - { id: bob, use: "@djj/bob", mode: intrinsic }
  - { id: lore, use: "@djj/inn-lore", mode: intrinsic }
  - { id: city, use: "@djj/port-city", mode: intrinsic }
  - { id: noir, use: "@djj/restrained-noir", mode: default, scope: narration }
  - { id: wry, use: "@lin/wry-voice", mode: default, scope: { cast: alice } }
cast:
  - { key: alice, who: "@djj/alice", role: lead, part: 旅馆老板, goal: 保护昨夜离开的旅客 }
  - { key: bob, who: "@djj/bob", role: support, part: 调查员, goal: 查清旅客去向 }
  - { key: guest, who: { late: persona }, role: user, part: 被困的住客 }
fragments:
  - id: secret-helped
    stable: true
    kind: knowledge
    content: { type: text, text: "昨夜十一点半，Alice 从后门把旅客送到河边。" }
bootstrap:
  greetings:
    - { id: blackout, text: "灯灭了。大厅里只剩下壁炉的光。" }
story:
  version: 1
  scenes:
    - id: lobby
      title: 停电后的大厅
      time: 深夜，停电后
      where: 旅馆大厅
      place: "@djj/inn-lore#lobby"
      opening: "灯灭的一瞬间，前台的铃响了一下。{{cast:bob}} 举起手电……"
      goals: { bob: 让每个人交代昨夜十一点后的行踪 }
      beats: [doubt, first-trust]
      lore: ["@djj/inn-lore#back-door"]
    - id: back-door
      title: 后门与河边小路
      cast: [alice, guest]
      beats: [confession]
      when: { reached: beat/doubt }                      # experimental
  beats:
    - { id: doubt, title: 证词矛盾, description: 玩家注意到 Alice 与 Bob 对十一点后的说法对不上, strength: suggested }
    - { id: first-trust, title: 初步信任, description: Alice 对玩家放下一点戒备, strength: suggested,
        effects: [{ add: [var/trust, 20] }] }            # effects 为 experimental
    - { id: confession, title: 坦白, description: Alice 承认昨夜帮旅客从后门离开, reveal: on-reach,
        when: { cmp: [var/trust, ">=", 60] },
        effects: [{ learn: { who: guest, info: "#secret-helped" } }] }
  plotlines:
    - { id: missing-guest, title: 追查失踪者, scenes: [lobby, back-door] }
  endings:
    - { id: escape-together, title: 一起离开, description: Alice 带玩家从河边离开, priority: 2,
        when: { all: [{ reached: beat/confession }, { judge: 玩家承诺替旅客保密 }] } }
    - { id: open, title: 雪停之后, description: 暴风雪停下，每个人带着各自的秘密离开, strength: suggested }
  starts:
    - { id: guest, title: 以住客身份, description: 你是被困在旅馆的住客, scene: lobby,
        greeting: "你推开门，一阵冷风卷进大厅。" }
    - { id: storm, title: 停电那一刻, description: 从灯灭的瞬间开始, scene: lobby, greeting: { ref: blackout } }
  vars:                                                  # experimental
    trust: { type: int, init: 0, min: 0, max: 100, description: 玩家与 Alice 之间的信任 }
  knowing:                                               # experimental
    "#secret-helped": { start: { knows: [alice], not: [bob, guest] } }
```

为 Bob 准备 per-agent 上下文、当前在 `lobby` 时：`#secret-helped` 因 Bob 不知道而 `withheld`；Alice 的 `goal` 与 `confession` 的 description 被 `excluded`；Alice 只有标 `outward` 的片段可见；三位参与者的 `part`、Bob 的 `goal` 与 `goals.bob`、场次开局局面进入 `required`；`back-door` 条目与 `lobby` 地点条目进入 `direct`；`@djj/port-city` 的手册未标 shared，`withheld`。更多案例见归档的案例检验稿。

## 21. 未决项

| 事项 | 当前处理 |
|---|---|
| 场次、Beat 是否需要独立发布的“场次包” | 先通过 Remix 或复制实现，等真实需求出现再评审 |
| 跨作品引用剧情对象（续作条件引用前作 Beat） | v1 不支持 |
| 同一依赖图中同一 Creation 只允许一个 Release | 实际内容、策略与测试各自的依赖域保持单版本；各份来源历史图独立校验，聚合来源锁可保留旧版本（见17.6）。多角色变体用参与者 override 配套，按实例评审 |
| 作者提供的简版正文 | SelectionPlan 的 `form` 预留扩展，v1 不支持 |
| 判定提供方（如 Jev）的阈值与回退校准 | 用项目样本评估后再定，不作为规范默认值 |
| OIDC 登录的实现方式 | 依赖认证库能力核实 |
| 草稿构建的限额具体值 | 随运营配置 |
