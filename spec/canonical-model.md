# Char Canonical Model v0-draft

> Status: **v0-draft**。冻结条件见 DECISIONS D-054。
> 本文件定义 char.pub 所有 Source（Native / GitHub / CCv3 Import）共同映射到的规范数据模型。
> `char.yaml` 只是它的一种 authoring syntax；Creative 内容经 Resolver 生成 Context IR（见 [`context-ir-v0.md`](context-ir-v0.md)），Preset 独立解析为 ResolvedPreset（见 [`preset-v0.md`](preset-v0.md)）。

类型记法使用 TypeScript 风格，仅作为语言中立的结构描述；`?` 表示可选。

---

## 1. 分层

```text
Authoring Syntax     char.yaml / Native Editor / CCv3 PNG
        │ parse / import
        ↓
Canonical Model      Creation · Fragment · ReferenceEdge · Asset     ← 本文件
        │ publish
        ↓
Release              不可变快照 + Lock
        │ resolve
        ↓
Context IR           见 context-ir-v0.md
```

规则：

1. 所有 Source Adapter 的输出都必须是 Canonical Model。Resolver 只读 Canonical Model，不读 Source 格式。
2. Canonical Model 是纯数据：没有表达式、没有脚本（D-026）。
3. Session 状态永远不出现在 Canonical Model 中（D-028）。

---

## 2. 标识符

### 2.1 语法

```text
namespace   = [a-z0-9] ( [a-z0-9-]{0,37} [a-z0-9] )?
name        = [a-z0-9] ( [a-z0-9-]{0,62} [a-z0-9] )?
label       = [0-9A-Za-z.+-]{1,64}               # 版本 label，非 SemVer 承诺
fragment_id = segment ( "/" segment )*           # 最多 4 段
segment     = [a-z0-9] ( [a-z0-9_-]{0,62} [a-z0-9] )?

creation_ref = "@" namespace "/" name ( "@" label )?
local_ref    = "#" fragment_id                   # 同一 Project / Creation 内
full_ref     = creation_ref "#" fragment_id
```

示例：

```text
@djj/alice
@djj/alice@1.2.0
@cyberpunk/night-city#lore/arasaka
#alice                       # Project 内指向 Creation
#lore/arasaka                # Creation 内指向 Fragment
```

> Open（O-2）：是否允许 Unicode name（中文作者会希望 `@djj/爱丽丝`）。v0-draft 倾向：`name` 保持 ASCII slug，另设 `display_name`（任意 Unicode，可按 locale 提供）。

### 2.2 内部标识

每个对象都有不可变的内部 ID（UUIDv7），与公共标识分离（D-022）：

| 对象 | 内部 ID | 公共标识 |
|---|---|---|
| Namespace | `ns_…` | `@djj` |
| Creation | `cr_…` | `@djj/alice` |
| Release | `rel_…` | `@djj/alice@1.2.0` |
| Fragment | `(cr_…, fragment_id)` | `@djj/alice#lore/childhood` |
| Contribution | `ctb_…` | `@djj/alice/contributions/42` |

namespace 或 name 改名时，旧公共标识作为 redirect 保留，不可被他人重新注册（防劫持，O-3 细化）。

---

## 3. Creation

```ts
interface Creation {
  id: CreationId                      // cr_…
  ref: CreationRef                    // @namespace/name
  type: CreationType
  display_name: LocalizedText
  summary?: LocalizedText
  authors?: AttributionAuthor[]          // 可归属的原作者；导入时保留源 creator

  slots?: Record<SlotName, SlotDecl>  // §6
  params?: Record<ParamName, ParamDecl>

  fragments: Fragment[]               // §4
  references: ReferenceEdge[]         // §5
  assets: AssetSlot[]                 // §7
  bootstrap?: Bootstrap               // §8，Character / Scenario 使用
  policy?: PresetPolicy                // 仅 preset；见 preset-v0.md

  meta: CreationMeta                  // §9
  provenance: Provenance              // §10
}

type CreationType =
  | "character" | "world" | "lorebook"                          // v0 开放
  | "relationship" | "scenario" | "persona" | "style" | "preset" // v0 仅模型存在

interface AttributionAuthor {
  name: string
  user?: UserId
  guest_id?: string
  contribution?: ContributionId
}
```

