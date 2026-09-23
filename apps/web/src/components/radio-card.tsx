/**
 * 卡片式单选项：整张卡片都可以点，选中时边框变成 Ink、底色变深。放在 `RadioGroup` 里用，
 * 例如作品设置的“谁能提修改”、举报原因。
 */
import type { ReactNode } from "react";
import { RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

export function RadioCard({
  id,
  value,
  children,
  description,
  compact = false,
  className,
}: {
  /** 单选按钮的 id，页面内唯一（用 `useId()` 拼出来）。 */
  id: string;
  value: string;
  children: ReactNode;
  description?: ReactNode;
  /** 只有一行文字的紧凑样式。 */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex items-start gap-3 rounded-lg border transition-colors hover:bg-surface-2 has-[[data-state=checked]]:border-ink has-[[data-state=checked]]:bg-surface-2",
        compact ? "items-center rounded-md px-3 py-2" : "px-4 py-3",
        className,
      )}
    >
      <RadioGroupItem
        id={id}
        value={value}
        className={compact ? undefined : "mt-0.5"}
        aria-describedby={description ? `${id}-description` : undefined}
      />
      <div className="min-w-0 space-y-0.5">
        {/* 用伪元素把点击区域铺满整张卡片。 */}
        <label
          htmlFor={id}
          className={cn(
            "block cursor-pointer text-sm after:absolute after:inset-0 after:content-['']",
            compact ? "font-normal" : "font-semibold",
          )}
        >
          {children}
        </label>
        {description ? (
          <p id={`${id}-description`} className="text-xs text-text-2">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
