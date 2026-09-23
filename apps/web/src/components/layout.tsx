import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AccountMenu } from "./account-menu";
import { BrandMark } from "./brand-mark";
import { ThemeToggle } from "./theme-toggle";

const NAV = [
  { to: "/browse", label: "Browse" },
  { to: "/playground", label: "Playground" },
  { to: "/create", label: "Create" },
] as const;

/** 第三方登录失败后，Better Auth 会带着 `signin_error` 回到首页。 */
function SignInErrorNotice() {
  const failed = useRouterState({
    select: (s) => "signin_error" in (s.location.search as Record<string, unknown>),
  });
  if (!failed) return null;
  return (
    <p
      role="alert"
      className="mb-6 rounded-sm border border-seal/60 bg-seal-soft px-4 py-2 text-sm"
    >
      Sign-in did not complete. You can try again, or use another account.
    </p>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-background focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b border-foreground/80 bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-5 py-3">
          <Link to="/" className="flex items-center gap-2" aria-label="char.pub home">
            <BrandMark size={30} />
            <span className="text-xl font-semibold leading-none tracking-tight">char.pub</span>
          </Link>
          <nav aria-label="Main" className="flex gap-5 text-sm">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                activeProps={{
                  className: "text-foreground underline decoration-seal decoration-2",
                }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle />
            <AccountMenu />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-5 py-8">
        <SignInErrorNotice />
        {children}
      </main>
      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-6 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <BrandMark size={24} />
            char.pub
          </span>
          <span>Open registry for characters, worlds and stories.</span>
          <nav aria-label="Footer" className="ml-auto flex gap-4">
            <a
              href="https://github.com/char-pub/char/blob/main/LICENSE"
              className="hover:text-foreground"
            >
              License
            </a>
            <a
              href="https://github.com/char-pub/char/blob/main/SECURITY.md"
              className="hover:text-foreground"
            >
              Security
            </a>
            <span aria-disabled="true" title="Coming soon">
              Content Policy
            </span>
          </nav>
        </div>
      </footer>
    </div>
  );
}
