# PROGRESS

## 当前状态

- 目标：完整 Story v1 本仓库改造。
- 执行包：`spec/goals/story-v1/`。
- 状态：进行中；目标已创建，无 token budget。
- 分支：`DJJ/creative-content-v1`；基点 edab49f。
- 当前：用户本地实操发现的默认Preset、跳转和可读性问题已修复，真实工作区浏览器已从创建草稿走到Harness开场，见末尾终态节。平台作者工作流、真实独立 Harness 启动消费、本地 AI 候选审阅与保存已验证。完整 `pnpm ci:all` 第四轮退出0，见末尾终态记录。尚未部署、发布或进行在线模型质量验收。
- 验收：M0–M6工程证据具备；最新完整CI已通过，G1/G2仍待人工接受与本轮知识增量收尾；35 个规范案例仍为 draft，105 todo 不计入通过，Commons 人工审阅尚待。
- 剩余：人工 expected/Commons 接受、稳定 llmdoc 正式同步与最终交付整理。Laya 身份、适配与固定协议验证已落实，不再作为身份待定项；真实模型质量未验收。
- 下一步：完成原有全栈流程最终回归，记录本地候选功能及最终 CI；以完整人审包获取规范/内容审阅，并核定本地提交范围，按 llmdoc 工具要求完成知识同步。

## 2026-09-30 启动

- 用户授权按评审执行且无用户，可破坏性重构，取消旧格式逐字节兼容。
- 启动时工作区已有 DECISIONS 修改、未跟踪 story-v1 及 archive；均保留。
- llmdoc delta：deep，0 impacted/needs-review，存在未映射更改；已通过 CLI 读取核心与工程边界。
- 执行包建立后持续执行，不把文件建立当作目标完成。

### 追加 harness 与决策提供方

- 用户追加：直接纳入 Jev/Laya，拆独立 harness monorepo，可 clone deepseek-harness 作为起点。
- 已将上游浅克隆到 `/tmp/charpub-deepseek-harness-review`，提交 `639ed015397290b3745d163aafe02ffee4aa3f84`。仅调查，不执行上游脚本。
- tb GitHub源检索无匹配能力，使用 git 从用户指定公开仓库获取源码。
- harness 最终位置和 Laya 链接已异步询问，保持原任务继续。M6 新增到 DOD。
- Core Story schema/静态检查/三值求值和状态操作已写入；Core tsc --noEmit 通过，单测和完整接入待做，M1尚未完成。

### 第一批验证与 Harness 准备

- `pnpm exec vitest run --project unit packages/core/test/story.test.ts packages/core/test/check.test.ts packages/core/test/canonical.test.ts packages/core/test/json-schema.test.ts`：4文件145项通过，其中Story新增19项。
- `pnpm exec tsc -p packages/core/tsconfig.json --noEmit` 与 `pnpm exec tsc -p tsconfig.tests.json --noEmit` 通过。
- 新建Story schema/静态check/三值纯求值，接入Creation和JSON Schema导出。当前 build/Resolver/Catalog尚未接入，不能宣布M1完成或把新格式用于发布。
- Harness已独立clone到 `/Users/djj/code/char-harness`，分支 `work/story-runtime`，执行包 `spec/goals/roleplay/`；保留上游许可和remote（upstream）。尚未安装/启动/验证上游。
- 只读调查：`.llmdoc-tmp/investigations/story-v1-platform.md`、`.llmdoc-tmp/investigations/deepseek-harness-start.md`。后者指出日志投影与Prepared Context需要唯一权威。
- Jev官方文档已核实typed Choice/Score/Noul和JS SDK存在；未调用模型。Laya链接仍待用户补充。

### 状态边界与参与者实例

- recorder只读复查发现：快照cast自证、confirm多余路径段、递归解析前缺少上限。均已修补：所有求值入口独立接收可信cast名单，state不再持有cast；目标格式严格检查；条件在Zod/canonical递归前做迭代上限检查。新增回归测试。
- Graph为同源角色的每次cast使用建立独立identityPath（含cast类型段），env按cast绑定，render按edge后cast分层override并保留修改来源；新片段元数据进入IR及digest。非角色引用仍使用普通身份路径。
- `story.test.ts`+`story-instances.test.ts`共23项通过；新增角色实例覆盖同源双角色、独立改编和intrinsic约束。整合后的6文件回归正在重跑。
- 当前M1尚未完成：story发布产物/引用闭包编译、复杂间接角色引用、资料groups/sources及完整Catalog待接入。不能把已有schema接受当作发布消费已实现。
- 后续M2需接入present快照与私有Selector投影，Harness通过发布包消费上述纯函数，禁止复制代码。

- 最后一次定向回归：Story、实例、Resolver、Canonical、check、JSON Schema共6文件182项通过；Core tsc通过。完整ci:all及平台验收尚未运行，全部DOD保持待验收。

### 当前可恢复检查点

- 最新定向命令：`pnpm exec vitest run --project unit packages/core/test/story.test.ts packages/core/test/story-instances.test.ts packages/core/test/content-collections.test.ts packages/core/test/resolve.test.ts packages/core/test/canonical.test.ts packages/core/test/check.test.ts packages/core/test/json-schema.test.ts`，7文件186项通过。`pnpm exec tsc -p tsconfig.tests.json --noEmit`通过；生成schema已重新导出。
- 新增 `story/resolve.ts`：buildCreation保留root story并给出story_refs参与者/信息映射，拒绝裸公共信息多实例歧义；参与者part/goal/cast_key进入IR。源码暂仍以0-draft版本标识，待M3统一协议切换，不能发布成最终新版。
- `content-check.ts`验证三层分组、环、条目存在、Source的text context资产与分节anchor语法；实际文件anchor存在性及完整catalog_index待做。
- 当前新文件：schema/story.ts、schema/text.ts、story/check.ts、story/evaluate.ts、story/limits.ts、story/resolve.ts、content-check.ts、diagnostics.ts及三组测试。无提交/推送/部署。
- 下一步：完善实例引用（间接cast与无人物正文的实例）、发布资料/分组索引及已声明的story_refs结构；完成逐视角Catalog和Selector投影，Plan绑定，再进入Preset统一升级。不要把186项定向通过当完整ci:all。
- harness工作区 `/Users/djj/code/char-harness` 独立，无依赖安装/模型调用。Laya身份仍待用户链接，Jev API已查阅但adapter未实现。主目标active，所有M/G DOD仍待整体验收。

### 2026-09-30 目录与选择计划迭代（本轮有实际进展）

- Core新增 `schema/catalog.ts`、`catalog-index.ts`：content产物必带catalog_index，覆盖每个解析实例的作品简介、分组树、固定asset的资料分节；story_refs.content支持直接引用group/source section，knowing仍只接受fragment。fragment.source也核查发布闭包。
- IR graph.instances保留cast key/scope，信息引用不再依赖人物正文存在；选掉character片段后仍可准确引用该实例的knowledge。
- Core新增 `schema/context.ts`：严格TurnView与SelectionPlan；导出catalog-index/turn-view/selection-plan JSON Schema。
- Assembler新增 `view.ts`、`catalog.ts`、`selection.ts`：实际present覆盖作者默认；知情、他人目的/outward和私有资料先过滤；SelectorView不含vars/knowing/overlay；固定/空Selector，三层分组逐次展开、全过程目录预算、全部输入摘要绑定、拒绝容器正文/重复/重叠资料选择。
- recorder只读探针确认两个缺口并已修补：Style cast/scene scope先前丢失、预算漏计对外DTO。现在IR保留style_scope/style_use，viewOf统一过滤并按作者顺序replace；selectorCatalog仅含view+candidates，初始/展开都按实际DTO计费，补Alice/Bob/场次/replace/精确预算测试。
- Core新增source-text.ts：调用方提供UTF-8文本后先验发布asset摘要，再解析固定分节，拒绝缺失/重复锚点及越界；无网络IO。Registry发布时加载文本和调用它尚待接入。
- 最新验证：`pnpm exec vitest run --project unit packages/core/test packages/assembler/test` **26文件651项通过**；`pnpm exec tsc -p tsconfig.tests.json --noEmit`通过；`pnpm deps`两组通过；`git diff --check`通过。源码对应本轮未提交工作树；完整ci:all/全栈未执行。

#### 下轮必须继续的缺口

1. 新Catalog/Plan尚未接入`assemble`/`assembleArtifact`；现有最终消息不会自动使用Story过滤/必需项/Source正文。M2不能勾选。需要重构候选输入与Trace，准确携带required/direct/selected的预算、优先级、最终来源，以及per-agent Session overlay/bindings的隔离。
2. 新Preset placements/新区域/default_policy及统一1-draft版本未实施；当前扩展schema仍临时挂0-draft，M3之前禁止宣布公共协议定稿。
3. 静态资料分节正文校验必须纳入Registry发布/草稿构建，当前仅有纯函数；目录正文成本source暂标0表示未加载，最终装配必须用实际正文计费，不能据此免费纳入。
4. Story间接cast引用、嵌套剧情局部引用、Style渲染范围/顺序、perspective说话人及about的闭包编译仍需补全。`style_scope`已过滤但最终Assembler尚不会渲染标注。
5. 初始目录超预算明确报错，后续需在provider流程明确skip如何继续required/direct，避免选材不可用阻塞本轮基础上下文。
6. Registry/Web/Harness/Jev接入仍未实现；Laya链接待用户输入，但不阻塞其余工作。执行包原范围与DOD不变，主目标active。


### 2026-09-30 准备流程与用户入口检查点

- 新增`assembler/prepare.ts`：`createPreparationCatalog`、`prepareContext`、`initialStoryTurn`。required/direct/selected与已核验Source正文进入最终预算、消息及Trace；资料只读取选择的正文或固定分节，hash不符/缺失明确失败。纯计算层无IO。
- `assemble.ts`新增prepared admission用于统一候选预算。新增system:scene/story/sources区域；Scene opening、在场part/goal为required。观点/知情/角色Style有明确标注；runtime Trace隐藏不可见ID，author Trace保留可诊断记录。
- Story模板在Resolver阶段编译到`story_refs.templates`，支持`{{cast:key}}`文本替换及late身份；perspective speaker编译成IR participant引用。
- per-agent仅使用自身完整绑定描述、他人在场公开描述和`visible_overlay`；`outward_description`进入绑定契约。离场角色只保留模板身份，不把描述塞入messages。
- `assembleArtifact`和作者fixture已走prepareContext。fixture存固定CatalogRef列表，构建后生成完整Plan，避免自身摘要递归；source_texts提供精确正文。缺状态/非法视角/选择与资料错误均是setup failure，不能当成合法expected错误验收。
- Plan新增`discovery`，none/skip不暴露目录时无需目录预算，仍绑定输入、可原样重放。`preset: null`明确使用默认布局，undefined继承产物锁定配置；作者fixture省略preset始终走默认。
- CLI preview消费完整artifact；`--start`显式初始化开场，与完整`--session`互斥；`--source-texts`接受IR asset ID到精确正文的JSON映射。不会自动修复传入的局部剧情快照。
- Web发布/草稿/Preset搭配/Playground预览改为完整artifact；开场选择保持角色绑定和示例消息；明确取消锁定Preset继承；Trace支持required/direct/selected及视角过滤。资料授权加载仍未接入，缺正文会显示错误。完整snapshot可通过计算入口传入，尚无Web状态编辑UI。
- recorder重新验证三个修复：离场late描述泄漏、无发现Plan不能重放、非法Story fixture可误通过。另统一新入口schema错误到CharError，防止非法快照直接抛ZodError击穿预览。
- 当前验证基线：Core/Assembler/CLI **29文件689项通过**；Web **20文件143项通过**；`tsc -b apps/web packages/cli`、tests tsc、全仓lint、deps、diff-check通过。最终加入schema错误归一化后，合并命令`pnpm exec vitest run --project unit --project web packages/core/test packages/assembler/test packages/cli/test apps/web/src` **49文件832项全部通过**；类型检查、全仓lint、deps及diff-check再次通过。完整ci:all、conformance及平台E2E未运行。
- Superset Browser在实际`http://127.0.0.1:4175/playground`验证基础角色及world-lore切换、最终messages/Trace，未见页面alert；新Story开场交互由组件测试验证，尚未完整浏览器E2E验收。开发服务exec session 74337；新建pane `pane-ecb71c20-538a-4afe-ae3e-252b5dab04d4`，未操作用户其他页面。
- llmdoc:update结果为deep/dry_run：报告`.llmdoc-tmp/investigations/story-v1-prepared-consumers-dry-run.md`；7 impacted、8 needs-review、147 unmapped。源码仍在实施，未修改稳定知识、提交或刷新fingerprint；不能宣称同步完成。

#### 仍需继续（不缩减DOD）

1. M3 Preset placements/default_at/default_policy与统一1-draft协议版本未实施；当前0-draft是开发中临时状态。源输入/fixtures/Schema/CCv3/exports/actions须一起迁移。
2. M1间接/嵌套cast实例和局部作用域、about闭包编译、Style最终顺序及多locale Story模板待完善。startSession仍为旧IR greeting API，Story starts greeting尚未接通。
3. Source发布校验与Registry/网页授权正文读取待做。CLI当前只有显式正文映射；project.ts递归include可能误展开locator.path，需收窄到明确文本字段。不得用origin.url当下载地址，不得按任意digest签发私有URL。
4. 新目录字段(perspective/about等)与最终Preset策略仍需完成；全量Context Engine契约尚未验收。低层IR assemble仍保留，其独立旧消费者需在全仓统一升级时核查。
5. Registry草稿构建、OAuth/协作者/Contribution、作者编辑器结构化字段与状态预览、平台E2E尚未实施。
6. Harness独立工作区已clone并有执行包，尚未安装/接SDK/运行；Jev adapter未实现，Laya链接待用户补充。无模型调用、部署、推送或提交。全部M/G DOD仍待整体验收，主目标active。


### 2026-09-30 Preset 1 定义与装配迭代

- 前一轮为真实进展（准备流程和消费入口改变源码并有验证），本轮继续M3，未缩减DOD。
- Preset/Prompt Module作者schema统一`1-draft`，块定义使用default_at/purpose；Preset支持placements、selection、render。Resolved Module保留default_at，Resolved Preset转为position装配实例；显式ID由定义身份+at+as组成，origin/placement分别保留。
- policyGraph保留依赖优先和精确锁去重，通过每Release局部块/导入索引按需解析多级路径；第二条菱形别名可寻址，重复正文和显式顺序保留，未知引用/同定义同位置同as拒绝。
- canonical规范化enabled、placement as默认值、selection默认值和空配置；Preset Diff增加purpose/selection/render；Assembler Trace携带policy_origin/policy_placement/purpose。准备流程实际应用目录限额及观点/知情/资料标注。
- Core/Assembler/CCv3/CLI/Web/server草稿创建与相关TypeScript测试输入已迁移作者块定义。CCv3输出保留重复装配正文，并对placements、selection/render不可表达语义报告loss。Web新增purpose、可展开的重复装配及目录/标注编辑，Module显示默认位置，Preset显示实际位置。
- recorder发现并复现两个问题，均修复：默认max_depth=4被canonical省略后允许Runtime放宽；flatten别名图导致指数路径枚举。补默认上限和23层共享图测试。
- 定向验证：`pnpm exec vitest run --project unit --project web packages/core/test packages/assembler/test packages/cli/test packages/ccv3/test apps/web/src` **55文件929项通过**；全仓lint、deps与diff-check通过。`tsc -b apps/web packages/cli apps/server`及`tsc -p tsconfig.tests.json --noEmit`重跑通过。schema已重新导出。
- Preset编辑器组件交互测试证明：一个定义可通过表单生成两次不同位置的合法装配，用途/身份保留。新增编辑器尚未真实浏览器验收；不得据组件测试宣称M5完成。

#### 继续的具体顺序

1. `default_policy`精确默认策略尚未接入build/Registry/CLI/Web；`@commons/default-preset`尚无种子。当前`preset:null`仍临时指内置布局，需改为已锁定的公开默认策略，不能当最终实现。
2. 全部Artifact/IR/assembly等协议仍0-draft；仅策略已1-draft。需要统一版本、迁移JSON/YAML输入、重算引用锁、生成Schema/Action bundle/Commons，并准备conformance候选expected供人工接受，禁止自动冒充已审阅。
3. M1实例/Story greeting等、M4授权资料与草稿构建/协作/OAuth、M5剧情编辑和M6 Harness/Jev仍沿前一检查点待做。
4. llmdoc:update仍为deep/dry_run，报告`.llmdoc-tmp/investigations/story-v1-preset1-dry-run.md`：9 impacted、7 needs-review、162 unmapped；稳定llmdoc/未同步，不提交未完成源码。无部署、推送或模型调用。


### 2026-09-30 固定默认策略的构建基础

- 上一轮为真实进展（Preset1 schema/Resolver/Assembler/UI及929项验证），本轮接入固定默认策略。
- 新`BuildCreationInput.default_policy`接收精确身份。build校验Ref/digest/type/public闭包，将默认Preset及Module纳入聚合lock、assets、评级、许可、署名；不改作者semantic_digest、不向Creative IR塞策略块。
- content artifact新增default_policy内联ResolvedPreset；checkPublish贯通输入，沿正常依赖检查覆盖黑名单/许可/资产。测试验证锁、评级、私有默认与模块拒绝、摘要错误、黑名单，以及新默认不会改变旧已构建结果。
- prepareContext未显式选Preset时消费assembly或default_policy；显式null使用default_policy。runAssemblyTests/fixture传递固定构建输入。
- CLI build/preview/test新增`--default-policy`读取精确Release快照，modules仍用--dep；Web有default_policy时展示实际默认版本。
- 新增`content/commons/default-preset/char.yaml`，CC0/general/AI起草，2块与完整布局。commons-check先模拟默认Preset发布，再对全部内容注入精确默认身份；检查Prompt文本约定。人工REVIEW全部未勾选，未公开发布。
- 验证：55文件931项Core/Assembler/CLI/CCv3/Web测试通过；web/cli/server tsc及tests tsc通过；Commons **26/26**离线发布检查通过。真实CLI build+preview使用`/tmp/char-story-default-snapshots/default-preset.release.json`，产物`/tmp/char-story-default-build/artifact.json`包含精确default_policy与锁，消息/Trace包含roleplay/information两块。模拟身份只供本地检查。
- **尚未完成的关键点**：default_policy输入/产物目前仍optional，未提供时开发路径仍能使用旧内置布局；不能当统一默认已完成。下一步先Registry持久化固定pin、闭包加载/worker/快照贯通与配置，再强制发布与全部新内容构建必须有assembly/default_policy并迁移调用方。
- Registry只读调查结论：requestPublish返回同label或idempotency既有row且不重排任务；固定默认选择应在首次pending row创建后存储，不能worker每次读取环境。loadClosure需额外精确依赖入口；必须在digest/registryState读取前加载默认及模块。writeArtifacts需保存构建输入与直接反向依赖；readArtifact重建只能恢复存储pin。原snapshot只有root/dependencies，需新增持久输入或移除缺artifact重建旧路径。
- 无数据库迁移执行、提交、推送、部署、公开发布或模型调用。全目标active，M/G DOD均仍待整体验收；已有M1/M4/M5/M6缺口不变。

- 本轮最终全仓lint、deps、diff-check通过。llmdoc:update为deep/dry_run：`.llmdoc-tmp/investigations/story-v1-default-policy-dry-run.md`，10 impacted、6 needs-review、163 unmapped；仅scratch报告，未刷新稳定知识。investigator正在将Registry实施调查保存到`.llmdoc-tmp/investigations/story-v1-default-policy-registry.md`，恢复时先确认文件已生成。


### 2026-09-30 Registry固定默认策略

- 前轮为真实进展：Core默认策略构建、CLI消费、Commons候选及931项验证。本轮实现Registry持久身份，目标保持原范围。
- 新迁移`apps/server/drizzle/0013_story_default_policy.sql`给Release增加jsonb default_policy，Drizzle快照/journal一并生成。仅增加列，没有删除数据。
- `DEFAULT_PRESET`为ExactRef JSON配置，限定@commons/default-preset；仅API启动解析。requestPublish在新pending row创建前检查固定Revision是否需要默认；需要但未配置则503。已存在的key/label先返回既有row，不因当前配置缺失被拒。
- 新row持久保存默认pin；worker仅使用该值，缺失/非法状态失败。loadClosure增加额外精确依赖入口，经相同读取授权加载默认及模块；随后常规黑名单、资产、许可和评级检查覆盖它们。checkPublish/作者fixture均贯通同一固定输入。
- Snapshot存默认pin与每个依赖visibility。readArtifact重建使用snapshot/row固定pin，二者冲突拒绝；缺完整固定策略的旧内容拒绝，不再把旧IR拼回新Artifact掩盖差异。正常读取仍直接用CAS产物。
- 默认Preset成为直接reverseEdges(default_policy)，并进入releaseLocks及blob复制/引用集合。只影响新任务，不改变已有Release或作者semantic_digest。
- 测试harness通过真实Revision→requestPublish→worker发布合成默认Preset，未绕过实际构建。新default-policy集成测试覆盖缺配置、pending固定pin、切换配置后的worker、相同key/label回放、新label取新默认、私有快照精确重建、row/snapshot冲突、依赖锁/反向依赖及策略下架失败。原依赖/OIDC断言根据新增真实默认依赖和seed审计调整。
- 已启动本机Docker Desktop。迁移仅由Testcontainers在隔离临时Postgres执行，未运行配置数据库迁移；临时Postgres/MinIO由测试自动销毁。未部署。
- 验证：全部integration **42文件826项通过**；web/cli/server相关TypeScript与tests tsc通过；env定向14项通过。全仓lint、deps、diff-check通过。server-unit全量 **22文件555项通过**。
- 下一步：继续统一协议1-draft与严格产物契约。Core build与开发预览的default_policy暂仍optional；所有发布请求/worker已强制需要默认的内容固定pin，但SDK/CLI无输入时仍有内置布局临时路径，必须移除并迁移fixtures/Playground/草稿构建。随后仍需M1未完实例/开场、多角色Style顺序，M4资料读取/草稿构建/OAuth/协作者，M5剧情编辑，M6 Harness/Jev。
- Registry调查scratch已确认生成：`.llmdoc-tmp/investigations/story-v1-default-policy-registry.md`。全部DOD仍待完整验收，不将集成测试通过当作Story v1全目标完成。

- recorder源码审查未发现新的可确认发布阻断漏洞；固定pin不一致检查限定于snapshot重建分支，CAS快路径以artifactDigest为权威。已启动本轮llmdoc:update deep/dry_run（recorder报告待返回），未写稳定知识或提交。


### 2026-09-30 严格1-draft产物与生产入口迁移

- 上一轮为真实进展（Registry固定pin与826项集成），本轮统一生产Artifact/IR/assembly版本及媒体类型为1-draft，JSON Schema URL改v1-draft并重新导出。旧0-draft只保留在拒绝测试和未人工接受的conformance expected。
- Core build缺assembly/default_policy明确报resolve.default_policy_required；content Artifact的Zod和公开JSON Schema都要求锁定策略。prepare不再在缺有效策略时落入内置布局。新增两层schema拒绝/缺默认CLI反例。
- loadLocalCreation负责源读取、canonical和静态check；CLI remote/Action以此取得semantic_digest，不为身份计算做完整build。声明assembly_tests时仍cmdTest，支持default-policy本地快照输入；Registry始终独立重验。GitHub源读取继续只校验精确commit源内容。
- 新公开GET /v1/default-policy仅公布anonymous可读、public、Preset且ref/digest匹配配置的精确身份，响应no-store。Web loadAssemblyInput返回BuildCreationInput并加载固定默认及模块；Playground显式使用@examples/preview-policy合成Release；单元测试同样显式提供测试策略，生产不导入测试helper。
- Scenario已有assembly但没有独立default_policy时，显式选择默认会失败，不能默默使用内置布局；作者fixture应明确选Preset。网页解除锁定先沿用已有Preset，只有产物带default_policy时才显示切回默认按钮。
- Conformance 014/015作者Preset输入已迁default_at/新增区域并重算pin，cases.gen.json重建；expected未改、未人工接受，runner仍旧IR-only assemble，下一步必须迁完整准备契约。低层assemble仍从包导出，属于明确未完的API收敛项。
- Action dist通过正式构建生成；check:action-dist第一次因未暂存生成文件失败，随后仅stage actions/publish/dist/index.js并重跑通过。没有提交/推送；恢复时保留该暂存状态，源文件仍为本轮工作树。
- 验证：Core/Assembler/CLI/CCv3/Web/Action/GitHub源定向 **59文件957项通过**；全integration **42文件826项通过**；server/web/action tsc与tests tsc通过；Commons26项离线检查通过；全仓lint/deps/diff-check通过。公共JSON Schema新增缺策略/旧版本拒绝测试。浏览器现有Playground显示@examples/preview-policy与Trace，无alert。
- Recorder只读审查未发现新增校验绕过；本轮llmdoc:update沿deep/dry_run执行（status与调查输出，无stable写入/提交）。完整ci:all/conformance三运行时、完整E2E均未完成。
- 下一步：移除公开IR-only assemble回退，迁conformance runner与作者fixture，再补新Story/隐私/资料选择的跨运行时fixture并准备人工expected接受。M1间接cast/多locale与开场、M4资料/草稿构建/OAuth/协作、M5剧情编辑、M6 Harness/Jev仍待执行，DOD范围不变。

- 本轮llmdoc status：17 impacted、7 needs-review、190 unmapped；未写稳定知识或刷新baseline。


### 2026-09-30 公开组装入口与 conformance 收敛检查点

- 公开 `assemble` 现在就是 `prepareContext`：`AssembleInput` 要求完整 Artifact + Profile + TurnView；仅 IR/session 的输入在类型和运行时均拒绝。`index.ts` 不再导出内部 admission/renderer；内部 `renderPrepared` 要求 preset+prepared，删除第二套 activation/visibility、无策略默认布局和旧粗预算分支。D-184记录此收敛。
- 旧 assembler 单测已迁为完整产物测试夹具，实际经过公开入口；保留late绑定、locale、visibility、activation、media、固定/required预算、policy能力与合并规则覆盖。测试用合成策略仅存在test目录；没有给生产增加隐式默认。原先固定文本数漏掉的分隔符现在会使边界处整条可选内容跳过；Trace区分direct/required/withheld/excluded。
- Web samples测试改为buildSample完整产物；CLI、Action、Web生产消费者已使用准备路径。recorder只读审计确认renderPrepared唯一源码调用者为prepare.ts；startSession仍是独立旧IR greeting API，未据此宣称全部SDK完成。
- conformance的16个assembler/publish输入显式声明测试默认策略精确pin和依赖快照；assembler场景改TurnView，支持固定选择refs和source_texts，使用buildCreation后调用公开assemble。成功比较同时要求Trace和messages_digest；没有消息摘要的旧expected不能误通过。纯resolver用例仍测resolve。
- 没有修改任何expected或reviewed状态。29个case仍是draft；候选材料在`.llmdoc-tmp/investigations/story-v1-conformance/`，包含REVIEW、输入预检与候选输出；最终人工接受尚未进行。通过的三运行环境测试不能替代这一门禁。
- 验证：Assembler **7文件119项**通过；Core/Assembler/CLI/CCv3/Action/Web合并 **58文件951项**通过；Node/Chromium/workerd一致性 **8文件149 passed / 87 todo**。workerd存在node:worker_threads回退警告，未造成失败。server/web/action tsc、tests tsc、全仓lint、deps、diff-check通过。
- Action dist已重建；同一`actions/publish/dist/index.js`维持本任务暂存状态，`pnpm check:action-dist`通过。未commit/push/deploy。`spec/preset-v0.md`标为历史草案，`spec/story-v1.md`补统一入口与预算规则。
- llmdoc:update deep/dry_run报告`.llmdoc-tmp/investigations/story-v1-public-assembler-dry-run.md`；未写稳定知识、刷新fingerprint或commit。报告中指出的旧Action bundle与历史spec标识已修复；稳定llmdoc仍待整体验收同步。

#### 继续执行，DOD 不勾选

1. Story starts greeting/startSession、多locale模板、间接/嵌套cast及scoped refs、about闭包与Style最终顺序仍未完成。
2. Source正文发布校验/授权读取、草稿build、协作者、OAuth、对象级Contribution和对应编辑器/状态预览仍需实施。
3. 独立Harness尚未安装/接pack契约/Jev；Laya项目身份未确认，不阻塞其余独立工作。
4. conformance候选需最终人工审阅，commons内容审阅未完成；完整ci:all、全栈E2E和最终稳定知识同步尚未通过。主目标保持active。


#### 本检查点追加：实际消息审阅发现并修复早绑定身份重复

- 机器摘要一致后继续检查可读消息，008 narrator暴露“知道此事：Bob；不知道：Bob、Alice、Sam”。根因是`resolve/env.ts`的slot公共ref早绑定为已解析Bob再创建一个参与者，不能只在渲染层按显示名去重。
- 修复为复用唯一已解析`instanceParticipant`；同ref多实例拒绝`resolve.ambiguous_participant`，作者使用`{{cast:key}}`明确实例。真实双角色实例与private隔离继续保留。跨局部作用域多个实例不猜测，完整嵌套作用域语义仍待后续完成。D-185与Story v1参与者章节已记录。
- 新回归覆盖唯一ref复用、歧义拒绝、显式cast隔离以及008实际消息，现为“知道此事：Bob；不知道：Alice、Sam”。最新合并回归 **58文件952项通过**，三运行环境 **152 passed / 87 todo**；相关resolve+assembler独立175项通过。types/Biome通过，Action再次重建并暂存同一dist文件、check:action-dist通过。
- 审阅包现在包含`REPLAY.md`直接展示实际有序messages，`replay/*/replay.json`保存完整artifact/TurnView/策略/Catalog/Plan/Trace/来源，`DIFFERENCES.md`列13个场景对旧实现的变化。7个成功场景的messages及Plan摘要逐一核对，6个失败错误码不变；29候选和review入口已刷新，输入预检0issues。
- 当前没有已接受的旧expected。旧对照由独立/tmp中HEAD edab49f源码和旧输入生成，不代表已接受规范；未安装旧依赖、切工作树或accept。全部draft仍待最终人工审阅。
- 可复用教训候选：`.llmdoc-tmp/reflections/pending/2026-09-30-model-input-semantic-review.md`。实际模型消息语义需可读审阅，hash只能证明被比较输出一致；候选未晋升稳定知识。


