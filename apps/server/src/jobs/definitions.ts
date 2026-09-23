/**
 * 所有任务队列的定义。迁移时统一创建；应用进程只入队和消费，不建队列。
 *
 * 默认策略：失败后指数退避重试，重试耗尽进入对应的死信队列，由 admin 任务面板查看、
 * 重新投递或丢弃。任务本身必须幂等：同一个业务对象用固定的 singletonKey，
 * 并且处理函数在执行前检查业务状态，重复执行不会产生额外副作用。
 */
import type { Queue } from "pg-boss";

export const DEAD_LETTER_SUFFIX = ".dead";

const retrying = (name: string, extra: Omit<Queue, "name"> = {}): Queue => ({
  name,
  // exclusive：同一个 singletonKey 同时只允许一个排队或执行中的任务，用来去重。
  policy: "exclusive",
  retryLimit: 5,
  retryDelay: 5,
  retryBackoff: true,
  retryDelayMax: 600,
  expireInSeconds: 15 * 60,
  deadLetter: `${name}${DEAD_LETTER_SUFFIX}`,
  ...extra,
});

export const QUEUE_NAMES = {
  publish: "publish",
  publishRequeue: "publish.requeue",
  uploadProcess: "upload.process",
  importCcv3: "import.ccv3",
  githubSync: "github.sync",
  githubReconcile: "github.reconcile",
  exportBuild: "export.build",
  tombstoneCascade: "tombstone.cascade",
  publicCopy: "cas.public-copy",
  gc: "cas.gc",
  auditAnchor: "audit.anchor",
  searchIndex: "search.index",
  uploadExpire: "upload.expire",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const QUEUES: readonly Queue[] = Object.values(QUEUE_NAMES).map((name) => retrying(name));
