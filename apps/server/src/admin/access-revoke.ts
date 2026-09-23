/**
 * 吊销某个员工在 Cloudflare Access 上的全部会话（Access API 的 revoke_user 接口）。
 * 吊销后该员工再次访问 admin 时必须重新通过 Access 登录。
 *
 * 需要的 API Token 权限：Access: Organizations, Identity Providers, and Groups（Edit）。
 * 没有配置时只吊销应用内的会话，调用方在响应中注明 Access 会话没有吊销。
 */

export type AccessRevokeResult = "revoked" | "failed";
export type AccessRevoker = (email: string) => Promise<AccessRevokeResult>;

const TIMEOUT_MS = 10_000;

export function cloudflareAccessRevoker(opts: {
  accountId: string;
  apiToken: string;
  fetch?: typeof fetch;
  apiBase?: string;
}): AccessRevoker {
  const f = opts.fetch ?? fetch;
  const base = (opts.apiBase ?? "https://api.cloudflare.com/client/v4").replace(/\/+$/, "");
  const url = `${base}/accounts/${encodeURIComponent(opts.accountId)}/access/organizations/revoke_user`;
  return async (email) => {
    try {
      const res = await f(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return "failed";
      const json = (await res.json().catch(() => null)) as { success?: unknown } | null;
      return json?.success === true ? "revoked" : "failed";
    } catch {
      return "failed";
    }
  };
}
