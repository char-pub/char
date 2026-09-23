import { describe, expect, it } from "vitest";
import { cloudflareAccessRevoker } from "./access-revoke.js";

function fakeFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return respond(url, init ?? {});
  }) as typeof fetch;
  return { f, calls };
}

describe("cloudflareAccessRevoker", () => {
  it("posts the email to the account's revoke_user endpoint with the API token", async () => {
    const { f, calls } = fakeFetch(() => Response.json({ success: true, result: true }));
    const revoke = cloudflareAccessRevoker({ accountId: "acc 1", apiToken: "tok", fetch: f });
    expect(await revoke("staff@char.pub")).toBe("revoked");
    expect(calls).toHaveLength(1);
    const [call] = calls;
    if (!call) throw new Error("expected one call");
    expect(call.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acc%201/access/organizations/revoke_user",
    );
    expect(call.init.method).toBe("POST");
    expect((call.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(String(call.init.body))).toEqual({ email: "staff@char.pub" });
  });

  it("reports failure for HTTP errors, unsuccessful bodies and network errors", async () => {
    const denied = fakeFetch(() => new Response("forbidden", { status: 403 }));
    expect(
      await cloudflareAccessRevoker({ accountId: "a", apiToken: "t", fetch: denied.f })("x@y.z"),
    ).toBe("failed");
    const unsuccessful = fakeFetch(() => Response.json({ success: false, errors: [{}] }));
    expect(
      await cloudflareAccessRevoker({ accountId: "a", apiToken: "t", fetch: unsuccessful.f })(
        "x@y.z",
      ),
    ).toBe("failed");
    const broken = fakeFetch(() => {
      throw new TypeError("network down");
    });
    expect(
      await cloudflareAccessRevoker({ accountId: "a", apiToken: "t", fetch: broken.f })("x@y.z"),
    ).toBe("failed");
  });
});
