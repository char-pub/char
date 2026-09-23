/**
 * Versions 标签的版本列表。yanked 的版本仍然可以被已锁定它的作品使用，但会显示理由；
 * tombstoned 的版本内容已经移除，只显示公开的原因代码。点圆圈选择要比较的两个版本（A / B）。
 */
import { Link } from "@tanstack/react-router";
import { Ellipsis, Eye, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ReleaseSummary } from "@/lib/api";
import { formatDate } from "@/lib/text";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./badges";
import { UserText } from "./user-content";

/** 下架原因代码的说明。未知代码只说“removed”，代码本身另外显示。 */
export const TOMBSTONE_REASON_LABEL: Record<string, string> = {
  "legal.dmca": "removed after a copyright (DMCA) notice",
  "legal.court_order": "removed by court order",
  "legal.gdpr": "removed at the request of a person featured in it (data protection)",
  "policy.minor_sexual": "removed for violating the content policy",
  "policy.illegal": "removed for violating the content policy",
  "policy.non_consensual": "removed for violating the content policy",
  "policy.malware": "removed for containing harmful content",
  "author.request": "removed at the author's request",
};

export function tombstoneText(reason: string | undefined): string {
  return (reason && TOMBSTONE_REASON_LABEL[reason]) ?? "removed";
}

export type CompareSide = "from" | "to";

/**
 * 点一个版本的圆圈时它替换哪一边：比 A 新的放到 B，其余放到 A。
 * `releases` 按发布时间从新到旧排列。
 */
export function sideFor(
  releases: readonly ReleaseSummary[],
  label: string,
  from: string | undefined,
): CompareSide {
  const i = releases.findIndex((r) => r.label === label);
  const a = releases.findIndex((r) => r.label === from);
  return a >= 0 && i < a ? "to" : "from";
}

function Marker({ side }: { side: CompareSide | null }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-6 items-center justify-center rounded-full border text-[0.7rem] font-bold",
        side ? "border-ink bg-ink text-on-ink" : "border-border-strong bg-surface",
      )}
    >
      {side === "from" ? "A" : side === "to" ? "B" : null}
    </span>
  );
}

export function VersionList({
  ns,
  name,
  releases,
  latest,
  from,
  to,
  onCompare,
  canYank,
  onYank,
}: {
  ns: string;
  name: string;
  /** 按发布时间从新到旧。 */
  releases: readonly ReleaseSummary[];
  /** 最新 public 版本的 label。 */
  latest: string | undefined;
  from: string | undefined;
  to: string | undefined;
  onCompare: (side: CompareSide, label: string) => void;
  canYank: boolean;
  onYank: (label: string) => void;
}) {
  return (
    <section aria-labelledby="versions-title" className="rounded-lg border bg-surface">
      <div className="flex items-baseline justify-between gap-3 border-b px-5 py-3">
        <h2 id="versions-title" className="text-sm font-semibold">
          {releases.length} {releases.length === 1 ? "release" : "releases"}
        </h2>
        {releases.length > 1 ? <p className="text-xs text-text-3">Pick two to compare</p> : null}
      </div>
      <ul aria-label="Releases" className="divide-y">
        {releases.map((r) => {
          const removed = r.status === "tombstoned";
          const side = r.label === from ? "from" : r.label === to ? "to" : null;
          return (
            <li
              key={r.id}
              data-release={r.label}
              className={cn("flex items-start gap-3 px-5 py-3", side && "bg-surface-2")}
            >
              {removed ? (
                <span className="opacity-40">
                  <Marker side={null} />
                </span>
              ) : (
                <button
                  type="button"
                  className="rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none"
                  aria-label={`Compare ${r.label}`}
                  aria-pressed={side !== null}
                  onClick={() => {
                    if (!side) onCompare(sideFor(releases, r.label, from), r.label);
                  }}
                >
                  <Marker side={side} />
                </button>
              )}
              <div className="min-w-0 flex-1 space-y-0.5">
                {r.source ? (
                  <p className="text-xs text-text-3">
                    {r.source.kind === "github" ? "GitHub" : "Native"}
                    {r.source.commit ? ` · ${r.source.commit.slice(0, 7)}` : ""}
                    {r.publisher
                      ? ` · published by ${r.publisher.kind === "github_actions" ? "GitHub Actions" : (r.publisher.user ?? "author")}`
                      : ""}
                  </p>
                ) : null}
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-medium">{r.label}</span>
                  {r.label === latest && r.status === "active" ? (
                    <StatusBadge status="latest" />
                  ) : null}
                  {r.status === "yanked" ? <StatusBadge status="yanked" /> : null}
                  {removed ? <StatusBadge status="removed" /> : null}
                  {r.visibility === "private" ? <StatusBadge status="private" /> : null}
                </p>
                <p className="text-xs text-text-3">
                  {formatDate(r.created_at)} · by @{ns}
                </p>
                {r.status === "yanked" && r.status_reason ? (
                  <p className="text-xs text-text-2">
                    “<UserText text={r.status_reason} />”
                  </p>
                ) : null}
                {removed ? (
                  <p className="text-xs text-text-2">
                    {tombstoneText(r.status_reason).replace(/^./, (c) => c.toUpperCase())}.{" "}
                    <span className="font-mono">Reason: {r.status_reason ?? "unspecified"}</span>
                  </p>
                ) : null}
              </div>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.label}`}>
                    <Ellipsis aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link to="/c/$ns/$name" params={{ ns, name }} search={{ v: r.label }}>
                      <Eye aria-hidden /> View this version
                    </Link>
                  </DropdownMenuItem>
                  {removed ? null : (
                    <>
                      <DropdownMenuItem onSelect={() => onCompare("from", r.label)}>
                        Compare as A (from)
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onCompare("to", r.label)}>
                        Compare as B (to)
                      </DropdownMenuItem>
                    </>
                  )}
                  {canYank && r.status === "active" ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => onYank(r.label)}>
                        <Undo2 aria-hidden /> Yank {r.label}…
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
