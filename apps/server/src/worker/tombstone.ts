/**
 * tombstone 级联的后台任务：删除被下架对象的可分发副本、清除 CDN 缓存并核验。
 *
 * - 只删除 public / private 两个可分发桶中的副本；证据桶不受影响，证据的删除由专门的
 *   留存期任务按法定期限执行。
 * - 删除后逐个核验对象已经不存在；核验失败时抛出异常，任务按队列配置重试。
 * - 幂等：任务完成的标记与 blob 状态更新写在同一个事务里，重复投递时直接跳过。
 */
import { eq, inArray } from "drizzle-orm";
import { type AuditActor, appendAudit } from "../audit/audit.js";
import type { Db } from "../db/client.js";
import { blobs } from "../db/schema/index.js";
import { runOnce } from "../jobs/queue.js";
import type { TombstoneCascadeJob } from "../registry/tombstone.js";
import { type Cas, casKey } from "../storage/cas.js";

/** CDN 缓存清除接口。线上实现调用 Cloudflare 的 purge-by-URL API。 */
export interface CdnPurger {
  purge(urls: readonly string[]): Promise<void>;
}

/** 本地与测试用的替身：记录被清除的 URL。 */
export class RecordingPurger implements CdnPurger {
  readonly purged: string[] = [];
  async purge(urls: readonly string[]): Promise<void> {
    this.purged.push(...urls);
  }
}

export interface TombstoneWorkerDeps {
  db: Db;
  cas: Cas;
  cdn: CdnPurger;
  now: () => Date;
}

export const TOMBSTONE_JOB = "tombstone.cascade";

/** Cloudflare 每次 purge 请求最多 30 个 URL。 */
const PURGE_BATCH = 30;

export async function runTombstoneCascade(
  deps: TombstoneWorkerDeps,
  job: TombstoneCascadeJob,
): Promise<{ skipped: boolean; deleted: number }> {
  const key = `tombstone.cascade:${job.action_id}`;
  let deleted = 0;
  let skipped = true;
  await deps.db.transaction(async (tx) => {
    skipped = !(await runOnce(tx, key, TOMBSTONE_JOB, async () => {
      for (const o of job.objects) {
        if (o.in_public) await deps.cas.deleteObject("public", o.digest);
        if (o.in_private) await deps.cas.deleteObject("private", o.digest);
        deleted += Number(o.in_public) + Number(o.in_private);
      }
      for (const o of job.objects) {
        for (const bucket of ["public", "private"] as const) {
          if (await deps.cas.exists(bucket, casKey(o.digest))) {
            throw new Error(`object ${o.digest} is still present in the ${bucket} bucket`);
          }
        }
      }
      for (let i = 0; i < job.cdn_urls.length; i += PURGE_BATCH) {
        await deps.cdn.purge(job.cdn_urls.slice(i, i + PURGE_BATCH));
      }
      const digests = job.objects.map((o) => o.digest);
      if (digests.length > 0) {
        await tx
          .update(blobs)
          .set({ inPublic: false, inPrivate: false, updatedAt: deps.now() })
          .where(inArray(blobs.digest, digests));
      }
      const actor: AuditActor = { kind: "system", id: "worker" };
      await appendAudit(tx, {
        at: deps.now(),
        actor,
        action: "tombstone.copies_removed",
        subject: `moderation_action:${job.action_id}`,
        after: { objects: digests.length, cdn_urls: job.cdn_urls.length },
      });
    }));
  });
  return { skipped, deleted };
}

/** blob 当前是否还登记在可分发的桶里。 */
export async function blobLocations(db: Db, digest: string) {
  const [b] = await db
    .select({ inPublic: blobs.inPublic, inPrivate: blobs.inPrivate, status: blobs.status })
    .from(blobs)
    .where(eq(blobs.digest, digest))
    .limit(1);
  return b ?? null;
}
