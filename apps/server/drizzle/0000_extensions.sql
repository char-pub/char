-- 搜索依赖 pg_trgm（三字以上查询和拉丁语系文本）。pg_trgm 是 trusted extension，
-- 对数据库有 CREATE 权限的 owner 角色即可安装，不需要超级用户。
CREATE EXTENSION IF NOT EXISTS pg_trgm;
