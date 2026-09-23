/**
 * 徽章：全圆角的小标签。颜色有固定含义——primary / purple / blue 是三种作品类型，
 * success / warning / danger 用于评级和状态，neutral 是普通标签，ink 表示强调（例如 Core 依赖）。
 * 作品类型、评级、状态、tag 请用 `@/components/badges` 和 `@/components/rating` 里的现成组件。
 */
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2 py-0.5 text-xs leading-4 font-semibold whitespace-nowrap transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        /** 普通标签：弱底色、次要文字。 */
        neutral: "border-transparent bg-surface-2 text-text-2",
        /** 白底描边：作品类型徽章的底（配合圆点）。 */
        outline: "border-border bg-surface text-text",
        primary: "border-transparent bg-primary-soft text-primary-text",
        purple: "border-transparent bg-purple-soft text-purple-text",
        blue: "border-transparent bg-blue-soft text-blue-text",
        success: "border-transparent bg-success-soft text-success",
        warning: "border-transparent bg-warning-soft text-warning",
        danger: "border-transparent bg-danger-soft text-danger",
        "danger-solid": "border-transparent bg-danger text-on-danger",
        ink: "border-transparent bg-ink text-on-ink",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";
  return (
    <Comp
      data-slot="badge"
      data-variant={variant ?? "neutral"}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, type BadgeVariant, badgeVariants };
