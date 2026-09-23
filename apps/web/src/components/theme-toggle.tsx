/**
 * 主题切换：浅色 / 深色 / 跟随系统（默认）。规则和存储见 `@/lib/theme`。
 *
 * - `ThemeToggle`：顶栏的图标按钮，点开是三个选项的菜单。
 * - `ThemeSubmenu`：账户菜单里的 “Theme: System” 子菜单。
 * - `ThemeSegmented`：移动端抽屉里的三段式切换。
 */
import { Monitor, Moon, Sun, SunMoon } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { THEME_OPTIONS, type ThemePreference, useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

const ICON: Record<ThemePreference, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };
const LABEL = Object.fromEntries(THEME_OPTIONS.map((o) => [o.value, o.label])) as Record<
  ThemePreference,
  string
>;

function isPreference(v: string): v is ThemePreference {
  return v === "light" || v === "dark" || v === "system";
}

function ThemeRadioItems() {
  const { preference, setPreference } = useTheme();
  return (
    <DropdownMenuRadioGroup
      value={preference}
      onValueChange={(v) => {
        if (isPreference(v)) setPreference(v);
      }}
    >
      {THEME_OPTIONS.map((o) => (
        <DropdownMenuRadioItem key={o.value} value={o.value}>
          {o.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const { preference } = useTheme();
  const Icon = preference === "system" ? SunMoon : ICON[preference];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={className}
          aria-label={`Theme: ${LABEL[preference]}`}
        >
          <Icon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        <ThemeRadioItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ThemeSubmenu() {
  const { preference } = useTheme();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <SunMoon aria-hidden /> Theme: {LABEL[preference]}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <ThemeRadioItems />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** 三段式切换。基于 Radix RadioGroup：方向键在选项间移动并立即切换。 */
export function ThemeSegmented({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  return (
    <RadioGroupPrimitive.Root
      aria-label="Theme"
      orientation="horizontal"
      value={preference}
      onValueChange={(v) => {
        if (isPreference(v)) setPreference(v);
      }}
      className={cn("grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1", className)}
    >
      {THEME_OPTIONS.map((o) => {
        const Icon = ICON[o.value];
        return (
          <RadioGroupPrimitive.Item
            key={o.value}
            value={o.value}
            className="flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-text-2 transition-colors outline-none hover:text-text focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[state=checked]:bg-surface data-[state=checked]:text-text"
          >
            <Icon aria-hidden className="size-4" />
            {o.label}
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}
