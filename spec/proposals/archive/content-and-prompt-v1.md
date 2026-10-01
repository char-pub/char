# 资料与 Prompt 组织 v1：第二轮收敛稿

> **Superseded（2026-09-30）**：本文是讨论过程记录，现行规则以 [Char Story v1-draft](../../story-v1.md) 与 [DECISIONS](../../../DECISIONS.md) D-162 至 D-174 为准。文中“已确认”的取舍已按统一规范修订，二者冲突时以统一规范为准。

日期：2026-09-26。状态：**讨论稿 / Proposed**，不修改现行 schema 与规范。

本文是阶段 3 的第二轮，接在[剧情结构 v1](story-structure-v1.md)之后。第一轮定了 Scenario 中的 `story` 块；本轮收敛剧情之外、所有作品都会用到的部分：

1. description 的具体位置（Q2 的落地）；
2. 资料分组；
3. Knowledge Source（参考资料）；
4. 信息视角 `perspective` 与 `about` 关联；
5. 地点是否做成对象；
6. Style 的作用范围与组合；
7. Preset 新版本策略契约：模块装配、新区域与选材要求。

字段属性沿用第一轮的写法：必填、层级（L0–L3）、编辑器入口、校验。所有新字段计入 `semantic_digest`。

## 1. description 的位置

Q2 已确认：Fragment、分组和作品三级都可以带 description，与激活方式解耦，计入 digest。

| 层级 | 字段 | 必填 | 说明 |
|---|---|---|---|
| 作品 | `Creation.description` | 否 | 用于选材目录；缺省时使用 `summary` |
| 分组 | `groups[].description` | 是 | 分组存在的意义就是让选择者知道里面有什么 |
| 片段 | `Fragment.description` | 否 | 用于目录；缺省时见下 |

作品级新增独立的 `description`，而不是直接复用 `summary`：`summary` 是作品页的宣传简介（“嘴硬心软的便利店店员”），选材需要的是“这里有什么、什么时候有用”（“Mika 的性格、打工经历和说话方式”）。两者经常可以相同，所以 `description` 缺省时回落到 `summary`，作者只在需要时单独填写。

片段的 `description` 缺省规则：

- `activation` 为 `always` 的片段不进入目录，不需要 description（F-1）；
- `semantic` 激活的旧片段，`hint` 作为缺省值（总稿 8.1）；
- 其余情况缺省为空。空 description 的按需片段仍可以被关键词、直接关联或场次 `lore` 选中，但不会出现在交给判定模型的目录中。编辑器在作者给片段设置 semantic 或 keyword 激活时提示补写。

| 字段 | 层级 | 编辑器入口 | 校验 |
|---|---|---|---|
| `Creation.description` | L2 | 作品设置 → “给 AI 看的简介” | 长度上限（建议 300 字） |
| `Fragment.description` | L2 | 条目卡片的副标题 | 长度上限（建议 200 字） |

长度上限用于控制目录成本（总稿 8.2）。超出时报错而不是截断，避免截断后的文字被当作语义等价的摘要。

## 2. 资料分组

