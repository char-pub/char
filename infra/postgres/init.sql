-- 本地初始化：应用使用非 owner 角色连接，这样它无法修改表结构，
-- 也无法篡改只允许追加的审计日志。
-- 表的所有权属于 charpub_owner（迁移使用），应用运行时使用 charpub_app。
CREATE ROLE charpub_app LOGIN PASSWORD 'charpub_app_local';
GRANT CONNECT ON DATABASE charpub TO charpub_app;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION charpub_owner;
GRANT USAGE ON SCHEMA app TO charpub_app;
-- 具体表的 GRANT 由迁移显式授予（audit_log 只给 INSERT / SELECT）。
