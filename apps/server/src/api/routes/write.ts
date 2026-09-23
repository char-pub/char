/**
 * Registry 写路径的路由模块：namespace、Creation、草稿与 Revision、发布、个人 Token、
 * 访客验证。读取、搜索、yank 与下架的路由在其他模块中注册。
 */
import type { Hono } from "hono";
import type { Env } from "../app.js";
import { register as creations } from "./creations.js";
import { register as drafts } from "./drafts.js";
import { register as guests } from "./guests.js";
import { register as namespaces } from "./namespaces.js";
import { register as publish } from "./publish.js";
import { register as tokens } from "./tokens.js";

export const REGISTRY_WRITE_MODULES: readonly ((app: Hono<Env>) => void)[] = [
  namespaces,
  creations,
  drafts,
  publish,
  tokens,
  guests,
];
