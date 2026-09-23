import type * as React from "react";
import { cn } from "@/lib/utils";

/** 骨架块：加载时占住最终布局的位置。尺寸由调用方给（例如 `h-4 w-32`）。 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("rounded-md bg-surface-2 motion-safe:animate-pulse", className)}
      {...props}
    />
  );
}

export { Skeleton };
