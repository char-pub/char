import { Check, Minus } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

/** 复选框。勾选后是 Ink 实心底；`checked="indeterminate"` 显示横线。 */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-[4px] border border-border-strong bg-surface transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger data-[state=checked]:border-ink data-[state=checked]:bg-ink data-[state=checked]:text-on-ink data-[state=indeterminate]:border-ink data-[state=indeterminate]:bg-ink data-[state=indeterminate]:text-on-ink",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="group flex items-center justify-center text-current"
      >
        <Check aria-hidden className="size-3.5 group-data-[state=indeterminate]:hidden" />
        <Minus aria-hidden className="hidden size-3.5 group-data-[state=indeterminate]:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