### 2026-09-30 Story 开局、多语言与完整产物导出检查点

上一目标轮属于实际进展：公开组装收敛、角色早绑定身份修复及验收工具迁移。此轮继续实现，目标不缩减，全部DOD仍待整体验收。

- Core新增Story专用`LocalizedTemplateText`，opening/inline greeting允许string或locale map；map必须含meta.default_locale，ref保留给bootstrap引用。story_refs.templates统一为`CompiledTemplate {text,locales?}`，每locale分别编译early名称与late占位符、计入身份。Scenario bootstrap不再生成不存在的speaker:self；Character保留真实speaker。相关JSON Schema已导出。
- 新`assembler/start.ts`公开`startSession({artifact,bindings,start?,greeting_id?,locale?,judgments?}) -> {turn,opening}`。多个start需明确选择，Story禁止单独选择bootstrap备选；按inline/ref/default/null规则解析。先经Core初始化状态/进入条件，再将实际opening写入history一次；scene.opening仍仅上下文。输入不接受已有history/story来自动补齐。initialStoryTurn保留为纯初始状态助手并可接判定结果。
- CLI/Web新预览使用startSession，样例消息追加在opening之后；完整snapshot不重置。Web语言选项包含编译模板/问候语的翻译语言。组件回归验证切换开局替换首条消息、保留样例、选择德语；CLI验证多开局未选报错。
- recorder探针发现锁定ja Profile下先生成en greeting的语言分裂。已修：startup将实际语言写入turn，CLI先取显式locale→生效locked Profile→作品默认；Web锁定设置显示和执行都取locked locale。CLI和SDK回归确认opening/scene一致；显式英文仍可覆盖CLI锁定语言。
- CCv3唯一公开`exportCCv3`改为完整Artifact输入；按starts顺序导出实际inline/ref/default greeting，无消息开局保持空位置。首开局场次opening与在场part/goal入scenario；locale支持BCP47逐级匹配。缺省使用artifact锁定assembly/default_policy和聚合meta，显式覆盖仍保留。Story对象/状态/条件、分组、资料、knowing/outward、Style scope、description逐项记录loss；perspective落正文。补审又修复selectable/about/source静默丢失，明确未命中关键词时AI选材能力的降级。
- Registry export worker读取完整artifact；read endpoint支持`?locale=`且非法标签400，编译器版本改ccv3-export@1-draft。缓存helper改结构化摘要，始终绑定root Release、输出桶、semantic/lock、编译器版本、语言、精确外部Preset。真实集成用同一revision发布private/public/public三个Release，确认同semantic/lock得到独立卡片和正确root.release/blob_refs，私有卡不出现在public桶。
- Conformance 010 roundtrip现显式携带固定默认策略及快照，通过完整build→export；新增en/zh-CN Story开局跨Runtime断言。29候选均未accept；scratch审阅包已刷新7成功messages/Plan、6错误与010实际card/loss。010新增work.description、policy.layout/requires损失属显式固定策略/目录语义，不是恢复导入时丢弃的策略原文。
- 最终验证：包/Action/Web **61文件970项通过**；完整integration **42文件828项通过**；Node/Chromium/workerd **8文件158 passed / 87 todo**。Core独立560项、CCv3独立98项通过。workerd仍有node:worker_threads回退警告，未造成失败；29个draft的87 todo不算人工接受。
- server/web/action构建类型检查、tests tsc、全仓lint、deps与diff-check通过。Action bundle重新生成并暂存同一个dist文件，check:action-dist通过。未commit/push/deploy/运行模型。
- D-186/D-187及Story v1已同步本轮契约；llmdoc:update为deep/dry_run，报告`.llmdoc-tmp/investigations/story-v1-start-session-dry-run.md`。稳定llmdoc/metadata未更新，不能宣称G2完成。

#### 后续仍必须完成

1. §15发布产物所需capabilities的自动计算/消费，以及间接/嵌套角色实例、局部作用域、about闭包编译与Style最终顺序，尚未全面实现。
2. 资料正文发布锚点/摘要校验与授权读取，草稿build、OAuth、作品级协作者、对象级Contribution及对应编辑器流程待接通。
3. 独立Harness仍只是已clone和执行包，pack消费/固定决策回放/Jev适配未实现；Laya身份仍缺明确项目链接。
4. 完整ci:all、平台全栈E2E、commons人工内容审阅、conformance最终expected接受和稳定知识同步未完成。目标继续active。


### 2026-09-30 能力声明与资料正文发布/消费检查点

- 所有Artifact必带排序去重的capabilities，由最终IR/Catalog/Story/生效策略自动计算；作者不能自报，未使用依赖不计入。补实验能力、cast remove provenance、vars/start.reached所需条件能力。checkCapabilitySupport对缺失/未知能力报告unsupported；degraded必须显式给出原因，不猜测Runtime支持。
- text/plain、text/markdown资产上传保留原字节、摘要和BOM/CRLF；严格UTF-8、无NUL、8MiB上限，文本不进入图片扫描器。asset_meta图片尺寸可空，迁移0014仅在隔离测试数据库执行。
- Source仅支持mirrored文字资产。发布前验证全部正文摘要、格式、分节锚点；BOM/换行规范化发生在校验摘要之后，标题匹配支持NFC等价。根作品新资料必须来自发布者本人ready上传、同作品既有资产或授权依赖闭包。审计发现namespace全员上传授权过宽，已收窄并以同namespace不同上传者回归证明；OIDC新增作品资产grant仍未实现。
- GET /v1/releases/:release/source-text按精确Release及完整Source ID授权读取，每次检查可见性、动态黑名单、tombstone和实际资产状态，返回原始文本及source/asset/digest，private/no-store。不能以任意digest取得资料。
- assembler新增sourceRequests，与最终prepare使用同一Catalog/Plan验证，仅返回当前视角required/direct/selected资料。Web支持描述目录、资料/分节选择、按需加载、身份/摘要校验、重试与旧异步结果抑制；草稿缺正文服务明确报source.draft_unavailable。未做真实网页全栈验收。
- CLI Markdown include收窄到明确文本字段，locator/origin/source/data/pin/about/ref不再被当成本地文件读取。补literal locator回归。
- 验证：包/Web/相关服务端 **65文件1017项通过**；完整integration **43文件831项通过**；Node/Chromium/workerd **8文件167 passed / 87 todo**。Source独立上传/发布/授权18项通过，server严格解码6项通过。全仓typecheck/lint/deps/diff-check通过；Action重新生成并仅暂存既有dist/index.js，check:action-dist通过。workerd仍有worker_threads fallback警告。
- conformance scratch全量刷新：29候选预检0问题；7成功/6错误及010卡片重算一致。capabilities导致6个artifact和7个Plan摘要变化，实际messages摘要不变；未accept expected。参见story-v1-conformance/capabilities-refresh-diff.json。
- D-188/D-189、Story v1已记录本轮契约。llmdoc:update deep/dry_run报告为.llmdoc-tmp/investigations/story-v1-source-text-dry-run.md；稳定知识尚未同步，全部DOD仍待整体验收。无提交、推送、部署、公开发布或模型调用。

#### 下一步与保留缺口

1. 独立Harness真实pack消费、固定决策/状态/Plan回放及Jev typed适配。Laya仍需明确项目链接，只阻塞其adapter。
2. 间接/嵌套角色实例、局部作用域/about闭包、Style最终顺序；草稿build/正文、作者上传流程、作品级asset grants、OAuth/协作者/对象级Contribution和结构化Story编辑器。
3. 完整ci:all、平台全栈E2E、commons人工审阅、conformance最终expected接受和稳定知识同步。目标active，不缩减验收范围。


### 2026-09-30 独立 Harness SDK 消费与固定决策回放

- char.pub新增`sdk:pack`/`scripts/pack-runtime-sdk.mjs`，构建core/assembler/contracts到新的输出目录，拒绝覆盖既有快照，输出精确包字节SHA-256、源码HEAD和dirty标记。三包明确携带Apache LICENSE，修复实际pack中Core缺许可证。未发布npm。
- Harness `/Users/djj/code/char-harness` 的`third_party/charpub`保存三份实际tarball、manifest与LICENSE；没有跨repo源码alias或复制schema。根overrides/lock固定直接和间接SDK，普通Node import已确认解析到本仓node_modules中的SDK dist出口。
- 新私有`packages/experimental/charpub-roleplay`库提供createReplay/appendCommand/replay。使用公开SDK初始化/confirm/enterScene/setPresent/选材/组装，玩家自由输入只进history。记录完整本地输入、命令、精确Plan和状态/消息摘要，回放重新执行；重复ID同内容幂等、变内容冲突，未知判定不能触发not分支。取消检查发生在提交前；同步函数不宣称中途可抢占。
- 每个per-agent命令必须显式视角，Alice秘密不进入Bob消息。开局语言优先显式→Profile→默认，与已修的SDK消费者一致。固定资料只在选择后进消息，实际hash仍经SDK校验。输入和完整离线log含私有资料，不能直接发送角色模型。
- 根`pnpm run test:roleplay`执行tarball校验、9项Node/tsx行为测试、相关tsc与三个纯库编译、1项plain Node编译产物消费测试，全部通过。`pnpm run constraints`通过；char.pub最终lint和两仓diff-check通过。日志`/tmp/char-harness-roleplay.log`、`/tmp/char-harness-constraints.log`。
- 依赖安装最初filtered/ignore-scripts，后续pnpm11的constraints启动自动补全全workspace并运行既有allowBuilds中的node-pty/koffi、spawn-helper与lefthook安装脚本，均成功；未启动上游应用或模型。不能记录为“全程未执行安装脚本”。
- llmdoc:update仍deep/dry_run，报告`.llmdoc-tmp/investigations/story-v1-harness-sdk-dry-run.md`。独立Harness执行包已更新。H1-H4仍未整体验收：唯一正式Session消息投影、真实profile组合/重启恢复、Jev adapter、Laya身份及在线质量均待做。char.pub原M1–M5与最终人工验收缺口保持不变。


### 2026-09-30 Jev 判定/渐进选材与完整证据回放

上一目标轮为真实进展（SDK打包消费与固定决策回放）；本轮继续用户明确要求的Jev实现，未缩减char.pub原范围。

- 独立Harness私有roleplay包新增`src/jev.ts`，固定`@typesafe-ai/sdk@0.6.0`及pnpm lock。显式config模型、概率阈值、总超时、完整请求预算/max_requests；构造不请求、不读环境密钥；全部协议测试使用mock Fetch，未调用在线模型。
- judgeStory定位真实作者target/path叶子并本地化，使用当前视角history/focus作证据。显式阈值间为undetermined；失败不变成false，不执行Story确认。selectContext批量Noul实现多选/空选，只有SDK验证通过的expand才加载浅层目录；每次只发送初始或新展开目录，不重发整棵树冒充一次计费。候选正文、vars/knowing/bindings/overlay不发送。
- 请求与响应体等待都受同一操作超时；故障返回undetermined/skip，skip清空候选选择且保留已有曝光。取消直接拒绝，不产可提交结果。预算包括完整request JSON及反复发送的视角history，SDK目录预算独立约束。raw错误文本/headers不进入日志，endpoint只记digest。
- 回放升级v2：完整provider Plan保持身份、配置、排名/分数、展开顺序及fallback；decision-record独立保存请求、typed结果、实际模型/usage与原始JSON摘要。judge校验命令前态，selector校验命令后态；外部provider结果缺证据拒绝。原fixed/manual输入保留。模型开局receipt接口尚未实现，初始化明确拒绝未记录模型判定。
- `commandPreparation`提供不提交的前/后态接口。共享真实build fixture覆盖两层group，`tests/jev.test.ts.snapshot`固定实际模型请求。日志含完整私有输入与证据，不能直接发送给角色模型；hash只验证一致性，不提供外部真实性保证。
- 最终`pnpm run test:roleplay` **26项源码/协议测试 + 1项plain Node编译消费全部通过**，三SDK tarball hash、包tsc、三个纯库tsdown通过。严格NodeNext测试类型检查、全包定向oxlint、workspace constraints、diff-check通过。证据`/tmp/char-harness-jev-all.log`、`/tmp/char-harness-jev-tests-types.log`、`/tmp/char-harness-jev-lint-final.log`、`/tmp/char-harness-jev-constraints.log`。
- H1–H4仍未整体通过：真实profile/Session唯一投影、启动判定收据、持久化恢复、在线模型质量和Laya身份仍待做。主仓间接cast/scoped refs/about/Style顺序、草稿build/OAuth/协作者/Contribution/作者编辑器、全栈与人工conformance/commons审阅均保持待验收。没有提交/推送/部署/模型调用。

- 本轮只读审计复现SDK在HTTP204空响应返回undefined时的摘要异常；已修为记录invalid-response且省略不可编码摘要。新增selector与judge空响应回归；最终合计27项测试、typecheck和lint通过。
- llmdoc:update为deep/dry_run，报告`.llmdoc-tmp/investigations/story-v1-jev-receipts-dry-run.md`；20 impacted、7 needs-review、260 unmapped，未写稳定知识/metadata。下一步Session接缝只读证据：默认agent/request不可改messages，现有message projection只能替换既有surface节点，不能直接承载任意PreparedContext顺序；应继续核实独立roleplay driver与profile，不把完整消息塞入历史造成重复。


### 2026-09-30 真实 Harness Session / Roleplay 基础 Profile

上一轮是实际进展（Jev/完整证据回放）。本轮在独立Harness实现持久Session请求闭环，没有在char.pub托管游玩。

- 新私有`packages/experimental/charpub-roleplay-runtime`复用Session协议、实际JSONL write handle和ctx.llm.prepareCall。独立三类required事件opened/requested/settled，模型输入严格来自已记录requested；没有默认coding loop/systemPrompt/tools，也不拼generic Session.deriveMessages。
- 请求先flush再发模型，成功settled才推进完整剧情状态/助手历史；失败/取消不推进。恢复pending标interrupted不重发；同ID+原始config重试返回原结论，变更冲突；同会话并发拒busy，卸载取消并等待close。实际落盘失败允许结果不确定，重试先核对同ID，不假称回滚。
- 无新增同步Session.snapshotEvents生产读；每次由SessionHandle显式异步read和typed event append/flush驱动。事件完整JSON和原始stream总字节分别限额。输出预算校验profile reserve；只接文字，成功流必须唯一末尾stop。已经stop的会话拒新生成，但结尾本次回复可完成且可继续inspect/预览。
- 离线库新增内部response操作与prepared_turn，记录助手history无需用下一轮预算再组装。角色history当前是共享场景对话，不能当私聊隔离；prepared assistant传输来源是显式synthetic，实际新模型route/原SDK来源保留在日志。
- 实际Loader审计发现两问题并修复：create取得header后晚取消留下空会话、投影允许stop后继续text/第二个finish。均补回归。原始路由与provider解析后的配置同时绑定，避免换model复用旧ID悄然返回旧结果。
- Runtime包同时提供Cordis bundle和PROFILE.md。真实initProfile/loadProfile('roleplay')/composeEntries再经Loader挂载四项白名单，测试只加fake provider，实际JSONL create/submit/inspect成功；没有增加bin或默认coding依赖。不是已发布的CLI/Web游戏客户端。
- 最终`pnpm run test:roleplay-runtime` **18项通过**（纯投影10、真实组合7、命名profile1）；`pnpm run test:roleplay` **27源码/协议 + 1编译出口通过**，本輪合计46项。native flock实际构建；Runtime包tsc、全部runtime测试严格NodeNext typecheck、相关oxlint、workspace constraints及diff-check通过。profile测试缺上游声明已由定向构建app-boot解决，无完整CLI/桌面构建。
- 持久类型确认`2026-09-30-charpub-roleplay-events`通过工具生成英中记录及inventory；3个root-added无需Session版本提升，事件不可ignorable。`persistence-changes --check`通过65 roots/9records，`gen-persistence-catalog --check`最新。现有历史记录未重写。
- 证据：`/tmp/char-harness-runtime-final.log`、`/tmp/char-harness-runtime-replay-regression.log`、`/tmp/char-harness-runtime-tests-types-final.log`、`/tmp/char-harness-runtime-lint-final.log`、`/tmp/char-harness-runtime-persistence-check.json`。实际有序模型输入snapshot在新包tests/composition.test.ts.snapshot；无需在线key。
- 独立Harness H1/H2已有实现/验收证据；H3/H4仍待整体完成（Laya身份/开局receipt、分发/完整客户端、最终相关doc gates）。主仓M1–M5未完项仍完整保留。无提交/推送/部署/在线模型调用，稳定llmdoc未同步。
- llmdoc:update维持deep/dry_run，报告`.llmdoc-tmp/investigations/story-v1-harness-runtime-dry-run.md`，已收齐46项及持久化门禁证据；未写稳定知识/metadata。

### 2026-09-30 Style 最终呈现、嵌套范围与人物歧义检查点

上一轮已完成独立Harness基础profile/Session闭环；本轮返回char.pub主仓组合契约，保持M0–M6完整范围。

- Assembler最终消息按Style旁白→当前场次→参与者排列，同owner按作者边顺序、Style自身片段及嵌套路径排列；不同owner保持IR实例遍历先后。只重排Style呈现位置，预算仍按原required/direct/selected优先级；实际消息成本按新排列计数。没有改变Preset布局权威。
- 独立审计实际复现嵌套Style丢失Alice范围、进入Bob模型消息，已修。Core继承外层使用scope/owner，新增可选style_use.path存内部GraphInstance owner/order/combine；View逐层replace，内部替换不删除父文本，外部替换连同子Style生效；独立根层避免rootStyle的第一条真实边误伤根文本。派生capabilities同时覆盖path内replace。JSON Schema已导出。
- 公共SpeakerRef不再first-match：dialogue/private.to/perspective的claim/belief裸ref多participant候选时明确ambiguous_participant，要求显式cast/slot；Character内部自身ref保持当前实例。此为有意破坏性修正，已向用户同步旧含糊内容将构建失败。
- 新style-order.test.ts **10项**检查实际有序messages/source、per-agent、Selector rank与紧预算、Character自带口吻、嵌套继承/两层replace/rootStyle。story-instances新增5项人物歧义回归。recorder另实际重放Bob消息泄漏及rootStyle/重复引用探针，漏洞关闭，2文件20项独立复核通过。
- 最终包/Action/Web **69文件1099项通过**；全仓typecheck、lint、deps、diff-check通过；跨Node/Chromium/workerd **8文件167 passed / 87 todo**。现有workerd worker_threads fallback及Web localStorage警告未导致失败；todo仍是29个未最终接受的规范候选，不代表已验收。日志：/tmp/story-style-final-tests.log、/tmp/story-style-final-types.log、/tmp/story-style-final-conformance.log、/tmp/story-style-lint.log、/tmp/story-style-deps.log。
- Action bundle重建，仅更新此前已暂存的dist/index.js，check:action-dist通过。无commit/push/deploy/npm发布或在线模型调用。未重新运行服务端全integration/全栈，此轮主仓改动未打入Harness的既有不可变tarball快照；后续对接新版SDK时须另pack新快照并回归，不能称Harness消费了当前dirty源码。
- D-193及Story §5/§10已同步。llmdoc:update仍deep/dry_run，报告.llmdoc-tmp/investigations/story-v1-style-order-dry-run.md；稳定llmdoc与metadata未更新，pending reflection保持pending。

#### 下一可执行切片（已实际复现）

1. 公共内容/Source引用按声明实例实际依赖闭包解析，再做唯一性校验：当前A未依赖B却可在根把A/B作为兄弟拼装后引用B，且重复嵌套的自引用可能产生假歧义。报告/可重放probe：.llmdoc-tmp/investigations/story-v1-composition-next.md。
2. 间接cast仍出现3个participant却只有1份角色正文、参与者override静默失效；直接cast和嵌套Scenario各自cast隔离已验证正常。需在graph/env统一实例分配，不能依多路径first-match。about仍接受不存在/闭包外目标，其片段/人物/作品三种地址需统一编译。
3. 草稿build/正文、作品asset grants、OAuth/协作者/对象Contribution、结构化编辑器与作者E2E未完成；Harness模型开局receipt/Laya身份/分发、全ci:all/commons审阅/conformance接受/稳定知识同步仍待做。DOD保持原范围、目标active。

### 2026-09-30 声明实例引用闭包与 about 编译检查点

上一目标轮为实际进展（Style与人物歧义修复）。本轮继续主仓组合契约，未缩小Story v1范围。

- `catalogScopeInstances`基于IR真实graph.edges遍历声明实例自身及依赖；公共CatalogRef候选先限此集合，再验证唯一性。修复A未声明B.source却被外层A/B兄弟组合补合法，以及重复A内自身公共引用的假歧义。仍允许根Story跨子树引用、明确cast引用；不使用会在多cast重复的via前缀猜归属。
- 新`CatalogIndex.about`可选静态索引保存from/ref/typed target（fragment、participant或work）。`#id/@work#id/cast:key#id`为片段，`cast:key`为当前声明实例人物（含late），裸@work为作品实例；缺失、歧义、越界或已删除目标拒绝。实际未输出的片段不编译链接，IR保留原文。`catalog.v1`自动覆盖存在关联索引的产物；schema已导出。
- about不加入激活、knowing或Selector目录。真实回归使用Bob视角非空目录与实际messages证明：公开线索关联秘密不泄露秘密目录/正文，也不自动激活。typecheck发现初版测试错传CatalogBuild而非其catalog，已纠正并新增实际view/candidates断言，修正后17项prepare测试通过。
- 独立recorder跑3文件36项通过，另实际探针确认相同via的两个cast仍使用各自依赖；override add遵循canonical-model已有“被引用Creation语境”，不借父作用域。未发现新的确定漏洞；报告`.llmdoc-tmp/investigations/story-v1-reference-scope-dry-run.md`，deep/dry_run，无稳定知识/metadata写入。
- 包/Action/Web **70文件1115项通过**；最终改进的privacy与引用断言分别17/8项复验通过；全仓typecheck/lint/deps/diff-check通过。跨Node/Chromium/workerd **8文件167 passed / 87 todo**；87 todo仍为29候选未最终接受，未accept expected。日志`/tmp/story-scope-{tests,types,conformance,privacy,reference-tests,lint,deps}.log`。既有workerd worker_threads/localStorage警告仍不影响结果。
- Action重建并只更新既有暂存dist/index.js，check:action-dist通过；未commit/push/deploy/npm发布/在线模型调用。未重新运行server完整integration/全栈。本轮新SDK字段尚未替换Harness的不可变tarball快照，后续需要新pack与消费回归。
- D-194与Story §3/§4/§13/§15已同步。DOD全范围保留，目标active。

#### 下一步完整切片

1. 实现间接cast，不以禁用跨Scenario复用代替目标。investigator报告`.llmdoc-tmp/investigations/story-v1-indirect-cast-plan.md`明确需要分开角色所有权、词法introducedBy和引用可达边，基于cast展开前原引用路径克隆完整角色子树；保留原edge的bind/params/select/override，修render覆盖权限/来源、头像实例和phantom participant。仅真实多路径/外部身份歧义时报错。
2. about已有Core发布链接契约，但作者编辑器双向导航尚未接入。草稿build/Source读取、作品asset grants、OAuth/协作者/对象Contribution及完整结构化作者流程仍待做。
3. Harness SDK新快照对接、开局receipt/Laya身份/分发，完整ci:all/全栈、commons人工审阅、conformance最终接受和稳定知识同步仍未完成。不得用本轮纯计算测试宣称这些流程已验收。

### 2026-09-30 间接 cast 与跨 Scenario 定义复用检查点

上一目标轮为实际进展（引用闭包与about编译）；本轮完成已复现的间接cast身份/正文分离问题，未把跨Scenario复用从目标中移除。

- `loadGraph`先验证作者引用模板树，再`materializeRoles`规划每个Scenario实例的唯一原始路径。相同定义双cast复制整个角色子树，World前缀一份；两个真实作者路径即使同Release也报ambiguous_cast_path。模板与最终展开均保留5000实例/32层限额。
- 内部parent只作词法引入，children是reference可达；独立cast.owner表归属。IR新增graph.cast_edges与cast.introduced_by，Catalog闭包合并真实引用/角色边并按key去重。跨Scenario副本不回接nested引用闭包，不继承nested的cast.override，原入边bind/params/select/override仍保留。
- Environment从真实cast实例建立participant/头像，不再用firstInstanceOf或父cast同ref猜配。公共slot/speaker查词法范围；显式绑定保留外部角色，子树self指新副本。render区分Edge与cast声明者，间接intrinsic force覆盖由Scenario授权，override/remove来源正确归声明者。
- investigator实际发现同层Guard/Dog声明顺序影响词法父候选，初次冻结后又发现Middle派生Guard污染Top原路径。最终在所有cross-copy展开前冻结原候选，并禁止其登记到任何祖先作者路径observer；复制内部Scenario自行建立局部scope。两种顺序、三层组合与真正双原角色歧义4探针均验证通过，报告story-v1-materialize-review.md/final.json。
- recorder发现既存late cast类型遗漏：persona能绑定character-only槽。已按lateSlots.accepts校验并补character/persona正反测试；原probe现正确拒绝/接受。没有留到Runtime才检查。
- 新Core `indirect-cast.test.ts` **13项**覆盖完整子树/独立资产头像/精确Source与StoryRef、params/select/两层override、AU与provenance、跨Scenario与两层nested、词法self/cast、原上下文与派生副本隔离、late类型和展开限额。新增conformance `instances.test.ts`实际检查front/back私有messages及专属Style只出现一次，已显式加入browser/workerd入口。
- 最终包/Action/Web **71文件1128项通过**；全仓typecheck/lint/deps/diff-check通过。Node/Chromium/workerd **11文件173 passed / 87 todo**，新增2场景实际在三个runtime运行；87 todo仍未人工accept。既有workerd worker_threads回退与Web localStorage警告不影响结果。日志`/tmp/story-indirect-{tests,types,conformance,lint,deps}.log`。
- 最后late类型修正后的服务端完整integration重跑 **43文件831项通过**，终态见`/tmp/story-indirect-integration.log`。Action重新构建，仅更新此前已暂存dist/index.js，check:action-dist通过。无commit/push/deploy/npm发布或在线模型调用。
- D-195、Story §5/§13与生成schema已更新。llmdoc:update为deep/dry_run，报告`.llmdoc-tmp/investigations/story-v1-indirect-cast-dry-run.md`；稳定知识/metadata未写，原reflection待最终处理。

#### 后续工作

1. 转入Registry草稿build、草稿Source正文授权与作者上传闭环，调查由investigator记录story-v1-draft-build-next.md。OAuth/作品协作者/对象Contribution、about双向导航、完整Story编辑器和作者E2E仍保留。
2. 当前graph/实例/关联字段尚未打入Harness旧不可变SDK快照；后续须新pack并回归消费，不覆盖旧tarball，不声称Harness使用当前dirty源码。模型开局receipt/Laya身份/分发门禁仍待做。
3. 间接cast新增IR元数据使旧conformance scratch审阅包的Artifact/Plan摘要不再代表当前源码；最终accept前须刷新实际messages/inputs/Plan/Trace。完整ci:all、全栈、commons审阅、conformance人工接受和稳定llmdoc同步尚未完成。M0–M6/G1–G2不据本轮局部证据整体勾选，目标active。

### 2026-09-30 草稿产物身份、共享纯校验与根资产授权检查点

上一目标轮为实际进展（间接cast）。本轮完成Registry草稿任务的身份/校验前提及发布资产授权修复；未创建草稿任务表、迁移、TTL或编辑器调用，M0–M6完整范围保持active。

- Core新增dbld前缀和严格Release/DraftBuild互斥身份。三类Artifact根、内容IR/节点/资产/fragment、策略根/块、Trace及CCv3保留真实origin（dbld/rev/expires_at），内部map用真实build key。依赖、ExactRef、lock及默认/锁定策略保持已发布身份；草稿只能private。身份解析不代表Registry授权，也不自行签发ID。
- checkDraftBuild与checkPublish共享纯内容校验，无假Release、label或idempotent输出；两者都检查资产ready/quarantine、blocked、license及闭包。cast override现同Edge override计入改编检查，补ND许可拒绝回归。
- 发布读取新增requirePublishedArtifact及Registry root Release/semantic digest校验，Web Release读取/Picker拒绝草稿。recorder实测初版PublishedResolvedPreset仅检查根而遗漏块来源，且guard的assembly??default选择跳过另一策略；已同时修schema及遍历两条可分发策略，混合合法正例/隐藏draft负例回归通过。
- 根Source归属改用明确BuildIdentity，作者fixture支持content-self/preset-self草稿；实际开局、已选Source正文、组装及CCv3保持草稿身份。新增Core14、Assembler2、CCv3 1项；跨三个runtime新增nested draft真实messages场景。Web/CLI的旧LOCAL_RELEASE预览未移除，不把Core底座称为真实作者闭环。
- investigator纯probe发现无Source的presentation资产在旧门禁下完全不查grant；统一assertRootAssetOwnership现覆盖所有artifact kind的根mirrored资产。本人ready结果blob/thumbnail/成功import derived、授权依赖mirrored、同作品非tombstone历史mirrored可授予。外链不授予私有字节。recorder另确认blob_refs含linked，因此历史只据它定位，再readArtifact核验availability；不把索引当授权证明。
- 发布worker在授权闭包/checkPublish后、Source读取/复制前调用通用grant。Source正文和锚点另验。原测试只插入ready元数据现补完成上传fixture；新root-asset-ownership.test.ts **11项真实API签名上传/processUpload/PNG import/worker/CAS集成通过**，拒绝不同用户的Character头像/context/Preset图片、linked依赖/历史转换及tombstone历史，检查被拒私有字节未复制公开；正常本人/导入/历史/授权依赖成功。无真实生产外泄测试。
- 身份slice包/Action/Web **74文件1146项通过**；Node/Chromium/workerd **11文件176 passed /87 todo**。最终含授权修复的完整server integration **44文件843项通过**；全仓typecheck/lint/deps/diff-check通过。既有workerd worker_threads/localStorage及测试未配置服务提示未导致失败，87 todo仍未最终人工accept。日志：/tmp/story-draft-tests.log、/tmp/story-draft-conformance.log、/tmp/story-grants-final-{integration,types,lint,deps}.log。
- Action已重建并仅更新此前暂存dist/index.js，check:action-dist通过（/tmp/story-draft-action-check.log）。本轮无commit/push/deploy/npm发布、真实数据库迁移或在线模型调用。Harness旧SDK不可变快照未更新。
- D-196/D-197及Story §14/§18已同步。llmdoc:update维持deep/dry_run，报告story-v1-draft-identity-dry-run.md与story-v1-asset-grants-dry-run.md；稳定llmdoc/meta未写。pending两项reflection仍待最终处理，新增分发来源候选同时记录隐藏策略及linked索引授予教训。

