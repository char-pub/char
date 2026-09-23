/**
 * 页脚：横版 lockup 和 tagline，加三列链接（Registry / Open formats / Trust）。
 * 规范文档、安全说明和许可证链接到 GitHub 上的仓库；内容政策和举报入口先指向 `/policy`
 * 占位页，政策定稿后再换成正式页面。
 */
import { Link } from "@tanstack/react-router";
import { BrandLogo } from "./brand";

const REPO = "https://github.com/char-pub/char";
const DOC = `${REPO}/blob/main`;

type FooterLink =
  | {
      label: string;
      to: "/browse" | "/create" | "/create/import" | "/playground" | "/policy";
      hash?: string;
    }
  | { label: string; href: string };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Registry",
    links: [
      { label: "Explore", to: "/browse" },
      { label: "Create", to: "/create" },
      { label: "Import a card", to: "/create/import" },
      { label: "Playground", to: "/playground" },
    ],
  },
  {
    title: "Open formats",
    links: [
      { label: "Canonical model", href: `${DOC}/spec/canonical-model.md` },
      { label: "Context IR", href: `${DOC}/spec/context-ir-v0.md` },
      { label: "CLI & API", href: `${REPO}/tree/main/packages/cli` },
      { label: "GitHub", href: REPO },
    ],
  },
  {
    title: "Trust",
    links: [
      { label: "Content policy", to: "/policy" },
      { label: "Report content", to: "/policy", hash: "report" },
      { label: "Security", href: `${DOC}/SECURITY.md` },
      { label: "License", href: `${DOC}/LICENSE` },
    ],
  },
];

const linkClass = "text-sm text-text-2 transition-colors hover:text-text hover:underline";

export function SiteFooter() {
  return (
    <footer className="border-t bg-background">
      <div className="flex flex-col gap-10 px-4 py-10 md:flex-row md:justify-between md:px-8">
        <div className="max-w-xs space-y-3">
          <BrandLogo variant="lockup" height={56} />
          <p className="text-sm text-text-2">
            An open registry for AI characters, worlds and stories. No single platform owns them.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-8 sm:grid-cols-3">
          {COLUMNS.map((col) => (
            <div key={col.title} className="space-y-3">
              <h2 className="text-sm font-semibold text-text">{col.title}</h2>
              <ul className="space-y-2">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {"href" in l ? (
                      <a href={l.href} className={linkClass}>
                        {l.label}
                      </a>
                    ) : (
                      <Link to={l.to} {...(l.hash ? { hash: l.hash } : {})} className={linkClass}>
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </footer>
  );
}
