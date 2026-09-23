/**
 * 编辑栏里的保存状态。五种状态各有自己的颜色和文字：已保存是绿色；保存中、有未保存修改是
 * 次要文字；草稿有检查错误是琥珀色；在别处被改过、保存失败是红色，需要作者处理。
 */
import {
  CloudCheck,
  CloudOff,
  GitCompareArrows,
  Loader2,
  PenLine,
  TriangleAlert,
} from "lucide-react";
import type { SaveState } from "@/lib/use-draft-editor";
import { cn } from "@/lib/utils";

export function saveStatusText(state: SaveState): string {
  switch (state.kind) {
    case "saved":
      return state.at ? "All changes saved" : "Draft loaded";
    case "dirty":
      return "Unsaved changes";
    case "saving":
      return "Saving…";
    case "conflict":
      return "Not saved — changed elsewhere";
    case "invalid":
      return "Not saved — fix the errors";
    case "error":
      return state.message;
  }
}

const STYLE: Record<SaveState["kind"], { icon: typeof CloudCheck; className: string }> = {
  saved: { icon: CloudCheck, className: "text-success" },
  dirty: { icon: PenLine, className: "text-text-2" },
  saving: { icon: Loader2, className: "text-text-2" },
  invalid: { icon: TriangleAlert, className: "rounded-full bg-warning-soft px-2.5 text-warning" },
  conflict: {
    icon: GitCompareArrows,
    className: "rounded-full bg-danger-soft px-2.5 text-danger",
  },
  error: { icon: CloudOff, className: "rounded-full bg-danger-soft px-2.5 text-danger" },
};

export function SaveStatus({ state, className }: { state: SaveState; className?: string }) {
  const { icon: Icon, className: tone } = STYLE[state.kind];
  return (
    <p
      className={cn("flex h-7 items-center gap-1.5 text-sm", tone, className)}
      aria-live="polite"
      data-save-state={state.kind}
    >
      <Icon
        aria-hidden
        className={cn("size-4 shrink-0", state.kind === "saving" && "animate-spin")}
      />
      <span className="truncate">{saveStatusText(state)}</span>
    </p>
  );
}
