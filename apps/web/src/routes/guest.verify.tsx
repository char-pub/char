/**
 * 访客验证邮件里的链接指向这里：`/guest/verify#token=…`。token 放在 fragment 里，不会
 * 出现在服务器日志和 Referer 中；读出之后立即从地址栏清除，再交给服务端换取访客会话。
 * token 只能用一次，所以同一个页面只提交一次。
 */
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { takeGuestReturn } from "@/components/guest";
import { UserText } from "@/components/user-content";
import { type GuestSession, isApiError } from "@/lib/api";
import { keys, useRegistry } from "@/lib/registry";

export const Route = createFileRoute("/guest/verify")({ component: GuestVerifyRoute });

const ERRORS: Record<string, string> = {
  "guest.token_invalid": "This link has expired or was already used. Request a new one.",
  "guest.disabled": "This guest identity has been disabled.",
  rate_limited: "Too many attempts. Wait a while and open the link again.",
  "guest.not_configured": "Guest contributions are not available on this site.",
  "feature.disabled": "Guest contributions are paused at the moment.",
};

function readToken(): string | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = params.get("token");
  if (token) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return token;
}

function GuestVerifyRoute() {
  const client = useRegistry();
  const qc = useQueryClient();
  const router = useRouter();
  const started = useRef(false);
  const [state, setState] = useState<
    | { kind: "working" }
    | { kind: "done"; session: GuestSession; next: string | null }
    | { kind: "error"; message: string }
  >({ kind: "working" });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = readToken();
    if (!token) {
      setState({
        kind: "error",
        message: "This link is incomplete. Open it from the email again.",
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
        setState({
          kind: "error",
          message:
            (isApiError(e) && ERRORS[e.code]) || "The link could not be verified. Try again later.",
        });
      });
  }, [client, qc, router]);

  return (
    <section className="max-w-xl space-y-3 py-10">
      <p className="stamp border-seal text-seal">Guest</p>
      {state.kind === "working" ? (
        <h1 className="text-3xl">Checking your link…</h1>
      ) : state.kind === "done" ? (
        <>
          <h1 className="text-3xl">
            You are verified as <UserText text={state.session.guest.display_name} />.
          </h1>
          <p className="text-muted-foreground">
            You can now contribute to creations that accept contributions from anyone.
          </p>
          <Link to="/browse" className="text-sm underline">
            Browse creations
          </Link>
        </>
      ) : (
        <>
          <h1 className="text-3xl">This link did not work.</h1>
          <p role="alert" className="text-muted-foreground">
            {state.message}
          </p>
        </>
      )}
    </section>
  );
}