### 3.1 各类型的最小要求

| type | 必需 | 典型 fragment kind |
|---|---|---|
| character | `display_name` + ≥1 `character` fragment | character, examples, knowledge |
| world | ≥1 `world` fragment | world, knowledge |
| lorebook | ≥1 `knowledge` fragment | knowledge |
| relationship | `slots` ≥2 + ≥1 `relationship` fragment | relationship |
| scenario | `cast`（见 §11） | scenario |
| persona | ≥1 `persona` fragment | persona |
| style | ≥1 `style` fragment | style, examples |
| preset | `policy`；禁止非空 Creative 内容、引用、cast、slots、params、bootstrap 与 context assets | — |

Preset 的协议与参考组装能力已定义于 [`preset-v0.md`](preset-v0.md)。这不开放 Registry / Web 创作、CLI build/publish 或 policy Contribution；公开创作类型仍遵循 v0 范围。

Level 0 Character（Name + Description + Greeting + Avatar）必须能以最少字段表达并发布：

```yaml
# char.yaml 示意（非规范）
type: character
name: Alice
description: ./character.md
greeting: "Hi, you're late again."
assets:
  avatar: ./avatar.webp
```

映射为 1 个 `character` fragment + 1 个 bootstrap greeting + 1 个 avatar slot。

---

## 4. Fragment

Fragment 是可被引用、覆盖、激活、隐藏、diff 的最小内容单元。

```ts
interface Fragment {
  id: FragmentId                    // "lore/arasaka"
  stable: boolean                   // D-023；false 时不可作为外部 override target
  kind: FragmentKind
  content: FragmentContent
  locale?: LocaleMap                // 其他语言变体，§4.3

  activation?: Activation           // 默认 { mode: "always" }
  visibility?: Visibility           // 默认 { scope: "shared" }
  importance?: "pinned" | "normal" | "opportunistic"   // 默认 normal
  placement_hint?: FragmentKind     // 仅 hint，D-051

  asset_refs?: AssetRef[]           // 该 fragment 需要一起进入模型的 Context Asset
  digest: Digest                    // canonical 序列化的 sha256，D-041
}

type FragmentKind =
  | "character" | "persona" | "relationship" | "world" | "scenario"
  | "knowledge" | "style" | "examples" | "instruction"
```

说明：

- `instruction` 仅用于 Creation 作者对扮演方式的说明（如“Alice 从不承认自己害怕”）。它仍属于 Creative Truth，**不是** Prompt Engineering；System Prompt / Jailbreak 属于 Preset。
- `memory` / `history` 不是 FragmentKind，它们只存在于 Session。

### 4.1 Content

```ts
type FragmentContent =
  | { type: "text"; text: TemplateText; format?: "markdown" | "plain" }
  | { type: "dialogue"; turns: DialogueTurn[] }          // examples 使用
  | { type: "media"; asset: AssetRef; caption?: TemplateText }
  | { type: "structured"; schema: string; data: JSONValue } // 扩展点，Resolver 透传

interface DialogueTurn {
  speaker: SpeakerRef          // "{{self}}" | "{{user}}" | "{{slot:a}}" | full_ref
  text: TemplateText
}
```

`TemplateText` 只允许纯替换占位符（D-026）：

```text
{{self}}            当前 Creation 所指角色（Character / Persona 中）
{{user}}            late-bound persona 的简写，等价于 Session 的用户角色
{{slot:<name>}}     slot 绑定对象的 display_name
{{param:<name>}}    param 值
```

不认识的占位符 → `char check` 报错。字面量 `{{` 使用 `{{{{` 转义。

### 4.2 Activation

```ts
type Activation =
  | { mode: "always" }
  | { mode: "keyword"; keys: string[]; secondary?: string[];
      logic?: "any" | "all"; case_sensitive?: boolean; whole_word?: boolean;
      scan_depth?: number }             // 最近 N 条消息
  | { mode: "semantic"; hint?: string } // 由 Assembler 实现，结果不保证确定性
  | { mode: "manual" }                  // 仅用户 / Runtime 显式启用
```

