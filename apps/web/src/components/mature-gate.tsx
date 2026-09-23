/**
 * mature / explicit 内容默认遮挡：用户必须主动确认后才显示。
 * 确认只在当前组件实例内有效；账号级的“显示成人内容”设置以后由用户设置提供，
 * 通过 `allowed` 传入。
 */
import type { Rating } from "@char-pub/core";
import { EyeOff } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { isAdultRating, RATING_LABEL } from "./rating";

export function MatureGate({
  rating,
  allowed = false,
  children,
}: {
  rating: Rating;
  /** 用户已在设置中开启成人内容显示。 */
  allowed?: boolean;
  children: ReactNode;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const descId = useId();
  if (!isAdultRating(rating) || allowed || confirmed) return <>{children}</>;
  return (
    <section
      aria-describedby={descId}
      className="catalog-card flex flex-col items-start gap-3 p-6 pl-8"
    >
      <p className="flex items-center gap-2 font-display text-lg">
        <EyeOff aria-hidden className="size-5 text-seal" />
        {RATING_LABEL[rating]} content is hidden
      </p>
      <p id={descId} className="max-w-prose text-sm text-muted-foreground">
        This creation is rated {RATING_LABEL[rating].toLowerCase()}. It is hidden by default. Only
        continue if you are an adult and want to see it.
      </p>
      <Button variant="outline" onClick={() => setConfirmed(true)}>
        Show {RATING_LABEL[rating].toLowerCase()} content
      </Button>
    </section>
  );
}
