/**
 * Cloudflare Turnstile 的服务端校验。
 *
 * 浏览器里的 Turnstile widget 给出一个一次性 token，服务端把它连同 secret 发到 siteverify
 * 接口换取结论。只有同时满足下面几条才算通过，任何一条不满足、网络错误或超时都按失败处理：
 * - `success` 为 true；
 * - `hostname`（widget 所在页面的域名）在允许列表中，防止别的站点嵌入我们的 site key 代刷；
 * - `action` 与调用方期望的一致，防止把一个表单的 token 拿到另一个表单上用。
 */
import { z } from "zod";

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Turnstile token 的最大长度（Cloudflare 文档给出的上限）。 */
export const MAX_TURNSTILE_TOKEN_LENGTH = 2048;

export type TurnstileResult = { ok: true } | { ok: false; reason: string };

export interface TurnstileVerifier {
  /** 校验一个 token。`remoteIp` 是客户端 IP，可选，只转发给 Cloudflare。 */
  verify(token: string, remoteIp?: string): Promise<TurnstileResult>;
}

export interface CloudflareTurnstileOptions {
  secret: string;
  /** widget 允许出现的页面域名，例如 `www.char.pub`。 */
  allowedHostnames: readonly string[];
  /** 前端渲染 widget 时声明的 action。 */
  action: string;
  /** siteverify 地址；测试时指向本地替身。 */
  endpoint?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const SiteverifyResponseSchema = z.looseObject({
  success: z.boolean(),
  hostname: z.string().optional(),
  action: z.string().optional(),
  "error-codes": z.array(z.string()).optional(),
});

export class CloudflareTurnstile implements TurnstileVerifier {
  private readonly hostnames: ReadonlySet<string>;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: CloudflareTurnstileOptions) {
    if (opts.secret.length === 0) throw new Error("turnstile secret is empty");
    if (opts.allowedHostnames.length === 0) throw new Error("turnstile needs allowed hostnames");
    this.hostnames = new Set(opts.allowedHostnames.map((h) => h.toLowerCase()));
    this.endpoint = opts.endpoint ?? SITEVERIFY_URL;
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  async verify(token: string, remoteIp?: string): Promise<TurnstileResult> {
    if (token.length === 0 || token.length > MAX_TURNSTILE_TOKEN_LENGTH) {
      return { ok: false, reason: "invalid-input-response" };
    }
    const form = new URLSearchParams({ secret: this.opts.secret, response: token });
    if (remoteIp) form.set("remoteip", remoteIp);
    let raw: unknown;
    try {
      const res = await this.fetchImpl(this.endpoint, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return { ok: false, reason: `http-${res.status}` };
      raw = await res.json();
    } catch {
      return { ok: false, reason: "unavailable" };
    }
    const parsed = SiteverifyResponseSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: "bad-response" };
    const r = parsed.data;
    if (!r.success) return { ok: false, reason: r["error-codes"]?.[0] ?? "rejected" };
    if (!r.hostname || !this.hostnames.has(r.hostname.toLowerCase())) {
      return { ok: false, reason: "hostname-mismatch" };
    }
    if (r.action !== this.opts.action) return { ok: false, reason: "action-mismatch" };
    return { ok: true };
  }
}
