import { estimateCounter } from "@char-pub/assembler";
import { diffContextIR } from "@char-pub/core";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useId, useMemo } from "react";
import { z } from "zod";
import { DiffView } from "@/components/diff-view";
import { MatureGate } from "@/components/mature-gate";
import { isAdultRating } from "@/components/rating";
import { keys, useMe, useRegistry } from "@/lib/registry";

const DiffSearchSchema = z.object({
  from: z.string().max(64).optional().catch(undefined),
  to: z.string().max(64).optional().catch(undefined),
});

export const Route = createFileRoute("/c/$ns/$name_/diff")({
  validateSearch: (s) => DiffSearchSchema.parse(s),
  component: DiffRoute,
});

const selectClass =
  "h-9 rounded-sm border border-input bg-card px-2 font-mono text-sm focus-visible:outline-2 focus-visible:outline-seal";

/**
 * 两个已发布版本之间的 Context Diff：比较两份 Context IR，列出 fragment、依赖锁定、评级与
 * 许可的变化，以及估算的 token 变化。计算在浏览器里完成。
 */
function DiffRoute() {
  const { ns, name } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/c/$ns/$name/diff" });
  const client = useRegistry();
  const me = useMe();
  const ids = { from: useId(), to: useId() };
  const detail = useQuery({
    queryKey: [...keys.creation(ns, name), me.data?.id ?? null],
    queryFn: () => client.creation(ns, name),
    enabled: !me.isPending,
  });
  const available = (detail.data?.releases ?? []).filter((r) => r.status !== "tombstoned");
  // 默认比较最新的两个版本：releases 按发布时间从新到旧排列。
  const to = search.to ?? available[0]?.label;
  const from = search.from ?? available.find((r) => r.label !== to)?.label;
  const relOf = (label: string | undefined) => available.find((r) => r.label === label);

  const irOf = (label: string | undefined) => ({
    queryKey: keys.ir(ns, name, label ?? ""),
    queryFn: () =>
      client.getIR(ns, name, label ?? "", { private: relOf(label)?.visibility === "private" }),
    enabled: !!relOf(label),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const fromIR = useQuery(irOf(from));
  const toIR = useQuery(irOf(to));

  const diff = useMemo(
    () =>
      fromIR.data && toIR.data
        ? diffContextIR(fromIR.data, toIR.data, {
            countTokens: estimateCounter.count,
            tokenizer: estimateCounter.tokenizer,
          })
        : null,
    [fromIR.data, toIR.data],
  );

  const back = (
    <Link
      to="/c/$ns/$name"
      params={{ ns, name }}
      className="text-sm text-muted-foreground underline underline-offset-4"
    >
      ← @{ns}/{name}
    </Link>
  );
  if (detail.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (available.length < 2) {
    return (
      <section className="space-y-3 py-10">
        {back}
        <h1 className="text-3xl">Nothing to compare yet</h1>
        <p className="text-muted-foreground">A diff needs at least two available versions.</p>
      </section>
    );
  }
  const adult = [relOf(from), relOf(to)].some((r) => r && isAdultRating(r.effective_rating));
  const worst = [relOf(from), relOf(to)].find((r) => r && isAdultRating(r.effective_rating));

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        {back}
        <h1 className="text-4xl">Compare versions</h1>
        <form aria-label="Versions to compare" className="flex flex-wrap items-end gap-3">
          {(
            [
              ["from", ids.from, from, "From"],
              ["to", ids.to, to, "To"],
            ] as const
          ).map(([key, id, value, text]) => (
            <div key={key} className="space-y-1">
              <label htmlFor={id} className="block text-sm">
                {text}
              </label>
              <select
                id={id}
                className={selectClass}
                value={value ?? ""}
                onChange={(e) =>
                  void navigate({ search: (prev) => ({ ...prev, [key]: e.target.value }) })
                }
              >
                {available.map((r) => (
                  <option key={r.label} value={r.label}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </form>
      </header>
      <MatureGate
        rating={worst?.effective_rating ?? "general"}
        allowed={!adult || (me.data?.settings.show_mature ?? false)}
      >
        {from === to ? (
          <p className="text-muted-foreground">Choose two different versions.</p>
        ) : diff ? (
          <DiffView diff={diff} />
        ) : fromIR.isError || toIR.isError ? (
          <p role="alert" className="text-sm text-seal">
            One of the versions could not be loaded.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Loading both versions…</p>
        )}
      </MatureGate>
    </div>
  );
}
