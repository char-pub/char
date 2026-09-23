/**
 * Cloudflare 的按 URL 清除缓存。需要一个只有 “Zone → Cache Purge” 权限的 API token。
 * 没有配置 token 时（本地开发），使用只记录日志的实现。
 */
import type { CdnPurger } from "../worker/tombstone.js";

export class CloudflarePurger implements CdnPurger {
  constructor(
    private readonly zoneId: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async purge(urls: readonly string[]): Promise<void> {
    if (urls.length === 0) return;
    const res = await this.fetchImpl(
      `https://api.cloudflare.com/client/v4/zones/${this.zoneId}/purge_cache`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify({ files: urls }),
      },
    );
    const body = (await res.json().catch(() => null)) as { success?: boolean } | null;
    if (!res.ok || body?.success !== true) {
      // 抛出后任务会按退避重试；清除失败不能静默忽略，否则下架的内容仍可能从缓存读到。
      throw new Error(`cdn purge failed with status ${res.status}`);
    }
  }
}

export class LoggingPurger implements CdnPurger {
  async purge(urls: readonly string[]): Promise<void> {
    for (const u of urls) process.stdout.write(`cdn purge (not configured): ${u}\n`);
  }
}
