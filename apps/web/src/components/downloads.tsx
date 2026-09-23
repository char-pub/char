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
import { irDownloadUrl } from "@/lib/api";
import { useRegistry } from "@/lib/registry";
import { cn } from "@/lib/utils";

/** 导出最多等待的次数；超过后请用户稍后再试。 */
const MAX_POLLS = 24;

type ExportStatus = "idle" | "building" | "error" | "timeout";

const STATUS_TEXT: Record<Exclude<ExportStatus, "idle">, string> = {
  building: "Preparing the character card… the download starts when it is ready.",
  timeout: "The card is taking longer than usual. Try again in a minute.",
  error: "The character card could not be exported. Try again later.",
};

/** CCv3 导出的轮询。返回当前状态和开始导出的函数。 */
function useCardExport(ns: string, name: string, label: string) {
  const client = useRegistry();
  const [status, setStatus] = useState<ExportStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const start = async (attempt = 0) => {
    setStatus("building");
    try {
      const r = await client.exportCcv3(ns, name, label);
      if (r.state === "ready") {
        setStatus("idle");
        window.location.assign(r.url);
        return;
      }
      if (attempt + 1 >= MAX_POLLS) {
        setStatus("timeout");
        return;
      }
      timer.current = setTimeout(() => void start(attempt + 1), r.retryAfter * 1000);
    } catch {
      setStatus("error");
    }
  };
  return { status, start };
}

/** 切换版本时调用方用 `key={label}` 重新挂载，放弃上一个版本还没完成的导出。 */
export function DownloadMenu({
  ns,
  name,
  label,
  canExportCard,
  className,
}: {
  ns: string;
  name: string;
  /** 没有可下载的版本（还没发布、已移除）时为 undefined，按钮不可用。 */
  label: string | undefined;
  /** CCv3 只能表达单个角色。 */
  canExportCard: boolean;
  /** 加在下载按钮上。 */
  className?: string;
}) {
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
              <a href={irDownloadUrl(ns, name, label)} download={`${ns}-${name}-${label}.ir.json`}>
                <FileJson aria-hidden />
                <span className="flex flex-col">
                  <span>Context IR</span>
                  <span className="text-xs font-normal text-text-3">Runtime-ready JSON</span>
                </span>
              </a>
            </DropdownMenuItem>
            {canExportCard ? (
              <DropdownMenuItem disabled={building} onSelect={() => void card.start()}>
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
