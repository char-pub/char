/**
 * 登录对话框：GitHub / Discord / Google 三种第三方账号，没有密码。
 *
 * 整个应用只有一个对话框，由 `SignInProvider`（挂在 Layout 里）持有；任何地方调用
 * `useSignIn()` 返回的函数都会打开它。`SignInButton` 在没有 Provider 的地方（例如单独渲染
 * 的组件测试）会自带一个对话框，所以放在哪里都能用。
 *
 * 登录成功时浏览器跳到第三方再回到当前页面；失败时回到首页并带上 `signin_error`，
 * 由 Layout 顶部的提示条说明。
 */
import { useRouterState } from "@tanstack/react-router";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { PROVIDERS, type ProviderId, SignInError, signInWith } from "@/lib/auth";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

const SignInContext = createContext<(() => void) | null>(null);

/** 登录后要回到的地址：当前页面，去掉上一次登录失败留下的 `signin_error`。 */
function useReturnTo(): string {
  return useRouterState({
    select: (s) => {
      const params = new URLSearchParams(s.location.searchStr);
      params.delete("signin_error");
      const search = params.toString();
      return `${s.location.pathname}${search ? `?${search}` : ""}${s.location.hash ? `#${s.location.hash}` : ""}`;
    },
  });
}

/** 直接跳转到某个登录方式；失败时返回给用户看的说明。 */
export function useStartSignIn() {
  const returnTo = useReturnTo();
  const [busy, setBusy] = useState<ProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = async (provider: ProviderId) => {
    setError(null);
    setBusy(provider);
    try {
      await signInWith(provider, returnTo);
    } catch (e) {
      setError(e instanceof SignInError ? e.message : "Sign-in failed. Try again.");
    } finally {
      setBusy(null);
    }
  };
  return { start, busy, error, reset: () => setError(null) };
}

export function SignInDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { start, busy, error, reset } = useStartSignIn();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="w-[min(26rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>Sign in to char.pub</DialogTitle>
          <DialogDescription>No password. Pick the account you already use.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2.5">
          {PROVIDERS.map((p) => (
            <Button
              key={p.id}
              variant="outline"
              size="lg"
              className="w-full"
              disabled={busy !== null}
              onClick={() => void start(p.id)}
            >
              {busy === p.id ? `Opening ${p.label}…` : `Continue with ${p.label}`}
            </Button>
          ))}
        </div>
        {error ? (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <p className="text-xs text-text-3">
          We never link accounts by email, so sign in with the same account each time.
        </p>
      </DialogContent>
    </Dialog>
  );
}

/** 在应用里提供唯一的登录对话框。 */
export function SignInProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  return (
    <SignInContext.Provider value={show}>
      {children}
      <SignInDialog open={open} onOpenChange={setOpen} />
    </SignInContext.Provider>
  );
}

/**
 * 返回一个打开登录对话框的函数。必须在 `SignInProvider` 里使用；
 * 不确定有没有 Provider 时用 `SignInButton`。
 */
export function useSignIn(): () => void {
  const show = useContext(SignInContext);
  if (!show) throw new Error("useSignIn() must be used inside <SignInProvider>");
  return show;
}

/**
 * 打开登录对话框的按钮。默认文案 “Sign in”；样式参数和 `Button` 相同。
 *
 * ```tsx
 * <SignInButton />                          // 橙色主按钮
 * <SignInButton variant="outline" size="sm" />  // 顶栏
 * ```
 */
export function SignInButton({
  children = "Sign in",
  onClick,
  ...props
}: ComponentProps<typeof Button>) {
  const shared = useContext(SignInContext);
  const [open, setOpen] = useState(false);
  const show = useMemo(() => shared ?? (() => setOpen(true)), [shared]);
  return (
    <>
      <Button
        {...props}
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented) show();
        }}
      >
        {children}
      </Button>
      {shared ? null : <SignInDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}
