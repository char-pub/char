# Char Context IR v0-draft

> Status: **v0-draft**。在 CCv3 Exporter 与一个真实 Runtime 两个独立消费者验证之前不冻结（D-054）。
> 依赖：[`canonical-model.md`](canonical-model.md)。
> 目标：让任何 Runtime 都能消费 char.pub 的 Creation，而不依赖 char.pub 的服务（D-050、D-055）。

---

## 1. 位置与边界

```text
Release（Canonical Model + Lock）
        │
        ↓  Resolver / Linker     确定性；相同 Release / lock / Resolver 版本 → 相同 IR（字节级）
        │
   Context IR                    ← 本文件；不可变；可缓存；可 hash
        │
════════╪═══════════ Runtime Boundary ═══════════
        │
        ↓  Assembler              每轮运行；不确定性允许存在
        │    + Resolved Preset
        │    + Runtime Profile
        │    + Session（state / memory / history / late bindings）
        ↓
  Model Messages
```

| | Resolver | Assembler |
|---|---|---|
| 确定性 | 必须 | 不要求 |
| 所在 | CLI、GitHub Action、char.pub worker、浏览器 | Runtime SDK、第三方 Runtime、Playground |
| 负责 | 版本锁定、early binding、params 替换、select、override、license / rating 汇总、provenance 链 | late binding、activation、semantic retrieval、visibility 过滤、token 预算、placement、Preset 应用 |
| 不负责 | tokenizer、session、history、模型 | 修改 Creative Truth |

**不变量：** Assembler 只能对 IR 做选择、排序、裁剪、叠加 Session Overlay，不能改写 IR 中的 fragment 内容（D-028）。唯一的例外是 late binding 与 `{{user}}` 的占位符替换。

---

## 2. 文档结构

IR 是一个 JSON 文档；草案 media type 为 `application/vnd.char.context-ir+json; version=0-draft`，冻结后才使用 `version=0`。

```ts
interface ContextIR {
  ir_version: "0-draft"
  root: { ref: CreationRef; release: ReleaseId; semantic_digest: Digest }
  lock_digest: Digest                 // sha256(JCS(lock))
  resolver: { name: string; version: string }

  meta: EffectiveMeta                 // §3
  participants: Participant[]         // §4
  late_slots: LateSlot[]              // §5
  fragments: IRFragment[]             // §6
  bootstrap: IRBootstrap              // §7
  assets: IRAsset[]                   // §8
  graph: IRGraph                      // §9，用于 Preview 解释
  diagnostics: Diagnostic[]           // 仅静态、可重现的警告（如 unstable fragment）
}

interface Diagnostic {
  code: string
  subject: string                    // 稳定对象 ID 或字段路径
  severity: "info" | "warning"
  detail?: string                    // 可重现的静态说明
}
```

`resolver.version` 进入 Build Cache key（D-056）。IR 字节级一致性比较包含 `resolver`；跨 Resolver 版本的**语义内容比较**使用去掉 `resolver` 字段后的 canonical JSON。版本不同即使语义内容相同，完整 IR 字节也不会被视为相同。
Release 当前是否 yanked / tombstoned 是可变 Registry 状态，不进入不可变 IR。发布时的 yanked 警告写入 Publish Report；下载 / resolve 时重新检查 tombstone 并返回明确错误，yanked 则由 Registry 响应附加警告。这样同一快照与 lock 的 IR 不会因后续状态变化而改变。

---

## 3. EffectiveMeta

```ts
interface EffectiveMeta {
  default_locale: BCP47
  available_locales: BCP47[]          // 闭包内所有 fragment 均具备的 locale 交集
  rating: Rating                      // 闭包最大值
  rating_sources: { ref: CreationRef; rating: Rating; asset?: string }[]
  content_warnings: string[]          // 闭包并集
  licenses: { ref: CreationRef; license: SPDXExpression; asset?: string }[] // 独立 Asset License 也在此列出
  attribution: { ref: CreationRef; authors: AttributionAuthor[] }[]
  contributors: { ref: CreationRef; author: UserId | { guest_id: string; display_name: string };
                  contribution?: ContributionId }[]
  import_omissions: { ref: CreationRef; fields: string[] }[] // 仅字段名，供 Loss Report 使用
  au: boolean                         // 闭包中任意 provenance.au
  recommended_presets: CreationRef[]
}
```

