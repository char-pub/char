/**
 * char.pub 的标志（开放的 C 与三个节点），几何取自品牌子模块的 `logo/mark-light.svg`。
 *
 * 线条用 `currentColor`：浅色主题下是 Ink、深色主题下是 White，与品牌库的 light / dark 两个
 * 版本一致；三个节点的颜色固定（Orange 在中心、Purple 在上、Blue 在下）。
 * 品牌指南要求标志不小于 24px，不加阴影、描边或渐变。
 */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path
        fill="currentColor"
        d="M352 91 C290 58 220 59 165 81 C91 110 48 171 48 256 C48 341 91 402 165 431 C218 452 279 446 330 420 Q338 416 334 408 L306 354 Q302 346 293 352 C256 373 216 373 183 359 C143 342 120 304 120 256 C120 208 143 170 183 153 C220 137 262 140 300 163 Q309 168 315 159 L357 105 Q363 96 352 91 Z"
      />
      <path
        d="M292 256 C322 249 338 232 367 202 M292 256 C325 263 344 282 367 310"
        fill="none"
        stroke="currentColor"
        strokeWidth="18"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="237" cy="256" r="31" fill="#FF6B3D" />
      <circle cx="386" cy="194" r="32" fill="#8B5CF6" />
      <circle cx="386" cy="318" r="32" fill="#2563EB" />
    </svg>
  );
}
