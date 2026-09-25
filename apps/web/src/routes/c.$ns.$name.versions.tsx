import { estimateCounter } from "@char-pub/assembler";
import { type ContextIR, diffContextIR, type LockLabel } from "@char-pub/core";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useId, useMemo, useState } from "react";
import { z } from "zod";
import { ConfigurationDiff } from "@/components/configuration-diff";
import { irQuery, useCreation, useReleaseLabels } from "@/components/creation-context";
import { matureReason } from "@/components/creation-facts";
import { DiffView, TokenDelta } from "@/components/diff-view";
import { MatureGate } from "@/components/mature-gate";
import { PolicyVersions } from "@/components/policy-artifact";
import { isAdultRating } from "@/components/rating";
import { type CompareSide, VersionList } from "@/components/release-list";
import { EmptyState, ErrorState } from "@/components/states";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { YankDialog } from "@/components/yank-dialog";
import { useRegistry } from "@/lib/registry";

const VersionsSearchSchema = z.object({
  from: z.string().max(64).optional().catch(undefined),
  to: z.string().max(64).optional().catch(undefined),
});

export const Route = createFileRoute("/c/$ns/$name/versions")({
  validateSearch: (s) => VersionsSearchSchema.parse(s),
  component: VersionsTab,
});

/** 依赖闭包里每个依赖锁定的 Release，能查到版本号的带上版本号（Diff 里显示用）。 */
function locksOf(ir: ContextIR, labels: ReadonlyMap<string, string>): LockLabel[] {
  return ir.graph.nodes
    .filter((n) => n.ref !== ir.root.ref)
    .map((n) => {
      const label = labels.get(n.release);
      return label ? { ref: n.ref, release: n.release, label } : { ref: n.ref, release: n.release };
    });
}

function refsOf(...irs: (ContextIR | undefined)[]): string[] {
  const refs = new Set<string>();
  for (const ir of irs) {
    for (const n of ir?.graph.nodes ?? []) if (n.ref !== ir?.root.ref) refs.add(n.ref);
  }
  return [...refs].sort();
}

/**
 * Versions：左边是版本列表（最新、yanked 的理由、removed 的原因代码、可见性），右边比较两个
 * 版本的 Context IR。对比在浏览器里计算，默认比较最新的两个可用版本；评级和许可的变化放在最上面。
 */
function VersionsTab() {
  const c = useCreation();
  return c.detail.type === "preset" || c.detail.type === "prompt-module" ? (
    <PolicyVersions />
  ) : (
    <ContentVersionsTab />
  );
}

function ContentVersionsTab() {
  const c = useCreation();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/c/$ns/$name/versions" });
  const client = useRegistry();
  const ids = { from: useId(), to: useId() };
  const [yank, setYank] = useState<string | null>(null);

  const releases = c.detail.releases;
  const available = releases.filter((r) => r.status !== "tombstoned");
  // 默认比较最新的两个版本：releases 按发布时间从新到旧排列。
  const to = search.to ?? available[0]?.label;
  const from = search.from ?? available.find((r) => r.label !== to)?.label;
  const relOf = (label: string | undefined) => available.find((r) => r.label === label);
  const fromIR = useQuery(irQuery(client, c.ns, c.name, relOf(from), c.me?.id ?? null));
  const toIR = useQuery(irQuery(client, c.ns, c.name, relOf(to), c.me?.id ?? null));
  const labels = useReleaseLabels(refsOf(fromIR.data, toIR.data));
  const labelsKey = [...labels].join();

  // labels 每次渲染都是新对象，按内容（labelsKey）判断是否需要重新计算。
  const diff = useMemo(
    () =>
      fromIR.data && toIR.data
        ? diffContextIR(fromIR.data, toIR.data, {
            locks: { from: locksOf(fromIR.data, labels), to: locksOf(toIR.data, labels) },
            countTokens: estimateCounter.count,
            tokenizer: estimateCounter.tokenizer,
          })
        : null,
    [fromIR.data, toIR.data, labelsKey],
  );

  const choose = (side: CompareSide, label: string) =>
    void navigate({ search: (prev) => ({ ...prev, [side]: label }) });
  const worst = [relOf(from), relOf(to)].find((r) => r && isAdultRating(r.effective_rating));
  // 遮挡卡片说明评级来源：用成人评级那一边的 IR。
  const adultIR = [toIR.data, fromIR.data].find((ir) => ir && isAdultRating(ir.meta.rating));

  let body: ReactNode;
  if (available.length < 2) {
    body = (
      <EmptyState
        title="Nothing to compare yet"
        description="A comparison needs at least two versions that are still available."
      />
    );
  } else if (!relOf(from) || !relOf(to)) {
    body = (
      <EmptyState
        title="Pick two versions"
        description="One of the versions in the address doesn't exist or was removed."
      />
    );
  } else if (from === to) {
    body = <EmptyState title="Choose two different versions." />;
  } else if (fromIR.isError || toIR.isError) {
    body = (
      <ErrorState
        title="One of the versions could not be loaded"
        onRetry={() => {
          void fromIR.refetch();
          void toIR.refetch();
        }}
      />
    );
  } else if (!diff) {
    body = (
      <div role="status" aria-label="Loading both versions" className="space-y-3">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  } else {
    body = (
      <MatureGate
        rating={worst?.effective_rating ?? "general"}
        allowed={c.allowMature}
        remember={c.detail.ref}
        reason={adultIR ? matureReason(adultIR) : undefined}
        signedIn={!!c.me}
      >
        <DiffView diff={diff} from={fromIR.data} to={toIR.data} showTokens={false} />
      </MatureGate>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <div className="min-w-0">
        <VersionList
          ns={c.ns}
          name={c.name}
          releases={releases}
          latest={c.detail.latest_release?.label}
          from={from}
          to={to}
          onCompare={choose}
          canYank={c.isOwner}
          onYank={setYank}
        />
      </div>
      <section aria-labelledby="compare-title" className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <h2 id="compare-title" className="pb-1.5 text-xl font-bold">
              Compare versions
            </h2>
            {available.length >= 2 ? (
              <form
                aria-label="Versions to compare"
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => e.preventDefault()}
              >
                {(
                  [
                    ["from", ids.from, from, "From", "A"],
                    ["to", ids.to, to, "To", "B"],
                  ] as const
                ).map(([side, id, value, text, mark]) => (
                  <div key={side} className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="flex size-4 items-center justify-center rounded-full bg-ink text-[0.6rem] font-bold text-on-ink"
                      >
                        {mark}
                      </span>
                      <Label htmlFor={id} className="text-xs text-text-2">
                        {text}
                      </Label>
                    </div>
                    <NativeSelect
                      id={id}
                      size="sm"
                      className="w-36 font-mono"
                      value={value ?? ""}
                      onChange={(e) => choose(side, e.target.value)}
                    >
                      {available.map((r) => (
                        <option key={r.label} value={r.label}>
                          {r.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                ))}
              </form>
            ) : null}
          </div>
          {diff?.token_delta && from !== to ? <TokenDelta delta={diff.token_delta} /> : null}
        </div>
        {body}
        {c.detail.type === "scenario" ? <ConfigurationDiff from={from} to={to} /> : null}
      </section>
      {yank ? (
        <YankDialog
          ns={c.ns}
          name={c.name}
          label={yank}
          open
          onOpenChange={(open) => {
            if (!open) setYank(null);
          }}
        />
      ) : null}
    </div>
  );
}