Runtime 必须在 UI 中尊重 `rating`，并能展示 `attribution`。

---

## 4. Participants

Participant 是 IR 中可以“说话”或“被称呼”的实体：根 Character、Scenario 的 Cast 成员、被 early 绑定的其他 Character。

```ts
interface Participant {
  key: string                         // IR 内唯一；根 Character 为 "self"，其他参与者按引用实例 + slot/cast key 命名
  ref?: CreationRef                   // early 绑定时存在
  display_name: LocalizedText
  kind: "character" | "persona"
  role?: "lead" | "support" | "user"
  late?: string                       // 指向 late_slots[].key 时表示由 Session 决定
  avatar?: AssetRef
}
```

Fragment 中的 `SpeakerRef` 与 `visibility.to` 在 IR 中一律改写为 `participant:<key>`，Runtime 不需要理解 Creation 引用。
根参与者固定为 `self`；隐式 Session 用户固定为 `user`。其他参与者的 key 为 `p:sha256(JCS([instance_key, slot_or_cast_key]))`，避免同一 Creation 沿不同路径引入时碰撞。

---

## 5. Late Slots

```ts
interface LateSlot {
  key: string                         // 隐式用户为 "user"；其余按引用实例 + slot key 命名
  accepts: ("persona" | "character")[]
  required: boolean                   // SlotDecl.required 或被 fragment / bootstrap 实际引用；隐式 user 为 true
  hint?: string
  used_by: IRFragmentId[]             // 哪些 IR fragment 实例含有此占位符
}
```

- `{{user}}` 总是对应 `key: "user"` 的 late slot，即使没有显式声明。同一 Creation 经不同 Reference Edge 引入时，其局部 late slot 使用不同 key，除非显式绑定到全局用户。
- 其他 late slot 的 key 为 `l:sha256(JCS([instance_key, slot_name]))`；同一路径与 slot 在不同 Release 中保持可比较。
- Resolver 把 early 绑定的 `{{slot:x}}` 替换为对应 display_name；late 绑定的占位符在 IR 文本中**原样保留**为 `{{late:<key>}}`。
- Assembler 在 Session 开始时为每个被使用的 late slot 绑定符合 `accepts` 的 Character / Persona 对象；`{{user}}` 对应的隐式 slot 必须绑定 Session 用户 Persona。Runtime 可提供明确配置的默认 Persona；不能仅用一个用户名字符串冒充 Persona。`required` 为 true 且最终未绑定时组装报错；未被任何内容使用的 optional slot 可保持未绑定，不输出带未替换占位符的消息。

---

## 6. IR Fragment

```ts
interface IRFragment {
  id: IRFragmentId                    // "<creation-ref>#<fragment-id>~<instance-key>"，全图唯一
  kind: FragmentKind
  content: IRContent                  // 已完成 early binding / params / override
  locales?: Record<BCP47, IRContent>

  activation: Activation              // 继承 canonical，override 后的结果
  visibility: IRVisibility
  importance: "pinned" | "normal" | "opportunistic"
  placement_hint: FragmentKind

  subject?: string                    // participant key：该 fragment 描述的是谁
  asset_refs?: string[]               // IRAsset.id
  origin: Origin                      // 来源与 override 链，§6.2
  digest: Digest                      // IR fragment 语义字段的 digest，用于 Context Diff
}

type IRContent =
  | { type: "text"; text: string; format: "markdown" | "plain" }
  | { type: "dialogue"; turns: { speaker: string; text: string }[] }  // speaker = participant:<key>
  | { type: "media"; asset: string; caption?: string }
  | { type: "structured"; schema: string; data: JSONValue }

type IRVisibility =
  | { scope: "shared" }
  | { scope: "private"; to: string[] }      // participant keys
  | { scope: "scene"; scene: string }
```

`instance_key` 由从根到该引用实例的稳定 edge ID 路径计算：根实例为 `root`，其余为 `sha256(JCS(edge_id_path))`。`creation-ref` 使用不带版本 label 的公共标识；同一 Creation Release 沿不同路径引入时，每条路径各有独立 fragment、binding 与 override 实例。IRFragment ID 在不同 Release 的同一路径上保持可比较；edge ID 或路径改变会形成新实例。展示层可省略 `~instance-key`，但 Context Diff 与 trace 必须使用完整 ID。

