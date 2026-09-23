import { AlertDialog as Alert } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";

export const AlertDialog = Alert.Root;
export const AlertDialogTrigger = Alert.Trigger;

export function AlertDialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Alert.Content>) {
  return (
    <Alert.Portal>
      <Alert.Overlay className="fixed inset-0 z-50 bg-foreground/40" />
      <Alert.Content
        className={cn(
          "catalog-card fixed top-1/2 left-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 space-y-4 p-6 pl-8",
          className,
        )}
        {...props}
      >
        {children}
      </Alert.Content>
    </Alert.Portal>
  );
}

export function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof Alert.Title>) {
  return <Alert.Title className={cn("font-display text-xl", className)} {...props} />;
}

export function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof Alert.Description>) {
  return (
    <Alert.Description className={cn("text-sm text-muted-foreground", className)} {...props} />
  );
}

export function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex justify-end gap-2 pt-2", className)} {...props} />;
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
  ...props
}: React.ComponentProps<typeof Alert.Action>) {
  return <Alert.Action className={cn(buttonVariants(), className)} {...props} />;
}
