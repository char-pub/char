/**
 * OIDC token 的 jti 防重放存储：`oidc_jti` 表的主键保证并发请求中只有一个能占用同一个 jti。
 * 过期记录由 worker 的定时清理任务删除。
 */
import { lt } from "drizzle-orm";
import type { Executor } from "../db/client.js";
import { oidcJti } from "../db/schema/index.js";
import type { JtiStore } from "../oidc/github.js";

export class DbJtiStore implements JtiStore {
  constructor(
    private readonly db: Executor,
    private readonly now: () => Date,
  ) {}

  async claim(jti: string, expiresAt: Date): Promise<boolean> {
    const inserted = await this.db
      .insert(oidcJti)
      .values({ jti, expiresAt })
      .onConflictDoNothing()
      .returning({ jti: oidcJti.jti });
    return inserted.length > 0;
  }

  /** 删除已过期的记录。 */
  async purgeExpired(): Promise<number> {
    const rows = await this.db
      .delete(oidcJti)
      .where(lt(oidcJti.expiresAt, this.now()))
      .returning({ jti: oidcJti.jti });
    return rows.length;
  }
}
