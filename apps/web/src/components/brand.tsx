/**
 * 品牌标识：直接使用品牌子模块（vendor/brand-assets）里的 SVG，不手绘、不改色、不在仓库里
 * 复制文件。Vite 构建时把它们作为带 hash 的静态资源输出（同源，符合 CSP 的 img-src）。
 *
 * 品牌库为浅色和深色背景各给了一个版本，这里两个都渲染，按 `.dark` 用 CSS 切换显示。
 * - `BrandLogo variant="wordmark"`：mark + 矢量字标，顶栏用。
 * - `BrandLogo variant="lockup"`：横版 lockup（带 tagline），页脚等需要完整署名的位置用。
 * - `BrandLogo variant="mark"`：只有标志。
 * 按钮、头像等需要跟随文字颜色的地方用 `BrandMark`（内联 SVG，currentColor）。
 * 品牌要求标志不小于 24px，不加阴影、描边或渐变。
 */
import { cn } from "@/lib/utils";
import lockupDark from "../../../../vendor/brand-assets/logo/horizontal-lockup-dark.svg";
import lockupLight from "../../../../vendor/brand-assets/logo/horizontal-lockup-light.svg";
import markDark from "../../../../vendor/brand-assets/logo/mark-dark.svg";
import markLight from "../../../../vendor/brand-assets/logo/mark-light.svg";
import wordmarkDark from "../../../../vendor/brand-assets/logo/wordmark-dark.svg";
import wordmarkLight from "../../../../vendor/brand-assets/logo/wordmark-light.svg";

export { BrandMark } from "./brand-mark";

/** 每种素材的浅色 / 深色版本和原始宽高比（取自 SVG 的 viewBox）。 */
const ART = {
  mark: { light: markLight, dark: markDark, ratio: 512 / 512 },
  wordmark: { light: wordmarkLight, dark: wordmarkDark, ratio: 760 / 170 },
  lockup: { light: lockupLight, dark: lockupDark, ratio: 920 / 296 },
} as const;

function Art({ kind, height }: { kind: keyof typeof ART; height: number }) {
  const art = ART[kind];
  const width = Math.round(height * art.ratio);
  // 两张图的 alt 都为空：可读的名字由外层给出，避免读屏读两遍。
  return (
    <>
      <img src={art.light} alt="" width={width} height={height} className="block dark:hidden" />
      <img src={art.dark} alt="" width={width} height={height} className="hidden dark:block" />
    </>
  );
}

export function BrandLogo({
  variant = "wordmark",
  height,
  label = "char.pub",
  className,
}: {
  variant?: "wordmark" | "lockup" | "mark";
  /** 图形高度（px）。wordmark 指字标高度，mark 与字标按比例搭配。 */
  height?: number;
  /** 读屏读到的名字；外层链接已经有名字时传 `null`，整体对读屏隐藏。 */
  label?: string | null;
  className?: string;
}) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  if (variant === "wordmark") {
    const h = height ?? 22;
    return (
      <span {...a11y} className={cn("inline-flex shrink-0 items-center gap-1.5", className)}>
        <Art kind="mark" height={Math.round(h * 1.3)} />
        <Art kind="wordmark" height={h} />
      </span>
    );
  }
  return (
    <span {...a11y} className={cn("inline-flex shrink-0", className)}>
      <Art kind={variant} height={height ?? (variant === "lockup" ? 56 : 28)} />
    </span>
  );
}
