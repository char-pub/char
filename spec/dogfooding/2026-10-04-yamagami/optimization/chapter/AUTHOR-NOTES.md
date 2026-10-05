# 2002 章本地候选：作者审阅说明

本轮已按用户批准的范围制作独立候选 `@djj/yamagami-family-2002`。旧 `@djj/yamagami-crossroads` 的 1.0.0、其他角色 Release 以及旧存档均未改动。本目录中的离线产物是 `local-build`，没有 Registry Release 身份，尚未发布。

## 内容结构

四个场次按“家庭谈话 → 核对安排 → 协商 → 落实第一步”展开；已开放场次可回访，回访沿用同一张纸条和已提交对话。每场三个选项只提供表达入口，自由文字、拒绝所有选项、纠正人物和改变主意都是正常玩法。场次转换与里程碑都必须经 Core 校验，不靠回合数或叙事句子推进。

八个 beats 分别记录：表达需要、核对教育、核对生活、问清协助范围、研究求学、研究独立、研究暂缓、把首步说具体。每一个都带场次及先决条件；其中研究方向用集合记录，可同时研究多种，不因询问自动选定路线。

三种 `after: continue` 阶段结果是：留住一次教育咨询、自己核对生活、明确等待信息再谈。它们只确认一个小的模拟安排，不保证录取、就业、住房、资助或家庭和解。人物和日常问题仍可继续讨论。

六个变量仅记必要流程状态：需要是否表达、是否核对过一项问题、协助边界是否问清、研究过哪些方向、首步是否具体、已确认哪个阶段结果。没有好感度，也不把家庭困境量化为无来源的金钱数字。

## 人物与资料

母亲、伯父和山上复用真实发布的三个 Character pin，引用原有 `portrait` 并通过本章 cast override 添加 `outward: true` 的简短公开画像，因此旧资料页中关于后来事件的新闻标题与正文不会进入本章 IR。玩家以 `story.player: yamagami` 明确控制山上，三名角色在四个场次里都在场；`role: user` 只作配套声明。

母亲的模拟表达从照料与联系切入，容易把离家理解为不再关心家庭；她可以就收入和联系方式退让，不被写成一问就悔悟。伯父用具体问题把大承诺缩小，能够拒绝无限费用，同时继续讨论一次核对或陪问。两人的私人动机、声线和具体对白均明确是模拟，并以私有 semantic 条目供扮演读取，不直接写成玩家的已知线索。

十二条 semantic 内容分四组：人物、生活核对、协商条件、具体首步。只有身份、扮演约定和当前场次核心处境常驻；其他内容按问题读取，场次限定资料不会出现在其他场次的目录里。画像只写玩家眼前可见的关系和举止；私人动机与扮演指令保留为非 outward 材料。玩家能读到的十条 knowledge 正文均改为自然语言的背景、模拟材料或可协商方案，不包含对模型的指令。初始只显示联系、照料和出钱应分别讨论的处境，不提前暴露伯父协助条件。玩家初始知道公共的生活边界，教育核对、生活核对、协助范围与方向首步则分别在对应 beat 后获得。目录可发现仍不等于正文已经读取。

本章没有外部 Source 资产。`sources.json` 保留此前完整出处、使用范围和局限，属于作者侧记录。场景只概述 S1/S2/S3 中 2002 年前的背景，没有新增外部事实；所有新安排、对话、心理和道具是本次模拟。

## 可逆与重复确认

已确认的 beat/ending 只生效一次；重访不会重复 effect，阶段结果不会因继续聊天再次结算。落实前可以自由比较或修改意向，这些意向不占用一个已完成结局。

落实后若发现误判或决定撤回，必须使用 Harness 的正式撤回上一轮等恢复操作，让状态与正文一起回到原位置；本章不伪装拥有无限重触发已 consumed target 的能力。自然语言提出撤回仍应得到回应，但不能只靠旁白宣称已经删除里程碑。

## 文件与验证

