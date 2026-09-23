/**
 * 右侧常驻的检查栏 “Before you publish”：把草稿当前的状态整理成 ✓ / ⚠ / ✗ 几类，
 * 每一项都能点过去定位到对应的字段。数据来源：
 *
 * - 第一层字段是否填好（名字、正文）；
 * - 保存状态：冲突、检查错误（422 的诊断）、保存失败；
 * - 最近一次保存时检查规则给出的警告；
 * - 依赖是否都锁定到了精确的 Release；
 * - 评级与许可（作品页和发布检查都以它们为准）。
 *
 * 下方的 “Next release” 卡片显示建议的版本号。
 */
import type { CheckDiagnostic, CreationType, ReferenceEdge } from "@char-pub/core";
import { Link } from "@tanstack/react-router";
import { CircleCheck, CircleX, Info, TriangleAlert } from "lucide-react";
import { RATING_LABEL } from "@/components/rating";
import { getGreeting, getMainText, getMeta, getName, type Working } from "@/lib/draft";
import { formatDate } from "@/lib/text";
import type { SaveState } from "@/lib/use-draft-editor";
import { cn } from "@/lib/utils";
import { ANCHOR, type Target, targetOf } from "./anchors";
import { MAIN_LABEL } from "./basics-fields";
import { licenseShort } from "./options";

export type CheckTone = "ok" | "warn" | "error" | "info";

export interface CheckItem {
  key: string;
  tone: CheckTone;
  title: string;
  detail?: string | undefined;
  code?: string | undefined;
  target?: Target | null | undefined;
}

function fromDiagnostic(d: CheckDiagnostic, i: number, type: CreationType, w: Working): CheckItem {
  return {
    key: `${d.severity}:${d.code}:${d.subject}:${i}`,
    tone: d.severity === "error" ? "error" : "warn",
    title: d.detail ? d.detail.charAt(0).toUpperCase() + d.detail.slice(1) : d.code,
    code: d.code,
    target: targetOf(d.subject, type, w),
  };
}

export function buildChecks({
  type,
  working,
  state,
  warnings,
  references,
}: {
  type: CreationType;
  working: Working;
  state: SaveState;
  warnings: readonly CheckDiagnostic[];
  references: readonly ReferenceEdge[];
}): CheckItem[] {
  const items: CheckItem[] = [];
  const main = MAIN_LABEL[type];
  const name = getName(working).trim();
  const text = getMainText(working, type).trim();

  if (state.kind === "conflict") {
    items.push({
      key: "conflict",
      tone: "error",
      title: "Changed somewhere else",
      detail: "Reload the latest draft before publishing.",
    });
  }
  if (name === "") {
    items.push({
      key: "name",
      tone: "error",
      title: "Name is missing",
      detail: "Give it a name before publishing.",
      target: { anchor: ANCHOR.name },
    });
  }
  if (main && text === "") {
    items.push({
      key: "main",
      tone: "error",
      title: `${main.label} is empty`,
      detail: `Every ${type} needs this text; drafts without it can't be saved.`,
      target: { anchor: ANCHOR.main },
    });
  }
  if (name !== "" && (!main || text !== "")) {
    const parts = ["Name", main?.label.toLowerCase()].filter(Boolean);
    const greeting = type === "character" && getGreeting(working).trim() !== "";
    if (greeting) parts.push("greeting");
    items.push({
      key: "basics",
      tone: "ok",
      title: "Basics complete",
      detail: `${parts.length > 2 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts.join(" and ")} are set.`,
    });
    if (type === "character" && !greeting) {
      items.push({
        key: "greeting",
        tone: "info",
        title: "No greeting yet",
        detail: "Chats start without a first line. Add one if you like.",
        target: { anchor: ANCHOR.greeting },
      });
    }
  }

  if (state.kind === "invalid") {
    if (state.diagnostics.length === 0) {
      items.push({
        key: "invalid",
        tone: "error",
        title: "The draft didn't pass the checks",
        detail: state.message ?? "Fix the highlighted fields; the draft saves once they pass.",
      });
    }
    state.diagnostics.forEach((d, i) => {
      items.push(fromDiagnostic(d, i, type, working));
    });
  }
  if (state.kind === "error") {
    items.push({
      key: "save-error",
      tone: "warn",
      title: "Not saved yet",
      detail: "Your changes are kept here. Saving tries again on your next edit.",
    });
  }
  warnings.forEach((d, i) => {
    items.push(fromDiagnostic(d, i, type, working));
  });

  if (references.length > 0) {
    const deps = { anchor: ANCHOR.dependencies, section: "dependencies" as const };
    const unpinned = references.filter((r) => !r.pin);
    const following = references.filter((r) => r.pin && "follow" in r.pin);
    const locked = references.length - unpinned.length - following.length;
    for (const r of unpinned) {
      items.push({
        key: `unpinned:${r.id}`,
        tone: "error",
        title: `${String(r.use)} has no version`,
        detail: "Pick the release to build on in Dependencies.",
        target: deps,
      });
    }
    if (following.length > 0) {
      items.push({
        key: "following",
        tone: "info",
        title: `${following.length} ${following.length === 1 ? "dependency follows" : "dependencies follow"} the latest release`,
        detail: "They're locked to an exact release when you publish.",
        target: deps,
      });
    }
    if (locked > 0 && unpinned.length === 0) {
      items.push({
        key: "locked",
        tone: "ok",
        title: "Dependencies pinned",
        detail: `${locked} ${locked === 1 ? "release" : "releases"} locked by digest.`,
        target: deps,
      });
    }
  }

  const meta = getMeta(working);
  items.push({
    key: "meta",
    tone: "info",
    title: `${RATING_LABEL[meta.rating]} · ${licenseShort(meta.license)}`,
    detail:
      meta.license === "LicenseRef-All-Rights-Reserved"
        ? "Only you can publish it. A dependency with a higher rating raises the rating shown."
        : "Others may reuse it under this license. A dependency with a higher rating raises the rating shown.",
    target: { anchor: ANCHOR.meta, section: "meta" },
  });
  return items;
}

