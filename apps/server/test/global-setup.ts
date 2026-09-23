/**
 * 集成测试的全局准备：启动一次 Postgres 与 MinIO 容器，运行迁移，
 * 把迁移好的数据库作为模板（template）。
 *
 * 隔离方式：每个测试文件调用 `createTestDatabase()`，从模板复制出一个全新的数据库
 * （`CREATE DATABASE … TEMPLATE`，毫秒级）。这样每个文件都有独立的业务表、审计链和
 * pg-boss 队列，文件之间可以并行，互不干扰。MinIO 的桶是共享的，但对象 key 由内容
 * 决定，测试之间不会冲突。
 *
 * 这里的口令只在本机临时容器中使用，测试结束后容器即被销毁。
 */
import { CreateBucketCommand, PutBucketPolicyCommand, S3Client } from "@aws-sdk/client-s3";
import { MinioContainer, type StartedMinioContainer } from "@testcontainers/minio";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import type { TestProject } from "vitest/node";
import { runMigrations } from "../src/db/migrate.js";

export const OWNER = { user: "charpub_owner", password: "owner-local-test" };
export const APP = { user: "charpub_app", password: "app-local-test" };
export const TEMPLATE_DB = "charpub_template";
export const MINIO_USER = "charpub-test";
export const MINIO_PASSWORD = "charpub-test-password";
export const BUCKETS = {
  public: "charpub-test-public",
  private: "charpub-test-private",
  uploads: "charpub-test-uploads",
  evidence: "charpub-test-evidence",
} as const;

declare module "vitest" {
  export interface ProvidedContext {
    pgHost: string;
    pgPort: number;
    s3Endpoint: string;
  }
}

let postgres: StartedPostgreSqlContainer | undefined;
let minio: StartedMinioContainer | undefined;

function url(user: { user: string; password: string }, host: string, port: number, db: string) {
  return `postgres://${user.user}:${encodeURIComponent(user.password)}@${host}:${port}/${db}`;
}

/**
 * 启动容器，失败时再试一次。Testcontainers 等待端口映射的时限固定为 10 秒，Docker 负载高时
 * 偶尔会超时；这类失败与被测代码无关，重试一次足以区分偶发与真正的环境问题。
 */
async function startWithRetry<T>(start: () => Promise<T>): Promise<T> {
  try {
    return await start();
  } catch (e) {
    process.stderr.write(`container start failed, retrying once: ${String(e)}\n`);
    return start();
  }
}

export default async function setup(project: TestProject) {
  [postgres, minio] = await Promise.all([
    startWithRetry(() =>
      new PostgreSqlContainer("postgres:18-bookworm")
        .withDatabase("postgres")
        .withUsername("postgres")
        .withPassword("superuser-local-test")
        .withEnvironment({ POSTGRES_INITDB_ARGS: "--encoding=UTF8 --locale=en_US.UTF-8" })
        .start(),
    ),
    startWithRetry(() =>
      new MinioContainer("quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z")
        .withUsername(MINIO_USER)
        .withPassword(MINIO_PASSWORD)
        .start(),
    ),
  ]);

  const host = postgres.getHost();
  const port = postgres.getPort();
  const admin = new pg.Client({ connectionString: postgres.getConnectionUri() });
  await admin.connect();
  // owner 可以建库（每个测试文件复制一份模板库），但不是超级用户，与线上一致。
  await admin.query(`CREATE ROLE ${OWNER.user} LOGIN CREATEDB PASSWORD '${OWNER.password}'`);
  await admin.query(`CREATE ROLE ${APP.user} LOGIN PASSWORD '${APP.password}'`);
  // 仅测试需要：测试结束时强制删除每个文件的临时数据库，要能断开应用角色残留的连接。
  await admin.query(`GRANT pg_signal_backend TO ${OWNER.user}`);
  await admin.query(`CREATE DATABASE ${TEMPLATE_DB} OWNER ${OWNER.user}`);
  await admin.end();

  await runMigrations({
    connectionString: url(OWNER, host, port, TEMPLATE_DB),
    appRole: APP.user,
  });

  const s3 = new S3Client({
    endpoint: minio.getConnectionUrl(),
    region: "us-east-1",
    credentials: { accessKeyId: MINIO_USER, secretAccessKey: MINIO_PASSWORD },
    forcePathStyle: true,
  });
  for (const b of Object.values(BUCKETS)) {
    await s3.send(new CreateBucketCommand({ Bucket: b }));
  }
  // public 桶允许匿名读取，模拟 CDN 直出；其他桶保持私有。
  await s3.send(
    new PutBucketPolicyCommand({
      Bucket: BUCKETS.public,
      Policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { AWS: ["*"] },
            Action: ["s3:GetObject"],
            Resource: [`arn:aws:s3:::${BUCKETS.public}/*`],
          },
        ],
      }),
    }),
  );
  s3.destroy();

  project.provide("pgHost", host);
  project.provide("pgPort", port);
  project.provide("s3Endpoint", minio.getConnectionUrl());

  return async () => {
    await Promise.all([postgres?.stop(), minio?.stop()]);
  };
}