```yaml
type: lorebook
ref: "@djj/inn-lore"
description: 河畔旅馆的建筑细节、二十年前的旧案和住客间流传的说法
groups:
  - id: building
    title: 建筑
    description: 旅馆的结构和出入口
    entries: [back-door, cellar]
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
| `id`、`title` | 是 | L2 | 资料集左侧的分组树 | ID 唯一 |
| `description` | 是 | L2 | 分组标题下 | 非空，长度上限同片段 |
| `entries` | 否 | L2 | 拖动条目进入分组 | 引用本作品的片段 |
| `groups` | 否 | L2 | 拖动分组嵌套 | 引用本作品的分组；不能成环；最多 3 层 |

规则：

- 分组只引用，不持有正文（F-10）。一个条目可以在多个分组中，例如 `case-1999` 同时属于“旧案”和“传闻”。
- 分组可以出现在任何带 knowledge 片段的作品上，主要是 Lorebook 和 World；Character 的资料通常不多，允许但不推荐。
- 没有进入任何分组的条目，在目录中直接挂在作品下。
- 小资料集可以完全不写分组，目录就是“作品 description → 条目 description”两层（总稿 8.2）。
- 分组本身不参与激活，也不改变条目的 visibility 与知情控制。按角色过滤后，某分组下已经没有可见条目时，该分组也不出现在该角色的目录里，避免分组 description 泄露信息。

Contribution 新增 `{ on: "group", op, id, base_digest?, after? }`，以分组 ID 为合并单位。

## 3. Knowledge Source

```yaml
type: world
ref: "@djj/port-city"
sources:
  - id: handbook
    title: 港城建筑与历史
    description: 城中主要建筑的年代、结构与相关旧事，适合回答“某处怎么走、以前发生过什么”
    asset: handbook
    format: markdown
    sections:
      - { id: inn, title: 河畔旅馆, anchor: "#河畔旅馆", description: 旅馆的平面、改建和地下通道 }
      - { id: river, title: 河道与码头, anchor: "#河道与码头", description: 河道走向、渡口和夜间航运 }
    origin:
      title: 港城地方志（作者自写）
assets:
  - slot: handbook
```

| 字段 | 必填 | 层级 | 编辑器入口 | 校验 |
|---|---|---|---|---|
| `id`、`title` | 是 | L2 | 作品的“参考资料”列表，上传文件即创建 | ID 唯一 |
| `description` | 是 | L2 | 上传后提示填写，可由 agent 起草 | 非空 |
| `asset` | 是 | L2 | 上传的文件 | 指向本作品的 asset slot |
| `format` | 是 | — | 按文件类型自动识别 | v1 支持 `markdown`、`text` |
| `sections` | 否 | L3 | “生成目录”：按标题自动生成，作者确认 | ID 唯一；`anchor` 必须在文件中存在 |
| `origin` | 否 | L2 | “出处” | 见下 |

规则：

- **正文存放在 asset 中。** 资产按内容寻址，Release 锁定的就是这份文件，满足“资料版本随 Release 固定”。长资料不写进片段，避免撑大 Context IR。
- **`sections` 可选**（F-11）。没有分节时整份资料是一个候选；有分节时 Engine 可以只读取某一节。`anchor` 在 markdown 中是标题，在 text 中是行范围（例如 `L120-L240`）。分节 ID 跟随 Release，runtime 不能临时切分后当作稳定引用。
- **`origin` 只记录出处，不是可跟随的链接。** 写外部网址时只作为说明；平台不会在运行时去抓取。需要引用外部内容，就把它保存为 asset，并照常经过许可检查。
- **引用方式**：条目的 `source` 指向资料或某一节，例如 `source: { use: "#handbook/inn" }`（本作品）或 `source: { use: "@djj/port-city#handbook/inn" }`（依赖）。这只是出处说明，不会把资料正文复制进条目。
- **资料不是事实**：资料包含某个说法，不代表作品采纳它为设定。和条目冲突时，以条目为准；这一点由 Preset 的渲染说明告诉模型。
- **可出现的作品**：World、Lorebook、Character、Scenario。资料的使用范围跟随所属作品：World 的资料在引用它的作品中都可用；Scenario 可以通过场次 `lore` 直接关联某一节。
- **知情与可见性**：资料和分节不能单独声明知情；需要控制“谁知道”的内容，应当整理成条目后用 `knowing` 声明。资料默认只提供给旁白视角；per-agent 模式下，只有作者在资料上写 `visibility: shared` 时才提供给各角色。

新增能力声明 `sources.v1`。不支持的 runtime 可以忽略资料，作品其余部分照常运行。

## 4. 信息视角与关联

### 4.1 `perspective`

```yaml
fragments:
  - id: haunted-door
    kind: knowledge
    description: 关于后门闹鬼的说法
    perspective: rumor
    content: { type: text, text: "老住客说，雨夜后门会自己打开。" }
  - id: alice-claim
    kind: knowledge
    description: Alice 对昨夜的说法
    perspective: { claim: "{{cast:alice}}" }
    content: { type: text, text: "我十一点就锁了门，之后没人出去过。" }
