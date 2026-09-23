import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * 按钮。一个区块只放一个主操作（default，橙底 Ink 字）；其余用 outline、ghost 或 ink。
 * 危险操作平时用 destructive（白底红字红边），只有确认对话框里的最后一步用 destructive-solid。
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-danger aria-invalid:ring-danger/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /** 主操作：橙底 Ink 字（橙底白字对比度不够）。 */
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        /** 深色实心：同一区块已有主操作时的强调，或对话框里的确认。 */
        ink: "bg-ink text-on-ink hover:bg-ink/85",
        /** 次要操作：白底加深一级的边框。 */
        outline: "border border-border-strong bg-surface text-text hover:bg-surface-2",
        /** 弱底色：工具栏里的小操作（复制等）。 */
        secondary: "bg-surface-2 text-text hover:bg-border",
        ghost: "text-text-2 hover:bg-surface-2 hover:text-text",
        /** 危险操作的入口：白底红字红边。 */
        destructive:
          "border border-danger/70 bg-surface text-danger hover:bg-danger-soft focus-visible:ring-danger/30",
        /** 确认对话框里的最终危险操作：红色实心。 */
        "destructive-solid":
          "bg-danger text-on-danger hover:bg-danger/90 focus-visible:ring-danger/30",
        link: "h-auto px-0 text-blue-text underline-offset-4 hover:underline has-[>svg]:px-0",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-sm px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-11 px-6 text-[0.9375rem] has-[>svg]:px-5",
        icon: "size-9",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, type ButtonVariant, buttonVariants };
