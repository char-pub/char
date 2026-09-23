/**
 * Context Preview 面板：对一份已解析好的 Context IR 调整 Session，在浏览器里运行参考
 * Assembler，展示 Assembly Trace（每个 fragment 为什么进入或没有进入上下文、来自哪条
 * 依赖、被谁覆盖）。Playground 的示例作品和作品页上已发布的 Release 共用它。
 */
import type { TokenizerName } from "@char-pub/assembler";
import type { ContextIR } from "@char-pub/core";
import { AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";
import { SessionControls } from "@/components/session-controls";
import { TraceSummary, TraceTable } from "@/components/trace-table";
import { DEFAULT_SETTINGS, type PreviewSettings, runPreview } from "@/lib/preview";
import { useTokenCounter } from "@/lib/use-token-counter";

export function PreviewPanel({
  ir,
  headingLevel = 2,
  initialSettings = DEFAULT_SETTINGS,
}: {
  ir: ContextIR;
  headingLevel?: 2 | 3;
  initialSettings?: PreviewSettings;
}) {
  const [settings, setSettings] = useState<PreviewSettings>(initialSettings);
  const [tokenizer, setTokenizer] = useState<TokenizerName>("estimate");
  const { counter, status } = useTokenCounter(tokenizer);
  const outcome = useMemo(() => runPreview(ir, settings, counter), [ir, settings, counter]);
  const Heading = headingLevel === 2 ? "h2" : "h3";

  return (
    <div className="grid gap-8 lg:grid-cols-[19rem_1fr]">
      <section aria-labelledby="pv-session" className="space-y-3">
        <Heading
          id="pv-session"
          className="font-mono text-xs uppercase tracking-wider text-muted-foreground"
        >
          Session
        </Heading>
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
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-foreground/80 pb-2">
          <Heading id="pv-trace" className="text-2xl">
            Context Preview
          </Heading>
          {outcome.ok ? <TraceSummary trace={outcome.result.trace} /> : null}
        </div>
        {outcome.ok ? (
          <TraceTable trace={outcome.result.trace} ir={ir} />
        ) : (
          <PreviewProblem title={outcome.title} detail={outcome.detail} code={outcome.code} />
        )}
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
    <div role="alert" className="catalog-card flex gap-3 border-seal/70 bg-seal-soft p-4 pl-7">
      <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-seal" />
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm">{detail}</p>
        {code ? <p className="mt-1 font-mono text-xs text-muted-foreground">{code}</p> : null}
      </div>
    </div>
  );
}
