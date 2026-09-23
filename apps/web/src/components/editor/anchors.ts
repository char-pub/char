/**
 * 编辑器里各个字段和折叠区的锚点，以及诊断的 `subject` 指向哪里。
 *
 * 检查栏和发布对话框里的问题都能点过去：先展开对应的折叠区，再滚动到字段并把焦点放进去。
 * 页面上只有一个编辑器，所以锚点用固定的 id。
 */
import type { CreationType } from "@char-pub/core";
import { getFragments, MAIN_FRAGMENT, type Working } from "@/lib/draft";

export type SectionKey = "passages" | "dependencies" | "meta" | "language";

export const ANCHOR = {
  name: "edit-name",
  main: "edit-main",
  summary: "edit-summary",
  greeting: "edit-greeting",
  avatar: "edit-avatar",
  passages: "edit-passages",
  dependencies: "edit-dependencies",
  meta: "edit-meta",
  language: "edit-language",
} as const;

export interface Target {
  anchor: string;
  section?: SectionKey;
}

/** 正文 fragment 的 ID：按约定的 ID 找，找不到时取第一个同类 fragment。 */
export function mainFragmentId(w: Working, type: CreationType): string | undefined {
  const main = MAIN_FRAGMENT[type];
  const list = getFragments(w);
  return list.find((f) => f.id === main?.id)?.id ?? list.find((f) => f.kind === main?.kind)?.id;
}

export function targetOf(subject: string, type: CreationType, w: Working): Target | null {
  if (subject === "display_name" || subject.startsWith("display_name.")) {
    return { anchor: ANCHOR.name };
  }
  if (subject === "summary" || subject.startsWith("summary.")) return { anchor: ANCHOR.summary };
  if (subject.startsWith("bootstrap")) return { anchor: ANCHOR.greeting };
  if (subject.startsWith("assets")) return { anchor: ANCHOR.avatar };
  if (subject === "fragments") return { anchor: ANCHOR.main };
  if (subject.startsWith("fragments")) {
    const main = mainFragmentId(w, type);
    if (main && (subject.startsWith(`fragments[${main}]`) || subject === `fragments#${main}`)) {
      return { anchor: ANCHOR.main };
    }
    return { anchor: ANCHOR.passages, section: "passages" };
  }
  // 发布检查的 subject 常常直接是依赖的 ref（`@ns/name`）。
  if (subject.startsWith("references") || subject.startsWith("@")) {
    return { anchor: ANCHOR.dependencies, section: "dependencies" };
  }
  if (subject.startsWith("meta.default_locale")) {
    return { anchor: ANCHOR.language, section: "language" };
  }
  if (subject.startsWith("meta") || subject.startsWith("license")) {
    return { anchor: ANCHOR.meta, section: "meta" };
  }
  return null;
}

/** 滚动到锚点并把焦点放到其中第一个可以输入的控件上。 */
export function scrollToAnchor(anchor: string): void {
  // 折叠区刚展开时内容还没渲染，等下一帧。
  requestAnimationFrame(() => {
    const el = document.getElementById(anchor);
    if (!el) return;
    el.scrollIntoView?.({ behavior: "smooth", block: "start" });
    const field = el.matches("input, textarea, select, button")
      ? el
      : el.querySelector<HTMLElement>("input:not([type=hidden]), textarea, select, button");
    field?.focus({ preventScroll: true });
  });
}
