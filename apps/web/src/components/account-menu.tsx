/**
 * 顶栏右侧的账号入口。未登录时是“Sign in”菜单（GitHub / Discord / Google）；登录后是
 * 头像菜单：我的作品、设置、Token、退出。登录方式没有在服务端配置时给出明确的提示。
 */
import { useQueryClient } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { KeyRound, LogOut, Settings, SquareLibrary } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PROVIDERS, type ProviderId, SignInError, signInWith, signOut } from "@/lib/auth";
import { refreshPersonalised, useMe } from "@/lib/registry";

function Initials({ name }: { name: string }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return <span aria-hidden>{letters || "?"}</span>;
}

export function AccountMenu() {
  const me = useMe();
  const qc = useQueryClient();
  const href = useRouterState({ select: (s) => s.location.href });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async (provider: ProviderId) => {
    setError(null);
    setBusy(true);
    try {
      await signInWith(provider, href);
    } catch (e) {
      setError(e instanceof SignInError ? e.message : "Sign-in failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (me.isPending) {
    return <span className="h-8 w-20 animate-pulse rounded-sm bg-muted" aria-hidden />;
  }

  if (!me.data) {
    return (
      <div className="relative">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={busy}>
              Sign in
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Continue with</DropdownMenuLabel>
            {PROVIDERS.map((p) => (
              <DropdownMenuItem key={p.id} onSelect={() => void start(p.id)}>
                {p.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {error ? (
          <p
            role="alert"
            className="absolute top-full right-0 z-40 mt-2 w-64 rounded-sm border border-seal/60 bg-background p-2 text-xs"
          >
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  const user = me.data;
  // 头像用名字的首字母：第三方头像地址不在 CSP 的 img-src 白名单里，也不值得为它放开。
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${user.name}`}
          className="flex size-8 items-center justify-center rounded-full border border-foreground/70 bg-card text-xs font-medium"
        >
          <Initials name={user.name} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <span className="block text-sm text-foreground">{user.name}</span>
          {user.namespace ? <span className="font-mono">@{user.namespace}</span> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/me">
            <SquareLibrary aria-hidden /> My creations
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <Settings aria-hidden /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/settings" hash="tokens">
            <KeyRound aria-hidden /> Tokens
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void signOut().finally(() => refreshPersonalised(qc));
          }}
        >
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
