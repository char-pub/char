/**
 * 卡片式单选：原生 radio 放在 label 里、视觉上隐藏，整张卡片都可以点。方向键切换、读屏朗读、
 * 表单行为都由浏览器保证，测试里也能直接按 `getByRole("radio")` 找到。选中时边框换成 Ink。
 *
 * 用在新建页的作品类型、导入向导的评级和权利、发布对话框的可见性上。
 */
import type * as React from "react";
import { cn } from "@/lib/utils";

export function ChoiceCard({
  name,
  value,
  checked,
  onSelect,
  title,
  description,
  leading,
  children,
  indicator = false,
  disabled,
  className,
}: {
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 标题上方的内容，例如类型图标。 */
  leading?: React.ReactNode;
  /** 说明下方的补充，例如例子。 */
  children?: React.ReactNode;
  /** 在右上角画一个单选圆点。选项少、说明长的时候用它让“这是单选”更明显。 */
  indicator?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      data-checked={checked || undefined}
      className={cn(
        "relative flex min-w-0 cursor-pointer flex-col gap-1 rounded-lg border bg-surface p-4 text-left transition-[border-color,box-shadow,background-color]",
        "hover:bg-surface-2/50 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40",
        checked ? "border-ink ring-1 ring-ink" : "border-border",
        disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="sr-only"
      />
      {indicator ? (
        <span
          aria-hidden
          className={cn(
            "absolute top-4 right-4 flex size-4 items-center justify-center rounded-full border bg-surface",
            checked ? "border-ink" : "border-border-strong",
          )}
        >
          {checked ? <span className="size-2 rounded-full bg-ink" /> : null}
        </span>
      ) : null}
      {leading}
      <span className={cn("text-sm font-semibold text-text", indicator && "pr-6")}>{title}</span>
      {description ? <span className="text-xs text-text-2">{description}</span> : null}
      {children}
    </label>
  );
}
