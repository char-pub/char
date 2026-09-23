import { describe, expect, it } from "vitest";
import {
  authorize,
  type Decision,
  type NamespaceContext,
  type Principal,
  type Resource,
} from "./authorize.js";

const status = (d: Decision) => (d.allow ? 200 : d.status);
const alice: Principal = { kind: "user", user_id: "u_alice", banned: false };
const mallory: Principal = { kind: "user", user_id: "u_mallory", banned: false };
const anon: Principal = { kind: "anonymous" };

const creation = (
  role: NamespaceContext["role"],
  over: Partial<Extract<Resource, { type: "creation" }>> = {},
) =>
  ({
    type: "creation",
    id: "cr1",
    ns: { namespace_id: "ns1", status: "active", role },
    has_public_release: true,
    status: "active",
    contribution_policy: "signed-in",
    ...over,
  }) as const satisfies Resource;

describe("managing a GitHub source binding", () => {
  it("is limited to namespace members", () => {
    expect(status(authorize(alice, "creation.manage_source", creation("owner")))).toBe(200);
    expect(status(authorize(alice, "creation.manage_source", creation("maintainer")))).toBe(200);
    expect(status(authorize(mallory, "creation.manage_source", creation(null)))).toBe(403);
    expect(status(authorize(anon, "creation.manage_source", creation(null)))).toBe(401);
    expect(
      status(
        authorize(mallory, "creation.manage_source", creation(null, { has_public_release: false })),
      ),
    ).toBe(404);
  });

  it("requires the creations:write scope for tokens and respects read_only", () => {
    const readOnly: Principal = { ...alice, scopes: ["creations:read"] } as Principal;
    expect(authorize(readOnly, "creation.manage_source", creation("owner"))).toMatchObject({
      code: "token.insufficient_scope",
    });
    expect(
      status(
        authorize(alice, "creation.manage_source", creation("owner"), {
          disabled: new Set(["read_only"]),
        }),
      ),
    ).toBe(503);
  });

  it("is not available to OIDC publish credentials", () => {
    const oidc: Principal = { kind: "oidc", creation_id: "cr1", binding_id: "b1" };
    expect(status(authorize(oidc, "creation.manage_source", creation(null)))).toBe(403);
  });
});

describe("OIDC credentials and unpublished creations", () => {
  it("can see and publish their own creation before it has any public release", () => {
    const oidc: Principal = { kind: "oidc", creation_id: "cr1", binding_id: "b1" };
    const fresh = creation(null, { has_public_release: false });
    expect(status(authorize(oidc, "creation.publish", fresh))).toBe(200);
    expect(status(authorize(oidc, "creation.publish", { ...fresh, id: "cr2" }))).toBe(404);
  });
});
