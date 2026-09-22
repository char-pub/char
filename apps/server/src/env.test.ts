import { describe, expect, it } from "vitest";
import {
  DatabaseEnvSchema,
  EnvError,
  MigrationEnvSchema,
  parseEnv,
  ServerEnvSchema,
  StorageEnvSchema,
} from "./env.js";

const storage = {
  S3_ENDPOINT: "http://127.0.0.1:59000",
  S3_ACCESS_KEY_ID: "local",
  S3_SECRET_ACCESS_KEY: "local-secret",
  S3_BUCKET_PUBLIC: "p",
  S3_BUCKET_PRIVATE: "q",
  S3_BUCKET_UPLOADS: "u",
  S3_BUCKET_EVIDENCE: "e",
  PUBLIC_ASSETS_BASE_URL: "https://assets.example.test",
};

describe("parseEnv", () => {
  it("parses and applies defaults", () => {
    const env = parseEnv(ServerEnvSchema, {
      DATABASE_URL: "postgres://app@localhost:5432/charpub",
      ...storage,
    });
    expect(env.DATABASE_POOL_MAX).toBe(10);
    expect(env.S3_REGION).toBe("auto");
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe("development");
  });

  it("coerces numeric variables", () => {
    const env = parseEnv(DatabaseEnvSchema, {
      DATABASE_URL: "postgres://app@localhost/charpub",
      DATABASE_POOL_MAX: "20",
    });
    expect(env.DATABASE_POOL_MAX).toBe(20);
  });

  it("fails fast and names every missing variable", () => {
    try {
      parseEnv(StorageEnvSchema, {});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      const vars = (e as EnvError).issues.map((i) => i.variable);
      expect(vars).toContain("S3_ENDPOINT");
      expect(vars).toContain("S3_SECRET_ACCESS_KEY");
      expect((e as EnvError).issues.find((i) => i.variable === "S3_ENDPOINT")?.message).toBe(
        "missing",
      );
    }
  });

  it("treats empty strings as missing", () => {
    expect(() => parseEnv(DatabaseEnvSchema, { DATABASE_URL: "" })).toThrow(EnvError);
  });

  it("never echoes variable values in the error message", () => {
    const secret = "super-secret-value-123";
    try {
      parseEnv(StorageEnvSchema, { ...storage, S3_ENDPOINT: secret });
      expect.unreachable();
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(secret);
    }
  });

  it("validates the app role name used by migrations", () => {
    expect(
      parseEnv(MigrationEnvSchema, { DATABASE_MIGRATION_URL: "postgres://o@localhost/db" })
        .DATABASE_APP_ROLE,
    ).toBe("charpub_app");
    expect(() =>
      parseEnv(MigrationEnvSchema, {
        DATABASE_MIGRATION_URL: "postgres://o@localhost/db",
        DATABASE_APP_ROLE: "bad role;",
      }),
    ).toThrow(EnvError);
  });
});