```

| 取值 | 含义 | 渲染要求 |
|---|---|---|
| 缺省 / `canon` | 作者确定的设定 | 按事实提供 |
| `rumor` | 流传的说法，真假未定 | 标注为传闻 |
| `{ claim: <说话人> }` | 某个人物的说法，可能不实 | 标注说话人 |
| `belief` + `{ claim }` | 某人真心相信，但不一定是事实 | 标注“某人相信” |

说话人使用现有 `SpeakerRef`（`{{self}}`、`{{cast:x}}`、`{{slot:x}}` 或 Creation 公共标识），可复用的 Lorebook 中用 slot 或公共标识，Scenario 中用 cast key。

规则：

- 标注方式由 Preset 决定，但不能省略（F-13）。参考 Assembler 的默认格式是在正文前加“传闻：”“Alice 的说法：”。
- `perspective` 只描述信息的性质，与知情无关：Bob 可以知道“Alice 声称十一点锁了门”，但不知道真相。
- 层级 L2，编辑器入口在条目卡片上的“这是：设定 / 传闻 / 某人的说法”。

### 4.2 `about`

```yaml
  - id: back-door
    kind: knowledge
    about: ["#inn-building", "{{cast:alice}}"]
```

`about` 列出条目涉及的片段、人物或作品，用于三件事：编辑器中的双向链接（在 Alice 的页面看到所有关于她的条目）、目录中的相关线索、差异展示时提示受影响的内容。`about` 不参与激活，也不表示知情。可选，层级 L2。

## 5. 地点

第一轮留了一个问题：地点是否像 Item 一样做成 `story` 对象。

**建议：v1 不新增 Location 对象，地点用 knowledge 条目表达。** Scene 的 `where` 保持文字，另加可选的 `place` 指向一个条目：

```yaml
story:
  scenes:
    - id: lobby
      where: 旅馆大厅
      place: "@djj/inn-lore#lobby"
```

理由：

- 地点通常属于世界，会被多部作品复用。放在 World 或 Lorebook 的条目里，可以跨作品引用；`story` 对象不能跨作品引用（第一轮取舍 4）。
- Item 是本作品中被持有、被获得的东西，需要进入集合变量；地点没有这种运行语义，条件里有 `in` / `visited` 场次已经够用。
- `place` 指向的条目在进入该场次时作为直接关联进入上下文，和 `lore` 一样仍经过可见性与知情过滤。

编辑器可以给 `about` 或 `place` 引用最多的条目显示“地点”标签，形成地点列表，不需要单独的数据类型。

## 6. Style 的作用范围与组合

Style 仍通过 Reference Edge 引入（F-14）。在 Scenario 的边上新增两个字段：

```yaml
references:
  - { id: noir, use: "@djj/restrained-noir", mode: default, scope: narration }
  - { id: wry, use: "@lin/wry-voice", mode: default, scope: { cast: alice } }
  - { id: tension, use: "@djj/blizzard-tension", mode: default, scope: { scene: lobby } }
  - { id: plain, use: "@djj/plain", mode: default, scope: narration, combine: replace }
