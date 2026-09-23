/**
 * 公开举报的集成测试：登录用户、访客与匿名（Turnstile 本地替身，按真实协议实现）举报作品和
 * 版本；举报进入 admin 的队列；看不到的对象与不存在一样返回 404，而且不会先调用 Turnstile；
 * 请求体校验；按账号、访客与 IP 限流；没有配置 Turnstile 时匿名举报不可用；全站只读。
 */
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GUEST_TURNSTILE_ACTION, GuestHasher } from "../src/auth/guest.js";
import { CloudflareTurnstile } from "../src/auth/turnstile.js";
import { auditLog, creations, guests, releases, reports } from "../src/db/schema/index.js";
import { REPORT_TURNSTILE_ACTION, type ReportServices } from "../src/moderation/reports.js";
import { toPublicId } from "../src/registry/read.js";
import { type ContributionHarness, createContributionHarness } from "./contributions-harness.js";
import { startTurnstileStub, type TurnstileStub } from "./guest-doubles.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let h: ContributionHarness;
let stub: TurnstileStub;
let hasher: GuestHasher;
let services: ReportServices;
let owner: string;
let path: string;
let creationId: string;

const frag = (id: string, text: string) => ({
  id,
  stable: true,
  kind: "character" as const,
  content: { type: "text" as const, text },
});

const WORKING = {
  display_name: "Alice",
  fragments: [frag("description", "{{self}} is a courier.")],
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
};

