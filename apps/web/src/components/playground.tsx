/**
 * Context Preview 工作台：左边选示例作品，中间调 Session，右边看 Assembly Trace。
 * IR 在浏览器里由 core 的 Resolver 现算，组装由参考 Assembler 完成，不经过服务器。
 */
import type { TokenizerName } from "@char-pub/assembler";
import type { ContextIR } from "@char-pub/core";
import { AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";
import { RatingBadge } from "@/components/rating";
import { SessionControls } from "@/components/session-controls";
import { TraceSummary, TraceTable } from "@/components/trace-table";
import { resolveSample, type Sample } from "@/fixtures/samples";
import { DEFAULT_SETTINGS, type PreviewSettings, runPreview } from "@/lib/preview";
import { useTokenCounter } from "@/lib/use-token-counter";
import { cn } from "@/lib/utils";

export function Playground({ samples }: { samples: Sample[] }) {
  const [sampleId, setSampleId] = useState(samples[0]?.id ?? "");
  const [settings, setSettings] = useState<PreviewSettings>(DEFAULT_SETTINGS);
  const [tokenizer, setTokenizer] = useState<TokenizerName>("estimate");
  const { counter, status } = useTokenCounter(tokenizer);

  const sample = samples.find((s) => s.id === sampleId) ?? samples[0];
  const resolved = useMemo(() => {
    if (!sample) return null;
    try {
      return { ok: true as const, ir: resolveSample(sample).ir };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) };
    }
  }, [sample]);

  const outcome = useMemo(
    () => (resolved?.ok ? runPreview(resolved.ir, settings, counter) : null),
    [resolved, settings, counter],
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[15rem_19rem_1fr]">
      <section aria-labelledby="pg-sources" className="space-y-3">
        <h2
          id="pg-sources"
          className="font-mono text-xs uppercase tracking-wider text-muted-foreground"
        >
          Creation
        </h2>
        <fieldset className="space-y-2">
          <legend className="sr-only">Sample creation</legend>
          {samples.map((s) => {
            const active = s.id === sample?.id;
            return (
              <label
                key={s.id}
                className={cn(
                  "catalog-card block cursor-pointer p-3 pl-7 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-seal",
                  active ? "border-seal bg-seal-soft/60" : "hover:bg-muted",
                )}
              >
                <input
                  type="radio"
                  name="sample"
                  value={s.id}
                  checked={active}
                  className="sr-only"
                  onChange={() => {
                    setSampleId(s.id);
                    setSettings((prev) => ({ ...prev, manualEnabled: [] }));
                  }}
                />
                <span className="block font-display text-base leading-tight">{s.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{s.description}</span>
              </label>
            );
          })}
        </fieldset>
        {resolved?.ok ? <IrFacts ir={resolved.ir} /> : null}
      </section>

      <section aria-labelledby="pg-session" className="space-y-3">
        <h2
          id="pg-session"
          className="font-mono text-xs uppercase tracking-wider text-muted-foreground"
        >
          Session
        </h2>
        {resolved?.ok ? (
          <SessionControls
            ir={resolved.ir}
            settings={settings}
            onChange={setSettings}
            tokenizer={tokenizer}
            onTokenizer={setTokenizer}
            tokenizerStatus={status}
          />
        ) : null}
      </section>

      <section aria-labelledby="pg-trace" className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-foreground/80 pb-2">
          <h2 id="pg-trace" className="text-2xl">
            Context Preview
          </h2>
          {outcome?.ok ? <TraceSummary trace={outcome.result.trace} /> : null}
        </div>
        {resolved && !resolved.ok ? (
          <Problem title="This creation could not be resolved" detail={resolved.message} />
        ) : null}
        {outcome && !outcome.ok ? (
          <Problem title={outcome.title} detail={outcome.detail} code={outcome.code} />
        ) : null}
        {outcome?.ok && resolved?.ok ? (
          <TraceTable trace={outcome.result.trace} ir={resolved.ir} />
        ) : null}
      </section>
    </div>
  );
}

function IrFacts({ ir }: { ir: ContextIR }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 border-t border-rule pt-3 text-xs">
      <dt className="text-muted-foreground">Root</dt>
      <dd className="font-mono">{ir.root.ref}</dd>
      <dt className="text-muted-foreground">Rating</dt>
      <dd>
        <RatingBadge rating={ir.meta.rating} />
      </dd>
      <dt className="text-muted-foreground">Fragments</dt>
      <dd className="font-mono">{ir.fragments.length}</dd>
      <dt className="text-muted-foreground">Dependencies</dt>
      <dd className="font-mono">{Math.max(ir.graph.nodes.length - 1, 0)}</dd>
      <dt className="text-muted-foreground">Lock</dt>
      <dd className="truncate font-mono" title={ir.lock_digest}>
        {ir.lock_digest.slice(0, 19)}…
      </dd>
    </dl>
  );
}

function Problem({ title, detail, code }: { title: string; detail: string; code?: string }) {
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
