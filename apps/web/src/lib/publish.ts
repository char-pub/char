/**
 * 网页发布流程：保存草稿 → 生成 Revision → 发布（带 Idempotency-Key）→ 轮询 Publish
 * Report 直到 worker 完成检查。同一次发布的重试必须复用同一个 key：服务端据此返回
 * 同一个 Release，而不是重复发布。
 */
import type { PublishReportResponse, PublishResponse, RegistryClient } from "./api";

/** 下一个建议的版本号：最新的 `x.y.z` 递增补丁号；没有发布过时是 1.0.0。 */
export function suggestLabel(labels: readonly string[]): string {
  let best: [number, number, number] | null = null;
  for (const l of labels) {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(l);
    if (!m) continue;
    const v: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (
      !best ||
      v[0] > best[0] ||
      (v[0] === best[0] && (v[1] > best[1] || (v[1] === best[1] && v[2] > best[2])))
    ) {
      best = v;
    }
  }
  return best ? `${best[0]}.${best[1]}.${best[2] + 1}` : "1.0.0";
}

/** 为一次发布请求保存 Idempotency-Key：内容、label、可见性都不变时重试复用同一个 key。 */
export class IdempotencyKeys {
  private current: { tuple: string; key: string } | null = null;
  constructor(private readonly newKey: () => string = () => crypto.randomUUID()) {}

  keyFor(revision: string, label: string, visibility: string): string {
    const tuple = `${revision}\u0000${label}\u0000${visibility}`;
    if (this.current?.tuple !== tuple) this.current = { tuple, key: this.newKey() };
    return this.current.key;
  }

  /** 发布有了确定的结果（成功或被拒绝）之后，下一次发布使用新的 key。 */
  reset(): void {
    this.current = null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 等待 worker 完成发布检查；超时后返回最后一次看到的（仍为 pending 的）报告。 */
export async function waitForReport(
  client: RegistryClient,
  ns: string,
  name: string,
  label: string,
  first: PublishResponse,
  opts: { intervalMs?: number; maxPolls?: number } = {},
): Promise<PublishReportResponse> {
  let report: PublishReportResponse = { ...first, label };
  const max = opts.maxPolls ?? 90;
  for (let i = 0; i < max && report.state === "pending"; i++) {
    await sleep(opts.intervalMs ?? 1000);
    report = await client.publishReport(ns, name, label);
  }
  return report;
}
