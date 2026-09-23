/**
 * 经验证访客：没有账号的读者用邮箱验证后，可以向允许“所有人”贡献的作品提交修改。
 *
 * 流程：填写邮箱与署名并通过 Turnstile → 服务端发出一封带一次性链接的邮件 → 打开链接
 * 回到 `/guest/verify`，页面把链接里的 token 交给服务端换取访客会话 → 回到原来的作品页。
 * 访客会话是 API 域名下的 HttpOnly cookie，前端不保存任何凭据；这里只在本地记下验证完成
 * 后要回到哪一页。
 *
 * 访客的署名一律是 “guest · 名字”，不能看起来像登录用户。
 */
import { MailCheck } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { useGuestSignOut } from "@/components/account-menu";
import { SignInButton } from "@/components/sign-in";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type GuestSession, isApiError } from "@/lib/api";
import { useRegistry } from "@/lib/registry";
import { formatDate } from "@/lib/text";
import { TURNSTILE_ACTION, TURNSTILE_SITE_KEY } from "@/lib/turnstile";
import { TurnstileWidget } from "./turnstile-widget";
import { UserText } from "./user-content";

const RETURN_KEY = "charpub.guest.return";

/** 记下验证完成后要回到的页面。只接受站内的作品页路径。 */
export function rememberGuestReturn(path: string): void {
  if (path.startsWith("/c/")) window.localStorage.setItem(RETURN_KEY, path);
}

/** 取出并清除验证完成后要回到的页面。 */
export function takeGuestReturn(): string | null {
  const path = window.localStorage.getItem(RETURN_KEY);
  window.localStorage.removeItem(RETURN_KEY);
  return path?.startsWith("/c/") ? path : null;
}

/** 访客在贡献上的署名。 */
export function guestCredit(name: string): string {
  return `guest · ${name}`;
}

const REQUEST_ERRORS: Record<string, string> = {
  "turnstile.failed": "The human check did not pass. Try it again.",
  rate_limited: "Too many requests. Wait a while and try again.",
  "email.unavailable": "We could not send the email right now. Try again later.",
  "guest.not_configured": "Guest contributions are not available on this site.",
  "feature.disabled": "Guest contributions are paused at the moment.",
  "feature.read_only": "char.pub is read-only for maintenance. Try again later.",
};

/**
 * 申请访客验证的表单（放在卡片里，自带标题）。成功后提示去邮箱里打开链接。
 * 构建时没有配置 Turnstile 就不提供访客入口，只能登录。
 */
export function GuestVerificationForm({ returnTo }: { returnTo: string }) {
  const client = useRegistry();
  const ids = { title: useId(), email: useId(), name: useId(), help: useId() };
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ minutes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 每个 Turnstile token 只能用一次：提交之后换一个新的 widget。
  const [widgetKey, setWidgetKey] = useState(0);

  const frame = (body: ReactNode) => (
    <section
      aria-labelledby={ids.title}
      className="space-y-4 rounded-lg border bg-surface p-5 sm:p-6"
    >
      <h3 id={ids.title} className="text-base font-semibold">
        Contribute without an account
      </h3>
      {body}
    </section>
  );

  if (!TURNSTILE_SITE_KEY) {
    return frame(
      <>
        <p className="text-sm text-text-2">
          Guest contributions are not available on this site. Sign in to contribute.
        </p>
        <SignInButton />
      </>,
    );
  }
  const siteKey = TURNSTILE_SITE_KEY;

  if (sent) {
    return frame(
      <div role="status" className="flex items-start gap-3 text-sm">
        <MailCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
        <p>
          Check your inbox for a message from char.pub and open the link within {sent.minutes}{" "}
          minutes. You will come back here, ready to contribute as a guest.
        </p>
      </div>,
    );
  }

  const submit = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await client.requestGuestVerification({
        email: email.trim(),
        display_name: name.trim(),
        turnstile_token: token,
      });
      rememberGuestReturn(returnTo);
      setSent({ minutes: Math.max(1, Math.round(res.expires_in / 60)) });
    } catch (e) {
      setError(
        (isApiError(e) && REQUEST_ERRORS[e.code]) ||
          (isApiError(e, "request.invalid")
            ? "Check the email address and the name."
            : "Something went wrong. Try again."),
      );
      setToken(null);
      setWidgetKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  };

  const valid = /^[^\s@]+@[^\s@]+$/.test(email.trim()) && name.trim().length > 0;
  return frame(
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-sm text-text-2">
        We'll email you a link. Your address is never shown and isn't stored in plain text.
      </p>
      <div className="space-y-1.5">
        <label htmlFor={ids.email} className="block text-sm font-semibold">
          Email
        </label>
        <Input
          id={ids.email}
          type="email"
          autoComplete="email"
          value={email}
          maxLength={254}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={ids.name} className="block text-sm font-semibold">
          Name to credit
        </label>
        <Input
          id={ids.name}
          value={name}
          maxLength={64}
          aria-describedby={ids.help}
          onChange={(e) => setName(e.target.value)}
        />
        <p id={ids.help} className="text-xs text-text-3">
          Shown as “<UserText text={guestCredit(name.trim() || "your name")} />
          ”, never as a signed-in user.
        </p>
      </div>
      <TurnstileWidget
        key={widgetKey}
        siteKey={siteKey}
        action={TURNSTILE_ACTION}
        onToken={setToken}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!valid || !token || busy}>
          <MailCheck aria-hidden /> Email me a link
        </Button>
        <SignInButton variant="link">or sign in</SignInButton>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </form>,
  );
}

/** 当前的访客身份卡：有效期、署名方式和退出按钮。 */
export function GuestIdentityCard({ session }: { session: GuestSession }) {
  const { signOutGuest, busy } = useGuestSignOut();
  const name = session.guest.display_name;
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-2 rounded-lg border bg-surface p-5">
      <h3 id={id} className="text-sm font-semibold">
        Contributing as a guest
      </h3>
      <p className="text-sm text-text-2">
        Verified as <UserText text={name} /> until {formatDate(session.session_expires_at)}. You'll
        be credited as “<UserText text={guestCredit(name)} />
        ”, never as a signed-in user.
      </p>
      <Button
        type="button"
        variant="link"
        className="h-auto px-0"
        disabled={busy}
        onClick={() => void signOutGuest()}
      >
        Sign out as guest
      </Button>
    </section>
  );
}
