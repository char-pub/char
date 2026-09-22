/**
 * 测试文件使用的数据库与存储工具。
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";
import { createDatabase, type Database } from "../src/db/client.js";
import type { StorageEnv } from "../src/env.js";
import { Cas, casConfigFromEnv } from "../src/storage/cas.js";
import { APP, BUCKETS, MINIO_PASSWORD, MINIO_USER, OWNER, TEMPLATE_DB } from "./global-setup.js";

export interface TestDatabase {
  name: string;
  /** 应用角色（非 owner）的连接串。 */
  appUrl: string;
  /** owner 角色的连接串。 */
  ownerUrl: string;
  app: Database;
  owner: Database;
  drop(): Promise<void>;
}

function url(user: { user: string; password: string }, db: string): string {
  return `postgres://${user.user}:${encodeURIComponent(user.password)}@${inject("pgHost")}:${inject("pgPort")}/${db}`;
}

/** 从模板复制一个全新的数据库，只给当前测试文件使用。 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `t_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: url(OWNER, "postgres") });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DB} OWNER ${OWNER.user}`);
  await admin.query(`GRANT CONNECT ON DATABASE ${name} TO ${APP.user}`);
  await admin.end();

  const appUrl = url(APP, name);
  const ownerUrl = url(OWNER, name);
  const app = createDatabase(appUrl, { max: 5 });
  const owner = createDatabase(ownerUrl, { max: 2 });
  return {
    name,
    appUrl,
    ownerUrl,
    app,
    owner,
    async drop() {
      await Promise.all([app.close(), owner.close()]);
      const c = new pg.Client({ connectionString: url(OWNER, "postgres") });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}

export function testStorageEnv(): StorageEnv {
  return {
    S3_ENDPOINT: inject("s3Endpoint"),
    S3_REGION: "us-east-1",
    S3_ACCESS_KEY_ID: MINIO_USER,
    S3_SECRET_ACCESS_KEY: MINIO_PASSWORD,
    S3_BUCKET_PUBLIC: BUCKETS.public,
    S3_BUCKET_PRIVATE: BUCKETS.private,
    S3_BUCKET_UPLOADS: BUCKETS.uploads,
    S3_BUCKET_EVIDENCE: BUCKETS.evidence,
    PUBLIC_ASSETS_BASE_URL: `${inject("s3Endpoint")}/${BUCKETS.public}`,
  };
}

export function testCas(): Cas {
  return new Cas(casConfigFromEnv(testStorageEnv()));
}

/** 捕获 Postgres 错误码（例如 42501 = 权限不足）。 */
export async function pgErrorCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.code ?? e.cause?.code;
  }
}
