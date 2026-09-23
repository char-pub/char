/**
 * Registry API 客户端。所有请求都带 session cookie（`credentials: "include"`），响应用
 * `@char-pub/contracts` 的 schema 解析；错误统一变成 `ApiError`，带服务端的稳定 `code`。
 *
 * 线上 API 在 `api.char.pub`；本地开发时 `VITE_API_BASE_URL` 留空，请求走同源的 `/v1`，
 * 由 Vite 的代理转发到本机的 API 进程，这样 cookie 与线上一样只属于 API 所在的源。
 * 凭据只存在于 HttpOnly cookie 中，前端代码既读不到也不保存任何 token。
 */
import {
  CreateTokenResponseSchema,
  CreateUploadResponseSchema,
  CreationDetailSchema,
  CreationSummarySchema,
  DependentSchema,
  DraftSchema,
  type Me,
  MeSchema,
  MyCreationsResponseSchema,
  NamespaceSchema,
  PublishResponseSchema,
  PutDraftResponseSchema,
  ReleaseDetailSchema,
  RevisionSchema,
  type TOKEN_SCOPES,
  UploadStatusSchema,
} from "@char-pub/contracts";
import {
  type ContextIR,
  ContextIRSchema,
  type CreationType,
  CreationTypeSchema,
  type Digest,
} from "@char-pub/core";
import { z } from "zod";

const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;

/** API 的源。空字符串表示与页面同源（本地开发与端到端测试）。 */
export const API_BASE_URL: string = (
  configured ?? (import.meta.env.DEV ? "" : "https://api.char.pub")
).replace(/\/+$/, "");

/** API 返回的错误。`code` 是稳定的机器可读代码，界面按它决定提示。 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string | undefined;
  /** problem+json 中的其他字段，例如 `diagnostics`、`reason`。 */
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, detail?: string, extra: Record<string, unknown> = {}) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.extra = extra;
  }
}

export function isApiError(e: unknown, code?: string): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code);
}

const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), next_cursor: z.string().nullable() });

export const SearchPageSchema = pageOf(CreationSummarySchema);
export type SearchPage = z.infer<typeof SearchPageSchema>;
export const DependentsPageSchema = pageOf(DependentSchema);
export type DependentsPage = z.infer<typeof DependentsPageSchema>;

const ReportResponseSchema = PublishResponseSchema.extend({ label: z.string() });
export type PublishReportResponse = z.infer<typeof ReportResponseSchema>;
export type PublishResponse = z.infer<typeof PublishResponseSchema>;
export type Draft = z.infer<typeof DraftSchema>;
export type PutDraftResponse = z.infer<typeof PutDraftResponseSchema>;
export type Revision = z.infer<typeof RevisionSchema>;
export type UploadStatus = z.infer<typeof UploadStatusSchema>;
export type CreateUploadResponse = z.infer<typeof CreateUploadResponseSchema>;
export type {
  CreationDetail,
  CreationSummary,
  Dependent,
  Me,
  MyCreation,
  ReleaseDetail,
  ReleaseSummary,
} from "@char-pub/contracts";

export const TokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  expires_at: z.string().nullable(),
  last_used_at: z.string().nullable(),
  created_at: z.string(),
});
export type PersonalToken = z.infer<typeof TokenSchema>;
export type TokenScope = (typeof TOKEN_SCOPES)[number];
export type CreatedToken = z.infer<typeof CreateTokenResponseSchema>;