#### 下一步：真实草稿构建与作者闭环

1. 按`.llmdoc-tmp/investigations/story-v1-draft-worker-next.md`解耦loadRegistryState对ReleaseRow仅为label的依赖，建立独立dbld表/队列/重投/final-failure/过期删除。原子固定draft.version对应Revision及精确default policy，复用checkDraftBuild、通用asset grants、全部Source正文与作者测试。当前未落任务/API，不得跳过。
2. 草稿payload建议build专属private key，过期只撤销/删除本build payload；不能因Release blob_refs缺记录删共享CAS资产。现CAS signedGet上限5分钟而spec要求15分钟，private对象缓存头也需专门处理。完成/删除竞争及到期后不得复活，签名受剩余寿命限制；共享Source已签URL不能承诺立即撤销。
3. 再接Web资料上传→保存版本→Registry build→授权Source→Preview。CLI纯本地预览身份需明确设计或接Registry；不能将LOCAL_RELEASE换成随意mint dbld伪装服务端构建。OAuth/作品协作者/对象Contribution、about导航和结构化编辑器/E2E仍待做。
4. SDK新快照pack与Harness回归、模型开局receipt/Laya项目身份/分发、完整ci:all/全栈、commons审阅、conformance人工接受与稳定知识同步保持原DOD，不能用本轮局部门禁整体勾选。

### 2026-10-01 Registry 草稿构建生命周期检查点

上一目标轮为实际进展（草稿身份与通用资产授予）。本轮继续完成服务端真实构建链，不把它等同于编辑器/OAuth/完整Story作者体验。

- 新draft_builds表与0015_blue_preak迁移，记录Revision、requester、draft version、builder/config digest、固定default policy、结果摘要/报告及expiry。没有新增Release行、label、搜索或依赖目标。迁移由Drizzle生成并审阅，只在隔离测试DB执行；未迁移真实部署。
- POST草稿build锁draft行、核对If-Match整数，在同一事务内调用接受Executor的createRevision（嵌套savepoint）并插build/queue/audit。草稿身份按当前作品强制重建。默认policy请求时固定；同work语义Revision/config有效pending/ready可复用，ready重跑授权与内容检查。限额env默认20个保留、60次/小时，删除不删除请求历史。
- loadContentRegistryState从Release label状态解耦。worker在执行时重查账户banExpires、namespace/creation权限；read_only推迟。调用checkDraftBuild、授权closure、通用asset grants、所有Source正文/锚点与作者assembly_tests。S3/DB临时异常走队列重试，终次失败callback写failed；draft.requeue与draft.expire实际在processes/modules注册并定时调度。
- DraftPayloadStore复用S3配置，private build专属dbld/固定payload名，IfNoneMatch禁止同build同名改字节；读取复算摘要。签名最长900秒且受剩余寿命限制，对象与签名GET均private,no-store；共享资产必须从已授权Artifact定位，只能private/public桶，不能传任意HTTP digest。
- GET轮询/artifact/Source/assets、owner DELETE已接Registry模块。读取缓存仍验证当前精确依赖授权/blocked/asset status/grants；GET与ready复用持build行锁覆盖异步检查/签发，worker和DELETE同锁。DELETE先提交不可访问状态，再立即清专属payload；清理失败202后定时重试。到期清专属payload和详细report，不删共享CAS或Revision历史；旧共享asset URL可能仍在剩余TTL内有效。
- recorder审计复现设计中的两项风险并修复：owner检查早于可见性导致403泄漏、读取旧ready后并发删除仍可签名。独立draft-build-race **2项**通过真实pg_stat_activity观察DELETE等行锁；GET完成后DELETE成功，后续无新签名且旧payload URL404；匿名真实/随机ID均404。测试初次观察用owner角色看不到app会话，改同app角色后取得实际锁证据，没有用固定sleep代替证明。
- 新draft-build/draft-payload **22项真实integration通过**，涵盖Source上传→构建→实际产物/资产签名下载、保留草稿来源、零新增Release、If-Match并发复用、固定Revision/default policy、blocked/私有依赖撤权、read_only、删除/expiry保留共享字节、临时存储失败/final failure及pending requester撤权。
- 首次完整服务端integration **47文件867项通过**；pnpm test **105文件1753项通过**（包含server-unit/admin，口径大于上轮74文件1146）。全仓typecheck/deps通过；lint仅生成snapshot格式差异，按Biome格式化后通过；Action重建与check:action-dist通过，仅保留原dist/index.js暂存。日志/tmp/story-draft-lifecycle-{integration,unit,final-types,final-deps,lint,action-check}.log。另补配额/重投定向测试，结果在后续补记。
- D-198与Story §18.1已写接口/锁/存储/TTL边界。llmdoc:update保持deep/dry_run，无稳定知识/metadata提交；新增2026-10-01-draft-lifecycle-authorization-and-races反思候选，原两项仍pending。无commit/push/deploy/npm发布/在线模型调用。本轮未改Core消费算法，不重跑旧conformance作为新验收，也未刷新Harness旧SDK tarball。

#### 下一步

1. 将Web编辑器的保存flush/version与真实Registry build串起来，替换浏览器LOCAL_RELEASE，支持pending/failed/expired与取消迟到响应，Source上传及草稿Source读取；作者预览仍只用合成输入、不调用模型。当前后端可用不代表前端已接入。
2. 明确CLI本地预览身份并移除假Release（不可伪mint Registry dbld）；作品协作者/OAuth scope与client流程按§17/§18单独接集中权限，不能把现namespace maintainer当成最终作品协作者。
3. 保留Contribution对象合并、about导航、完整结构化编辑器/作者E2E、Runtime启动/游玩入口。新SDK快照pack与Harness回归、Laya身份与模型开局receipt/分发、全ci:all/全栈、commons与conformance人工接受、稳定llmdoc同步均未完成。DOD保持完整范围、目标active。

#### 本轮终态补记

- 配额与真实任务重投2项补测通过：同work pending/ready复用不增行；分别验证retained与perHour拒绝、删除不清小时计数、过1小时可新建；真实pg-boss删除任务后6分钟重投，仅新增一条、再次调用去重，expired/deleted排除，重投数据实际交worker完成ready。
- 最终完整integration **47文件869项通过**（新增生命周期13+存储11+并发2，共26项）。最终全仓typecheck/lint/deps/diff-check通过；日志`/tmp/story-draft-lifecycle-final-integration.log`及同前缀types/deps，lint见`/tmp/story-draft-lifecycle-lint.log`。上述867为补测前结果，最终以869为准。

- llmdoc:update最终报告`.llmdoc-tmp/investigations/story-v1-draft-lifecycle-audit.md`，deep/dry_run；两审计问题由真实race回归关闭。报告已附Web下一步调用图及flush/version闭包风险，稳定llmdoc/meta未写。

### 2026-10-01 Web 真实草稿预览与资料上传检查点

上一目标轮为实际进展（Registry草稿生命周期）。本轮把普通编辑器接入真实草稿构建，并验证上传资料到最终上下文的浏览器流程；完整Story工作区、Contribution与OAuth未据此宣称完成。

- RegistryClient新增createDraftBuild/draftBuild/draftArtifact/draftSourceText，支持AbortSignal；下载产物先验原字节摘要，再解析并核对dbld/revision/expiry/semantic/lock。轮询绑定同一来源身份，取消停止客户端等待，不删除仍在服务端执行的任务。
- useDraftEditor改为单一串行drain。多个flush等同一个promise，保存期间的新修改按顺序提交；flushSnapshot返回实际确认的working+version，不读旧React闭包。网络失败保留待保存内容并停止循环；422需修改后重试。卸载及当前账号变化后不继续发旧排队PUT或返回快照。新增并发P/Q、失败重试、卸载和cache身份先于React更新4项真实hook回归。
- DraftPreview用flushSnapshot→POST If-Match→轮询→下载服务端产物；显示保存/检查/加载、失败/重试/取消，旧编辑预览有提示，新构建清旧产物。sourceRequests仍先做视角/选材，Release与dbld分别调用可信根对应的Source API，保持source/asset/digest三项及SDK正文校验。PreviewPanel以AbortController取消旧请求并检查当前账号。
- 浏览器loadAssemblyInput/LOCAL_RELEASE模块完全删除。AuthorTestsEditor改用真实构建报告；服务端成功report增加实际assembly_tests，builder升story-v1.2避免复用旧无回执结果。新服务端回归以真实Scenario/lateSlotKey绑定和Trace断言验证messages_digest。Contribution表单无可保存作品上下文时仅编辑fixture，不能借假Release执行；专用投稿预览仍是后续工作。
- 新资料入口仅在Core允许的Character/Scenario/World/Lorebook显示。文本/Markdown保持UTF-8原字节/BOM/CRLF、8MiB上限，必填标题及1–200字符description，ready后单次functional update追加context asset与Source；processing可续查，取消不承诺回收已发送字节。首版新增整篇资料，保留已有sections/多语言字段。
- 移除Source同步移除无其他Source/fragment媒体引用的独占资产声明，防止未来public发布继续复制看似已移除的文件；共享资产保留，Undo恢复定义，不删共享CAS。资料上传的身份取自渲染时actor，每个await边界与下一网络步前对当前QueryClient身份校验。实际回归先切cache再直接点击旧控件/完成reservation，确认不会请求或PUT旧文件。Avatar上传也复用该guard，预览URL cache限组件并按账号/作品定位，私有头像查询key含账号。
- recorder发现并修复edit route草稿key无账号、staleTime Infinity造成A草稿缓存/迟到响应可进入B的公共作品页面；新增实际React Query+routeTree2项证明B须重新读draft并被404挡住。账号/异步知识反思候选新增，稳定llmdoc未同步。
- mock first-class浏览器验收暴露锁定Scenario新fixture没选Preset；§14.2明确fixture省略Preset取default_policy，故没有改Core运行器语义。编辑器新建fixture显式带assembly的ExactRef并显示；不可用的默认选择禁用。升级mock服务为真实buildCreation+runAssemblyTests/DraftOrigin及JSON摘要，first-class.spec.ts **4/4通过**，不硬编码绿色结果。
- 真正fullstack新增浏览器用例：测试会话→新Character→原字节资料上传→保存→Registry dbld→先只有说明→勾选后请求Source并出现在真实messages，确认无Release。为此fullstack setup先在专用charpub_e2e库经真实发布pipeline发布Commons默认Preset，再把精确pin传API；seed检查E2E、非production、loopback和固定测试库名。最终 **1/1通过（11.5s）**，只重建隔离E2E库、没有部署迁移。截图已实际查看并保存到`.llmdoc-tmp/investigations/story-v1-web-draft-browser/draft-source-prepared-messages.png`，同目录fullstack.log；未保存测试会话密钥到报告。
- 最终包/Server-unit/Web/Admin **111文件1789项通过**，完整server integration **47文件870项通过**；全仓typecheck/lint/deps/diff-check通过。日志`/tmp/story-web-draft-{alltests,integration,types-final,lint,deps}.log`；真实浏览器`/tmp/story-web-draft-fullstack-final.log`。既有localStorage、Vite配置loader预告、NO_COLOR提示不影响验收。相关Action重新build/check通过，仍仅原dist/index.js暂存；无commit/push/deploy/npm发布或在线模型调用。
- D-199与Story §17.3已同步。llmdoc:update仍deep/dry_run，报告`.llmdoc-tmp/investigations/story-v1-web-draft-authoring-dry-run.md`；既有pending加新前端反思均未晋升，稳定知识/meta不写。本轮未改Core计算契约，不把旧87条conformance todo称为已接受；Harness旧SDK快照未更新。

#### 下一步保留完整范围

1. 解决CLI仍以LOCAL_RELEASE进行本地预览的身份：明确本地编译身份或正式Registry构建，不能随机mint dbld伪造签发；随后新SDK快照供Harness消费与回归。
2. 按§17落实完整Story场次/剧情线/时间线、开局/结局/变量/知情及渐进结构化编辑，Source分节新增/正文替换和about双向导航仍待做；当前上传整篇和预览不是整套创作体验完成。
3. Contribution对象级合并/审阅和投稿预览、Remix/续作、作品协作者、OAuth及Runtime入口保持M4/M5原目标。恢复Contribution执行须提供真实授权的提案构建，不能复活已移除假Release路径。
4. Harness模型开局receipt/Laya身份/分发、完整ci:all（本轮只跑相关浏览器用例）、全栈全套、commons审阅、conformance人工接受、稳定llmdoc同步仍待做。目标active，DOD不整体勾选。

### 2026-10-01 CLI 本地来源与 Trace 根身份检查点

上一轮Web草稿作者闭环为实际进展。本轮完成独立离线构建身份，目标保持active，完整DOD未整体勾选。

- 删除CLI伪造LOCAL_RELEASE，新增local-build origin及JCS输入摘要。摘要覆盖canonical根、规范去重并排序的精确已发布依赖、resolver标识和精确配置；排除路径/时钟/无关fixture参数。buildCreation验证receipt并以同一规范输入执行，私有根约束保持。摘要不是Artifact摘要、授权或Registry签发证明。
- local来源贯穿Artifact/fragment/asset/Preset/Trace/CCv3。Release依赖、ExactRef、lock、默认策略保持已发布身份；发布校验与Registry草稿校验分别拒local，Web草稿下载与Source API不接受本地来源冒充dbld。CLI原字节Source正文继续由显式source-texts提供。
- AssemblyTrace.ir新增必填根身份与semantic_digest，保留root地址和lock_digest；这是破坏性格式更新，只有opening而无片段时仍能定位实际根。schema导出及精确Trace断言同步。
- recorder复现初版摘要去重而编译仍消费原始重复依赖的问题；已统一canonical输入集合，并独立复验规范等价依赖合并、真正冲突拒绝。新增Core8、CLI7、Web2项与三个runtime各1项真实本地来源用例。
- 最终包/Server-unit/Web/Admin **113文件1806项通过**，integration **47文件870项通过**；Node/Chromium/workerd **14文件179 passed/87 todo**。87条候选仍未人工accept。全仓typecheck/lint/deps/diff通过，Action重建且check:action-dist通过，仍仅既有dist/index.js暂存。证据/tmp/story-local-build-{alltests,integration,conformance,types-final,lint,deps,action-check}.log。无commit/push/deploy/npm发布、生产迁移或在线模型调用。
- D-200、Story §18.1.1已更新；llmdoc:update保持deep/dry_run，报告story-v1-local-build-dry-run.md。新增build-receipt-and-canonical-input反思，五项pending均未晋升，stable/meta不写。
- Harness仍消费旧SDK不可变快照，不能将本轮Core验证称为Harness已验收。下一步先留旧Replay/真实JSONL样本，再pack新目录并更新依赖、验证实际dist消费、旧日志读取和持久化类型声明。只读准备见story-v1-harness-sdk-refresh-next.md。完整Story编辑器、Contribution/协作/OAuth、Runtime开局receipt及分发、Laya项目身份、完整ci/人工接受与稳定知识同步仍保留。

### 2026-10-01 独立 Harness 消费新 SDK 与历史样本检查点

本轮继续完成原SDK待办，独立Harness目录 `/Users/djj/code/char-harness`。新不可变snapshot为 `story-v1-bb93d2171b49cf91`，保留旧manifest/tarballs，current指针绑定manifest摘要，consumer/overrides/lock同时更新。实际两consumer installed文件逐字节匹配新包，解析dist，没有跨仓source alias。来源仍为未发布dirty工作树，不称main正式release。

- Harness已实际消费本仓间接cast/about及Release/Draft/Local三身份、Trace根来源；30个源码/Jev消费+2编译出口+1快照验证+21 runtime测试合计54通过。旧SDK升级前固定生成的Replay及真实JSONL可在新SDK恢复，原字节和摘要不变；pending恢复不重发，不能将代表样本通过称为全历史兼容。
- 快照验证拒绝不一致依赖指向、活动manifest/字节与历史字节篡改。capture旧历史的工具曾固定读取旧manifest却未核对执行依赖，现先核对实际旧locator和manifest摘要，在新安装下mkdir前拒绝；reflection补入已有候选，不新增第六项。
- 持久类型只有opened改变；工具更新尚未接受的本次实验声明，相对已接受历史仍是三项新event。保持writer、finalized记录与已提交Session代不变。补齐新包声明/配置/类型owner、README及双语和生成索引，最终doc-sync42/43通过（包含完整Host构建/doc-typecheck），唯一双语配对失败已同步中文图与两pair记录，并单独全corpus复验1164组全部通过；未重复其余已过门禁，不称单次doc-sync全绿。目标lint和两仓diff-check通过。日志 `/tmp/story-harness-sdk-{doc-sync-final,pair-final,lint-all-final}.log`。证据见 `.llmdoc-tmp/investigations/story-v1-harness-history-refresh-evidence.md` 与 `story-v1-harness-sdk-refresh-dry-run.md`。
- 主仓本轮仅补文档检查点；此前1806/870/179+87todo等结果不重跑冒充新增验收，87todo仍未人工接受。stable llmdoc/meta无改动，deep/dry_run延续；Action仍仅原dist/index.js暂存。无commit/push/deploy/npm发布/在线模型调用。

下一步保留完整目标：Harness开局决策receipt/Laya身份与分发；char.pub完整Story工作区/Source分节与about导航、Contribution对象协作、作品协作者/OAuth和Runtime入口；最后完整CI/全栈、commons及conformance人工审阅、稳定知识同步。目标active，DOD保持完整范围。

### 2026-10-01 Web Story 工作区与结构化作者流程检查点

上一目标轮完成Harness新SDK/历史恢复，为实际进展。本轮回到M5，在原有无Story专用编辑入口的Scenario编辑器里落地可保存、可构建的L1/L2作者路径；完整M4/M5/M6保持未完成。

- 新StoryWorkspace提供Scenes/Plotlines/Timelines三视图，支持方向键/Home/End切换与焦点、保留其他页编辑状态；Choose characters可展开定位设置。Cast/bindings/推荐Preset/assembly收进Story settings，诊断定位会展开祖先details。Shared background为可展开可编辑的跨场次背景，保留已有正文；新作者首先写场次与开局。
- StoryScenes支持首场次/后续场次、时间/地点/局面、继承全Cast与显式空名单、合并编辑全局part/goal与本场goal；有场次目标时先明确移除目标才能移出人物。多语言清空只影响当前locale；显式清除全语言目标有字段级Undo。开局支持标题/说明/初始场次/inline或既有bootstrap ref及默认来源，多个开局的必填说明有完整入口。卡片明确是authored模板，实际第一条消息仍由真实草稿Preview计算，不冒称未编译working已解析。
- StoryStructure可写变化、建议行动、结局、背景/计划事件与自然语言judge条件；行动关联场次且不执行效果，Ending默认on-reach与stop/continue保持SDK语义。剧情线复用场次/Beat引用；时间线支持相对顺序、并列组、键盘按钮调整和移出引用，不复制内容。已有结构化条件/效果及其他高级字段普通编辑时保留；变量/物品/知情/完整规则编辑器仍未落地，不以只读展示替代最终要求。
- 稳定对象ID不随标题变化；Story存在时Cast key只读。删除保护按Core实际语法检查嵌套条件、场次/goals、plotline/timeline、knowing、fragment视角、Style范围与self fixture（含selection/trace）。合法普通文本、转义宏、foreign fixture同名ID不误算。Cast绑定下拉不再提供self/cast宏或所有World/Style依赖；普通slot仍支持这些绑定语义。
- Undo只恢复对应对象/字段，保留期间其他改动，ID冲突不覆盖。独立审计复现删除对象后依赖再删、撤销恢复悬空；现与删除前baseline及当前错误比较，失败保留Undo，允许原未写完的正文找回继续写。进一步probe发现空display_name令canonical失败可遮蔽失效greeting.ref；现结构引用始终经checkStory、Core tokenizer和bootstrap引用检查，可解析时再加checkCreation，不伪填正文。公开Cast撤销还检查原依赖仍存在，变更后要求恢复依赖或重新选版本。
- 新建Scenario/Persona/Style/Relationship移除“Describe ...”占位正文，保留角色/slots及策略结构。编辑提示只在UI呈现；需要正文的类型由作者补齐后才能保存发布。截图发现的占位内容进入真实messages已关闭，fullstack明确断言不再出现。server-unit新1项验证九类型seed无占位；原first-class-assets发布测试补真实作者正文，没有放松门禁。
- 最终Web **33文件254项通过**；`pnpm test:integration`（integration+server-unit+coverage）**71文件1432项通过**，包括新增seed回归，覆盖率门禁通过。初次1431/1432中一项旧fixture依赖占位已修并完整重跑。全仓typecheck/lint/deps与diff-check通过；日志 `/tmp/story-editor-{web-verified,integration-final,types-verified,lint-verified,deps-verified}.log`。新helper31、Scene16、Structure6、workspace1、cast2项有行为证据。
- mock first-class浏览器 **4/4**通过，Scenario用例跟随设置折叠先展开。新增真实fullstack Scenario：新建→首Scene/人物part→开局→关联变化/continuing ending→保存→刷新→Registry dbld→补用户绑定→实际messages→下载Artifact核对Story/无Release，最终 **1/1通过14.3s**。第一轮标签歧义超时已修NativeSelect aria-label；第二轮主agent并行mock/fullstack共用dist被覆盖、读错API基址，诚实记录失败，已将fullstack build/preview隔离到node_modules/.cache/e2e-fullstack并串行复验。没有将生产API/CORS失败称为作者流程通过。
- 浏览器证据已保存并实际查看：`.llmdoc-tmp/investigations/story-v1-web-story-browser/story-author-preview.png`及同目录fullstack.log。仅重建隔离E2E数据库；未迁移真实部署。未改Core/Assembler语义或导出schema，不重跑旧conformance冒充新验收，87todo仍未人工accept；Harness快照不受本轮Web/seed改动影响。
- D-201、Story §17与VISION目录状态已同步。llmdoc:update继续deep/dry_run，报告story-v1-web-story-authoring-dry-run.md；两项Undo/共享构建目录教训补入原候选，仍五项pending未晋升。稳定llmdoc/meta未写，Action仍仅原dist/index.js暂存。无commit/push/deploy/npm发布或在线模型调用。

#### 下一步：保留完整作者与消费目标

1. 完成L3变量/物品/知情、结构化条件与效果编辑、场次关联资料、剧情线顺序编辑和开局卡片真实产物消息定位；World/Lorebook分组树、Source分节/正文替换与about导航仍待做。当前L1/L2与单人runtime角色用例不等于Alice/Bob完整发布流程已验收。
2. M4作品协作者/OAuth授权消费、对象级Contribution合并/审阅/提案预览、Remix/续作与Runtime入口保持原范围，不能把namespace成员模型当成作品协作完成。
3. Harness开局决策receipt/Laya身份/分发、最终ci:all及全栈全套、commons/conformance人工接受与稳定知识同步仍待做。目标active，不整体勾选DOD。

### 2026-10-01 类型化规则、知情与本地逻辑预演检查点

上一目标轮完成L1/L2 Story工作区，为实际进展。本轮补L3状态与规则编辑并接入真实草稿预演；完整M4/M5/M6与最终门禁仍未完成，目标保持active。

- 新story-state组件与story-state-editor helper支持bool/int/enum/set变量、Item、场次物品引用及knowing声明，按区域逐步展开；变量ID稳定、被引用变量不删/改类型，物品集合与普通字符串集合区分。知情支持初始知道/不知道/未声明、全员、入场增知与冲突提示；保留其他locale/高级数据，删除可局部撤销。
- 新story-rules组件覆盖Core全部条件节点与set/add/put/drop/learn效果，组合条件可包裹、替换、排序及Undo，typed输入约束实际变量值。不会为缺失目标伪造引用，非法整数本地保留输入并提示未应用；条件judge清空仅当前locale。接入scene.when、start.set及reached、Beat/Ending/Choice/planned-event条件、可确认对象的effects。空高级区折叠，已有规则展开。
- story-editor入站引用保护扩展变量/物品：递归规则/效果、开局、场次、self fixture；普通enum/set字符串同名值及foreign fixture不误算物品引用。Item set初值/完整赋值采用Core规定的裸ID，has/put/drop允许item/id，不用前端便利语法改变Core语义。
- 交叉审阅关闭两项Rules问题：public信息可能来自间接闭包，不能只认直接references；删除唯一external learn后的Undo用恢复候选与baseline检查，不能因当前已删内容失去候选就拒绝。状态/知情Undo还验证本地fragment/group/Source section与cast，information和lore各按自身语法。最终独立审计4文件40项通过，无新增确证阻塞问题。
- 新StoryRehearsalPanel及story-rehearsal helper使用真实构建产物、Core初始状态/条件求值/确认/进场/在场变更和状态校验。作者为judge提供真/假/未确定答案；unknown的否定仍unknown，不触发。成功确认才写效果且不可重复，stop后禁推进，suggestion仅展示。可设置合法预览变量与在场者，知情只读；预演更新实际上下文但不修改作品初值或Artifact、不写会话、不调用模型。
- Preview保存开局判定快照与当前判定，当前答案变化不重新决定已经进入的开局；组装仍只有一条真实首消息。PreviewSession key包含actor、根build身份和semantic digest，换开局清状态；外部完整TurnView不能与预演混用。预演放在MatureGate内，条件文本不绕评级遮挡，初始化失败仍可填manual答案。
- 最终全Web **37文件296项通过**（/tmp/story-l3-web-final.log），全仓typecheck、lint、deps、diff-check通过，日志/tmp/story-l3-types-verified.log、story-l3-lint-final.log、story-l3-deps.log。后续补typed preview变量2/非法9不应用/stop禁用断言，原2项预演测试再次全过（story-l3-rehearsal-final.log），全types/lint再次通过。并行编辑中一次全Web290/292旧标签失败已修正，最终296全部通过；首次lint单个unused import警告已删除，最终无警告。
- 新真实fullstack规则流程 **1/1通过12.0s，实际用例5.1s**：新Scenario→变量及judge/条件/效果→保存刷新→Registry dbld→绑定用户→真实messages→unknown/false禁确认→true确认加1一次→条件结局stop→下载Artifact核对规则→仍无Release。命令E2E_FULLSTACK=1 pnpm --filter @char-pub/web e2e:fullstack fullstack-story-rules.spec.ts；日志/tmp/story-l3-fullstack.log。截图已实际查看并存.llmdoc-tmp/investigations/story-v1-web-rules-browser/story-rules-stopped.png，同目录fullstack.log。只重建隔离E2E数据库，未迁移部署。
- D-202与Story §17同步。llmdoc:update仍deep/dry_run，报告追加至story-v1-web-story-authoring-dry-run.md；335 unmapped，scoped3owners/3impacted/0needsreview，全局22impacted/6needsreview。稳定llmdoc/meta未写，5项pending均未晋升。Core/Assembler/schema未改，Harness快照保持；不把旧87条conformance todo称为已接受。仍只有原actions/publish/dist/index.js暂存；无commit/push/deploy/npm发布或在线模型调用。

#### 下一步保留完整范围

1. 完成资料组织：World/Lorebook分组树、场次资料关联、Source分节/正文替换、about双向导航；补剧情线引用顺序、开局实际消息定位及将当前预览存作者fixture。当前规则可编可预演不等于Alice/Bob完整发布体验全部验收。
2. M4作品级协作者/OAuth、对象级Contribution合并/审阅/提案预览与M5 Remix/续作及Runtime入口继续保持原目标。
3. 独立Harness开局决策receipt、Laya项目身份及分发，最终ci:all/全栈全套、commons与conformance人工审阅、稳定知识同步仍待。DOD不整体勾选，goal active。

### 2026-10-01 引用式资料库、Source 分节与正文替换检查点

上一目标轮完成类型化规则与逻辑预演，为实际进展。本轮落实M5资料组织/分节/替换主路径，完整DOD继续active，没有把资料切片替代投稿协作或完整作者体验。

