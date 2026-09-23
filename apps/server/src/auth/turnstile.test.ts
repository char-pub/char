import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTurnstileStub, type TurnstileStub } from "../../test/guest-doubles.js";
import { CloudflareTurnstile } from "./turnstile.js";

let stub: TurnstileStub;

beforeAll(async () => {
  stub = await startTurnstileStub();
});

afterAll(async () => {
  await stub.close();
});

function verifier(opts: { secret?: string; timeoutMs?: number } = {}) {
  return new CloudflareTurnstile({
    secret: opts.secret ?? stub.secret,
    allowedHostnames: ["www.char.pub", "staging.char.pub"],
    action: "guest_verification",
    endpoint: stub.endpoint,
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
  });
}

describe("CloudflareTurnstile", () => {
  it("accepts a fresh token for an allowed hostname and action, and forwards the client IP", async () => {
    const token = stub.issue();
    expect(await verifier().verify(token, "203.0.113.7")).toEqual({ ok: true });
    expect(stub.calls.at(-1)).toEqual({
      secret: stub.secret,
      response: token,
      remoteip: "203.0.113.7",
    });
  });

  it("rejects a token that was already used", async () => {
    const token = stub.issue();
    expect((await verifier().verify(token)).ok).toBe(true);
    expect(await verifier().verify(token)).toEqual({ ok: false, reason: "timeout-or-duplicate" });
  });

  it("rejects unknown tokens and a wrong secret", async () => {
    expect(await verifier().verify("not-a-token")).toEqual({
      ok: false,
      reason: "invalid-input-response",
    });
    expect(await verifier({ secret: "wrong" }).verify(stub.issue())).toEqual({
      ok: false,
      reason: "invalid-input-secret",
    });
  });

  it("rejects tokens solved on another site or for another form", async () => {
    expect(await verifier().verify(stub.issue({ hostname: "evil.example" }))).toEqual({
      ok: false,
      reason: "hostname-mismatch",
    });
    expect(await verifier().verify(stub.issue({ action: "report" }))).toEqual({
      ok: false,
      reason: "action-mismatch",
    });
    expect((await verifier().verify(stub.issue({ hostname: "STAGING.char.pub" }))).ok).toBe(true);
  });

  it("fails closed when Cloudflare errors, times out or the token is oversized", async () => {
    stub.failNext(500);
    expect(await verifier().verify(stub.issue())).toEqual({ ok: false, reason: "http-500" });
    stub.delayNext(500);
    expect(await verifier({ timeoutMs: 50 }).verify(stub.issue())).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(await verifier().verify("x".repeat(2049))).toEqual({
      ok: false,
      reason: "invalid-input-response",
    });
    expect(await verifier().verify("")).toEqual({ ok: false, reason: "invalid-input-response" });
  });

  it("fails closed on a malformed response", async () => {
    const t = new CloudflareTurnstile({
      secret: "s",
      allowedHostnames: ["www.char.pub"],
      action: "guest_verification",
      fetch: async () => Response.json({ ok: "yes" }),
    });
    expect(await t.verify("token")).toEqual({ ok: false, reason: "bad-response" });
  });

  it("accepts results produced by Cloudflare's testing keys only when allowed", async () => {
    // siteverify 对“始终通过”的测试 secret 的实际响应：hostname 固定，没有 action。
    const testingKeyResponse = async () =>
      Response.json({
        success: true,
        "error-codes": [],
        challenge_ts: "2026-09-23T01:54:39.598Z",
        hostname: "example.com",
        metadata: { result_with_testing_key: true },
      });
    const make = (allowTestingKeys?: boolean) =>
      new CloudflareTurnstile({
        secret: "1x0000000000000000000000000000000AA",
        allowedHostnames: ["localhost"],
        action: "guest_verification",
        fetch: testingKeyResponse,
        ...(allowTestingKeys !== undefined ? { allowTestingKeys } : {}),
      });
    expect(await make().verify("XXXX.DUMMY.TOKEN.XXXX")).toEqual({
      ok: false,
      reason: "testing-key",
    });
    expect(await make(false).verify("XXXX.DUMMY.TOKEN.XXXX")).toEqual({
      ok: false,
      reason: "testing-key",
    });
    expect(await make(true).verify("XXXX.DUMMY.TOKEN.XXXX")).toEqual({ ok: true });
  });

  it("refuses to be constructed without a secret or hostnames", () => {
    expect(
      () => new CloudflareTurnstile({ secret: "", allowedHostnames: ["a"], action: "x" }),
    ).toThrow();
    expect(
      () => new CloudflareTurnstile({ secret: "s", allowedHostnames: [], action: "x" }),
    ).toThrow();
  });
});