`keyword` 字段覆盖 CCv3 `character_book` 的核心语义，保证无损往返的主干。

### 4.3 Locale

```ts
type LocaleMap = Record<BCP47, { content: FragmentContent; activation_keys?: string[] }>
```

- Creation 声明 `meta.default_locale`；fragment 的 `content` 即 default locale。
- locale 变体共享 fragment id、activation mode、visibility，只替换内容与关键词。
- 每个 locale 变体参与 fragment digest（改译文 = fragment 变化）。

### 4.4 Visibility

```ts
type Visibility =
  | { scope: "shared" }
  | { scope: "private"; to: SpeakerRef[] }   // 只对这些角色可见
  | { scope: "scene"; scene?: FragmentId }   // 仅特定场景（Scenario 中使用）
```

语义约束见 D-053：`narrator` 模式下 visibility 不是安全边界。

---

## 5. Reference Edge

```ts
interface ReferenceEdge {
  id: string                          // edge 在本 Creation 内的稳定 ID
  rel?: RelLabel                      // 展示语义：lives_in / knows_about / speaks_like / relationship / ...
  use: CreationRef | LocalRef         // 被引用 Creation
  pin?: ReleasePin                    // 编辑态可省略；Release 中必填（§12）
  mode: "intrinsic" | "default"       // D-027
  bind?: Record<SlotName, Binding>    // §6
  params?: Record<ParamName, ScalarValue>
  select?: Selector                   // 仅引入部分 fragment
  override?: FragmentOverride[]       // §5.2
}

type ReleasePin =
  | { follow: "latest" }                                  // 仅 Draft
  | { release: ReleaseId; semantic_digest: Digest }       // Release 中唯一允许形式
```

`rel` 仅用于 UI（“Made with / lives in Night City”），**不改变 Resolve 语义**。语义由被引用 Creation 的 `type` 与 fragment `kind` 决定。

### 5.1 Selector

```ts
type Selector =
  | { include: FragmentId[] }        // 支持前缀通配："lore/*"
  | { exclude: FragmentId[] }
```

### 5.2 Fragment Override

```ts
type FragmentOverride =
  | { target: FragmentId; op: "replace"; content: FragmentContent; force?: boolean }
  | { target: FragmentId; op: "remove"; force?: boolean }
  | { target: FragmentId; op: "patch"; set: Partial<Pick<Fragment,
        "activation" | "visibility" | "importance" | "placement_hint">> }
  | { op: "add"; fragment: Fragment }   // 在被引用 Creation 的语境中追加
```

约束：

1. `target` 必须指向 `stable: true` 的 fragment，否则 `char check` 报错（D-023）。
2. 对 `mode: intrinsic` 的 edge 的 `world` / `character` kind 做 `replace` / `remove`，必须在 Scenario 内并带 `force: true`，Release 的 provenance 标记 `au: true`（D-027）。
3. Override 不修改被引用 Creation 的 Release，只影响本 Creation 的 Resolved Graph。

### 5.3 Override 优先级（Creative Resolution）

```text
被引用 Creation 原始内容
  < 引用它的 Edge 上的 override（离根越远越先应用）
  < Scenario 的 override
```

同一层对同一 target 出现多个 override → 报错，不按顺序静默覆盖。

---

## 6. Slot 与 Binding

```ts
interface SlotDecl {
  accepts: CreationType | CreationType[]   // character / persona / ...
  required?: boolean                        // 默认 true
  description?: LocalizedText
}

interface ParamDecl {
  type: "string" | "number" | "boolean"
  default?: ScalarValue
  description?: LocalizedText
}

type Binding =
  | CreationRef | LocalRef | "{{self}}" | `{{cast:${string}}}` // early：Resolver 绑定
  | { late: "persona" | "character"; hint?: string }  // late：Assembler 绑定
```

示例：

```yaml
# @commons/childhood-friend
type: relationship
slots:
  a: { accepts: character }
  b: { accepts: [character, persona] }
params:
  reunited_after: { type: string, default: "several years" }
fragments:
  - id: bond
    kind: relationship
    text: "{{slot:a}} and {{slot:b}} grew up next door. They met again after {{param:reunited_after}}."
```