- 新ContentGroups与content-groups helper提供All/Ungrouped/分组树、直系条目多归属、嵌套引用和局部撤销；World/Lorebook主区展示，其他Creative从More options复用。标题/说明保留其他locale，Core三层/环/缺失引用规则直接应用，空正文不阻断目录操作。为此checkContentCollections参数收窄为实际集合字段并公开导出，不另写图规则。新条目留未分组，有明确去向说明。
- FragmentsEditor新增visibleIds仅过滤渲染，修改仍定位原完整数组；组内编辑不会把其他条目抹掉。引用存在时ID只读且不能删除；普通删除有局部Undo，同ID冲突、期间删除出处对象/分节或更换外部依赖时拒覆盖。保留原其他字段与编辑。Lorebook的第一层提示同步到Reference library。
- 新contentReferences统一扫描分组/Story lore/place/truth/knowing/条件/效果、片段about/source.use以及self fixture selection/source_texts/Trace；区分fragment-only与source-only语法、本地及public-self别名、Source的所有分节。普通正文、foreign fixture和其他实例同名ID不误算；未完成fixture的session/expected字段不会令编辑器崩溃。SourcesEditor整体删除也按此保护。
- SourceSections新增分节title/description/anchor、稳定ID、出处及Undo。Markdown生成先显示候选，确认后追加，保留原ID/语言/说明；text可写行范围。作者选本地原文件须与当前asset digest/size匹配，不任意fetch CAS；读取绑定actor、操作序列及Source/asset identity，账号cache先变、旧文件迟到均不能回填。旧文件/分节变化使生成proposal失效，重复或NFC等价标题不生成模糊分节。
- Core抽listSourceHeadings/extractSourceSections，materializeSourceText仍先验证实际asset/MIME/role/digest再走同一parser。纯作者提取函数不代表授权。BOM/CRLF在验原字节之后规范化；保留围栏排除、标题层级、setext/NFC和文本行范围语义，没有wire schema变化。
- SourceReplacement与source-document-editor在upload前检查全部原sections锚点，真实ready后再对最新Source/asset/sections检查并一次替换。新slot只给目标Source，其他Source/media共享旧slot不改；无引用旧声明移除，不删除CAS。ID和分节保留，可取消、续查processing、Undo；期间文件/分节/槽冲突不覆盖，其他title/summary编辑保留。只读审计发现初稿丢旧variant license/rating/alt，已改为保留旧variants、只替换default媒体类型/blob且不继承旧locator；CC-BY/mature/多语言alt独立probe与3项helper测试关闭问题。教训补入现有前端reflection，候选仍五项。
- 新ContentLinks接scene.lore：本地条目/分组/整篇/分节选择，不复制正文；原外部引用保留，可显式添加依赖内引用，构建验证真实目标。提示关联不绕可见性/知情。新增RTL用例验证多类引用、移出关系不删资料；这一新增场次控件未据World全栈用例冒称已浏览器验证。
- 最终全Web **44文件327项通过**（/tmp/story-content-web-verified.log），Core/Assembler **36文件773项通过**（story-content-core-assembler.log），Node/Chromium/workerd **14文件179 passed/87 todo**（story-content-conformance.log），87todo仍未人工接受。全仓typecheck/lint/deps/diff通过，日志story-content-types-final-verified.log、story-content-lint-final-verified.log、story-content-deps-final.log。过程中的Source测试scenario缺cast、控件label多命中、optional prop类型问题均修正后完整Web及types通过，没有降低断言。
- 真实联合fullstack **1/1通过13.6s，用例6.4s**：新World→分组/包含已有条目→上传BOM/CRLF Markdown→本地原文件校验→生成预览确认分节→替换正文→保存刷新→真实Registry dbld→只选Door分节→实际messages含新正文不含旧正文→下载Artifact核对目录/分节→无Release。命令E2E_FULLSTACK=1 pnpm --filter @char-pub/web e2e:fullstack fullstack-content-library.spec.ts；日志/tmp/story-content-fullstack.log。截图已实际view并保存.llmdoc-tmp/investigations/story-v1-content-library-browser/content-library-section-preview.png，同目录fullstack.log。只重建固定隔离E2E库，无部署迁移。
- Web测试初稿跨import Core test helper曾让tsc在Core/test误生成build/fixtures的.d.ts与.map共4文件，改用Web既有buildTestCreation后确认生成时间02:36并仅删除这4个生成文件，保留TS源码；最终lint通过。Action重建后首次check因新index尚未暂存拒绝，随后只刷新原本唯一暂存的actions/publish/dist/index.js，再check通过（story-content-action-check-final.log），不暂存其他文件，无commit。
- D-203与Story §17同步；llmdoc:update deep/dry_run报告story-v1-content-library-dry-run.md，稳定llmdoc/meta不写、五项pending不晋升。Core新增作者纯API且原解析行为一致，Harness继续使用既有不可变SDK快照，不冒称已经消费新API；本轮无npm发布、push、deploy或在线模型调用。

#### 下一步保留完整目标

1. 完整about双向导航、fragment description/selectable/outward/视角与出处编辑、剧情线顺序/开局真实消息定位、当前预览保存为fixture及Alice/Bob跨作品发布流程仍需补齐。已完成Source分节/替换不再列为缺失；生成目录当前依作者主动选择匹配原文件，可后续接已有授权构建的正文获取。
2. M4作品协作者/OAuth、对象级Contribution合并/审阅/提案预览，M5 Remix/续作与Runtime入口按完整范围推进。
3. 独立Harness开局决策receipt/Laya身份/分发、最终ci:all与全栈全套、commons/conformance人工审阅、稳定知识同步仍待。goal active，不整体勾选DOD。

### 2026-10-01 条目语义、about 双向导航与固定选材检查点

上一目标轮完成引用式资料库与Source分节/正文替换，为实际进展。本轮补M5条目元数据、关联导航和实际可选条目预览，完整M4/M5/M6及最终门禁仍未完成，goal active。

- 新FragmentMetadata/helper支持description默认语言编辑与其他语言保留、清全语言/字段级Undo、canon/rumor/claim/belief及真实speaker、Source/section出处、keyword selectable、outward及shared/private/scene/story-scene。outward和可见性在Advanced visibility内，已有声明自动展开；selectable需说明，改变激活前先关，outward为真时不切不支持的kind。不修改其他语言/高级字段；声明目标缺失显示可修，Undo不覆盖后续同字段改动。
- Source引用helper初稿仅认简写#book且限制外部两段，root审阅发现会拒绝Core合法#source/book/section与cast作用域。现支持简写/显式前缀/public/cast全部Source别名，公开闭包仍交构建，Speaker选项过滤不合法LocalRef。新增5种alias真实Core build+移除Undo回归；metadata定向17项通过，包括claim解析participant:self、outward不越private、narrator、rumor标记、story-scene过滤、出处不插正文等真实产物行为。
- 新about-editor/FragmentAbout/AboutDirectory：条目涉及/被涉及、按片段/人物/本作品查询，#id与本作@ref#id归一反链；外部引用保留原文并待构建检查。ContentGroups给子编辑器传导航，跨组切All并用稳定DOM anchor展开祖先/定位真实卡片；提供参与者/作品编辑位置入口，FragmentRow展示本地出入链接。移除有Undo，目标已删、links随后变化或依赖改版拒覆盖。
- 独立审阅发现cast:alice#secret没有本地可定位fragment，初版Undo可能在删cast后恢复悬空；新aboutRestoreError单独核对baseline/current cast key及who，删除/换绑拒、无关编辑允许。4项about测试与独立2文件10项复验关闭问题。FragmentsEditor将更新改为按原稳定ID定位当前完整数组，只合并与render baseline相比本次改变的字段，并在最新状态复查引用保护；保留过滤视图外的正文。
- 新PreviewRelatedLinks/helper用同job ContextAssemblyInput构造当前Catalog，仅真实required/direct或已暴露candidate两端且viewOf允许时呈现解析后的catalog_index.about。隐藏端点的标题/原ref/反链数均不展示；不靠trusted nodes自动展开group，budget失败closed，late离场不展示，同依赖重复实例保持完整身份。纯导航只focus产物元数据，无fetch/selection/turn/消息变更，6项真实Core产物测试通过。
- 新previewFragmentChoices用fixedSelection逐个验证作者可选fragment，排除required/direct；展示说明而不带正文，Optional entries checkbox进入现有selection→真实prepareContext。manual和普通未命中keyword不会偷偷可选，selectable的未命中keyword可选；1项真实消息回归证明勾前无正文、勾后有正文和传闻标记。Source选择/clear/目录错误与新条目/关联控件全部放在MatureGate内；related只当前暴露目录，主动固定选材可沿合约允许的路径展开，二者不混称。
- 最终全Web **49文件355项通过**（/tmp/story-fragment-web-final.log）；全仓typecheck/lint/deps/diff通过（story-fragment-{types,lint,deps}-final.log）。首次类型扫描捕获两个进行中test state/narrowing错误已修，最终不保留TS失败。没有改变Core/Assembler/schema或发布代码，不重复旧跨运行时计数冒充本轮新验收；既有87条conformance todo仍未accept，Harness固定SDK快照未动。
- 新真实fullstack **1/1通过11.3s，最终用例4.6s**：新World→新增知识条目→description+keyword selectable+rumor+about→双向定位→保存刷新→真实dbld→未命中时正文不入messages→手动选可选条目→真实正文带传闻标记→展开Related references并点击，document.activeElement准确落在目标→下载Artifact核对about完整root身份/字段→无Release。首次启动失败对应当时进行中类型问题，修正后第二次及强化实际焦点断言后的最终运行均通过。命令E2E_FULLSTACK=1 pnpm --filter @char-pub/web e2e:fullstack fullstack-fragment-about.spec.ts；最终/tmp/story-fragment-fullstack-final.log。最终截图已实际view并存.llmdoc-tmp/investigations/story-v1-fragment-about-browser/fragment-about-selected-preview.png，同目录fullstack.log。仅重建固定E2E库，未部署迁移。
- D-204和Story §17同步。llmdoc:update保持deep/dry_run，报告story-v1-about-navigation-dry-run.md：22impacted/6review/22dirty/365unmapped（阶段扫描值），scope deep3impacted0review；stable/meta/pending未晋升。仍仅原actions/publish/dist/index.js暂存，本轮无Action重建需要；无commit/push/deploy/npm发布/在线模型调用。

#### 下一步：完整作者与授权消费目标继续

1. 剧情线顺序/开局真实消息定位、把当前预览保存成fixture、非文本条目普通创作入口与Alice/Bob跨作品完整发布体验仍需补齐；诊断定位到已过滤条目/具体元数据也要连同作者恢复流程验收。about双向导航与条目语义基础入口不再列为全无，但本轮浏览器只验World路径，不能等同完整多角色发布体验。
2. M4作品协作者/OAuth、对象级Contribution合并/审阅/提案预览，M5 Remix/续作与Runtime入口保持原范围。
3. Harness开局决策receipt、Laya身份/分发，最终ci:all/全栈全套、commons/conformance人工审阅及稳定知识同步仍待。DOD不整体勾选，goal active。

### 2026-10-01 当前预览保存作者测试与精确输入闭环检查点

上一目标轮完成条目语义、about和固定选材，为实际进展。本轮把预览保存为可重跑作者测试，连同发现的canonical精确输入链路一并修正；完整目标active，未把局部测试体验当作M4/M5/M6全验收。

- 新lib/preview-fixture提供同步createPreviewFixture及需真实BuildCreationInput的verifyPreviewFixture。转换使用同一次成功preview最终input/result，严格重prepare比对，再将rank有序选择变为CatalogRef[]重放检查；保留完整TurnView（含一次实际开局、状态、judgments、presence、绑定）、profile、真实SDK tokenizer版本、ASSEMBLER、实际策略精确pin及sourceRequests需要的完整Source原bytes。不存含自身digest的Plan、不造依赖快照；Preset self要求published content root，content可draft/local self但不能钉draft/local外部Preset。
- AuthorTestsEditor和schema/导出JSONschema扩到全部Creative+Preset，Module仍禁。PreviewSession锁定配置时保存的diagnostics/profile与真实assembleArtifact输入一致，成功才保留final input+source_texts；MatureGate内按钮显式说明保存合成输入和整篇资料（包括未选章节），原测试期望不由rerun更新。AuthorTests可展开查看固定选材/保存原文。
- DraftPreview收到实际快照后核actor/current working/操作锁/owner origin expiry，按统一contracts MAX_DRAFT_BYTES（5MiB，route沿同常量）计JSON {working}字节，超限不添加；候选canonical后追加稳定唯一ID并flush确认。保存失败说明本地未确认，不误报Passed；旧编辑禁保存，新测试使旧preview明确标旧。PreviewPanel保存通知绑定mount/latestJob/actor；独立10项UI回归包括过期/缓存先换账号/编辑后失效/旧job迟到通知，均通过。
- 初次fixture helper新增回归发现完整session在canonical后变NFC/LF并剪尾空白，真实跨行keyword从未命中变命中，原expected立即失败；Source正文同样因规范化破原asset digest。Core新增Creation真实结构scope，精确保留assembly_tests[*].session及source_texts，普通normalizeValue/正文和伪路径仍按prose处理。此为有意破坏性语义修正，已同步用户摘要变化风险。
- 跟进关闭四条二次归一/比较路径：Registry buildSnapshot对已canonical root/deps直接JCS；Core merge复制已canonical JSON不再次prose-normalize；configuration after解析/摘要的Core/Web/Registry生产消费端统一normalizeConfigurationValue/configurationDigest；buildCreation同identity比对使用canonical Creation精确JSON，不让无semantic重复Release仅raw session不同被当同一输入。local-build已有digestJson正确，只补回归，无多余源码变更。Source保存→canonical→真实runner、snapshot根/dep回放、无关metadata合并、exact配置变更/冲突、重复identity拒与普通等价允许均实际验证。
- helper最终12项通过；raw链路最终10文件156项定向通过；全包/server-unit/Web/Admin最终 **140文件1996项通过**（/tmp/story-capture-alltests-final.log）。完整integration+server-unit+coverage一轮 **72文件1433项通过**（story-capture-integration.log，末尾重复构建身份收敛后以包回归补验，未冒称再次全integration）。全仓types/lint/deps/diff通过（story-capture-types-last.log、story-capture-lint-final.log、story-capture-deps-final.log），Action重建，仅更新既有暂存index.js，check:action-dist通过（story-capture-action-check.log）。
- 新Node/Chromium/workerd用例在local-build.test.ts：真实World资料BOM/CRLF/NFD/尾空白+选节+history原CRLF，不激活LF关键词，canonical保存fixture、更新local input digest、runAssemblyFixture重放正确。三runtime最终 **14文件182 passed/87 todo**（story-capture-conformance-final.log），比上一轮新增3项真实回归；87候选仍未人工accept。
- 扩展真实fullstack-content-library.spec **1/1通过14.2s，用例7.8s**：原分组/上传/分节/替换/选节流程后，显式Save preview as author test→GET真实draft核root:self/实际Preset ExactRef/固定Door选择/完整replacement原字节→Run author tests经新Registry构建+worker出现Passed:preview→GET确认expected digest未改、仍无Release。BOM/CRLF/NFD/尾空白包括未选章节真实保存。原始会话更复杂的精确回放另由helper+三runtime用例证明，不拿这个ASCII会话浏览器用例扩大证明范围。只重建固定隔离E2E库；截图实际view并存.llmdoc-tmp/investigations/story-v1-preview-fixture-browser/captured-source-test.png，同目录fullstack.log。
- Story §14.2/§17、canonical-model、assembly-assets-v0与D-205同步。llmdoc:update deep/dry_run报告story-v1-preview-fixture-dry-run.md；raw输入教训补既有build-receipt-and-canonical-input候选，仍五项pending未晋升，stable/meta不写。无commit/push/deploy/npm发布/生产迁移/在线模型调用；Harness仍旧不可变SDK，尚未更新本轮canonical与schema扩展。

#### 下一步保持完整范围

1. 剧情线引用顺序、开局卡片实际消息定位、非文本条目普通入口、诊断跨过滤视图定位、Alice/Bob跨作品完整发布体验继续补齐；当前预览保存fixture已落地，不再列为空缺。默认策略换版与旧精确测试触发聚合图单版本冲突时应显式处理，不静默重写期望。
2. M4作品协作者/OAuth、对象级Contribution合并/审阅/提案预览，M5 Remix/续作和Runtime入口仍按原目标推进；本轮配置级Contribution精确字节修复不等于对象级协作已完成。
3. Harness SDK更新/历史回放、开局决策receipt/Laya身份及分发，最终ci:all/全栈全套、commons/conformance人工接受与stable知识同步仍待。DOD不整体勾选，goal active。


### 2026-10-01 作品级共同创作、许可同意与撤权生命周期检查点

本轮推进 M4/M5 的作品级协作。goal active；OAuth、对象级剧情投稿、Remix/续作和最终 G1/G2/M6 均未完成，不整体勾选 DOD。D-206 与 Story §17.7 已同步。

#### 已落实

- 新 `0016_creation_collaboration` 迁移与四张表：作品协作者/许可接受、实际工作资产授权、实际编辑贡献者、Revision署名快照。owner邀请另一位个人namespace owner；pending不能读草稿，接受须精确许可和明确agree。许可不匹配即使acceptedAt非空也立即失权；owner保存/接受投稿改许可清同意，其他导入路径留下旧邀请可重邀刷新，同许可重邀保留有效同意。
- 中央授权新增作品collaborator、manage_collaborators/delete_request/account.list_creations，个人namespace maintainer不再等同owner，system maintainer显式例外保留。私有Creation/Release/Source/artifact/dbld及proposal集合均要求实际作品权，Token还需read scope。公开读仍允许匿名及无read PAT，不因此泄漏private版本/投稿。closure ownerNamespaces不再给collaborator或个人maintainer全namespace许可豁免。
- me/creations SQL在500条LIMIT前过滤真实owner或accepted且当前许可一致的单作品协作者，不重复、不N+1；真实测试含501条不可读新草稿，较旧的有效协作作品仍能列出。
- PUT、Revision、接受/拒绝投稿、邀请接受/撤权及dbld请求/读取/worker采用creation→draft/build锁序并重新查作品权。PUT与接受提案复用保护字段策略，authors/provenance、license/rating/rights/warnings/contribution_policy及显式资产license/rating仅owner能改，服务器追加已接受投稿署名有受限豁免。不同requester不共用pending dbld，撤权不删除CAS/合法工作资产或旧署名，已有签名仍按原TTL到期。
- grantDraftAssets只授权当前作品实际声明且actor拥有ready上传及合法衍生digest，owner和collab可以构建彼此已绑定资产；未声明历史、他人上传、linked伪引用及同namespace sibling不获授权。avatar读取与dbld都按当前作品权。
- 实际协作者编辑记creationContributors；native/contribution Revision冻结公开namespace署名，Registry Release summary/detail/list暴露contributors，Overview展示版本贡献者，与copyright authors分开。撤权/登录name变化不追改历史署名；OIDC source revision不盲目复制网页credit。
- Web作品Settings邀请/移除/重邀，个人Settings显示邀请与明确许可勾选；actor query与迟到写响应隔离。CreationDetail提供真实permissions，作品header/edit/settings和投稿list/new/review入口不再以namespace名字推断owner。collab无Publish及敏感编辑，敏感提案接受提示交owner；检查栏显示Draft checks/Ready for owner review。撤权后的401/403/404保存停止队列/重试，保留最新本地未保存稿和Copy入口，重新进入重验证。

#### 验证证据

- 独立协作资产/build最终4文件32项，collaboration-read6项（含旧许可失效、不可变公开署名）、me-collaborations4项、collaboration-management5项、collaboration-contributions14项分别通过。管理回归用真实pg_stat_activity观察权限锁等待，证明先撤权时PUT不写且accept不复活。敏感提案即使确认也403，draft/version/proposal/changeRows全部不变；authors/provenance非法提案在schema层422，不用伪DB绕过生产入口。
- 最终 `pnpm test` **141文件2024项通过**：`/tmp/story-collab-tests-final.log`。最终 `pnpm exec vitest run --project integration` **52文件904项通过**：`/tmp/story-collab-integration-final2.log`。首次广回归888pass1fail是新增asset测试fixture错误使用role=cover/id=main，改为合法presentation/default后回归通过；一次最终启动被Testcontainers reaper端口10秒超时打断（未执行测试），同命令重试全通过，未禁用/跳过集成检查。
- `pnpm typecheck`、`pnpm lint`、`pnpm deps` 与 `git diff --check`通过，日志 `/tmp/story-collab-{types,lint,deps}-final.log`。生成迁移snapshot/journal已按Biome格式化。contracts变更使Action dist检查发现stale，已重建并仅刷新原已暂存的`actions/publish/dist/index.js`，`pnpm check:action-dist`通过（`/tmp/story-collab-action-final2.log`）；没有stage其他文件。
- 相关mock浏览器 `pnpm --filter @char-pub/web e2e editor.spec.ts creation-owner.spec.ts contributions.spec.ts first-class.spec.ts` 最终 **30 passed / 2 fullstack skipped，12.0s**（`/tmp/story-collab-mock-e2e-final.log`）。首轮4fail对应权限能力fixture/文案断言和World/Lorebook已迁Content groups的旧折叠断言；修正测试为实际设计，没有恢复不安全的namespace fallback。这里两项skip是普通runner匹配到需独立全栈的既有文件，不拿它们当已验收。
- 新真实 `E2E_FULLSTACK=1 pnpm --filter @char-pub/web e2e:fullstack fullstack-collaboration.spec.ts` **1/1通过17.8s，用例3.9s**，`/tmp/story-collaboration-fullstack.log`。两个真实会话经UI邀请→精确许可接受→普通编辑自动保存→owner UI撤销→已打开编辑保存404保留本地内容→刷新不可读。伪造敏感PUT403，owner草稿未被失败写覆盖，未发布Release。三张截图已实际view，存 `.llmdoc-tmp/investigations/story-v1-creation-collaboration-browser/`，覆盖控件权限、撤权未保存提示与刷新404。
- 本轮没有修改Core/Assembler语义或公开artifact wire schema；不重复之前三runtime182pass/87todo计数冒称本轮新验收，Harness不可变SDK未升级。0016只在隔离测试与固定E2E库应用，无生产迁移、commit/push/deploy/npm发布或在线模型调用。

#### 知识维护与下一步

- llmdoc:update deep/dry_run，报告 `.llmdoc-tmp/investigations/story-v1-creation-collaboration-dry-run.md`。scope3impacted/0review；global阶段扫描25impacted/5review/25dirty/403unmapped。validate发现stable creator-experience映射仍指向已删除assembly-input.ts，因此结构门禁未通过；本轮遵守stable/meta禁写，不伪造fingerprint或commit，G2保持未完成。5个pending候选未晋升；本轮精确许可、集合read scope与LIMIT前过滤规则补既有生命周期候选。
- M4下一步优先对象级剧情Contribution（scene/beat/ending等结构差异、合并与提案预览）及OAuth授权；协作者范围已落地，不再列为空白。并发409后的对象差异重应用仍待，后台PAT/OAuth撤销的持久凭证证明不冒称已实现。
- M5继续剧情线排序、开局实际消息定位、非文本内容普通入口、跨过滤诊断定位、Alice/Bob跨作品完整发布、Remix/续作及Runtime回流。M6独立Harness继续新SDK不可变快照与历史回放、开局决策receipt、Jev/Laya身份/分发能力，保持本仓发布平台与外部运行环境边界。
- 最终ci:all/全栈全套、commons/conformance人工接受、stable知识同步仍在完整DOD范围内，下一轮由此继续。


### 2026-10-01 对象级剧情投稿、字段三方合并与真实提案预览检查点

上一轮作品级协作是实际完成的进展。本轮进一步落实 M4/M5 的对象级投稿，完整目标继续 active。D-207 与 Story §16 已同步；OAuth、完整冲突重应用体验、Remix/续作、Harness 与最终 G1/G2 均未整体完成。

#### 实现与边界

- Core新增story/cast/group/source对象变更及story-order，StoryKind补choice；明确HTTP changes_version:1，新类型无声明或不支持版本拒绝。原configuration保持整字段策略，不把剧情塞进单个大配置。公开compositionValue/compositionDigest/canonicalCompositionValue用于生产和消费同一对象身份。
- mergeContribution第三参数要求新增类型使用可信原Revision定义。Registry从row.baseSemanticDigest读取经过digest核验的CAS内容；身份id/ref/type与各base_digest一致才合并。字段独立比较、引用集合按增删与共同元素排序合并，goals逐cast key；双边不同排序在field@order冲突。knowing的*和省略Scene.cast保留全体语义；合法constructor/prototype标识不被误拒，原型键/循环检查迭代执行、深条件限额在递归规范化前执行。
- 列表顺序与对象增删分开，story-order列完整成员且不得重复/伪造新增。新Story建立version1；删除全部对象且无并发新增才移除story。任何对象冲突或合并后校验失败都不返回部分产物，提供conflict_fields/diagnostics。checkCreation统一核查本地lore/group/source/section/about/knowledge引用，外部闭包交build；不以merge私有补丁放松普通创作静态校验。
- Registry提交、列表、详情与接受均用原基线；列表按基线digest复用加载。提交基线上的非法结果422；与当前draft冲突时接受409，原稿/Revision/proposal不被部分修改。0017扩change_target枚举。owner/collaborator才获得当前私有merge preview、current/draft_version/merged快照，普通投稿者只看自己的原提案；详情private,no-store。
- Web helper保留并产生story/cast/groups/sources/references/assets，以及原片段/meta/configuration的正确变更。contributionWorking/editFromWorking处理临时不完整状态，未支持字段或非Story列表重排明确报错、不吞改动。投稿表单复用StoryWorkspace、Cast、ContentGroups、SourcesEditor，片段移除先检查引用，编辑器位于提交form之外，避免内部默认按钮误提交。
- ProposalPreview只读取精确锁定依赖及其Source，核对身份/摘要、拒绝跟随latest，然后用createLocalBuildInput+buildCreation产生真正local-build，PreviewPanel运行实际消息和剧情预演。未提交的提案不改目标草稿、不造Release。支持选择与文本资产digest匹配的本地参考文件，总大小上限5MiB，原文BOM/CRLF/NFD/尾空白完整保留，仅在浏览器选材；SourceTexts进入同job，账号/稿件/文件请求变化后迟到结果丢弃。
- 实际截图发现：三方merge和消息正确保留owner场次时间Midnight，但卡片右侧原先展示投稿raw after的Evening并标Will apply，产生误导。现新对象After读取preview.merged，Before使用同次preview.current，避免独立draft GET不同时间快照；明确字段冲突显示名称。真实浏览器增断言After含Midnight与新opening、不含Evening后重验通过。
- 根审阅又关闭异步状态覆盖风险：SourcesEditor的旧update回调原会从捕获的旧ContributionEdit计算，覆盖附件等待期间的新文字。现使用同步editRef读取最新稿，新增组件回归模拟延迟附件update，证明提交同时保留新fragment和group、changes_version1；该回归初次只是textbox/Remove按钮label定位歧义，已精准按textbox定位，未放宽断言。

#### 验收证据

- Core定向最终6文件218项通过（新增storymerge21项、旧merge86项、check/catalog/story/about）；三runtime新增story-contribution.test每环境4项，共12/12。新的Source/group本地检查正确发现旧story测试fragments:[]却knowing引用#secret，补真实secret片段保持原意；about原三个后期错误改为准确的check.local_reference提前拒绝，不放松引用规则。一次全量在agent进行中读到旧emptyknowing测试，随后以显式空audience合法语义回归关闭。
- Web helper新8项+旧相关4文件18项通过；local preview helper5项实际Core产物验证、精确依赖/原文摘要/actor变化拒绝；迟到编辑组件1项通过。新server story-contributions4项通过，真实验证同Scene不同字段保留、同字段冲突原子失败、伪base摘要/悬空拒、版本门禁；既有proposal/Source/协作审阅回归合计55项通过。
- 最终 `pnpm test` **145文件2059项通过**（`/tmp/story-proposal-tests-final3.log`）；最终完整integration **53文件908项通过**（`/tmp/story-proposal-integration-final2.log`）。前几轮失败分别为新增Scenario测试fixture未声明cast、旧静态测试漏本地片段、进行中测试和新UI测试定位问题；最终全量未保留任何失败。
- 最终 `pnpm test:conformance` **17文件194 passed / 87 todo**（`/tmp/story-proposal-conformance-final2.log`），新增文件已接browser/workerd显式include，三环境实际执行。workerd沿用既有node:worker_threads fallback日志，runner exit0；没有接受或改写87条候选expected，不据此宣称规范人工审核完成。
- `pnpm typecheck`、`pnpm lint`、`pnpm deps`、`git diff --check`均通过（`/tmp/story-proposal-types-final2.log`、`story-proposal-lint-final2.log`、`story-proposal-deps.log`）。schema:export同步公开Contribution schema；Action重建后只刷新原已暂存的dist/index.js，check:action-dist最终通过（`story-proposal-action-check2.log`）。未stage其他文件，无commit/push。
- 相关mock E2E **14 pass / 1 fullstack skip，7.0s**（`/tmp/story-proposal-mock.log`），覆盖原投稿、guest授权、敏感确认、Preset策略提案与first-class流程；skip是普通runner匹配到需单独全栈的既有文件，不当作通过。
- 新真实 `E2E_FULLSTACK=1 pnpm --filter @char-pub/web e2e:fullstack fullstack-story-contribution.spec.ts` 首轮1/1通过18.7s；修正卡片后最终 **1/1通过10.2s（用例3.2s）**，`/tmp/story-contribution-fullstack-final.log`。两个真实账号：owner发布Scenario→投稿者UI新Ending和Scene opening→本地实际messages预览→version1提交→owner并发修改同Scene.time→审阅实际messages/After卡片均保留两边→accept→草稿及德语title保留、Release数量不变。最终两张截图已实际view，存 `.llmdoc-tmp/investigations/story-v1-story-contribution-browser/`，包含最终日志。
- 迁移0017仅在隔离integration和固定E2E库应用，无生产迁移、部署、公开包发布或在线模型调用。独立Harness未更新本轮Core SDK，不拿本仓Core/Web验证冒称外部consumer升级。

#### 下一步与剩余门禁

