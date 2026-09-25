/**
 * 下载菜单：Context IR 直接下载；CCv3 角色卡由服务端按需导出，构建中时按 `Retry-After`
 * 轮询，就绪后交给浏览器下载。导出进度写在按钮下方（`aria-live`），出错也在这里说明。
 */
import { ChevronDown, Download, FileJson, IdCard } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type Ccv3LossReport, irDownloadUrl } from "@/lib/api";
import { useRegistry } from "@/lib/registry";
import { cn } from "@/lib/utils";
import { ArtifactPicker } from "./artifact-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

/** 导出最多等待的次数；超过后请用户稍后再试。 */
const MAX_POLLS = 24;

type ExportStatus = "idle" | "building" | "error" | "timeout";

const STATUS_TEXT: Record<Exclude<ExportStatus, "idle">, string> = {
  building: "Preparing the character card and its loss report…",
  timeout: "The card is taking longer than usual. Try again in a minute.",
  error: "The character card could not be exported. Try again later.",
};

/** CCv3 导出的轮询。返回当前状态和开始导出的函数。 */
function useCardExport(ns: string, name: string, label: string) {
  const client = useRegistry();
  const [status, setStatus] = useState<ExportStatus>("idle");
  const [ready, setReady] = useState<{
    cardUrl: string;
    lossUrl: string;
    loss: Ccv3LossReport;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current += 1;
      clearTimeout(timer.current);
    },
    [],
  );
  const reset = () => {
    sequence.current += 1;
    clearTimeout(timer.current);
    setReady(null);
    setStatus("idle");
  };
  const start = async (attempt = 0, preset?: string, previousSequence?: number) => {
    const request = previousSequence ?? ++sequence.current;
    setStatus("building");
    setReady(null);
    try {
      const result = await client.exportCcv3(ns, name, label, preset);
      if (sequence.current !== request) return;
      if (result.state === "ready") {
        const loss = await client.getCcv3Loss(ns, name, label, preset);
        if (sequence.current !== request) return;
        const separator = result.url.includes("?") ? "&" : "?";
        setReady({
          cardUrl: `${result.url + separator}part=card`,
          lossUrl: `${result.url + separator}part=loss`,
          loss,
        });
        setStatus("idle");
        return;
      }
      if (attempt + 1 >= MAX_POLLS) {
        setStatus("timeout");
        return;
      }
      timer.current = setTimeout(
        () => void start(attempt + 1, preset, request),
        result.retryAfter * 1000,
      );
    } catch {
      if (sequence.current === request) setStatus("error");
    }
  };
  return { status, start, ready, reset };
}

/** 切换版本时调用方用 `key={label}` 重新挂载，放弃上一个版本还没完成的导出。 */
export function DownloadMenu({
  ns,
  name,
  label,
  canExportCard,
  kind = "content",
  className,
}: {
  ns: string;
  name: string;
  /** 没有可下载的版本（还没发布、已移除）时为 undefined，按钮不可用。 */
  label: string | undefined;
  /** CCv3 只能表达单个角色。 */
  canExportCard: boolean;
  kind?: "content" | "preset" | "prompt-module";
  /** 加在下载按钮上。 */
  className?: string;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const [preset, setPreset] = useState<{ ref: string; release: string } | null>(null);
  const card = useCardExport(ns, name, label ?? "");
  const building = card.status === "building";
  // 不加外层元素：按钮和进度说明直接排进调用方的 flex 容器，说明文字占一整行。
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button disabled={!label} className={className}>
            <Download aria-hidden />
            {building ? "Preparing…" : "Download"}
            <ChevronDown aria-hidden className="-mr-1 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        {label ? (
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="font-mono">{label}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a
                href={
                  kind === "content"
                    ? irDownloadUrl(ns, name, label)
                    : irDownloadUrl(ns, name, label).replace(/\/ir$/, "/artifact")
                }
                download={`${ns}-${name}-${label}.json`}
              >
                <FileJson aria-hidden />
                <span className="flex flex-col">
                  <span>{kind === "content" ? "Context IR" : "Policy artifact"}</span>
                  <span className="text-xs font-normal text-text-3">Runtime-ready JSON</span>
                </span>
              </a>
            </DropdownMenuItem>
            {canExportCard ? (
              <DropdownMenuItem disabled={building} onSelect={() => setExportOpen(true)}>
                <IdCard aria-hidden />
                <span className="flex flex-col">
                  <span>Character card (CCv3)</span>
                  <span className="text-xs font-normal text-text-3">
                    For apps that import character cards
                  </span>
                </span>
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        ) : null}
      </DropdownMenu>
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export a character card</DialogTitle>
            <DialogDescription>
              Policy is omitted by default. Choose a particular preset to include its instructions;
              layout, budgets and capabilities cannot be represented fully and are reported as
              losses.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            {preset ? `${preset.ref} · ${preset.release}` : "No preset selected"}
          </p>
          <ArtifactPicker
            label="Optional export preset"
            types={["preset"]}
            onPick={({ artifact }) => {
              card.reset();
              setPreset(artifact.root);
            }}
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                card.reset();
                setPreset(null);
              }}
            >
              Omit policy
            </Button>
            <Button
              disabled={building}
              onClick={() => {
                void card.start(0, preset?.release);
              }}
            >
              Prepare selected settings
            </Button>
          </div>
          {card.status !== "idle" ? (
            <p role="status" className="text-sm">
              {STATUS_TEXT[card.status]}
            </p>
          ) : null}
          {card.ready ? (
            <section aria-label="Export loss report" className="space-y-3 rounded border p-3">
              <h3 className="font-semibold">Ready — review the export losses</h3>
              <p className="text-sm">
                The report describes the exact character and preset selected for this export.
              </p>
              <ul className="list-inside list-disc text-sm">
                <li>{card.ready.loss.flattened_dependencies.length} dependencies flattened</li>
                <li>{card.ready.loss.activation_downgrades.length} activation rules dropped</li>
                <li>{card.ready.loss.visibility.length} visibility changes</li>
                <li>{card.ready.loss.context_assets.length} context assets lost</li>
                <li>{card.ready.loss.other.length} other changes</li>
              </ul>
              <details>
                <summary className="cursor-pointer text-sm">Full loss report</summary>
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs">
                  {JSON.stringify(card.ready.loss, null, 2)}
                </pre>
              </details>
              <div className="flex gap-3 text-sm">
                <a className="font-semibold underline" href={card.ready.cardUrl} download>
                  Download character card
                </a>
                <a className="underline" href={card.ready.lossUrl} download>
                  Download loss report
                </a>
              </div>
            </section>
          ) : null}
        </DialogContent>
      </Dialog>
      <p
        aria-live="polite"
        className={cn(
          "order-last basis-full text-xs lg:text-right",
          card.status === "idle"
            ? "sr-only"
            : card.status === "building"
              ? "text-text-2"
              : "text-danger",
        )}
      >
        {card.status === "idle" ? "" : STATUS_TEXT[card.status]}
      </p>
    </>
  );
}