```yaml
# Alice 中引用
references:
  - use: "@commons/childhood-friend"
    rel: relationship
    mode: default
    bind:
      a: "{{self}}"
      b: { late: persona }
    params:
      reunited_after: "10 years"
```

规则：

- `{{self}}` 在 bind 中表示引用方 Creation 本身（仅 character / persona 可用）。
- `required` slot 未绑定且没有 late → 发布失败。
- late binding 在 IR 中原样保留（见 context-ir-v0 §5）。

---

## 7. Asset

```ts
interface AssetSlot {
  slot: string                        // "avatar" | "cover" | "gallery" | "background" | "map" | ...
  role: "presentation" | "context"    // D-045 Tier 与 IR 是否可引用
  variants: AssetVariant[]            // 至少包含 "default"
}

interface AssetVariant {
  id: string                          // "default" | "happy" | "rainy-night"
  blob: BlobRef
  media_type: string                  // image/webp 等
  alt?: LocalizedText
  license?: SPDXExpression            // 缺省继承 Creation license
  rating?: Rating                     // 缺省继承 Creation rating；可以更高，不能更低
}

interface BlobRef {
  digest: Digest                      // sha256，也是 R2 CAS key
  size: number
  locator?: SourceLocator             // linked 模式下的来源，D-073
  availability: "mirrored" | "linked"
}

type AssetRef = `#asset/${string}` | `#asset/${string}/${string}`   // slot 或 slot/variant
```

Session 可以选择 active variant（`avatar = embarrassed`），但这是 Session Overlay，不改变 Creation（D-028）。

---

## 8. Bootstrap

```ts
interface Bootstrap {
  greetings: Greeting[]               // 第一项为默认
}

interface Greeting {
  id: string
  text: TemplateText
  locale?: LocaleMap
  scenario_hint?: LocalizedText       // 例如“雨夜天台”
}
```

Bootstrap 不参与 Context 预算；由 Assembler 作为 Session 首条消息使用（D-052）。

---

## 9. CreationMeta

```ts
interface CreationMeta {
  default_locale: BCP47
  tags?: string[]
  rating: "general" | "teen" | "mature" | "explicit"
  content_warnings?: string[]         // 受控词表 + 自定义
  rights: "original" | "fan-work" | "licensed"
  license: SPDXExpression             // 如 "CC-BY-4.0"，或 "LicenseRef-All-Rights-Reserved"
  recommended_presets?: CreationRef[] // 仅推荐，不绑定（D-051）
  contribution_policy?: "anyone" | "signed-in" | "invited" | "closed"  // D-065，默认 signed-in
}
```

Resolver 对 rating 取依赖闭包中 Creation 与所纳入 Asset 的最大值：一个 `general` Character 依赖了 `mature` World，或纳入 `mature` Asset，Resolved Graph 的 effective rating 为 `mature`，并在 Preview 中说明来源。

---

## 10. Provenance

```ts
interface Provenance {
  derived_from?: { release: ReleaseId; relation: "fork" | "remix" | "import" }[]
  imported_from?: { format: "ccv3" | "ccv2" | "charx" | string; source_digest: Digest;
                    omitted_policy_fields?: string[] } // 仅记录字段名，原值留在导入源与 Import Report
  au?: boolean                        // 含 intrinsic force override
  contributors?: { author: UserId | { guest_id: string; display_name: string }; contribution?: ContributionId }[]
  authored_by_agent?: boolean
}
```

`derived_from` 不参与 Resolve（D-024）。

---

## 11. Scenario 与 Cast（v0 仅模型）

```ts
interface ScenarioExtras {           // type: "scenario" 时出现在 Creation 上
  cast: CastMember[]
}

