/**
 * 越权测试矩阵：对每个动作 × 每种 principal × 每种资源状态自动生成用例，
 * 断言“他人资源”和“匿名访问”永远拿不到私有内容，且私有资源一律 404。
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Action,
  type AuthzContext,
  authorize,
  type Decision,
  type NamespaceContext,
  type Principal,
  type Resource,
} from "./authorize.js";

const OWNER_NS: NamespaceContext = { namespace_id: "ns1", status: "active", role: "owner" };
const FOREIGN_NS: NamespaceContext = { namespace_id: "ns1", status: "active", role: null };

const alice: Principal = { kind: "user", user_id: "u_alice", banned: false };
const mallory: Principal = { kind: "user", user_id: "u_mallory", banned: false };
const anon: Principal = { kind: "anonymous" };
const guest: Principal = { kind: "guest", guest_id: "g1", disabled: false };
const oidc: Principal = { kind: "oidc", creation_id: "cr1", binding_id: "b1" };

const creation = (
  ns: NamespaceContext,
  over: Partial<Extract<Resource, { type: "creation" }>> = {},
) =>
  ({
    type: "creation",
    id: "cr1",
    ns,
    has_public_release: true,
    status: "active",
    contribution_policy: "signed-in",
    ...over,
  }) as const satisfies Resource;

const release = (
  ns: NamespaceContext,
  over: Partial<Extract<Resource, { type: "release" }>> = {},
) =>
  ({
    type: "release",
    id: "rel1",
    creation_id: "cr1",
    ns,
    visibility: "public",
    status: "active",
    creation_status: "active",
    ...over,
  }) as const satisfies Resource;

const status = (d: Decision) => (d.allow ? 200 : d.status);

describe("private content is invisible to everyone else", () => {
  const privateResources: [string, (ns: NamespaceContext) => Resource][] = [
    ["private release", (ns) => release(ns, { visibility: "private" })],
    ["creation without public release", (ns) => creation(ns, { has_public_release: false })],
    ["hidden creation", (ns) => creation(ns, { status: "hidden" })],
    ["release of hidden creation", (ns) => release(ns, { creation_status: "hidden" })],
    ["creation in suspended namespace", (ns) => creation({ ...ns, status: "suspended" })],
  ];
  const actions: Action[] = [
    "creation.read",
    "creation.read_draft",
    "creation.edit",
    "creation.publish",
    "creation.update_settings",
    "release.read",
    "release.yank",
    "contribution.submit",
  ];
  for (const [name, mk] of privateResources) {
    for (const action of actions) {
      for (const [who, p] of [
        ["anonymous", anon],
        ["another user", mallory],
        ["guest", guest],
      ] as const) {
        it(`${who} → ${action} on ${name} → 404`, () => {
          expect(status(authorize(p, action, mk(FOREIGN_NS)))).toBe(404);
        });
      }
    }
  }

  it("the answer is 404 even when the feature is switched off", () => {
    const ctx: AuthzContext = { disabled: new Set(["publish", "read_only"]) };
    expect(
      status(
        authorize(
          mallory,
          "creation.publish",
          creation(FOREIGN_NS, { has_public_release: false }),
          ctx,
        ),
      ),
    ).toBe(404);
  });
});

describe("public content: readable by all, writable only by members", () => {
  const writes: Action[] = ["creation.edit", "creation.publish", "creation.update_settings"];
  it.each(writes)("anonymous %s → 401", (a) => {
    expect(status(authorize(anon, a, creation(FOREIGN_NS)))).toBe(401);
  });
  it.each(writes)("another user %s → 403", (a) => {
    expect(status(authorize(mallory, a, creation(FOREIGN_NS)))).toBe(403);
  });
  it.each(writes)("owner %s → allowed", (a) => {
    expect(status(authorize(alice, a, creation(OWNER_NS)))).toBe(200);
  });
  it("anyone can read public releases and creations", () => {
    for (const p of [anon, mallory, guest]) {
      expect(status(authorize(p, "release.read", release(FOREIGN_NS)))).toBe(200);
      expect(status(authorize(p, "creation.read", creation(FOREIGN_NS)))).toBe(200);
    }
  });
  it("drafts are only visible to members, even of a public creation", () => {
    expect(status(authorize(mallory, "creation.read_draft", creation(FOREIGN_NS)))).toBe(404);
    expect(status(authorize(alice, "creation.read_draft", creation(OWNER_NS)))).toBe(200);
  });
  it("yank requires membership and a non-tombstoned release", () => {
    expect(status(authorize(mallory, "release.yank", release(FOREIGN_NS)))).toBe(403);
    expect(status(authorize(alice, "release.yank", release(OWNER_NS)))).toBe(200);
    expect(
      status(authorize(alice, "release.yank", release(OWNER_NS, { status: "tombstoned" }))),
    ).toBe(403);
  });
});

describe("account state, tokens and kill switches", () => {
  it("banned users cannot write", () => {
    const banned: Principal = { ...alice, banned: true } as Principal;
    expect(authorize(banned, "creation.edit", creation(OWNER_NS))).toEqual({
      allow: false,
      status: 403,
      code: "account.banned",
    });
  });

  it("token scopes are intersected with user permissions", () => {
    const readOnly: Principal = {
      kind: "user",
      user_id: "u_alice",
      banned: false,
      scopes: ["creations:read"],
    };
    expect(authorize(readOnly, "creation.publish", creation(OWNER_NS))).toMatchObject({
      code: "token.insufficient_scope",
    });
    expect(status(authorize(readOnly, "creation.read_draft", creation(OWNER_NS)))).toBe(200);
    const publisher: Principal = { ...readOnly, scopes: ["releases:publish"] } as Principal;
    expect(status(authorize(publisher, "creation.publish", creation(OWNER_NS)))).toBe(200);
    // Token 权限不能超过用户本身。
    expect(
      status(
        authorize(
          { ...publisher, user_id: "u_mallory" } as Principal,
          "creation.publish",
          creation(FOREIGN_NS),
        ),
      ),
    ).toBe(403);
  });

  it("tokens cannot manage tokens", () => {
    const tok: Principal = {
      kind: "user",
      user_id: "u_alice",
      banned: false,
      scopes: ["creations:write"],
    };
    expect(
      authorize(tok, "account.manage_tokens", { type: "account", user_id: "u_alice" }),
    ).toMatchObject({
      code: "token.not_allowed",
    });
    expect(
      status(authorize(alice, "account.manage_tokens", { type: "account", user_id: "u_alice" })),
    ).toBe(200);
    expect(
      status(authorize(mallory, "account.read", { type: "account", user_id: "u_alice" })),
    ).toBe(404);
  });

  it.each([
    ["publish", "creation.publish"],
    ["uploads", "upload.create"],
    ["uploads", "import.create"],
    ["contributions", "contribution.submit"],
  ] as const)("kill switch %s blocks %s with 503", (flag, action) => {
    const ctx: AuthzContext = { disabled: new Set([flag]) };
    const r =
      action === "upload.create" || action === "import.create"
        ? ({ type: "system" } as const)
        : creation(OWNER_NS);
    expect(authorize(alice, action, r, ctx)).toMatchObject({
      status: 503,
      code: "feature.disabled",
    });
  });

  it("read_only blocks every write but not reads", () => {
    const ctx: AuthzContext = { disabled: new Set(["read_only"]) };
    expect(authorize(alice, "creation.edit", creation(OWNER_NS), ctx)).toMatchObject({
      status: 503,
    });
    expect(status(authorize(alice, "creation.read", creation(OWNER_NS), ctx))).toBe(200);
    expect(status(authorize(anon, "search", { type: "system" }, ctx))).toBe(200);
  });

  it("signups switch blocks namespace registration", () => {
    expect(
      status(
        authorize(
          alice,
          "namespace.create",
          { type: "system" },
          { disabled: new Set(["signups"]) },
        ),
      ),
    ).toBe(503);
    expect(status(authorize(alice, "namespace.create", { type: "system" }))).toBe(200);
    expect(status(authorize(anon, "namespace.create", { type: "system" }))).toBe(401);
  });

  it("suspended namespaces and creations cannot be edited, even by owners", () => {
    expect(
      authorize(alice, "creation.edit", creation({ ...OWNER_NS, status: "suspended" })),
    ).toMatchObject({
      code: "namespace.suspended",
    });
    expect(
      authorize(alice, "creation.publish", creation(OWNER_NS, { status: "suspended" })),
    ).toMatchObject({
      code: "creation.suspended",
    });
  });
});

describe("OIDC publishing", () => {
  it("can publish only the bound creation", () => {
    expect(status(authorize(oidc, "creation.publish", creation(FOREIGN_NS)))).toBe(200);
    expect(authorize(oidc, "creation.publish", creation(FOREIGN_NS, { id: "cr2" }))).toMatchObject({
      code: "binding.mismatch",
    });
    expect(status(authorize(oidc, "creation.edit", creation(FOREIGN_NS)))).toBe(403);
    expect(
      status(authorize(oidc, "release.read", release(FOREIGN_NS, { visibility: "private" }))),
    ).toBe(200);
    expect(
      status(
        authorize(
          oidc,
          "release.read",
          release(FOREIGN_NS, { visibility: "private", creation_id: "cr2" }),
        ),
      ),
    ).toBe(404);
  });
});

describe("contribution policy", () => {
  const target = (policy: "anyone" | "signed-in" | "invited" | "closed", invited = false) =>
    creation(FOREIGN_NS, { contribution_policy: policy, invited });
  it.each([
    ["anyone", anon, 401],
    ["anyone", guest, 200],
    ["anyone", mallory, 200],
    ["signed-in", guest, 403],
    ["signed-in", anon, 401],
    ["signed-in", mallory, 200],
    ["invited", mallory, 403],
    ["invited", anon, 401],
    ["invited", guest, 403],
    ["closed", mallory, 403],
  ] as const)("%s policy: %o → %i", (policy, p, expected) => {
    expect(status(authorize(p, "contribution.submit", target(policy)))).toBe(expected);
  });
  it("invited users and members can contribute to invite-only creations", () => {
    expect(status(authorize(mallory, "contribution.submit", target("invited", true)))).toBe(200);
    expect(
      status(
        authorize(
          alice,
          "contribution.submit",
          creation(OWNER_NS, { contribution_policy: "invited" }),
        ),
      ),
    ).toBe(200);
  });
  it("disabled guests and the guest_access switch block guest contributions", () => {
    expect(
      status(
        authorize(
          { ...guest, disabled: true } as Principal,
          "contribution.submit",
          target("anyone"),
        ),
      ),
    ).toBe(403);
    expect(
      status(
        authorize(guest, "contribution.submit", target("anyone"), {
          disabled: new Set(["guest_access"]),
        }),
      ),
    ).toBe(503);
  });
  it("only members decide, only authors withdraw, others do not see it", () => {
    const c = (ns: NamespaceContext, st: "open" | "accepted" = "open") =>
      ({
        type: "contribution",
        id: "ctb1",
        ns,
        author: { user_id: "u_mallory" },
        status: st,
      }) as const;
    expect(status(authorize(alice, "contribution.decide", c(OWNER_NS)))).toBe(200);
    expect(status(authorize(alice, "contribution.decide", c(OWNER_NS, "accepted")))).toBe(403);
    expect(status(authorize(mallory, "contribution.decide", c(FOREIGN_NS)))).toBe(403);
    expect(status(authorize(mallory, "contribution.withdraw", c(FOREIGN_NS)))).toBe(200);
    expect(status(authorize(alice, "contribution.withdraw", c(OWNER_NS)))).toBe(403);
    expect(status(authorize(anon, "contribution.read", c(FOREIGN_NS)))).toBe(404);
    const other: Principal = { kind: "user", user_id: "u_eve", banned: false };
    expect(status(authorize(other, "contribution.read", c(FOREIGN_NS)))).toBe(404);
    expect(
      status(
        authorize(guest, "contribution.read", { ...c(FOREIGN_NS), author: { guest_id: "g1" } }),
      ),
    ).toBe(200);
  });
});

describe("uploads", () => {
  it("only the uploader sees an upload", () => {
    const u = { type: "upload", id: "upl1", owner_user_id: "u_alice" } as const;
    expect(status(authorize(alice, "upload.read", u))).toBe(200);
    expect(status(authorize(mallory, "upload.read", u))).toBe(404);
    expect(status(authorize(anon, "upload.read", u))).toBe(404);
    expect(status(authorize(anon, "upload.create", { type: "system" }))).toBe(401);
    expect(status(authorize(guest, "upload.create", { type: "system" }))).toBe(403);
  });
});

describe("mismatched resource types are rejected", () => {
  it.each([
    ["creation.read", { type: "system" }],
    ["release.read", { type: "system" }],
    ["creation.read_draft", { type: "system" }],
    ["creation.create", { type: "system" }],
    ["creation.edit", { type: "system" }],
    ["creation.publish", { type: "system" }],
    ["release.yank", { type: "system" }],
    ["contribution.submit", { type: "system" }],
    ["contribution.read", { type: "system" }],
    ["contribution.decide", { type: "system" }],
    ["contribution.withdraw", { type: "system" }],
    ["upload.read", { type: "system" }],
    ["account.read", { type: "system" }],
  ] as const)("%s on a system resource → 403", (action, r) => {
    expect(status(authorize(alice, action, r))).toBe(403);
  });

  it("creation.create needs membership of the namespace", () => {
    expect(status(authorize(alice, "creation.create", { type: "namespace", ns: OWNER_NS }))).toBe(
      200,
    );
    expect(
      status(authorize(mallory, "creation.create", { type: "namespace", ns: FOREIGN_NS })),
    ).toBe(403);
  });
});

describe("property: non-members never get write access to any creation", () => {
  const principalArb = fc.constantFrom<Principal>(anon, mallory, guest, {
    ...mallory,
    scopes: ["creations:write", "releases:publish"],
  } as Principal);
  const actionArb = fc.constantFrom<Action>(
    "creation.edit",
    "creation.publish",
    "creation.update_settings",
    "release.yank",
    "creation.read_draft",
  );
  const nsArb = fc.record({
    namespace_id: fc.constant("ns1"),
    status: fc.constantFrom<"active" | "suspended">("active", "suspended"),
    role: fc.constant(null),
  });
  it("holds", () => {
    fc.assert(
      fc.property(
        principalArb,
        actionArb,
        nsArb,
        fc.boolean(),
        fc.constantFrom<"public" | "private">("public", "private"),
        (p, a, ns, hasPublic, vis) => {
          const r: Resource =
            a === "release.yank"
              ? release(ns, { visibility: vis })
              : creation(ns, { has_public_release: hasPublic });
          const d = authorize(p, a, r);
          expect(d.allow).toBe(false);
        },
      ),
    );
  });
});

describe("card imports", () => {
  const imp = (ns: NamespaceContext, over: Partial<Extract<Resource, { type: "import" }>> = {}) =>
    ({
      type: "import",
      id: "imp1",
      owner_user_id: "u_alice",
      ns,
      ...over,
    }) as const satisfies Resource;

  it("imports only into namespaces the caller is a member of", () => {
    const into = (ns: NamespaceContext) => ({ type: "namespace", ns }) as const;
    expect(status(authorize(alice, "import.create", into(OWNER_NS)))).toBe(200);
    expect(status(authorize(mallory, "import.create", into(FOREIGN_NS)))).toBe(403);
    expect(status(authorize(anon, "import.create", into(FOREIGN_NS)))).toBe(401);
    expect(
      status(authorize(alice, "import.create", into({ ...OWNER_NS, status: "suspended" }))),
    ).toBe(403);
  });

  it("the system resource only answers whether the caller may import at all", () => {
    expect(status(authorize(alice, "import.create", { type: "system" }))).toBe(200);
    expect(status(authorize(anon, "import.create", { type: "system" }))).toBe(401);
    expect(status(authorize(guest, "import.create", { type: "system" }))).toBe(403);
  });

  it("an import is visible only to the person who started it", () => {
    expect(status(authorize(alice, "import.read", imp(OWNER_NS)))).toBe(200);
    for (const p of [mallory, anon, guest, oidc]) {
      expect(status(authorize(p, "import.read", imp(FOREIGN_NS)))).toBe(404);
      expect(status(authorize(p, "import.confirm", imp(FOREIGN_NS)))).toBe(404);
    }
  });

  it("confirming needs membership, a write scope and an editable creation", () => {
    expect(status(authorize(alice, "import.confirm", imp(OWNER_NS)))).toBe(200);
    // 发起人已经不是 namespace 成员时不能再修改草稿。
    expect(status(authorize(alice, "import.confirm", imp(FOREIGN_NS)))).toBe(403);
    expect(
      status(authorize(alice, "import.confirm", imp(OWNER_NS, { creation_status: "suspended" }))),
    ).toBe(403);
    const readOnlyToken = { ...alice, scopes: ["creations:read"] } as Principal;
    expect(authorize(readOnlyToken, "import.confirm", imp(OWNER_NS))).toMatchObject({
      status: 403,
      code: "token.insufficient_scope",
    });
    const readOnly: AuthzContext = { disabled: new Set(["read_only"]) };
    expect(status(authorize(alice, "import.confirm", imp(OWNER_NS), readOnly))).toBe(503);
  });
});
