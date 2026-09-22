/**
 * 数据库连接。所有业务代码通过 `Executor` 访问数据库：它可以是连接池上的 db，
 * 也可以是一个事务，这样同一个函数既能单独调用，也能组合进更大的事务。
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;

export interface Database {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function createDatabase(connectionString: string, options: { max?: number } = {}): Database {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  // 空闲连接被服务端断开（重启、故障切换）时 pg 会触发 error 事件；不处理会让进程崩溃。
  // 连接池会自动丢弃坏连接，下次查询时重新建立。
  pool.on("error", (err) => onPoolError(err));
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    close: () => pool.end(),
  };
}

let onPoolError: (err: Error) => void = () => {};

/** 设置空闲连接出错时的回调（例如写日志）。 */
export function setPoolErrorHandler(handler: (err: Error) => void): void {
  onPoolError = handler;
}

export { schema };