interface CastMember {
  key: string                        // 场景内角色名，如 "alice"
  who: Binding                       // early（@djj/alice）或 late（{ late: "persona" }）
  role?: "lead" | "support" | "user"
}
```

Scenario 的 `references` 中 `bind` 可以使用 `{{cast:<key>}}` 指向 Cast 成员。同一 Character Release 在不同 Scenario / Session 中是不同的 Character Instance；Instance 状态只存在于 Session。

---

## 12. Release

```ts
interface Release {
  id: ReleaseId
  creation: CreationId
  label: string                       // D-040
  visibility: "public" | "private"    // 发布时确定；D-043 / D-083
  status: "active" | "yanked" | "tombstoned"   // D-042
  status_reason?: string

  source: SourceRecord
  source_digest: Digest
  semantic_digest: Digest
  attribution: { ref: CreationRef; authors: AttributionAuthor[] }[] // 自身与依赖的归属
  contributors: { ref: CreationRef; author: UserId | { guest_id: string; display_name: string };
                  contribution?: ContributionId }[] // 与原作者署名分开
  provenance: Provenance             // 根 Creation 的创作来源与贡献记录

  lock: LockEntry[]                   // 完整依赖闭包，§12.1
  snapshot: BlobRef                   // 规范化 Creation + 闭包文本，D-043
  context_ir?: BlobRef                // 从 snapshot + lock + Resolver 版本确定性生成并缓存，D-043 / D-056

  availability: "complete" | "linked" // D-045
  effective_rating: Rating
  license_check: "pass" | "warn"      // D-046；fail 不能发布
  created_at: Timestamp
  published_by: UserId | { oidc: GitHubOIDCClaims }
}

interface LockEntry {
  ref: CreationRef
  release: ReleaseId
  semantic_digest: Digest
  via: EdgePath                       // 从根到此处的 edge 路径，用于 Preview 解释
}

type SourceRecord =
  | { provider: "native"; revision: RevisionId }
  | { provider: "github"; repository_id: DecimalId; repository_owner_id: DecimalId;
      commit: string; path: string }                           // D-071；DecimalId 为十进制字符串（D-128）
  | { provider: "import"; format: string; upload: BlobRef }
  | { provider: "http"; url: string; fetched_at: Timestamp }
```

### 12.1 发布校验（全部通过才能进入 active）

1. 所有 `pin` 为精确 Release；无 `follow: latest`。
2. 依赖闭包中不存在 tombstoned；存在 yanked 时 warn。
3. `visibility: public` 的 Release 闭包中全部为 `visibility: public` 的 Release（D-043）。
4. 单图单版本（D-029）。
5. override target 全部 `stable: true`。
6. required slot 全部已绑定或 late。
7. 所有被引用 Asset 状态为 `ready`（D-084）。
8. Creation / Asset License 兼容性与文本及镜像 Asset 的再分发许可（D-046）。
9. 同一 Creation 的 label 未被占用（D-044）。

---

## 13. Contribution（v0 实现 Native → Native）

```ts
interface Contribution {
  id: ContributionId
  target: CreationId
  base: { revision: RevisionId; semantic_digest: Digest }
  author: UserId | { guest_id: string; display_name: string } // anyone 策略下的经验证访客
  agent?: boolean                     // D-065
  title: string
  description?: string
  status: "open" | "accepted" | "rejected" | "withdrawn"
  transport: { type: "native" } | { type: "github-pr"; repository_id: DecimalId; number: number }
  changes: Change[]
  rights_ack: { inbound_equals_outbound: true } | { explicit_grant: true }  // D-064
}

type MetadataField = "display_name" | "summary" | `meta.${Extract<keyof CreationMeta, string>}`

type Change =
  | { on: "fragment"; op: "add" | "modify" | "remove"; id: FragmentId;
      base_digest?: Digest; after?: Fragment }
  | { on: "edge"; op: "add" | "modify" | "remove"; id: string;
      base_digest?: Digest; after?: ReferenceEdge }
  | { on: "asset"; op: "add" | "modify" | "remove"; slot: string; variant?: string;
      base_digest?: Digest; after?: AssetSlot | AssetVariant }
  | { on: "metadata"; field: MetadataField; op: "set" | "unset";
      base_digest?: Digest; after?: JSONValue;
      sensitive: boolean }            // meta.rating / meta.license / meta.content_warnings → true
