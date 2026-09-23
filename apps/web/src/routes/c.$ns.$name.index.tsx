import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CreationView } from "@/components/creation-view";
import { isApiError } from "@/lib/api";
import { keys, useMe, useRegistry } from "@/lib/registry";

export const Route = createFileRoute("/c/$ns/$name/")({
  component: CreationRoute,
});

function NotInCatalog() {
  return (
    <section className="space-y-3 py-16 text-center">
      <p className="stamp border-seal text-seal">404</p>
      <h1 className="text-3xl">This card is not in the catalog.</h1>
      <Link to="/browse" className="text-sm underline">
        Browse creations
      </Link>
    </section>
  );
}

function CreationRoute() {
  const { ns, name } = Route.useParams();
  const { v } = Route.useSearch();
  const navigate = useNavigate({ from: "/c/$ns/$name/" });
  const client = useRegistry();
  const me = useMe();

  const detail = useQuery({
    queryKey: [...keys.creation(ns, name), me.data?.id ?? null],
    queryFn: () => client.creation(ns, name),
    enabled: !me.isPending,
  });
  const d = detail.data;
  const label =
    v ??
    d?.latest_release?.label ??
    d?.releases.find((r) => r.status === "active")?.label ??
    d?.releases[0]?.label;
  const selected = d?.releases.find((r) => r.label === label);

  const release = useQuery({
    queryKey: keys.release(ns, name, label ?? ""),
    queryFn: () => client.release(ns, name, label ?? ""),
    enabled: !!d && !!label,
  });
  const tombstoned = isApiError(release.error, "release.tombstoned")
    ? { reason: String(release.error.extra.reason ?? "unspecified") }
    : selected?.status === "tombstoned"
      ? { reason: selected.status_reason ?? "unspecified" }
      : null;

  const ir = useQuery({
    queryKey: keys.ir(ns, name, label ?? ""),
    queryFn: () =>
      client.getIR(ns, name, label ?? "", { private: selected?.visibility === "private" }),
    enabled: !!d && !!label && !tombstoned,
    // 同一个 Release 的 IR 永远不变。
    staleTime: Number.POSITIVE_INFINITY,
  });
  const dependents = useQuery({
    queryKey: keys.dependents(ns, name),
    queryFn: () => client.dependents(ns, name),
    enabled: !!d,
  });

  if (detail.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (detail.isError) {
    if (isApiError(detail.error) && detail.error.status === 404) return <NotInCatalog />;
    return (
      <p role="alert" className="text-seal">
        This creation could not be loaded. Try again in a moment.
      </p>
    );
  }

  return (
    <CreationView
      ns={ns}
      name={name}
      detail={detail.data}
      label={label}
      onSelectLabel={(l) => void navigate({ search: { v: l } })}
      release={release.data}
      tombstoned={tombstoned}
      ir={ir.data}
      irState={ir.isError ? "error" : ir.data ? "ready" : label ? "loading" : "none"}
      dependents={dependents.data?.items}
      allowMature={me.data?.settings.show_mature ?? false}
      canEdit={!!me.data && me.data.namespace === ns}
    />
  );
}
