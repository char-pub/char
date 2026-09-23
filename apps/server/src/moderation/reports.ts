/**
 * 公开举报需要的外部依赖。
 *
 * 匿名举报必须先通过 Turnstile。举报表单的 widget 使用单独的 action，服务端按它校验，
 * 这样访客验证表单拿到的 token 不能拿来提交举报，反过来也一样。IP 与访客验证一样用 HMAC
 * 处理后才进入限流 key 和举报记录，不保存明文。
 */
import type { GuestHasher } from "../auth/guest.js";
import type { TurnstileVerifier } from "../auth/turnstile.js";

/** 前端渲染举报表单的 Turnstile widget 时使用的 action。 */
export const REPORT_TURNSTILE_ACTION = "report";

export interface ReportServices {
  /** 按 `REPORT_TURNSTILE_ACTION` 校验的 Turnstile。 */
  turnstile: TurnstileVerifier;
  /** 对 IP 做 HMAC。 */
  hasher: GuestHasher;
}
