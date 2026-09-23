/**
 * Registry API 客户端的接口。Web 目前只用本地示例数据；接上 `api.char.pub` 后，
 * 实现同一个接口即可，界面代码不需要改。
 */
import type { ContextIR } from "@char-pub/core";

export interface CreationSummary {
  ref: string;
  display_name: string;
  type: string;
  rating: ContextIR["meta"]["rating"];
  latest_label?: string;
}

export interface RegistryClient {
  getIR(ref: string, label?: string): Promise<ContextIR>;
  search(query: string, opts?: { showMature?: boolean }): Promise<CreationSummary[]>;
}

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "https://api.char.pub";