`IRFragment.digest = sha256(JCS({ kind, content, locales, activation, visibility, importance, placement_hint, subject, asset_refs }))`；不包含 `id`、`origin` 或 `digest` 自身。activation / visibility 等字段变化因此也会进入 Context Diff。来源变化由 `graph` / `origin` 单独比较。

### 6.1 排序

`fragments` 数组的顺序是确定的：

1. 按照 graph 的深度优先遍历顺序排列**引用实例**（root 优先，edge 按 `edge.id` 排序）；共享的 Creation 可以沿多条路径出现。
2. 同一 Creation 内保持 canonical 中的 fragment 顺序。

这一顺序**不代表**进入模型的顺序，最终顺序由 Assembler + Preset 决定。
IR 整体按 JCS 序列化。其他无语义顺序的数组按稳定键排序：`participants` / `late_slots` 按 key，`assets` 按 id，`graph.nodes` 按 ref，`graph.instances` 按 via 路径，`graph.edges` 按 from_instance + id，`graph.removed` 按 id；`content_warnings` 等集合按词典序。`bootstrap.greetings` 与作者列表保留作者指定顺序。诊断按 code + subject 排序。此规则与 canonicalization 的最终细节一起在 O-1 冻结。

### 6.2 Origin

```ts
interface Origin {
  creation: CreationRef
  release: ReleaseId
  fragment: FragmentId
  via: string[]                       // edge 路径（edge id 列表）
  instance_key: string                // root 或 sha256(JCS(via))
  overridden_by?: { creation: CreationRef; edge?: string; op: "replace" | "patch" | "add" }[]
  stable: boolean
}
```

Origin 用于回答 Preview 的“为什么被加载 / 哪个依赖引入 / 谁覆盖了它”（DECISIONS §5）。

### 6.3 被移除的 fragment

被 `select.exclude` 或 `override.remove` 移除的 fragment **不出现**在 `fragments` 中，而是记录在 `graph.removed` 里（§9），以便 Preview 解释。

---

## 7. Bootstrap

```ts
interface IRBootstrap {
  greetings: {
    id: string
    speaker: string                   // participant key
    text: string                      // 可含 {{late:*}}
    locales?: Record<BCP47, string>
    scenario_hint?: string
  }[]
}
```

Bootstrap 不参与 Context 预算。Runtime 在 Session 创建时从中选择一条（默认第一条），作为首条 assistant 消息。

---

## 8. Assets

```ts
interface IRAsset {
  id: string                          // "<creation-ref>#asset/<slot>/<variant>~<instance-key>"
  role: "presentation" | "context"
  media_type: string
  digest: Digest
  availability: "mirrored" | "linked"
  access: "public" | "private"        // 源 Release 的可见性
  url?: string                        // 仅 public + mirrored：稳定公共 URL
  locator?: SourceLocator             // linked 时的来源，Runtime 校验 digest
  alt?: string
  rating: Rating
  license: SPDXExpression            // Asset 独立 License，缺省继承 Creation
  origin: { creation: CreationRef; release: ReleaseId; slot: string; variant: string;
            instance_key: string }
}
```

- 只有 `role: "context"` 的 Asset 可以被 fragment 的 `asset_refs` 引用并进入模型（Presentation ≠ Context）。独立 Asset License 必须保留在 IRAsset 与 `meta.licenses`，供 Runtime 展示归属和发布校验。
- `private + mirrored` 的 IR 只保留 Asset ID 与 digest；Runtime 通过已认证的 Registry 请求获取短期 URL，不能把带签名的临时 URL 写进不可变 IR。`public + linked` 仍只有完整性保证，可用性尽力而为。
- 多模态能力不足时，Assembler 使用 `alt` 文本或丢弃，并在 trace 中记录。

---

## 9. Graph（解释信息）

```ts
interface IRGraph {
  nodes: { ref: CreationRef; release: ReleaseId; type: CreationType; display_name: string }[]
  instances: { key: string; ref: CreationRef; via: string[] }[]
  edges: { from_instance: string; to_instance: string; id: string; rel?: string;
           mode: "intrinsic" | "default" }[]
  removed: { id: IRFragmentId; by: { creation: CreationRef; edge?: string;
             reason: "select" | "override" } }[]
}
```

IR 中的 graph 只用于展示和解释，Assembler 不依赖它完成组装。

---

## 10. Runtime Profile

由 Runtime 提供，不属于 IR：

