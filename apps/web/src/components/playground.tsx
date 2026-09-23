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
    <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
      <section aria-labelledby="pg-sources" className="space-y-3">
        <h2 id="pg-sources" className="text-xs font-semibold tracking-wider text-text-3 uppercase">
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
                  "block cursor-pointer rounded-lg border p-3 transition-colors has-[:focus-visible]:border-ring has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/30",
                  active
                    ? "border-primary bg-primary-soft"
                    : "bg-surface hover:border-border-strong hover:bg-surface-2",
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
                <span className="block text-sm leading-snug font-semibold">{s.title}</span>
                <span className="mt-1 block text-xs text-text-2">{s.description}</span>
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
    <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-3 gap-y-1.5 rounded-lg border bg-surface p-3 text-xs">
      <dt className="text-text-2">Root</dt>
      <dd className="truncate font-mono" title={ir.root.ref}>
        {ir.root.ref}
      </dd>
      <dt className="text-text-2">Rating</dt>
      <dd>
        <RatingBadge rating={ir.meta.rating} />
      </dd>
      <dt className="text-text-2">Fragments</dt>
      <dd className="font-mono">{ir.fragments.length}</dd>
      <dt className="text-text-2">Dependencies</dt>
      <dd className="font-mono">{Math.max(ir.graph.nodes.length - 1, 0)}</dd>
      <dt className="text-text-2">Lock</dt>
      <dd className="truncate font-mono" title={ir.lock_digest}>
        {ir.lock_digest.slice(0, 19)}…
      </dd>
    </dl>
  );
}
