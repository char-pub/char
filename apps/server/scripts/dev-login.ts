/**
 * 本地开发的登录辅助（`pnpm dev:login <name>`）：不需要配置 OAuth app，直接在本地数据库里
 * 建用户（已存在则复用）与 Better Auth 会话，按 Better Auth 的规则签名 cookie，并打印在
 * 浏览器里设置 cookie 的一行代码。
 *
 * 只连接 docker compose 的本地数据库，并且拒绝在 `NODE_ENV=production` 下运行。
 */
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { makeSignature } from "better-auth/crypto";
import pg from "pg";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const LOCAL_DB = "postgres://charpub_owner:charpub_owner_local@127.0.0.1:54329/charpub";
const SESSION_COOKIE = "__Host-charpub.session";
/** 与 `pnpm dev` 使用同样的端口设置。 */
const WEB_ORIGIN = `http://localhost:${process.env.DEV_WEB_PORT ?? 5173}`;
const API_URL = `http://127.0.0.1:${process.env.DEV_API_PORT ?? 3000}`;

function sessionSecret(): string {
  const env = `${ROOT}.env`;
  if (existsSync(env)) process.loadEnvFile(env);
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  const state = `${ROOT}.dev/state.json`;
  if (!existsSync(state)) throw new Error("run `pnpm dev` once first (it creates .dev/state.json)");
  return (JSON.parse(readFileSync(state, "utf8")) as { betterAuthSecret: string }).betterAuthSecret;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production")
    throw new Error("dev:login is for local development only");
  const name = process.argv[2]?.trim();
  if (!name || !/^[a-z0-9][a-z0-9-]{0,38}$/.test(name)) {
    throw new Error("usage: pnpm dev:login <name>   (lowercase letters, digits and dashes)");
  }
  const secret = sessionSecret();
  const email = `${name}@example.test`;
  const token = randomBytes(24).toString("base64url");

  const db = new pg.Client({ connectionString: LOCAL_DB });
  await db.connect();
  let userId: string;
  try {
    const existing = await db.query<{ id: string }>(
      "SELECT id FROM app.auth_user WHERE email = $1",
      [email],
    );
    userId = existing.rows[0]?.id ?? randomUUID();
    if (!existing.rows[0]) {
      await db.query(
        "INSERT INTO app.auth_user (id, email, name, email_verified) VALUES ($1, $2, $3, true)",
        [userId, email, name],
      );
    }
    await db.query(
      "INSERT INTO app.auth_session (id, user_id, token, expires_at) VALUES ($1, $2, $3, now() + interval '7 days')",
      [randomUUID(), userId, token],
    );
  } finally {
    await db.end();
  }

  const value = encodeURIComponent(`${token}.${await makeSignature(token, secret)}`);
  const me = await fetch(`${API_URL}/v1/me`, {
    headers: { cookie: `${SESSION_COOKIE}=${value}` },
  }).catch(() => null);
  const check = me?.ok
    ? "session works"
    : `GET /v1/me returned ${me?.status ?? "no response (is pnpm dev running?)"}`;

  process.stdout.write(
    [
      `Signed in as ${name} <${email}> (user ${userId}); ${check}.`,
      `Open ${WEB_ORIGIN}, then run this in the browser console (Chromium or Firefox; they treat localhost as secure):`,
      "",
      `document.cookie = "${SESSION_COOKIE}=${value}; Path=/; Secure; SameSite=Lax; Max-Age=604800"`,
      "",
    ].join("\n"),
  );
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
