import { describe, expect, it } from "vitest";
import { type Action, authorize, type Principal, type Resource } from "./authorize.js";

const user = "creator";
const owner = {
  namespace_id: "personal",
  kind: "user" as const,
  role: "owner" as const,
  status: "active" as const,
};
const work: Resource = {
  type: "creation",
  id: "work",
  ns: owner,
  has_public_release: false,
  status: "active",
  contribution_policy: "signed-in",
};
const oauth = (scopes: Extract<Principal, { kind: "user" }>["scopes"] = []): Principal => ({
  kind: "user",
  user_id: user,
  banned: false,
  scopes: scopes ?? [],
  oauth: { client_id: "runtime", token_id: "opaque-row" },
});
describe("OAuth delegated ceiling", () => {
  it("reads a private build only with read scope and current exact-work authority", () => {
    expect(authorize(oauth(["creations:read"]), "creation.read_build", work).allow).toBe(true);
    expect(authorize(oauth(), "creation.read_build", work)).toMatchObject({
      allow: false,
      status: 403,
      code: "token.insufficient_scope",
    });
    expect(
      authorize(oauth(["creations:read"]), "creation.read_build", {
        ...work,
        ns: { ...owner, role: null },
      }),
    ).toMatchObject({ allow: false, status: 404 });
    expect(
      authorize(oauth(["creations:read"]), "creation.read_build", {
        ...work,
        ns: { ...owner, role: null },
        collaborator: true,
      }).allow,
    ).toBe(true);
    expect(authorize(oauth(["creations:read"]), "creation.read_draft", work)).toMatchObject({
      allow: false,
      code: "oauth.action_not_allowed",
    });
  });
  it("does not turn a public read into an extra grant", () => {
    const publicWork = { ...work, has_public_release: true };
    expect(authorize(oauth(), "creation.read", publicWork).allow).toBe(true);
    expect(authorize(oauth(), "creation.read", work)).toMatchObject({
      allow: false,
      code: "token.insufficient_scope",
    });
  });
  it("allows only creation in the user's own personal namespace", () => {
    expect(
      authorize(oauth(["drafts:write"]), "creation.create", { type: "namespace", ns: owner }).allow,
    ).toBe(true);
    for (const ns of [
      { ...owner, role: "maintainer" as const },
      { ...owner, kind: "system" as const },
      { ...owner, kind: "org" as const },
    ])
      expect(
        authorize(oauth(["drafts:write"]), "creation.create", { type: "namespace", ns }),
      ).toMatchObject({ allow: false, code: "oauth.own_namespace_required" });
  });
  it.each([
    "creation.edit",
    "creation.publish",
    "creation.update_settings",
    "creation.manage_source",
    "creation.manage_collaborators",
    "creation.delete_request",
    "contribution.decide",
    "contribution.withdraw",
    "upload.create",
    "namespace.create",
    "account.read",
    "account.update_settings",
    "account.manage_tokens",
  ] satisfies Action[])("cannot inherit %s even with every PAT scope injected", (action) => {
    const resource: Resource = action.startsWith("account.")
      ? { type: "account", user_id: user }
      : work;
    expect(
      authorize(
        oauth([
          "profile",
          "drafts:write",
          "creations:read",
          "creations:write",
          "releases:publish",
          "contributions:write",
        ]),
        action,
        resource,
      ),
    ).toMatchObject({ allow: false, code: "oauth.action_not_allowed" });
  });
  it("requires profile for the dedicated public profile and respects account bans", () => {
    const account: Resource = { type: "account", user_id: user };
    expect(authorize(oauth(["profile"]), "account.profile", account).allow).toBe(true);
    expect(authorize(oauth(), "account.profile", account)).toMatchObject({
      allow: false,
      code: "token.insufficient_scope",
    });
    expect(
      authorize(
        { ...oauth(["profile"]), kind: "user", user_id: user, banned: true },
        "account.profile",
        account,
      ),
    ).toMatchObject({ allow: false, code: "account.banned" });
  });
});
