/**
 * Playwright 用的假 Registry API：拦截生产构建默认连接的 `https://api.char.pub`，按路由表
 * 返回 JSON。页面与 API 跨源，所以响应都带上允许携带 cookie 的 CORS 头，预检请求直接放行。
 * 路由表里没有的请求返回 404 problem，并记录下来，测试可以断言没有意外的请求。
 */
import type { Page, Request } from "@playwright/test";

export const API = "https://api.char.pub";

export interface MockResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type Handler = (req: Request, url: URL) => MockResponse | Promise<MockResponse>;

export interface MockApi {
  /** 按 `METHOD /path` 注册；path 可以带 `*` 通配一个路径段。 */
  on(route: string, handler: Handler | MockResponse): void;
  /** 所有打到 API 的请求（不含预检），按顺序记录。 */
  calls: { method: string; path: string; body: unknown }[];
  unmatched: string[];
}

function matches(pattern: string, path: string): boolean {
  const re = new RegExp(
    `^${pattern
      .split("*")
      .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join("[^/]+")}$`,
  );
  return re.test(path);
}

export async function mockApi(page: Page, origin: string): Promise<MockApi> {
  const routes: { method: string; path: string; handler: Handler }[] = [];
  const api: MockApi = {
    calls: [],
    unmatched: [],
    on(route, handler) {
      const [method, path] = route.split(" ") as [string, string];
      routes.unshift({
        method,
        path,
        handler: typeof handler === "function" ? handler : () => handler,
      });
    },
  };
  const cors = {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type, if-match, idempotency-key",
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-expose-headers": "etag, retry-after",
  };
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    let body: unknown;
    try {
      body = req.postDataJSON();
    } catch {
      body = req.postData();
    }
    api.calls.push({ method: req.method(), path: url.pathname, body });
    const hit = routes.find((r) => r.method === req.method() && matches(r.path, url.pathname));
    if (!hit) {
      api.unmatched.push(`${req.method()} ${url.pathname}`);
      await route.fulfill({
        status: 404,
        headers: { ...cors, "content-type": "application/problem+json" },
        body: JSON.stringify({
          type: "about:blank",
          title: "Not Found",
          status: 404,
          code: "not_found",
        }),
      });
      return;
    }
    const res = await hit.handler(req, url);
    const status = res.status ?? 200;
    await route.fulfill({
      status,
      headers: {
        ...cors,
        "content-type": status >= 400 ? "application/problem+json" : "application/json",
        ...res.headers,
      },
      body: res.body === undefined ? "" : JSON.stringify(res.body),
    });
  });
  return api;
}

export function problem(status: number, code: string): MockResponse {
  return { status, body: { type: "about:blank", title: code, status, code } };
}

export const ME = {
  id: "usr_01j00000000000000000000000",
  name: "Test Writer",
  image: null,
  namespace: "writer",
  settings: { show_mature: false, mature_confirmed_at: null, locale: null },
};

export const OTHER = {
  ...ME,
  id: "usr_01j00000000000000000000001",
  name: "Other",
  namespace: "other",
};

export function creationDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: "cr_01j00000000000000000000000",
    ref: "@writer/mira",
    type: "character",
    display_name: "Mira",
    rating: "general",
    tags: [],
    releases: [
      {
        id: "rel_01j00000000000000000000000",
        label: "1.0.0",
        visibility: "public",
        status: "active",
        semantic_digest: `sha256:${"1".repeat(64)}`,
        effective_rating: "general",
        created_at: "2026-09-22T12:00:00.000Z",
      },
    ],
    latest_release: {
      id: "rel_01j00000000000000000000000",
      label: "1.0.0",
      visibility: "public",
      status: "active",
      semantic_digest: `sha256:${"1".repeat(64)}`,
      effective_rating: "general",
      created_at: "2026-09-22T12:00:00.000Z",
    },
    dependents_count: 0,
    contribution_policy: "anyone",
    ...overrides,
  };
}