```ts
interface RuntimeProfile {
  runtime: { name: string; version: string }
  model?: string
  tokenizer: string | "estimate"      // D-057
  context_window: number
  reserve_for_output: number
  mode: "narrator" | "per-agent"      // D-053
  capabilities: {
    images?: boolean
    system_role?: boolean
    multiple_system_messages?: boolean
  }
  locale?: BCP47
}
```

---

## 11. Assembler 契约

这里描述的是**语义要求**，不是强制算法。任何实现只要满足以下要求，即视为合规。

### 11.1 输入

```text
ContextIR + ResolvedPreset? + RuntimeProfile + Session
```

Preset 缺省时，Assembler 使用自身的默认 layout。Preset 的结构待 O-7 定义，v0 只要求它能表达：各 kind 的 placement、各区域的预算、System / Post-history 文本。

### 11.2 必须满足

1. **Locale**：优先使用 `Session.locale`，其次 `RuntimeProfile.locale`，最后 `default_locale`。缺失时回退到 default，并记录 trace。
2. **Late binding**：替换所有 `{{late:*}}`，不得残留未替换的占位符。
3. **Visibility**：
   - `per-agent`：为 participant P 组装时，排除 `private` 且 `to` 不含 P 的 fragment。
   - `narrator`：可以包含 private fragment，但必须附带标注，告知模型只有 `to` 中的角色知道该信息。
4. **Activation**：
   - `always` 与 `pinned` 总是候选。
   - `keyword` 按其参数扫描最近 `scan_depth` 条消息。
   - `semantic` 可以由实现自选检索方式，也可以不支持（视为 `manual`，并记录 trace）。
   - `manual` 仅在 Session 显式启用时加入。
5. **Budget**：
   - `pinned` 永远不裁剪；若 pinned 本身超出预算，报错，不得静默截断。
   - 其余按 `normal` → `opportunistic` 的顺序，在预算内按 Preset 规则选择。
   - 不得截断单个 fragment 的中间内容；要么完整纳入，要么整条跳过。
6. **Session Overlay**：Session 中的 memory、state、active asset variant 以单独的消息或区域加入，不得混入或改写 IR fragment。
7. **Trace**：必须能输出 §12 的 Assembly Trace（可以按需开启）。

### 11.3 禁止

- 修改 IR fragment 的内容（占位符替换除外）。
- 引入 IR 之外的 Creative 内容且不标注来源。Preset 的 system 文本属于 Policy 层，trace 中要标记为 `preset`。
- 在 `narrator` 模式下对用户宣称 visibility 提供了隔离。

---

## 12. Assembly Trace 与 Context Preview

```ts
interface AssemblyTrace {
  ir: { root: CreationRef; lock_digest: Digest }
  profile: { tokenizer: string; context_window: number; mode: string }
  total_tokens: number
  estimated: boolean
  entries: {
    id: IRFragmentId | "preset:*" | "session:*" | "history"
    region: string                    // 实际放置区域
    tokens: number
    decision: "included" | "skipped"
    reason: "always" | "pinned" | "keyword:<key>" | "semantic" | "manual"
          | "budget" | "visibility" | "locale-fallback" | "unsupported-media" | "inactive"
    origin?: Origin
  }[]
}
```

Context Preview 就是对 AssemblyTrace 的渲染：

```text
Context Preview · 18,420 tokens · tokenizer: cl100k (estimate)

Character  @djj/alice#description             2,140  included  always
World      @cyberpunk/night-city#world        3,201  included  always
Lore       …#lore/arasaka                       431  included  keyword:Arasaka
Lore       …#lore/militech                        —  skipped   inactive
Lore       …#lore/pacifica                        —  skipped   budget
                 via: alice → night-city
                 overridden by: @djj/alice (patch activation)
```

char.pub 网站的 Preview 在浏览器端运行参考 Assembler，服务端只提供 IR（D-055、D-057）。

---

## 13. Context Diff

两个 IR 之间的比较基于 `IRFragment.id` 与 `digest`：

```ts
interface ContextDiff {
  from: { root: CreationRef; lock_digest: Digest }
  to:   { root: CreationRef; lock_digest: Digest }
  lock_changes: { ref: CreationRef; from?: string; to?: string }[]   // label 仅用于展示
  fragments: {
    added: IRFragmentId[]
    removed: IRFragmentId[]
    modified: { id: IRFragmentId; fields: ("content" | "activation" | "visibility"
                | "importance" | "placement_hint" | "locales")[] }[]
  }
  origin_changes: { id: IRFragmentId; from: Origin; to: Origin }[]
  meta_changes: { field: "rating" | "content_warnings" | "licenses" | "attribution" | "contributors";
                  from: JSONValue; to: JSONValue }[]
  token_delta?: { tokenizer: string; always: number; potential: number }
}
```

