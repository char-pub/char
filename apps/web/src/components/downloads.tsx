/**
 * 下载：Context IR 直接下载；CCv3 角色卡由服务端按需导出，构建中时按 `Retry-After`
 * 轮询，就绪后交给浏览器下载。
 */
import { Download, FileJson } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { irDownloadUrl } from "@/lib/api";
import { useRegistry } from "@/lib/registry";

/** 导出最多等待的次数；超过后请用户稍后再试。 */
const MAX_POLLS = 24;

export function Downloads({
  ns,
  name,
  label,
  canExportCard,
}: {
  ns: string;
  name: string;
  label: string;
  /** CCv3 只能表达单个角色。 */
  canExportCard: boolean;
}) {
  const client = useRegistry();
  const [state, setState] = useState<"idle" | "building" | "error" | "timeout">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const exportCard = async (attempt = 0) => {
    setState("building");
    try {
      const r = await client.exportCcv3(ns, name, label);
      if (r.state === "ready") {
        setState("idle");
        window.location.assign(r.url);
        return;
      }
      if (attempt + 1 >= MAX_POLLS) {
        setState("timeout");
        return;
      }
      timer.current = setTimeout(() => void exportCard(attempt + 1), r.retryAfter * 1000);
    } catch {
      setState("error");
    }
  };

  return (
    <section aria-labelledby="c-dl" className="space-y-2">
      <h2 id="c-dl" className="text-xl">
        Download
      </h2>
      <div className="flex flex-wrap gap-2">
        <a
          href={irDownloadUrl(ns, name, label)}
          download={`${ns}-${name}-${label}.ir.json`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <FileJson aria-hidden /> Context IR
        </a>
        {canExportCard ? (
          <Button
            variant="outline"
            size="sm"
            disabled={state === "building"}
            onClick={() => void exportCard()}
          >
            <Download aria-hidden />
            {state === "building" ? "Preparing card…" : "Character card (CCv3)"}
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {state === "building"
          ? "The card is being built; the download starts when it is ready."
          : state === "timeout"
            ? "The card is taking longer than usual. Try again in a minute."
            : state === "error"
              ? "The card could not be exported."
              : "The Context IR is the resolved, runtime-ready form of this release."}
      </p>
    </section>
  );
}
