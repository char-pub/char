/**
 * CSAM 扫描接口与上传结果判定。
 *
 * 公开前扫描需要一个能主动调用的哈希匹配服务（首选 PhotoDNA）。审核通过之前默认使用
 * `noopScanner`：它不扫描，只如实记录“未扫描”，图片在其他检查通过后直接进入 ready。
 * 这段时间依靠 Cloudflare 对公开 CDN 内容的被动扫描、用户举报和员工处置兜底；接入真实
 * provider 后，对所有存量图片补扫一遍。
 *
 * 接入真实 provider 之后，provider 不可用时上传停在 processing，不自动放行。
 */
import type { ProcessedImage } from "./image.js";

export type ScanResult =
  | { status: "not_scanned"; provider: string }
  | { status: "clear"; provider: string }
  | { status: "match"; provider: string; match_id: string }
  | { status: "unavailable"; provider: string; retry_after_seconds: number };

export interface CsamScanner {
  readonly provider: string;
  /** 扫描原件的字节。实现必须是幂等的，同一张图重复扫描结果相同。 */
  scan(original: Uint8Array): Promise<ScanResult>;
}

export const noopScanner: CsamScanner = {
  provider: "none",
  scan: async () => ({ status: "not_scanned", provider: "none" }),
};

export type UploadOutcome =
  | { state: "ready"; scan_status: "not_scanned" | "clear"; provider: string }
  | { state: "quarantined"; provider: string; match_id: string; reason: "csam_scan" | "staff_flag" }
  /** 扫描服务暂时不可用：保持 processing，稍后重试。 */
  | { state: "retry"; retry_after_seconds: number };

/** 根据扫描结果决定上传的去向。图片处理失败的情况在此之前已经被拒绝。 */
export function decideUpload(_image: ProcessedImage, scan: ScanResult): UploadOutcome {
  switch (scan.status) {
    case "not_scanned":
    case "clear":
      return { state: "ready", scan_status: scan.status, provider: scan.provider };
    case "match":
      return {
        state: "quarantined",
        provider: scan.provider,
        match_id: scan.match_id,
        reason: "csam_scan",
      };
    case "unavailable":
      return { state: "retry", retry_after_seconds: Math.max(30, scan.retry_after_seconds) };
  }
}

/**
 * 命中 CSAM（扫描命中或员工手动标记）后必须完成的动作。所有动作在同一个事务中登记，
 * 由 worker 依次执行；每一步都写审计日志。
 */
export const CSAM_INCIDENT_STEPS = [
  /** 上传状态改为 quarantined；如果已被 Release 引用，相关 Release 走 tombstone 级联。 */
  "quarantine_upload",
  /** 原件复制到证据桶（与 GC 隔离，保留到报告后 1 年），然后从可分发桶中删除。 */
  "preserve_evidence",
  /** 锁定上传者账号并吊销全部会话与 Token。 */
  "lock_account",
  /** 把内容哈希加入黑名单，阻止重新上传或发布。 */
  "block_digest",
  /** 创建事件工单，通知 legal 角色尽快向 NCMEC 报告。不向上传者说明具体原因。 */
  "open_incident",
] as const;
export type CsamIncidentStep = (typeof CSAM_INCIDENT_STEPS)[number];
