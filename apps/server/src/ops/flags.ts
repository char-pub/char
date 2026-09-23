/**
 * 功能开关（kill switch）的读取缓存。
 *
 * 开关存放在 `feature_flags` 表中，`enabled = false` 表示该功能被关闭。每个进程缓存一份，
 * 最多 5 秒刷新一次，所以管理员切换开关后 5 秒内在所有进程生效，而普通请求不需要每次查库。
 * 读取失败时沿用上一次成功的值（数据库短暂不可用不应导致所有功能被误关或误开）。
 */
import type { FeatureFlag } from "../authz/authorize.js";
import type { Executor } from "../db/client.js";
import { featureFlags } from "../db/schema/index.js";

export const FLAG_REFRESH_MS = 5000;

const KNOWN: ReadonlySet<string> = new Set<FeatureFlag>([
  "signups",
  "uploads",
  "publish",
  "contributions",
  "github_sync",
  "guest_access",
  "read_only",
]);

export class FlagCache {
  private disabled: ReadonlySet<FeatureFlag> = new Set();
  private loadedAt = Number.NEGATIVE_INFINITY;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly db: Executor,
    private readonly now: () => number = () => Date.now(),
    private readonly refreshMs = FLAG_REFRESH_MS,
  ) {}

  /** 当前被关闭的功能。 */
  async current(): Promise<ReadonlySet<FeatureFlag>> {
    if (this.now() - this.loadedAt >= this.refreshMs) {
      this.inflight ??= this.refresh().finally(() => {
        this.inflight = null;
      });
      await this.inflight;
    }
    return this.disabled;
  }

  private async refresh(): Promise<void> {
    try {
      const rows = await this.db
        .select({ key: featureFlags.key, enabled: featureFlags.enabled })
        .from(featureFlags);
      const next = new Set<FeatureFlag>();
      for (const r of rows) if (!r.enabled && KNOWN.has(r.key)) next.add(r.key as FeatureFlag);
      this.disabled = next;
      this.loadedAt = this.now();
    } catch {
      // 保留旧值，下一个请求再试。
    }
  }
}
