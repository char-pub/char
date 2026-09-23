/**
 * 顶栏右侧的账户入口。
 *
 * - 未登录：“Sign in” 按钮，打开登录对话框（GitHub / Discord / Google）。
 * - 经过邮箱验证的访客：多一个 “Guest · 名字” 小标签，点开可以退出访客身份。
 * - 已登录：首字母头像，菜单里是我的作品、新建、设置、API token、主题和退出。
 *
 * 头像只用名字的首字母：第三方头像地址不在 CSP 的 img-src 白名单里，也不值得为它放开。
 */
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { KeyRound, LayoutGrid, LogOut, Plus, Settings, UserRound } from "lucide-react";
import { useState } from "react";
import type { GuestSession, Me } from "@/lib/api";
import { signOut } from "@/lib/auth";
import { keys, refreshPersonalised, useGuest, useMe, useRegistry } from "@/lib/registry";
import { cn } from "@/lib/utils";
import { SignInButton } from "./sign-in";
import { ThemeSubmenu } from "./theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Skeleton } from "./ui/skeleton";

/** 登录用户的账户链接；桌面菜单和移动端抽屉共用。 */
export const ACCOUNT_LINKS = [
  { to: "/me", label: "My creations", icon: LayoutGrid },
  { to: "/create", label: "New creation", icon: Plus },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/settings", hash: "tokens", label: "API tokens", icon: KeyRound },
] as const;

export function Initials({ name, className }: { name: string; className?: string }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-purple-soft text-xs font-bold text-purple-text",
        className,
      )}
    >
      {letters || "?"}
    </span>
  );
}

/** 当前的登录用户、访客会话和加载状态。访客会话只在未登录时查询。 */
export function useAccount(): {
  pending: boolean;
  user: Me | null;
  guest: GuestSession | null;
} {
  const me = useMe();
  const signedOut = me.isSuccess && me.data === null;
  const guest = useGuest(signedOut);
  return {
    pending: me.isPending,
    user: me.data ?? null,
    guest: signedOut ? (guest.data ?? null) : null,
  };
}

export function useSignOut(): () => void {
  const qc = useQueryClient();
  return () => {
    void signOut().finally(() => refreshPersonalised(qc));
  };
}

/** 退出访客身份：清掉 API 域名下的访客 cookie，然后重新读取访客会话。 */
export function useGuestSignOut(): { signOutGuest: () => Promise<void>; busy: boolean } {
  const client = useRegistry();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  return {
    busy,
    signOutGuest: async () => {
      setBusy(true);
      try {
        await client.guestSignOut();
      } finally {
        setBusy(false);
        await qc.invalidateQueries({ queryKey: keys.guest });
      }
    },
  };
}

function GuestBadge({ session }: { session: GuestSession }) {
  const { signOutGuest, busy } = useGuestSignOut();
  const name = session.guest.display_name;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Guest session: ${name}`}
        className="inline-flex h-8 max-w-48 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-xs font-semibold text-text-2 transition-colors outline-none hover:text-text focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        <UserRound aria-hidden className="size-3.5 shrink-0" />
        <span>Guest</span>
        <span aria-hidden>·</span>
        <span className="truncate whitespace-pre font-medium">{name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-text-2">
          You are contributing as a verified guest. Your email is never shown.
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={busy} onSelect={() => void signOutGuest()}>
          <LogOut aria-hidden /> Sign out as guest
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ user }: { user: Me }) {
  const signOutUser = useSignOut();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account menu for ${user.name}`}
        className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Initials name={user.name} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block truncate text-sm font-semibold whitespace-pre text-text">
            {user.name}
          </span>
          {user.namespace ? (
            <span className="font-mono text-xs text-text-3">@{user.namespace}</span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ACCOUNT_LINKS.map((l) => (
          <DropdownMenuItem key={l.label} asChild>
            <Link to={l.to} {...("hash" in l ? { hash: l.hash } : {})}>
              <l.icon aria-hidden /> {l.label}
            </Link>
          </DropdownMenuItem>
        ))}
        <ThemeSubmenu />
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOutUser}>
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AccountMenu() {
  const { pending, user, guest } = useAccount();
  if (pending) return <Skeleton className="h-8 w-20" />;
  if (user) return <UserMenu user={user} />;
  return (
    <div className="flex items-center gap-2">
      {guest ? <GuestBadge session={guest} /> : null}
      <SignInButton variant="outline" />
    </div>
  );
}
