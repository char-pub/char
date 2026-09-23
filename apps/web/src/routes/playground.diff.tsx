import { estimateCounter } from "@char-pub/assembler";
import { diffContextIR } from "@char-pub/core";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useMemo } from "react";
import { DiffView } from "@/components/diff-view";
import { diffPair, locksOf, resolveSample } from "@/fixtures/samples";

export const Route = createFileRoute("/playground/diff")({ component: DiffPage });

function DiffPage() {
  const diff = useMemo(
    () =>
      diffContextIR(resolveSample(diffPair.from).ir, resolveSample(diffPair.to).ir, {
        locks: { from: locksOf(diffPair.from), to: locksOf(diffPair.to) },
        countTokens: estimateCounter.count,
        tokenizer: estimateCounter.tokenizer,
      }),
    [],
  );
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <Link
          to="/playground"
          className="inline-flex items-center gap-1.5 text-sm text-text-2 underline-offset-4 hover:text-text hover:underline"
        >
          <ArrowLeft aria-hidden className="size-3.5" /> Playground
        </Link>
        <h1 className="text-4xl">Context diff</h1>
        <p className="flex flex-wrap items-center gap-2 font-mono text-sm text-text-2">
          <span>{diffPair.from.title}</span>
          <ArrowRight aria-hidden className="size-3.5 text-text-3" />
          <span className="sr-only">to</span>
          <span>{diffPair.to.title}</span>
        </p>
      </header>
      <DiffView diff={diff} />
    </div>
  );
}