export interface SearchParams {
  q?: string | undefined;
  type?: CreationType | undefined;
  tag?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

/** CCv3 导出：服务端按需构建，没有完成时返回 202 与建议的等待秒数。 */
export type ExportState =
  | { state: "building"; retryAfter: number }
  | { state: "ready"; url: string };

export interface RegistryClient {
  me(): Promise<Me | null>;
  updateSettings(body: { show_mature: boolean; confirm_adult?: boolean }): Promise<Me>;
  myCreations(): Promise<z.infer<typeof MyCreationsResponseSchema>>;
  tokens(): Promise<{ items: PersonalToken[] }>;
  /** 新 Token 的明文只在这次响应里出现一次。 */
  createToken(body: {
    name: string;
    scopes: TokenScope[];
    expires_in_days: number;
  }): Promise<CreatedToken>;
  revokeToken(id: string): Promise<void>;
  search(params: SearchParams): Promise<SearchPage>;
  creation(ns: string, name: string): Promise<z.infer<typeof CreationDetailSchema>>;
  release(ns: string, name: string, label: string): Promise<z.infer<typeof ReleaseDetailSchema>>;
  /** 读取 Release 的 Context IR。public Release 从公共 CDN 读取，不带 cookie。 */
  getIR(ns: string, name: string, label: string, opts?: { private?: boolean }): Promise<ContextIR>;
  dependents(ns: string, name: string): Promise<DependentsPage>;
  exportCcv3(ns: string, name: string, label: string): Promise<ExportState>;
  createNamespace(slug: string): Promise<z.infer<typeof NamespaceSchema>>;
  createCreation(
    ns: string,
    body: { name: string; type: CreationType; display_name: string },
  ): Promise<{ id: string; ref: string; type: CreationType }>;
  draft(ns: string, name: string): Promise<Draft>;
  /** 保存草稿。`version` 是读到的版本号，服务端据此做乐观锁，冲突时抛出 409。 */
  putDraft(ns: string, name: string, version: number, working: unknown): Promise<PutDraftResponse>;
  createRevision(ns: string, name: string, message?: string): Promise<Revision>;
  /** 发布。`idempotencyKey` 在同一次发布的重试之间保持不变。 */
  publish(
    ns: string,
    name: string,
    body: { revision: string; label: string; visibility: "public" | "private" },
    idempotencyKey: string,
  ): Promise<PublishResponse>;
  publishReport(ns: string, name: string, label: string): Promise<PublishReportResponse>;
  createUpload(body: {
    purpose: "asset" | "import";
    content_type: string;
    size: number;
    sha256: Digest;
  }): Promise<CreateUploadResponse>;
  /** 把文件直接 PUT 到对象存储的预签名地址，不经过 API。 */
  putUpload(target: CreateUploadResponse, body: Blob): Promise<void>;
  completeUpload(id: string): Promise<UploadStatus>;
  upload(id: string): Promise<UploadStatus>;
}

/** 路径中的 `@ns/name` 片段。 */
export function creationPath(ns: string, name: string): string {
  return `/v1/creations/@${encodeURIComponent(ns)}/${encodeURIComponent(name)}`;
}

/** IR 的下载地址（浏览器直接打开，由 API 302 到内容寻址的对象）。 */
export function irDownloadUrl(ns: string, name: string, label: string, base = API_BASE_URL) {
  return `${base}${creationPath(ns, name)}/releases/${encodeURIComponent(label)}/ir`;
}

export function ccv3DownloadUrl(ns: string, name: string, label: string, base = API_BASE_URL) {
  return `${base}${creationPath(ns, name)}/releases/${encodeURIComponent(label)}/export/ccv3`;
}

async function problemOf(res: Response): Promise<ApiError> {
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // 不是 JSON（例如代理返回的错误页）：只保留状态码。
  }
  const { code, detail, type: _t, title: _ti, status: _s, instance: _i, ...extra } = body;
  return new ApiError(
    res.status,
    typeof code === "string" ? code : `http.${res.status}`,
    typeof detail === "string" ? detail : undefined,
    extra,
  );
}

