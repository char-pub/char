/**
 * 评级徽章与评级来源说明。effective rating 是依赖闭包与 asset 中的最高值，
 * 页面必须能解释它从哪里来。
 */
import type { EffectiveMeta, Rating } from "@char-pub/core";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const RATING_STYLE: Record<Rating, string> = {
  general: "border-moss/50 bg-moss-soft text-moss",
  teen: "border-amber/50 bg-amber-soft text-foreground",
  mature: "border-seal/60 bg-seal-soft text-accent-foreground",
  explicit: "border-seal bg-seal text-primary-foreground",
};

export const RATING_LABEL: Record<Rating, string> = {
  general: "General",
  teen: "Teen",
  mature: "Mature",
  explicit: "Explicit",
};

export function isAdultRating(r: Rating): boolean {
  return r === "mature" || r === "explicit";
}

export function RatingBadge({ rating, className }: { rating: Rating; className?: string }) {
  const Icon = isAdultRating(rating) ? ShieldAlert : ShieldCheck;
  return (
    <span className={cn("stamp", RATING_STYLE[rating], className)}>
      <Icon aria-hidden className="size-3" />
      {RATING_LABEL[rating]}
    </span>
  );
}

/** 列出每个评级来源；把决定最终评级的来源标出来。 */
export function RatingSources({ meta }: { meta: EffectiveMeta }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">
        Rated <strong className="text-foreground">{RATING_LABEL[meta.rating]}</strong> because it
        takes the highest rating found in the creation, its dependencies and its assets.
      </p>
      <ul className="mt-3 divide-y divide-rule border-y border-rule">
        {meta.rating_sources.map((s) => {
          const decisive = s.rating === meta.rating;
          return (
            <li
              key={`${s.ref}:${s.asset ?? ""}`}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <span className="font-mono text-xs">
                {s.ref}
                {s.asset ? <span className="text-muted-foreground"> · asset {s.asset}</span> : null}
              </span>
              <span className="flex items-center gap-2">
                {decisive ? (
                  <span className="text-xs text-accent-foreground">sets the rating</span>
                ) : null}
                <RatingBadge rating={s.rating} />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
