/**
 * 上传相关的 worker 任务：处理上传（`upload.process`）与清理过期上传（`upload.expire`）。
 *
 * 处理函数本身是幂等的：只有 processing 状态的上传会被处理，重复投递时直接跳过。
 * 扫描服务不可用时抛出可重试错误，由 pg-boss 按退避策略重试；重试耗尽进入死信队列，
 * 上传保持 processing，不会被自动放行。
 */
import { QUEUE_NAMES } from "../jobs/definitions.js";
import type { JobQueue } from "../jobs/queue.js";
import { expireUploads, type PipelineDeps, processUpload } from "../upload/pipeline.js";

export interface UploadJob {
  upload_id: string;
}

/** 单个任务的处理入口，测试直接调用它。 */
export async function handleUploadJob(deps: PipelineDeps, data: UploadJob): Promise<void> {
  await processUpload(deps, data.upload_id);
}

export async function registerUploadWorkers(queue: JobQueue, deps: PipelineDeps): Promise<void> {
  await queue.work<UploadJob>(QUEUE_NAMES.uploadProcess, (job) => handleUploadJob(deps, job.data));
  await queue.work(QUEUE_NAMES.uploadExpire, async () => {
    await expireUploads(deps);
  });
  // 每小时清理一次过期上传。
  await queue.boss.schedule(QUEUE_NAMES.uploadExpire, "17 * * * *");
}
