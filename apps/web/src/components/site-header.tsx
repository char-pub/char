/**
 * 顶栏。
 *
 * 桌面（md 及以上）：mark + 字标、主导航（Explore · Create · Playground，当前项用浅底色
 * 高亮）、全局搜索（`/` 或 ⌘K / Ctrl+K 聚焦，提交后跳到 `/browse?q=`）、主题切换、账户。
 * 移动端（md 以下）：mark + 字标、搜索图标、菜单按钮；菜单是右侧抽屉，里面有搜索、导航、
 * 登录或账户、三段式主题切换。
 *
 * 顶栏不固定在页面顶部（不是 sticky），页面自己的 sticky 元素不需要为它留偏移。
 */
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Compass, FileUp, FlaskConical, LogOut, Menu, Plus, Search, UserRound } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  ACCOUNT_LINKS,
  AccountMenu,
  Initials,
  useAccount,
  useGuestSignOut,
  useSignOut,
} from "./account-menu";
import { BrandLogo } from "./brand";
import { useSignIn, useStartSignIn } from "./sign-in";
import { ThemeSegmented, ThemeToggle } from "./theme-toggle";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import { Skeleton } from "./ui/skeleton";

export const MAIN_NAV = [
  { to: "/browse", label: "Explore", icon: Compass },
  { to: "/create", label: "Create", icon: Plus },
  { to: "/playground", label: "Playground", icon: FlaskConical },
] as const;

/** 焦点在可编辑的元素里时，`/` 是正常输入，不能被快捷键吃掉。 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/** 全局搜索框。提交后跳到探索页并带上查询词；空查询就是打开探索页。 */
function GlobalSearch({
  inputRef,
  onSubmitted,
  className,
}: {
  inputRef?: React.Ref<HTMLInputElement>;
  onSubmitted?: () => void;
  className?: string;
}) {
  const navigate = useNavigate();
  const id = useId();
  const [q, setQ] = useState("");
  return (
    <search aria-label="Site" className={cn("relative block", className)}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const query = q.trim();
          void navigate({ to: "/browse", search: query ? { q: query } : {} });
          (document.activeElement as HTMLElement | null)?.blur();
          onSubmitted?.();
        }}
      >
        <label htmlFor={id} className="sr-only">
          Search the registry
        </label>
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-3"
        />
        <input
          ref={inputRef}
          id={id}
          type="search"
          value={q}
          maxLength={200}
          placeholder="Search the registry"
          onChange={(e) => setQ(e.target.value)}
          className="peer h-9 w-full rounded-md border border-input bg-surface pr-9 pl-9 text-base text-text outline-none placeholder:text-text-3 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 md:text-sm [&::-webkit-search-cancel-button]:hidden"
        />
        <kbd
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded-sm border border-border-strong px-1.5 font-mono text-[0.6875rem] leading-4 text-text-3 peer-focus:hidden md:block"
        >
          /
        </kbd>
      </form>
    </search>
  );
}

/** 当前页面对应的导航项用浅底色高亮（TanStack Router 给当前链接加 `data-status="active"`）。 */
const navLinkClass =
  "rounded-md px-3 py-1.5 text-sm font-medium text-text-2 transition-colors hover:bg-surface-2 hover:text-text data-[status=active]:bg-surface-2 data-[status=active]:text-text";