```

| 字段 | 必填 | 取值 | 校验 |
|---|---|---|---|
| `scope` | 否，缺省 `narration` | `narration` / `{ scene: <id> }` / `{ cast: <key> }` | 只允许出现在指向 Style 的边上；场次和参与者必须存在 |
| `combine` | 否，缺省 `add` | `add` / `replace` | `replace` 只替换同一范围内其他 Style（F-15） |

规则：

- **范围由宽到窄排列**：旁白 → 场次 → 参与者；同一范围按边的声明顺序（F-17）。同一范围有 `replace` 时，只保留最后一个 `replace` 及其后的 `add`。
- **场次范围**只在当前场次生效，当前场次来自 runtime 的会话视图。
- **参与者范围**：per-agent 模式下只进入该参与者的上下文；narrator 模式下标注“Alice 的说话方式”后提供给旁白。
- **人物自带的说话方式不受 `replace` 影响。** Character 自己引用的 Style 属于人物设定；在 Scenario 中要替换，需要通过参与者 `override` 并遵守 D-027。
- Character 和 World 上的 Style 边不写 `scope`：Character 的 Style 就是该人物的口吻，World 的 Style 是旁白。
- **渐进展开**：Style 中的核心说明（`always`）稳定保留；长示例可以标为 `opportunistic` 并写 description，由 Engine 按预算取用（总稿 9.3）。

编辑器入口（L2）：作品设置中的“文风”列表，每项选择“整体 / 某个场次 / 某个人物”和“补充 / 替换”，旁边预览该范围下最终组合的 Style 文本。

## 7. Preset 新版本策略契约

现行 Preset 与 Module 是 `version: "0-draft"`。本节定义下一版 `"1-draft"`。旧版本继续按原规则解析，行为不变。

### 7.1 模块装配

```yaml
policy:
  version: "1-draft"
  imports:
    - { id: leave-room, use: "@djj/leave-room", pin: {...} }
  blocks:
    - id: tone
      text: 叙述克制，不替玩家做决定。
      default_at: main
  placements:
    - { block: tone, at: main }
    - { block: leave-room/core, at: main }
    - { block: leave-room/core, at: after-history, as: reminder }
```

`"1-draft"` 的 Module：

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
| `blocks[].default_at` | 两者 | 是 | 没有被 `placements` 提到时使用的位置 |
| `blocks[].purpose` | 两者 | 否 | 给作者和 Trace 看的用途说明 |
| `placements` | Preset | 否 | 显式装配；`block` 写本地块 ID 或 `<import id>/<block id>` |
| `placements[].at` | Preset | 是 | `main` / `after-history` |
| `placements[].as` | Preset | 否 | 本次装配的标识；缺省为 `at` 的值（F-16） |

规则：

- **本地块与导入块规则一致**：没有被 `placements` 提到时按 `default_at` 装配一次；被提到时只按 `placements` 装配，可以多次。只写 `blocks`、不写 `placements` 的 Preset 与现行写法几乎相同，只是把 `position` 改名为 `default_at`。
- 想保留一个块但暂不使用，沿用现有的 `enabled: false`。
- **去重**：同一模块 Release 经多条依赖路径导入，只算一次；`placements` 中的多次装配都保留（总稿 9.2）。同一块同一位置写两次且 `as` 相同时报错。
- **顺序**：同一位置内按 `placements` 的声明顺序；未被提到的导入块排在显式装配之后，按现行依赖遍历顺序。
- `"0-draft"` Module 可以被 `"1-draft"` Preset 导入：其块的 `position` 视为 `default_at`。因为规则一致，`"0-draft"` 升级到 `"1-draft"` 只需改名，不写 `placements` 时装配结果不变（去重规则除外，见上）。

### 7.2 新区域

`"1-draft"` 的 layout 在现有区域之外新增：

| 区域 | 内容 |
|---|---|
| `system:scene` | 当前场次的时间、地点、开场局面、本场目的、在场物品，以及 `place` / `lore` 直接关联的条目 |
| `system:story` | 作品级剧情安排：参与者的 `part` 与 `goal`、候选 Beat 与结局的 description（按 runtime 需要） |
| `system:sources` | 选中的参考资料节选 |

现行 layout 要求完整列出全部区域，因此新增区域只能出现在 `"1-draft"`。`"0-draft"` Preset 遇到有 `story` 的作品时，场次和剧情内容放入 `system:scenario`，资料节选放入 `system:knowledge`，Trace 中注明回落。

### 7.3 选材要求

Preset 可以声明它对 Context Engine 选材的要求，不指定具体提供方：

```yaml
policy:
  selection:
    catalog_budget: 1500      # 目录阶段最多暴露的 token 估算
    max_depth: 3              # 最多展开几层（作品 → 分组 → 条目）
    on_unavailable: skip      # 判定提供方不可用时的回退，v1 只有 skip
