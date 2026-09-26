/**
 * 展示用的小徽章：作品类型、状态、tag。评级徽章在 `rating.tsx`。
 *
 * 类型色是固定规则：Character 橙、World 紫、Lorebook 蓝（三个品牌节点色）；其余类型
 * （v0 还不开放创作）用中性灰。卡片、依赖列表、token 占比条也应该用 `TYPE_STYLE` 里的同一组颜色。
 */
import type { CreationType } from "@char-pub/core";
import { Link } from "@tanstack/react-router";
import { Archive, CircleDot, Lock, Pencil, Star, TriangleAlert } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { Badge, type BadgeVariant } from "./ui/badge";

export interface TypeStyle {
  label: string;
  /** 实心色：圆点、占比条。 */
  dot: string;
  /** 浅底：图标底、选中态。 */
  soft: string;
  /** 当文字用的加深色。 */
  text: string;
}

const NEUTRAL = { dot: "bg-text-3", soft: "bg-surface-2", text: "text-text-2" };

export const TYPE_STYLE: Record<CreationType, TypeStyle> = {
  character: {
    label: "Character",
    dot: "bg-primary",
    soft: "bg-primary-soft",
    text: "text-primary-text",
  },
  world: { label: "World", dot: "bg-purple", soft: "bg-purple-soft", text: "text-purple-text" },
  lorebook: { label: "Lorebook", dot: "bg-blue", soft: "bg-blue-soft", text: "text-blue-text" },
  relationship: { label: "Relationship", ...NEUTRAL },
  scenario: { label: "Scenario", ...NEUTRAL },
  persona: { label: "Persona", ...NEUTRAL },
  style: { label: "Style", ...NEUTRAL },
  preset: { label: "Preset", ...NEUTRAL },
  "prompt-module": { label: "Prompt module", ...NEUTRAL },
};

/** 作品类型：白底描边加类型色圆点，例如“● Character”。 */
export function TypeBadge({ type, className }: { type: CreationType; className?: string }) {
  const s = TYPE_STYLE[type];
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-medium", className)}>
      <span aria-hidden className={cn("size-2 rounded-full", s.dot)} />
      {s.label}
    </Badge>
  );
}

export type StatusKind =
  | "latest"
  | "yanked"
  | "removed"
  | "private"
  | "draft"
  | "open"
  | "accepted"
  | "rejected"
  | "withdrawn";

const STATUS: Record<
  StatusKind,
  { label: string; variant: BadgeVariant; icon?: React.ComponentType<{ className?: string }> }
> = {
  latest: { label: "Latest", variant: "ink", icon: Star },
  yanked: { label: "Yanked", variant: "warning", icon: TriangleAlert },
  removed: { label: "Removed", variant: "danger", icon: Archive },
  private: { label: "Private", variant: "neutral", icon: Lock },
  draft: { label: "Draft", variant: "neutral", icon: Pencil },
  open: { label: "Open", variant: "blue", icon: CircleDot },
  accepted: { label: "Accepted", variant: "success" },
  rejected: { label: "Rejected", variant: "danger" },
  withdrawn: { label: "Withdrawn", variant: "neutral" },
};

/**
 * 版本、作品和贡献的状态。API 里的 `tombstoned` 在界面上叫 removed；
 * `label` 可以覆盖默认文案（例如 “Yanked · v1.2.0”）。
 */
export function StatusBadge({
  status,
  label,
  className,
}: {
  status: StatusKind | "tombstoned";
  label?: string;
  className?: string;
}) {
  const s = STATUS[status === "tombstoned" ? "removed" : status];
  const Icon = s.icon;
  return (
    <Badge variant={s.variant} className={className}>
      {Icon ? <Icon aria-hidden /> : null}
      {label ?? s.label}
    </Badge>
  );
}

const tagClass =
  "inline-flex max-w-full items-center truncate rounded-sm bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-2";

/**
 * 作品的 tag。默认链接到按这个 tag 筛选的探索页；`link={false}` 时只是文字。
 * tag 由作者填写，按普通文本渲染。
 */
export function Tag({
  tag,
  link = true,
  className,
}: {
  tag: string;
  link?: boolean;
  className?: string;
}) {
  if (!link) return <span className={cn(tagClass, className)}>{tag}</span>;
  return (
    <Link
      to="/browse"
      search={{ tag }}
      className={cn(tagClass, "transition-colors hover:bg-border hover:text-text", className)}
    >
      {tag}
    </Link>
  );
}