- `token_delta.always`：always 与 pinned fragment 的 token 变化。
- `token_delta.potential`：所有可激活 fragment 的 token 变化上界。
- `origin_changes` 展示内容未变但 Release、引用链或 override 来源改变的情况。
- `meta_changes` 中的 rating / license 变化在 UI 中必须高亮。

---

## 14. CCv3 Exporter（第一个参考消费者）

CCv3 Exporter 被视为一个**离线的、有损的 Assembler**，其固定 Profile 为：

```text
mode: narrator · tokenizer: estimate · late slot "user" → {{user}}
```

映射：

| IR | CCv3 |
|---|---|
| `participant:self` 的 `character` fragments | `description`（按顺序拼接，并标注来源小标题） |
| 其他 `always` 的 world / relationship / style / scenario | 追加到 `description`，或写入 `scenario`（kind = scenario） |
| `keyword` 激活的 fragments | `character_book.entries`（keys / secondary_keys / case_sensitive / scan_depth） |
| `examples` dialogue | `mes_example`（`<START>` 分隔） |
| bootstrap.greetings | `first_mes` + `alternate_greetings` |
| recommended preset 的 system / post-history | `system_prompt` / `post_history_instructions`（仅在用户选择时写入） |
| `{{late:user}}` / `participant:self` | `{{user}}` / `{{char}}` |
| attribution / licenses | `creator_notes` 末尾 + `extensions.char_pub` |

**Loss Report** 必须列出：

- 被展平进 `description` 的依赖，以及展平后的 token 数。
- `semantic` / `manual` activation 被降级为 `always`、keyword 还是丢弃。
- private visibility（CCv3 无法表达，只能丢弃或转为 narrator 标注）。
- 多个 participant：CCv3 只支持单角色，其余角色会被降级为 lore 条目。
- `role: context` 的 Asset（CCv3 不支持）。
- 非 default locale（每个 locale 需要单独导出一份）。
- `meta.import_omissions` 中记录的源卡 policy 字段；除非用户显式选择 Preset，否则不自动恢复原 `system_prompt` / `post_history_instructions`。

`extensions.char_pub` 写入 `{ root, lock_digest, ir_version }`，以便重新导入时追溯来源。

---

## 15. 一致性测试

IR 冻结前需要一套公共测试集（`char-pub/spec/conformance/`），每个用例包含：

```text
input/      canonical creations + releases
expected/   context-ir.json（Resolver 用例，字节级比对）
            trace.json（Assembler 用例，仅比较 decision / reason，不比较 token 数）
```

首批用例：

1. Level 0 Character
2. Character + World（intrinsic）+ Lorebook（keyword）
3. Relationship 模板：early + late binding
4. select / override（replace、remove、patch）以及 unstable target 报错
5. 菱形依赖出现不同版本时报错
6. yanked 依赖 warn、tombstoned 依赖报错
7. 多 locale 回退
8. private visibility 在 narrator 与 per-agent 下的不同行为
9. pinned 超出预算时报错
10. CCv3 往返：import → IR → export，并生成 Loss Report
11. 同一 Release 由两条 Edge 以不同 bind / params 引入：IR 实例 ID、Asset ID 与 Context Diff 均不碰撞
12. 必需 late slot 缺失时报错；`{{user}}` 由 Session Persona 绑定
13. Public Release 引用 Private Release 拒绝；独立 Asset License / rating 进入 IR 汇总

---

## 16. 未决事项

| # | 事项 |
|---|---|
| IR-1 | Preset 结构（O-7）以及它与 §11.1 的接口 |
| IR-2 | 多 participant 在 `per-agent` 模式下，是否由 IR 预先切分出每个角色的视图（目前由 Assembler 负责） |
| IR-3 | `structured` content 的 schema 注册机制 |
| IR-4 | `semantic` activation 是否要在 IR 中携带预计算 embedding（这会使 IR 与模型绑定，倾向于不携带） |
| IR-5 | IR 的尺寸上限，以及大型 Lorebook 是否需要拆成多个 IR 文件 |