- `yamagami-family-2002.json`：可编辑作者定义。
- `fixtures.json`：本章重建所需的四个真实公开 Release 快照与精确 pins，以及必要作者信息、meta 和运行默认值。
- `json_output.py`：Python 生成器共用的 JSON 写出函数，调用仓库已安装的 Biome，自动采用仓库格式。
- `author-chapter.py`：仅从本目录 fixture 与固定本章正文重建候选；不读取历史 dogfooding 目录，也不写已有生产文件。
- `chapter.artifact.json`：当前 Core 生成的完整 local-build。
- `runtime-input.json`：绑定默认策略、中文玩家身份及新玩家控制能力的本地运行输入。
- `acceptance-24-turns.json`：同意、拒绝、悬而未决三条各 24 回合的自然语言验收轨迹，包含新信息、期望动作和叙事断言；轨迹长度不参与玩法。
- `sources.json`：独立维护的作者资料与事实范围说明；生成脚本不会覆盖它。
- `offline-rebuild-verification.json`：移除历史资料、凭据和运行日志依赖后的隔离重建记录，六个交付文件逐字节一致。
- `player-view-samples.json`：真实玩家投影的初始画面和三条轨迹第24轮样本，供直接审阅人物画像与已知线索。
- `verify-chapter.ts` / `verification.json`：schema、构建、三种结局、前置 guards、未知判断、知情过滤、回访不重复、24 回合状态轨迹及第 12 回合 JSON 往返验证。

仓库源码及依赖已经安装后，只需本目录文件即可离线重建，无需 Registry、`.dev`、登录凭据或历史模型日志。重建与确定性验证：

```sh
python3 spec/dogfooding/2026-10-04-yamagami/optimization/chapter/author-chapter.py
python3 spec/dogfooding/2026-10-04-yamagami/optimization/chapter/author-acceptance.py
pnpm exec tsx --conditions=@char-pub/source spec/dogfooding/2026-10-04-yamagami/optimization/chapter/verify-chapter.ts
pnpm exec biome check spec/dogfooding/2026-10-04-yamagami/optimization/chapter
```

确定性验证中的 `true` judgments 是作者给定的测试证据，只证明引擎执行守卫和效果正确。它们不证明模型能从自然语言准确判断，也不证明人物有说服力。必须另用实际安装的 SDK、真实 provider 投影及 Harness 存档恢复流程运行自然语言轨迹，评估：人物差异、是否替玩家决定、提出的后果是否具体、已知信息是否越界、意图与状态是否一致。

## 离线 fixture 的来源与许可

`fixtures.json` 固定此前已验证的 `https://api.char.pub` 公开发布快照。三个 Character 保留原作者署名和 `CC-BY-SA-4.0`；默认 Preset 保留原有 `CC0-1.0`。每份 snapshot 都保留实际 `creation`、Release ID、semantic digest、public 可见性和 active 状态；对应读取端点记在 fixture 的 provenance 中。这里没有复制 `.dev` 的私有预览身份，也没有把本地占位标识伪装为真实 Release。

作者侧完整来源归属仍保留在 `sources.json` 和依赖快照中。章节构建仅选入 Character 的 `portrait`；依赖的 `source-notes` 不会进入本章 IR，早期场景也不会因此知道后来的事件。

验证器会逐一核对 snapshot 与 pin 的 ref、Release 和 semantic digest，再由 Core 重建并校验完整依赖。Python 生成器和 TypeScript 验证器都会调用仓库已安装的 Biome 来格式化 JSON，使用仓库配置，不下载工具。验证器在全部语义检查与输出格式化都成功后才写出最终文件；再次运行不会恢复成不符合仓库规范的数组换行。若要确认本次整理没有改变最终内容，可以给验证器传入固定摘要；摘要不符时不覆盖现有最终产物：

```sh
pnpm exec tsx --conditions=@char-pub/source spec/dogfooding/2026-10-04-yamagami/optimization/chapter/verify-chapter.ts sha256:9bb3fc1c4336c10c8110feb5d79db39d97fccc1950d0ec328262616b632890bd
```

本次还把章节复制到临时隔离目录，只接入仓库实现与已安装依赖，使用已安装的 `tsx` 直接运行。隔离目录同时包含仓库格式配置。那里没有 `biographical/production`、`.dev`、凭据或模型日志。重建后的候选定义、artifact、runtime input、24 回合轨迹、玩家投影样本与作者来源六个文件均逐字节相同，artifact digest 保持上述值。

文件缩进属于交付格式。`chapter.artifact.json` 的文件字节摘要与 Core 对 canonical artifact 对象计算的 digest 是两个不同数值；格式归一不会改变 `sha256:9bb3fc1…` 对应的内容身份。隔离记录中的文件 hashes 则按最终 Biome 格式重算。
