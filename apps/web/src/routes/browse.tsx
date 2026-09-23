import { OPEN_CREATION_TYPES } from "@char-pub/core";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { z } from "zod";
import { SearchResults } from "@/components/search-results";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { keys, useMe, useRegistry } from "@/lib/registry";

const BrowseSearchSchema = z.object({
  q: z.string().max(200).optional().catch(undefined),
  type: z.enum(OPEN_CREATION_TYPES).optional().catch(undefined),
  tag: z.string().max(64).optional().catch(undefined),
});
type BrowseSearch = z.infer<typeof BrowseSearchSchema>;

export const Route = createFileRoute("/browse")({
  validateSearch: (s) => BrowseSearchSchema.parse(s),
  component: Browse,
});

const selectClass =
  "h-9 rounded-sm border border-input bg-card px-2 text-sm focus-visible:outline-2 focus-visible:outline-seal";

function Browse() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/browse" });
  const client = useRegistry();
  const me = useMe();
  const [q, setQ] = useState(search.q ?? "");
  const ids = { q: useId(), type: useId() };
  useEffect(() => setQ(search.q ?? ""), [search.q]);

  const set = (patch: Partial<BrowseSearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }) });

  const results = useInfiniteQuery({
    queryKey: keys.search({ ...search, user: me.data?.id ?? null }),
    queryFn: ({ pageParam }) =>
      client.search({
        q: search.q?.trim() || undefined,
        type: search.type,
        tag: search.tag,
        cursor: pageParam,
        limit: 24,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: !me.isPending,
  });
  const items = results.data?.pages.flatMap((p) => p.items) ?? [];
  const showsMature = me.data?.settings.show_mature ?? false;

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-4xl">Browse</h1>
        <p className="max-w-2xl text-muted-foreground">
          Characters, worlds and lorebooks published on char.pub.{" "}
          {showsMature ? (
            "Mature and explicit creations are shown because you turned them on."
          ) : (
            <>
              Mature and explicit creations are hidden
              {me.data ? (
                <>
                  {" "}
                  — change this in{" "}
                  <Link to="/settings" className="underline">
                    settings
                  </Link>
                </>
              ) : null}
              .
            </>
          )}
        </p>
      </header>

      <form
        aria-label="Search the registry"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void set({ q: q.trim() || undefined });
        }}
      >
        <div className="min-w-64 flex-1 space-y-1">
          <label htmlFor={ids.q} className="text-sm">
            Search
          </label>
          <Input
            id={ids.q}
            type="search"
            value={q}
            maxLength={200}
            placeholder="Name, summary, tag or @namespace"
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.type} className="block text-sm">
            Type
          </label>
          <select
            id={ids.type}
            className={selectClass}
            value={search.type ?? ""}
            onChange={(e) =>
              void set({ type: (e.target.value || undefined) as BrowseSearch["type"] })
            }
          >
            <option value="">All types</option>
            {OPEN_CREATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit">
          <Search aria-hidden /> Search
        </Button>
      </form>

      {search.tag ? (
        <p className="text-sm">
          Tagged <span className="stamp border-rule">#{search.tag}</span>{" "}
          <button type="button" className="underline" onClick={() => void set({ tag: undefined })}>
            clear
          </button>
        </p>
      ) : null}

      {results.isPending ? (
        <p className="text-muted-foreground">Searching…</p>
      ) : results.isError ? (
        <p role="alert" className="text-seal">
          Search is unavailable right now. Try again in a moment.
        </p>
      ) : (
        <SearchResults items={items} />
      )}

      {results.hasNextPage ? (
        <div className="text-center">
          <Button
            variant="outline"
            disabled={results.isFetchingNextPage}
            onClick={() => void results.fetchNextPage()}
          >
            {results.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
