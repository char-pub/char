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
  type DownloadedFile,
  type EvidenceMeta,
  type FailedJob,
  type Flag,
  type FlagKey,
  type GuestAdminView,
  type LegalRequest,
  type LegalRequestDetail,
  type Me,
  type NamespaceAdminView,
  type PendingApproval,
  type QueueStats,
  type Report,
  type ReservedName,
  type RestoreResult,
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

  /** 下载类接口：返回文件内容与响应头，由调用方交给浏览器保存。 */
  async function download(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<DownloadedFile & { headers: Headers }> {
    const res = await f(path.startsWith("http") ? path : `${base}${path}`, {
      method,
      credentials: "include",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      const p = (await res.json().catch(() => ({}))) as { code?: string; detail?: string };
      throw new ApiError(res.status, p.code ?? `http.${res.status}`, p.detail);
    }
    const disposition = res.headers.get("content-disposition") ?? "";
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "download";
    return { blob: await res.blob(), filename, headers: res.headers };
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
    exportAudit: async (input) => {
      const { headers, ...file } = await download("POST", "/v1/admin/audit/export", input);
      return { ...file, next_before: headers.get("x-next-before") };
    },

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
    revokeCredentials: (id, input) =>
      call<{ sessions_revoked: number; tokens_revoked: number }>(
        "POST",
        `/v1/admin/users/${enc(id)}/revoke`,
        input,
      ),
    setUploadLock: async (id, input) => {
      await call("POST", `/v1/admin/users/${enc(id)}/upload-lock`, input);
    },
    listGuests: (q) =>
      list<GuestAdminView>(`/v1/admin/guests${qs({ status: q.status, query: q.query })}`),
    getGuest: (id) => call<GuestAdminView>("GET", `/v1/admin/guests/${enc(id)}`),
    disableGuest: async (id, input) => {
      await call("POST", `/v1/admin/guests/${enc(id)}/disable`, input);
    },
    enableGuest: async (id, input) => {
      await call("POST", `/v1/admin/guests/${enc(id)}/enable`, input);
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
    transferNamespace: (slug, input) =>
      call<{ approval: PendingApproval }>(
        "POST",
        `/v1/admin/namespaces/${enc(slug)}/transfer`,
        input,
      ),
    listLegalRequests: () => list<LegalRequest>("/v1/admin/legal-requests"),
    getLegalRequest: (id) => call<LegalRequestDetail>("GET", `/v1/admin/legal-requests/${enc(id)}`),
    createLegalRequest: (input) => call<{ id: string }>("POST", "/v1/admin/legal-requests", input),
    disableAccess: (id, input) =>
      call<{ hidden: number }>("POST", `/v1/admin/legal-requests/${enc(id)}/disable-access`, input),
    registerCounterNotice: (id, input) =>
      call<{ restore_not_before: string; restore_deadline: string }>(
        "POST",
        `/v1/admin/legal-requests/${enc(id)}/counter-notice`,
        input,
      ),
    recordCourtAction: async (id, input) => {
      await call("POST", `/v1/admin/legal-requests/${enc(id)}/court-action`, input);
    },
    restoreLegal: (id, input) =>
      call<RestoreResult>("POST", `/v1/admin/legal-requests/${enc(id)}/restore`, input),
    exportLegalCase: async (id, input) => {
      const { headers: _h, ...file } = await download(
        "POST",
        `/v1/admin/legal-requests/${enc(id)}/export`,
        input,
      );
      return file;
    },
    listCsamIncidents: () => list<CsamIncident>("/v1/admin/csam-incidents"),
    flagCsam: (input) => call<CsamFlagResult>("POST", "/v1/admin/csam/flag", input),
    reportCsamIncident: async (id, input) => {
      await call("POST", `/v1/admin/csam-incidents/${enc(id)}/report`, input);
    },
    getEvidence: (id) => call<EvidenceMeta>("GET", `/v1/admin/csam-incidents/${enc(id)}/evidence`),
    downloadEvidence: async (id, input) => {
      const ticket = await call<{ url: string }>(
        "POST",
        `/v1/admin/csam-incidents/${enc(id)}/evidence/download`,
        input,
      );
      const { headers: _h, ...file } = await download("GET", ticket.url);
      return file;
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
    signOutStaff: (userId, input) =>
      call<{ sessions_revoked: number; access: "revoked" | "failed" | "not_configured" }>(
        "POST",
        `/v1/admin/staff/${enc(userId)}/sign-out`,
        input,
      ),
  };
}