```

| 字段 | 缺省 | 说明 |
|---|---|---|
| `catalog_budget` | runtime 决定 | 目录成本上限（总稿 8.2） |
| `max_depth` | 3 | 与分组最多 3 层一致 |
| `on_unavailable` | `skip` | 只有 `skip`：只保留必需内容和直接关联。不提供“全部注入”；原有的 `keyword` 选项已删除（消费契约 v1 的 P-4） |

`selection` 是要求而不是实现。runtime 不支持渐进选材时，按 `on_unavailable` 处理并在 Trace 中说明。判定提供方的地址、凭据和型号不进入 Preset。

## 8. 能力声明补充

在第一轮第 7 节的基础上增加：

| 能力 | 出现条件 |
|---|---|
| `catalog.v1` | 存在分组或片段、作品级 description |
| `sources.v1` | 存在 `sources` |
| `perspective.v1` | 任一片段写了非 `canon` 的 `perspective` |
| `style.scope` | 任一 Style 边写了非缺省的 `scope` 或 `combine` |
| `policy.1-draft` | Preset 或 Module 使用 `"1-draft"` |

## 9. 兼容影响

| 变化 | 影响 | 初步处理 |
|---|---|---|
| 片段与作品新增 description | 旧 Release 没有该字段 | 旧 Release 不变；适配时用 `hint` 和 `summary` 作缺省 |
| 新增 `groups`、`sources` | 发布产物新增部分 | 旧消费者忽略，按能力声明提示 |
| `perspective` | 旧消费者会把传闻当设定 | 能力声明 `perspective.v1`；CCv3 导出时把标注写进正文并记入 Loss Report |
| Style 边的 `scope` | 旧 Assembler 会把所有 Style 当作整体 | 能力声明；旧 runtime 降级为全部叠加 |
| Preset `"1-draft"` | 新旧两套位置与去重规则 | 以 `version` 区分，旧 Preset 行为不变 |
| 新区域 | 旧 layout 不包含 | 只有 `"1-draft"` 可用；旧版回落并记入 Trace |

## 10. 本轮取舍（已确认，2026-09-26）

第 7 条按用户选择调整，其余采纳建议。

1. **作品级 description 独立于 `summary`**，缺省时回落到 `summary`。
2. **description 超长时报错，不自动截断**；片段 200 字、作品 300 字为建议上限。
3. **分组最多 3 层**，一个条目可以属于多个分组。
4. **参考资料的正文放在 asset 中**，v1 只支持 markdown 与纯文本；`origin` 只是出处说明，平台不在运行时抓取外部内容。
5. **参考资料不能单独声明知情**；per-agent 模式下默认只给旁白视角。
6. **地点不做成新对象**，用 knowledge 条目加 Scene 的 `place` 表达。
7. **Preset `"1-draft"` 移除块的 `position`**，改为块的 `default_at` 加 Preset 的 `placements`；本地块与导入块规则一致，没被 `placements` 提到就按 `default_at` 装配一次（用户选择，替代“本地块必须显式装配”的建议）。
8. **新增三个区域**只在 `"1-draft"` 中可用，旧 Preset 回落到现有区域。
9. **选材失败时不提供“全部注入”**，只有 `skip` 一种回退（`keyword` 已在消费契约 v1 中删除）。
