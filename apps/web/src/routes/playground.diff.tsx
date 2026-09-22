import { estimateCounter } from "@char-pub/assembler";
import { diffContextIR } from "@char-pub/core";
import { createFileRoute, Link } from "@tanstack/react-router";
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
    <div className="space-y-6">
      <header className="space-y-1">
        <Link
          to="/playground"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          ← Playground
        </Link>
        <h1 className="text-4xl">Context diff</h1>
        <p className="font-mono text-sm text-muted-foreground">
          {diffPair.from.title} <span className="text-seal">→</span> {diffPair.to.title}
        </p>
      </header>
      <DiffView diff={diff} />
    </div>
  );
}
