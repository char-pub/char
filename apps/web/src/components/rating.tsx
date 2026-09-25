/**
 * 评级徽章与评级来源说明。effective rating 是依赖闭包与 asset 中的最高值，
 * 页面必须能解释它从哪里来。
 *
 * 配色固定：General 绿、Teen 琥珀、Mature 浅红底红字、Explicit 红色实心。
 */
import type { EffectiveMeta, Rating } from "@char-pub/core";
import { Badge, type BadgeVariant } from "./ui/badge";

const RATING_VARIANT: Record<Rating, BadgeVariant> = {
  general: "success",
  teen: "warning",
  mature: "danger",
  explicit: "danger-solid",
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
  return (
    <Badge variant={RATING_VARIANT[rating]} className={className}>
      {RATING_LABEL[rating]}
    </Badge>
  );
}

/** 列出每个评级来源；把决定最终评级的来源标出来。 */
export function RatingSources({ meta }: { meta: EffectiveMeta }) {
  return (
    <div>
      <p className="text-sm text-text-2">
        Rated <strong className="font-semibold text-text">{RATING_LABEL[meta.rating]}</strong>{" "}
        because it takes the highest rating found in the creation, its dependencies and its assets.
      </p>
      <ul className="mt-3 divide-y divide-border border-y border-border">
        {meta.rating_sources.map((s) => {
          const decisive = s.rating === meta.rating;
          return (
            <li
              key={`${s.ref}:${s.asset ?? ""}`}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <span className="font-mono text-xs">
                {s.ref}
                {s.asset ? <span className="text-text-3"> · asset {s.asset}</span> : null}
              </span>
              <span className="flex items-center gap-2">
                {decisive ? (
                  <span className="text-xs font-medium text-text-2">sets the rating</span>
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

export function highestRating(...ratings: (Rating | undefined)[]): Rating {
  const order: Rating[] = ["general", "teen", "mature", "explicit"];
  return (
    order[Math.max(0, ...ratings.map((rating) => (rating ? order.indexOf(rating) : 0)))] ??
    "general"
  );
}
