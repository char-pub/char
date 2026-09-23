import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { apiBaseFor } from "./api-env";
import { createHttpApi } from "./http-api";
import { createMockApi, VIEWER_ME } from "./mock-api";

describe("http api", () => {
  it("sends credentials and parses problem+json errors", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (init.method === "PUT") {
        return new Response(JSON.stringify({ code: "admin.reason_required", status: 422 }), {
          status: 422,
        });
      }
      return new Response(
        JSON.stringify({
          flags: [{ key: "uploads", enabled: true, reason: null, updated_at: null }],
        }),
      );
    }) as typeof fetch;
    const api = createHttpApi("https://admin-api.char.pub/", f);
    expect(await api.listFlags()).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://admin-api.char.pub/v1/admin/flags");
    expect(calls[0]?.init.credentials).toBe("include");
    await expect(api.setFlag("uploads", { enabled: false, reason: "x" })).rejects.toMatchObject({
      status: 422,
      code: "admin.reason_required",
    });
  });

  it("unwraps list responses and builds paths for every endpoint", async () => {
    const seen: string[] = [];
    const f = (async (url: string, init: RequestInit) => {
      seen.push(`${init.method} ${new URL(url).pathname}${new URL(url).search}`);
      if (url.endsWith("/tombstones")) {
        return new Response(JSON.stringify({ executed: false, approval: { id: "ap1" } }), {
          status: 202,
        });
      }
      return new Response(JSON.stringify({ items: [{ id: "x" }] }));
    }) as typeof fetch;
    const api = createHttpApi("https://admin-api.char.pub", f);
    expect(await api.listReports()).toEqual([{ id: "x" }]);
    await api.getCreation("@djj/alice");
    await api.listUsers({ query: "sam" });
    await api.retryJob("job 1", { reason: "retry after fix" });
    const t = await api.requestTombstone({
      subject: "fragment:sha256:aa",
      reason_code: "policy.illegal",
      reason: "illegal content",
    });
    expect(t).toEqual({ executed: false, approval: { id: "ap1" } });
    expect(seen).toEqual([
      "GET /v1/admin/reports",
      "GET /v1/admin/creations/@djj/alice",
      "GET /v1/admin/users?query=sam",
      "POST /v1/admin/jobs/job%201/retry",
      "POST /v1/admin/tombstones",
    ]);
    await expect(
      createHttpApi(
        "https://x",
        (async () => new Response("{}", { status: 500 })) as typeof fetch,
      ).listQueues(),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("builds audit queries", async () => {
    let seen = "";
    const f = (async (url: string) => {
      seen = url;
      return new Response(JSON.stringify({ items: [], next_before: null }));
    }) as typeof fetch;
    await createHttpApi("", f).listAudit({ subject: "flag:uploads", before: "10", limit: 5 });
    expect(seen).toBe("/v1/admin/audit?before=10&subject=flag%3Auploads&limit=5");
  });

  it("picks the admin api for each environment", () => {
    expect(apiBaseFor("admin.char.pub")).toBe("https://admin-api.char.pub");
    expect(apiBaseFor("staging-admin.char.pub")).toBe("https://staging-admin-api.char.pub");
    expect(apiBaseFor("localhost")).toBe("");
    expect(apiBaseFor("admin.char.pub", "https://x.example")).toBe("https://x.example");
  });
});

describe("mock api mirrors backend rules", () => {
  it("rejects short reasons and missing capabilities", async () => {
    await expect(
      createMockApi().setFlag("uploads", { enabled: false, reason: "short" }),
    ).rejects.toMatchObject({
      code: "admin.reason_required",
    });
    await expect(
      createMockApi({ me: VIEWER_ME }).setFlag("uploads", {
        enabled: false,
        reason: "long enough reason",
      }),
    ).rejects.toMatchObject({ code: "admin.forbidden" });
  });

  it("routes CSAM-locked unbans through four-eyes approval", async () => {
    const api = createMockApi({ now: () => new Date("2026-09-22T00:00:00Z") });
    const r = await api.unbanUser("u_locked", { reason: "false positive confirmed" });
    expect(r.approval?.kind).toBe("unban.csam");
    await expect(
      api.confirmApproval(r.approval?.id ?? "", { reason: "confirming my own request" }),
    ).rejects.toMatchObject({
      code: "admin.cooling_off",
    });
  });
});
