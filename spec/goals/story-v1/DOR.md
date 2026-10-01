# DOR

## 已确认的范围与授权

- 按 `spec/story-v1.md` 和本轮审阅执行；项目没有用户，允许破坏性重构，无需再确认是否保留旧格式。
- char.pub 持有静态创作、发布和公开消费契约；真实游玩、模型调用和 Session 持久化属于独立 Runtime。
- 本目标覆盖 VISION 的 S1–S7、U1–U9。不把正式公开运营、生产部署、npm 发布或完整游戏客户端的后续要求自动加到本次验收。
- 用户追加的 Harness 上游同步、UI、组织仓库推送和 llmdoc 已获授权并交付，见下文；该授权不等于允许推送主仓、生产迁移或发布 Commons。

## 工程与环境就绪

- Core 保持无 IO，Story 三值条件、显式确认、参与者实例、状态和上下文契约已实现；Registry、Web、CLI、Action、CCv3 使用统一公开产物。
- OAuth Provider、真实数据库/对象存储、作品协作和对象投稿已有集成及本地全栈证据。OIDC 登录不作为本轮 OAuth 的完成凭据。
- M0–M6 的逐项证据见 DOD 和 PROGRESS。最新主仓单次 `pnpm ci:all` 完整通过，日志 `/tmp/story-user-readiness-ci.log`；105 个 conformance todo 和 27 个 Web E2E skip 仍按实际含义记录，不计为通过。
- 普通 `pnpm dev` 的本地默认 Preset 初始化、草稿构建错误说明、Runtime 同标签页交接及宿主可读性已修复并实际操作验证。当前服务为 `http://localhost:5173/` 和 `http://127.0.0.1:19389/`；进程是否存活仍以实际端口检查为准，历史句柄不充当当前证据。
- 主仓正式 llmdoc 更新及启动修复后的增量更新均已提交：报告为 `.llmdoc-tmp/investigations/story-v1-g2-update-success.md`、`story-v1-startup-readiness-update-success.md`。当前不是 dry_run；未映射的历史统计不等于相关权威入口缺少 owner。

## 独立 Harness 交付

- 独立目录 `/Users/djj/code/char-harness`；组织仓库 `https://github.com/char-pub/char-harness`，当前 private，默认分支 main。完整上游历史与许可保留，最新上游已同步。
- 固定打包 SDK、公开 compiled 入口、Jev/Laya 适配器、真实命名 profile 和 JSONL Session 已验证；不跨仓导入平台源码。
- 新 React 游玩界面支持精确开局审阅、会话恢复、分会话草稿、回复/取消/结果核对、角色资料、明暗主题和窄屏布局。主代理已实际操作浏览器验证；无密钥 GitHub CI 已通过：`https://github.com/char-pub/char-harness/actions/runs/36819383323`。
- Harness llmdoc 已正式初始化为 51 个职责 owner，并完成检索与元数据验证。其内部实现知识归外仓，本仓只记录公开消费边界。
- 当前浏览器 profile 是 Story/estimate/text/noneSelection 入口；Jev/Laya 适配器未自动启用，自动剧情动作推断、模型开局判定、开发者变量编辑和线上模型质量仍未完成。它们不是纯 Core 契约缺失，也不冒称已由固定替身验证。

## 唯一尚待的本目标验收输入

G1 仍需人工接受 35 个规范 expected。`spec/conformance/README.md` 要求审阅人核对完整输出后才运行 accept；用户此前“先启动”“自己操作浏览器”的指令没有接受这些输出。完整审阅包位于 `.llmdoc-tmp/investigations/story-v1-human-review/REVIEW.md`，可按案例分批反馈。2026-10-01 收尾审计已重核 35 个 receipt、原输入/输出摘要及材料副本均与当前状态一致，未接受任何案例。

取得明确审阅结论后，按原流程记录 reviewer/date、接受指定案例、重新 bundle，并验证 Node、浏览器、workerd 与最终工程门禁。不代签，不把当前 105 个 todo 改成假通过。

## 保留的公开发布门槛

Commons 的原创性、适龄和措辞仍未人工签字，所有候选保持未发布。`content/commons/REVIEW.md` 把这项审校设为发布前条件；当前 VISION 没有授权发布 Commons，DOD 也未将其人审加入 Story 工程交付条件。S6/G2 仍须验证示例与新契约一致，不能以此区别跳过机械校验或冒称公共内容已验收。

主站开放、线上模型质量、云资源/密钥和运营流程继续遵循各自明确门槛；不以本轮本地回归或 Harness 推送代替。
