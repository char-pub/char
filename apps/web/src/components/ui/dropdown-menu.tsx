import { Check, ChevronRight, Circle } from "lucide-react";
import { DropdownMenu as Menu } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;
export const DropdownMenuSub = Menu.Sub;
export const DropdownMenuRadioGroup = Menu.RadioGroup;

const contentClass =
  "z-50 min-w-48 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg motion-safe:data-[state=open]:animate-fade-in";

const itemClass =
  "relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-text-2";

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content sideOffset={sideOffset} className={cn(contentClass, className)} {...props} />
    </Menu.Portal>
  );
}

/** 菜单项。`variant="destructive"` 用于删除、吊销等危险操作。 */
export function DropdownMenuItem({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof Menu.Item> & { variant?: "default" | "destructive" }) {
  return (
    <Menu.Item
      data-variant={variant}
      className={cn(
        itemClass,
        "data-[variant=destructive]:text-danger data-[variant=destructive]:data-[highlighted]:bg-danger-soft data-[variant=destructive]:[&_svg]:text-danger",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Menu.CheckboxItem>) {
  return (
    <Menu.CheckboxItem className={cn(itemClass, "pr-2 pl-8", className)} {...props}>
      <span className="pointer-events-none absolute left-2 flex size-4 items-center justify-center">
        <Menu.ItemIndicator>
          <Check aria-hidden className="text-text" />
        </Menu.ItemIndicator>
      </span>
      {children}
    </Menu.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Menu.RadioItem>) {
  return (
    <Menu.RadioItem className={cn(itemClass, "pr-2 pl-8", className)} {...props}>
      <span className="pointer-events-none absolute left-2 flex size-4 items-center justify-center">
        <Menu.ItemIndicator>
          <Circle aria-hidden className="size-2 fill-current text-text" />
        </Menu.ItemIndicator>
      </span>
      {children}
    </Menu.RadioItem>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof Menu.Label>) {
  return <Menu.Label className={cn("px-2 py-1.5 text-xs text-text-3", className)} {...props} />;
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

/** 菜单项右侧的快捷键提示。 */
export function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn("ml-auto font-mono text-xs tracking-wide text-text-3", className)}
      {...props}
    />
  );
}

export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Menu.SubTrigger>) {
  return (
    <Menu.SubTrigger
      className={cn(itemClass, "data-[state=open]:bg-surface-2", className)}
      {...props}
    >
      {children}
      <ChevronRight aria-hidden className="ml-auto" />
    </Menu.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof Menu.SubContent>) {
  return (
    <Menu.Portal>
      <Menu.SubContent className={cn(contentClass, "min-w-36", className)} {...props} />
    </Menu.Portal>
  );
}