- llmdoc:update保持deep/dry_run，报告 `.llmdoc-tmp/investigations/story-v1-object-contribution-dry-run.md`；stable/meta不写。validate仍因旧creator-experience映射指向已删除assembly-input.ts失败，不能算G2通过。五个pending候选未晋升；本轮实际合并结果展示和同次快照教训补既有前端候选。
- M4下一步OAuth及授权消费、后台凭证scope/撤销持久证明；对象级剧情提案已经有真实Core/Registry/Web流程，不再列为空白。冲突卡有具体字段，但完整交互式选择、重应用及原始提案版本体验仍需按作者工作流继续。
- M5继续Remix/续作与Runtime回流、剧情线顺序普通入口、开局消息定位、非文本创作与诊断跨过滤视图定位、Alice/Bob跨作品完整发布验收；不以本轮单late persona流程替代多角色跨作品完整验收。
- M6继续独立Harness新不可变SDK快照/历史回放、开局决策receipt、Jev/Laya身份和分发；保留上游DeepSeek来源与MIT。最终ci:all、全栈全套、commons/conformance人工接受及稳定知识同步继续按完整DOD推进，goal active。


### 2026-10-01 OAuth 授权消费与后台凭证检查点

本轮落实 M4 的 OAuth 和 PAT 排队凭证。D-208、Story §18.2 与环境模板已同步。完整 goal active；不把授权切片标成全目标完成。

#### 实现

- 固定安装官方 `@better-auth/oauth-provider@1.7.5`，与现有 Better Auth 版本一致。0018 提供七张协议表；生成 SQL 中唯一索引先于引用它的外键执行，真实迁移已验证。手动注册公开客户端、S256、精确HTTPS/HTTP loopback、opaque access 1h、显式offline_access的30d refresh逐次轮换；未开放OIDC/动态注册/secret/client credentials或原生管理HTTP。
- 同clientId的协议写入在同一adapter事务内以advisory锁串行，覆盖code单次兑换、refresh/replay/撤销、consent与删除应用；重验账号封禁、consent并撤销pending codes。公开metadata只广告已支持能力。管理/授权页必须session；Bearer即使带有效Cookie也不借session扩权，未知Bearer401。跨站token/revoke与Bearer走无credentials CORS，普通session Origin保护保留；GitHub发布OIDC独立入口广回归通过。
- 中央OAuth硬上限：profile只公开id/namespace；creations:read能读用户实际有权的私有Release、既有dbld与Source，不能rawdraft/创建或删除dbld；drafts:write仅本人namespace新建完整working；contributions:write仅提交提案。初始working canonical/check后强制identity/title/authors及真实client_id。0019记creations/contributions客户端来源，接受投稿后contributors中保留client_id，删除应用不抹历史来源。
- Web设置页有公开客户端注册/删除与授权撤销；Consent展示服务器已验签的应用/redirect/scopes。actor/request切换隔离迟到响应，gcTime0。真实浏览器发现TanStack searchStr重编码签名串，已改用window.location.search原字节，router.href仅订阅导航；加入原串一致断言，日志/截图不记录凭据。新OAuth fullstack关闭trace/video。
- PAT principal保留token行ID；dbld保存requesterTokenId与scope快照，worker重查当前有效期/撤销/账号/作品权，以scope交集执行。创建需read+write；不同token与session各有pending任务。0020让缺可信来源的旧pending/ready临时构建过期，破坏性影响已告知；未执行生产迁移，不存bearer明文。

#### 验证

- Provider真实数据库12条流程 + 既有BetterAuth21条共33通过；新增真实业务API4条完整流程通过：实际授权码兑换、profile/CORS、完整初始稿与禁止操作、上传Source→workerbuild→授权读artifact/Source、sibling隔离、投稿接受client来源及撤销。`/tmp/oauth-tests.log`、`/tmp/oauth-api-tests.log`。
- `pnpm test` **147文件2086项通过**（`/tmp/story-oauth-tests-final2.log`）。首轮2个schema一致性失败是导出尚未结束，生成schema后全量重跑通过；没有修改预期吸收错误。新增可信OAuth Origin配置回归随后单独 **15/15通过**（`/tmp/story-oauth-env-final.log`），不是将新增用例混算进此前全量计数。
- `pnpm exec vitest run --project integration` **55文件924项通过**（`/tmp/story-oauth-integration-final.log`）。PAT新增9条随后与dbld14/auth21合跑 **3文件44项通过**（`/tmp/draft-build-token-tests.log`）：真实HTTP创建PAT与入队、撤销/过期/失read/失write失败无MinIO artifact、扩scope不扩原委托、凭证隔离/同凭证复用、read-only/write-only拒绝。未把新9条混算进之前924。
- `pnpm test:conformance` **17文件194通过/87todo**（`/tmp/story-oauth-conformance-final.log`），Node/browser/workerd均完成；87旧expected等待人工接受，不能算pass。Core schema已导出，Action已重建，仅刷新原已staged的`actions/publish/dist/index.js`，check:action-dist通过。
- 全仓typecheck/lint/deps通过，日志`/tmp/story-oauth-{types,lint,deps}-final.log`；新增PAT测试有全tests类型复验，新增env有定向Biome。无依赖违规，diff-check通过。
- OAuth组件10项与既有设置4项 **2文件14项通过**。真实 `fullstack-oauth.spec.ts` **1/1，10.3s**（`/tmp/story-oauth-fullstack-final.log`）：UI注册→真实PKCE授权→实际token交换→受限读取与新草稿→UI撤销→access/refresh失效。回调是精确loopback替身，其余真实API；三张截图实际审阅并保存`.llmdoc-tmp/investigations/story-v1-oauth-browser/`。没有Release或在线模型调用。

#### 知识与剩余范围

- llmdoc:update继续deep/dry_run，报告`.llmdoc-tmp/investigations/story-v1-oauth-dry-run.md`；stable/meta未写、未fingerprint或commit。旧creator-experience映射引用已删除assembly-input.ts，validate仍失败，G2未完成。五pending反思保持未晋升，本轮签名查询串精确字节教训补既有canonical-input候选。
- OAuth平台授权已具真实服务端/浏览器证据；独立Harness尚需实际客户端消费，不能以本轮协议测试代替Runtime完成。已交investigator更新不可变SDK及当前旧SDK历史样本，结果待后续检查点。
- M5继续Remix/续作、Runtime回流、冲突重应用、剧情线顺序/消息定位/非文本与跨过滤诊断，以及Alice/Bob跨作品完整发布验收。M6保留模型开局receipt、Laya身份与分发；最终ci:all/全栈全套、Commons与conformance人工接受、稳定知识同步仍按DOD推进。
- 无commit/push/deploy/npm发布或生产迁移。仅原Action dist保持暂存，其余工作区未stage。


#### 独立消费发现的来源链路缺口与修复

- Harness 新pack消费发现：Creation.Contributor允许client_id，但IRContributor/ReleaseContributor各自复制旧strict schema，完整build拒绝meta.contributors字段；Resolver也在显式投影中丢弃client_id。已改两个产物schema复用ContributorSchema.extend({ref})，Resolver显式保留来源。此修复不靠放宽strict schema吞未知字段。
- Core原贡献测试扩完整build/IR验证，schema/resolve-more **2文件107通过**（`/tmp/story-oauth-contributor-core.log`）。真实OAuth投稿接受流程追加worker构建、下载产物，并核对artifact.meta与ir.meta贡献来源一致，**4/4通过**（`/tmp/story-oauth-contributor-api.log`）。这补齐原先只到draft接受的验证缺口。
- 修复后schema再次导出，Action再次build并仅stage原dist；check:action-dist通过（`/tmp/story-oauth-action-final2.log`）。全量`pnpm test` **147文件2087通过**（`/tmp/story-oauth-tests-final3.log`）；三runtime conformance仍 **17文件194通过/87todo**（`/tmp/story-oauth-conformance-final2.log`）；typecheck/lint/deps分别final3/final2/final2日志通过。集成以此前全量924+随后PAT44及本次OAuth4回归为证，不假称修改后再次全量。
- Harness保留发现问题的637663候选快照原字节，另生成新ce4980快照，不覆盖既有SDK身份；最终Harness门禁待下一检查点。跨schema/聚合IR/独立packed consumer教训补既有反思候选，未晋升stable。

#### 剧情线引用顺序普通入口

- Plotlines已按每条线选中引用顺序显示scene/beat，支持带明确名称的上/下按钮与首尾禁用，可键盘操作；未选对象仍可加入。操作按稳定ID定位当前引用，保留原对象、其他列表/时间线与当前本地编辑，移除剧情线后Undo保留调整后的顺序。顺序只表示作者预期讲述次序，界面明确玩家仍可采取其他路径。拖动交互尚未实现，不把键盘入口冒称完整拖动体验。
- 两个Story组件文件 **7/7通过**（`/tmp/story-plotline-tests3.log`），包括保存引用顺序、原场次和并列时间线不变、Undo保留新顺序、键盘切换视图。首轮label编号影响测试取关联标签，编号移到Label外，控件可访问名保持原场次标题。
- 真实fullstack作者流程扩两个场次、剧情线键盘排序、保存后刷新、最终worker产物保留反向引用顺序且场次定义顺序不变；第三轮 **1/1，11.4s**（`/tmp/story-plotline-fullstack3.log`）。前两轮失败均为新增第二场次后旧测试定位未限定可见列表/精确label，修正locator后通过，未放松业务断言。截图在后续最终补验中核选中tab与无动画区域截图。
- 剧情线引用排序不再列空白；Remix/续作、Runtime回流、完整冲突重应用、开局消息定位、非文本与跨过滤诊断、Alice/Bob跨作品发布仍待。核心语义未为UI改变。

- 剧情线最终浏览器补验 **1/1，14.8s，用例5.8s**（`/tmp/story-plotline-fullstack-final.log`），明确验证当前Plotlines按钮样式/Scenes非选中及无动画截图。两张最终截图实际审阅后存`.llmdoc-tmp/investigations/story-v1-plotline-browser/`；可见Morning road→Midnight lobby，预览仍从作者选定的Midnight开局，未由剧情线排序强制跳场。runner已退出。

#### M4 Registry 里程碑验收

- 修复独立SDK暴露的聚合来源字段后，为核查发布/读取/worker全链再次运行全部integration，最终 **56文件933项通过**（`/tmp/story-oauth-integration-final2.log`，18.79s），包含新增PAT9项和投稿接受后构建回归。此前分开记录的补验不再是最终集成基线。全types/lint/deps与schema/Action门禁保持通过。
- DOD仅将M4勾选：服务器发布、临时草稿构建、OAuth、作品协作与对象Contribution有完整授权/失败路径证据。M5作者工作流/真实外部消费、M6 Harness与G1/G2继续未完成，OIDC登录不纳入已验收OAuth。DOR R1库能力与R2隔离全栈环境已核实，剩余工作不是环境未知。


### 2026-10-01 Harness 新 SDK、两代旧会话恢复与门禁

- 独立仓 `/Users/djj/code/char-harness` 保持 `work/story-runtime`，上游 DeepSeek MIT 固定来源不变。当前SDK `story-v1-ce4980b845697e76`，manifest SHA-256 `ce4980b845697e7614af5d9bac845dcecb751f2557cdac3195c5af31a0e6df4c`。三个真实pack包、两consumer、根overrides与lock一致；保留原始、bb93以及暴露来源缺口的637663中间快照原字节，未覆盖既有身份。仍是未公开发布的dirty 0.0.0开发包，不能仅凭HEAD重建。
- 安装前以实际bb93包捕获一份新的Replay与真实JSONL，固定在runtime测试 `fixtures/pre-source-fixture-sdk/`，先在旧包验证再升级。新manifest `461aaf2a3d751d84a350cc655c3a4bd7dbd0714f2ada8583b452345e334f3f1e`，Replay `89f0d477e68dcef0fff0dd06805c1ecf3a10ad9f0e256677aeff504584d5a4d1`，JSONL `e15f89e0bd4ec1c8b78989bbbfa6fee148479935cc345d2102bb20720366228f`。与最早样本一起在新SDK真实Loader恢复，head/state/messages不变；读取不改原文件，临时副本pending转interrupted且零重发。只宣称这两代代表样本，未承诺任意历史兼容。
- 新SDK消费测试使用真实node_modules/dist而非主仓src：Source原字节BOM/CRLF/NFD/尾空白与session文本经canonical持久化、作者fixture执行后messages_digest一致；artifact.meta与IR meta贡献者client_id一致。发现作者schema与聚合产物schema脱节后已回主仓修复并重新pack；不伪造旧快照结果。
- 两处optional client_id进入roleplay/opened的嵌入产物声明，新增同版本持久类型确认 `2026-10-01-charpub-client-origin`；原ack/finalized基线与已提交Session generation均保持，writer不变。Harness词汇门禁对真实外部SDK字段访问采用单文件AST属性节点窄例外，注释/字符串/其他标识符仍拒，规则57测试过；未字符串拼接规避门禁。
- `test:roleplay` 31源码/Jev/SDK + 2plain Node编译 + 1snapshot校验；`test:roleplay-runtime` 25项，合计 **59项通过**（`/tmp/harness-sdk-roleplay-final.log`、`/tmp/harness-sdk-runtime-final.log`）。包tsc、目标lint、constraints、diff通过；完整Host构建后独立NodeNext使用真实编译声明检查两个包全部tests通过（`/tmp/harness-sdk-test-types-built.log`），没有修改生产tsconfig掩盖scratch程序解析问题。
- 完整 `doc-sync` **43/43通过，0fail/0skip**（`/tmp/harness-sdk-doc-sync.log`），包括Host构建、持久化类型、文档类型与双语门禁。详细可恢复执行包 `/Users/djj/code/char-harness/spec/goals/roleplay/PROGRESS.md`。
- 主仓goal active，M4已完成但M5/M6、G1/G2保持未完成。下一步优先独立Runtime通过公开OAuth/草稿构建实际消费及主仓Remix/续作/Runtime回流；模型开局receipt、Laya项目身份、完整客户端分发与最终人工expected/Commons接受仍在原范围。Jev离线typed调用/回放已覆盖，未作在线质量验证。
- 本轮未commit/push/deploy/npm发布/生产迁移/在线模型调用。主仓llmdoc仍deep/dry_run与5pending候选，stable/meta未动；旧assembly-input mapping使G2未完成。仅原Action dist暂存，其他改动保留工作区。


### 2026-10-01 Remix/续作工作流与精确来源依赖（进行中）

上一轮M4授权与Harness快照有实际进展，本轮继续M5派生作者流程；goal active，未缩小原目标。D-209与Story §17.6已记录实现语义。本检查点记录阶段证据，历史来源版本分域尚在收尾，后续最终门禁将追加。

- Core新增deriveCreation纯准备：精确源ReleaseInput+新target身份，Remix复制完整定义、绝对化原namespace相对依赖、自身资料引用转新ref，保留依赖pins、原署名与作者测试期望；新客户端不继承原顶层client_id。续作复制完整背景/角色/依赖图，重建独立Story；保留vars/items/knowing.start，所选ending.effects只预填starts.set，不执行条件/旧开局/场次enter或玩家进度。删除旧bootstrap/作者测试及旧剧情对象，assembly配置可沿用。仍有资料/Style指向的原scene只保留id/title空定义，不放宽可见范围。
- 精确derived_from新增ref+semantic_digest成对字段与sequel关系，成为来源依赖；bare release只作原有展示备注。来源参与聚合lock/评级/许可/署名与发布检查，但不进入Creative IR/Catalog，不重复实例化旧cast或暴露source-only资产。来源资产许可/评级仍约束派生。Core先完成12新+61相关=73pass，新增跨Node/browser/workerd3用例9pass（`/tmp/derive-conformance.log`），后续历史版本升级问题另见下方。
- Registry新POST namespaces/:slug/derivations，只收精确source/kind/地址标题/可选ending/权利明确确认。重新授权active源版本、核原定义与artifact，按聚合许可拒禁止改编；仅创建本人个人namespace私有稿，原署名+当前owner，OAuth真实client_id来源。0021持久verified来源；PUT/Revision/dbld读取校验/publishworker要求它保留。只有新稿实际复制的、原source产物root声明的mirrored资产取得新workgrant。
- 真实API派生5流程通过（`/tmp/story-derive-integration2.log`）；与OAuth新派生权限流程合跑 **2文件10通过**（`/tmp/story-derive-api-final.log`）。覆盖remix→dbld→publish/署名来源锁、sequel二cast且无旧Story、private/ND/yanked/伪pin/缺权利/非own namespace拒绝、删source422不改version、原作者真实Source上传后跨owner派生构建发布；OAuth drafts-only可派生公开源，private还需read，read-only不能创建，client_id正确。
- Web新DeriveCreation及header入口，依据当前exact artifact/Release与聚合许可显示，active-only；标题/地址/ending/rights，初始静态背景限制说明，保存后进普通编辑器。actor/version/关闭dialog隔离迟到请求，重复提交保护，错误保输入，地址冲突采用真实creation.conflict映射；14组件测试通过（`/tmp/story-derive-web-active.log`及后续真实conflict码定向日志）。
- 真实全栈 **1/1，17.8s，用例9.3s**（`/tmp/story-derive-web-fullstack-verified.log`）：两真实账号，原Scenario实际API发布，再通过UI分别Remix/Sequel→保存刷新→真正worker产物；Remix原hall/road_open=false/旧greeting保留，续作opening/road_open=true/无旧greeting。两个显式cast与默认user未重复，source只在锁不进IR。4截图包括两张清晰messages-and-state已由recorder实际view并存`.llmdoc-tmp/investigations/story-v1-derivation-browser/`。所有fixed E2E runner已退出。
- 上述基础实现广测基线：`pnpm test` **149文件2113通过**（`/tmp/story-derive-test-all.log`），全部integration **57文件939通过**（`/tmp/story-derive-integration-all.log`）；types、deps、schema导出与Actionbuild/check通过，仅原dist保持stage。lint首次唯一错误是正在写入的Core新test格式，investigator随后收齐，最终需复跑。不能把这些当后续分域修复后的最终结果。

#### 当前正在修的实质缺口

聚合图原本按ref全局单版本，导致Remix保留源历史pins后无法升级自己的同ref依赖。已决定本轮修复，不能以此限制当最终完成。Coreinvestigator将按Release身份收齐，然后分别验证实际内容/策略/test图与每条来源历史图的单版本；历史与当前可不同，实际图仍拒diamond，来源许可/可见性/下架不省略，meta资产定位按BuildIdentity且lock同ref按release稳定排序。

Registry已新增0022迁移：release_locks主键从releaseId+depCreationId改为releaseId+depReleaseId；release_fragments主键加digest，worker fragment map也加digest，使历史/当前同片段两个摘要都保留可下架索引。只换唯一键不删数据，尚待最终真实migration/test。root新derivations集成测试加入原作dep1→派生升级dep2→实际IR只新正文→发布保存双锁/双摘要；待Core冻结运行。M4现有基线不等于这次新结构已最终验收。

后续：Core历史分域定向与新真实DB测试→schema/Action再次刷新→最终types/lint/deps/test/integration/conformance；补本轮llmdoc:update deep/dry_run（recorder已开始），stable/meta仍不写、5pending不晋升、G2旧assembly-input映射缺口保持。新SDK/精确来源契约尚未同步Harness ce4980快照，后续Runtime OAuth消费时需新的不可变SDK与历史证据。无commit/push/deploy/npm发布/生产迁移/在线模型调用。


#### Remix/续作最终验收与历史版本修复

- Core实际内容/策略/作者测试图保持单版本，每份来源历史另行完整验证单版本；先按Release收齐节点，再按每个图重验，避免缓存先经过历史而漏查实际冲突。原作依赖v1与新作品实际依赖v2可共存于聚合锁，IR/Catalog只用实际版本；lock同ref按Release确定排序，依赖输入顺序不影响最终JSON。许可modified精确到Release，历史ND v1不会被当前v2的override误判；历史private/tombstone/blocked资产仍拦截。
- Registry 0022真实迁移通过，新升级集成证明原作dep1→新作dep2后IR只含新正文、角色不重复，正式发布保存两条精确锁与同片段两个摘要；不能以onConflictDoNothing静默丢历史。Snapshot dependencies增加ref后按release排序，反转同ref版本输入仍生成相同快照字节，且保留fixture原始Source/session字节。
- 续作新scene不再自动挂所有lore：背景定义进入Catalog，原manual知识与Source默认不展开，显式选材才进入消息。旧scene限制保留空场次范围，不变成新开局默认可见。新增跨Node/Chromium/workerd用例同时检查多层groups/manual/source、精确身份与版本升级。单项来源说明不是把旧剧情状态注入新作品。
- 修正许可误限：初始入口只对根定义要求可改编，对原字节根资产要求可再分发；不能把所有聚合依赖都标成modified。真实CC0 Scenario引用未修改ND Character现在可Remix并构建/发布，自体ND源仍拒。UI使用精确root资产身份并保原聚合评级门禁，新增许可RTL后 **17/17**通过（`/tmp/story-derive-web-license-final.log`）。Registry定向 **7/7**通过（`/tmp/story-derive-history-api2.log`），含源版本升级与ND组合。

##### 最终门禁

- `pnpm test` **149文件2118项通过**（`/tmp/story-derive-test-final2.log`）。全部 `integration` **57文件941项通过**（`/tmp/story-derive-integration-final2.log`），包含新的0021/0022迁移、精确来源/资产/版本升级与OAuth派生权限。
- `pnpm test:conformance` **20文件209通过/87todo**（`/tmp/story-derive-conformance-final.log`），新增5×3来源派生语义用例；87既有expected仍待人工接受。Core定向 **75项**、新derive14与三runtime新15共29项有独立日志`/tmp/derive-upgrade-{final,regression-final}.log`。
- 全`typecheck`、`lint`、`deps`、Action分发检查与diff通过（`/tmp/story-derive-types-final2.log`、`/tmp/story-derive-lint-final.log`、`/tmp/story-derive-deps-final.log`、`/tmp/story-derive-action-final.log`）。公开schema在最终Core冻结后重新导出，Action重建且只刷新原staged index.js；最新Web全栈测试文件另有node-config tsc与Biome证据。
- 为验证渐进选材的实际消息变化，最终再次运行真实作者流程 **1/1，17.3s，用例10.7s**（`/tmp/story-derive-web-fullstack-lore-final.log`）。fixture明确manual guide：Remix保留原scene直接关联，实际messages含正文；Sequel scene.lore空，messages不含正文，draft/IR/Catalog仍保留条目且界面有手动选项。原state（false/true）、旧greeting（保留/移除）、角色和精确lock断言全过。4张最终截图由recorder实际view后更新到`.llmdoc-tmp/investigations/story-v1-derivation-browser/`，固定runner已退出。这是语义修复后的最终浏览器基线；17.8s仍保历史记录。

##### 状态与后续

M4服务器验收按941项新基线更新；M5的Remix/续作切片已具真实Core/Registry/Web证据，M5整体仍未完成。下一步独立Runtime用公开OAuth读取授权dbld及资料，保存创作/投稿回流，并将Harness ce4980旧快照更新到含本轮来源依赖的新不可变SDK（先保存旧Session样本）；还需模型开局receipt、Laya身份与完整客户端分发。主仓完整冲突重应用、开局实际消息定位、非文本创作、跨过滤诊断和Alice/Bob跨作品发布代表案例，最终ci:all/Commons与conformance人工接受继续原DOD，不因本轮通过而删掉。

本轮llmdoc:update保持deep/dry_run，报告`.llmdoc-tmp/investigations/story-v1-derivation-dry-run.md`已由recorder补齐最终计数和源码核查；stable/meta未改、5pending未晋升，旧assembly-input映射使G2继续未完成。无commit/push/deploy/npm发布/生产迁移/在线模型调用，仅Action原dist保持stage。

### 2026-10-01 独立 Harness 公开消费（进行中）

- D-210 与 Story §18.3记录跨仓边界。Registry 新增按精确 Release ID 读取详情和 artifact 的公开入口，复用现有契约及当前授权；私有无权404、tombstone410、yank警告和署名保持，label路径与ID路径共用响应。当前地址与不可变产物发布时地址分别保留。定向真实DB read/OAuth **2文件20通过**（`/tmp/story-runtime-exact-read.log`）。
- 本地Vite仅增加标准OAuth metadata路径代理，使同源Web issuer的标准discovery可达；未放宽客户端issuer同源检查。跨仓浏览器流程待独立客户端最终编译后执行，不能把代理配置当协议验收。
- 草稿409/422后本地修改仍保留，但原beforeunload只检查队列，排空后会丢离页提示；现同时比较current/saved。新增两条失败→不自动重写→离页警告→显式reload清警告回归，hook **9/9通过**（`/tmp/story-runtime-draft-retention.log`）。完整对象冲突重应用仍待，不以此修复代替。
- 主仓当前广回归：`pnpm test` **149文件2120通过**（`/tmp/story-runtime-tests-final.log`）；全部integration **57文件941通过**（`/tmp/story-runtime-integration-final.log`）。全typecheck、deps和check:action-dist通过，对应`/tmp/story-runtime-{types,deps,action}-final.log`。lint首轮只新fullstack测试格式失败，交recorder修后复验。Core未改，不重复此前209pass/87todo conformance，87todo继续人工门槛。
- Harness已在旧ce4980实际安装捕获第三代历史会话样本，正在消费新不可变SDK并实现内存OAuth Registry client；标准协议、token并发失效、bounded transport和回流确认门禁尚待最终结果。测试桥与compiled plainNode生命周期smoke已过，但真实跨仓fullstack尚未计入通过。
- goal active；M5/M6/G1/G2继续未完成。Runtime产品地址仍未确定，不制造可用游玩链接。无commit/push/deploy/npm发布、生产迁移或在线模型调用；只有原Action dist暂存，稳定llmdoc/meta继续不写。

#### 独立消费者真实全栈已通过

- `fullstack-harness.spec.ts` 首轮 **1/1通过，13.4s，用例6.8s**：Web上传真实Source并产出私有Release与dbld；UI手动注册public client及同意；独立子进程真实loopback处理code，父进程不接凭据；refresh/profile/精确Release/dbld与按需Source读取均成功。实际Source保BOM/CRLF/NFD/尾空白，独立摘要与HTTP正文一致。
- 子进程只从独立Harness编译lib与已安装SDK包启动真实Loader/roleplayRuntime/JSONL；固定provider收到的messages与持久requested投影完全相等，重开恢复相同会话。UI撤销后新的profile、private Release、dbld读取和refresh均被拒。trace/video关闭，无凭据环境透传，最终浏览器截图及脱敏记录由recorder存scratch。
- `pnpm lint` 修新E2E格式后通过（`/tmp/story-runtime-lint-final2.log`），diff检查通过。先前全量测试与类型结果仍适用，后续测试证据序列不混算。本轮没有修改Core或schema，无需再次打SDK或刷新Action。
- 新活动SDK为独立仓 `third_party/charpub/snapshots/story-v1-8a4f5f5f5b8edd8f/manifest.json`，SHA `8a4f5f5f5b8edd8f4a2f1181e180717d36b19fa84487f6ee0b31459899e06a7f`，verifySDK通过。SDK已含D-209来源依赖契约。旧ce4980安装捕获第三代真实历史日志后再升级，全部旧快照保持原字节。
- Registry client **14项**、runtime整体 **42项**、replay/SDK源码 **31项**及2 compiled/1snapshot通过；完整Harness文档门禁仍在最后复验，此处不提前标全绿。写回的显式确认API已有实现与单测，真实浏览器消费本轮只验读/会话/撤销，完整回流用户体验仍待。

#### Harness 最终门禁与历史样本

- 独立Harness `doc-sync` 第二轮 **43/43全过，0失败/0跳过，75.14s**（`/tmp/harness-registry-docsync-final.log`）。首轮是测试exactOptional赋undefined及生成catalog行号过期，按真实类型修条件spread并重新生成；没有放宽门禁。package tsc、清空源码alias的独立NodeNext全部相关tests、constraints、定向lint、export JSDoc、持久历史与diff-check全部通过。
- 行为验证合计 **76项**：31源码/Jev/SDK + 2编译消费 + 1快照验证 + 42runtime（含14Registry client边界与三代历史样本）。日志`/tmp/harness-registry-{replay,runtime,history,unit}.log`；完整SDK与捕获身份在独立仓`spec/goals/roleplay/PROGRESS.md`末节。实际ESM解析三个包均指向新快照tarball内dist，使用oauth4webapi3.8.8。
- 第三代样本在旧ce4980真实安装下捕获，manifest SHA `76b74c335bf2800c21d6d63f4bf4e582c86e80e4654f356fd5d8e0ccd723c264`，Replay SHA `89f0d477e68dcef0fff0dd06805c1ecf3a10ad9f0e256677aeff504584d5a4d1`，JSONL SHA `34371c4c18d0126a15691078dc3ff565d3e8929283ef9f2cfeab142c00aa6186`。Replay与前代恰好相同源于该输入下输出未变，安装locator检查与新manifest/JSONL证明捕获来源，未复制旧样本伪装升级证据。
- 本轮没有新增Session事件或修改持久schema；65 roots/10 records匹配，无新ack、writer或已finalized generation改写。三代代表样本恢复同head/state/messages，pending转interrupted且零重发，不承诺任意历史兼容。
- lifecycle反思补既有候选：授权generation防失效后迟到accept，异步清理也须受deadline限制。14client与42runtime证据具备，未声称保留修复前红态日志；仍未晋升stable。

#### 最终证据与测试入口隔离

