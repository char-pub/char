/**
 * 任务队列（pg-boss）的封装。
 *
 * - 入队与业务写入在同一个事务里：`enqueue(tx, ...)` 通过 pg-boss 的 drizzle 适配器
 *   复用调用方的事务。事务回滚时任务一起消失，提交时两边同时生效，所以不需要单独的
 *   outbox 表和转发器。
 * - 去重：队列使用 exclusive 策略，同一个 singletonKey 同时只能有一个排队或执行中的任务，
 *   重复入队返回 null。
 * - 幂等：处理函数用 `runOnce(tx, key, ...)` 把"效果"和幂等记录写在同一个事务里，
 *   任务被重复投递（例如执行成功但确认前进程崩溃）时直接跳过。
 */
import { sql } from "drizzle-orm";
import { fromDrizzle, type JobWithMetadata, PgBoss } from "pg-boss";
import type { Executor, Tx } from "../db/client.js";
import { jobEffects } from "../db/schema/index.js";
import type { QueueName } from "./definitions.js";

export const PGBOSS_SCHEMA = "pgboss";

export interface QueueOptions {
  connectionString: string;
  /** 连接池大小。worker 进程需要为并发的处理函数留出连接。 */
  max?: number;
  /** 是否运行 pg-boss 的维护任务（过期、重试调度、清理）。只在 worker 进程开启。 */
  supervise?: boolean;
  /** 是否运行定时任务调度。只在 worker 进程开启。 */
  schedule?: boolean;
  /** 后台错误的处理方式，默认写到标准错误输出。 */
  onError?: (err: Error) => void;
}

function defaultOnError(err: Error): void {
  process.stderr.write(`job queue error: ${err.message}\n`);
}

export interface EnqueueOptions {
  /** 去重 key，例如 `publish:<release_id>`。 */
  singletonKey?: string;
  /** 延迟执行（秒）。 */
  startAfterSeconds?: number;
}

export class JobQueue {
  readonly boss: PgBoss;

  constructor(options: QueueOptions) {
    this.boss = new PgBoss({
      connectionString: options.connectionString,
      schema: PGBOSS_SCHEMA,
      // 应用角色没有建表权限；schema 与队列由迁移命令创建。
      migrate: false,
      createSchema: false,
      supervise: options.supervise ?? false,
      schedule: options.schedule ?? false,
      max: options.max ?? 5,
    });
    // pg-boss 的后台轮询出错时会触发 error 事件；没有监听器时 Node 会直接让进程崩溃。
    // 这类错误（例如数据库短暂不可用）只记录，由 pg-boss 在下一轮重试。
    this.boss.on("error", (err) => (options.onError ?? defaultOnError)(err));
  }

  async start(): Promise<void> {
    await this.boss.start();
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 10_000 });
  }

  /**
   * 在调用方的事务中入队。返回任务 id；同一个 singletonKey 已有排队或执行中的任务时返回 null。
   */
  async enqueue<T extends object>(
    tx: Executor,
    name: QueueName,
    data: T,
    options: EnqueueOptions = {},
  ): Promise<string | null> {
    return this.boss.send(name, data, {
      db: fromDrizzle(tx, sql),
      ...(options.singletonKey !== undefined ? { singletonKey: options.singletonKey } : {}),
      ...(options.startAfterSeconds !== undefined ? { startAfter: options.startAfterSeconds } : {}),
    });
  }

  /**
   * 注册处理函数。每次取一个任务；抛出异常即视为失败，按队列配置重试或进入死信队列。
   *
   * `onFinalFailure` 在最后一次尝试失败、任务即将进入死信队列时调用，用来把业务对象标记为
   * 失败，免得它一直停在“处理中”。它自己出错只记录，原来的异常照常抛出，任务照常进入死信。
   */
  async work<T>(
    name: QueueName,
    handler: (job: JobWithMetadata<T>) => Promise<void>,
    options: {
      pollingIntervalSeconds?: number;
      localConcurrency?: number;
      onFinalFailure?: (job: JobWithMetadata<T>, err: unknown) => Promise<void>;
    } = {},
  ): Promise<string> {
    const { onFinalFailure } = options;
    return this.boss.work(
      name,
      {
        batchSize: 1,
        includeMetadata: true,
        pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2,
        localConcurrency: options.localConcurrency ?? 1,
      },
      async (jobs: JobWithMetadata<T>[]) => {
        for (const job of jobs) {
          try {
            await handler(job);
          } catch (err) {
            if (onFinalFailure && isFinalAttempt(job)) {
              await onFinalFailure(job, err).catch((e: unknown) =>
                this.reportError(e instanceof Error ? e : new Error(String(e))),
              );
            }
            throw err;
          }
        }
      },
    );
  }

  private reportError(err: Error): void {
    this.boss.emit("error", err);
  }
}

/**
 * 这是不是最后一次尝试：pg-boss 每次重新取出任务时把 retryCount 加一，
 * retryCount 达到 retryLimit 后再失败，任务就进入死信队列。
 */
export function isFinalAttempt(job: Pick<JobWithMetadata, "retryCount" | "retryLimit">): boolean {
  return job.retryCount >= job.retryLimit;
}

/**
 * 在事务里执行一次性效果。key 已经记录过时返回 false 并跳过 effect；
 * 否则执行 effect 并记录 key，二者同时提交或同时回滚。
 */
export async function runOnce(
  tx: Tx,
  key: string,
  jobName: string,
  effect: () => Promise<void>,
): Promise<boolean> {
  const inserted = await tx
    .insert(jobEffects)
    .values({ key, jobName })
    .onConflictDoNothing()
    .returning({ key: jobEffects.key });
  if (inserted.length === 0) return false;
  await effect();
  return true;
}
