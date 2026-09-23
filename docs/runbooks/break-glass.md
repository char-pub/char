# Runbook：break-glass（紧急访问）

适用于：Cloudflare Access 故障导致员工无法进入 admin，或者唯一的 owner 账号不可用，同时又有必须立即处理的事件（例如 CSAM 或正在进行的滥用）。

break-glass 会绕过常规的防护层，**只在确实无法等待时使用**，事后必须复盘。

## 前提

- 至少两名员工知道 break-glass 流程；凭证不存放在仓库中。
- 凭证：Railway 项目的访问权限（可以直接连接数据库和修改变量），以及 GitHub 组织 owner 权限。

## 步骤

1. 在事件频道说明：谁、为什么、预计多久。
2. 优先使用不绕过防护的手段：
   - 打开 kill switch：可以通过 Railway 直接执行 SQL 更新 `app.feature_flags`（例如 `UPDATE app.feature_flags SET enabled = false, reason = '...', updated_by = '<你的名字>' WHERE key = 'uploads';`），5 秒内生效。
   - 封禁账号：直接调用 admin 进程的内部命令（如果 admin 进程本身可用，只是 Access 不可用，可以通过 Railway 的私有网络从 worker 容器调用）。
3. 必须直接改数据库时：
   - 使用 owner 角色连接（`DATABASE_MIGRATION_URL`），只执行最小必要的语句；
   - **手工在 `app.audit_log` 追加一条记录**（通过 admin 进程提供的审计工具命令，保证哈希链连续），写明操作人、原因和执行的语句。
4. 事件处理完后：
   - 轮换使用过的凭证（见[密钥轮换](rotate-secrets.md)）；
   - 运行 `verifyAuditChain` 确认审计链完整；
   - 写复盘，说明为什么需要 break-glass、常规路径哪里失效了、如何避免下次再用。
