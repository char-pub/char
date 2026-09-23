import { describe, expect, it } from "vitest";
import { AuthEnvSchema, authProvidersFromEnv, EnvError, parseEnv } from "../env.js";
import { createAuth, isBanned } from "./better-auth.js";

const base = {
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://api.char.pub",
  AUTH_TRUSTED_ORIGINS: "https://www.char.pub, https://admin.char.pub",
};

describe("auth environment", () => {
  it("parses origins and enables only fully configured providers", () => {
    const env = parseEnv(AuthEnvSchema, {
      ...base,
      GITHUB_CLIENT_ID: "id",
      GITHUB_CLIENT_SECRET: "secret",
    });
    expect(env.AUTH_TRUSTED_ORIGINS).toEqual(["https://www.char.pub", "https://admin.char.pub"]);
    expect(authProvidersFromEnv(env)).toEqual({
      github: { clientId: "id", clientSecret: "secret" },
      discord: undefined,
      google: undefined,
    });
  });

  it("requires client id and secret together", () => {
    try {
      parseEnv(AuthEnvSchema, { ...base, DISCORD_CLIENT_ID: "id" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      expect((e as EnvError).issues.map((i) => i.variable)).toContain("DISCORD_CLIENT_SECRET");
    }
    expect(() => parseEnv(AuthEnvSchema, { ...base, GOOGLE_CLIENT_SECRET: "s" })).toThrow(EnvError);
  });

  it.each([
    ["short secret", { BETTER_AUTH_SECRET: "too-short" }],
    ["origin with a path", { AUTH_TRUSTED_ORIGINS: "https://www.char.pub/app" }],
    ["plain http origin", { AUTH_TRUSTED_ORIGINS: "http://www.char.pub" }],
    ["wildcard origin", { AUTH_TRUSTED_ORIGINS: "https://*.char.pub" }],
    ["empty origin list", { AUTH_TRUSTED_ORIGINS: " , " }],
  ])("rejects %s", (_name, override) => {
    expect(() => parseEnv(AuthEnvSchema, { ...base, ...override })).toThrow(EnvError);
  });

  it("allows http only for localhost during development", () => {
    const env = parseEnv(AuthEnvSchema, { ...base, AUTH_TRUSTED_ORIGINS: "http://localhost:5173" });
    expect(env.AUTH_TRUSTED_ORIGINS).toEqual(["http://localhost:5173"]);
  });
});

describe("ban expiry", () => {
  const now = new Date("2026-09-22T00:00:00Z");
  it.each([
    [{ banned: false }, false],
    [{ banned: null }, false],
    [{ banned: true }, true],
    [{ banned: true, banExpires: null }, true],
    [{ banned: true, banExpires: new Date("2026-09-23T00:00:00Z") }, true],
    [{ banned: true, banExpires: "2026-09-21T00:00:00Z" }, false],
  ])("%o → %s", (u, expected) => {
    expect(isBanned(u, now)).toBe(expected);
  });
});

describe("createAuth", () => {
  it("refuses a weak secret", () => {
    expect(() =>
      createAuth({
        db: {} as never,
        secret: "short",
        baseURL: "https://api.char.pub",
        trustedOrigins: [],
        providers: {},
      }),
    ).toThrow(/32/);
  });
});
