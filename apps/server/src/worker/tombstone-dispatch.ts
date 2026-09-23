/**
 * `tombstone.cascade` 队列的任务分发。
 *
 * 队列里有两种任务：
 * - 员工在 admin 中执行下架后入队的级联任务（`action_id` + 要删除的对象 + CDN URL），
 *   直接删除副本、清缓存、核验；
 * - CSAM 命中后入队的下架请求（`subject.digests` + 原因代码 + 受影响的 Release）：
 *   先按下架流程把这些 Release 设为 tombstoned、写黑名单与审计，再执行同样的级联。
 *
 * 两种任务都幂等：级联任务靠 `runOnce`，下架请求按 action_id 派生每个对象的操作 ID，
 * 已经 tombstoned 的 Release 不会重复处理。
 */
import { isCharError as isChar, sha256Hex } from "@char-pub/core";
import type { Db } from "../db/client.js";
import type { JobQueue } from "../jobs/queue.js";
import {
  executeTombstone,
  type TombstoneCascadeJob,
  type TombstoneReason,
} from "../registry/tombstone.js";
import { type CdnPurger, runTombstoneCascade, type TombstoneWorkerDeps } from "./tombstone.js";

export interface TombstoneRequestJob {
  subject: { digests: string[] };
  reason_code: TombstoneReason;
  action_id: string;
  releases: string[];
}

export type TombstoneQueueJob = TombstoneCascadeJob | TombstoneRequestJob;

export function isRequest(job: TombstoneQueueJob): job is TombstoneRequestJob {
  return "subject" in job && Array.isArray((job as TombstoneRequestJob).subject?.digests);
}

export interface DispatchDeps extends TombstoneWorkerDeps {
  queue: JobQueue;
  /** 记为下架执行者的系统账号（需要存在于 auth_user 中）。 */
  systemActorId: string;
  publicAssetBaseUrl: string;
  newId: () => string;
}

/**
 * 处理一个任务。下架请求会转成一个或多个级联任务并直接执行，不再经过队列，
 * 这样“命中 → 下架 → 删除副本”在同一次任务执行中完成。
 */
export async function dispatchTombstoneJob(
  deps: DispatchDeps,
  job: TombstoneQueueJob,
): Promise<void> {
  if (!isRequest(job)) {
    await runTombstoneCascade(deps, job);
    return;
  }
  for (const [i, digest] of job.subject.digests.entries()) {
    const actionId = deriveActionId(job.action_id, i);
    const result = await executeTombstone(deps.db as Db, deps.queue, {
      subject: { kind: "asset", digest },
      reason_code: job.reason_code,
      note: "automatic takedown after a CSAM incident",
      actor: { staff_user_id: deps.systemActorId },
      now: deps.now(),
      action_id: actionId,
      publicAssetBaseUrl: deps.publicAssetBaseUrl,
    }).catch((e: unknown) => {
      // 跳过两种情况：同一个对象已经被下架过（操作 ID 重复，重复投递时出现）；
      // 这个 digest 没有被任何 Release 引用（例如缩略图或原件，只有处理后的图片被引用）。
      if (isUniqueViolation(e) || isCharError(e, "tombstone.subject_not_found")) return null;
      throw e;
    });
    if (!result) continue;
    await runTombstoneCascade(deps, {
      action_id: result.action_id,
      objects: result.preview.objects.map((o) => ({
        digest: o.digest,
        in_public: o.in_public,
        in_private: o.in_private,
      })),
      cdn_urls: result.preview.cdn_urls,
    });
  }
}

/**
 * 每个对象的操作 ID 由原始操作 ID 与序号确定性派生（取 sha256 的前 16 字节，按 UUIDv8
 * 的格式写出），所以重复投递时得到同一个 ID，插入 moderation_actions 会因主键冲突而被识别
 * 为已处理；它也不会与原始操作（CSAM 隔离记录）本身的 ID 相同。
 */
export function deriveActionId(base: string, index: number): string {
  const h = sha256Hex(`tombstone:${base}:${index}`);
  const variant = ((Number.parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

function isCharError(e: unknown, code: string): boolean {
  return isChar(e) && e.code === code;
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

export type { CdnPurger };