- 真实跨仓日志精确路径为`/tmp/story-harness-fullstack.log`。recorder逐张查看授权/撤销截图，已存`.llmdoc-tmp/investigations/story-v1-harness-registry-browser/`；授权显示实际应用、五项scope及精确loopback回调，撤销后授权列表为空、注册客户端仍保留。未见凭据，runner/子进程均退出，固定DB释放。
- 收尾发现默认fullstack配置会自动包含跨仓用例，使主仓隐式依赖外部checkout；现新增独立`playwright.harness.config.ts`及`pnpm e2e:harness`命令，默认fullstack明确排除该文件，不用skip掩盖。两配置`--list`验证分别选中 **12平台用例** 与 **1跨仓用例**（`/tmp/story-runtime-{fullstack,harness}-list.log`）；新增配置Biome及Web Node/E2E types通过。真实13.4s证据来自此前原配置指定文件，本次配置拆分后仅验证选择，不声称再跑浏览器。
- llmdoc:update终态为 **deep/dry_run**，报告`.llmdoc-tmp/investigations/story-v1-harness-registry-dry-run.md`。稳定文档/meta未写，无fingerprint/commit；旧creator-experience映射与5 pending仍待，G2不勾选。D-210只是公开消费切片完成，完整写回工作流、Runtime正式入口、模型开局receipt、Laya协议和在线质量仍按原目标推进。

### 2026-10-01 草稿并发编辑的对象恢复（D-211）

上一目标轮次属于progress：真实跨仓Registry消费实现与验收已改变代码和证据。本轮继续M5的409恢复，goal active，不收窄整体目标。

- 新Web纯helper `draft-reapply.ts` 保留base/mine/latest原始Working，按稳定对象ID比较片段、依赖、资产整slot、角色、分组、Source与Story数组/字典对象。双改同对象不同结果要求明确mine/latest，未本地修改对象保最新；未知顶层和assembly_tests等配置整字段处理，保BOM/CRLF/NFD/尾空白及未知字段，id/ref/type取服务器。不能识别唯一ID的半成品集合整组选择，不依赖Core canonical或可信Revision。
- 对象列表顺序单列；独立对象新增/删除不误判顺序冲突，按共同保留成员的相对顺序判断双改。所选顺序只排序现存对象，新对象保留、已删对象不复活；删除整个Story作为明确原子选择。全部对象读写防原型键误用，保普通作者的constructor等ID。helper **12/12通过**，含精确字节、资产变体、无效ID与独立新增/重排。
- `useDraftEditor` 新reviewConflict只读取不改变本地/version，reapplyConflict校验当前actor、编辑器实例、比较实例及base/local身份后，以比较version发普通PUT。刷新/丢弃/卸载使迟到比较失效；409保留已选结果并以刚才latest作为下一次基线，422保可编辑候选与诊断，401/403/404停写保本地。hook最终 **19/19通过**（`/tmp/story-conflict-hook-final.log`）。
- 新ConflictNotice支持Compare changes、按对象选择、基线查看、Apply choices and save、明确Discard my edits and reload及复制。友好对象名称、fieldset/radio键盘路径，双边冲突无预选，未选完禁止保存；刷新比较清旧选择；读/丢弃失败明确说明本地保留。对象内部整份选择，界面告知会替换全对象；不承诺文本自动合并。组件3项与既有编辑器/Registry回归通过。首轮RTL发现details也有group角色及happy-dom对raw JSON radio name的selector错误，采用具体可访问名与useId+编码name修复，未改变作者数据。
- 真实`fullstack-draft-conflict.spec.ts` **1/1通过，14.3s，用例7.5s**（`/tmp/story-draft-conflict-fullstack-final.log`）。同owner两真实页面：不同片段并发→真实409→合并两边；同description双改→显式选latest；取得比较后另一页再保存→第二个真实409→本地保留→重读并选mine→最终Description本地、Personality远端都在。真实If-Match/版本与GET持久值逐步核对，无mock无Release。首轮只因新增测试误期待裸ETag，而正式client发送合法带引号ETag，修断言后通过，未改生产协议。
- 最终`pnpm test` **151文件2145项通过**（`/tmp/story-conflict-tests-final.log`）；全typecheck/lint通过（`/tmp/story-conflict-{types,lint}-final.log`），deps无违规（`/tmp/story-conflict-deps.log`），diff-check通过。服务器/Core/SDK产物本轮未改，不重复上一轮941集成与209pass/87todo conformance或打新SDK。87todo仍需人工expected验收。
- 三张浏览器截图已由recorder实际查看，分别证明未选择冲突的禁用状态、再次409保留本地、最终保存与刷新；runner退出，fixed DB释放。llmdoc:update仍deep/dry_run，稳定/meta与五pending不晋升；旧mapping错误保留，G2未完成。详细scratch由recorder补齐。
- DOR已去掉过时的Remix/独立读取缺口。M5仍有Runtime回流、开局消息定位、非文本/跨过滤诊断与Alice/Bob完整案例；M6模型开局receipt、Laya协议/分发继续，G1/G2及整目标尚未完成。无提交、push、部署、生产迁移、在线模型调用；原Action dist是唯一暂存项。

- 本轮知识报告最终路径`.llmdoc-tmp/investigations/story-v1-draft-conflict-dry-run.md`，浏览器证据目录`.llmdoc-tmp/investigations/story-v1-draft-conflict-browser/`；已补2145全量与types/lint/deps终态。并行只读审计M0–M3的规范/实现/证据映射，下一轮依据具体缺口推进，不用累计测试数代替完成判定。

#### M0–M3 只读审计发现的下一步

- investigator核实Story §9.3要求的越界cmp恒真/恒假warning尚缺：`core/story/check.ts`当前只有类型及enum/set检查。下轮先补实际语义缺口，不把M1草率勾选。
- §14.2声明的可移植Story操作序列/逐步state fixture尚未落入现有case协议：没有`spec/conformance/story-v1`目录，CaseKind仅resolver/assembler/publish/ccv3；现有核心求值单测与三runtime装配测试不充分证明U1/U2/U4/U6操作序列跨runtime一致。应补独立真值fixture及三个运行时执行，再准备人工审阅。
- 29旧case仍全部draft（209pass/87todo是此前运行基线），当前旧REVIEW候选早于cast_edges、本地身份及来源分域，不能直接接受旧审阅包。重新生成可审阅差异属于后续门禁。
- M0 §21仍有未限定实际依赖域的单版本旧表述，与§17.6来源历史分域需统一；§14 fixture路径/实现需一致。M3未发现新的明确代码缺失，但Commons官方默认种子人工审阅不能由合成测试发布代替，公开发布另属外部动作。

### 2026-10-01 条件范围诊断与 Story 可移植用例（D-212，进行中）

上一轮为progress：草稿对象恢复已实现并获真实双页验证，审计另核实规范缺口。本轮按该证据补Core静态诊断和三类可移植conformance，整体goal仍active。

- `story.condition_constant`覆盖整数闭区间六种比较符、边界、单值域及极值，给具体cmp节点的warning，不改运行条件、不阻止保存。区间内等号/不等号不能用两端同值误判，错误类型/倒置范围不推导恒定结论。31新+20既有Core测试 **2文件51通过**（`/tmp/story-range-core-final2.log`）。作者check传递用例最初缺Scenario cast而失败，补合法fixture后通过，没有放宽生产校验。
- §21旧单版本表述已明确实际依赖域和来源历史域，§9.3记录诊断语义。D-212记录设计与实现边界。
- 框架正在将`kind:story`的evaluation/view/context三类接入统一bundle/draft/review/accept；新201–204及独立手写关键断言已在Node/Chromium/workerd **12/12通过**（`/tmp/story-portable-three-runtimes-final.log`），完整expected仍空/status draft。202包含31步、显式undetermined、重复确认、停止/继续、进入知情、typed非法状态；203/204使用真实build/viewOf/Catalog/Plan/messages。205渐进Source案例进行中，不计入当前通过。
- 接受前新增纯preflight及`draft/review.json`，绑定raw JCS输入/审阅说明和输出字节，重跑当前实现并拒绝硬违反、输出类型不符或过时结果。即使更改输入后输出碰巧相同，也需新候选。7测试通过（`/tmp/story-conformance-review-tests.log`），没有执行任何真实accept；框架agent正在补CLI文件不变验证。旧无receipt候选须重新生成。
- 主仓`pnpm test` **152文件2176通过**（`/tmp/story-portable-tests-all.log`）。Action已重建，仅刷新原暂存`actions/publish/dist/index.js`，check:action-dist通过（`/tmp/story-portable-action-{build,check}.log`）。最终全部conformance/types/lint/deps在框架与205冻结后统一运行，此处不提前标完成。
- 独立Harness当前仍8a4f快照，预计本轮框架交付后升级实际包消费；旧快照/三代代表历史日志保留，不因本次无schema变更造持久化ack。未在线调用、部署、发布或提交代码，stable llmdoc/meta未写。

#### D-212 最终三类用例与接受流程

- `case.kind=story / expect=story`、`input/story.json.kind=evaluation|view|context`加入共享类型/纯runner；`spec/conformance/story-v1/201–205`沿原bundle/draft/review/accept载入，禁止跨两个目录重复ID或任意路径。公开输出含逐步state/outcome/error/input_unchanged、逐项viewOf原因，以及实际Catalog/Plan/Source请求/messages/Trace与摘要；context失败保留view/catalog/plan/source/prepare阶段，固定选择失败也明确plan_valid:false。
- fixture输入验证必需字段和类型，不能把缺text的input当no-op、数字target或坏condition当规范负例接受；cast校验合法键与重复，Plan/selection互斥，profile/turn/judgment/source_texts等先校验形状。输入是显式validate操作时，允许形状完整但声明语义不合法的state供真实Core拒绝。硬违反（输入突变等）在draft状态也失败。框架三runtime **30项通过**（`/tmp/story-portable-framework-final.log`）。
- 五组独立手写语义断言最终 **15/15通过**（`/tmp/story-source-portable-three-runtimes.log`）。205按真实结构分别验证三层group→fragment与work→Source→section，不捏造group内包含Source；逐级expand顺序、未选Source零加载、选章只请求一个asset、原BOM/CRLF/NFD/尾空白正文经摘要核验、Door正文入messages而River与私有Source不泄漏。固定provider只是输入，未调用模型。sharedtest不把draft状态写成永久断言，未来合法accept后仍执行语义检查。
- `draft/review.json`绑定domain、case身份与说明、完整input（含手写assertions）及输出；raw JCS不归一作者字符串。接受前重新运行并核对receipt、当前输出、类型和硬约束，旧无receipt候选须重生成。真实工具测试在隔离临时目录执行拒绝，确认stale/缺receipt时原expected sentinel、case metadata、draft和bundle均未修改；没有接受仓库用例。helper7项、框架+工具Node11项均通过，终态总数以下方为准，不重复相加。
- 全部 **34个**用例候选输出/receipt/统一`spec/conformance/REVIEW.md`已刷新（`/tmp/story-portable-all-{drafts,review}-final.log`），生成物被ignore，不写expected。最终只读preflight确认34候选与当前输入/输出一致且全部仍draft（`/tmp/story-portable-candidates-final2.log`）；这不是语义人工接受。precheck通过（`/tmp/story-portable-precheck-final.log`）。旧29项的过时审阅材料已经替换为当前候选。
- 首次deps发现types→story实现→types的类型循环，已将所有Story fixture类型收回纯types.ts，实现单向引用，未放宽规则。最终全部conformance **28文件277通过/102todo**（`/tmp/story-portable-conformance-final2.log`），Node/Chromium/workerd全部实际运行，102todo=34case×3等待人工接受；workerd既有worker_threads fallback诊断不影响进程退出0/项目完成，不计为skip。
- 主仓全量unit/server-unit/web/admin **152文件2176项通过**（`/tmp/story-portable-tests-all.log`）；完整types通过（`/tmp/story-portable-types-main-final.log`），类型拆分后全tests tsc再次通过（`/tmp/story-portable-acyclic-types.log`）；最终lint通过（`/tmp/story-portable-lint-main-final2.log`），deps两组745模块/3611边、77模块/215边无违规（`/tmp/story-portable-acyclic-deps.log`），diff通过。Action final check通过，仅原staged dist更新；schema未变，未伪造新的schema差异。

#### 独立 Harness 消费同步

- 活动SDK升为 `third_party/charpub/snapshots/story-v1-219fd237a8efba66/`，manifest SHA `219fd237a8efba6641b7410ab3828cec24c803fd72999f5c14694f5402650080`。两个消费者、overrides、lock和真实dist一致，plain Node checkStory实际验证count∈[0,1] >1得到恒假warning，不是主仓源码alias。
- 原全部SDK快照和三代代表历史日志保留原字节；既有 **76项测试全部通过**，pending恢复零派发。package与严格NodeNext类型、constraints、snapshot verifier、diff通过；`doc-sync` **43/43全过，68.39s**，persistence65 roots/10 records不变，不新增ack或重写generation。日志`/tmp/harness-story-fixtures-{replay,runtime,types,constraints,docsync}.log`；独立执行包已记录。不重复捕获第四代相同样本，不新增launcher。
- llmdoc本轮为deep/dry_run，报告`.llmdoc-tmp/investigations/story-v1-portable-fixtures-dry-run.md`，stable/meta未改、五pending保持、旧mapping/G2未完成。没有commit/push/deploy/npm发布/生产迁移/在线模型调用。

#### 下一轮优先验证

- 一条M2线索仍为suspected：`packages/assembler/src/catalog.ts`以通用digestOf(turn)绑定Plan，而digestOf会归一Unicode/换行/尾空白；可能出现原字节不同的history/focus得到相同Plan绑定。尚未通过公开prepareContext实证，不能先当已确认漏洞或泛改全局digestOf。下一轮以真实固定Plan与raw文本变体复现，若确认则局部修TurnView身份并同步消费者。证据定位`.llmdoc-tmp/investigations/story-v1-turn-digest-next.md`。
- M0–M3仍须按完整要求逐项收敛，不能用新增277通过/34新鲜候选代替人工expected接受。M5/M6与G1/G2剩余事项保持原目标，goal active。

### 2026-10-01 运行时精确快照身份（D-213，进行中）

上一轮为progress：三类portable fixture与条件范围警告已实现；本轮按suspected线索做实际公开入口复现，未直接把通用作者digestOf改成另一种含义。

- 修前6个history/focus变体（CRLF→LF、NFD→NFC、尾空白）实测：Catalog不变、SelectorView已不同，history实际messages不同；旧Plan仍通过prepareContext与sourceRequests。`/tmp/story-turn-identity-public-before.log`保存6红态，soft断言让两个公开入口都真正执行，不仅比较digest推断。
- Core新增导出`digestExactJSON`：保字符串值及字典键，用原纯JSON验证和JCS/hash；键序、对象undefined可选属性与-0保持JSON等价，非JSON值拒绝，prototype-like自身键不污染原型。全局digestOf和作者Canonical规则未改。Assembler四个Plan输入摘要、Plan验证/Trace摘要与digestAssemblyMessages统一新helper；消息附件临时URL继续排除，其余内容和标识精确绑定。
- helper11项+公开Turn/消息/overlay/bindings/Plan note回归14项，共25新测试；精确原文变化拒旧Plan，JSON键序变动仍可重放。主仓最终`pnpm test` **154文件2201项通过**（`/tmp/story-exact-tests-all.log`）；types/lint/deps全过（`/tmp/story-exact-{types,lint,deps}-final.log`），deps747模块3615边及77/215无违规。
- Portable206通过真实`plan_from`复用此前完整成功场景的Plan。unknown/self/forward引用、与plan/selection混用、失败来源（包括Plan已验证但Source正文缺失导致prepare失败）均拒；这是fixture调度语法，不是Creation或产品Runtime能力。9场景覆盖history/focus/overlay原文变体拒与键序同义重放；输出catalog_digest直接取真实build.input，plan_digest用新helper。两共享文件三runtime **69项通过**（`/tmp/story-exact-plan-three-runtimes-final.log`），recorder未拿到修前红态，未伪称其独立red-green。
- 全部conformance终态 **28文件304通过/105todo**（`/tmp/story-exact-conformance-final.log`），三runtime实际完成；105todo=35case×3仍待人工接受。35份ignored候选/receipt/REVIEW已刷新，并由纯preflight逐份重跑证实与当前输入/输出一致、全draft且无expected（`/tmp/story-exact-candidates-final.log`）。Action重建并仅刷新原staged dist，check:action-dist过；无schema结构变化。
- 独立Harness也在旧219fd实际SDK探针确认命令幂等/Replay head、decision record、持久请求messages被正文归一摘要混同，正同步修runtime-owned摘要并记录升级guide。主仓SDK生产已冻结给其新pack；不改旧日志/快照/已提交generation，不fallback旧算法或重算旧head。已向用户说明含旧特殊文本的记录可能不再匹配。最终Harness及真实跨仓验证结果待追加，当前不预记通过。
- D-213与Story§12明确作者规范化身份和执行快照身份的分工。M2仍按全范围审计，不把本切片或304测试当整体完成；M5/M6/G1/G2剩余事项保留，goal active。无提交/push/部署/生产迁移/在线模型；stable llmdoc/meta保持未写。

#### 新 SDK 的真实消费已通过

- Harness新活动SDK `story-v1-0b3de6c1c5bed8bb`，完整manifest SHA `0b3de6c1c5bed8bb5fa9ef71592bba394e682a92dafc7a011a2975e9167063d3`。recorder重新严格NodeNext编译测试桥并verifySDK后，用明确独立命令 `E2E_HARNESS_ROOT=/Users/djj/code/char-harness pnpm --filter @char-pub/web e2e:harness`，真实 **1/1通过13.4s（用例6.8s）**（`/tmp/story-exact-harness-fullstack.log`）。
- 真实Source原字节摘要→固定provider实际messages→持久requestMessages→JSONL重开deepEqual完成；UI撤销后新读取/refresh仍拒绝。两图逐张实际查看并保存`.llmdoc-tmp/investigations/story-v1-exact-runtime-browser/`，runner/子进程退出，fixedDB已释放。未把固定模型结果说成在线模型效果。
- 本轮llmdoc:update报告`.llmdoc-tmp/investigations/story-v1-exact-runtime-digest-dry-run.md`已补上述SDK身份、独立指令、2201/304+105主仓终态。仍deep/dry_run，stable/meta未写；旧mapping与五pending/G2未解决。

#### D-213 独立 Runtime 最终验收与兼容边界

- Harness在旧219fd实际安装下保留六项修前红态（`/tmp/harness-exact-digest-red.log`），涵盖消息身份、Replay命令修改/同ID重试、provider receipt、持久请求与未选Source输入。runtime-owned绑定改用公开digestExactJSON，Registry已用JSON.stringify的精确mutation校验保持，作者canonical与Source字节hash不改。
- 新活动0b3de6c1快照下，`test:roleplay-runtime` **50项**（原42+8）与`test:roleplay` **31源码+2compiled+1verifier**合计 **84项通过**。package tsc、无源码alias的独立NodeNext tests、target lint、constraints、SDK校验与diff通过，日志`/tmp/harness-exact-{digest-green,replay,runtime,types,testtypes,lint,constraints}.log`。结构持久验证65 roots/10 records changes=[]，没有新ack或重写generation。
- 特殊文本兼容边界有真实旧包样本：`packages/experimental/charpub-roleplay-runtime/tests/fixtures/pre-exact-digest-replay.json` SHA `69473c0cd5eb1b32ae4db05ea9609030b035fe676dc84e9895cb511ac1113029`，新版明确拒绝`roleplay.replay_mismatch`且原字节不变，不fallback或重算head。它不是替代既有三代真实JSONL样本；后三者仍通过恢复与pending零派发。双语升级指南 `/Users/djj/code/char-harness/docs/upgrade-guide/v0.2.0-rc.2/roleplay-exact-json-digests/guide.md`说明原文件备份、显式审阅/新Session，不承诺任意旧记录兼容。
- Harness `doc-sync`首轮 **42/43**，唯一新guide双语互链问题已修；随后全translation pairing **1168 pairs**、upgrade-guides及md-links **2317文件**分别通过。不是单次43/43全绿，不重复已通过的Host构建与目录门禁。当前本切片无未完测试/文档门禁，已有真实跨仓浏览器结果。
- runtime/canonical摘要混用已从suspected提升为已复现修复，反思补原候选，不新增/晋升stable。D-213标Implemented；整体goal保持active，M5作者工作流/回流、M6剩余模型开局receipt和Laya协议/产品分发、最终人工expected/Commons与G1/G2继续按完整目标推进。下一步可回到作者工作流验收与M0–M3逐项收敛，不再把本轮已修摘要列为未知。

### 2026-10-01 作者预览来源与原生非文本内容（D-214）

上一轮为progress：运行时精确摘要及独立Harness消费已验证。本轮回到M5作者流程，未把静态平台扩成会话运行项目。

- previewPreparation保留同一次startSession的opening+实际Turn，兼容原previewInput/previewTurn入口；显式Turn不猜首句。PreviewOpening清晰区分玩家首句和scene context，分别可定位本作当前草稿字段；stale构建禁定位、不覆盖旧产物内容，Preset外部content无本地来源callback。默认语言编辑边界明示，bootstrap所有现有备选问候语可编辑且保metadata/译文。
- editor-location按稳定ID/真实schema路径映射Story各集合、Source/section、group与fragment；真实DOM anchor+Story页签/ContentGroups选择协调，定位消费后不锁住作者后续导航。未知/不存在对象退容器，未引入任意依赖到本地对象的推断。
- FragmentContentEditor原生支持text、dialogue、media、structured及locale变体。已有context资产选择、对白说话者/顺序、结构化schema/JSON、语言keyword保留，替换显式确认+防覆盖Undo；非文本main不再被Basics空textarea覆盖。未应用JSON保原文跨过滤/折叠，禁删除/改ID/切语言；root阻Build/Publish和测试保存，beforeunload与真实Router离页确认保护，Stay保buffer。没有新增audio上传或模型调用。
- PreviewPanel增加可配置model image能力（锁定profile不变），实际messages附件显示MIME/alt/身份；无图片能力保真实alt fallback。Trace支持dialogue/structured/media详情，标明编译默认源而非当前语言最终消息；unsupported-media区分保文本与完全跳过。真实Corebuild+prepare用例确认图片单独入选可tokens=0且实际附件存在；未自动加载资产URL，未改变Runtime隐私Trace。
- 全量pnpm test **156文件2222项通过**（/tmp/story-author-preview-tests-all.log）；pnpm typecheck、lint、deps全部退出0（/tmp/story-author-preview-{types-all,lint,deps}.log），依赖检查753模块3647边及77/215无违规。两项真实Editor Router回归含buffer阻构建/测试保存、折叠保留与Stay；本轮后续导航回归结果另补，不预记通过。
- recorder独占fixedDB运行新fullstack-preview-origin.spec.ts：**1/1通过14.1s（用例6.2s）**，/tmp/story-origin-fullstack-final.log。真实UI创建两scene/starts、dbld，验证无首句时system场次context、首句只一次assistant、隐藏Plotlines→源textarea focus、修改后stale禁定位，以及旧artifact/新draft/无Release真实API差异。首轮只测试getByLabel无法匹配，改实际combobox role后通过，未为测试放宽产品行为。三张图实际逐张查看，runner退出/fixedDB释放。
- 本轮无规范schema/SDK变化，不重复刷新candidate/Action/Harness包；既有105todo人工expected与Commons/G1/G2门禁仍在。未commit/push/deploy/npm发布/生产迁移/在线模型调用，原唯一staged Action dist未动。整体goal active，M5完整跨作品创作/回流、M0–M3逐项规范审计和M6剩余事项继续。

#### D-214 最终回归与交接

- 新增两项导航回归：跨隐藏Story视图/资料分组定位后，旧request不把作者手动导航拉回；同anchor新request可再次聚焦，真实组件+RAF **2文件10项通过**（/tmp/story-navigation-recovery-tests.log）。
- 发现并补JSON缓冲恢复边界：同一fragment重新加载成非structured类型/译文消失时，旧raw仍显示为可复制只读缓冲并可Discard，不因正文分支隐藏造成pending卡住；保持新源内容不变，不允许旧缓冲盲目覆盖。native组件 **9项通过**（/tmp/story-json-source-recovery.log）。
- 最终全量 **156文件2225项通过**（/tmp/story-author-preview-tests-final.log）；完整typecheck、lint退出0（/tmp/story-author-preview-{types,lint}-final.log），deps前述边数不变且通过，git diff --check通过。仅Web/执行文档改动，无需重复SDK/conformance/Harness检查；未将上一轮105todo计作本轮通过。
- llmdoc:update为 **deep/dry_run**，报告`.llmdoc-tmp/investigations/story-v1-opening-source-dry-run.md`，三张已查看图片在同目录`story-v1-opening-source-browser/`。新增来源/定位文件为已有Web owner的missing mapping，测试/截图intentional no-doc；stable/meta未写，旧assembly-input.ts映射仍需正式修复，五pending仍保留，G2未完成。
- 下一步：按M5剩余完整作者路径，验证跨作品角色组合、资料渐进展开与Runtime回流成创作修改的连贯流程；再据M0–M3审计逐项补最终证据。M6具体Laya协议/模型开局receipt、人工expected/Commons和最终ci:all/G2门禁保持待办，不缩小目标。

### 2026-10-01 作者目录解释与完整双角色创作路径（D-215）

上一轮为progress：D-214完成原生非文本/来源定位。本轮按M5完整作者路径调查，既有用例分别覆盖seed player剧情与单Character发布，没有验证通过UI选择两部已发布Character再发布Scenario；同时锁定预览无法向作者解释hidden来源，未锁定公共预览却沿用author Trace。

- 新PreviewCatalog由DraftPreview/ProposalPreview显式开启，放在原评级/账号/job边界内。复用同次实际输入的Catalog，展示required/direct、受真实预算/深度约束的initial candidates及fragment/source hidden原因；Source/fragment身份有可读名称与精确来源。检查面板不选材、不下载正文，不把内部nodes全集冒充目录，不为错误放宽预算。Story goal/part等不在visibility中的对象不伪造隐藏诊断，列表明确只覆盖片段与资料。
- PreviewPanel无论是否锁定均删除author diagnostics，最终Trace采用consumer过滤。作者sidecar不进Selector/Plan/messages/fixture；公开预览默认不显示作者面板。17项Source-preview包含新增locked/unlocked author解释、切视角重算、公共面板关闭/隐藏fragment无Trace入口。另2项真实Catalog RTL用三层group+Source section、实际fixedSelection/plan验证只展示initial目录，打开零fetch、input/plan/sourceRequests不变；预算0错误保持。
- 最终Web **61文件481项通过**（/tmp/story-catalog-web-all.log）；完整pnpm typecheck、lint、deps均退出0（/tmp/story-catalog-{types-all,lint,deps}.log），755模块3655边及77/215无依赖违规。独立panel tests 2/2与Web types通过；git diff --check通过。SDK/schema/Assembler无改动，没有为Web切片重复pack或刷新规范候选。
- U1新增fullstack-two-character-story.spec.ts，recorder独占真实DB运行 **1/1通过17.7s（用例11.0s）**，/tmp/story-u1-fullstack-final.log。API仅准备Alice/Bob两部真实CC0 public Release；Scenario创建、两次精确release picker、移除seed player、写一场戏、dbld预览、UI Publish 1.0.0及匿名公开预览全部实际界面执行。核实两cast_key、draft精确pins、dbld/public产物lock和各角色Release来源、场次正文及角色正文不重复，不需要变量/条件；新publish是真实worker active/public，匿名可读取产物。
- U1三张截图实际逐张查看：私有预览、真实发布成功、匿名公开预览。runner退出且fixedDB释放。第一轮webServer exit1无详细诊断，拆分tsc/vite均过，带debug后正常启动，原因未证实；第二轮测试setup POST漏Origin而被正确403拒，补测试同源头后通过，未放宽产品CSRF/权限或绕开UI写cast。没有把测试前置问题算作产品修复。
- Runtime回流只读审计明确下一缺口：Registry现有ReleaseSource API已有可信revision与源定义；独立Harness缺精确读取及本地提案审阅/确认链。scratch `.llmdoc-tmp/investigations/story-v1-runtime-return-next.md`给已游玩精确Release→本地Ending→确认OAuth投稿→原作者网页接受方案，禁止直接上传inspect含history/Source/凭据的完整日志。现derive只有静态派生，不能冒称带运行态续作。独立client精确source基础正在补，最终结果另记；完整回流尚未验收。
- 整体goal active；本轮U1获得完整证据不等于全部M5。M0–M3全要求审计、M5回流/其他代表用例、M6开局receipt/Laya协议与分发、人工expected/Commons及最终G1/G2仍保留。无commit/push/deploy/npm发布/生产迁移/在线模型调用，原唯一staged dist保持。

#### U1 与作者目录收尾、独立消费端的下一步基础

- llmdoc:update本轮仍 **deep/dry_run**，报告`.llmdoc-tmp/investigations/story-v1-u1-author-dry-run.md`；证据图在同目录`story-v1-u1-author-browser/`。新全栈spec与截图为intentional no-doc，作者目录/consumer投影由既有Web/assembly owner承接；stable/meta未写，旧映射与五pending/G2仍待正式维护。§17.3和DOR已同步本轮语义与实际证据。
- 独立Harness新增`RegistryClient.releaseSource(exact, signal?)`：先复用精确Release/Artifact核验，再以回执当前ref+精确label读取既有公开source API；canonical源的原ref、作品id、semantic_digest须匹配已验证产物/回执，Revision格式校验通过后返回。Revision与Release的对应关系来自Registry端精确来源映射，不声称源摘要密码学绑定Revision。改名不改原定义，缺来源/撤权/取消不回退IR或最新版本。
- Registry协议 **21/21**（新增7项含改名、错身份/正文、403无fallback、预取消与三阶段取消）；Runtime包全 **57/57**，包tsc、独立无源码alias的NodeNext测试类型、定向lint及compiled public package smoke通过。文档README双语pair、2317文件mdlinks、exports JSDoc通过，最后文档预算/措辞门禁待独立代理终态。此处为mock HTTP协议+实际packed SDK/公开构建包证据，不冒称真实Registry源码GET或完整回流已验收。
- 无SDK快照、lock/pointer、Session日志、ack/generation变化。下一轮继续将已固定源码基线连接到本地新Ending提案、明确内容/许可确认、一次OAuth投稿与原作者网页接受，再验证失败/取消/并发路径；不用读取Session完整日志代替允许上传的白名单内容。当前新增方法只读，不新增远端写入或发布。

