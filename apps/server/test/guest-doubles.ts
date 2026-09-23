/**
 * 访客验证测试用的替身：
 *
 * - Turnstile siteverify：本地 HTTP 服务，按 Cloudflare 的协议实现——接收
 *   `application/x-www-form-urlencoded` 的 secret / response / remoteip，返回
 *   `{ success, hostname, action, "error-codes" }`；token 只能使用一次，第二次返回
 *   `timeout-or-duplicate`；secret 不对返回 `invalid-input-secret`。
 * - 邮件：把发出的邮件留在内存里，测试从正文中取出验证链接。
 *
 * 测试不访问任何外部网络。
 */
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { EmailMessage, EmailSender } from "../src/auth/email.js";

interface IssuedToken {
  hostname: string;
  action: string;
  used: boolean;
}

export interface SiteverifyCall {
  secret: string;
  response: string;
  remoteip: string | undefined;
}

export interface TurnstileStub {
  endpoint: string;
  secret: string;
  /** 签发一个 widget token（默认 hostname 为 www.char.pub，action 为 guest_verification）。 */
  issue(opts?: { hostname?: string; action?: string }): string;
  /** 下一次请求返回这个 HTTP 状态码（模拟 Cloudflare 故障）。 */
  failNext(status: number): void;
  /** 下一次请求延迟这么多毫秒再响应（模拟超时）。 */
  delayNext(ms: number): void;
  calls: SiteverifyCall[];
  close(): Promise<void>;
}

export async function startTurnstileStub(): Promise<TurnstileStub> {
  const secret = randomBytes(16).toString("hex");
  const tokens = new Map<string, IssuedToken>();
  const calls: SiteverifyCall[] = [];
  let failStatus: number | null = null;
  let delayMs = 0;

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const reply = () => {
        if (failStatus !== null) {
          const status = failStatus;
          failStatus = null;
          res.writeHead(status).end();
          return;
        }
        if (req.method !== "POST" || req.url !== "/turnstile/v0/siteverify") {
          res.writeHead(404).end();
          return;
        }
        const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
        const call = {
          secret: form.get("secret") ?? "",
          response: form.get("response") ?? "",
          remoteip: form.get("remoteip") ?? undefined,
        };
        calls.push(call);
        const send = (body: Record<string, unknown>) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(body));
        };
        if (call.secret !== secret) {
          send({ success: false, "error-codes": ["invalid-input-secret"] });
          return;
        }
        const t = tokens.get(call.response);
        if (!t) {
          send({ success: false, "error-codes": ["invalid-input-response"] });
          return;
        }
        if (t.used) {
          send({ success: false, "error-codes": ["timeout-or-duplicate"] });
          return;
        }
        t.used = true;
        send({
          success: true,
          challenge_ts: new Date().toISOString(),
          hostname: t.hostname,
          "error-codes": [],
          action: t.action,
          cdata: "",
        });
      };
      if (delayMs > 0) {
        const ms = delayMs;
        delayMs = 0;
        setTimeout(reply, ms);
      } else {
        reply();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    endpoint: `http://127.0.0.1:${port}/turnstile/v0/siteverify`,
    secret,
    issue(opts = {}) {
      const token = `XXXX.DUMMY.${randomBytes(24).toString("base64url")}`;
      tokens.set(token, {
        hostname: opts.hostname ?? "www.char.pub",
        action: opts.action ?? "guest_verification",
        used: false,
      });
      return token;
    },
    failNext(status) {
      failStatus = status;
    },
    delayNext(ms) {
      delayMs = ms;
    },
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** 把邮件留在内存里的发信器。`failNext()` 让下一封发送失败。 */
export class MemoryEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  private fail = false;

  failNext(): void {
    this.fail = true;
  }

  async send(message: EmailMessage): Promise<void> {
    if (this.fail) {
      this.fail = false;
      throw new Error("smtp unavailable");
    }
    this.sent.push(message);
  }

  /** 发给某个地址的最后一封邮件里的验证 token。 */
  lastToken(to: string): string {
    const m = [...this.sent].reverse().find((x) => x.to === to);
    const token = m?.text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
    if (!token) throw new Error(`no verification email for ${to}`);
    return token;
  }
}
