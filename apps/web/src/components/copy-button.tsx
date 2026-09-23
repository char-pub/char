/** 复制标识符（`@ns/name@label`、digest）的小按钮，成功后用 toast 提示。 */
import { Copy } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

export function CopyButton({
  text,
  label,
  className,
}: {
  text: string;
  /** 读屏用的名字，例如 “Copy @djj/alice@1.2.0”。 */
  label: string;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      className={cn("text-text-3", className)}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => toast.success("Copied to the clipboard"),
          () => toast.error("Could not copy. Select the text and copy it instead."),
        );
      }}
    >
      <Copy aria-hidden />
    </Button>
  );
}
