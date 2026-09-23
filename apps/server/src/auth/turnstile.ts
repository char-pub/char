/**
 * Cloudflare Turnstile 的服务端校验。
 *
 * 浏览器里的 Turnstile widget 给出一个一次性 token，服务端把它连同 secret 发到 siteverify
 * 接口换取结论。只有同时满足下面几条才算通过，任何一条不满足、网络错误或超时都按失败处理：
 * - `success` 为 true；
 * - `hostname`（widget 所在页面的域名）在允许列表中，防止别的站点嵌入我们的 site key 代刷；
 * - `action` 与调用方期望的一致，防止把一个表单的 token 拿到另一个表单上用。
 *
 * Cloudflare 公开的测试密钥（例如“始终通过”的 secret）返回固定的 hostname，不带 action，
 * 并在 `metadata.result_with_testing_key` 中标明。这样的结果只在本地开发时接受（跳过
 * hostname 与 action 检查）；其他环境一律拒绝，免得线上误配了测试密钥之后校验形同虚设。
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
  /** 是否接受 Cloudflare 测试密钥给出的结果。只在本地开发时开启。 */
  allowTestingKeys?: boolean;
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
  metadata: z.looseObject({ result_with_testing_key: z.boolean().optional() }).optional(),
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
    if (r.metadata?.result_with_testing_key === true) {
      return this.opts.allowTestingKeys ? { ok: true } : { ok: false, reason: "testing-key" };
    }
    if (!r.hostname || !this.hostnames.has(r.hostname.toLowerCase())) {
      return { ok: false, reason: "hostname-mismatch" };
    }
    if (r.action !== this.opts.action) return { ok: false, reason: "action-mismatch" };
    return { ok: true };
  }
}
