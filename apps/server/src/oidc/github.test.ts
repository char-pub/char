import { isCharError } from "@char-pub/core";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTPayload,
  SignJWT,
  UnsecuredJWT,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  authenticateOidcPublish,
  GITHUB_OIDC_ISSUER,
  githubJwks,
  MemoryJtiStore,
  matchBinding,
  type OidcBinding,
  type OidcPublishOptions,
  refMatches,
  verifyGitHubOidcToken,
} from "./github.js";

const AUD = "https://api.char.pub";
const NOW = new Date("2026-09-22T12:00:00Z");
const nowSec = Math.floor(NOW.getTime() / 1000);
const SHA = "a".repeat(40);

type Key = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let signingKey: Key;
let otherKey: Key;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  // 每次测试运行时生成新密钥，仓库里不保存任何私钥。
  const main = await generateKeyPair("RS256", { extractable: true });
  const other = await generateKeyPair("RS256", { extractable: true });
  signingKey = main.privateKey;
  otherKey = other.privateKey;
  const pub: JWK = { ...(await exportJWK(main.publicKey)), kid: "gh-1", alg: "RS256", use: "sig" };
  jwks = createLocalJWKSet({ keys: [pub] });
});

function claims(over: Record<string, unknown> = {}): JWTPayload {
  return {
    iss: GITHUB_OIDC_ISSUER,
    aud: AUD,
    iat: nowSec - 30,
    nbf: nowSec - 30,
    exp: nowSec + 270,
    jti: "jti-1",
    sub: "repo:octo/lore:ref:refs/heads/main",
    repository: "octo/lore",
    repository_id: "123456",
    repository_owner: "octo",
    repository_owner_id: "7890",
    run_id: "1111",
    run_attempt: "1",
    actor_id: "42",
    actor: "octo",
    sha: SHA,
    ref: "refs/heads/main",
    ref_protected: "true",
    workflow_ref: "octo/lore/.github/workflows/publish.yml@refs/heads/main",
    job_workflow_ref: "octo/lore/.github/workflows/publish.yml@refs/heads/main",
    event_name: "push",
    ...over,
  };
}

async function sign(
  payload: JWTPayload,
  opts: { key?: Key; kid?: string; alg?: string } = {},
): Promise<string> {
  const clean = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
  return new SignJWT(clean)
    .setProtectedHeader({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "gh-1", typ: "JWT" })
    .sign(opts.key ?? signingKey);
}

const verifyOpts = () => ({ audience: AUD, jwks, now: () => NOW });

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return isCharError(e) ? e.code : `non-char:${String(e)}`;
  }
  return undefined;
}

const binding = (over: Partial<OidcBinding> = {}): OidcBinding => ({
  repository_id: "123456",
  repository_owner_id: "7890",
  publish_refs: ["refs/heads/main", "refs/tags/*"],
  status: "active",
  ...over,
});

