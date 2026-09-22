import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { type AccessConfig, verifyAccessJwt } from "./access.js";

const TEAM = "https://char-pub.cloudflareaccess.com";
const AUD = "aud-tag-for-admin";
const NOW = new Date("2026-09-22T12:00:00Z");

let cfg: AccessConfig;
/** 另一把密钥，用于伪造签名的测试。 */
let otherKey: CryptoKey;
let sign: (
  claims: Record<string, unknown>,
  opts?: { alg?: string; key?: CryptoKey; kid?: string },
) => Promise<string>;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const other = await generateKeyPair("RS256", { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  cfg = {
    teamDomain: `${TEAM}/`,
    audience: AUD,
    allowedEmails: new Set(["staff@char.pub"]),
    jwks: createLocalJWKSet({ keys: [jwk] }),
    now: () => NOW,
  };
  sign = async (claims, opts = {}) => {
    const iat = Math.floor(NOW.getTime() / 1000);
    return new SignJWT({
      iss: TEAM,
      aud: AUD,
      sub: "u1",
      email: "Staff@char.pub",
      iat,
      exp: iat + 3600,
      ...claims,
    })
      .setProtectedHeader({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1" })
      .sign(opts.key ?? privateKey);
  };
  otherKey = other.privateKey;
});

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}

describe("Cloudflare Access JWT", () => {
  it("accepts a valid token from an allowed staff member (email is case-insensitive)", async () => {
    expect(await verifyAccessJwt(await sign({}), cfg)).toEqual({
      email: "staff@char.pub",
      sub: "u1",
    });
  });

  it("rejects a missing header", async () => {
    expect(await codeOf(verifyAccessJwt(undefined, cfg))).toBe("access.missing");
  });

  it("rejects a token signed by another key", async () => {
    expect(await codeOf(verifyAccessJwt(await sign({}, { key: otherKey }), cfg))).toBe(
      "access.invalid",
    );
  });

  it("rejects wrong audience or issuer", async () => {
    expect(await codeOf(verifyAccessJwt(await sign({ aud: "another-app" }), cfg))).toBe(
      "access.claim_invalid",
    );
    expect(
      await codeOf(verifyAccessJwt(await sign({ iss: "https://evil.cloudflareaccess.com" }), cfg)),
    ).toBe("access.claim_invalid");
  });

  it("rejects expired tokens", async () => {
    const past = Math.floor(NOW.getTime() / 1000) - 7200;
    expect(await codeOf(verifyAccessJwt(await sign({ iat: past, exp: past + 60 }), cfg))).toBe(
      "access.expired",
    );
  });

  it("rejects people who are not on the staff list, and tokens without email", async () => {
    expect(await codeOf(verifyAccessJwt(await sign({ email: "someone@example.com" }), cfg))).toBe(
      "access.not_staff",
    );
    expect(await codeOf(verifyAccessJwt(await sign({ email: undefined }), cfg))).toBe(
      "access.claim_invalid",
    );
  });

  it("rejects alg=none and garbage", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({ iss: TEAM, aud: AUD, email: "staff@char.pub", sub: "u1" }),
    ).toString("base64url");
    expect(await codeOf(verifyAccessJwt(`${header}.${body}.`, cfg))).toBe("access.invalid");
    expect(await codeOf(verifyAccessJwt("not-a-jwt", cfg))).toBe("access.invalid");
  });
});
