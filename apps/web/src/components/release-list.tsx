/**
 * 版本列表。yanked 的版本仍然可以被已锁定它的作品使用，但会给出警告；tombstoned 的版本
 * 内容已经移除，只显示公开的原因代码。
 */
import type { ReleaseSummary } from "@/lib/api";
import { formatDate } from "@/lib/text";
import { cn } from "@/lib/utils";
import { RatingBadge } from "./rating";

/** 下架原因代码的说明。未知代码原样显示。 */
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

export function ReleaseList({
  releases,
  selected,
  onSelect,
}: {
  releases: readonly ReleaseSummary[];
  selected: string | undefined;
  onSelect: (label: string) => void;
}) {
  if (releases.length === 0) {
    return <p className="text-sm text-muted-foreground">No releases yet.</p>;
  }
  return (
    <ul className="divide-y divide-rule border-y border-rule">
      {releases.map((r) => (
        <li key={r.id} className="py-2">
          <button
            type="button"
            aria-current={r.label === selected ? "true" : undefined}
            onClick={() => onSelect(r.label)}
            className={cn(
              "flex w-full items-center justify-between gap-2 text-left text-sm",
              r.label === selected ? "font-medium" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="font-mono">
              {r.label}
              {r.visibility === "private" ? " · private" : ""}
            </span>
            <span className="flex items-center gap-2">
              {r.status === "yanked" ? (
                <span className="stamp border-amber/60 bg-amber-soft">yanked</span>
              ) : r.status === "tombstoned" ? (
                <span className="stamp border-seal/60 text-seal">removed</span>
              ) : (
                <RatingBadge rating={r.effective_rating} />
              )}
            </span>
          </button>
          <p className="text-xs text-muted-foreground">
            {formatDate(r.created_at)}
            {r.status === "tombstoned" ? ` · ${tombstoneText(r.status_reason)}` : ""}
            {r.status === "yanked" && r.status_reason ? ` · ${r.status_reason}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}
