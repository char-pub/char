/**
 * 标签页：下划线样式，选中项是正文色加橙色下划线。
 *
 * 页面内切换用 Radix 的 `Tabs`。按路由切换的标签页（例如作品页的 Overview / Versions）
 * 不要用 Radix，直接把 `<Link>` 放进 `<TabsNav>`，class 用 `tabsTriggerVariants()`：
 * TanStack Router 会给当前链接加 `aria-current="page"`，样式按它高亮。
 */
import { cva } from "class-variance-authority";
import { Tabs as TabsPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

const tabsListClass =
  "flex w-full items-center gap-1 overflow-x-auto border-b border-border [scrollbar-width:none]";

const tabsTriggerVariants = cva(
  "relative -mb-px inline-flex shrink-0 items-center justify-center gap-1.5 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium whitespace-nowrap text-text-2 transition-colors outline-none hover:text-text focus-visible:rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-primary data-[state=active]:text-text aria-[current=page]:border-primary aria-[current=page]:text-text [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
);

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  );
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List data-slot="tabs-list" className={cn(tabsListClass, className)} {...props} />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(tabsTriggerVariants(), className)}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  );
}

/** 按路由切换的标签栏：一个带名字的 `<nav>`，里面放 `<Link className={tabsTriggerVariants()}>`。 */
function TabsNav({ className, ...props }: React.ComponentProps<"nav">) {
  return <nav data-slot="tabs-nav" className={cn(tabsListClass, className)} {...props} />;
}

export { Tabs, TabsContent, TabsList, TabsNav, TabsTrigger, tabsTriggerVariants };
