import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { MatureGate } from "@/components/mature-gate";
import { PreviewPanel } from "@/components/preview-panel";
import { isApiError } from "@/lib/api";
import { keys, useMe, useRegistry } from "@/lib/registry";

const PreviewSearchSchema = z.object({
  /** 预览的版本；缺省为最新的 public Release。 */
  v: z.string().max(64).optional().catch(undefined),
});

export const Route = createFileRoute("/c/$ns/$name/preview")({
  validateSearch: (s) => PreviewSearchSchema.parse(s),
  component: PreviewRoute,
});

/**
 * 已发布作品的 Context Preview：取这个 Release 的 Context IR（与下载的是同一份），在浏览器
 * 里用参考 Assembler 组装，逐条说明每个 fragment 为什么进入上下文、来自哪条依赖、被谁覆盖。
 */
function PreviewRoute() {
  const { ns, name } = Route.useParams();
  const { v } = Route.useSearch();
  const client = useRegistry();
  const me = useMe();
  const detail = useQuery({
    queryKey: [...keys.creation(ns, name), me.data?.id ?? null],
    queryFn: () => client.creation(ns, name),
    enabled: !me.isPending,
  });
  const d = detail.data;
  const label =
    v ?? d?.latest_release?.label ?? d?.releases.find((r) => r.status === "active")?.label;
  const selected = d?.releases.find((r) => r.label === label);
  const ir = useQuery({
    queryKey: keys.ir(ns, name, label ?? ""),
    queryFn: () =>
      client.getIR(ns, name, label ?? "", { private: selected?.visibility === "private" }),
    enabled: !!selected && selected.status !== "tombstoned",
    staleTime: Number.POSITIVE_INFINITY,
  });

  const back = (
    <Link
      to="/c/$ns/$name"
      params={{ ns, name }}
      search={label ? { v: label } : {}}
      className="text-sm text-muted-foreground underline underline-offset-4"
    >
      ← @{ns}/{name}
    </Link>
  );

  if (detail.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (detail.isError || !d) {
    return (
      <section className="space-y-3 py-10">
        {back}
        <h1 className="text-3xl">
          {isApiError(detail.error) && detail.error.status === 404
            ? "This creation is not in the catalog."
            : "This creation could not be loaded."}
        </h1>
      </section>
    );
  }
  if (!selected) {
    return (
      <section className="space-y-3 py-10">
        {back}
        <h1 className="text-3xl">Nothing to preview yet</h1>
        <p className="text-muted-foreground">
          Publish a release first; the preview uses its context.
        </p>
      </section>
    );
  }
  if (selected.status === "tombstoned") {
    return (
      <section className="space-y-3 py-10">
        {back}
        <h1 className="text-3xl">This version is no longer available</h1>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        {back}
        <h1 className="text-4xl">Preview {label}</h1>
        <p className="max-w-2xl text-muted-foreground">
          The context a runtime would send to the model for this release, assembled in your browser.
          Change the session to see which fragments are kept or dropped, and why.
        </p>
      </header>
      <MatureGate
        rating={selected.effective_rating}
        allowed={me.data?.settings.show_mature ?? false}
      >
        {ir.data ? (
          <PreviewPanel ir={ir.data} />
        ) : ir.isError ? (
          <p role="alert" className="text-sm text-seal">
            The context for this release could not be loaded.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Loading the context…</p>
        )}
      </MatureGate>
    </div>
  );
}
