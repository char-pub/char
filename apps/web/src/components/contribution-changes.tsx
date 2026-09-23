/**
 * 贡献审阅里的变更卡片：每个变更键一张，头部是等宽的键、种类和操作、是否敏感、合并状态
 * （会应用 / 已经在草稿里 / 冲突），正文是前后对比：删除行红底、新增行绿底。
 *
 * “改之前”取作者当前草稿里的值，只有作品成员能读到草稿；读不到时只显示新内容。
 * 会被应用的敏感变更在卡片底部有单独的确认勾选框，没有一次全部确认的办法。
 */
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import type { ContributionDetail } from "@/lib/api";
import { type ChangeValue, describeKey } from "@/lib/contribution";
import { cn } from "@/lib/utils";
import { UserText } from "./user-content";

export type Outcome = NonNullable<ContributionDetail["preview"]>["outcomes"][number];

/** 读屏和测试用的状态说法（小写，接在键名后面）。 */
export const STATE_TEXT: Record<Outcome["state"], string> = {
  applied: "will apply",
  already_applied: "already in the draft",
  conflict: "conflict",
};

const STATE_BADGE: Record<Outcome["state"], { label: string; dot: string; text: string }> = {
  applied: { label: "Will apply", dot: "bg-success", text: "text-text" },
  already_applied: { label: "Already in the draft", dot: "bg-text-3", text: "text-text-2" },
  conflict: { label: "Conflict", dot: "bg-danger", text: "text-danger" },
};

const CONFLICT_REASON: Record<string, string> = {
  diverged: "This was also changed in the draft since the contribution was made.",
  slot_missing: "The asset slot this change adds to no longer exists.",
};

const KIND_TEXT: Record<string, string> = {
  fragment: "passage",
  metadata: "metadata",
  edge: "dependency",
  asset: "asset",
};

const OP_TEXT: Record<string, string> = {
  add: "added",
  modify: "edited",
  remove: "removed",
  set: "changed",
  unset: "cleared",
};

/** 卡片头部的等宽键：fragment 写成 `#id`，元数据去掉 `meta.` 前缀。 */
export function shortKey(key: string): string {
  const [kind, ...rest] = key.split(":");
  const target = rest.join(":");
  if (kind === "fragment") return `#${target}`;
  if (kind === "metadata") return target.replace(/^meta\./, "");
  return target || key;
}

function valueText(v: ChangeValue): string {
  return "text" in v ? v.text : v.value;
}

function DiffLine({ sign, value }: { sign: "-" | "+" | " "; value: ChangeValue }) {
  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-2 text-sm",
        sign === "-" && "bg-danger-soft",
        sign === "+" && "bg-success-soft",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "w-3 shrink-0 font-mono select-none",
          sign === "-" ? "text-danger" : sign === "+" ? "text-success" : "text-text-3",
        )}
      >
        {sign === " " ? "" : sign === "-" ? "−" : "+"}
      </span>
      <span className="sr-only">{sign === "-" ? "Before: " : sign === "+" ? "After: " : ""}</span>
      <span
        className={cn(
          "min-w-0 flex-1 break-words whitespace-pre-wrap",
          "value" in value && "font-mono text-[13px]",
        )}
      >
        <UserText text={valueText(value)} />
      </span>
    </div>
  );
}

export function ChangeCard({
  outcome,
  before,
  after,
  canConfirm,
  confirmed,
  onConfirm,
}: {
  outcome: Outcome;
  /** 草稿里现在的值；读不到草稿或草稿里没有这一项时为 null。 */
  before: ChangeValue | null;
  after: ChangeValue | null;
  canConfirm: boolean;
  confirmed: boolean;
  onConfirm: (v: boolean) => void;
}) {
  const id = useId();
  const needsConfirm = outcome.sensitive && outcome.state === "applied";
  const state = STATE_BADGE[outcome.state];
  const [kind] = outcome.key.split(":");
  const same = before && after && valueText(before) === valueText(after);
  return (
    <li
      className={cn(
        "overflow-hidden rounded-lg border bg-surface",
        needsConfirm && "border-warning/60",
        outcome.state === "conflict" && "border-danger/60",
      )}
      data-key={outcome.key}
      data-state={outcome.state}
      aria-label={`${describeKey(outcome.key)}: ${STATE_TEXT[outcome.state]}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5">
        <span className="font-mono text-sm font-medium break-all">{shortKey(outcome.key)}</span>
        <span className="text-xs text-text-3">
          {KIND_TEXT[kind ?? ""] ?? kind} · {OP_TEXT[outcome.op] ?? outcome.op}
        </span>
        {outcome.sensitive ? (
          <Badge variant="warning">
            <ShieldAlert aria-hidden /> Sensitive
          </Badge>
        ) : null}
        <span
          className={cn(
            "ml-auto inline-flex items-center gap-1.5 text-xs font-semibold",
            state.text,
          )}
        >
          {outcome.state === "conflict" ? (
            <AlertTriangle aria-hidden className="size-3.5" />
          ) : (
            <span aria-hidden className={cn("size-2 rounded-full", state.dot)} />
          )}
          {state.label}
        </span>
      </div>
      {outcome.state === "conflict" ? (
        <p className="border-b bg-danger-soft/50 px-4 py-2 text-sm text-danger">
          {CONFLICT_REASON[outcome.reason ?? "diverged"] ?? CONFLICT_REASON.diverged}
        </p>
      ) : null}
      <div>
        {outcome.state === "already_applied" && after ? (
          <DiffLine sign=" " value={after} />
        ) : (
          <>
            {before && !same ? <DiffLine sign="-" value={before} /> : null}
            {after ? <DiffLine sign="+" value={after} /> : null}
            {!after && !before ? (
              <p className="px-4 py-2 text-sm text-text-3">
                {outcome.op === "remove" || outcome.op === "unset"
                  ? "Removes this from the creation."
                  : "No preview for this kind of change."}
              </p>
            ) : null}
          </>
        )}
      </div>
      {needsConfirm && canConfirm ? (
        <div className="flex items-start gap-2.5 border-t border-warning/40 bg-warning-soft px-4 py-3">
          <Checkbox
            id={id}
            className="mt-0.5"
            checked={confirmed}
            onCheckedChange={(v) => onConfirm(v === true)}
          />
          <label htmlFor={id} className="text-sm font-medium">
            I have reviewed this {describeKey(outcome.key)} change and accept it
          </label>
        </div>
      ) : null}
    </li>
  );
}