- 独立Harness最终文档预算/措辞门禁、diff-check也通过，全部命令已退出。日志`/tmp/harness-release-source-{runtime,tests,types,testtypes,lint,built-smoke,pair,links,jsdoc,doc-budgets,terms}.log`。改动限runtime registry/client、registry tests、README双语/配对元数据与独立执行记录；无生产网络调用/写回。本轮整体仍为progress，goal保持active。

### 2026-10-01 Runtime 历史快照的 Ending 投稿回流（D-216）

上一轮为progress：作者目录/U1与精确发布源码读取已完成。本轮利用既有HTTP和Core契约闭合单Ending回流，未在char.pub托管游玩，也未新增SDK wire/schema。

- 独立Harness新增公开`createEndingProposals({registry,inspect})`的prepare/submit。prepare读取实际已提交Session，拒pending和非发布Story，按原ExactRef经releaseSource取得不可变作者源/Revision；仅Core校验单个新Ending并生成ending add+endings order，不从IR反构、不换latest、不写原状态初值。候选完整展示目标当前地址、精确版本、原版本根分级/许可/提示、Ending及实际request；调用者仍沿用产物聚合评级gate，source_*不冒充当前draft/aggregate政策。
- 候选按实例票据、精确JSON摘要、权利声明、本地committed head/state_digest和授权代次绑定，复制/修改/错误确认/重复提交均拒。工厂固定registry/inspect实例，独立review发现的可变服务容器换client同epoch问题已补真实回归。submit在本地重新检查后绑定该历史快照，不锁住网络等待期间的新游玩；不把已审阅提案暗换成新状态。
- RegistryClient增加只读authorizationVersion，确认可携expectedAuthorizationVersion；POST前await access两侧核对并要求Token存在。成功新grant、撤销、失去凭据/失效、dispose使旧票失效，同主体refresh保持epoch；不额外要求profile scope。新contribute可选signal贯穿请求。预取消零POST；尝试派发后票据始终consumed，明确HTTP4xx保拒绝码，网络/取消/响应无法验证等不确定结果用roleplay_proposal.outcome_unknown，不自动重试。此为进程内确认门禁，未发明跨重启幂等或人类手势证明。
- 产品定向Ending9+Registry23共 **32/32**，最终Runtime包全部 **68/68**（/tmp/harness-ending-proposal-runtime-final.log）；包tsc、无源码alias的独立NodeNext tests、target lint与compiled公共导出smoke通过。真实Loader/JSONL隐私用例将匹配SHA的Source正文实际送入fixed provider，确认candidate/实际POST无PRIVATE_SOURCE与私聊sentinel，原JSONL bytes不变。persistence验证65 roots/10 records changes=[]，无ack/generation/SDK快照/lock/pointer变更。文档尾验结果待末条追加。
- recorder扩独立测试桥，仅调用上述compiled产品API；先真实创建持久Session并完成固定provider一轮，审阅白名单DTO后才发独立确认RPC。真实OAuth跨仓：旧Release1为基线（已存在Release2），prepare零写、预取消零POST、重新prepare后一次contribute；owner期间UI修改另一场次time，Web Review/本地merge preview/Accept最终保留新Ending与最新time。核实平台实际旧Revision、agent:true、真实client_id、仅七类合法请求字段、无聊天历史、Session current/head/log完全不变、仍只有原两个Release。
- 首次完整`E2E_HARNESS_ROOT=/Users/djj/code/char-harness pnpm --filter @char-pub/web e2e:harness`：原读取/撤销case通过，新回流已进入Web Review但test heading漏`#1`前缀而失败（/tmp/story-runtime-return-fullstack.log）。仅修定位为标题substring，再独立`-g 'external Runtime reviews'` **1/1通过13.1s（用例6.5s）**（/tmp/story-runtime-return-fullstack-final.log）。不是同一次2/2全绿，没有更改产品适配测试。bridge strict NodeNext/oxlint、SDK验证0b3de6c1通过；runner/child均退出，fixedDB释放。
- 两张实际Review/Accepted截图逐张查看并归档`.llmdoc-tmp/investigations/story-v1-runtime-ending-return-browser/`，显示Agent、旧revision、newEnding/order干净合并、owner新Midnight与接受后Versions2。固定起草数据和确认RPC不声称在线模型整理质量或成品Runtime玩家GUI。
- 主仓本轮无生产逻辑改动，改spec§17.8、D216/执行记录与真实跨仓E2E。完整typecheck/lint/deps/diff通过（/tmp/story-return-main-{types,lint,deps}.log），756模块3658边及77/215无违规；不冒称重跑新全Web/Core unit，不无效重pack SDK/Action或刷新schema/candidate。
- llmdoc:update仍deep/dry_run：`.llmdoc-tmp/investigations/story-v1-runtime-ending-return-dry-run.md`。stable/meta未动，原五pending保留；固定客户端+epoch教训补既有frontend-identity-and-async-snapshots候选，不新增/晋升。G2旧mapping与dirty source状态未解除。无commit/push/deploy/npm发布/生产迁移/在线模型。
- 整体goal保持active。单Ending贡献通路已有真实证据，M5仍需Runtime预览输入回流、携运行态续作/Remix及其余完整代表案例按原范围收敛；M0–M3逐项审计、M6开局receipt/Laya协议及分发、人工expected/Commons与最终G1/G2继续。下一步优先按spec§17.4明确选择摘要/合成历史回到预览，而非把完整Session日志上传为作者测试。

#### D-216 终态门禁

独立产品与文档全部冻结、无后台命令：README named-pair、2317文件链接、exports JSDoc、8份文档预算及措辞门禁均通过，diff-check通过。日志`/tmp/harness-ending-proposal-{runtime-final,types-final,testtypes-final,lint-final,pair-final,links,jsdoc-final,docbudgets,terms,persistence}.log`；独立执行记录`/Users/djj/code/char-harness/spec/goals/roleplay/PROGRESS.md`与主仓scratch `story-v1-runtime-return-next.md`已同步本库语义/证据。D-216标Implemented；仍不宣称完整Runtime客户端、自动剧情整理、跨进程幂等或携运行态续作完成。

### 2026-10-01 Runtime 合成输入导出、Web 导入与作者测试（D-217）

上一轮为progress：D-216完成新Ending的真实投稿回流。本轮完成另一条明确用户操作链：Runtime已提交状态→本地合成预览文件→Web再次审阅/确认→匹配草稿预览→单独保存作者测试并worker重跑。用户中途询问进度，已说明核心/发布/协作链与两类回流现状、剩余运行态派生/逐项审计/人工与最终门禁，任务继续。

- Core新增RuntimePreviewInputSchema/type与1MiB上限，公开JSON Schema为spec/schema/runtime-preview-input.schema.json。严格source完整BuildRef/lock/artifact_json_digest，actual profile/preset/tokenizer，turn只含明确locale/bindings/history、scene/present/完整Story状态与可选视角/guidance。文件无overlay/模型judgments/manual/focus/Plan/Source/log/确认字段。Assembler validateRuntimePreviewInput纯校验精确来源、策略、tokenizer版本/locale、完整state及绑定/speaker，不IO、不读时钟、不重开局或装encoder，不保证最终预算；实际预览仍使用真实pinned counter。
- 共享helper+JSONSchema **2文件68通过**，新增portable调用在Node/Chromium/workerd **3文件24通过**（新2条×3）。Core/Assembler类型、测试类型与定向格式通过。全量主仓 **159文件2264通过**（/tmp/story-preview-handoff-tests-all.log）；完整types/deps/lint-final通过（/tmp/story-preview-handoff-{types,deps,lint-final}.log），761模块3685边及77/215无依赖违规。首lint仅E2E新file链式调用行格式，持有者已修；无产品规则放宽。
- 全conformance **28文件310通过/105todo**（/tmp/story-preview-handoff-conformance.log），三个项目实际完成，workerd既有worker_threads fallback不算跳过。105todo仍是35候选×3待人工接受；纯validateDraftForAcceptance逐份当前实现重跑确认 **35 current**（/tmp/story-preview-handoff-candidates.log），未改expected/status/draft输出。check:action-dist通过（/tmp/story-preview-handoff-action-check.log），没有刷新/重暂存原唯一staged Action dist。
- 本轮确有共享SDK新增API：实际pack并安装新快照 `story-v1-b1eba617193f35a2`，manifest SHA `b1eba617193f35a27c271f51b88674cb7733502ff2e5c6cb1a5e239cb1a78e81`。两个consumer、overrides、current和lock一致，offline install与verifier退出0（/tmp/story-preview-sdk-pack.log、/tmp/harness-preview-sdk-{install,verify}.log）。所有旧tarball/manifest仍保留，不用主仓源码alias冒充外部包消费。
- 独立Harness公开createRuntimePreviewExports({inspect})：prepare只从current.state提取完整状态，从用户显式history/bindings/for_participant生成合成turn，不取旧prepared_turn或复制原聊天/角色描述。export另确认精确候选与同一committed head/state；fixed inspect实例、WeakMap票据、原文精确摘要、过期dbld与取消检查。返回JSON/typed payload不含review Session/head/授权标记；无HTTP/模型/自动文件写入。同快照重复确认可导出相同bytes，不套用投稿一次派发语义。
- Harness新export **7项通过**，最终Runtime **75/75** + Replay **31源码/2compiled/1verifier**共 **109项通过**；三代真实历史原bytes保持，persistence65 roots/10 records changes=[]。包与无源码alias NodeNext types、compiled public export、target lint、constraints、README pair、links2317、JSDoc、文档预算/措辞、diff通过，日志`/tmp/harness-preview-export-{runtime,replay,types,testtypes,smoke,lint-final,persistence,pair,links,jsdoc,docbudgets,terms,constraints}.log`。无新ack/generation或Session重写。
- Web RuntimePreviewImport在评级遮挡内先限物理文件bytes、fatal UTF-8/JSON解析及共享验证；展示来源、合成消息/角色绑定和完整字段，再由本次checkbox/Load确认。文件的reviewed/approved不可信且schema拒绝。异步读取检查账号、artifact和request epoch；不同文件清确认。过期或不匹配source只拒绝，不取latest/创建新dbld。PreviewPanel使用完整turn和实际profile/preset/pinned tokenizer，无重复opening；普通Session/Rehearsal控件收起，Exit恢复原设置；可选内容从空选择开始，显式选材继续可用。3项真实组件回归含审阅前无apply/保存、精确profile/history、退出恢复、伪确认/mismatch与晚读失效。
- recorder将链路扩至现独立Harness第一case，复用已授权private dbld和真实Source/Session恢复：导出显式合成两条history/bindings，wrong source文件拒且旧messages/draftversion不变/零write；合法文件Web再次审阅后载入，各历史仅一次、无原welcome/Runtime回复；作者另选Source、单独Save fixture、Run author tests，实际worker Passed，root:self仅来自同一dbld，CRLF/NFD合成原文及整篇Source bytes保存、expected不自动更新。读取/导出不改Session/log。
- 首完整e2e:harness运行：既有Ending回流case通过，新增导入case因测试未填初始required player名而停在预览（产品正确拒未绑定角色）；仅补UI Guest输入，再重跑失败首case **1/1通过16.5s（用例10.2s）**，/tmp/story-runtime-import-fullstack-final.log。原完整日志/tmp/story-runtime-import-fullstack.log，不宣称同次2/2。bridge strict NodeNext/oxlint及SDKverify通过，runner/child退出，fixedDB释放。两张新增review/test-passed截图实际逐张查看后由recorder归档。
- §17.4、D217、DOR同步交接语义及已验收边界。旧Release输入只能在匹配产物本地预览，不自动变成新draft的root:self；跨版本状态重映射、运行态续作/Remix与完整RuntimeGUI继续未完成。整体goal active；M0–M3完整规范审计、M5其他代表路径、M6开局receipt/Laya协议/分发、人工expected/Commons及最终G1/G2保留。无commit/push/deploy/npm发布/生产迁移/在线模型；stable llmdoc/meta仍未写，原五pending/旧mapping待维护。

#### D-217 文档与证据收尾

llmdoc:update为deep/dry_run，报告`.llmdoc-tmp/investigations/story-v1-runtime-preview-import-dry-run.md`；两张已查看截图在同目录`story-v1-runtime-preview-import-browser/`。共享协议及精确身份由既有runtime owner承接，Web本地审阅由creator-experience owner承接；新测试/截图为可重建证据。stable/meta未写，旧assembly-input.ts路由映射和五pending仍未正式修复/晋升，G2未完成。所有本轮运行命令已终态，独立SDK/产品与Web实现冻结；D-217为Implemented，整体goal继续active。

### 2026-10-01 从当前局面起草新续作（D-218）

上次用户状态询问仅核对已有证据，按no-progress归类；本轮恢复实际实现。目标仍为完整Story v1，不以单续作代替保留旧剧情的状态Remix、M0–M3逐项审计、M6模型开局/Laya、人工审阅或最终G1/G2。

- Core新增StoryContinuationInputSchema/type和公开JSON Schema，deriveCreation.from_play仅sequel且与ending互斥。严格按源定义验证变量/知情/引用，将局面变新静态初值；保当前scene ID与背景关联，清旧剧情/scene goals/入场知情/start效果。Core+schema72通过、Node/Chromium/workerd实际启动/prepare18通过（`/tmp/story-from-play-conformance.log`），Core tsc通过。
- Contracts/Registry冻结：真实source Artifact根ref/release/digest校验、独立私有草稿与既有许可/资产/授权；agent PAT强制true，OAuth仅记录真实client_id。Registry10/10（`/tmp/story-from-play-registry-final.log`）、OAuth6/6（`/tmp/story-from-play-oauth.log`），全tests tsc通过。12非法输入零残留、原初始化效果不重复、OAuth不能后续PUT或发布均有真实集成证据。
- Web新增Draft origin只读面板，显示agent辅助说明与完整精确来源；普通Summary编辑保存保留历史字段，不输出client_id，不增加checkbox/发布阻塞。Editor21/21、Web类型及定向格式通过。
- 共享SDK已重新打包、offline安装与verifier通过：`story-v1-35a088537d6fc8a0`，manifest SHA `35a088537d6fc8a04cb9ddbc1064a4609faed3394559f86df03d7a724500dc7e`，旧snapshot全部保留。日志`/tmp/story-state-sequel-sdk-pack.log`与`/tmp/harness-state-sequel-sdk-install.log`。新SDK消费与完整跨仓E2E仍待本轮终态。
- investigator负责Harness产品API/单测，recorder独占test-only bridge/固定全栈DB，reflector独立审计，root负责SDK/spec/最终门禁。主仓全量test与typecheck已启动，未预记通过。stable llmdoc/meta未写，无commit/push/deploy/npm发布/生产迁移/在线模型调用。

#### 主仓回归与分发

- 完整`pnpm test` **159文件2286通过**（`/tmp/story-state-sequel-tests-all.log`）；typecheck、lint、deps退出0（`/tmp/story-state-sequel-{types,lint,deps}.log`），762模块3689边与Admin77模块215边无违规。
- 全conformance **28文件313通过/105todo**（`/tmp/story-state-sequel-conformance.log`）；105todo仍为35案例×3待人工接受。纯preflight确认全部35候选current（`/tmp/story-state-sequel-candidates.log`），未改expected/status。
- 首次Actioncheck发现共享Contracts变更使已打包Action过时（`/tmp/story-state-sequel-action-check.log`）；重新构建并仅更新原唯一staged `actions/publish/dist/index.js`，最终check退出0（`/tmp/story-state-sequel-action-check-final.log`）。没有提交或暂存其余改动。
- 独立审计未发现Core/Registry/Harness新的阻断问题；文档明确只清场次目标，保留角色背景目标。候选确认按原模型采用保守的一次attempt：Token等待中取消也可能消费候选并报告结果未知，不承诺能精确证明零POST。
- Harness README双语补新静态开局、完整审阅、隐私字段与一次提交后对账规则。named pair、2317文件链接、公开JSDoc、文档预算与措辞检查通过（`/tmp/harness-state-sequel-{pair,links,jsdoc,docbudgets,terms}.log`）。Runtime全量与真实跨仓E2E仍在执行，未把新增单测当作完整闭环。

#### 独立Harness与真实新草稿闭环

- `createStoryContinuations({registry,inspect})` prepare/submit已冻结；完整本地review展示目标/source/根和聚合评级/完整请求/reset，派发仅derive白名单。Registry.derive增加可选signal贯穿现授权与请求逻辑。新9项含真实Loader+JSONL stopped Session、原Source实际进入provider但不进派生请求、原日志字节保持、agent true/false及竞态。Runtime **84/84**、Replay **31源码+2compiled+1verifier**，合计 **118通过**；日志`/tmp/harness-continuation-{runtime-final,replay}.log`。
- 包tsc、独立NodeNext tests types、定向lint、constraints、实际compiled公共导出smoke全部通过，日志`/tmp/harness-continuation-{types,testtypes-final,lint-final,test-lint,constraints,build,smoke}.log`。persistence **65 roots/10 records changes=[]**（`/tmp/harness-continuation-persistence.log`），三代真实Session样本按原规则恢复，未新增ack或改旧字节。独立执行记录已同步。
- recorder新增第三条真实跨仓case，独立命令 `E2E_HARNESS_ROOT=/Users/djj/code/char-harness pnpm --filter @char-pub/web e2e:harness -g 'confirms a played situation'`：**1/1通过15.0s（用例10.0s）**，`/tmp/story-continuation-fullstack-final.log`。本轮只运行新增case，不称三case整组已重跑。首轮fixture误用了不存在的forget效果，服务端正确422；仅改为现有learn后通过，没有放松产品规则。
- 真正从旧Release1开始Session（已存在Release2），运行input/confirm beat/set-present，使vars从旧start后的3变7、只bob在场、alice/bob知道信息；prepare零POST，单独确认后一次derive。新草稿属于本人且private，精确来源锁仍是R1；Web agent/来源可见，用户改opening保存刷新后真实worker预览。新init vars=7/present=bob/知情完整，无旧start/enter/ending重放或旧history、没有新Release。Registry专项另以只bob知情验证旧enter不会额外教alice，未把该独立断言冒充浏览器同一状态。
- 两图已由执行者实际查看并保存`.llmdoc-tmp/investigations/story-v1-runtime-continuation-browser/{runtime-sequel-editor,runtime-sequel-preview}.png`。runner/bridge均终态，固定DB释放；不输出OAuth凭据/完整Session日志，不声称固定provider证明在线模型整理质量。
- D-218标Implemented；本轮为progress。整体goal仍active，完整M0–M3规范对照、M5其他代表路径、M6已记录缺口、35人工expected与Commons、最终ci:all/G2均未擅自勾选。reflector另做只读范围/证据矩阵，以原规范辨别实际剩余义务，避免把“从当前状态写新作品”扩张为未经要求的无损存档系统。

#### 知识维护与最终状态

recorder完成`.llmdoc-tmp/investigations/story-v1-runtime-continuation-dry-run.md`：**deep/dry_run**，status33文档/26影响/4待review/26dirty/528unmapped，scoped4影响0待review。validate仍因旧assembly-input.ts映射失败；stable/meta未写，五pending未晋升，未finalize或刷新指纹，G2保持未完成。新增源码路由按既有Core/Registry/Web owner补mapping建议，不为每个新文件建知识文档。桥strict NodeNext与oxlint、主仓最终lint（`/tmp/story-state-sequel-lint-final.log`）及两仓diffcheck通过，当前本切片全部命令终态。下一轮从原规范逐条核对剩余产品义务，再处理实际缺口，不继续扩大D-218范围。

### 2026-10-01 按规范收敛与真实缺口修复（进行中）

上一轮D218完成真实跨仓闭环，属于progress。本轮开始逐项对照需求和源码，而非继续从历史待办扩展目标。

- 部分验收矩阵：`.llmdoc-tmp/story-v1-m0-m3-acceptance-matrix.md`（总范围/M0）与`.llmdoc-tmp/investigations/story-v1-m1-m3-current-matrix.md`（Core/Assembler/工具链）。这些是具体源码和代表案例映射，不是已完成全部DOD的证明。
- D219纠正范围：独立VISION明确最小入口、不承诺完整游戏客户端；默认Web/SDK分发与自动模型开局receipt保留为限制/后续路线，不由反复PROGRESS文字升级为本次硬验收。纯开局greeting/locale/先判scene.when/unknown拒绝仍属于本次规范义务。Remix去向保留，但未找到无损保留原剧情/全部Session日志的原始要求。
- Laya公开来源现已核实为匹配候选NandhaKishorM/laya及convaiinnovations/laya；固定源码SHA `6d942c92081fbc139e736bbd9ac0023223c29b7f`，详细证据`.llmdoc-tmp/investigations/story-v1-laya-provider-evidence.md`。tb无通用网页检索能力后用web/上游源码与git只读查证。原生API实际model路由、low_confidence弃权、截断/限额必须单独适配；尚未实现Laya、下载权重或调用在线模型。
- D220修Catalog丢失作者目录线索：perspective、view-safe resolved about、activation_hint纳入同DTO、预算与摘要。metadata相关27单测及跨三runtime27通过；结合view-priority/catalog/prepare/style-order **4文件40通过**（`/tmp/story-catalog-metadata-freeze.log`）。根按规范修viewOf先后，真实build新3项验证withheld计数/优先原因/Selector隐私。新测试两处exactOptional缩窄已修，全tests tsc最终退出0（`/tmp/story-audit-testtypes.log`）。新SDK尚未pack，旧历史兼容不提前宣称。
- 规范修正Scene没有effects的批次表，统一作者目录诊断与消费Trace分工；保持已有私密隔离，不恢复网页消费Trace中的隐藏内容。
- 首次完整`pnpm ci:all`退出1（`/tmp/story-g1-ci-all.log`）：lint/types/deps、unit覆盖 **88文件1751**、Web/Admin **71文件535**、conformance **28文件313+105todo**、真实integration覆盖 **83文件1541**、完整build均过；Web mockE2E有8失败，尚未执行后续Admin/Action/secrets。recorder确认8项皆旧fixture/locator，修4测试文件后单独完整`pnpm test:e2e` **Web62通过/22既有skip、Admin107通过**（`/tmp/story-g1-e2e-all.log`）；22skip是18需独立全栈环境用例+4按需截图，不计为已验收。`pnpm secrets` Git与dir均无泄漏（`/tmp/story-g1-secrets.log`）。首轮CI不能因此改称通过。
- 审计明确另两项规范产品缺口：F1校验诊断缺实际修改建议/条件节点定位；F4发布面板未根据真实Artifact显示实验能力并让作者确认。investigator负责F1 Core，reflector负责F1 ChecksPanel/规则节点定位，recorder负责F4发布及作品页（独占fixedDB）。root负责规范、SDK与最终集成。最终整条ci:all待这些已知功能补齐后运行，避免在已知会失效的中间状态反复全量。
- 当前goal active，DOD未新增勾选，stable/meta/5pending不变。没有commit/push/部署/生产迁移/公开发布；本轮内部新草稿/发布仅隔离测试。

#### 目录、诊断与独立SDK终态

- F1 Core仅完善checkStory.detail的问题/实际修改建议，code/subject/数据结构不变；不猜locale或自动改ID。3文件57项通过，新6项验证按真实建议修复后checkCreation/confirm/evaluate成功且原稿不变；Core及全tests tsc通过，日志`/tmp/story-author-diagnostics-testtypes-final.log`。Web按当前Working语言显示标题/ID/subject，Core detail原样展示；when节点的稳定anchor在当前树存在才使用，失效退对象。真实组件checkCreation→ChecksPanel→嵌套条件focus→修改后清错，共3文件33项通过；Web类型与相关格式通过。并行F4重复错误提示交其owner收敛，未伪称全Web已复跑。
- 新活动SDK `story-v1-7877e378043602ce`，manifest SHA `7877e378043602ce5c1426ceaa923425c203a6527e1c763abd31ee276613ee93`；pack/offline install/verifier退出0（`/tmp/story-catalog-diagnostics-sdk-pack.log`、`/tmp/harness-catalog-diagnostics-sdk-install.log`）。旧快照全部保留。
- 独立Harness Runtime84/84，Replay31源码+2compiled+1verifier，共118通过。首轮Replay唯一失败是Jev真实请求快照的两个展开叶子新增activation_hint:keyword，核对无正文/隐藏内容变化后只更新此测试snapshot；历史Replay/JSONL、Plan/head及原bytes不变，三代样本通过，pending不重发。persistence65 roots/10 records changes=[]。types/lint/constraints/compiled factory smoke全过；双语升级指南`roleplay-catalog-metadata`及replay README完成，pair2/guides/links2319/wrap2340/budgets8/terms/diff通过。日志`/tmp/harness-catalog-sdk-{replay-final,runtime,testtypes,lint,smoke,constraints,persistence,pair,guides,links,wrap,docbudgets,terms}.log`。
- 主仓当前全conformance **28文件316通过/105todo**（`/tmp/story-audit-conformance.log`）。35份draft/receipt/REVIEW按新目录及诊断刷新，再逐份preflight确认current（`/tmp/story-audit-conformance-{draft,review,candidates}.log`），没有accept或改status/expected。Commons机械检查 **26/26**通过（`/tmp/story-audit-commons.log`），人工原创/适龄/措辞审阅仍待。
- Action随新Core/Assembler重建并仅刷新原staged dist，check通过（`/tmp/story-audit-action-check.log`）。D220已实现；F4发布流程和Laya具体适配继续进行，最终ci:all与G2仍未完成。

#### 实验能力发布确认（D221）

- 发布面板打开后按saveSnapshot真实构建，读取验证后的Artifact能力；无实验项不加checkbox，实验项须本次确认。固定receipt.origin.revision发布，改稿/关闭/换账号/过期废旧review；派发前同步QC身份及Date.now核验，render ready不替代即时检查。保留同revision/label/visibility幂等键，未知结果不声称未发布，显式重试沿原键。
- 新10项RTL覆盖真实能力/未确认零POST/固定revision/actor与expiry同步窗口/未知结果重试，旧Editor21项合31通过。全Web **65文件503通过**（`/tmp/story-f4-web-all.log`）；旧editor mock **8通过/1既有skip**（`/tmp/story-f4-editor-e2e3.log`），其初步IR-only mocks已改真实Artifact及摘要，不放宽产品检查。
- recorder独占真实`fullstack-experimental-publish.spec.ts` **1/1通过9.3s（用例4.7s）**（`/tmp/story-f4-fullstack-final.log`）：用户未勾零POST、勾选后payload.revision等于实际dbld.origin.revision、匿名作品页有实验标识。首轮已发布成功但测试仍按旧dialog标题定位超时，仅修阶段heading定位后重跑；未改生产适配错误测试。两图已实际查看并归档`.llmdoc-tmp/investigations/story-v1-experimental-publish-browser/`，固定DB和runner已释放。
- F1 Web会话stdout证据以明确转录摘要保存`.llmdoc-tmp/investigations/story-v1-f1-web-verification.md`，不是伪造原始log。F4审计教训追加既有frontend-identity-and-async-snapshots pending，仅记源码发现与已通过新回归，不声称存在修复前红态日志；五pending数量不变。
- M5完整章节审计发现后续明确事项：发布前正文/description/结构差异与对象引用影响、per-agent作者额外检查/shared动作、平台Runtime交接入口等。其细节由reflector矩阵保存；作品级public dependents与整包release_fragments不能冒充准确对象引用索引，不能泄露无权读取的私有下游作品。最终ci:all继续待这些已知产品义务收敛，不把新增测试后的分项结果拼成单次完整CI通过。

#### 本轮主仓最终回归与M5清单

- 普通派生来源此前被authored_by_agent条件整块隐藏；现精确来源独立显示，仅agent说明受true控制，空来源且无agent时不显示空块。Editor23项通过（`/tmp/story-nonagent-origin-tests.log`），Web types/lint通过，不写稿或增加发布门禁。
- 该小修后完整`pnpm test` **163文件2315通过**（`/tmp/story-audit-tests-all.log`）；全typecheck、deps通过（`/tmp/story-audit-types-all.log`、`/tmp/story-audit-deps.log`），768模块3731边与Admin77/215无违规。首lint仅根新view-priority测试缩窄变量后的格式问题，定向格式化后全lint通过（`/tmp/story-audit-lint-final.log`）。不是完整ci:all通过。
- `.llmdoc-tmp/story-v1-m5-acceptance-matrix.md`覆盖§12.4、16–18，明确W1发布分类差异、W2准确对象引用影响、W3per-agent检查/修正、W4平台Runtime交接、W5选角便捷入口、W6作品能力呈现；W7聚合许可/评级解释读取IR而非Artifact的差异待真实fixture验证。W8普通非agent来源本轮已修。下一轮按此具体清单实施，平台交接入口与完整Runtime客户端不是同一范围。
- 关于状态Remix的语义已异步向用户询问三选项：现静态Remix+新局面续作足够／保原剧情以当前数值重开／沿用本局已达成进度。尚未收到答复；该问题不阻塞现已明确的工作，也不能将等待时间当作选择或批准。
- 本轮llmdoc收尾仍deep/dry_run，统一报告`.llmdoc-tmp/investigations/story-v1-catalog-diagnostics-publish-dry-run.md`，33docs/26impact/4review/26dirty/538unmapped，scoped3impact0review。validate仍旧assembly-input映射错误；stable/meta与五pending不变。报告中的503 Web范围是普通来源修复前证据，当前主仓终态以本节2315为准。

#### Laya具体接入与M6验收（D222）