describe("verifyGitHubOidcToken", () => {
  it("accepts a valid token and returns only the claims we need", async () => {
    const v = await verifyGitHubOidcToken(await sign(claims()), verifyOpts());
    expect(v.claims).toEqual({
      repository_id: "123456",
      repository_owner_id: "7890",
      sha: SHA,
      ref: "refs/heads/main",
      workflow_ref: "octo/lore/.github/workflows/publish.yml@refs/heads/main",
      job_workflow_ref: "octo/lore/.github/workflows/publish.yml@refs/heads/main",
      run_id: "1111",
      run_attempt: "1",
      actor_id: "42",
      event_name: "push",
      jti: "jti-1",
    });
    expect(v.context).toEqual({ ref_protected: true, repository: "octo/lore" });
    expect(v.expires_at.getTime()).toBe((nowSec + 270) * 1000);
    expect(Object.keys(v.claims)).not.toContain("sub");
  });

  it("keeps the deployment environment and treats a missing ref_protected as false", async () => {
    const v = await verifyGitHubOidcToken(
      await sign(
        claims({ environment: "production", ref_protected: undefined, repository: undefined }),
      ),
      verifyOpts(),
    );
    expect(v.context).toEqual({ ref_protected: false, environment: "production" });
  });

  it("accepts workflow_dispatch and release events", async () => {
    for (const event_name of ["workflow_dispatch", "release"]) {
      const v = await verifyGitHubOidcToken(await sign(claims({ event_name })), verifyOpts());
      expect(v.claims.event_name).toBe(event_name);
    }
  });

  it("accepts tokens within the clock tolerance", async () => {
    // 签发时间比服务器时钟快 50 秒，过期 50 秒前：都在 60 秒容忍内。
    const future = await sign(claims({ iat: nowSec + 50, nbf: nowSec + 50 }));
    await expect(verifyGitHubOidcToken(future, verifyOpts())).resolves.toBeDefined();
    const justExpired = await sign(claims({ iat: nowSec - 300, exp: nowSec - 50 }));
    await expect(verifyGitHubOidcToken(justExpired, verifyOpts())).resolves.toBeDefined();
  });

  it.each([
    ["wrong issuer", { iss: "https://token.actions.example.com" }, "oidc.wrong_issuer"],
    ["missing issuer", { iss: undefined }, "oidc.wrong_issuer"],
    ["wrong audience", { aud: "https://staging-api.char.pub" }, "oidc.wrong_audience"],
    ["audience list without ours", { aud: ["https://example.com"] }, "oidc.wrong_audience"],
    ["expired", { iat: nowSec - 400, exp: nowSec - 61 }, "oidc.expired"],
    ["issued too long ago", { iat: nowSec - 601 - 60, exp: nowSec + 100 }, "oidc.too_old"],
    ["issued in the future", { iat: nowSec + 120, nbf: undefined }, "oidc.issued_in_future"],
    ["not yet valid", { nbf: nowSec + 120 }, "oidc.not_yet_valid"],
    ["missing iat", { iat: undefined }, "oidc.claim_invalid"],
    ["missing exp", { exp: undefined }, "oidc.claim_invalid"],
    ["missing jti", { jti: undefined }, "oidc.claim_invalid"],
    ["pull_request_target", { event_name: "pull_request_target" }, "oidc.event_not_allowed"],
    ["pull_request", { event_name: "pull_request" }, "oidc.event_not_allowed"],
    ["schedule", { event_name: "schedule" }, "oidc.event_not_allowed"],
    ["numeric repository_id", { repository_id: 123456 }, "oidc.claim_invalid"],
    ["numeric owner id", { repository_owner_id: 7890 }, "oidc.claim_invalid"],
    ["leading zero id", { repository_id: "0123" }, "oidc.claim_invalid"],
    ["missing run_id", { run_id: undefined }, "oidc.claim_invalid"],
    ["uppercase sha", { sha: "A".repeat(40) }, "oidc.claim_invalid"],
    ["short sha", { sha: "abc" }, "oidc.claim_invalid"],
    ["missing ref", { ref: undefined }, "oidc.claim_invalid"],
    ["missing event", { event_name: undefined }, "oidc.claim_invalid"],
    ["bad ref_protected", { ref_protected: "yes" }, "oidc.claim_invalid"],
  ])("rejects %s", async (_name, over, code) => {
    expect(await codeOf(verifyGitHubOidcToken(await sign(claims(over)), verifyOpts()))).toBe(code);
  });

  it("rejects a token signed by another key, even with a known kid", async () => {
    const t = await sign(claims(), { key: otherKey });
    expect(await codeOf(verifyGitHubOidcToken(t, verifyOpts()))).toBe("oidc.invalid_signature");
  });

  it("rejects a token whose kid is unknown", async () => {
    const t = await sign(claims(), { kid: "nope" });
    expect(await codeOf(verifyGitHubOidcToken(t, verifyOpts()))).toBe("oidc.invalid_signature");
  });

  it("rejects an unsigned (alg: none) token", async () => {
    const t = new UnsecuredJWT(claims()).encode();
    expect(await codeOf(verifyGitHubOidcToken(t, verifyOpts()))).toBe("oidc.algorithm_not_allowed");
  });

  it("rejects an HS256 token forged with the public key as the HMAC secret", async () => {
    const pub = await exportJWK((await generateKeyPair("RS256", { extractable: true })).publicKey);
    const secret = new TextEncoder().encode(JSON.stringify(pub));
    const t = await new SignJWT(claims())
      .setProtectedHeader({ alg: "HS256", kid: "gh-1" })
      .sign(secret);
    expect(await codeOf(verifyGitHubOidcToken(t, verifyOpts()))).toBe("oidc.algorithm_not_allowed");
  });

  it("rejects an RS512 token even though RS512 is a valid RSA algorithm", async () => {
    const { privateKey: rs512Signer } = await generateKeyPair("RS512");
    const t = await sign(claims(), { alg: "RS512", key: rs512Signer });
    expect(await codeOf(verifyGitHubOidcToken(t, verifyOpts()))).toBe("oidc.algorithm_not_allowed");
  });

  it("rejects garbage", async () => {
    expect(await codeOf(verifyGitHubOidcToken("not-a-jwt", verifyOpts()))).toBe("oidc.malformed");
    expect(await codeOf(verifyGitHubOidcToken("a.b.c", verifyOpts()))).toBe("oidc.malformed");
  });

  it("maps a JWKS fetch timeout and rethrows non-jose errors", async () => {
    const { errors } = await import("jose");
    const timeout = async () => {
      throw new errors.JWKSTimeout();
    };
    const t = await sign(claims());
    expect(
      await codeOf(verifyGitHubOidcToken(t, { audience: AUD, jwks: timeout, now: () => NOW })),
    ).toBe("oidc.jwks_unavailable");
    const boom = async () => {
      throw new Error("network down");
    };
    expect(
      await codeOf(verifyGitHubOidcToken(t, { audience: AUD, jwks: boom, now: () => NOW })),
    ).toBe("non-char:Error: network down");
  });

  it("uses the real clock when none is injected", async () => {
    const real = Math.floor(Date.now() / 1000);
    const t = await sign(claims({ iat: real - 5, nbf: real - 5, exp: real + 60 }));
    await expect(verifyGitHubOidcToken(t, { audience: AUD, jwks })).resolves.toBeDefined();
  });

  it("builds a remote JWKS for GitHub without fetching", () => {
    expect(typeof githubJwks()).toBe("function");
  });
});

