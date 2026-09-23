/**
 * 确认对话框：危险或不可撤销的操作（删除、吊销、yank）。不能点遮罩关闭，必须选一个按钮。
 * 最终的危险操作用 `<AlertDialogAction variant="destructive-solid">`。
 */
import type { VariantProps } from "class-variance-authority";
import { AlertDialog as Alert } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";
import { overlayClass } from "./dialog";

export const AlertDialog = Alert.Root;
export const AlertDialogTrigger = Alert.Trigger;

export function AlertDialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Alert.Content>) {
  return (
    <Alert.Portal>
      <Alert.Overlay className={overlayClass} />
      <Alert.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl border bg-popover p-6 text-popover-foreground shadow-xl outline-none motion-safe:data-[state=open]:animate-pop-in",
          className,
        )}
        {...props}
      >
        {children}
      </Alert.Content>
    </Alert.Portal>
  );
}

export function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid gap-1.5", className)} {...props} />;
}

export function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof Alert.Title>) {
  return (
    <Alert.Title
      className={cn("text-lg leading-snug font-bold tracking-tight", className)}
      {...props}
    />
  );
}

export function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof Alert.Description>) {
  return <Alert.Description className={cn("text-sm text-text-2", className)} {...props} />;
}

export function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

export function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof Alert.Cancel>) {
  return (
    <Alert.Cancel className={cn(buttonVariants({ variant: "outline" }), className)} {...props} />
  );
}

export function AlertDialogAction({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof Alert.Action> &
  Pick<VariantProps<typeof buttonVariants>, "variant">) {
  return <Alert.Action className={cn(buttonVariants({ variant }), className)} {...props} />;
}
