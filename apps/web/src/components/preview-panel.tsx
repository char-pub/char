/**
 * Context Preview 面板：对一份已解析好的 Context IR 调整 Session，在浏览器里运行参考
 * Assembler，展示 Assembly Trace（每段内容为什么进入或没有进入上下文、来自哪条依赖、被谁
 * 覆盖）。Playground 的示例作品和作品页上已发布的版本共用它；组装不经过服务器。
 */
import type { TokenizerName } from "@char-pub/assembler";
import type { ContextIR } from "@char-pub/core";
import { TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { SessionControls } from "@/components/session-controls";
import { TraceSummary, TraceTable } from "@/components/trace-table";
import { DEFAULT_SETTINGS, type PreviewSettings, runPreview } from "@/lib/preview";
import { useTokenCounter } from "@/lib/use-token-counter";

export function PreviewPanel({
  ir,
  headingLevel = 2,
  initialSettings = DEFAULT_SETTINGS,
  note = "Nothing here is sent anywhere — the context is assembled in your browser.",
}: {
  ir: ContextIR;
  headingLevel?: 2 | 3;
  initialSettings?: PreviewSettings;
  /** 表格下方的一句说明。 */
  note?: string;
}) {
  const [settings, setSettings] = useState<PreviewSettings>(initialSettings);
  const [tokenizer, setTokenizer] = useState<TokenizerName>("estimate");
  const { counter, status } = useTokenCounter(tokenizer);
  const outcome = useMemo(() => runPreview(ir, settings, counter), [ir, settings, counter]);
  const Heading = headingLevel === 2 ? "h2" : "h3";

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <section
        aria-labelledby="pv-session"
        className="h-fit space-y-4 rounded-lg border bg-surface px-5 py-4"
      >
        <div className="space-y-0.5">
          <Heading id="pv-session" className="text-base font-semibold">
            Session
          </Heading>
          <p className="text-xs text-text-2">Change these to see what a runtime would send.</p>
        </div>
        <SessionControls
          ir={ir}
          settings={settings}
          onChange={setSettings}
          tokenizer={tokenizer}
          onTokenizer={setTokenizer}
          tokenizerStatus={status}
        />
      </section>

      <section aria-labelledby="pv-trace" className="min-w-0 space-y-4">
        <Heading id="pv-trace" className="sr-only">
          Context Preview
        </Heading>
        {outcome.ok ? (
          <>
            <TraceSummary trace={outcome.result.trace} ir={ir} />
            <TraceTable trace={outcome.result.trace} ir={ir} />
          </>
        ) : (
          <PreviewProblem title={outcome.title} detail={outcome.detail} code={outcome.code} />
        )}
        <p className="text-xs text-text-3">{note}</p>
      </section>
    </div>
  );
}

export function PreviewProblem({
  title,
  detail,
  code,
}: {
  title: string;
  detail: string;
  code?: string;
}) {
  return (
    <div role="alert" className="flex gap-3 rounded-lg bg-danger-soft px-5 py-4">
      <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
      <div className="space-y-0.5">
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-text-2">{detail}</p>
        {code ? <p className="mt-1 font-mono text-xs text-text-3">{code}</p> : null}
      </div>
    </div>
  );
}
