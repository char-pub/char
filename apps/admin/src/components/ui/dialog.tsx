/**
 * 对话框：基于原生 `<dialog>` 元素。所有写操作都在对话框里完成：填写理由、确认，再提交。
 *
 * 不用 Radix Dialog，是因为它的滚动锁定会注入 `<style>` 元素，违反 admin 的严格 CSP
 * （`style-src 'self'`）。原生 `showModal()` 本身就提供焦点限制、Esc 关闭和背景遮罩。
 */
import { X } from "lucide-react";
import type * as React from "react";
import { createContext, useContext, useEffect, useId, useRef } from "react";
import { cn } from "@/lib/utils";

interface DialogCtx {
  titleId: string;
  descriptionId: string;
  close: () => void;
}

const Ctx = createContext<DialogCtx | null>(null);

function useDialog(): DialogCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("Dialog parts must be used inside <Dialog>");
  return c;
}

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);
  const close = () => onOpenChange(false);
  return (
    <Ctx.Provider value={{ titleId, descriptionId, close }}>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClose={close}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-md border bg-card p-0 text-card-foreground shadow-lg backdrop:bg-black/50"
      >
        {open ? children : null}
      </dialog>
    </Ctx.Provider>
  );
}

export function DialogContent({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { close } = useDialog();
  return (
    <div className={cn("relative space-y-4 p-5", className)}>
      {children}
      <button
        type="button"
        onClick={close}
        className="absolute top-3 right-3 rounded-sm p-1 text-muted-foreground hover:bg-muted"
        aria-label="Close"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

export function DialogTitle({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { titleId } = useDialog();
  return (
    <h2 id={titleId} className={cn("pr-8 text-base font-semibold", className)}>
      {children}
    </h2>
  );
}

export function DialogDescription({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { descriptionId } = useDialog();
  return (
    <p id={descriptionId} className={cn("text-sm text-muted-foreground", className)}>
      {children}
    </p>
  );
}
