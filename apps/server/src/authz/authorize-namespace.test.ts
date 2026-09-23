import { describe, expect, it } from "vitest";
import { authorize, type Decision, type NamespaceContext, type Principal } from "./authorize.js";

const alice: Principal = { kind: "user", user_id: "u_alice", banned: false };
const mallory: Principal = { kind: "user", user_id: "u_mallory", banned: false };
const anon: Principal = { kind: "anonymous" };
const status = (d: Decision) => (d.allow ? 200 : d.status);

const ns = (role: NamespaceContext["role"], st: "active" | "suspended" = "active") =>
  ({ type: "namespace", ns: { namespace_id: "ns1", status: st, role } }) as const;

describe("namespace rename", () => {
  it("only the owner can rename, and only through a browser session", () => {
    expect(status(authorize(alice, "namespace.rename", ns("owner")))).toBe(200);
    expect(status(authorize(alice, "namespace.rename", ns("maintainer")))).toBe(403);
    expect(status(authorize(mallory, "namespace.rename", ns(null)))).toBe(403);
    expect(status(authorize(anon, "namespace.rename", ns(null)))).toBe(401);
    expect(status(authorize(alice, "namespace.rename", ns("owner", "suspended")))).toBe(403);
    const tok: Principal = {
      kind: "user",
      user_id: "u_alice",
      banned: false,
      scopes: ["creations:write"],
    };
    expect(authorize(tok, "namespace.rename", ns("owner"))).toMatchObject({
      code: "token.not_allowed",
    });
    expect(status(authorize(alice, "namespace.rename", { type: "system" }))).toBe(403);
  });
});
