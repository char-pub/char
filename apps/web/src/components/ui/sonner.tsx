/**
 * Toast（sonner）：保存、复制、吊销、发布等操作的即时反馈。`<Toaster />` 挂在根组件里，
 * 页面里直接调用 `toast("Token copied")`、`toast.success(...)`、`toast.error(...)`。
 *
 * 外观和设计一致：Ink 底、反色文字、浮层阴影，图标也用反色（Ink 底上状态色对比度不够）。
 * toast 只做补充反馈；需要用户处理的错误仍然要在出错的位置显示（toast 会自动消失，
 * 读屏也可能错过）。
 */
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from "lucide-react";
import type * as React from "react";
import { Toaster as Sonner, type ToasterProps, toast } from "sonner";
import { useTheme } from "@/lib/theme";

function Toaster(props: ToasterProps) {
  const { resolved } = useTheme();
  return (
    <Sonner
      theme={resolved}
      position="bottom-center"
      className="toaster group"
      icons={{
        success: <CircleCheck aria-hidden className="size-4" />,
        info: <Info aria-hidden className="size-4" />,
        warning: <TriangleAlert aria-hidden className="size-4" />,
        error: <CircleAlert aria-hidden className="size-4" />,
        loading: <LoaderCircle aria-hidden className="size-4 motion-safe:animate-spin" />,
      }}
      // sonner 的样式不在 Tailwind 的 layer 里，优先级更高，所以这里要加 `!`。
      toastOptions={{
        classNames: {
          toast: "font-sans! text-sm! font-medium! shadow-lg!",
          description: "text-on-ink/75!",
        },
      }}
      style={
        {
          "--normal-bg": "var(--ink)",
          "--normal-text": "var(--on-ink)",
          "--normal-border": "var(--ink)",
          "--border-radius": "var(--radius-lg)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster, toast };
