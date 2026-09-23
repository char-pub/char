import type * as React from "react";
import { cn } from "@/lib/utils";
import { fieldClass } from "./input";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldClass, "flex field-sizing-content min-h-16 px-3 py-2", className)}
      {...props}
    />
  );
}

export { Textarea };