export function createRegistryClient(
  opts: { baseUrl?: string; fetch?: typeof fetch } = {},
): RegistryClient {
  const base = opts.baseUrl ?? API_BASE_URL;
  const doFetch = opts.fetch ?? ((input, init) => fetch(input, init));

  async function send(
    method: string,
    path: string,
    init: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { accept: "application/json", ...init.headers };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers,
        credentials: "include",
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    } catch {
      throw new ApiError(0, "network.unreachable", "could not reach the registry");
    }
    if (!res.ok) throw await problemOf(res);
    return res;
  }

  async function json<T extends z.ZodType>(
    schema: T,
    method: string,
    path: string,
    init?: { body?: unknown; headers?: Record<string, string> },
  ): Promise<z.infer<T>> {
    const res = await send(method, path, init);
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) {
      throw new ApiError(res.status, "response.invalid", parsed.error.issues[0]?.message);
    }
    return parsed.data;
  }

  const release = (ns: string, name: string, label: string) =>
    `${creationPath(ns, name)}/releases/${encodeURIComponent(label)}`;

  return {
    async me() {
      try {
        return await json(MeSchema, "GET", "/v1/me");
      } catch (e) {
        if (isApiError(e) && e.status === 401) return null;
        throw e;
      }
    },
    updateSettings: (body) => json(MeSchema, "PUT", "/v1/me/settings", { body }),
    myCreations: () => json(MyCreationsResponseSchema, "GET", "/v1/me/creations"),
    tokens: () => json(z.object({ items: z.array(TokenSchema) }), "GET", "/v1/me/tokens"),
    createToken: (body) => json(CreateTokenResponseSchema, "POST", "/v1/me/tokens", { body }),
    async revokeToken(id) {
      await send("DELETE", `/v1/me/tokens/${encodeURIComponent(id)}`);
    },
    search(params) {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== "") q.set(k, String(v));
      }
      const qs = q.toString();
      return json(SearchPageSchema, "GET", `/v1/search${qs ? `?${qs}` : ""}`);
    },
    creation: (ns, name) => json(CreationDetailSchema, "GET", creationPath(ns, name)),
    release: (ns, name, label) => json(ReleaseDetailSchema, "GET", release(ns, name, label)),
    async getIR(ns, name, label, o = {}) {
      let res: Response;
      try {
        // public 的 IR 会被重定向到公共 CDN：跨源重定向时不能带 cookie，也不需要。
        res = await doFetch(irDownloadUrl(ns, name, label, base), {
          headers: { accept: "application/json" },
          credentials: o.private ? "include" : "omit",
        });
      } catch {
        throw new ApiError(0, "network.unreachable", "could not load the context");
      }
      if (!res.ok) throw await problemOf(res);
      const parsed = ContextIRSchema.safeParse(await res.json());
      if (!parsed.success) {
        throw new ApiError(res.status, "response.invalid", parsed.error.issues[0]?.message);
      }
      return parsed.data;
    },
    dependents: (ns, name) =>
      json(DependentsPageSchema, "GET", `${creationPath(ns, name)}/dependents?limit=50`),
    async exportCcv3(ns, name, label) {
      const url = ccv3DownloadUrl(ns, name, label, base);
      let res: Response;
      try {
        // 构建完成后 API 返回 302：不跟随重定向，只确认已经就绪，下载交给浏览器导航。
        res = await doFetch(url, { credentials: "include", redirect: "manual" });
      } catch {
        throw new ApiError(0, "network.unreachable", "could not reach the registry");
      }
      if (res.status === 202) {
        const retry = Number(res.headers.get("retry-after") ?? "5");
        return { state: "building", retryAfter: Number.isFinite(retry) && retry > 0 ? retry : 5 };
      }
      if (res.type === "opaqueredirect" || res.ok || (res.status >= 300 && res.status < 400)) {
        return { state: "ready", url };
      }
      throw await problemOf(res);
    },
    createNamespace: (slug) => json(NamespaceSchema, "POST", "/v1/namespaces", { body: { slug } }),
    createCreation: (ns, body) =>
      json(
        z.object({ id: z.string(), ref: z.string(), type: CreationTypeSchema }),
        "POST",
        `/v1/namespaces/${encodeURIComponent(ns)}/creations`,
        { body },
      ),
    draft: (ns, name) => json(DraftSchema, "GET", `${creationPath(ns, name)}/draft`),
    putDraft: (ns, name, version, working) =>
      json(PutDraftResponseSchema, "PUT", `${creationPath(ns, name)}/draft`, {
        body: { working },
        headers: { "if-match": `"${version}"` },
      }),
    createRevision: (ns, name, message) =>
      json(RevisionSchema, "POST", `${creationPath(ns, name)}/revisions`, {
        body: message ? { message } : {},
      }),
    publish: (ns, name, body, key) =>
      json(PublishResponseSchema, "POST", `${creationPath(ns, name)}/releases`, {
        body,
        headers: { "idempotency-key": key },
      }),
    publishReport: (ns, name, label) =>
      json(ReportResponseSchema, "GET", `${release(ns, name, label)}/report`),
    createUpload: (body) => json(CreateUploadResponseSchema, "POST", "/v1/uploads", { body }),
    async putUpload(target, body) {
      let res: Response;
      try {
        res = await doFetch(target.put_url, { method: "PUT", headers: target.headers, body });
      } catch {
        throw new ApiError(0, "upload.failed", "could not upload the file");
      }
      if (!res.ok) throw new ApiError(res.status, "upload.failed", "the storage rejected the file");
    },
    completeUpload: (id) =>
      json(UploadStatusSchema, "POST", `/v1/uploads/${encodeURIComponent(id)}/complete`, {
        body: {},
      }),
    upload: (id) => json(UploadStatusSchema, "GET", `/v1/uploads/${encodeURIComponent(id)}`),
  };
}
