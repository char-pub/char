/**
 * 全站提示条，显示在顶栏下方、页面内容之上：
 * - 全站只读：服务端关闭了写入（`feature.read_only`），可以浏览和下载，编辑和发布暂停。
 * - 登录失败：第三方登录没有完成时，Better Auth 带着 `signin_error` 回到首页。
 */
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { CircleAlert, Wrench, X } from "lucide-react";
import { useReadOnly } from "@/lib/read-only";
import { useSignIn } from "./sign-in";
import { Button } from "./ui/button";

function ReadOnlyBanner() {
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-lg bg-blue-soft px-4 py-2.5 text-sm text-blue-text"
    >
      <Wrench aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p>
        char.pub is read-only for maintenance. You can browse and download; editing and publishing
        are paused.
      </p>
    </div>
  );
}

function SignInErrorNotice() {
  const navigate = useNavigate();
  const openSignIn = useSignIn();
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-danger-soft px-4 py-2.5 text-sm text-text"
    >
      <CircleAlert aria-hidden className="size-4 shrink-0 text-danger" />
      <p className="min-w-0 flex-1">
        Sign-in did not complete. You can try again, or use another account.
      </p>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" onClick={openSignIn}>
          Try again
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Dismiss"
          onClick={() =>
            void navigate({
              to: ".",
              search: (prev: Record<string, unknown>) => {
                const { signin_error: _, ...rest } = prev;
                return rest;
              },
              replace: true,
            })
          }
        >
          <X aria-hidden />
        </Button>
      </div>
    </div>
  );
}

export function GlobalNotices() {
  const readOnly = useReadOnly();
  const signInFailed = useRouterState({
    select: (s) => "signin_error" in (s.location.search as Record<string, unknown>),
  });
  if (!readOnly && !signInFailed) return null;
  return (
    <div className="mx-auto w-full max-w-[75rem] space-y-2 px-4 pt-4 md:px-8">
      {readOnly ? <ReadOnlyBanner /> : null}
      {signInFailed ? <SignInErrorNotice /> : null}
    </div>
  );
}