function MobileMenu({
  open,
  onOpenChange,
  focusSearch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  focusSearch: boolean;
}) {
  const close = () => onOpenChange(false);
  const { pending, user, guest } = useAccount();
  const openSignIn = useSignIn();
  const { start, busy, error } = useStartSignIn();
  const signOutUser = useSignOut();
  const { signOutGuest, busy: guestBusy } = useGuestSignOut();

  const itemClass =
    "flex items-center gap-3 rounded-md px-3 py-2.5 text-base font-semibold text-text transition-colors hover:bg-surface-2 [&_svg]:size-5 [&_svg]:text-text-2";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="gap-0 overflow-y-auto"
        // 从搜索图标打开时聚焦搜索框（第一个可聚焦元素，Radix 默认行为）；从菜单按钮打开时
        // 只聚焦抽屉本身，避免手机上弹出键盘。
        onOpenAutoFocus={(e) => {
          if (focusSearch) return;
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        <SheetHeader className="h-14 flex-row items-center px-4 pt-0">
          <BrandLogo variant="wordmark" height={18} label={null} />
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Search, navigation and account</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pt-2 pb-6">
          <GlobalSearch onSubmitted={close} />
          <nav aria-label="Main" className="grid gap-0.5">
            {MAIN_NAV.slice(0, 2).map((n) => (
              <Link key={n.to} to={n.to} onClick={close} className={itemClass}>
                <n.icon aria-hidden /> {n.label}
              </Link>
            ))}
            <Link to="/create/import" onClick={close} className={itemClass}>
              <FileUp aria-hidden /> Import a card
            </Link>
            <Link to="/playground" onClick={close} className={itemClass}>
              <FlaskConical aria-hidden /> Playground
            </Link>
          </nav>
          <Separator />
          {pending ? (
            <Skeleton className="h-20 w-full" />
          ) : user ? (
            <section aria-label="Account" className="space-y-1">
              <div className="flex items-center gap-3 px-3 py-2">
                <Initials name={user.name} />
                <div className="min-w-0">
                  <p className="truncate font-semibold whitespace-pre">{user.name}</p>
                  {user.namespace ? (
                    <p className="font-mono text-xs text-text-3">@{user.namespace}</p>
                  ) : null}
                </div>
              </div>
              {ACCOUNT_LINKS.map((l) => (
                <Link
                  key={l.label}
                  to={l.to}
                  {...("hash" in l ? { hash: l.hash } : {})}
                  onClick={close}
                  className={cn(itemClass, "py-2 text-sm font-medium")}
                >
                  <l.icon aria-hidden /> {l.label}
                </Link>
              ))}
              <button
                type="button"
                onClick={() => {
                  close();
                  signOutUser();
                }}
                className={cn(itemClass, "w-full py-2 text-sm font-medium")}
              >
                <LogOut aria-hidden /> Sign out
              </button>
            </section>
          ) : (
            <section aria-label="Sign in" className="space-y-3">
              {guest ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm">
                  <UserRound aria-hidden className="size-4 text-text-2" />
                  <span className="min-w-0 flex-1 truncate">
                    Guest · <span className="whitespace-pre">{guest.guest.display_name}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={guestBusy}
                    onClick={() => void signOutGuest()}
                  >
                    Sign out as guest
                  </Button>
                </div>
              ) : null}
              <p className="px-1 text-sm text-text-3">Sign in to create and contribute</p>
              <Button
                variant="outline"
                size="lg"
                className="w-full"
                disabled={busy !== null}
                onClick={() => void start("github")}
              >
                {busy === "github" ? "Opening GitHub…" : "Continue with GitHub"}
              </Button>
              <Button
                variant="link"
                className="px-1"
                onClick={() => {
                  close();
                  openSignIn();
                }}
              >
                Discord or Google
              </Button>
              {error ? (
                <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              ) : null}
            </section>
          )}
          <ThemeSegmented />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function SiteHeader() {
  const desktopSearch = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<{ open: boolean; focusSearch: boolean }>({
    open: false,
    focusSearch: false,
  });
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // 换页时关掉移动端菜单（点了菜单里的链接，或者浏览器后退）。
  useEffect(() => {
    setMenu((m) => (m.open ? { ...m, open: false } : m));
  }, [pathname]);

  // `/` 或 ⌘K / Ctrl+K 聚焦搜索框；窄屏上没有搜索框，就打开菜单并聚焦菜单里的搜索框。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const slash = e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey;
      const k = e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.altKey;
      if (!slash && !k) return;
      if (slash && isTyping(e.target)) return;
      e.preventDefault();
      const input = desktopSearch.current;
      if (input && input.offsetParent !== null) input.focus();
      else setMenu({ open: true, focusSearch: true });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="border-b bg-background">
      {/* 桌面 */}
      <div className="hidden h-16 items-center gap-4 px-4 md:flex lg:gap-6 lg:px-8">
        <Link to="/" aria-label="char.pub home" className="shrink-0 rounded-md">
          <BrandLogo variant="wordmark" label={null} />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          {MAIN_NAV.map((n) => (
            <Link key={n.to} to={n.to} className={navLinkClass}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <GlobalSearch inputRef={desktopSearch} className="w-44 lg:w-80" />
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>

      {/* 移动端 */}
      <div className="flex h-14 items-center gap-1 px-4 md:hidden">
        <Link to="/" aria-label="char.pub home" className="mr-auto shrink-0 rounded-md">
          <BrandLogo variant="wordmark" height={18} label={null} />
        </Link>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Search"
          className="text-text [&_svg:not([class*='size-'])]:size-5"
          onClick={() => setMenu({ open: true, focusSearch: true })}
        >
          <Search aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open menu"
          aria-haspopup="dialog"
          aria-expanded={menu.open}
          className="text-text [&_svg:not([class*='size-'])]:size-5"
          onClick={() => setMenu({ open: true, focusSearch: false })}
        >
          <Menu aria-hidden />
        </Button>
      </div>
      <MobileMenu
        open={menu.open}
        focusSearch={menu.focusSearch}
        onOpenChange={(open) => setMenu((m) => ({ ...m, open }))}
      />
    </header>
  );
}