- 独立`createLayaDecisions(config,transport)`已实现，使用laya/systemone独立身份；与Jev共享私有Noul逻辑但不改变Jev官方SDK/原协议快照。显式model/auto、实际model+routing、low_confidence弃权、编码后预算/请求证据、明确限额与响应体超时/取消均通过验证。没有静默批处理或丢问题；超过限制零HTTP并记录原因。
- 最终Replay **40源码+2compiled+1verifier**，Runtime **84**，合计 **127通过**；其中Jev原14协议测试/快照保留，Laya新增9项含实际loopback HTTP、完整model-visible请求snapshot和provider Plan/evidence回放。3代历史原字节/恢复与pending零派发仍通过；`/tmp/harness-laya-{replay,runtime,history-final}.log`。没有下载权重或在线推理，固定概率替身不证明模型质量。
- 类型/包编译/无源码alias tests/lint/constraints/compiledexports通过。新增公共导出令当前持久目录中一项来源行号23→24，根实际审计后授权再生当前英中catalog/pair/machine schema；类型hash及事件字段没有变化，**65 roots/10 records changes=[]**，没有ack或历史generation变化。日志`/tmp/harness-laya-{types-final,testtypes-final,lint-final,constraints,smoke,persistence-diff,persistence-generate,persistence-final}.log`。
- 双语README、named pairing、links2319/wrap2340、JSDoc、文档预算/术语/仓库引用与diff通过，日志`/tmp/harness-laya-{pair-final,links,jsdoc-final,budgets,terms,references,wrap}.log`。source snapshot仍7877e378，未重复pack主仓SDK。研究scratch已追加实现终态证据。
- 独立H0–H4依据其原VISION的最小消费入口逐条核对；代理先补了H3/H4证明但漏勾checkbox，根实读发现后更正，未以口头“已勾”代替文件事实。主仓**M6已勾选**，精确限定在monorepo/公开SDK/固定消费/JevLaya配置与离线协议证据；在线质量/阈值校准仍未验，完整客户端与模型开局自动化按D219保留后续。整体goal继续active，M5具体剩余、人工审阅与G1/G2不被此勾选替代。

本轮所有实现/测试进程终态，固定全栈DB空闲。下一轮优先按M5矩阵补发布分类差异与可授权的引用影响、修正聚合元数据展示，再处理per-agent引导和实际Runtime交接入口。状态Remix可选语义问题仍待用户答复；其他明确事项继续推进。

### 2026-10-01 作者发布审阅与多角色检查（进行中）

用户上次询问进度的goal turn仅核对已有记录，归类no progress；本轮复核当前源码与live agents后继续实现。llmdoc delta仍deep、26影响/4待review；stable/meta不写。root负责W3与集成，investigator负责W2对象引用影响，recorder负责W1发布差异和发布界面集成并独占fixedDB，reflector完成W6/W7后继续W5角色选择与收藏/现场创建。

- W6/W7（D224）已冻结：真实构建Scenario+来源World+默认Preset复现完整评级Mature、IR General而旧页面解释General。修复后2文件15项通过，/tmp/story-aggregate-page-tests.log；类型/格式/scoped diff通过。详见`.llmdoc-tmp/investigations/story-v1-aggregate-page.md`，没有把组件测试冒称Registry发布或浏览器验收。
- W3（D223）作者检查与草稿共享落地；新增AuthorVisibilityChecks/helper与DraftPreview当前快照写入守卫，来源资料不可就地改、撤销不覆盖其他编辑。发现原SessionControls无公开绑定描述输入，已补persona/late outwardDescription并映射标准outward_description，不改变完整description语义。
- W3新增10项含真实构建/真实预览组件：实例与goal、根outward片段识别、来源不可写、共享后重新构建目录为shared、Undo/拒绝资料变化、编辑器跳过update拒绝假成功、账号同步竞态、到期即刻拒绝、公开预览无作者检查，以及真实外观输入改变仅投影公开描述。与原draft/source预览合计 **3文件37项通过**（/tmp/story-author-visibility-tests.log）；Web tsc退出0（/tmp/story-author-visibility-types.log）、7文件biome（/tmp/story-author-visibility-lint.log）及scoped diff通过。首轮fixture缺World必需正文、测试使用未安装matcher/旧DOM节点的问题均仅修测试，未放宽产品规则。
- 发布面板W3集成仍由recorder验证；W1/W2尚未冻结。W4真实Runtime启动交接、W5便捷选角、人工expected/Commons、最终CI及G2继续未完成。不因局部通过修改M5或整体完成状态；未commit/push/deploy/生产迁移/在线模型调用。

#### 发布审阅闭环冻结（D223/D225/D226）

- W1完整作者定义三类diff与精确基线、W2响应身份/分页呈现、W3发布共享/Undo定向 **26项通过**；Webbuild/E2E node types与owned Biome/scoped diff通过。Core引用分析新6项、Registry真实DB新4项通过（`/tmp/story-reference-impact-{core,integration}.log`）；全scan异常对客户端去掉不可读嵌套身份，缺snapshot明确503。
- recorder唯一fixedDB命令 `E2E_FULLSTACK=1 pnpm --filter @char-pub/web e2e:fullstack fullstack-publish-review.spec.ts` **1/1通过17.5s（用例12.3s）**，根实读`/tmp/story-w1-fullstack-third.log`。实际R1/真实下游发布→正文/description/结构修改与删除引用对象→审阅→per-agent资料共享使旧review失效→重建→实验确认→发布固定新Revision。前两次只在编译阶段被并行W5/W4中间类型错误挡住，没有进入业务，保留原log，不称产品失败。W3因此闭合。
- 两图由执行者实际view，归档`.llmdoc-tmp/investigations/story-v1-publication-review-browser/`。deep/dry_run报告`.llmdoc-tmp/investigations/story-v1-publication-review-dry-run.md`：33docs/26impact/4review/26dirty/564unmapped，scoped3impact；旧assembly-input mapping仍使validate失败。stable/meta和五pending未动，不能称G2已同步。
- 该时点全Web运行69files中536pass/5fail，唯一失败为并行W5的artifact-picker测试；负责代理正在修复并复验。不把26定向或fullstack1/1冒称全Web/最终CI已通过。fixedDB与该runner均终态。

#### Runtime实际启动入口（D227，进行中）

- 已查明既有Harness profile仅挂服务，未有用户入口；保留原最小M6证据但不能用它冒充平台试玩。现新增可选named dsh app overlay在外仓实现，固定本地Registry/OAuth/provider配置，真实loopback页面；test-only固定provider只用于跨仓验收。
- Contracts新增RuntimeLaunchRequestSchema、RuntimeRegistryOriginSchema与16KiB上限，4项协议测试及包types通过（`/tmp/story-runtime-launch-contract-{tests,types}.log`）。拒本地未保存构建、未知字段、Token/history/body/approval夹带、非规范origin及远程HTTP；纯schema不替代Runtime授权/到期检查。不改Core领域或Artifact/IR格式。
- 根已打包并offline安装活动SDK **story-v1-d4763562434e68a8**，manifest SHA `d4763562434e68a8ca255cd53a671a2a1c615c3cdf7b1763ca5abd549bc4e3ac`，两个consumer/overrides/current/lock一致；所有旧快照保留。pack/install/verifier日志`/tmp/story-runtime-launch-sdk-pack.log`、`/tmp/harness-runtime-launch-sdk-{install,verify}.log`。另为独立app接已有DeepSeek provider执行offline install `/tmp/harness-runtime-app-install.log`，未调用在线模型。外仓整包历史/compiled终态仍待app冻结后验收。
- Web RuntimeLaunch允许选实际launch URL并按账号本地记住最近目标；URL只含fragment定位，使用noopener/noreferrer，文案不宣称已开始会话。公开作品按钮接精确Artifact；编辑器Try draft先save/build再打开选择。多start必须选、participant使用真实实例key、locked view保持、原点/expiry/actor/current draft在点击时再校验。Runtime须独立OAuth并重新校验能力和来源。
- 新协议Web6项和新增草稿按钮实际构建测试，与已有作者视角/预览/作品页回归合计 **6文件42项通过**（`/tmp/story-runtime-launch-web-regression.log`）；Webtypes退出0（`/tmp/story-runtime-launch-ui-types.log`）。组件环境的Node未配置localStorage用测试memoryStorage隔离，不用放宽产品校验。外仓app及真实平台→app→OAuth→Session链仍进行中，W4尚未完成。
- recorder继续独占W4新全栈spec/profile夹具，investigator独占外仓app/provider接线/测试，reflector完成W5剩余角色选择回归。没有把整体goal标complete、没有公开发布或部署。

#### 当前主仓回归与入口审计

- 平台产品冻结后完整 `pnpm test` **171文件2369通过**（`/tmp/story-author-launch-tests-all.log`）；全tests types与deps退出0（`/tmp/story-author-launch-testtypes.log`、`/tmp/story-author-launch-deps.log`），主仓793模块3871边/Admin77模块215边。全diff-check通过。仍不是最终ci:all，也不覆盖新增真实app跨仓运行。
- W5产品/独立DB与组件测试已冻结，报告`.llmdoc-tmp/investigations/story-v1-w5-casting.md`：真实DB4/4、Web25、生产/tests types与格式/deps通过。新真实fullstack-casting用例由recorder顺序运行，首轮已完成角色创建与发布，返回选版时测试locator超时，待修定位重跑，不提前把W5完整浏览器链标通过。
- 全lint首轮唯一错误为正在编写的W4 E2E非空断言，owner已显式guard修复并定向格式通过；待最终全lint复核，不覆盖掉首log（`/tmp/story-author-launch-lint-all.log`）。
- 根实际读外仓app发现两项新入口风险并交owner修复：全局current缺会话句柄会让旧tab向新Session误发；preview导出复用游玩bindings会直接复制实际私描述。要求写操作绑定opaque session handle，旧tab拒绝；导出使用独立空白合成绑定表单，输入变化清候选。没有改旧Session格式或上传记录。此时仅源码证据，尚不声称已获真实修前红态；W4新E2E加入旧tab拒绝检查，待compiled冻结后执行。

#### 选角与分发工件终态

- W5真实 `fullstack-casting.spec.ts` **1/1通过16.6s（用例11.6s）**，根实读`/tmp/story-w5-fullstack-final.log`，实际创建Scenario→现场新角色→明确权利评级许可→发布→选精确Release→刷新验证cast/pin→收藏后移除再选→再次刷新唯一cast/pin。没有API替身或把未发布稿当pin。截图由recorder实际查看，归档`.llmdoc-tmp/investigations/story-v1-casting-browser/created-character-cast.png`；D228已实现。
- 全lint复核通过（`/tmp/story-author-launch-lint-final.log`，916文件）。Actioncheck识别分发过时后重建，仅更新原唯一staged `actions/publish/dist/index.js`，最终check退出0（`/tmp/story-author-launch-action-{build,check-final}.log`）；没有stage其余文件或commit。
- W4外仓已完成session handle及独立合成绑定修复，定向27项/compiled app/types通过；完整Runtime88与Replay43也已运行，最终constraints/docs/persistence证据待owner收尾。recorder开始真正dsh CLI+app跨仓浏览器用例；前两轮仅新fixture漏stable/开局description被真实API422拒绝，已修测试并独立Core复核。尚无完整app E2E通过结论。
- reflector最后审§17.9定位到真实agent来源丢失，D229进入最小修复与DB回归。其余五类起草场景与通用对象投稿的责任边界仍只读核对，不能拿“没有全套Runtime客户端”扩大本仓需求，也不能删除实际承诺。整体goal active，M5/最终G1/G2仍未勾。

#### W4真实跨仓与最后来源/权限缺口

- 真命令 `E2E_HARNESS_ROOT=/Users/djj/code/char-harness pnpm --filter @char-pub/web e2e:harness fullstack-harness-launch.spec.ts` 第四轮 **1/1通过17.5s（用例10.7s）**，根实读`/tmp/story-runtime-app-fullstack-fourth.log`。实际named dsh source launcher+公共compiled app、平台fragment、独立OAuth、night开局/固定provider一轮、新private dbld的dawn重开、旧tab stale_session与两份日志原bytes保持均通过。第三轮实际浏览器定位inlineJS模板转义语法错误，owner修生成HTML并新增实际HTTP脚本vm.Script解析回归；未用bridge绕过真实入口。
- 两张截图由recorder实际view，归档`.llmdoc-tmp/investigations/story-v1-runtime-launch-browser/`；独立Runtime88+Replay40+compiled2+SDKverifier1共 **131通过**，types/NodeNext tests/scopedlint/publicapp/constraints104/persistence65roots10records changes=[]及定向文档门禁通过。来源与具体log见独立`spec/goals/roleplay/PROGRESS.md`。没有改历史日志/ack/generation；没有在线推理。D227已实现，限制如DECISIONS所列。
- W4/W5统一deep/dry_run报告`.llmdoc-tmp/investigations/story-v1-runtime-launch-dry-run.md`：33docs/26impact/4review/26dirty/567unmapped、scoped3impact。stable/meta/五pending仍未写，旧mapping仍使validate失败，不冒称G2。固定DB和所有本轮浏览器runner结束。
- D229新增5真实DB案例与既有两组合跑 **3文件23通过**（`/tmp/story-agent-history-after.log`）；真实owner/协作者接受agent→普通保存→Revision→worker→发布源true，人工不误标/清标；清历史422保稿。修前红态与fixture路由404分别记录，见`.llmdoc-tmp/investigations/story-v1-agent-authoring-scope.md`。server/tests types与5文件lint通过。
- D230 root集中拒agent PAT发布，权限矩阵 **217通过**、真实API **20通过**（`/tmp/story-agent-publish-{unit,integration}.log`），server+Webtypes通过（`/tmp/story-agent-publish-types.log`）。Token UI禁用agent的publishscope并说明。没有改Contract结构或SDK快照；此前2369全量结果发生在D229/D230前，最后全量仍要更新。
- 最后范围核对明确：发布基线的五类结构结果均可走现Contribution；未发布/半成品Working还缺外部agent候选的导入、完整审阅和明确Apply。已授权reflector做一个纯Web本地文件流程覆盖五类，复用现对象schema/编辑器/If-Match，不托管模型；investigator只读复核局部校验/引用/Undo。协议不扩Core/Contracts，尚未实施完成，不以手抄JSON或现有提示冒称该义务已满足。整体goal active，M5仍未勾，规范expected/Commons人工审阅、最终G1/G2保留。

## 2026-10-01 最终工程验收与人工交接

上一goal turn归类progress：实查活跃CI句柄82642，确认第四轮退出0并读取完整末尾结果；据此让recorder继续唯一尚待的原有fullstack.spec.ts回归。当前轮补权威规范与执行记录，不将状态汇报本身算代码进度。

### 本地候选辅助终态（D231）

- `apps/web/src/lib/author-assistance.ts`及编辑器面板完成五类请求/候选/Review/Apply/Undo；精确输入、异步账号/请求守卫、受众及来源规则写入§17.9。3文件53项通过，`/tmp/story-assistance-editor-tests.log`；types/testtypes/lint/deps同前缀日志通过。Core局部引用与集合检查回归4文件40项，`/tmp/story-assistance-local-refs-tests.log`。
- 普通协作者仅允许单向声明agent=true；清标与敏感来源仍拒绝。真实DB2文件20项通过，`/tmp/story-agent-collaboration-tests.log`，server/types/testtypes/format相关日志通过。D229历史保留不被此声明能力削弱。
- 真实`fullstack-author-assistance.spec.ts`首跑1/1，6.9s（用例1.9s），`/tmp/story-assistance-fullstack.log`：请求只含所选对象，Review零PUT且服务器版本不变，Apply普通If-Match保存，刷新来源保留，旧候选拒绝且零写。固定候选不是在线模型结果。截图与deep/dry_run报告分别在`.llmdoc-tmp/investigations/story-v1-author-assistance-browser/`和`story-v1-author-assistance-dry-run.md`。
- 当前SDK **story-v1-7d17291cbad10ff7**，manifest SHA `7d17291cbad10ff748705d1668a811009e732895e1f63f605467f9db56f8ecd0`；pack/install/verifier日志`/tmp/story-author-assistance-sdk-pack.log`及`/tmp/harness-author-assistance-sdk-{install,verify}.log`。独立Runtime88+Replay40+compiled2+verifier1共131通过；types/build/smoke/constraints/persistence日志`/tmp/harness-local-refs-*.log`。历史65roots/10records changes=[]，没有改旧Session bytes或在线推理。

### 单次完整CI终态

- 第四轮 `pnpm ci:all` **exit0**，`/tmp/story-final-ci-all-fourth.log`。lint、全部types、deps、unit93文件1781、Web/Admin81文件625、conformance28文件316通过/105todo、真实integration86文件1557及覆盖率、完整build、Web mock E2E62通过/27skip、Admin E2E107通过、Action dist check、Git/目录secrets scan全部完成。skip/todo仍不算通过；真实新工作流证据按上述独立fullstack逐项记录。
- 前三轮日志完整保留：第一轮`/tmp/story-final-ci-all.log`停于新E2E两处链式调用格式，定向格式后再跑；第二轮`...-second.log`停于旧Token UI测试仍期望agent可发布，更新为已禁止的真实语义，4项定向通过；第三轮`...-third.log`完成至Web E2E后4失败，旧Summary模糊定位匹配新增说明字段，两个locator改exact（原fullstack同类一处同步修正），editor定向8通过/1既有skip。未把失败轮拼成成功轮。
- Action已重建并只刷新原staged dist，`/tmp/story-final-action-build.log`；没有stage其他文件、commit、push或部署。第四轮之后仅文档收尾和既定原有全栈回归，不因文档补记重复整套CI。

### 里程碑、人工材料与知识门禁

- `.llmdoc-tmp/investigations/story-v1-m0-m3-final-readiness.md`按M0–M3/S1–S6/U2–U7核对源码与公开消费证据；结合W1–W7及D231，M0–M6工程里程碑已勾，G1/G2仍未勾。不扩大为完整游戏客户端或在线模型质量已验。
- 35规范候选当前输入/执行preflight全部一致，`/tmp/story-final-candidates.log`；完整人审包`.llmdoc-tmp/investigations/story-v1-human-review/REVIEW.md`含无截断IR、7成功装配完整消息、6实际错误及9个Story消息集合，逐项消息/Plan摘要一致，`/tmp/story-final-human-review-materials-verify.log`。没有accept、修改expected或case status。
- Commons机械26/26通过记录继续有效，人工原创性/适龄/中英文措辞尚未确认。已异步请求用户审阅规范和Commons，可分批接受；沉默不算接受。
- G2完整更新提案在`.llmdoc-tmp/investigations/g2-semantic-update-proposal/`：23替代MDX、patch/hash/mapping及7篇verified-unchanged提案。当前delta仍deep，26impacted/4review；stable/meta干净，旧assembly-input映射仍须正式修复，五reflection pending。正式llmdoc commit要求mapped源码已提交；当前先核本地提交write-set，保留任务前用户已有文档改动，不用git add .或stash隐藏dirty。提案不等于知识同步完成。

### 用户要求先启动本地产品

- 用户回复“那先启动吧，harness也实现了吗”，这是启动服务的授权，不是人工expected/Commons接受；两者继续未勾。
- 本地 `pnpm dev` 已在当前worktree启动，句柄61613，日志`/tmp/story-user-dev.log`；本地开发库迁移完成，Web `http://localhost:5173`、API3000、worker3001（healthz200）。未改生产或charpub_e2e。启动前已同步本地迁移可能改变旧数据结构的风险。
- tb已验证会话并检索browser能力，无匹配的本地浏览器控制工具，使用Superset浏览器在当前workspace新页打开并核实际DOM。已有开发登录辅助创建story-preview本地账号会话，只在内存交接cookie，不打印凭据；真实会话API注册Local Story Harness public client及精确loopback callback，未代替用户授予任何OAuth消费同意。
- 独立Harness启动由investigator负责，端口19389、Registry/issuer指向5173，使用真实provider配置；当前未检测到模型凭据，不以固定替身冒充可在线生成。最终启动证据随后追加。
- 本地提交范围已具体化：`.llmdoc-tmp/investigations/story-v1-local-commit-scope.md`及JSON/精确路径清单。578相关候选、11任务前既有文档、1归属不明Admin标签、8运行PNG；没有stage/commit/stash。用户先体验的当前指令优先，暂不推进正式知识提交。
- Harness真实dsh入口已启动：`http://127.0.0.1:19389/` HTTP200，PID93976/句柄78639，日志`/tmp/charpub-roleplay-local-app.log`；独立`DSH_HOME=/Users/djj/.local/share/charpub-roleplay`保存profile与sessions。根已用Superset新页打开，核实际Local roleplay界面和零console错误。OAuth配置已连接本地Registry，尚未代用户完成授权同意；真实DeepSeek provider已配置但缺当前可用key，未调用模型。使用作品页Start playing或编辑器Try draft in Runtime交接精确内容。

### 最终原有流程回归与本地交付整理

- 原有 `fullstack.spec.ts` 真实回归 **1/1通过11.9s（用例7.1s）**，日志`/tmp/story-original-fullstack-final.log`，句柄64573退出0；仅运行该受定位修正影响的用例，开发库与两个用户体验服务保持运行。
- recorder复核最终§17.9/D229–231后，仅在G2 scratch两篇identity稿补agent PAT禁发布、不预留label及普通技术Token/OIDC既有语义，patch检查通过。stable/meta仍未写。
- 本轮对提交授权的判断：用户已授权按主规范实施完整破坏性重构，当前没有“禁止本地提交”的用户指令。此前对子代理的只scratch/不commit限制是职责分工，不应扩大成全局用户许可门槛。现用明确逐文件write-set保存已验实现，主规范及DECISIONS按原始字节整体保留，不能声称它们全由本轮原创。未归属Admin mock变化、历史archive及测试PNG不加入本次代码提交；它们保持原工作区内容。随后由recorder正式同步llmdoc，仍不代替人工expected/Commons接受。
- 上一goal turn归类progress：启动并验证用户要求的两个本地入口，补D231/规范与最终CI记录；未发生因人工审阅等待而连续无进展的阻塞。

### 用户实操反馈：真实本地启动缺默认策略

- 用户明确要求“你自己操作浏览器，现在没办法操作”。root通过可见Superset页完成本地namespace注册、新建雪夜旅店Scenario、背景/Scene/明确开局模板与保存，然后真实点击Try draft in Runtime，页面返回 `draft_build.default_policy_unavailable`。这证明此前HTTP200启动检查不足以验证实际可操作，不能用隔离E2E配置成功替代默认pnpm dev。
- investigator修本地development限定的真实默认Preset初始化与显式配置；recorder修该已知错误的可读提示；opening select/textarea定位另作核查；reflector修独立Harness空入口的可点击Registry导引与折叠高级JSON。不制造无策略fallback或假模型响应，不清用户本地稿/会话，重启由root协调。M5因此重新打开，后续实际浏览器从该草稿继续验证。
- 正式知识同步曾对f6d8471完成：docs8f9c7cf/meta25c8c54，23改+7核验、30指纹、validate/15路由通过、五pending已归档，报告`.llmdoc-tmp/investigations/story-v1-g2-update-success.md`。当前新修复需追加真实知识检查，不能把旧success冒称新代码已同步。
- 独立Harness本地提交5529d79e完成186明确路径，正常hooks全过，NOTICE生成器补SDK真实repository元数据；SDK/历史64保护路径bytes一致，未改指针或调用模型，服务仍运行。新欢迎入口修复发生在该提交之后，另计验证。

- 开局控件ID核查更正：root先后看到fallback select与inline textarea使用同一诊断ID，曾误判为同时重复；recorder源码确认它们按模式条件分配，未复现同时重复。已要求撤销这项防御性改动及新增测试，不将未证实问题列为产品缺陷。

### 实际本地工作流恢复可用（D232）

- 默认启动初始化、可读错误、同tab跳转及Harness欢迎/明确前景底色已实现；根实际操作步骤、限制和已查看截图见`.llmdoc-tmp/investigations/story-v1-local-usable-browser/README.md`。真实草稿ready→当前页交接→授权读取精确产物→绑定合成旅人→新会话开场已通过，最后页面停在清晰可读的Session回复区；未配置模型key，未发送生成请求。M5因此重新闭合。
- `pnpm ci:all`新单次**exit0**，日志`/tmp/story-user-readiness-ci.log`：unit93/1781、Web/Admin81/630、conformance28/316+105todo、integration87/1560、WebE2E62+27skip、Admin107、types/deps/build/Actioncheck/secrets均过。todo/skip仍单独待验；未降低门禁。README双语补真实本地Preset初始化规则。
- 主仓新增3文件启动初始化切片真DB3/3、错误提示13、同tab入口9定向通过；Harness欢迎/HTTP/HTML交互6与contrast测试/lint/compiledbuild通过。关键日志和报告见实际浏览器README；代码改动不会靠旧f6d8471的CI结果冒称验证。
- 当前char.pub服务句柄65379，Harness句柄62110，均保留运行；原67681/87825仅为根先前启动的进程，重启确认端口释放后再启动，没有杀其他服务。旧Session日志保留，重启后明确创建新合成开局。

## 2026-10-01 — Harness 交付后的主目标收尾审计

- 上一 goal turn 为 progress：完成独立 Harness 最新上游同步、React 游玩 UI、char-pub/char-harness 首推与 51 篇 llmdoc；真实远端无密钥 CI 成功，交付 main 与本地一致。该仓后续状态由其 `spec/goals/roleplay/` 持有；不把外仓 UI 完成当作主仓 G1 的人工接受。
- 重新读取 VISION/DOD、规范审阅规则及实际 Git/llmdoc 状态。主仓 M0–M6 的工程结果保持有效；最新产品变更后整次 CI 为 `/tmp/story-user-readiness-ci.log`。正式知识更新已实际完成，DOR 的 dry_run/未提交与进行中片段已整理为当前状态，历史过程保留在本 PROGRESS。
- 规范材料当前性复核：35 个 case 仍为 draft；逐个执行真实 `validateDraftForAcceptance`，核原输入与完整输出 SHA 同既有人审包一致，结果 35 current、0 accepted。没有重生成 expected、代填 reviewer 或变更 case status。
- Commons 审校仍为未完成的发布前门槛。当前目标明示不授权公开发布，G2 要求示例与契约一致，不能把更大的 v0 正式开放清单自动扩为 Story 改造条件；同时不因此宣布 Commons 已人工认可或可发布。
- 本轮发现并修复一个实际文档缺口：conformance 主 README 没有列出已经实现的 Story 用例目录、kind/expect 与精确 review receipt 接受规则。修正文档以反映真实 runner 和脚本，不修改验收门槛或输入/输出。
- 当前待用户输入为规范 expected 的人工接受。此前启动与浏览器操作授权不等于此签字；此轮仍有文档一致性修复可推进，整体 goal 保持 active，未标 complete 或 blocked。

- 独立 completion audit 完成：`.llmdoc-tmp/investigations/story-v1-completion-audit-final.md` 按 S1–S7/U1–U9 和 G1/G2 复核，未发现新增实现缺口。规范主入口文档与 DOR 已修正，G2 按现有正式知识/生成 schema/示例证据关闭；G1 保持未完成。此结论不表示 35 个 expected 已被认可，不要求重跑未改变的产品测试来制造新进度。

## 2026-10-01 — PR #11 安全扫描与 Hook 路由修复

- 用户指出 Hook 仍提示 444 unmapped 与 PR CodeQL 失败。此前以 0 impacted/0 needs-review 表示已映射文档新鲜，不能据此声称整体路由完整；本轮重新审计全部路径和 33 个 owner，确认原 72 处真实 missing mapping，363 处 intentional no-doc，以及 9 处本地改动。另补本轮 CCv3 解析器路由，共拟补 73 条精确映射，不用宽泛 glob 掩盖缺口。全量语义和路由核验后才通过 CLI 全量提交推进基线。
- 原 PR 的 ci/check、dev-env、CodeQL 分析任务和依赖审查均已实际通过，但 Code scanning results 单独失败：4 个新高危告警，位于 E2E 的两处 URL 前缀检查、CLI 尾斜杠正则及 accept 脚本检查/使用竞态。还有 2 个既有 CCv3 正则告警。本轮全部按实现修复，不 dismiss 或排除扫描。
- E2E 改为解析后精确 origin 比较；CLI 用末端线性扫描保留原字符串处理语义；accept 只写入已通过校验的同一份文本，拒绝用之后被替换的文件路径重新决定接受内容；CCv3 decorator、START 分段及示例空白处理改为同语义线性扫描。
- 定向验证：CLI 7 项、隔离真实 accept 命令的竞态/失效回执测试 1 项、Playwright 4 项通过；CCv3 全包 108 项、6 万组旧新随机差分一致、独立测试类型检查通过。完整类型检查、范围 Biome、Action 重建及分发一致性检查通过；三个运行时 conformance 仍为 316 通过/105 todo。日志在 `/tmp/story-codeql-*` 与 `/tmp/char-ccv3-redos-*`，真实规范案例未被接受。
- 用户明确选择 `apps/admin/src/lib/mock-api.ts` 的既有示例标签修改保留本地，禁止提交或还原。8 张 Vitest 自动失败截图保留原磁盘字节，两个确定的生成目录加入精确 gitignore；不忽略源码或规范 expected。完整更新后预计仅剩这 1 个有意保留的本地修改提示。
- 本段记录源码修复和本地证据，远端 CodeQL 结论须以更新 PR 后的新分析为准；不会用旧绿检查或本地测试冒称告警已在 GitHub 消失。

- 第一轮更新后的 GitHub 扫描确认 5 个告警消失，#15 仍定位到 accept 写入 case.json：固定 draft 文本没有同时修复元数据路径可被替换的问题。现元数据写入专用临时目录的独占新文件，再通过同目录文件系统 rename 原子替换目标；不跟随被换成符号链接的 case.json 去覆盖其它文件。隔离真实命令测试同时模拟 draft 替换和元数据符号链接替换，确认 expected 仍是已验证文本、目标 case.json 是普通文件且无关目标原字节未变；测试、类型与格式检查均通过（`/tmp/story-codeql-accept-atomic-{tests,types}.log`）。最终仍待更新 HEAD 的远端 CodeQL 确认。
