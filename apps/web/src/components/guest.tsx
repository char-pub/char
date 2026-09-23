/**
 * 经验证访客：没有账号的读者用邮箱验证后，可以向允许“所有人”贡献的作品提交修改。
 *
 * 流程：填写邮箱与显示名并通过 Turnstile → 服务端发出一封带一次性链接的邮件 → 打开链接
 * 回到 `/guest/verify`，页面把链接里的 token 交给服务端换取访客会话 → 回到原来的作品页。
 * 访客会话是 API 域名下的 HttpOnly cookie，前端不保存任何凭据；这里只在本地记下验证完成
 * 后要回到哪一页。
 */
import { useQueryClient } from "@tanstack/react-query";
import { MailCheck, UserRound } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type GuestSession, isApiError } from "@/lib/api";
import { keys, useRegistry } from "@/lib/registry";
import { loadTurnstile, TURNSTILE_ACTION, TURNSTILE_SITE_KEY } from "@/lib/turnstile";
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

function TurnstileWidget({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // 回调放进 ref：widget 只渲染一次，不随父组件的重新渲染而重建。
  const cb = useRef(onToken);
  cb.current = onToken;

  useEffect(() => {
    let widgetId: string | undefined;
    let cancelled = false;
    loadTurnstile()
      .then((t) => {
        if (cancelled || !ref.current) return;
        widgetId = t.render(ref.current, {
          sitekey: siteKey,
          action: TURNSTILE_ACTION,
          theme: "auto",
          callback: (token) => cb.current(token),
          "expired-callback": () => cb.current(null),
          "error-callback": () => cb.current(null),
        });
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey]);

  return (
    <div className="space-y-1">
      <div ref={ref} data-testid="turnstile" />
      {failed ? (
        <p role="alert" className="text-sm text-seal">
          The human check could not load. Check your connection and reload the page.
        </p>
      ) : null}
    </div>
  );
}

const REQUEST_ERRORS: Record<string, string> = {
  "turnstile.failed": "The human check did not pass. Try it again.",
  rate_limited: "Too many requests. Wait a while and try again.",
  "email.unavailable": "We could not send the email right now. Try again later.",
  "guest.not_configured": "Guest contributions are not available on this site.",
  "feature.disabled": "Guest contributions are paused at the moment.",
};

/** 申请访客验证的表单。成功后提示去邮箱里打开链接。 */
export function GuestVerificationForm({ returnTo }: { returnTo: string }) {
  const client = useRegistry();
  const ids = { email: useId(), name: useId() };
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ minutes: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 每个 Turnstile token 只能用一次：提交之后换一个新的 widget。
  const [widgetKey, setWidgetKey] = useState(0);

  if (!TURNSTILE_SITE_KEY) {
    return (
      <p className="text-sm text-muted-foreground">
        Guest contributions are not available on this site. Sign in to contribute.
      </p>
    );
  }
  const siteKey = TURNSTILE_SITE_KEY;

  if (sent) {
    return (
      <div role="status" className="flex items-start gap-3 text-sm">
        <MailCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-moss" />
        <p>
          Check your inbox for a message from char.pub and open the link within {sent.minutes}{" "}
          minutes. You will come back here, ready to contribute as a guest.
        </p>
      </div>
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
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-sm text-muted-foreground">
        No account needed. We send you a one-time link; your email address is not shown to anyone
        and is not stored in readable form.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={ids.email} className="text-sm">
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
        <div className="space-y-1">
          <label htmlFor={ids.name} className="text-sm">
            Name shown with your contributions
          </label>
          <Input
            id={ids.name}
            value={name}
            maxLength={64}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </div>
      <TurnstileWidget key={widgetKey} siteKey={siteKey} onToken={setToken} />
      <Button type="submit" disabled={!valid || !token || busy}>
        Send the link
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-seal">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** 当前的访客身份与退出按钮。 */
export function GuestIdentity({ session }: { session: GuestSession }) {
  const client = useRegistry();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm">
      <UserRound aria-hidden className="size-4 text-muted-foreground" />
      <span>
        Contributing as <UserText text={session.guest.display_name} />{" "}
        <span className="stamp border-rule">guest</span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await client.guestSignOut();
          } finally {
            setBusy(false);
            await qc.invalidateQueries({ queryKey: keys.guest });
          }
        }}
      >
        Sign out as guest
      </Button>
    </p>
  );
}
