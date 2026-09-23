import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 输入框、文本框、下拉框共用的外观：白底、加深一级的边框、蓝色焦点环、出错时红边。
 * 窄屏用 16px 字号：iOS Safari 聚焦小于 16px 的输入框时会自动放大页面。
 */
export const fieldClass =
  "w-full min-w-0 rounded-md border border-input bg-surface text-base text-text md:text-sm transition-[color,box-shadow,border-color] outline-none placeholder:text-text-3 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60 aria-invalid:border-danger aria-invalid:ring-danger/20";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldClass,
        "h-9 px-3 py-1 selection:bg-primary-soft file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-text",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
