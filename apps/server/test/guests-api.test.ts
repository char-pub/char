/**
 * 访客验证的集成测试：Turnstile（本地替身，按真实协议实现）→ 邮件（内存捕获）→ 确认 →
 * 访客会话 cookie → 向允许所有人贡献的作品提交 Contribution。
 *
 * 另外覆盖：Turnstile 失败、token 过期与重复使用、同一邮箱找回同一个访客、数据库里没有
 * 明文邮箱、限流、停用访客、guest_access 开关、退出，以及响应不区分邮箱是否验证过。
 */
import { randomBytes } from "node:crypto";
import { canonicalFragment } from "@char-pub/core";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyAuditChain } from "../src/audit/audit.js";
import { GUEST_TURNSTILE_ACTION, GuestHasher, type GuestServices } from "../src/auth/guest.js";
import { CloudflareTurnstile } from "../src/auth/turnstile.js";
import { guestSessions, guests, guestVerifications } from "../src/db/schema/index.js";
import { ORIGIN } from "./api-harness.js";
import { type ContributionHarness, createContributionHarness } from "./contributions-harness.js";
import { MemoryEmailSender, startTurnstileStub, type TurnstileStub } from "./guest-doubles.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let h: ContributionHarness;
let stub: TurnstileStub;
let mail: MemoryEmailSender;
let hasher: GuestHasher;
let services: GuestServices;
let owner: string;
let path: string;
let revision: string;

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
/** 每个请求默认使用不同的客户端 IP，避免测试之间共享按 IP 的限流计数。 */
const nextIp = () => {
  ipCounter += 1;
  return `198.51.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
};

interface SendOptions {
  body?: unknown;
  cookie?: string;
  ip?: string;
  origin?: string | null;
  headers?: Record<string, string>;
}

function send(method: string, p: string, o: SendOptions = {}) {
  const headers: Record<string, string> = {
    "cf-connecting-ip": o.ip ?? nextIp(),
    ...(o.body === undefined ? {} : { "content-type": "application/json" }),
    ...(method === "GET" || o.origin === null ? {} : { origin: o.origin ?? ORIGIN }),
    ...(o.cookie ? { cookie: o.cookie } : {}),
    ...o.headers,
  };
  return Promise.resolve(
    h.capp.request(p, {
      method,
      headers,
      ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
    }),
  );
}

async function json(r: Response) {
  return (await r.json()) as Record<string, unknown>;
}

function requestVerification(
  email: string,
  o: SendOptions & { turnstile?: string; name?: string } = {},
) {
  return send("POST", "/v1/guests/verification", {
    ...o,
    body: {
      email,
      display_name: o.name ?? "Visitor",
      turnstile_token: o.turnstile ?? stub.issue(),
    },
  });
}

/** 从 Set-Cookie 中取出访客会话 cookie（`name=value`）。 */
function sessionCookie(r: Response): string {
  const header = r.headers.get("set-cookie") ?? "";
  const m = header.match(/(__Host-charpub\.guest=[A-Za-z0-9_-]+)/);
  if (!m?.[1]) throw new Error(`no guest cookie in ${header}`);
  return m[1];
}

/** 走完整的验证流程，返回会话 cookie 与访客信息。 */
async function verify(email: string, name = "Visitor") {
  const r = await requestVerification(email, { name });
  expect(r.status).toBe(202);
  const confirm = await send("POST", "/v1/guests/verification/confirm", {
    body: { token: mail.lastToken(email.trim()) },
  });
  expect(confirm.status).toBe(200);
  const body = (await confirm.json()) as { guest: { id: string; display_name: string } };
  return { cookie: sessionCookie(confirm), guest: body.guest, response: confirm };
}

function contribution(text: string) {
  return {
    title: "Tweak",
    base_revision: revision,
    changes: [
      {
        on: "fragment",
        op: "modify",
        id: "description",
        base_digest: canonicalFragment(frag("description", "{{self}} is a courier.")).digest,
        after: frag("description", text),
      },
    ],
    rights_ack: { inbound_equals_outbound: true },
  };
}

async function setPolicy(policy: string) {
  const r = await h.asUser(owner).put(`${path}/contribution-settings`, { policy });
  expect(r.status).toBe(200);
}

beforeAll(async () => {
  t = await createTestDatabase();
  h = await createContributionHarness(t, testCas());
  stub = await startTurnstileStub();
  mail = new MemoryEmailSender();
  hasher = new GuestHasher(randomBytes(32));
  services = {
    turnstile: new CloudflareTurnstile({
      secret: stub.secret,
      allowedHostnames: ["www.char.pub"],
      action: GUEST_TURNSTILE_ACTION,
      endpoint: stub.endpoint,
    }),
    email: mail,
    hasher,
  };
  h.services.guests = services;
  ({ owner, path, revision } = await h.setupCreation("visitors", "alice", WORKING));
  await setPolicy("anyone");
});

afterAll(async () => {
  await stub.close();
  await h.close();
  await t.drop();
});

describe("guest verification", () => {
  it("verifies an email, issues a guest session cookie, and lets the guest contribute", async () => {
    const r = await requestVerification("dana@example.com", { name: "Dana" });
    expect(r.status).toBe(202);
    expect(await json(r)).toEqual({ status: "sent", expires_in: 1800 });
    const email = mail.sent.at(-1);
    expect(email?.to).toBe("dana@example.com");
    expect(email?.text).toMatch(/https:\/\/www\.char\.pub\/guest\/verify#token=[A-Za-z0-9_-]{43}/);
    // 显示名是访客自己填写的，不应该出现在我们发出的邮件里。
    expect(email?.text).not.toContain("Dana");

    const confirm = await send("POST", "/v1/guests/verification/confirm", {
      body: { token: mail.lastToken("dana@example.com") },
    });
    expect(confirm.status).toBe(200);
    const setCookie = confirm.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^__Host-charpub\.guest=[A-Za-z0-9_-]{43};/);
    for (const attr of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=2592000"]) {
      expect(setCookie).toContain(attr);
    }
    expect(setCookie).not.toMatch(/Domain=/i);
    const body = (await json(confirm)) as { guest: { id: string; display_name: string } };
    expect(body.guest.id).toMatch(/^gst_[0-9a-z]{26}$/);
    expect(body.guest.display_name).toBe("Dana");

    const cookie = sessionCookie(confirm);
    const me = await send("GET", "/v1/guests/me", { cookie });
    expect(me.status).toBe(200);
    expect(me.headers.get("cache-control")).toBe("private, no-store");
    expect(await json(me)).toMatchObject({ guest: { id: body.guest.id, display_name: "Dana" } });

    const submitted = await send("POST", `${path}/contributions`, {
      cookie,
      body: contribution("{{self}} is a very fast courier."),
    });
    expect(submitted.status).toBe(201);
    const number = (await json(submitted)).number;
    const detail = await json(await send("GET", `${path}/contributions/${number}`, { cookie }));
    expect(detail.author).toEqual({ guest_id: body.guest.id, display_name: "Dana" });
  });

  it("rejects guests when the author only accepts signed-in or invited contributors", async () => {
    const { cookie } = await verify("erin@example.com");
    for (const policy of ["signed-in", "invited"]) {
      await setPolicy(policy);
      const r = await send("POST", `${path}/contributions`, {
        cookie,
        body: contribution(`{{self}} is a ${policy} courier.`),
      });
      expect(r.status).toBe(403);
    }
    await setPolicy("anyone");
  });

  it("requires a valid Turnstile token solved on our site for this form", async () => {
    const before = mail.sent.length;
    for (const turnstile of [
      "unknown-token",
      stub.issue({ hostname: "evil.example" }),
      stub.issue({ action: "report" }),
    ]) {
      const r = await requestVerification("frank@example.com", { turnstile });
      expect(r.status).toBe(403);
      expect(await json(r)).toMatchObject({ code: "turnstile.failed" });
    }
    const used = stub.issue();
    expect((await requestVerification("frank@example.com", { turnstile: used })).status).toBe(202);
    expect((await requestVerification("frank@example.com", { turnstile: used })).status).toBe(403);
    expect(mail.sent.length).toBe(before + 1);
    // 客户端 IP 转发给了 Cloudflare。
    expect(stub.calls.at(-1)?.remoteip).toMatch(/^198\.51\./);
  });

  it("rejects expired, reused and malformed tokens with one error", async () => {
    await requestVerification("gina@example.com");
    const token = mail.lastToken("gina@example.com");
    const confirm = (tk: string) =>
      send("POST", "/v1/guests/verification/confirm", { body: { token: tk } });
    expect((await confirm(token)).status).toBe(200);
    const reused = await confirm(token);
    expect(reused.status).toBe(400);
    expect(await json(reused)).toMatchObject({ code: "guest.token_invalid" });

    await requestVerification("gina@example.com");
    const late = mail.lastToken("gina@example.com");
    h.clock.advance(31 * 60 * 1000);
    expect(await json(await confirm(late))).toMatchObject({ code: "guest.token_invalid" });
    expect(await json(await confirm("x".repeat(43)))).toMatchObject({
      code: "guest.token_invalid",
    });
    expect((await confirm("short")).status).toBe(400);
  });

  it("finds the same guest again for the same email and updates the display name", async () => {
    const first = await verify("Hana@Example.com", "Hana");
    const second = await verify("  hana@example.com", "Hana K.");
    expect(second.guest.id).toBe(first.guest.id);
    expect(second.guest.display_name).toBe("Hana K.");
    // 两个会话都有效。
    expect((await send("GET", "/v1/guests/me", { cookie: first.cookie })).status).toBe(200);
    const other = await verify("ivan@example.com");
    expect(other.guest.id).not.toBe(first.guest.id);
  });

  it("never stores the email address in plain text", async () => {
    const address = "julia.plaintext@example.com";
    await verify(address, "Julia");
    const tables = await t.app.db.execute<{ table_schema: string; table_name: string }>(sql`
      SELECT table_schema, table_name FROM information_schema.tables
      WHERE table_schema IN ('app', 'pgboss') AND table_type = 'BASE TABLE'
    `);
    expect(tables.rows.length).toBeGreaterThan(10);
    for (const { table_schema, table_name } of tables.rows) {
      const r = await t.app.db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM ${sql.identifier(table_schema)}.${sql.identifier(table_name)} x
        WHERE x::text ILIKE ${`%${address.split("@")[0]}%`}
      `);
      expect({ table: `${table_schema}.${table_name}`, n: r.rows[0]?.n }).toEqual({
        table: `${table_schema}.${table_name}`,
        n: 0,
      });
    }
    const [g] = await t.app.db
      .select()
      .from(guests)
      .where(eq(guests.emailHmac, hasher.email(address)));
    expect(g?.displayName).toBe("Julia");
  });

  it("rate limits by email and by client IP", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await requestVerification("kate@example.com")).status).toBe(202);
    }
    const byEmail = await requestVerification("KATE@example.com");
    expect(byEmail.status).toBe(429);
    expect(Number(byEmail.headers.get("retry-after"))).toBeGreaterThan(0);

    const ip = "203.0.113.50";
    for (let i = 0; i < 10; i++) {
      expect((await requestVerification(`leo${i}@example.com`, { ip })).status).toBe(202);
    }
    const calls = stub.calls.length;
    expect((await requestVerification("leo-last@example.com", { ip })).status).toBe(429);
    // 按 IP 的限流发生在调用 Turnstile 之前。
    expect(stub.calls.length).toBe(calls);
  });

  it("responds the same way whether or not the email was verified before", async () => {
    await verify("mia@example.com");
    const known = await requestVerification("mia@example.com");
    const fresh = await requestVerification("nora@example.com");
    expect(known.status).toBe(fresh.status);
    expect(await json(known)).toEqual(await json(fresh));
  });

  it("locks out disabled guests but still lets them sign out", async () => {
    const { cookie, guest } = await verify("olga@example.com");
    await t.app.db
      .update(guests)
      .set({ disabledAt: h.clock.now() })
      .where(eq(guests.guestId, guest.id));
    const me = await send("GET", "/v1/guests/me", { cookie });
    expect(me.status).toBe(403);
    expect(await json(me)).toMatchObject({ code: "guest.disabled" });
    const submit = await send("POST", `${path}/contributions`, {
      cookie,
      body: contribution("{{self}} is a disabled courier."),
    });
    expect(await json(submit)).toMatchObject({ code: "guest.disabled" });
    // 重新验证同一个邮箱也不会解除停用。
    await requestVerification("olga@example.com");
    const again = await send("POST", "/v1/guests/verification/confirm", {
      body: { token: mail.lastToken("olga@example.com") },
    });
    expect(again.status).toBe(403);
    expect(again.headers.get("set-cookie")).toBeNull();
    expect((await send("DELETE", "/v1/guests/session", { cookie })).status).toBe(204);
  });

  it("stops verification and guest contributions when guest access is switched off", async () => {
    const { cookie } = await verify("paul@example.com");
    await requestVerification("paul@example.com");
    const pending = mail.lastToken("paul@example.com");
    await h.setFlag("guest_access", false);
    try {
      const r = await requestVerification("quinn@example.com");
      expect(r.status).toBe(503);
      expect(await json(r)).toMatchObject({ code: "feature.disabled" });
      const c = await send("POST", "/v1/guests/verification/confirm", { body: { token: pending } });
      expect(c.status).toBe(503);
      const submit = await send("POST", `${path}/contributions`, {
        cookie,
        body: contribution("{{self}} is a switched-off courier."),
      });
      expect(submit.status).toBe(503);
    } finally {
      await h.setFlag("guest_access", true);
    }
  });

  it("signs out: the session is deleted and the cookie cleared", async () => {
    const { cookie } = await verify("rosa@example.com");
    const out = await send("DELETE", "/v1/guests/session", { cookie });
    expect(out.status).toBe(204);
    const cleared = out.headers.get("set-cookie") ?? "";
    expect(cleared).toMatch(/^__Host-charpub\.guest=;/);
    expect(cleared).toContain("Max-Age=0");
    expect((await send("GET", "/v1/guests/me", { cookie })).status).toBe(401);
    const token = cookie.split("=")[1] ?? "";
    expect(token.length).toBe(43);
    const rows = await t.app.db.select().from(guestSessions);
    expect(rows.every((s) => s.tokenHash !== token)).toBe(true);
    // 没有会话时退出同样成功。
    expect((await send("DELETE", "/v1/guests/session")).status).toBe(204);
  });

  it("treats a signed-in user as the user even with a guest cookie", async () => {
    const { cookie } = await verify("sam@example.com");
    const user = await h.createUser("sam-user");
    const r = await send("GET", "/v1/guests/me", { cookie, headers: { "x-test-user": user } });
    expect(r.status).toBe(403);
  });

  it("refuses cross-site requests and requests without an Origin", async () => {
    const evil = await requestVerification("tom@example.com", { origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    const none = await requestVerification("tom@example.com", { origin: null });
    expect(none.status).toBe(403);
    expect(await json(none)).toMatchObject({ code: "origin.missing" });
  });

  it("does not keep a token when the email cannot be sent", async () => {
    mail.failNext();
    const r = await requestVerification("uma@example.com");
    expect(r.status).toBe(503);
    expect(await json(r)).toMatchObject({ code: "email.unavailable" });
    const rows = await t.app.db
      .select()
      .from(guestVerifications)
      .where(eq(guestVerifications.emailHmac, hasher.email("uma@example.com")));
    expect(rows).toEqual([]);
  });

  it("returns 503 when guest verification is not configured", async () => {
    delete h.services.guests;
    try {
      const r = await requestVerification("vera@example.com");
      expect(r.status).toBe(503);
      expect(await json(r)).toMatchObject({ code: "guest.not_configured" });
    } finally {
      h.services.guests = services;
    }
  });

  it("records each verification in the audit chain", async () => {
    const rows = await t.app.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM app.audit_log WHERE action = 'guest.verified'`,
    );
    expect(rows.rows[0]?.n).toBeGreaterThan(5);
    expect((await verifyAuditChain(t.app.db)).ok).toBe(true);
  });
});
