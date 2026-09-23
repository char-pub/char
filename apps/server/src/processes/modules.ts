/**
 * 公开 API 挂载的路由模块，以及 worker 进程处理的任务队列。
 * 新增路由模块或任务处理函数时在这里登记。
 */
import type { Hono } from "hono";
import type { Env, Services } from "../api/app.js";

export const API_MODULES: readonly ((app: Hono<Env>) => void)[] = [];

/** 注册 worker 的任务处理函数。 */
export async function startWorkers(_services: Services): Promise<void> {}
