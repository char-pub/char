/**
 * Cloudflare Turnstile：访客验证前的人机校验。
 *
 * 脚本按需加载（显式渲染模式），只在访客验证表单出现时才请求 challenges.cloudflare.com。
 * 服务端要求 widget 的 action 是 `guest_verification`，并校验 hostname。site key 来自
 * 构建时的 `VITE_TURNSTILE_SITE_KEY`；没有配置时前端不提供访客验证入口。
 */
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export const TURNSTILE_ACTION = "guest_verification";

export const TURNSTILE_SITE_KEY: string | undefined =
  (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || undefined;

export interface TurnstileRenderOptions {
  sitekey: string;
  action: string;
  callback: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
  theme?: "auto" | "light" | "dark";
}

export interface TurnstileApi {
  render(el: HTMLElement, opts: TurnstileRenderOptions): string;
  reset(widgetId?: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | undefined;

export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error("turnstile did not load"));
    };
    script.onerror = () => {
      loading = undefined;
      reject(new Error("turnstile did not load"));
    };
    document.head.appendChild(script);
  });
  return loading;
}
