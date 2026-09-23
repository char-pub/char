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

describe("http api: newer endpoints", () => {
  it("builds method and path for every write that was added later", async () => {
    const seen: string[] = [];
    const f = (async (url: string, init: RequestInit) => {
      const u = new URL(url);
      seen.push(`${init.method} ${u.pathname}`);
      if (u.pathname.startsWith("/v1/admin/staff/")) {
        return new Response(JSON.stringify({ approval: { id: "ap9" } }), { status: 202 });
      }
      return new Response(JSON.stringify({ items: [], id: "lr9", incident_id: "i1" }));
    }) as typeof fetch;
    const api = createHttpApi("https://admin-api.char.pub", f);
    const r = { reason: "long enough reason" };
    await api.claimReport("rp1", r);
    await api.cancelApproval("ap1", r);
    await api.getUser("usr_1");
    await api.removeReserved("brand", r);
    await api.renameNamespace("old", { new_slug: "new", ...r });
    await api.getLegalRequest("lr1");
    expect(
      await api.createLegalRequest({
        kind: "dmca",
        requester: { name: "Agent" },
        received_at: "2026-09-22T00:00:00.000Z",
        subjects: ["@a/b"],
        ...r,
      }),
    ).toMatchObject({ id: "lr9" });
    await api.flagCsam({ blob_digest: `sha256:${"a".repeat(64)}`, ...r });
    await api.reportCsamIncident("inc1", { ncmec_report_id: "N-1", ...r });
    await api.listStaff();
    expect(await api.setStaffRoles("usr_2", { roles: ["viewer"], ...r })).toEqual({
      approval: { id: "ap9" },
    });
    expect(seen).toEqual([
      "POST /v1/admin/reports/rp1/claim",
      "POST /v1/admin/approvals/ap1/cancel",
      "GET /v1/admin/users/usr_1",
      "DELETE /v1/admin/reserved-names/brand",
      "POST /v1/admin/namespaces/old/rename",
      "GET /v1/admin/legal-requests/lr1",
      "POST /v1/admin/legal-requests",
      "POST /v1/admin/csam/flag",
      "POST /v1/admin/csam-incidents/inc1/report",
      "GET /v1/admin/staff",
      "PUT /v1/admin/staff/usr_2",
    ]);
  });
});

describe("mock api: rules of the full admin modules", () => {
  const reason = { reason: "long enough reason" };

  it("forced ratings may stay equal or go up, never down", async () => {
    const api = createMockApi();
    await expect(api.forceRating("cr1", { rating: "general", ...reason })).rejects.toMatchObject({
      code: "admin.rating_can_only_increase",
    });
    await api.forceRating("cr1", { rating: "teen", ...reason });
    await api.forceRating("cr1", { rating: "mature", ...reason });
    expect((await api.getCreation("@fanworks/borrowed-hero")).effective_rating).toBe("mature");
    await expect(api.forceRating("cr1", { rating: "teen", ...reason })).rejects.toMatchObject({
      code: "admin.rating_can_only_increase",
    });
  });

  it("report actions must match the subject type", async () => {
    const api = createMockApi();
    await expect(api.actOnReport("rp2", { action: "hide", ...reason })).rejects.toMatchObject({
      code: "report.subject_not_creation",
    });
    await expect(api.actOnReport("rp1", { action: "yank", ...reason })).rejects.toMatchObject({
      code: "report.subject_not_release",
    });
    await api.claimReport("rp1", reason);
    expect((await api.listReports()).find((r) => r.id === "rp1")).toMatchObject({
      status: "claimed",
      assignee: "owner@char.pub",
    });
  });

  it("never removes the last owner, even after four-eyes and the cooling-off period", async () => {
    let t = new Date("2026-09-22T00:00:00Z").getTime();
    const api = createMockApi({ now: () => new Date(t) });
    const r = await api.setStaffRoles("usr_owner", { roles: ["admin"], ...reason });
    expect(r.approval?.kind).toBe("staff.remove_owner");
    const id = r.approval?.id ?? "";
    await expect(api.confirmApproval(id, reason)).rejects.toMatchObject({
      code: "admin.cooling_off",
    });
    t += 25 * 60 * 60 * 1000;
    await expect(api.confirmApproval(id, reason)).rejects.toMatchObject({
      code: "admin.last_owner",
    });
    expect((await api.listApprovals()).some((a) => a.id === id)).toBe(true);
    expect((await api.listStaff()).find((s) => s.id === "usr_owner")?.roles).toEqual(["owner"]);
  });

  it("adding a role is direct; removing an owner from a second owner needs approval", async () => {
    const api = createMockApi();
    expect(
      await api.setStaffRoles("usr_mod", { roles: ["moderator", "owner"], ...reason }),
    ).toEqual({});
    const r = await api.setStaffRoles("usr_mod", { roles: ["moderator"], ...reason });
    expect(r.approval?.kind).toBe("staff.remove_owner");
  });

  it("renames keep the old name as a redirect and refuse taken names", async () => {
    const api = createMockApi();
    await expect(
      api.renameNamespace("alice", { new_slug: "fanworks", ...reason }),
    ).rejects.toMatchObject({ code: "namespace.taken" });
    await api.renameNamespace("alice", { new_slug: "alice-new", ...reason });
    const ns = await api.listNamespaces({});
    expect(ns.find((n) => n.slug === "alice-new")?.redirects).toEqual(["alice", "alice-old"]);
    await expect(
      api.renameNamespace("fanworks", { new_slug: "alice", ...reason }),
    ).rejects.toMatchObject({ code: "namespace.taken" });
  });

  it("audits every view of a legal request and never logs requester details", async () => {
    const api = createMockApi();
    await api.getLegalRequest("lr1");
    const { id } = await api.createLegalRequest({
      kind: "gdpr",
      requester: { name: "Private Person", email: "person@example.org" },
      received_at: "2026-09-22T00:00:00.000Z",
      subjects: ["@alice/diary"],
      ...reason,
    });
    const audit = (await api.listAudit({})).items;
    expect(audit.some((a) => a.action === "legal.view" && a.subject === "legal_request:lr1")).toBe(
      true,
    );
    expect(audit.some((a) => a.subject === `legal_request:${id}`)).toBe(true);
    expect(JSON.stringify(audit)).not.toContain("person@example.org");
    expect((await api.listLegalRequests())[0]).not.toHaveProperty("requester");
  });

  it("records an NCMEC report once and keeps evidence for a year", async () => {
    const api = createMockApi({ now: () => new Date("2026-09-22T00:00:00Z") });
    await api.reportCsamIncident("inc1", { ncmec_report_id: "N-42", ...reason });
    const inc = (await api.listCsamIncidents()).find((i) => i.id === "inc1");
    expect(inc?.evidence_expires_at).toBe("2027-09-22T00:00:00.000Z");
    await expect(
      api.reportCsamIncident("inc1", { ncmec_report_id: "N-43", ...reason }),
    ).rejects.toMatchObject({ code: "csam.already_reported" });
  });

  it("enforces the server-side roles even when the page thinks it may act", async () => {
    const api = createMockApi({ enforceRoles: ["viewer"] });
    expect((await api.me()).roles).toEqual(["owner"]);
    await expect(api.setFlag("uploads", { enabled: false, ...reason })).rejects.toMatchObject({
      status: 403,
      code: "admin.forbidden",
    });
    await expect(api.listQueues()).rejects.toMatchObject({ status: 403 });
  });
});
