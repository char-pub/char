/**
 * 从 Context IR 的依赖图里取作品页要展示的事实：直接依赖和它们的关系、每个作品的类型、
 * 决定 effective rating 的来源。只做数据整理，文案由组件决定。
 */
import type { ContextIR, CreationType, Rating } from "@char-pub/core";

/** 根实例在 IR 里的 key 固定是 `root`。 */
const ROOT_INSTANCE = "root";

export interface Dependency {
  ref: string;
  /** 锁定的 Release ID。 */
  release: string;
  type: CreationType;
  name: string;
  /** 根作品直接引用它时才有：展示用的关系（lives_in、knows_about……）和 Core / Recommended。 */
  rel?: string | undefined;
  mode?: "intrinsic" | "default" | undefined;
  /** false 表示它是被别的依赖带进来的。 */
  direct: boolean;
}

/** 依赖闭包里除根作品以外的每个作品；直接依赖排在前面，顺序与 IR 一致。 */
export function dependenciesOf(ir: ContextIR): Dependency[] {
  const refOf = new Map(ir.graph.instances.map((i) => [i.key, i.ref]));
  const edges = new Map<string, ContextIR["graph"]["edges"][number]>();
  for (const e of ir.graph.edges) {
    const ref = refOf.get(e.to_instance);
    if (e.from_instance === ROOT_INSTANCE && ref && !edges.has(ref)) edges.set(ref, e);
  }
  const deps = ir.graph.nodes
    .filter((n) => n.ref !== ir.root.ref)
    .map((n): Dependency => {
      const e = edges.get(n.ref);
      return {
        ref: n.ref,
        release: n.release,
        type: n.type,
        name: n.display_name,
        rel: e?.rel,
        mode: e?.mode,
        direct: !!e,
      };
    });
  return [...deps.filter((d) => d.direct), ...deps.filter((d) => !d.direct)];
}

/** 作品在依赖图里的类型与名字；不在图里时返回 undefined。 */
export function nodeOf(
  ir: ContextIR,
  ref: string,
): { type: CreationType; name: string; release: string } | undefined {
  const n = ir.graph.nodes.find((x) => x.ref === ref);
  return n ? { type: n.type, name: n.display_name, release: n.release } : undefined;
}

/** 常见关系的动词；其他关系把下划线换成空格。 */
const REL_VERB: Record<string, string> = {
  lives_in: "Lives in",
  knows_about: "Knows about",
  speaks_like: "Speaks like",
  based_on: "Based on",
  part_of: "Part of",
  relationship: "Relationship:",
};

/** 依赖关系的自然语言说法，例如 `lives_in` + “Night City” → “Lives in Night City”。 */
export function relPhrase(rel: string | undefined, name: string): string {
  if (!rel) return name;
  const verb = REL_VERB[rel] ?? rel.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  return `${verb} ${name}`;
}

/** 依赖模式在界面上的叫法：intrinsic 是 Core，default 是 Recommended。 */
export const MODE_LABEL = { intrinsic: "Core", default: "Recommended" } as const;

export type RatingSource = ContextIR["meta"]["rating_sources"][number];

export interface RatingReason {
  rating: Rating;
  /** 根作品自己声明的评级。 */
  own: Rating | undefined;
  /** 最终评级来自哪里：作者自己、某个依赖、还是某张图片。 */
  by: "self" | "dependency" | "asset";
  /** 评级等于最终评级的来源（决定评级的那些）。 */
  decisive: RatingSource[];
}

export function ratingReason(ir: ContextIR): RatingReason {
  const { rating, rating_sources } = ir.meta;
  const own = rating_sources.find((s) => s.ref === ir.root.ref && !s.asset)?.rating;
  const decisive = rating_sources.filter((s) => s.rating === rating);
  const by = decisive.some((s) => s.ref === ir.root.ref && !s.asset)
    ? "self"
    : decisive.some((s) => !s.asset)
      ? "dependency"
      : "asset";
  return { rating, own, by, decisive };
}

/** 作品自己的许可（不含 asset 的单独许可）。 */
export function ownLicense(ir: ContextIR): string | undefined {
  return ir.meta.licenses.find((l) => l.ref === ir.root.ref && !l.asset)?.license;
}
