# DOR

## 已确认

- 按 Story v1 主规范与本轮六类审阅问题执行；用户允许破坏性重构，取消 D-174 的旧字节基线要求。
- Runtime 为独立项目；本仓库提供静态契约、纯参考求值和上下文准备。
- 局部实现选择由代理按已确认方向收敛并记录。无须再次询问“是否允许重构”。

## 技术与验收准备

- pnpm workspace、TypeScript、Zod；Core 无 IO，规范由 spec 持有。
- 现有 Release/引用锁/资产/许可/权限/来源机制继续使用；不因无用户跳过这些不变量。
- Core/Assembler/服务端/Web 测试、跨 Node/浏览器/workerd conformance、ci:all 与本地全栈流程已有入口。
- 新条件采用三值组合，只有 true 允许动作；确认默认一次，停止态拒绝后续推进。作者选项是建议，Runtime 解释自由输入。

## 待核实依赖

- R1 已核实：Better Auth 官方 OAuth Provider 1.7.5 已集成；草稿构建、单作品协作、对象投稿和 OAuth/PAT 凭证路径有真实 DB/S3/浏览器证据（D-206–D-208）。OIDC 登录未开放，不作为本次 OAuth 完成凭据。
- R2 环境已就绪：Testcontainers 临时数据库/对象存储与固定隔离全栈库均已运行。作者编辑、预览、协作、对象投稿及 OAuth 有真实浏览器证据；Remix/续作、独立Harness读取和草稿对象冲突恢复已有真实证据；消息定位与原生非文本编辑已有D-214证据；D-215补作者目录诊断，U1双角色组合/预览/发布/匿名消费已有真实UI证据；D-216单Ending的Runtime提案/确认/OAuth投稿/Web接受已有真实跨仓证据；D-217补同一dbld的预览输入回流、用户审阅载入及独立保存作者测试/worker重跑；D-218补已审阅当前局面→OAuth新续作草稿→Web编辑/worker预览。D223–D228已补发布分类差异/引用影响/视角建议/聚合元数据/现场创建与收藏/真实Runtime启动。D231已补半成品稿的外部agent候选审阅与应用，真实浏览器验证Review零写及Apply保存；普通静态Remix和当前局面续作已支持，无损Session恢复不列本次新增义务。
- R3 已核实：独立Harness位于 /Users/djj/code/char-harness，固定SDK真实消费、Jev/Laya适配及真实profile/JSONL Session已验证。D227补实际named dsh本地app，当前相关131项回归与真实跨仓浏览器通过；模型替身仅用于验收，不代表在线质量。按用户“为后续Runtime准备”、本仓S7/U9与独立VISION，M6验收是可验证的最小消费入口；完整游戏客户端、默认Web/SDK分发不属于当前完成条件。当前app明确只支持Story、estimate、文本和noneSelection，Jev/Laya适配未在app overlay启用；自动模型开局、剧情动作推断、开发者变量编辑均未实现。Core/startSession的纯开局和显式判定契约须照常验收，不用缺失自动化推定纯契约缺失。Laya采用已核验的匹配官方候选NandhaKishorM/laya及模型convaiinnovations/laya，来源/协议/实际离线与本地HTTP证据见`.llmdoc-tmp/investigations/story-v1-laya-provider-evidence.md`。没有下载权重或调用在线推理。
- R4：新规范 conformance expected 需人工接受：代理先完成可审阅 fixture 与运行证据，最终如确需批准，提供具体差异再请求。

## 当前可执行

工程里程碑M0–M6、固定SDK消费和单次完整CI已完成，证据见PROGRESS终态节。规范35案例与Commons的人工审阅已请求，待实际接受后记录，不用机器输出代签。llmdoc仍deep/dry_run；23篇具体替代稿与7篇不变结论已备齐，先核定本地提交范围，再按工具要求完成mapped source提交、正式文档应用/校验/路由检查与CLI提交。原有fullstack最终回归由recorder顺序执行。可选状态Remix问题不改变当前明确验收范围。
