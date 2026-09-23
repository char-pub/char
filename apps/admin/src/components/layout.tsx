/**
 * admin 的页面框架：顶部常驻员工身份条（邮箱、角色、审计提示），左侧导航。
 * 导航按当前员工的能力显示入口；没有权限的模块不显示（后端仍会拒绝直接访问）。
 */
import { Link } from "@tanstack/react-router";
import { Eye } from "lucide-react";
import type { ReactNode } from "react";
import type { StaffCapability } from "@/lib/api";
import { useMe } from "@/lib/context";
import { ThemeToggle } from "./theme-toggle";

interface NavItem {
  to: string;
  label: string;
  /** 满足其中任一能力就显示。 */
  any: StaffCapability[];
}

export const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", any: ["overview.read"] },
  { to: "/reports", label: "Reports", any: ["overview.read"] },
  { to: "/content", label: "Content", any: ["overview.read"] },
  { to: "/tombstone", label: "Tombstone", any: ["tombstone.policy", "tombstone.legal"] },
  { to: "/users", label: "Users", any: ["overview.read"] },
  { to: "/namespaces", label: "Namespaces", any: ["overview.read"] },
  { to: "/legal", label: "Legal", any: ["legal.manage"] },
  { to: "/csam", label: "CSAM incidents", any: ["csam.read"] },
  { to: "/jobs", label: "Jobs", any: ["jobs.manage"] },
  { to: "/flags", label: "Kill switches", any: ["overview.read"] },
  { to: "/audit", label: "Audit log", any: ["audit.read_own", "audit.read_all"] },
];

export function StaffBar() {
  const { me, error } = useMe();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-foreground px-4 py-1.5 text-xs text-background">
      <span className="font-mono font-medium">char.pub admin</span>
      {me ? (
        <>
          <span className="font-mono" data-testid="staff-email">
            {me.email}
          </span>
          <span className="font-mono opacity-80">roles: {me.roles.join(", ")}</span>
        </>
      ) : error ? (
        <span className="text-signal">Not signed in as staff</span>
      ) : (
        <span className="opacity-70">Loading staff identity…</span>
      )}
      <span className="ml-auto flex items-center gap-1.5 text-signal">
        <Eye aria-hidden className="size-3.5" />
        Every action is recorded in the audit log.
      </span>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { can } = useMe();
  const items = NAV.filter((n) => n.any.some((c) => can(c)));
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-background focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <StaffBar />
      <div className="flex flex-1">
        <aside className="w-52 shrink-0 border-r bg-card">
          <nav aria-label="Admin" className="flex flex-col gap-px p-2 text-sm">
            {items.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="rounded-sm px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                activeProps={{ className: "bg-accent text-accent-foreground font-medium" }}
                activeOptions={{ exact: n.to === "/" }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="border-t p-2">
            <ThemeToggle />
          </div>
        </aside>
        <main id="main" className="min-w-0 flex-1 space-y-4 p-5">
          {children}
        </main>
      </div>
    </div>
  );
}
