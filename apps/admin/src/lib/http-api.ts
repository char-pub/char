/**
 * admin-api 的 HTTP 实现。
 *
 * 浏览器请求自动携带 Cloudflare Access 的 cookie，Access 在边缘把它换成
 * `Cf-Access-Jwt-Assertion` 交给 admin 进程校验，所以这里只需要 `credentials: "include"`。
 * 写请求的 Origin 由浏览器自动带上，后端按白名单校验。
 */
import {
  type AdminApi,
  ApiError,
  type AuditPage,
  type AuditVerify,
  type Flag,
  type FlagKey,
  type Me,
} from "./api";

type Fetch = typeof fetch;

export function createHttpApi(baseUrl: string, f: Fetch = (...a) => fetch(...a)): AdminApi {
  const base = baseUrl.replace(/\/+$/, "");

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await f(`${base}${path}`, {
      method,
      credentials: "include",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const p = (json ?? {}) as { code?: string; detail?: string };
      throw new ApiError(res.status, p.code ?? `http.${res.status}`, p.detail);
    }
    return json as T;
  }

  const notYet = (name: string) => () =>
    Promise.reject(new ApiError(501, "admin.not_implemented", `${name} is not available yet`));

  return {
    me: () => call<Me>("GET", "/v1/admin/me"),
    listFlags: async () => (await call<{ flags: Flag[] }>("GET", "/v1/admin/flags")).flags,
    setFlag: async (key: FlagKey, input) => {
      await call("PUT", `/v1/admin/flags/${encodeURIComponent(key)}`, input);
    },
    listAudit: (q) => {
      const p = new URLSearchParams();
      if (q.before) p.set("before", q.before);
      if (q.subject) p.set("subject", q.subject);
      if (q.limit) p.set("limit", String(q.limit));
      const qs = p.toString();
      return call<AuditPage>("GET", `/v1/admin/audit${qs ? `?${qs}` : ""}`);
    },
    verifyAudit: () => call<AuditVerify>("GET", "/v1/admin/audit/verify"),

    listReports: notYet("listReports"),
    actOnReport: notYet("actOnReport"),
    getCreation: notYet("getCreation"),
    hideCreation: notYet("hideCreation"),
    forceRating: notYet("forceRating"),
    yankRelease: notYet("yankRelease"),
    previewTombstone: notYet("previewTombstone"),
    requestTombstone: notYet("requestTombstone"),
    listApprovals: notYet("listApprovals"),
    confirmApproval: notYet("confirmApproval"),
    listUsers: notYet("listUsers"),
    banUser: notYet("banUser"),
    unbanUser: notYet("unbanUser"),
    listNamespaces: notYet("listNamespaces"),
    listReserved: notYet("listReserved"),
    addReserved: notYet("addReserved"),
    setNamespaceStatus: notYet("setNamespaceStatus"),
    listLegalRequests: notYet("listLegalRequests"),
    listCsamIncidents: notYet("listCsamIncidents"),
    listQueues: notYet("listQueues"),
    listFailedJobs: notYet("listFailedJobs"),
    retryJob: notYet("retryJob"),
    cancelJob: notYet("cancelJob"),
  };
}
