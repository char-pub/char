import { describe, expect, it, vi } from "vitest";
import { ApiError, createRegistryClient } from "./api";
import { getMainText, setGreeting, setMainText, setName, type Working } from "./draft";
import { IdempotencyKeys, suggestLabel } from "./publish";

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
