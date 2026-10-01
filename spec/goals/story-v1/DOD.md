# DOD

每个完成项必须在 PROGRESS 中记录实际命令/结果/证据；后续修改使证据失效时重新打开。

- [x] M0：规范消除已审阅歧义；取消双路径兼容；决策与执行包一致（S1–S6）。证据：`.llmdoc-tmp/investigations/story-v1-m0-m3-final-readiness.md`逐项对照，Scene effects/视角顺序/作者诊断与消费Trace/来源历史分域已统一；人工规范基线与稳定知识另属G1/G2。
- [x] M1：完整 Story schema、静态引用/类型校验、参与者实例和发布产物；条件/效果参考求值满足 U1/U3/U4/U6。证据：上述最终矩阵与Core、portable201–206及真实U1链；局部半成品引用检查40项，导出schema一致性通过。未冒称人工expected已接受。
- [x] M2：视角过滤、Selector 输入投影、渐进 Catalog、Plan 绑定/校验、固定 Selector 和确定组装满足 U2/U5/U7。证据：最终矩阵，真实Catalog/view/prepare/metadata+三runtime；最新完整CI已实跑conformance316通过/105todo，todo仍是独立人工基线门槛。
- [x] M3：新版 Policy/Style/Module、SDK/CLI/Action/CCv3 走统一契约，预算/来源/导出损失正确（S4/S6）。证据：最终矩阵的公开cmdBuild/Preview/Test、打包Action、CCv3 loss与Module/Style；最新7d17291真实SDK包被独立Runtime消费，131回归/持久化changes=[]；全局最终门禁另属G1。
- [x] M4：Registry 完成发布、草稿构建、OAuth、作品级协作者与对象级 Contribution，授权和失败路径验证通过（S5/U8）。证据：PROGRESS 中 D-206–D-208 检查点；派生与历史来源更新后最终 57 文件 941 项真实集成通过，含授权/撤权/并发/对象合并/PAT worker凭证，以及协作、投稿与OAuth真实浏览器流程。外部Runtime客户端接入和完整作者工作流继续属于M5/M6。
- [x] M5：Web 普通创作、剧情编辑、渐进资料、预览、投稿、Remix 与协作可用；本地消费者可读取授权构建（U1–U8）。证据：既有D214–D218真实链与D223–D230；发布分类审阅/影响/shared实际全栈1/1、现场角色创建发布收藏精确选版1/1、真正dsh/OAuth/生成/新dbld重开与旧tab拒绝1/1、外部AI候选下载/Review零写/Apply保存与刷新来源1/1。五类半成品候选53相关回归，协作者单向声明及敏感来源保护真实DB20项。Runtime入口的Story/estimate/text/noneSelection与非在线质量限制详见DOR，不冒称完整游戏客户端。2026-10-01本地体验缺默认Preset曾重新打开；现标准pnpm dev真实初始化、同tab跳转及Harness对比度均修复，从现有草稿真实鼠标操作到授权读取、新Session开场及可读回复框已闭合，见story-v1-local-usable-browser报告。
- [ ] G1：最终 pnpm ci:all 通过；涉及规范的 Node/浏览器/workerd fixture 都通过，人工 expected 接受单独记录（S6）。
- [x] G2：spec、生成 schema、示例与 llmdoc 与实际实现一致；无占位功能、跳过门禁或未记阻塞。证据：M0–M3 最终矩阵及最新完整 CI 的 schema/示例/工具回归；正式知识更新与启动增量更新已完成（story-v1-g2-update-success、story-v1-startup-readiness-update-success）；本轮 completion audit 修正 conformance 主 README 与 DOR 的过时状态。G1 的人工 expected 仍待接受；Commons 保持未审未发布，其人审是公开发布前门槛，不以此勾选代签。

## 覆盖

S1=M0/M1；S2=M1/M2/M5；S3=M2；S4=M3；S5=M4/M5；S6=M3/G1/G2。
U1=M1/M5；U2=M2/M5；U3=M1/M2；U4=M1/M5；U5=M2；U6=M1；U7=M2/M3；U8=M4/M5。

外部 Runtime 的实际模型质量、生产部署与公开发布不在本仓库验收范围。若外部输入妨碍本仓库验证，记录确切缺失内容，不用模拟结果冒充真实集成。

- [x] M6：独立 harness monorepo 建立，保留候选上游来源/许可，隔离创作平台与会话执行，固定决策的消费流程通过；Jev/Laya 适配与配置行为明确（S7/U9）。证据：独立H0–H4逐条核对，固定SDK真实消费、命名profile/JSONL恢复、Jev14协议用例与Laya9用例、共127项相关回归及类型/编译/持久化/文档检查通过，见PROGRESS的D222终态。Laya本地HTTP采用固定概率替身，未下载权重或调用在线推理；真实在线质量与阈值校准仍待独立验收，不以此勾选冒称质量通过。完整游戏客户端及自动模型开局receipt按D219保留后续路线，不作为本次最小消费入口的完成条件。

2026-10-01 用户追加的 Harness H5–H8 也已交付：最新上游同步、React 游玩 UI、char-pub/char-harness 组织仓库及 51 个 llmdoc owner，远端 keyless CI 通过。具体交付和限制由外仓 `spec/goals/roleplay/` 持有；不改变本仓 G1 的人工接受要求。
