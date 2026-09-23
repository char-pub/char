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
  type CreationAdminView,
  type CsamFlagResult,
  type CsamIncident,
  type FailedJob,
  type Flag,
  type FlagKey,
  type LegalRequest,
  type LegalRequestDetail,
  type Me,
  type NamespaceAdminView,
  type PendingApproval,
  type QueueStats,
  type Report,
  type ReservedName,
  type StaffMember,
  type TombstonePreview,
  type UserAdminView,
  type UserDetail,
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

  const list = async <T>(path: string) => (await call<{ items: T[] }>("GET", path)).items;
  const qs = (q: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const enc = encodeURIComponent;

  return {
    me: () => call<Me>("GET", "/v1/admin/me"),
    listFlags: async () => (await call<{ flags: Flag[] }>("GET", "/v1/admin/flags")).flags,
    setFlag: async (key: FlagKey, input) => {
      await call("PUT", `/v1/admin/flags/${enc(key)}`, input);
    },
    listAudit: (q) =>
      call<AuditPage>(
        "GET",
        `/v1/admin/audit${qs({ before: q.before, subject: q.subject, limit: q.limit ? String(q.limit) : undefined })}`,
      ),
    verifyAudit: () => call<AuditVerify>("GET", "/v1/admin/audit/verify"),

    listReports: () => list<Report>("/v1/admin/reports"),
    claimReport: async (id, input) => {
      await call("POST", `/v1/admin/reports/${enc(id)}/claim`, input);
    },
    actOnReport: async (id, input) => {
      await call("POST", `/v1/admin/reports/${enc(id)}/actions`, input);
    },
    // `@ns/name` 中的 `/` 是路径的一部分，不能编码。
    getCreation: (ref) =>
      call<CreationAdminView>("GET", `/v1/admin/creations/${ref.replace(/^\/+/, "")}`),
    hideCreation: async (id, input) => {
      await call("POST", `/v1/admin/creations/${enc(id)}/visibility`, input);
    },
    forceRating: async (id, input) => {
      await call("POST", `/v1/admin/creations/${enc(id)}/rating`, input);
    },
    yankRelease: async (id, input) => {
      await call("POST", `/v1/admin/releases/${enc(id)}/yank`, input);
    },
    previewTombstone: (subject) =>
      call<TombstonePreview>("POST", "/v1/admin/tombstones/preview", { subject }),
    requestTombstone: async (input) => {
      const r = await call<{ executed: boolean; approval?: PendingApproval }>(
        "POST",
        "/v1/admin/tombstones",
        input,
      );
      return r.executed || !r.approval
        ? { executed: true as const }
        : { executed: false as const, approval: r.approval };
    },
    listApprovals: () => list<PendingApproval>("/v1/admin/approvals"),
    confirmApproval: async (id, input) => {
      await call("POST", `/v1/admin/approvals/${enc(id)}/confirm`, input);
    },
    cancelApproval: async (id, input) => {
      await call("POST", `/v1/admin/approvals/${enc(id)}/cancel`, input);
    },
    listUsers: (q) => list<UserAdminView>(`/v1/admin/users${qs({ query: q.query })}`),
    getUser: (id) => call<UserDetail>("GET", `/v1/admin/users/${enc(id)}`),
    banUser: async (id, input) => {
      await call("POST", `/v1/admin/users/${enc(id)}/ban`, input);
    },
    unbanUser: async (id, input) => {
      const r = await call<{ approval?: PendingApproval }>(
        "POST",
        `/v1/admin/users/${enc(id)}/unban`,
        input,
      );
      return r.approval ? { approval: r.approval } : {};
    },
    listNamespaces: (q) =>
      list<NamespaceAdminView>(`/v1/admin/namespaces${qs({ query: q.query })}`),
    listReserved: () => list<ReservedName>("/v1/admin/reserved-names"),
    addReserved: async (input) => {
      await call("POST", "/v1/admin/reserved-names", input);
    },
    removeReserved: async (slug, input) => {
      await call("DELETE", `/v1/admin/reserved-names/${enc(slug)}`, input);
    },
    setNamespaceStatus: async (slug, input) => {
      await call("POST", `/v1/admin/namespaces/${enc(slug)}/status`, input);
    },
    renameNamespace: async (slug, input) => {
      await call("POST", `/v1/admin/namespaces/${enc(slug)}/rename`, input);
    },
    listLegalRequests: () => list<LegalRequest>("/v1/admin/legal-requests"),
    getLegalRequest: (id) => call<LegalRequestDetail>("GET", `/v1/admin/legal-requests/${enc(id)}`),
    createLegalRequest: (input) => call<{ id: string }>("POST", "/v1/admin/legal-requests", input),
    listCsamIncidents: () => list<CsamIncident>("/v1/admin/csam-incidents"),
    flagCsam: (input) => call<CsamFlagResult>("POST", "/v1/admin/csam/flag", input),
    reportCsamIncident: async (id, input) => {
      await call("POST", `/v1/admin/csam-incidents/${enc(id)}/report`, input);
    },
    listQueues: () => list<QueueStats>("/v1/admin/queues"),
    listFailedJobs: () => list<FailedJob>("/v1/admin/jobs/failed"),
    retryJob: async (id, input) => {
      await call("POST", `/v1/admin/jobs/${enc(id)}/retry`, input);
    },
    cancelJob: async (id, input) => {
      await call("POST", `/v1/admin/jobs/${enc(id)}/cancel`, input);
    },
    listStaff: () => list<StaffMember>("/v1/admin/staff"),
    setStaffRoles: async (userId, input) => {
      const r = await call<{ approval?: PendingApproval }>(
        "PUT",
        `/v1/admin/staff/${enc(userId)}`,
        input,
      );
      return r.approval ? { approval: r.approval } : {};
    },
  };
}
