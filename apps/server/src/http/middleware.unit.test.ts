import { CharError } from "@char-pub/core";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  apiSecurityHeaders,
  errorHandler,
  jsonBodyLimit,
  originAuth,
  originCheck,
  requestId,
  safeEqual,
  statusForCode,
} from "./middleware.js";

function app() {
  const a = new Hono();
  a.use(requestId(() => "generated-id-0001"));
  a.use(originAuth({ secrets: ["new-secret-value", "old-secret-value"] }));
  a.use(originCheck({ allowed: ["https://www.char.pub"] }));
  a.use(apiSecurityHeaders());
  a.use(jsonBodyLimit(64));
  a.get("/healthz", (c) => c.text("ok"));
  a.get("/x", (c) => c.json({ ok: true }));
  a.post("/x", async (c) => c.json({ got: await c.req.text() }));
  a.get("/boom", () => {
    throw new CharError({ code: "release.tombstoned", subject: "@a/b", detail: "DMCA" });
  });
  a.get("/crash", () => {
    throw new Error("secret internal detail");
  });
  a.onError(errorHandler);
  return a;
}

const AUTH = { "x-origin-auth": "new-secret-value" };

describe("origin auth", () => {
  it("rejects requests without the edge secret", async () => {
    const r = await app().request("/x");
    expect(r.status).toBe(403);
    expect(r.headers.get("content-type")).toBe("application/problem+json");
    expect(await r.json()).toMatchObject({
      code: "origin.forbidden",
      instance: "urn:request:generated-id-0001",
    });
  });

  it("accepts current and previous secrets during rotation, and exempts health checks", async () => {
    expect((await app().request("/x", { headers: AUTH })).status).toBe(200);
    expect(
      (await app().request("/x", { headers: { "x-origin-auth": "old-secret-value" } })).status,
    ).toBe(200);
    expect(
      (await app().request("/x", { headers: { "x-origin-auth": "new-secret-valuE" } })).status,
    ).toBe(403);
    expect((await app().request("/healthz")).status).toBe(200);
  });

  it("ignores empty configured secrets", async () => {
    const a = new Hono();
    a.use(originAuth({ secrets: [""] }));
    a.get("/x", (c) => c.text("ok"));
    expect((await a.request("/x", { headers: { "x-origin-auth": "" } })).status).toBe(403);
  });
});

describe("origin check for writes", () => {
  const post = (headers: Record<string, string>) =>
    app().request("/x", { method: "POST", body: "hi", headers: { ...AUTH, ...headers } });

  it("allows whitelisted origins and rejects others", async () => {
    expect((await post({ origin: "https://www.char.pub" })).status).toBe(200);
    const bad = await post({ origin: "https://evil.example" });
    expect(bad.status).toBe(403);
    expect(await bad.json()).toMatchObject({ code: "origin.not_allowed" });
    // staging 与 production 同属一个 site，必须精确匹配。
    expect((await post({ origin: "https://staging.char.pub" })).status).toBe(403);
  });

  it("requires an Origin when a cookie is sent, but not for bearer tokens or credential-less calls", async () => {
    const r = await post({ cookie: "__Host-charpub.session=abc" });
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ code: "origin.missing" });
    expect((await post({ authorization: "Bearer cp_pat_x" })).status).toBe(200);
    expect((await post({})).status).toBe(200);
  });
});

describe("security headers, body limit, request id", () => {
  it("sets strict headers", async () => {
    const r = await app().request("/x", { headers: AUTH });
    expect(r.headers.get("strict-transport-security")).toContain("preload");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("rejects oversized bodies with 413", async () => {
    const r = await app().request("/x", {
      method: "POST",
      body: "x".repeat(65),
      headers: { ...AUTH, origin: "https://www.char.pub" },
    });
    expect(r.status).toBe(413);
    expect(await r.json()).toMatchObject({ code: "request.too_large" });
  });

  it("keeps a valid incoming request id and replaces an invalid one", async () => {
    const ok = await app().request("/x", {
      headers: { ...AUTH, "x-request-id": "cf-ray-12345678" },
    });
    expect(ok.headers.get("x-request-id")).toBe("cf-ray-12345678");
    const bad = await app().request("/x", { headers: { ...AUTH, "x-request-id": "bad id\n" } });
    expect(bad.headers.get("x-request-id")).toBe("generated-id-0001");
  });
});

describe("errors", () => {
  it("maps CharError to problem+json with a status derived from its code", async () => {
    const r = await app().request("/boom", { headers: AUTH });
    expect(r.status).toBe(410);
    expect(await r.json()).toMatchObject({
      code: "release.tombstoned",
      detail: "DMCA",
      subject: "@a/b",
    });
  });

  it("does not leak internal error details", async () => {
    const r = await app().request("/crash", { headers: AUTH });
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("secret internal detail");
  });

  it.each([
    ["not_found", 404],
    ["creation.not_found", 404],
    ["resolve.tombstoned", 410],
    ["feature.disabled", 503],
    ["publish.label_taken", 409],
    ["draft.version_conflict", 409],
    ["auth.required", 401],
    ["schema.invalid", 422],
    ["publish.diamond_conflict", 422],
    ["license.not_redistributable", 422],
    ["something.else", 400],
  ])("%s → %i", (code, status) => {
    expect(statusForCode(code)).toBe(status);
  });
});

describe("safeEqual", () => {
  it("compares in constant time regardless of length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("", "a")).toBe(false);
  });
});
