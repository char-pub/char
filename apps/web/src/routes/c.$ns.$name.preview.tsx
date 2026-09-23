import { createFileRoute } from "@tanstack/react-router";
import { useCreation } from "@/components/creation-context";
import { matureReason } from "@/components/creation-facts";
import { MatureGate } from "@/components/mature-gate";
import { PreviewPanel } from "@/components/preview-panel";
import { ErrorState } from "@/components/states";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/c/$ns/$name/preview")({
  staticData: { creationVersioned: true },
  component: PreviewTab,
});

/**
 * 已发布版本的 Context Preview：取这个版本的 Context IR（与下载的是同一份），在浏览器里用
 * 参考 Assembler 组装，逐条说明每段内容为什么进入上下文、来自哪条依赖、被谁覆盖。
 * 成人内容和正文一样先遮挡。
 */
function PreviewTab() {
  const c = useCreation();
  if (!c.ir) {
    return c.irState === "error" ? (
      <ErrorState
        title="The context for this version could not be loaded"
        description="Try loading it again."
        onRetry={c.retryIr}
      />
    ) : (
      <div
        role="status"
        aria-label="Loading the context"
        className="grid gap-6 lg:grid-cols-[20rem_1fr]"
      >
        <Skeleton className="h-96 rounded-lg" />
        <div className="space-y-4">
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      </div>
    );
  }
  return (
    <MatureGate
      rating={c.rating}
      allowed={c.allowMature}
      remember={c.detail.ref}
      reason={matureReason(c.ir)}
      signedIn={!!c.me}
    >
      {/* 换版本时重新挂载，Session 设置回到默认值。 */}
      <PreviewPanel
        key={c.label}
        ir={c.ir}
        note={`Nothing here is sent anywhere — the context is assembled in your browser from ${c.selected?.visibility === "private" ? "this private" : "the public"} release.`}
      />
    </MatureGate>
  );
}
