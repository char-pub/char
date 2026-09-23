/**
 * 原生 <select> 的统一外观。只从几个文本选项里选一个时用它：移动端弹出系统选择器，
 * 键盘和读屏行为由浏览器保证，Playwright 的 selectOption 也能直接用。
 */
import { ChevronDown } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { fieldClass } from "./input";

function NativeSelect({
  className,
  size = "default",
  ...props
}: Omit<React.ComponentProps<"select">, "size"> & { size?: "sm" | "default" }) {
  return (
    <div
      data-slot="native-select-wrapper"
      className={cn("relative w-full has-[select:disabled]:opacity-60", className)}
    >
      <select
        data-slot="native-select"
        data-size={size}
        className={cn(
          fieldClass,
          "appearance-none pr-9 pl-3 data-[size=default]:h-9 data-[size=sm]:h-8",
        )}
        {...props}
      />
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-text-3"
      />
    </div>
  );
}

export { NativeSelect };
