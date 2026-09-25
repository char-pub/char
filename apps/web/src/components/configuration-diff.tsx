import { useQuery } from "@tanstack/react-query";
import { useRegistry } from "@/lib/registry";
import { useCreation } from "./creation-context";
import { MatureGate } from "./mature-gate";
import { highestRating } from "./rating";

/** Author configuration is not part of content IR; compare the exact release sources as well. */
export function ConfigurationDiff({
  from,
  to,
}: {
  from: string | undefined;
  to: string | undefined;
}) {
  const c = useCreation();
  const client = useRegistry();
  const source = (label: string | undefined) => ({
    queryKey: ["configuration-source", c.me?.id ?? null, c.ns, c.name, label],
    queryFn: () => client.releaseSource(c.ns, c.name, label ?? ""),
    enabled: !!label && from !== to,
  });
  const a = useQuery(source(from));
  const b = useQuery(source(to));
  if (!from || !to || from === to) return null;
  if (a.isError || b.isError)
    return <p role="alert">Could not load author configuration for these versions.</p>;
  if (!a.data || !b.data) return <p role="status">Loading author configuration…</p>;
  const before = a.data.creation as Record<string, unknown>;
  const after = b.data.creation as Record<string, unknown>;
  const changed = (["assembly", "assembly_tests"] as const).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
  return (
    <MatureGate
      identity={c.me?.id}
      key={String(c.me?.id) + from + to}
      rating={highestRating(
        ...c.detail.releases
          .filter((r) => r.label === from || r.label === to)
          .map((r) => r.effective_rating),
      )}
      allowed={c.allowMature}
      signedIn={!!c.me}
    >
      <section className="space-y-3">
        <h3 className="font-semibold">Author configuration</h3>
        {!changed.length ? (
          <p className="text-sm">Locked assembly and author tests are unchanged.</p>
        ) : (
          changed.map((key) => (
            <section key={key} className="space-y-2 rounded border p-3">
              <h4 className="font-medium">
                {key === "assembly" ? "Locked assembly changed" : "Author tests changed"}
              </h4>
              <div className="grid gap-3 sm:grid-cols-2">
                {[before, after].map((value, i) => (
                  <div key={i}>
                    <p className="text-xs font-semibold">{i === 0 ? from : to}</p>
                    <pre className="overflow-auto whitespace-pre-wrap break-all text-xs">
                      {value[key] === undefined
                        ? "Not configured"
                        : JSON.stringify(value[key], null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </section>
    </MatureGate>
  );
}
