# AI 角色创作生态研究摘要

> **性质**：本文是 2026-09-26 一份外部深度研究报告的摘要，作为剧情结构讨论的输入。报告原文由模型生成，引用标记无法独立核验，未进入版本库。本文只保留被本项目采纳或明确拒绝的要点，外部事实请以下方官方链接为准；报告中的建议都不是项目决定，现行规则见 [Char Story v1-draft](../../story-v1.md) 与 DECISIONS。

## 1. 报告的核心判断

- 今天被称为“一个 Character”的东西，实际是一组相互依赖的资产：人格定义、对话风格、开场、Scenario、Lorebook、世界设定、Prompt/Preset、记忆策略、状态变量、剧情节点、媒体资源与脚本插件。
- 下一代生态的基本单位应当是可版本化、可组合的内容包；Character 是其中一种类型，而不是整个数据模型。
- 生态已经有成熟的内容创作层（角色社区）和运行时层（SillyTavern、AI Dungeon 等），但缺少与 npm、GitHub 相当的依赖、版本、来源、许可与 Remix 基础设施。
- 传统编剧工具（Final Draft、Scrivener、Celtx 等）提供的 Beat、Scene、Outline、Revision，正是 AI 角色扮演生态欠缺的另一半能力。

## 2. 本项目采纳的要点

| 报告要点 | 本项目的对应 |
|---|---|
| 可发布内容远超角色卡 | 现有九类 Creation，不另起一套 Package 身份 |
| 资料来源与设定条目不同 | 区分参考资料 `sources`、条目片段、资料集与知情声明 |
| 作者需要知道内容为什么被使用 | Catalog、视角原因码、选择 Trace 与作者预览 |
| 格式兼容不等于人物含义不变 | 差异按“正文 / description / 结构”分类展示 |
| 协作需要来源与独立生命周期 | 沿用 Release、`derived_from`、Contribution 与 Remix |
| 测试应当是一等能力 | 确定性作者测试与规范一致性 fixture |
| 可执行插件与声明式内容是不同信任域 | 条件与效果只是受限数据树，不引入脚本 |

## 3. 本项目没有采纳的要点

| 报告要点 | 取舍 |
|---|---|
| Scene / Plot 必须状态机化 | 开放场次与无条件 Beat、结局先成立；条件与变量是可选的 experimental 能力 |
| 默认数值化情感曲线 | 不提供内置好感度语义；作者可以自己声明有界整数变量 |
| SemVer 加行为版本的双版本体系 | 版本号只是 label，锁定靠 digest；行为变化靠内容差异说明 |
| 所有 Scene、Beat、Plot 都独立包化 | 它们是 Scenario 内部对象，有稳定局部 ID，跟随作品发布 |
| 记忆执行、Runtime 插件、托管聊天 | 属于独立 Runtime，不进入 char.pub |
| 报告中的技术栈、路线图与商业建议 | 不作为本项目依据 |

## 4. 可核验的外部来源

| 来源 | 用途 |
|---|---|
| [SillyTavern 仓库](https://github.com/SillyTavern/SillyTavern) 与 [文档](https://docs.sillytavern.app/) | 角色字段、World Info、Data Bank、Prompt 组织 |
| [CCv3 规范](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md) | 角色卡与 character_book 互操作 |
| [AI Dungeon：Scenarios](https://help.aidungeon.com/faq/what-are-scenarios)、[Story Cards](https://help.aidungeon.com/faq/story-cards)、[Plot Essentials](https://help.aidungeon.com/faq/plot-essentials) | 静态起点与运行实例分离、按相关性触发的条目、持续重要信息 |
| [GitHub Docs：About repositories](https://docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories) | 仓库与修订历史协作模型 |
| [npm Docs：package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/)、[Semantic Versioning](https://docs.npmjs.com/about-semantic-versioning/) | 依赖声明与版本范围 |
| [Hugging Face Hub：Repositories](https://huggingface.co/docs/hub/repositories) | 带元数据与来源的模型仓库 |
| [Final Draft：大纲工作流](https://kb.finaldraft.com/hc/en-us/articles/15573792158996-How-can-I-outline-a-script-in-Final-Draft) | 故事卡片、大纲与正文分层 |
| [Plottr：Timeline](https://docs.plottr.com/article/54-timeline-overview) | 场次、剧情线与人物的组织 |
| [Aeon Timeline：Planning Fiction](https://www.aeontimeline.com/getting-started/planning-fiction-from-scratch) | 事件发生顺序与叙事顺序分离 |
| [articy:draft：Flow](https://www.articy.com/en/articydraft-first-steps-tutorial-series-l05-the-flow/) | 嵌套叙事结构 |
