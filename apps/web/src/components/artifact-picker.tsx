import type { CreationType } from "@char-pub/core";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { Me } from "@/lib/api";
import { type ArtifactChoice, artifactChoice } from "@/lib/artifact-choice";
import { keys, useMe, useRegistry } from "@/lib/registry";
import { localized, parseRef } from "@/lib/text";
import { QuickCharacter } from "./quick-character";

export type { ArtifactChoice } from "@/lib/artifact-choice";

/** A selection always resolves a particular release; recommendations never silently select latest. */
export function ArtifactPicker(props: ComponentProps<typeof ScopedArtifactPicker>) {
  const me = useMe();
  if (me.isPending) return <p role="status">Loading choices…</p>;
  if (me.isError && me.data === undefined)
    return (
      <div role="alert">
        <p>Could not check your account. Your current selection has not changed.</p>
        <Button type="button" variant="outline" onClick={() => void me.refetch()}>
          Retry choices
        </Button>
      </div>
    );
  return <ScopedArtifactPicker key={me.data?.id ?? "anonymous"} {...props} />;
}
function ScopedArtifactPicker({
  label,
  types,
  onPick,
}: {
  label: string;
  types?: readonly CreationType[];
  onPick: (choice: ArtifactChoice) => void;
}) {
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const client = useRegistry();
  const qc = useQueryClient();
  const me = useMe();
  const actor = me.data?.id ?? null;
  const generation = useRef(0);
  const [mode, setMode] = useState<"search" | "mine" | "favorites" | "new">("search");
  const [text, setText] = useState("");
  const [ref, setRef] = useState("");
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingFavorite, setSavingFavorite] = useState(false);
  const favoritePending = useRef(false);
  const current = () =>
    active.current && (qc.getQueryData<Me | null>(keys.me)?.id ?? null) === actor;
  const matches = (type: CreationType) => !types || types.includes(type);
  const select = (next: string) => {
    generation.current++;
    setBusy(false);
    setRef(next);
    setText(next);
    setVersion("");
    setError(null);
    setNotice(null);
  };
  const target = parseRef(ref);
  const detail = useQuery({
    queryKey: ["asset-choice", me.data?.id ?? null, ref],
    queryFn: () => client.creation(target?.ns ?? "", target?.name ?? ""),
    enabled: !!target && !me.isPending,
  });
  const search = useQuery({
    queryKey: ["asset-search", me.data?.id ?? null, text, types],
    queryFn: () => client.search({ q: text, limit: 8 }),
    enabled: mode === "search" && text.trim().length >= 2 && !text.startsWith("@") && !me.isPending,
  });
  const mine = useQuery({
    queryKey: [...keys.myCreations, actor],
    queryFn: () => client.myCreations(),
    enabled: mode === "mine" && !!actor,
  });
  const favoriteKey = ["favorites", actor] as const;
  const favorites = useInfiniteQuery({
    queryKey: favoriteKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      client.favorites({ ...(pageParam ? { cursor: pageParam } : {}), limit: 50 }),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: mode === "favorites" && !!actor,
  });
  const favorite = async (value: string, saved: boolean) => {
    const location = parseRef(value);
    if (!current() || !actor || !location || favoritePending.current) return;
    favoritePending.current = true;
    setSavingFavorite(true);
    setError(null);
    setNotice(null);
    try {
      await client.setFavorite(location.ns, location.name, saved);
      if (!current()) return;
      setNotice(`${value} ${saved ? "saved to" : "removed from"} Favorites.`);
      await qc.invalidateQueries({ queryKey: favoriteKey });
    } catch {
      if (current())
        setError("Could not update Favorites. Try again; the selected version has not changed.");
    } finally {
      favoritePending.current = false;
      if (current()) setSavingFavorite(false);
    }
  };
  const releases = detail.data?.releases.filter((r) => r.status === "active") ?? [];
  const validType = !types || (detail.data && types.includes(detail.data.type));
  const load = async () => {
    const selected = releases.find((r) => r.id === version);
    if (!current() || !target || !selected || !validType || busy) return;
    const attempt = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const artifact = await client.getArtifact(target.ns, target.name, selected.label, {
        private: selected.visibility === "private",
      });
      if (!current() || generation.current !== attempt) return;
      onPick(artifactChoice(artifact, selected));
    } catch (e) {
      if (current() && generation.current === attempt)
        setError(e instanceof Error ? e.message : "Could not load this release");
    } finally {
      if (current() && generation.current === attempt) setBusy(false);
    }
  };
  return (
    <fieldset className="space-y-2 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <fieldset aria-label={`${label} sources`} className="flex flex-wrap gap-2">
        {(
          [
            ["search", "Search"],
            ["mine", "My creations"],
            ["favorites", "Favorites"],
          ] as const
        ).map(([value, title]) => (
          <Button
            key={value}
            type="button"
            aria-pressed={mode === value}
            variant={mode === value ? "default" : "outline"}
            onClick={() => {
              generation.current++;
              setBusy(false);
              setMode(value);
              setError(null);
            }}
          >
            {title}
          </Button>
        ))}
        {types?.includes("character") ? (
          <Button
            type="button"
            variant="outline"
            aria-pressed={mode === "new"}
            onClick={() => {
              generation.current++;
              setBusy(false);
              setMode("new");
            }}
          >
            Create a character here
          </Button>
        ) : null}
      </fieldset>
      <div hidden={mode !== "search"}>
        <div className="flex gap-2">
          <Input
            aria-label={`${label} address`}
            value={text}
            placeholder="Search or @namespace/name"
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={!parseRef(text)}
            onClick={() => {
              select(text);
            }}
          >
            Look up
          </Button>
        </div>
        {search.data?.items
          .filter((item) => !types || types.includes(item.type))
          .map((item) => (
            <Button
              key={item.id}
              type="button"
              variant="ghost"
              onClick={() => {
                select(item.ref);
              }}
            >
              {localized(item.display_name)} · {item.ref}
            </Button>
          ))}
      </div>
      {mode === "mine" ? (
        !actor ? (
          <p>Sign in to see your creations.</p>
        ) : mine.isPending ? (
          <p role="status">Loading your creations…</p>
        ) : mine.isError ? (
          <Button type="button" variant="outline" onClick={() => void mine.refetch()}>
            Retry your creations
          </Button>
        ) : (
          <ul className="space-y-2">
            {mine.data?.items
              .filter((item) => matches(item.type) && parseRef(item.ref)?.ns === me.data?.namespace)
              .map((item) => {
                const location = parseRef(item.ref);
                const available =
                  item.status === "active" &&
                  !!item.latest_release &&
                  item.latest_release.status !== "tombstoned";
                return (
                  <li key={item.ref}>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={!available}
                      onClick={() => select(item.ref)}
                    >
                      {localized(item.display_name)} · {item.ref}
                    </Button>
                    {!available ? (
                      <p className="text-xs text-text-2">
                        No published version can be selected.{" "}
                        {location ? (
                          <Link
                            to="/c/$ns/$name/edit"
                            params={location}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                          >
                            Edit and publish this draft
                          </Link>
                        ) : null}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            {!mine.data?.items.some(
              (item) => matches(item.type) && parseRef(item.ref)?.ns === me.data?.namespace,
            ) ? (
              <li>No matching creations yet.</li>
            ) : null}
          </ul>
        )
      ) : null}
      {mode === "favorites" ? (
        !actor ? (
          <p>Sign in to see your favorites.</p>
        ) : favorites.isPending ? (
          <p role="status">Loading favorites…</p>
        ) : favorites.isError ? (
          <Button type="button" variant="outline" onClick={() => void favorites.refetch()}>
            Retry favorites
          </Button>
        ) : (
          <div className="space-y-2">
            <ul className="space-y-2">
              {favorites.data?.pages
                .flatMap((page) => page.items)
                .filter((item) => matches(item.type))
                .map((item) => (
                  <li key={item.id} className="flex flex-wrap gap-2">
                    <Button type="button" variant="ghost" onClick={() => select(item.ref)}>
                      {localized(item.display_name)} · {item.ref}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={savingFavorite}
                      aria-label={`Remove ${item.ref} from favorites`}
                      onClick={() => void favorite(item.ref, false)}
                    >
                      Remove favorite
                    </Button>
                  </li>
                ))}
            </ul>
            {!favorites.data?.pages.some((page) =>
              page.items.some((item) => matches(item.type)),
            ) ? (
              <p>No matching favorites on these pages. Save a creation from its version picker.</p>
            ) : null}
            {favorites.hasNextPage ? (
              <Button
                type="button"
                variant="outline"
                disabled={favorites.isFetchingNextPage}
                onClick={() => void favorites.fetchNextPage()}
              >
                Load more favorites
              </Button>
            ) : null}
          </div>
        )
      ) : null}
      {types?.includes("character") ? (
        <div hidden={mode !== "new"}>
          <QuickCharacter onPick={onPick} visible={mode === "new"} />
        </div>
      ) : null}
      {detail.data && mode !== "new" ? (
        <>
          <p className="text-xs font-mono">{detail.data.ref}</p>
          {!validType ? (
            <p role="alert">Choose {types?.join(" or ")}.</p>
          ) : (
            <div className="flex gap-2">
              <NativeSelect
                aria-label={`${label} version`}
                value={version}
                onChange={(e) => {
                  generation.current++;
                  setBusy(false);
                  setVersion(e.target.value);
                }}
              >
                <option value="">Choose an exact version</option>
                {releases.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label} · {r.visibility}
                  </option>
                ))}
              </NativeSelect>
              <Button type="button" disabled={!version || busy} onClick={() => void load()}>
                {busy ? "Loading…" : "Use version"}
              </Button>
            </div>
          )}
        </>
      ) : null}
      {detail.data && validType && mode !== "new" && actor ? (
        <Button
          type="button"
          variant="ghost"
          disabled={savingFavorite}
          onClick={() => void favorite(detail.data.ref, true)}
        >
          Save to favorites
        </Button>
      ) : null}
      {detail.data && validType && !releases.length && mode !== "new" ? (
        <p>No active published version is available. A draft cannot be selected.</p>
      ) : null}
      {detail.isError || (mode === "search" && search.isError) || error ? (
        <p role="alert" className="text-sm text-danger">
          {error ?? "Could not find this creation. Check its address and your access."}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
    </fieldset>
  );
}
