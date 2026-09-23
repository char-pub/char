/**
 * 作品卡片：首页、探索页、作者主页共用。显示头像、显示名、`@ns/name`、类型、effective
 * rating、两行简介、tag 和最新版本号。
 *
 * 成人内容由服务端按账号设置过滤，出现在列表里的卡片都是当前用户可以看的，这里不再遮挡。
 * 整张卡片可以点击：标题链接用伪元素铺满卡片，tag 链接浮在它上面，键盘焦点只落在标题和
 * tag 上，不会出现嵌套的可交互元素。
 */
import type { CreationType } from "@char-pub/core";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { CreationSummary } from "@/lib/api";
import { API_BASE_URL } from "@/lib/api";
import { localized, parseRef } from "@/lib/text";
import { cn } from "@/lib/utils";
import { Tag, TYPE_STYLE, TypeBadge } from "./badges";
import { RatingBadge } from "./rating";
import { UserText } from "./user-content";

/**
 * 作品头像按需加载，缺少图片或加载失败时用类型色的浅底加名字首字；
 * 纯装饰，读屏不读。
 */
export function CreationAvatar({
  name,
  type,
  className,
  url,
}: {
  name: string;
  type: CreationType;
  className?: string;
  url?: string | undefined;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const s = TYPE_STYLE[type];
  const initial = [...name.trim()][0]?.toUpperCase() ?? "?";
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-12 shrink-0 items-center justify-center rounded-md text-lg font-bold",
        s.soft,
        s.text,
        className,
      )}
    >
      {url && failedUrl !== url ? (
        <img
          src={url.startsWith("/") ? `${API_BASE_URL}${url}` : url}
          alt=""
          loading="lazy"
          className="size-full rounded-md object-cover"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        initial
      )}
    </span>
  );
}

/**
 * 版本号的显示：数字开头的 label（`1.2.0`）加上 `v`，其他 label（`beta`）原样显示。
 * label 只是作者起的名字，不一定是 SemVer。
 */
export function releaseLabel(label: string): string {
  return /^\d/.test(label) ? `v${label}` : label;
}

export function CreationCard({ item, className }: { item: CreationSummary; className?: string }) {
  const r = parseRef(item.ref);
  const title = localized(item.display_name);
  const summary = item.summary ? localized(item.summary) : "";
  const label = item.latest_release?.label;
  return (
    <article
      className={cn(
        "relative flex h-full flex-col gap-3 rounded-lg border bg-surface p-4 transition-colors hover:border-border-strong has-[[data-card-link]:focus-visible]:border-ring has-[[data-card-link]:focus-visible]:ring-[3px] has-[[data-card-link]:focus-visible]:ring-ring/30",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <CreationAvatar name={title} type={item.type} url={item.avatar_url} />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-base leading-snug font-bold break-words">
            {r ? (
              <Link
                to="/c/$ns/$name"
                params={r}
                data-card-link=""
                className="outline-none after:absolute after:inset-0 after:rounded-lg"
              >
                <UserText text={title} />
              </Link>
            ) : (
              <UserText text={title} />
            )}
          </h3>
          <p className="truncate font-mono text-xs text-text-3" title={item.ref}>
            {item.ref}
          </p>
        </div>
      </div>
      {summary ? (
        <p className="line-clamp-2 text-sm text-text-2 break-words">
          <UserText text={summary} />
        </p>
      ) : null}
      {item.tags.length > 0 ? (
        <ul aria-label="Tags" className="flex flex-wrap gap-1.5">
          {item.tags.slice(0, 3).map((t) => (
            <li key={t} className="max-w-full">
              {/* 浮在标题链接的伪元素之上，才能单独点击。 */}
              <Tag tag={t} className="relative z-10" />
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
        <TypeBadge type={item.type} />
        <RatingBadge rating={item.effective_rating ?? item.rating} />
        {label ? (
          <span
            className="ml-auto max-w-[45%] truncate font-mono text-xs text-text-3"
            title={label}
          >
            <span className="sr-only">Latest release </span>
            {releaseLabel(label)}
          </span>
        ) : null}
      </div>
    </article>
  );
}
