/**
 * 设置页的分区：左侧导航（锚点）和右侧一块块分区卡片。
 */
import { useRouterState } from "@tanstack/react-router";
import { AtSign, Database, Eye, KeyRound, LogIn } from "lucide-react";
import type * as React from "react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export const SETTINGS_SECTIONS = [
  { id: "profile", label: "Profile", icon: AtSign },
  { id: "content", label: "Content", icon: Eye },
  { id: "tokens", label: "API tokens", icon: KeyRound },
  { id: "sign-in", label: "Sign-in methods", icon: LogIn },
  { id: "data", label: "Your data", icon: Database },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

function sectionOf(hash: string): SettingsSectionId {
  return SETTINGS_SECTIONS.find((s) => s.id === hash)?.id ?? SETTINGS_SECTIONS[0].id;
}

/**
 * 分区导航。当前分区按地址里的 `#hash` 高亮，没有 hash 时是第一个。用普通的锚点链接：
 * 只在页面内跳转，由浏览器负责滚动；从别处（例如账户菜单）带着 hash 进来时同步高亮。
 */
export function SettingsNav() {
  const hash = useRouterState({ select: (s) => s.location.hash });
  const [active, setActive] = useState(() => sectionOf(hash));
  useEffect(() => setActive(sectionOf(hash)), [hash]);
  return (
    <nav aria-label="Settings sections" className="lg:sticky lg:top-6">
      <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {SETTINGS_SECTIONS.map((s) => {
          const Icon = s.icon;
          const current = s.id === active;
          return (
            <li key={s.id} className="shrink-0">
              <a
                href={`#${s.id}`}
                aria-current={current ? "location" : undefined}
                onClick={() => setActive(s.id)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap text-text-2 transition-colors outline-none hover:bg-surface-2 hover:text-text focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  current && "bg-surface-2 text-text",
                )}
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                {s.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: SettingsSectionId;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-6 space-y-5 rounded-xl border bg-surface p-5 sm:p-6"
    >
      <header className="space-y-1">
        <h2 id={`${id}-title`} className="text-lg font-bold">
          {title}
        </h2>
        {description ? <div className="text-sm text-text-2">{description}</div> : null}
      </header>
      {children}
    </section>
  );
}