describe("refMatches", () => {
  it.each([
    ["refs/heads/main", "refs/heads/main", true],
    ["refs/heads/main", "refs/heads/main2", false],
    ["refs/tags/*", "refs/tags/v1.0.0", true],
    ["refs/tags/*", "refs/tags/a/b", true],
    ["refs/tags/*", "refs/tags/", false],
    ["refs/tags/*", "refs/heads/v1", false],
    ["refs/heads/release/*", "refs/heads/release/1.x", true],
  ])("%s ~ %s → %s", (pattern, ref, ok) => {
    expect(refMatches(pattern, ref)).toBe(ok);
  });

  it.each(["main", "refs/*/main", "refs/tags/v*", "*", "refs/heads/ main", "refs/tags/**"])(
    "rejects invalid pattern %s",
    (pattern) => {
      let code: string | undefined;
      try {
        refMatches(pattern, "refs/heads/main");
      } catch (e) {
        code = isCharError(e) ? e.code : undefined;
      }
      expect(code).toBe("binding.invalid_ref_pattern");
    },
  );
});

describe("matchBinding", () => {
  const verified = async (over: Record<string, unknown> = {}) =>
    verifyGitHubOidcToken(await sign(claims(over)), verifyOpts());
  const matchCode = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      return isCharError(e) ? e.code : "non-char";
    }
    return undefined;
  };

  it("accepts a matching binding, ref and commit", async () => {
    const v = await verified();
    expect(matchCode(() => matchBinding(v, binding(), { commit: SHA }))).toBeUndefined();
    const tag = await verified({ ref: "refs/tags/v1.2.0" });
    expect(matchCode(() => matchBinding(tag, binding(), { commit: SHA }))).toBeUndefined();
  });

  it.each([
    ["no binding", null, {}, "binding.not_found"],
    ["unbound", binding({ status: "unbound" }), {}, "binding.not_found"],
    // 改名劫持：原仓库改名后，别人新建了同名仓库，名字相同但数字 ID 不同。
    [
      "repository re-created under the same name",
      binding({ repository_id: "999999" }),
      {},
      "binding.mismatch",
    ],
    // 仓库被转移给另一个所有者。
    ["owner changed", binding({ repository_owner_id: "1" }), {}, "binding.mismatch"],
    ["frozen after transfer", binding({ status: "frozen" }), {}, "binding.frozen"],
    ["ref not allowed", binding(), { ref: "refs/heads/feature" }, "binding.ref_not_allowed"],
    [
      "ref must be protected",
      binding({ require_ref_protected: true }),
      { ref_protected: "false" },
      "binding.ref_not_protected",
    ],
    [
      "environment required",
      binding({ environment: "release" }),
      {},
      "binding.environment_mismatch",
    ],
    [
      "reusable workflow required",
      binding({ job_workflow_ref: "char-pub/publish/.github/workflows/publish.yml@refs/tags/v1" }),
      {},
      "binding.workflow_mismatch",
    ],
  ])("rejects: %s", async (_name, b, over, code) => {
    const v = await verified(over);
    expect(matchCode(() => matchBinding(v, b, { commit: SHA }))).toBe(code);
  });

  it("accepts the optional constraints when they are met", async () => {
    const wf = "char-pub/publish/.github/workflows/publish.yml@refs/tags/v1";
    const v = await verified({ environment: "release", job_workflow_ref: wf });
    const b = binding({
      require_ref_protected: true,
      environment: "release",
      job_workflow_ref: wf,
    });
    expect(matchCode(() => matchBinding(v, b, { commit: SHA }))).toBeUndefined();
  });

  it("rejects a request for a commit other than the token's sha", async () => {
    const v = await verified();
    expect(matchCode(() => matchBinding(v, binding(), { commit: "b".repeat(40) }))).toBe(
      "oidc.commit_mismatch",
    );
  });
});

