/**
 * 主题：浅色（Sand）/ 深色（Night）/ 跟随系统，默认跟随系统。
 *
 * 选择保存在 localStorage 的 `charpub.theme`（跟随系统时不保存）。首屏由 `public/theme-init.js`
 * 按同样的规则先给 `<html>` 加上 `.dark`，这里负责之后的切换、跟随系统变化和多个标签页同步。
 * 只改 `<html>` 的 class 和 theme-color，不需要 inline script（CSP 不允许）。
 */
import { useSyncExternalStore } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

const KEY = "charpub.theme";
/** 浏览器地址栏等界面的颜色，和页面底色一致。 */
const THEME_COLOR: Record<ResolvedTheme, string> = { light: "#F8F7F4", dark: "#171B22" };

function readPreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // 读不到 localStorage（隐私模式等）时按跟随系统处理。
  }
  return "system";
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  return pref === "system" ? systemTheme() : pref;
}

/** 把主题应用到页面：`<html>` 的 `.dark` 与 theme-color。 */
function apply(pref: ThemePreference): void {
  const resolved = resolveTheme(pref);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  // index.html 按系统偏好声明了两条 theme-color；手动选择时两条都改成所选主题的颜色。
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  for (const meta of metas) {
    const media = meta.getAttribute("media") ?? "";
    const own: ResolvedTheme = media.includes("dark") ? "dark" : "light";
    meta.content = THEME_COLOR[pref === "system" ? own : resolved];
  }
}

interface Snapshot {
  preference: ThemePreference;
  resolved: ResolvedTheme;
}

let snapshot: Snapshot | null = null;
const listeners = new Set<() => void>();

function current(): Snapshot {
  if (!snapshot) {
    const preference = readPreference();
    snapshot = { preference, resolved: resolveTheme(preference) };
  }
  return snapshot;
}

function refresh(): void {
  const preference = readPreference();
  snapshot = { preference, resolved: resolveTheme(preference) };
  apply(preference);
  for (const l of listeners) l();
}

export function setThemePreference(pref: ThemePreference): void {
  try {
    if (pref === "system") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, pref);
  } catch {
    // 保存失败时本次会话里仍然生效。
  }
  snapshot = { preference: pref, resolved: resolveTheme(pref) };
  apply(pref);
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("storage", onStorage);
    window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", onSystem);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", onStorage);
      window.matchMedia?.("(prefers-color-scheme: dark)").removeEventListener?.("change", onSystem);
    }
  };
}

/** 另一个标签页改了主题。 */
function onStorage(e: StorageEvent): void {
  if (e.key === KEY || e.key === null) refresh();
}

/** 系统深浅色变化：只有跟随系统时才需要重新应用。 */
function onSystem(): void {
  if (current().preference === "system") refresh();
}

const SERVER: Snapshot = { preference: "system", resolved: "light" };

/** 当前主题。`preference` 是用户的选择，`resolved` 是实际生效的浅色或深色。 */
export function useTheme(): Snapshot & { setPreference: (p: ThemePreference) => void } {
  const s = useSyncExternalStore(subscribe, current, () => SERVER);
  return { ...s, setPreference: setThemePreference };
}
