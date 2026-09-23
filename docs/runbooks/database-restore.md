# Runbook：数据库恢复

v0 只使用 Railway Postgres 自带的备份功能（不做异供应商备份）。任何时候都可以用 `pg_dump` 手动导出，保证不被平台锁定。

## 恢复演练（每季度一次，上线前必须做一次）

目标：证明备份能恢复出一套可用的数据库，且数据与备份时刻一致。

1. 在 Railway 的 production environment 中确认备份已启用，记下最近一次备份的时间 T。
2. 在备份时刻附近，记录基准数据（用只读查询，在 production 上执行）：

   ```sql
   SELECT 'releases', count(*) FROM app.releases
   UNION ALL SELECT 'creations', count(*) FROM app.creations
   UNION ALL SELECT 'audit_log', count(*) FROM app.audit_log
   UNION ALL SELECT 'blobs', count(*) FROM app.blobs;
   SELECT id, semantic_digest FROM app.releases ORDER BY created_at DESC LIMIT 5;
   SELECT max(id), max(hash) FROM app.audit_log;
   ```

3. 在 Railway 中从备份恢复到一个**新的**数据库服务（不要覆盖现有数据库）。
4. 连接恢复出的实例，执行同样的查询，与基准比对：行数应与 T 时刻一致；最近的 Release 与审计链头一致。
5. 在恢复实例上运行审计链校验（`verifyAuditChain`），确认没有断链。
6. 记录：备份时间、恢复耗时、比对结果、执行人，写入 `docs/goals/v0/evidence/`，并在 PROGRESS 中引用。
7. 删除恢复出的临时实例。

## 真实恢复

1. 打开 kill switch `read_only`，停止写入。
2. 从最近一次可用的备份恢复到新实例。
3. 比对数据（同上），确认可用。
4. 把 api / admin / worker 的 `DATABASE_URL` 指向新实例（Railway 变量引用），部署。
5. 运行迁移命令确认 schema 是最新的（迁移是幂等的）。
6. 冒烟测试通过后关闭 `read_only`。
7. 评估备份时刻之后丢失的数据：对象存储中的 CAS 对象仍在，可以按 `blobs` 表对账；审计日志中缺失的部分如实记录。
8. 写复盘。