```

`id`、`slot + variant`、`field` 是各类变更的稳定比较键；同一个 Contribution 不能对同一键提交多个变更。整个 AssetSlot 的变更与该 slot 下任一 variant 的变更相交，不能当成独立键自动合并。`base_digest` 是提交时该键的 canonical 值 digest，add / 新增字段时省略，表示基线中不存在。Fragment 使用 `fragment.digest`；edge、asset、metadata 值使用 `sha256(JCS(canonical value))`，缺失值不计算 digest。变更先按键做三方比较，再整体校验所得 Creation。合并（D-062）：

```text
for change in changes:
  current = digest_or_absent(target_draft, change.key)
  after_digest = digest(change.after) if change has after
  if change.op in [add, set] and base is absent:
    if current is absent → apply
    elif current == after_digest → already applied, skip
    else → conflict
  elif change.op in [modify, set]:
    if current == base_digest → apply
    elif current == after_digest → already applied, skip
    else → conflict
  elif change.op in [remove, unset]:
    if current == base_digest → remove
    elif current is absent → already applied, skip
    else → conflict
```

add 必须无 `base_digest` 且有 `after`；modify / remove 必须有 `base_digest`；set 根据基线是否存在决定是否有 `base_digest`，且必须有 `after`；unset 必须有 `base_digest`。必填字段不能 unset。`sensitive` 由字段路径计算，客户端不能自行降级；`sensitive: true` 的 metadata change 在 UI 中必须单独确认（D-061）。接受时重新校验目标 License 与 `rights_ack`，再生成新 Revision；发布下一 Release 时把贡献者写入 `provenance.contributors` 与 Release 的 `contributors`，与原作者 `authors` 分开展示。访客贡献者使用稳定 `guest_id` 表示，不能伪装为已登录用户。

---

## 14. Canonical 序列化与 Digest（O-1）

v0-draft 方案（待冻结）：

1. 所有文本 Unicode NFC；行尾统一为 `\n`；去除行尾空白以外不改动内容。
2. 对象序列化为 JSON，按 RFC 8785（JCS）规范化。
3. 省略值等于默认值的字段（如 `importance: "normal"`），保证“写与不写默认值”digest 相同。
4. `fragment.digest = sha256(JCS(fragment 去掉 digest 字段))`。
5. `semantic_digest = sha256(JCS({ creation 去掉 fragments, fragment_digests: [[id, digest], …] }))`，`fragment_digests` 保留 fragment 的声明顺序（顺序影响 Context IR，D-126）。
6. 所有 digest 编码为 `sha256:<hex>`。

---

## 15. 与 CCv3 的映射（摘要）

| CCv3 | Canonical |
|---|---|
| `name` | `display_name` |
| `description` / `personality` | `character` fragment（分别为 `#description`、`#personality`） |
| `scenario` | `scenario` kind fragment `#scenario` |
| `first_mes` / `alternate_greetings` | `bootstrap.greetings` |
| `mes_example` | `examples` fragment（解析为 dialogue，失败则 text） |
| `character_book.entries[]` | `knowledge` fragments，`activation.keyword`；仅在源 `id` 有持久身份保证时保留为 `lore/<id>`；缺失、仅为数组下标或稳定性未知时派生临时 ID 并标 `stable: false` |
| `system_prompt` / `post_history_instructions` | **原值不进入 Creation / IR**；字段名记入 `provenance.imported_from.omitted_policy_fields`，原值在 v0 原始导入文件及 Import Report 中保留；Preset 结构定义后才可生成推荐 Preset 草稿（O-7） |
| `creator_notes` | `summary` |
| `tags` / `creator` | `meta.tags` / `authors`（同时保留导入 provenance） |
| `{{char}}` / `{{user}}` | `{{self}}` / `{{user}}` |
| 嵌入头像 | `avatar` slot `default` variant |

反向导出的损失由 Loss Report 列出（D-056）。若未显式选择 Preset，导出时不自动恢复原卡中的 `system_prompt` / `post_history_instructions`；Loss Report 必须指出这两项未进入导出内容。原始导入文件与 Import Report 按上传者私有资料处理，公开 Release 不自动公开它们。源 ID 派生与碰撞处理必须确定性，并在 Import Report 中记录，临时 ID 不得成为外部 override target。