const TONE: Record<CheckTone, { icon: typeof Info; className: string; label: string }> = {
  ok: { icon: CircleCheck, className: "text-success", label: "Done" },
  warn: { icon: TriangleAlert, className: "text-warning", label: "Warning" },
  error: { icon: CircleX, className: "text-danger", label: "Error" },
  info: { icon: Info, className: "text-blue", label: "Note" },
};

/** 检查栏的标题下面一行：还有几个错误和警告，或者可以发布了。 */
export function checksSummary(items: readonly CheckItem[]): string {
  const errors = items.filter((i) => i.tone === "error").length;
  const warns = items.filter((i) => i.tone === "warn").length;
  if (errors === 0 && warns === 0) return "Ready to publish.";
  const parts = [];
  if (errors > 0) parts.push(`${errors} ${errors === 1 ? "error" : "errors"}`);
  if (warns > 0) parts.push(`${warns} ${warns === 1 ? "warning" : "warnings"}`);
  return `${parts.join(" · ")}${errors > 0 ? " to fix before publishing." : "."}`;
}

export function ChecksPanel({
  items,
  onLocate,
}: {
  items: readonly CheckItem[];
  onLocate: (target: Target) => void;
}) {
  return (
    <section
      aria-labelledby="checks-h"
      className="space-y-4 rounded-xl border bg-surface p-5"
      data-testid="checks"
    >
      <div className="space-y-0.5">
        <h2 id="checks-h" className="font-bold tracking-tight">
          Before you publish
        </h2>
        <p className="text-xs text-text-2">{checksSummary(items)}</p>
      </div>
      <ul className="space-y-3.5">
        {items.map((item) => {
          const T = TONE[item.tone];
          const target = item.target;
          return (
            <li key={item.key} className="flex gap-2.5" data-tone={item.tone}>
              <T.icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", T.className)} />
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium [overflow-wrap:anywhere]">
                  <span className="sr-only">{T.label}: </span>
                  {target ? (
                    <button
                      type="button"
                      className="text-left underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
                      onClick={() => onLocate(target)}
                    >
                      {item.title}
                    </button>
                  ) : (
                    item.title
                  )}
                </p>
                {item.detail ? <p className="text-xs text-text-2">{item.detail}</p> : null}
                {item.code ? (
                  <p className="font-mono text-[0.7rem] text-text-3">{item.code}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function NextRelease({
  ns,
  name,
  suggested,
  latest,
}: {
  ns: string;
  name: string;
  suggested: string;
  latest: { label: string; created_at: string } | undefined;
}) {
  return (
    <section aria-labelledby="next-h" className="space-y-2 rounded-xl bg-surface-2 p-5">
      <h2 id="next-h" className="text-sm font-semibold">
        Next release
      </h2>
      <p className="font-mono text-sm [overflow-wrap:anywhere]">
        @{ns}/{name}@{suggested}
      </p>
      <p className="text-xs text-text-2">
        {latest
          ? `Suggested after ${latest.label} (${formatDate(latest.created_at)}). You can pick any unused label when you publish.`
          : "This will be the first release. You can pick any label when you publish."}
      </p>
      {latest ? (
        <Link
          to="/c/$ns/$name/versions"
          params={{ ns, name }}
          className="inline-block text-sm font-medium text-blue-text hover:underline"
        >
          See published versions →
        </Link>
      ) : null}
    </section>
  );
}
