/**
 * 深浅色切换。默认跟随系统；用户手动选择后记在 localStorage。
 * 切换只改 `<html>` 上的 class，不需要 inline script（CSP 不允许）。
 */
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const KEY = "charpub.theme";

function initialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem(KEY);
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="rounded-sm p-1.5 hover:bg-muted"
      aria-label={`Switch to ${next} theme`}
      onClick={() => {
        window.localStorage.setItem(KEY, next);
        setTheme(next);
      }}
    >
      {theme === "dark" ? (
        <Sun aria-hidden className="size-4" />
      ) : (
        <Moon aria-hidden className="size-4" />
      )}
    </button>
  );
}
