/**
 * 访客验证邮件里的链接指向这里：`/guest/verify#token=…`。token 放在 fragment 里，不会
 * 出现在服务器日志和 Referer 中；读出之后立即从地址栏清除，再交给服务端换取访客会话。
 * token 只能用一次，所以同一个页面只提交一次。验证成功后自动回到申请验证时所在的作品页。
 */
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Compass, LoaderCircle, MailCheck, MailX, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { takeGuestReturn } from "@/components/guest";
import { StatePanel } from "@/components/states";
import { buttonVariants } from "@/components/ui/button";
import { UserText } from "@/components/user-content";
import { type GuestSession, isApiError } from "@/lib/api";
import { keys, useRegistry } from "@/lib/registry";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/guest/verify")({ component: GuestVerifyRoute });

const ERRORS: Record<string, string> = {
  "guest.token_invalid": "This link has expired or was already used. Request a new one.",
  "guest.disabled": "This guest identity has been disabled.",
  rate_limited: "Too many attempts. Wait a while and open the link again.",
  "guest.not_configured": "Guest contributions are not available on this site.",
  "feature.disabled": "Guest contributions are paused at the moment.",
  "feature.read_only": "char.pub is read-only for maintenance. Open the link again later.",
};

/** 服务端暂停了访客功能：说“暂时不可用”，不当成链接本身的问题。 */
const PAUSED = new Set(["guest.not_configured", "feature.disabled", "feature.read_only"]);

function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn(className, "motion-safe:animate-spin")} />;
}

function readToken(): string | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = params.get("token");
  if (token) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return token;
}

type State =
  | { kind: "working" }
  | { kind: "done"; session: GuestSession; next: string | null }
  | { kind: "error"; message: string; code: string | null; paused: boolean };

function GuestVerifyRoute() {
  const client = useRegistry();
  const qc = useQueryClient();
  const router = useRouter();
  const started = useRef(false);
  const [state, setState] = useState<State>({ kind: "working" });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = readToken();
    if (!token) {
      setState({
        kind: "error",
        message: "This link is incomplete. Open it from the email again.",
        code: null,
        paused: false,
      });
      return;
    }
    client
      .confirmGuest(token)
      .then((session) => {
        qc.setQueryData(keys.guest, session);
        const next = takeGuestReturn();
        setState({ kind: "done", session, next });
        if (next) router.history.push(next);
      })
      .catch((e: unknown) => {
        const code = isApiError(e) ? e.code : null;
        setState({
          kind: "error",
          message: (code && ERRORS[code]) || "The link could not be verified. Try again later.",
          code,
          paused: !!code && PAUSED.has(code),
        });
      });
  }, [client, qc, router]);

  const explore = (
    <Link to="/browse" className={buttonVariants({ variant: "outline" })}>
      <Compass aria-hidden /> Explore the registry
    </Link>
  );

  return (
    <div className="mx-auto w-full max-w-xl py-10">
      {state.kind === "working" ? (
        <StatePanel
          level={1}
          icon={Spinner}
          tone="blue"
          title="Checking your link…"
          description="This takes a moment. Keep this page open."
        />
      ) : state.kind === "done" ? (
        <StatePanel
          level={1}
          icon={MailCheck}
          tone="primary"
          title={
            <>
              You are verified as <UserText text={state.session.guest.display_name} />
            </>
          }
          description={
            state.next
              ? "Taking you back to where you were…"
              : "You can now contribute to creations that accept contributions from anyone. Your contributions are credited as a guest."
          }
        >
          {state.next ? null : explore}
        </StatePanel>
      ) : (
        <StatePanel
          level={1}
          icon={state.paused ? Wrench : MailX}
          tone={state.paused ? "blue" : "danger"}
          title={state.paused ? "Temporarily unavailable" : "This link did not work"}
          description={
            <>
              <p role="alert">{state.message}</p>
              {state.code ? (
                <p className="mt-2 font-mono text-xs text-text-3">{state.code}</p>
              ) : null}
            </>
          }
        >
          {explore}
        </StatePanel>
      )}
    </div>
  );
}
