# Runbook：CSAM 命中

适用于：Cloudflare CSAM Scanning Tool 的命中通知、用户举报、员工发现，或接入 PhotoDNA 之后的扫描命中。

**不要**打开、转发、截图或以任何方式复制涉嫌内容。**不要**把它发给同事“确认一下”。admin 界面永远不显示内容本身：CSAM 事件页的“Evidence”只给出元数据（digest、大小、类型、存储位置、保全期限），只有 legal 与 owner 可以查看。

## 法律要求（美国，18 U.S.C. 2258A）

- 服务商“实际知情”后必须尽快（as soon as reasonably possible）向 NCMEC CyberTipline 报告。
- 报告后把内容及合理可获取的上下文保全 **1 年**，存放在访问受限的位置。
- 不要通知上传者具体原因（避免妨碍调查）。

欧盟用户涉及的内容同样按此流程处理；另外遵守当地执法机关的要求。运营主体确定后，由 legal 复核本预案。

## 步骤

1. **隔离**（trust_safety 或 legal）：在 admin 中对该上传或 Release 执行“标记为 CSAM”。系统在一个事务中：
   - 上传状态改为 `quarantined`；如果已被 Release 引用，这些 Release 走 tombstone 级联，原因代码 `policy.minor_sexual`；
   - 原件复制到 evidence 桶，然后从 public / private 桶删除，并清除 CDN 缓存；
   - 锁定上传者账号，吊销全部会话和 Token；
   - 内容哈希加入黑名单，阻止重新上传或发布；
   - 创建事件工单。
2. **确认**：在 admin 事件页面确认 CDN URL 已返回 404、账号已锁定、黑名单已写入。
3. **报告**（legal）：登录 NCMEC CyberTipline（ESP 账号）提交报告，填写上传时间、上传者账号信息（IP 哈希以外的原始 IP 如有保留）、内容哈希。把报告编号填回事件工单。
4. **保全**：证据桶的对象保留到报告日期后 1 年，到期由专门任务删除并写审计。期间只有 legal 角色可以通过 admin 读取。
   - 只有向主管机关提交材料确实需要原件时才下载：在“Evidence”中填写理由并勾选确认，系统签发一个 5 分钟内有效、只能由本人使用一次的下载链接，下载得到的是一个 `application/octet-stream` 附件，页面不做任何预览。签发与下载各写一条审计。
   - 下载的文件只能保存在受控的设备上，提交完成后按法律顾问的要求处理，不要留在个人电脑或共享盘中。
5. **补扫**：检查同一账号的其他上传；如果是批量滥用，考虑临时关闭上传（kill switch `uploads`）。
6. **复盘**：记录发现渠道和处理时长，评估是否需要调整上传限制或扫描策略。

## 误报

如果 legal 确认是误报：

- 解封被 CSAM 锁定的账号需要**四眼确认**（两名员工）。
- 恢复 Release 属于运营例外，需要 owner 加四眼确认，并在 DECISIONS 中登记。
- 证据副本按留存规则处理，不因误报而提前删除，除非法律顾问另有意见。

## 联系方式

- NCMEC CyberTipline：https://report.cybertip.org/
- Cloudflare CSAM Scanning Tool 的命中通知邮箱：由运营者在 Cloudflare 控制台配置，必须有人每天查看。
