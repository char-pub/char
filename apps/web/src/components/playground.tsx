/**
 * Context Preview 工作台：左边选示例作品，右边调 Session、看 Assembly Trace。
 * IR 在浏览器里由 core 的 Resolver 现算，组装由参考 Assembler 完成，不经过服务器。
 */
import type { ContextIR } from "@char-pub/core";
import { useMemo, useState } from "react";
import { PreviewPanel, PreviewProblem } from "@/components/preview-panel";
import { RatingBadge } from "@/components/rating";
import { resolveSample, type Sample } from "@/fixtures/samples";
import { cn } from "@/lib/utils";

export function Playground({ samples }: { samples: Sample[] }) {
  const [sampleId, setSampleId] = useState(samples[0]?.id ?? "");
  const sample = samples.find((s) => s.id === sampleId) ?? samples[0];
  const resolved = useMemo(() => {
    if (!sample) return null;
    try {
      return { ok: true as const, ir: resolveSample(sample).ir };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) };
    }
  }, [sample]);

  return (
    <div className="grid gap-8 lg:grid-cols-[15rem_1fr]">
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
                  onChange={() => setSampleId(s.id)}
                />
                <span className="block font-display text-base leading-tight">{s.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{s.description}</span>
              </label>
            );
          })}
        </fieldset>
        {resolved?.ok ? <IrFacts ir={resolved.ir} /> : null}
      </section>

      <div className="min-w-0">
        {resolved && !resolved.ok ? (
          <PreviewProblem title="This creation could not be resolved" detail={resolved.message} />
        ) : null}
        {/* 换示例时重新挂载，Session 设置（例如手动启用的 fragment）回到默认值。 */}
        {resolved?.ok ? <PreviewPanel key={sample?.id} ir={resolved.ir} /> : null}
      </div>
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
