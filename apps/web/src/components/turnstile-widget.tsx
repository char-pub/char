import { useEffect, useRef, useState } from "react";
import { loadTurnstile } from "@/lib/turnstile";

/**
 * Cloudflare Turnstile 人机校验。`action` 必须和服务端对这个表单要求的一致（访客验证用
 * `TURNSTILE_ACTION`，匿名举报用 `REPORT_TURNSTILE_ACTION`），否则 token 会被拒绝。
 *
 * 每个 token 只能用一次：提交之后用新的 `key` 重新挂载组件，换一个新的 widget。
 */
export function TurnstileWidget({
  siteKey,
  action,
  onToken,
}: {
  siteKey: string;
  action: string;
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
          action,
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
  }, [siteKey, action]);

  return (
    <div className="space-y-1">
      <div ref={ref} data-testid="turnstile" />
      {failed ? (
        <p role="alert" className="text-sm text-danger">
          The human check could not load. Check your connection and reload the page.
        </p>
      ) : null}
    </div>
  );
}
