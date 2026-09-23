/**
 * 创作者登录：使用 Better Auth 官方的 React 客户端，接口在 API 的 `/v1/auth` 下。
 *
 * 登录只有第三方账号（GitHub / Discord / Google）。会话保存在 API 域名下的 HttpOnly
 * cookie 中，前端不接触任何凭据；登录状态以 `GET /v1/me` 为准。
 */
import { createAuthClient } from "better-auth/react";
import { API_BASE_URL } from "./api";

export const PROVIDERS = [
  { id: "github", label: "GitHub" },
  { id: "discord", label: "Discord" },
  { id: "google", label: "Google" },
] as const;
export type ProviderId = (typeof PROVIDERS)[number]["id"];

type AuthClient = ReturnType<typeof createAuthClient>;
let client: AuthClient | undefined;

function auth(): AuthClient {
  client ??= createAuthClient({
    baseURL: API_BASE_URL || window.location.origin,
    basePath: "/v1/auth",
  });
  return client;
}

/** 登录失败时给用户看的说明；不暴露内部错误信息。 */
export class SignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignInError";
  }
}

/**
 * 跳转到第三方登录。成功时浏览器离开当前页面，回来后停在 `returnTo`；
 * 服务端没有配置这个登录方式时抛出 `SignInError`。
 */
export async function signInWith(provider: ProviderId, returnTo: string): Promise<void> {
  const label = PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
  const origin = window.location.origin;
  let result: Awaited<ReturnType<AuthClient["signIn"]["social"]>>;
  try {
    result = await auth().signIn.social({
      provider,
      callbackURL: `${origin}${returnTo}`,
      errorCallbackURL: `${origin}/?signin_error=1`,
    });
  } catch {
    throw new SignInError("Could not reach the sign-in service. Try again in a moment.");
  }
  if (result.error) {
    if (result.error.status === 404 || result.error.code === "PROVIDER_NOT_FOUND") {
      throw new SignInError(`${label} sign-in is not available on this server yet.`);
    }
    if (result.error.status === 429) {
      throw new SignInError("Too many sign-in attempts. Wait a minute and try again.");
    }
    throw new SignInError(`${label} sign-in failed. Try again or use another account.`);
  }
}

export async function signOut(): Promise<void> {
  await auth().signOut();
}
