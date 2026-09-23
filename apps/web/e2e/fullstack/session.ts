/**
 * 测试登录：直接在数据库里建用户与 Better Auth 会话，按 Better Auth 的规则签名 cookie，
 * 跳过第三方 OAuth。只用于本地端到端测试。
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { BrowserContext } from "@playwright/test";
import { makeSignature } from "better-auth/crypto";
import pg from "pg";
import { DB_NAME, pgUrl, STATE_FILE, type StackState, WEB_ORIGIN } from "./stack";

const OWNER = { user: "charpub_owner", password: "charpub_owner_local" };
const SESSION_COOKIE = "__Host-charpub.session";

export function stackState(): StackState {
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as StackState;
}

export async function signInAs(context: BrowserContext, name: string): Promise<string> {
  const { secret } = stackState();
  const userId = randomUUID();
  const token = randomBytes(24).toString("base64url");
  const db = new pg.Client({ connectionString: pgUrl(OWNER, DB_NAME) });
  await db.connect();
  try {
    await db.query(
      "INSERT INTO app.auth_user (id, email, name, email_verified) VALUES ($1, $2, $3, true)",
      [userId, `${userId}@example.test`, name],
    );
    await db.query(
      "INSERT INTO app.auth_session (id, user_id, token, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')",
      [randomUUID(), userId, token],
    );
  } finally {
    await db.end();
  }
  const signed = `${token}.${await makeSignature(token, secret)}`;
  // `__Host-` cookie 必须是 Secure、不带 Domain。Chromium 把 localhost 当作安全来源，
  // 这样的 cookie 也会随 http://localhost 的请求发送；设置时用 https 的地址。
  await context.addCookies([
    {
      name: SESSION_COOKIE,
      value: encodeURIComponent(signed),
      url: WEB_ORIGIN.replace(/^http:/, "https:"),
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  return userId;
}