describe("authenticateOidcPublish", () => {
  const opts = (over: Partial<OidcPublishOptions> = {}): OidcPublishOptions => ({
    ...verifyOpts(),
    jtiStore: new MemoryJtiStore(() => NOW),
    findBinding: async (id) => (id === "123456" ? binding() : null),
    ...over,
  });

  it("authenticates once and rejects a replay of the same token", async () => {
    const o = opts();
    const t = await sign(claims());
    const r = await authenticateOidcPublish(t, { commit: SHA }, o);
    expect(r.binding.repository_id).toBe("123456");
    expect(await codeOf(authenticateOidcPublish(t, { commit: SHA }, o))).toBe("oidc.replay");
  });

  it("does not consume the jti when the request is rejected", async () => {
    const o = opts();
    const t = await sign(claims());
    expect(await codeOf(authenticateOidcPublish(t, { commit: "c".repeat(40) }, o))).toBe(
      "oidc.commit_mismatch",
    );
    await expect(authenticateOidcPublish(t, { commit: SHA }, o)).resolves.toBeDefined();
  });

  it("rejects a repository that has no binding", async () => {
    const t = await sign(claims({ repository_id: "555" }));
    expect(await codeOf(authenticateOidcPublish(t, { commit: SHA }, opts()))).toBe(
      "binding.not_found",
    );
  });
});

describe("MemoryJtiStore", () => {
  it("forgets entries after they expire", async () => {
    let t = NOW.getTime();
    const store = new MemoryJtiStore(() => new Date(t));
    expect(await store.claim("a", new Date(t + 1000))).toBe(true);
    expect(await store.claim("a", new Date(t + 1000))).toBe(false);
    t += 2000;
    expect(await store.claim("a", new Date(t + 1000))).toBe(true);
  });

  it("uses the real clock by default", async () => {
    const store = new MemoryJtiStore();
    expect(await store.claim("x", new Date(Date.now() + 60_000))).toBe(true);
    expect(await store.claim("x", new Date(Date.now() + 60_000))).toBe(false);
  });
});