let ipCounter = 0;
/** 每个请求默认用不同的客户端 IP，避免测试之间共享按 IP 的限流计数。 */
const nextIp = () => {
  ipCounter += 1;
  return `203.0.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
};

type Who = { user: string } | { guest: string } | "anonymous";

function report(who: Who, target: string, body: unknown, ip = nextIp()) {
  const r =
    who === "anonymous" ? h.anonymous() : "user" in who ? h.asUser(who.user) : h.asGuest(who.guest);
  return r.post(`${target}/reports`, body, { "cf-connecting-ip": ip });
}

async function json(r: Response) {
  return (await r.json()) as Record<string, unknown>;
}

/** 某个对象收到的全部举报。 */
function reportsOn(subjectId: string) {
  return t.app.db.select().from(reports).where(eq(reports.subjectId, subjectId));
}

const withoutInstance = ({ instance: _i, ...rest }: Record<string, unknown>) => rest;

beforeAll(async () => {
  t = await createTestDatabase();
  h = await createContributionHarness(t, testCas());
  stub = await startTurnstileStub();
  hasher = new GuestHasher(randomBytes(32));
  services = {
    turnstile: new CloudflareTurnstile({
      secret: stub.secret,
      allowedHostnames: ["www.char.pub"],
      action: REPORT_TURNSTILE_ACTION,
      endpoint: stub.endpoint,
    }),
    hasher,
  };
  h.services.reports = services;
  ({ owner, path } = await h.setupCreation("reported", "alice", WORKING));
  const [row] = await t.app.db
    .select({ id: creations.id })
    .from(creations)
    .where(eq(creations.name, "alice"));
  creationId = row?.id ?? "";

  // 一个 private 版本，以及一个还没有发布过的作品。
  const me = h.asUser(owner);
  await h.editDraft(owner, path, (w) => {
    w.display_name = "Alice (private cut)";
  });
  const rev = (await json(await me.post(`${path}/revisions`, {}))) as { id: string };
  const pub = await me.post(
    `${path}/releases`,
    { revision: rev.id, label: "0.2.0", visibility: "private" },
    { "idempotency-key": "reports-private-0001" },
  );
  expect(pub.status).toBe(202);
  await h.runPublishJobs();
  const draftOnly = await me.post("/v1/namespaces/reported/creations", {
    name: "draft-only",
    type: "character",
    display_name: "Draft",
  });
  expect(draftOnly.status).toBe(201);
});

afterAll(async () => {
  await stub.close();
  await h.close();
  await t.drop();
});

describe("who can report", () => {
  it("a signed-in user reports a creation; it lands in the moderation queue", async () => {
    const user = await h.createUser("reporter");
    const r = await report({ user }, path, {
      category: "rating",
      details: "  This is not general.\nSee the second greeting.  ",
    });
    expect(r.status).toBe(202);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await json(r)).toEqual({ status: "received" });

    const subject = toPublicId("creation", creationId);
    const [row] = await reportsOn(subject);
    expect(row).toMatchObject({
      reporter: { user },
      subjectType: "creation",
      subjectId: subject,
      category: "rating",
      details: "This is not general.\nSee the second greeting.",
      status: "open",
    });
    // 审计记录举报了什么，但不记录说明正文。
    const [audit] = await t.app.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "report.create"), eq(auditLog.subject, `report:${row?.id}`)));
    expect(audit?.after).toEqual({
      subject_type: "creation",
      subject_id: subject,
      category: "rating",
    });
    expect(audit?.before).toBeNull();
    expect(JSON.stringify(audit?.after)).not.toContain("second greeting");
  });

  it("reports a specific release by label, recorded by its public ID", async () => {
    const user = await h.createUser("release-reporter");
    const r = await report({ user }, `${path}/releases/0.1.0`, { category: "copyright" });
    expect(r.status).toBe(202);
    const [rel] = await t.app.db
      .select({ id: releases.id })
      .from(releases)
      .where(and(eq(releases.creationId, creationId), eq(releases.label, "0.1.0")));
    const rows = await reportsOn(toPublicId("release", rel?.id ?? ""));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ subjectType: "release", category: "copyright", details: null });
  });

  it("a verified guest reports without Turnstile", async () => {
    await h.createGuest("gst_reporter", "Reader");
    const before = stub.calls.length;
    const r = await report({ guest: "gst_reporter" }, path, { category: "harassment" });
    expect(r.status).toBe(202);
    expect(stub.calls.length).toBe(before);
    const rows = await t.app.db
      .select()
      .from(reports)
      .where(sql`${reports.reporter} = ${JSON.stringify({ guest: "gst_reporter" })}::jsonb`);
    expect(rows).toHaveLength(1);
  });

  it("an anonymous reporter must pass Turnstile issued for the report form", async () => {
    const missing = await report("anonymous", path, { category: "spam" });
    expect(missing.status).toBe(403);
    expect(await json(missing)).toMatchObject({ code: "turnstile.required" });

    const bogus = await report("anonymous", path, { category: "spam", turnstile_token: "nope" });
    expect(bogus.status).toBe(403);
    expect(await json(bogus)).toMatchObject({ code: "turnstile.failed" });

    // 访客验证表单的 token 不能用来举报。
    const guestToken = stub.issue({ action: GUEST_TURNSTILE_ACTION });
    const wrongForm = await report("anonymous", path, {
      category: "spam",
      turnstile_token: guestToken,
    });
    expect(wrongForm.status).toBe(403);
    expect(await json(wrongForm)).toMatchObject({ code: "turnstile.failed" });

    const ip = nextIp();
    const token = stub.issue({ action: REPORT_TURNSTILE_ACTION });
    const ok = await report("anonymous", path, { category: "spam", turnstile_token: token }, ip);
    expect(ok.status).toBe(202);
    expect(stub.calls.at(-1)).toMatchObject({ response: token, remoteip: ip });
    const rows = await t.app.db
      .select()
      .from(reports)
      .where(sql`${reports.reporter} = ${JSON.stringify({ anon: hasher.ip(ip) })}::jsonb`);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(ip);

    // 同一个 token 只能用一次。
    const replay = await report("anonymous", path, { category: "spam", turnstile_token: token });
    expect(replay.status).toBe(403);
  });

  it("anonymous reports are unavailable when Turnstile is not configured", async () => {
    Reflect.deleteProperty(h.services, "reports");
    try {
      const anon = await report("anonymous", path, {
        category: "illegal",
        turnstile_token: stub.issue({ action: REPORT_TURNSTILE_ACTION }),
      });
      expect(anon.status).toBe(503);
      expect(await json(anon)).toMatchObject({ code: "report.anonymous_unavailable" });
      // 登录用户照常可以举报。
      const user = await h.createUser("no-turnstile");
      expect((await report({ user }, path, { category: "illegal" })).status).toBe(202);
    } finally {
      h.services.reports = services;
    }
  });

  it("disabled guests cannot report", async () => {
    await h.createGuest("gst_disabled", "Gone");
    await t.app.db
      .update(guests)
      .set({ disabledAt: new Date() })
      .where(eq(guests.guestId, "gst_disabled"));
    const r = await report({ guest: "gst_disabled" }, path, { category: "spam" });
    expect(r.status).toBe(403);
    expect(await json(r)).toMatchObject({ code: "guest.disabled" });
  });
});

describe("targets the reporter cannot see", () => {
  it("private, unpublished, hidden and missing targets all look like 404 not_found", async () => {
    const stranger = await h.createUser("prober");
    await h.createGuest("gst_prober", "Prober");
    const hidden = await h.setupCreation("hidden-ns", "gone", WORKING);
    await t.app.db.update(creations).set({ status: "hidden" }).where(eq(creations.name, "gone"));
    const targets = [
      `${path}/releases/0.2.0`,
      `${path}/releases/9.9.9`,
      "/v1/creations/@reported/draft-only",
      "/v1/creations/@reported/nothing-here",
      "/v1/creations/@nobody/alice",
      hidden.path,
      `${hidden.path}/releases/0.1.0`,
    ];
    const before = {
      calls: stub.calls.length,
      rows: (await t.app.db.select().from(reports)).length,
    };
    const bodies = new Set<string>();
    for (const target of targets) {
      for (const who of [{ user: stranger }, { guest: "gst_prober" }, "anonymous"] as const) {
        const r = await report(who, target, {
          category: "sexual_minors",
          turnstile_token: stub.issue({ action: REPORT_TURNSTILE_ACTION }),
        });
        expect(r.status, `${JSON.stringify(who)} ${target}`).toBe(404);
        bodies.add(JSON.stringify(withoutInstance(await json(r))));
      }
    }
    // 响应完全一样；没有调用 Turnstile，也没有写入任何举报。
    expect([...bodies]).toEqual([
      JSON.stringify({
        type: "https://char.pub/problems/not_found",
        title: "not_found",
        status: 404,
        code: "not_found",
      }),
    ]);
    expect(stub.calls.length).toBe(before.calls);
    expect((await t.app.db.select().from(reports)).length).toBe(before.rows);
  });

  it("the owner can still report their own private release, and old names still work", async () => {
    expect(
      (await report({ user: owner }, `${path}/releases/0.2.0`, { category: "spam" })).status,
    ).toBe(202);
    const moved = await h.setupCreation("old-name", "bob", WORKING);
    const renamed = await h
      .asUser(moved.owner)
      .patch("/v1/namespaces/old-name", { new_slug: "new-name" });
    expect(renamed.status).toBe(200);
    const user = await h.createUser("follows-rename");
    expect((await report({ user }, moved.path, { category: "rating" })).status).toBe(202);
    const [bob] = await t.app.db
      .select({ id: creations.id })
      .from(creations)
      .where(eq(creations.name, "bob"));
    expect(await reportsOn(toPublicId("creation", bob?.id ?? ""))).toHaveLength(1);
  });
});

describe("request validation", () => {
  it.each([
    ["unknown category", { category: "other" }],
    ["missing category", { details: "x" }],
    ["details too long", { category: "spam", details: "x".repeat(2001) }],
    ["control characters", { category: "spam", details: "bad\u0000byte" }],
    ["a bell character", { category: "spam", details: "ring\u0007bell" }],
    ["unknown field", { category: "spam", reporter: "someone else" }],
    ["empty token", { category: "spam", turnstile_token: "" }],
  ])("rejects %s with 422", async (_name, body) => {
    const user = await h.createUser(`validator-${nextIp().replaceAll(".", "-")}`);
    const r = await report({ user }, path, body);
    expect(r.status).toBe(422);
    expect(await json(r)).toMatchObject({ code: "request.invalid" });
  });

  it("accepts details of exactly 2000 characters with line breaks and tabs", async () => {
    const user = await h.createUser("long-details");
    const details = `line one\n\tline two\r\n${"y".repeat(1980)}`;
    expect(details.length).toBe(2000);
    expect((await report({ user }, path, { category: "illegal", details })).status).toBe(202);
  });

  it("rejects a body that is not JSON", async () => {
    const r = await h.capp.request(`${path}/reports`, {
      method: "POST",
      headers: {
        "x-test-user": owner,
        "content-type": "application/json",
        origin: "https://www.char.pub",
      },
      body: "{not json",
    });
    expect(r.status).toBe(422);
  });
});

describe("rate limits", () => {
  it("limits each account to 10 reports an hour", async () => {
    const user = await h.createUser("busy-user");
    for (let i = 0; i < 10; i++) {
      expect((await report({ user }, path, { category: "spam" })).status).toBe(202);
    }
    const over = await report({ user }, path, { category: "spam" });
    expect(over.status).toBe(429);
    expect(await json(over)).toMatchObject({ code: "rate_limited" });
    expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("limits each guest to 5 reports an hour", async () => {
    await h.createGuest("gst_busy", "Busy");
    for (let i = 0; i < 5; i++) {
      expect((await report({ guest: "gst_busy" }, path, { category: "spam" })).status).toBe(202);
    }
    expect((await report({ guest: "gst_busy" }, path, { category: "spam" })).status).toBe(429);
  });

  it("limits each IP to 20 reports an hour, before calling Turnstile", async () => {
    const ip = nextIp();
    for (let i = 0; i < 20; i++) {
      const r = await report(
        "anonymous",
        path,
        { category: "spam", turnstile_token: stub.issue({ action: REPORT_TURNSTILE_ACTION }) },
        ip,
      );
      expect(r.status).toBe(202);
    }
    const calls = stub.calls.length;
    const over = await report(
      "anonymous",
      path,
      { category: "spam", turnstile_token: stub.issue({ action: REPORT_TURNSTILE_ACTION }) },
      ip,
    );
    expect(over.status).toBe(429);
    expect(stub.calls.length).toBe(calls);
    // 同一 IP 上的登录用户也算在内。
    const user = await h.createUser("same-network");
    expect((await report({ user }, path, { category: "spam" }, ip)).status).toBe(429);
  });
});

describe("kill switches", () => {
  it("read-only mode returns 503; other switches do not stop reports", async () => {
    const user = await h.createUser("switches");
    await h.setFlag("read_only", false);
    try {
      const r = await report({ user }, path, { category: "spam" });
      expect(r.status).toBe(503);
      expect(await json(r)).toMatchObject({ code: "feature.read_only" });
    } finally {
      await h.setFlag("read_only", true);
    }
    for (const flag of ["contributions", "guest_access", "uploads"]) await h.setFlag(flag, false);
    try {
      expect((await report({ user }, path, { category: "spam" })).status).toBe(202);
    } finally {
      for (const flag of ["contributions", "guest_access", "uploads"]) await h.setFlag(flag, true);
    }
  });
});
