import { describe, expect, it, vi } from "vitest";
import { ApiError, createRegistryClient, MAX_REPORT_DETAILS, REPORT_CATEGORIES } from "./api";
import { getMainText, setGreeting, setMainText, setName, type Working } from "./draft";
import { IdempotencyKeys, suggestLabel } from "./publish";
import { REPORT_TURNSTILE_ACTION } from "./turnstile";

const headersOf = (init: RequestInit | undefined) =>
  (init?.headers ?? {}) as Record<string, string>;

function recorder(responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return responses.shift() ?? new Response(null, { status: 500 });
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("registry client", () => {
  it("sends cookies, If-Match and Idempotency-Key, and turns problems into ApiError", async () => {
    const r = recorder([
      json(
        { type: "about:blank", title: "Conflict", status: 409, code: "draft.version_conflict" },
        409,
      ),
      json({ release: "rel_x", state: "pending", idempotent: false }, 202),
    ]);
    const client = createRegistryClient({ baseUrl: "https://api.test", fetch: r.fetch });
    const err = await client.putDraft("djj", "alice", 7, { a: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("draft.version_conflict");
    expect(r.calls[0]?.url).toBe("https://api.test/v1/creations/@djj/alice/draft");
    expect(r.calls[0]?.init.credentials).toBe("include");
    expect(headersOf(r.calls[0]?.init)["if-match"]).toBe('"7"');

    await client.publish(
      "djj",
      "alice",
      { revision: "rev_x", label: "1.0.0", visibility: "public" },
      "key-12345678",
    );
    expect(headersOf(r.calls[1]?.init)["idempotency-key"]).toBe("key-12345678");
  });

  it("treats 401 on /v1/me as signed out", async () => {
    const r = recorder([json({ code: "auth.required", status: 401, title: "", type: "" }, 401)]);
    const client = createRegistryClient({ baseUrl: "", fetch: r.fetch });
    expect(await client.me()).toBeNull();
  });

  it("reports a building CCv3 export with its retry delay", async () => {
    const r = recorder([
      new Response(JSON.stringify({ state: "building" }), {
        status: 202,
        headers: { "retry-after": "3" },
      }),
    ]);
    const client = createRegistryClient({ baseUrl: "", fetch: r.fetch });
    expect(await client.exportCcv3("djj", "alice", "1.0.0")).toEqual({
      state: "building",
      retryAfter: 3,
    });
  });
});

describe("search", () => {
  it("passes the namespace filter and leaves out empty parameters", async () => {
    const r = recorder([json({ items: [], next_cursor: null })]);
    const client = createRegistryClient({ baseUrl: "https://api.test", fetch: r.fetch });
    const page = await client.search({ ns: "kate", q: "", type: "character", cursor: undefined });
    expect(page).toEqual({ items: [], next_cursor: null });
    expect(r.calls[0]?.url).toBe("https://api.test/v1/search?ns=kate&type=character");
  });
});

describe("contributions", () => {
  it("reads the rejection reason from the contribution detail", async () => {
    const detail = {
      id: "ctb_01j00000000000000000000001",
      number: 3,
      title: "Tweak",
      status: "rejected",
      agent: false,
      author: { guest_id: "gst_01j00000000000000000000001", display_name: "Reader" },
      base_revision: "rev_01j00000000000000000000001",
      created_at: "2026-09-23T00:00:00.000Z",
      decided_at: "2026-09-23T01:00:00.000Z",
      changes: [],
      preview: null,
      result_revision: null,
      decision_reason: "Please keep the tone.",
    };
    const r = recorder([json(detail), json({ ...detail, decision_reason: undefined })]);
    const client = createRegistryClient({ baseUrl: "", fetch: r.fetch });
    expect((await client.contribution("djj", "alice", 3)).decision_reason).toBe(
      "Please keep the tone.",
    );
    // 没有理由（例如撤回的 Contribution）时这个字段不存在。
    expect((await client.contribution("djj", "alice", 3)).decision_reason).toBeUndefined();
    expect(r.calls[0]?.url).toBe("/v1/creations/@djj/alice/contributions/3");
  });
});

describe("contribution invites", () => {
  it("invites by @namespace and removes an invite by @namespace", async () => {
    const r = recorder([
      json({ user: "usr_01j00000000000000000000001", namespace: "@kate", invited: true }),
      json({ user: "usr_01j00000000000000000000001", namespace: "@kate", invited: false }),
      json({ code: "contribution.invite_unknown_user", status: 422, title: "", type: "" }, 422),
    ]);
    const client = createRegistryClient({ baseUrl: "", fetch: r.fetch });
    expect(await client.inviteByNamespace("djj", "alice", "@kate")).toEqual({
      user: "usr_01j00000000000000000000001",
      namespace: "@kate",
      invited: true,
    });
    expect(r.calls[0]?.url).toBe("/v1/creations/@djj/alice/contribution-invites");
    expect(r.calls[0]?.init.method).toBe("POST");
    expect(r.calls[0]?.init.body).toBe(JSON.stringify({ namespace: "@kate" }));
    await client.uninvite("djj", "alice", "@kate");
    expect(r.calls[1]?.url).toBe("/v1/creations/@djj/alice/contribution-invites/%40kate");
    const err = await client.inviteByNamespace("djj", "alice", "nobody").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("contribution.invite_unknown_user");
  });
});

describe("reports", () => {
  it("reports a creation or one of its releases and returns only the acknowledgement", async () => {
    const r = recorder([
      json({ status: "received" }, 202),
      json({ status: "received" }, 202),
      json({ code: "not_found", status: 404, title: "not_found", type: "" }, 404),
    ]);
    const client = createRegistryClient({ baseUrl: "https://api.test", fetch: r.fetch });
    expect(
      await client.submitReport("djj", "alice", { category: "rating", details: "  " }),
    ).toEqual({ status: "received" });
    expect(r.calls[0]?.url).toBe("https://api.test/v1/creations/@djj/alice/reports");
    expect(r.calls[0]?.init.credentials).toBe("include");
    expect(r.calls[0]?.init.body).toBe(JSON.stringify({ category: "rating" }));

    await client.submitReport(
      "djj",
      "alice",
      { category: "copyright", details: "Uses my art.", turnstile_token: "tok" },
      { label: "1.0.0" },
    );
    expect(r.calls[1]?.url).toBe("https://api.test/v1/creations/@djj/alice/releases/1.0.0/reports");
    expect(JSON.parse(String(r.calls[1]?.init.body))).toEqual({
      category: "copyright",
      details: "Uses my art.",
      turnstile_token: "tok",
    });

    const err = await client
      .submitReport("djj", "secret", { category: "spam" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("not_found");
  });

  it("exposes the six categories and the details limit for the form", () => {
    expect(REPORT_CATEGORIES).toEqual([
      "sexual_minors",
      "copyright",
      "rating",
      "harassment",
      "illegal",
      "spam",
    ]);
    expect(MAX_REPORT_DETAILS).toBe(2000);
    expect(REPORT_TURNSTILE_ACTION).toBe("report");
  });
});

describe("draft helpers", () => {
  it("writes the level-0 fields into the authoring form", () => {
    let w: Working = { display_name: "x" };
    w = setName(w, "Alice");
    w = setMainText(w, "character", "{{self}} delivers parcels.");
    w = setGreeting(w, "Hi {{user}}");
    expect(w.display_name).toBe("Alice");
    expect(w.fragments).toEqual([
      {
        id: "description",
        stable: true,
        kind: "character",
        content: { type: "text", text: "{{self}} delivers parcels." },
      },
    ]);
    expect(getMainText(w, "character")).toBe("{{self}} delivers parcels.");
    expect(w.bootstrap?.greetings[0]).toEqual({ id: "default", text: "Hi {{user}}" });
    expect(setGreeting(w, "").bootstrap).toBeUndefined();
  });
});

describe("publish helpers", () => {
  it("suggests the next patch version", () => {
    expect(suggestLabel([])).toBe("1.0.0");
    expect(suggestLabel(["1.0.0", "1.2.9", "draft"])).toBe("1.2.10");
  });

  it("reuses the Idempotency-Key for retries of the same request only", () => {
    let n = 0;
    const keys = new IdempotencyKeys(() => `key-${++n}`);
    expect(keys.keyFor("rev_a", "1.0.0", "public")).toBe("key-1");
    expect(keys.keyFor("rev_a", "1.0.0", "public")).toBe("key-1");
    expect(keys.keyFor("rev_a", "1.0.1", "public")).toBe("key-2");
    keys.reset();
    expect(keys.keyFor("rev_a", "1.0.1", "public")).toBe("key-3");
  });
});
