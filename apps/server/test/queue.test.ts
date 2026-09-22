/**
 * 任务队列：事务内入队、singletonKey 去重、处理幂等、失败重试与死信。
 *
 * 集成测试直接用 fetch / complete / fail 驱动任务，而不是等后台 worker 轮询，
 * 这样结果是确定的；`work()` 的端到端行为单独用一个用例验证。
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { featureFlags, jobEffects } from "../src/db/schema/index.js";
import { DEAD_LETTER_SUFFIX, QUEUE_NAMES, QUEUES } from "../src/jobs/definitions.js";
import { JobQueue, runOnce } from "../src/jobs/queue.js";
import { createTestDatabase, type TestDatabase } from "./helpers.js";

let t: TestDatabase;
let queue: JobQueue;
const Q = QUEUE_NAMES.publish;

async function jobsIn(name: string) {
  return queue.boss.findJobs<{ n?: number }>(name);
}

beforeAll(async () => {
  t = await createTestDatabase();
  queue = new JobQueue({ connectionString: t.appUrl, max: 4 });
  queue.boss.on("error", () => {});
  await queue.start();
});

afterAll(async () => {
  await queue.stop();
  await t.drop();
});

describe("queue setup", () => {
  it("migrations created every queue with retries, backoff and a dead letter queue", async () => {
    for (const q of QUEUES) {
      const info = await queue.boss.getQueue(q.name);
      expect(info).toMatchObject({
        policy: "exclusive",
        retryLimit: 5,
        retryBackoff: true,
        deadLetter: `${q.name}${DEAD_LETTER_SUFFIX}`,
      });
      expect(await queue.boss.getQueue(`${q.name}${DEAD_LETTER_SUFFIX}`)).not.toBeNull();
    }
  });

  it("the app role cannot create or delete queues; only migrations can", async () => {
    await expect(queue.boss.createQueue("evil-queue")).rejects.toThrow(/permission denied/);
    await expect(queue.boss.deleteQueue(QUEUE_NAMES.gc)).rejects.toThrow(/permission denied/);
    expect(await queue.boss.getQueue(QUEUE_NAMES.gc)).not.toBeNull();
  });
});

describe("transactional enqueue", () => {
  it("a rolled back transaction leaves neither the business row nor the job", async () => {
    await expect(
      t.app.db.transaction(async (tx) => {
        await tx.insert(featureFlags).values({ key: "rollback-case", enabled: true });
        const id = await queue.enqueue(tx, Q, { n: 1 }, { singletonKey: "rollback-case" });
        expect(id).toBeTypeOf("string");
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(
      await t.app.db.select().from(featureFlags).where(eq(featureFlags.key, "rollback-case")),
    ).toHaveLength(0);
    expect(await queue.boss.findJobs(Q, { key: "rollback-case" })).toHaveLength(0);
  });

  it("a committed transaction persists both the business row and the job", async () => {
    const id = await t.app.db.transaction(async (tx) => {
      await tx.insert(featureFlags).values({ key: "commit-case", enabled: true });
      return queue.enqueue(tx, Q, { n: 2 }, { singletonKey: "commit-case" });
    });
    expect(id).toBeTypeOf("string");
    expect(
      await t.app.db.select().from(featureFlags).where(eq(featureFlags.key, "commit-case")),
    ).toHaveLength(1);
    const jobs = await queue.boss.findJobs(Q, { key: "commit-case" });
    expect(jobs.map((j) => j.id)).toEqual([id]);
  });

  it("the job is invisible to other connections until the transaction commits", async () => {
    await t.app.db.transaction(async (tx) => {
      await queue.enqueue(tx, Q, { n: 3 }, { singletonKey: "visibility-case" });
      expect(await queue.boss.findJobs(Q, { key: "visibility-case" })).toHaveLength(0);
    });
    expect(await queue.boss.findJobs(Q, { key: "visibility-case" })).toHaveLength(1);
  });
});

describe("deduplication and idempotency", () => {
  it("the same singletonKey is only queued once while pending", async () => {
    const first = await queue.enqueue(t.app.db, Q, { n: 4 }, { singletonKey: "dup-case" });
    const second = await queue.enqueue(t.app.db, Q, { n: 5 }, { singletonKey: "dup-case" });
    expect(first).toBeTypeOf("string");
    expect(second).toBeNull();
    expect(await queue.boss.findJobs(Q, { key: "dup-case" })).toHaveLength(1);
  });

  it("runOnce applies an effect once even if the job is delivered twice", async () => {
    let applied = 0;
    const handle = () =>
      t.app.db.transaction((tx) =>
        runOnce(tx, "publish:rel_x", Q, async () => {
          applied += 1;
          await tx
            .insert(featureFlags)
            .values({ key: "effect-case", enabled: true })
            .onConflictDoNothing();
        }),
      );
    expect(await handle()).toBe(true);
    expect(await handle()).toBe(false);
    expect(applied).toBe(1);
    expect(
      await t.app.db.select().from(jobEffects).where(eq(jobEffects.key, "publish:rel_x")),
    ).toHaveLength(1);
  });

  it("runOnce records nothing when the effect fails, so a retry can apply it", async () => {
    await expect(
      t.app.db.transaction((tx) =>
        runOnce(tx, "publish:rel_fail", Q, async () => {
          throw new Error("transient");
        }),
      ),
    ).rejects.toThrow("transient");
    const ok = await t.app.db.transaction((tx) =>
      runOnce(tx, "publish:rel_fail", Q, async () => {}),
    );
    expect(ok).toBe(true);
  });
});

describe("retries and dead letter", () => {
  // 用一个其他用例不会写入的队列，保证 fetch 取到的就是这个任务。
  const DQ = QUEUE_NAMES.tombstoneCascade;

  it("a failing job is retried and, once retries are exhausted, moved to the dead letter queue", async () => {
    const id = await queue.boss.send(
      DQ,
      { n: 6 },
      { singletonKey: "dlq-case", retryLimit: 1, retryDelay: 0, retryBackoff: false },
    );
    expect(id).toBeTypeOf("string");
    if (!id) return;

    const [first] = await queue.boss.fetch(DQ);
    expect(first?.id).toBe(id);
    await queue.boss.fail(DQ, id, { message: "boom" });
    let [job] = await queue.boss.findJobs(DQ, { id });
    expect(job?.state).toBe("retry");

    const [second] = await queue.boss.fetch(DQ);
    expect(second?.id).toBe(id);
    await queue.boss.fail(DQ, id, { message: "boom again" });
    [job] = await queue.boss.findJobs(DQ, { id });
    expect(job?.state).toBe("failed");
    expect(job?.retryCount).toBe(1);

    const dead = await jobsIn(`${DQ}${DEAD_LETTER_SUFFIX}`);
    expect(dead.some((d) => d.data?.n === 6)).toBe(true);
  });

  it("uses exponential backoff with a delay cap by default", async () => {
    const id = await queue.boss.send(
      QUEUE_NAMES.searchIndex,
      { n: 7 },
      { singletonKey: "backoff-case" },
    );
    if (!id) throw new Error("not queued");
    const [job] = await queue.boss.findJobs(QUEUE_NAMES.searchIndex, { id });
    expect(job).toMatchObject({
      retryLimit: 5,
      retryBackoff: true,
      retryDelay: 5,
      retryDelayMax: 600,
    });
  });
});

describe("worker", () => {
  it("work() processes a committed job and completes it", async () => {
    const done = new Promise<number>((resolve) => {
      void queue.work<{ n: number }>(
        QUEUE_NAMES.gc,
        async (job) => {
          await t.app.db.transaction((tx) =>
            runOnce(tx, `gc:${job.id}`, QUEUE_NAMES.gc, async () => {
              await tx.execute(sql`SELECT 1`);
            }),
          );
          resolve(job.data.n);
        },
        { pollingIntervalSeconds: 0.5 },
      );
    });
    await t.app.db.transaction((tx) =>
      queue.enqueue(tx, QUEUE_NAMES.gc, { n: 42 }, { singletonKey: "gc-run" }),
    );
    expect(await done).toBe(42);
    await queue.boss.offWork(QUEUE_NAMES.gc, { wait: true });
    const [job] = await queue.boss.findJobs(QUEUE_NAMES.gc, { key: "gc-run" });
    expect(job?.state).toBe("completed");
  });
});
