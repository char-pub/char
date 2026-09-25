/**
 * 添加依赖：按名字或 @namespace 搜索已发布的作品 → 选中 → 选版本（这个作品的 Release）→
 * 选 Core / Recommended → 写一个关系词（lives_in、knows_about……）。
 *
 * 搜索框里直接输入完整的 `@ns/name` 也可以，作为搜不到时的兜底（例如刚发布、索引还没更新）。
 * 选定的依赖锁定到一个精确的 Release（Release ID + semantic digest），上游之后的更新不会悄悄
 * 改变它。
 */
import type { CreationSummary } from "@char-pub/contracts";
import type { CreationType, ReferenceEdge } from "@char-pub/core";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Search, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { TYPE_STYLE } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { isApiError } from "@/lib/api";
import { keys, useRegistry } from "@/lib/registry";
import { localized, parseRef } from "@/lib/text";
import { cn } from "@/lib/utils";

export const MODE_LABEL: Record<ReferenceEdge["mode"], string> = {
  intrinsic: "Core",
  default: "Recommended",
};

export const MODE_HINT: Record<ReferenceEdge["mode"], string> = {
  intrinsic: "Core — part of what it is",
  default: "Recommended — others can swap it",
};

/** 按依赖的类型给一个默认的关系词；其他类型用 uses。 */
const DEFAULT_REL: Partial<Record<CreationType, string>> = {
  character: "knows",
  world: "lives_in",
  lorebook: "knows_about",
};

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function TypeDot({ type }: { type: CreationType | undefined }) {
  return (
    <span
      aria-hidden
      className={cn("size-2.5 shrink-0 rounded-full", type ? TYPE_STYLE[type].dot : "bg-text-3")}
    />
  );
}

/** 把搜索框的输入变成搜索参数：`@ns` 只搜这个 namespace，其余按关键词搜。 */
function searchParams(q: string): { q?: string; ns?: string } | null {
  const t = q.trim();
  if (t === "") return null;
  if (t.startsWith("@")) {
    const [ns, name] = t.slice(1).split("/");
    if (!ns) return null;
    return name ? { q: name, ns } : { ns };
  }
  return { q: t };
}

interface Picked {
  ns: string;
  name: string;
}

export function DependencyPicker({
  self,
  taken,
  onAdd,
}: {
  /** 自己的 ref，不能依赖自己。 */
  self: string;
  /** 已经添加的依赖。 */
  taken: readonly string[];
  onAdd: (edge: Omit<ReferenceEdge, "id">, base: string) => void;
}) {
  const client = useRegistry();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Picked | null>(null);
  const ids = { search: useId(), results: useId() };
  const debounced = useDebounced(query, 300);
  const params = searchParams(debounced);
  const results = useQuery({
    queryKey: keys.search({ ...params, limit: 8, for: "dependency" }),
    queryFn: () => client.search({ ...params, limit: 8 }),
    enabled: !!params && !picked,
    retry: false,
    staleTime: 30_000,
  });
  const direct = parseRef(query.trim());
  const items = (results.data?.items ?? []).filter(
    (c) =>
      c.ref !== self && !taken.includes(c.ref) && c.type !== "preset" && c.type !== "prompt-module",
  );
  const showDirect =
    !!direct &&
    `@${direct.ns}/${direct.name}` !== self &&
    !items.some((c) => c.ref === `@${direct.ns}/${direct.name}`);

  if (picked) {
    return (
      <DependencyConfig
        picked={picked}
        onCancel={() => setPicked(null)}
        onAdd={(edge, base) => {
          onAdd(edge, base);
          setPicked(null);
          setQuery("");
        }}
      />
    );
  }

  return (
    <div className="space-y-2">
      <label htmlFor={ids.search} className="sr-only">
        Add a dependency
      </label>
      <div className="relative">
        <Plus
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-3"
        />
        <Input
          id={ids.search}
          type="search"
          value={query}
          autoComplete="off"
          aria-controls={ids.results}
          placeholder="Add a world, lorebook or character — search by name or @namespace"
          className="h-10 pl-9"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {params ? (
        <div id={ids.results} aria-live="polite" className="rounded-lg border bg-surface">
          {results.isFetching && items.length === 0 ? (
            <p className="flex items-center gap-2 px-3 py-2.5 text-sm text-text-2">
              <Loader2 aria-hidden className="size-4 animate-spin" /> Searching…
            </p>
          ) : null}
          {results.isError ? (
            <p className="px-3 py-2.5 text-sm text-danger">
              Search didn't work right now. Type the full @namespace/name instead.
            </p>
          ) : null}
          <ul aria-label="Search results" className="divide-y">
            {items.map((c) => (
              <li key={c.id}>
                <ResultButton
                  item={c}
                  onPick={() => {
                    const r = parseRef(c.ref);
                    if (r) setPicked(r);
                  }}
                />
              </li>
            ))}
            {showDirect && direct ? (
              <li>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
                  onClick={() => setPicked(direct)}
                >
                  <Search aria-hidden className="size-4 text-text-3" />
                  <span>
                    Use{" "}
                    <span className="font-mono">
                      @{direct.ns}/{direct.name}
                    </span>
                  </span>
                </button>
              </li>
            ) : null}
          </ul>
          {!results.isFetching && results.isSuccess && items.length === 0 && !showDirect ? (
            <p className="px-3 py-2.5 text-sm text-text-2">
              Nothing found. Try another name, or type the full @namespace/name.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ResultButton({ item, onPick }: { item: CreationSummary; onPick: () => void }) {
  const title = localized(item.display_name);
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
      onClick={onPick}
    >
      <TypeDot type={item.type} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate font-mono text-xs text-text-3">
          {item.ref}
          {item.latest_release ? `@${item.latest_release.label}` : ""}
        </span>
      </span>
      <span className="shrink-0 text-xs text-text-2">{TYPE_STYLE[item.type].label}</span>
    </button>
  );
}

/** 依赖作品的详情（类型、Release 列表）。依赖行和添加面板共用同一份缓存。 */
export function useDependencyDetail(ref: { ns: string; name: string } | null) {
  const client = useRegistry();
  return useQuery({
    queryKey: keys.creation(ref?.ns ?? "", ref?.name ?? ""),
    queryFn: () => client.creation(ref?.ns ?? "", ref?.name ?? ""),
    enabled: !!ref,
    retry: false,
    staleTime: 60_000,
  });
}

export function lookupError(e: unknown): string {
  if (isApiError(e) && e.status === 404) return "No such creation, or it isn't public.";
  if (isApiError(e) && e.status === 410) return "That creation was removed.";
  return "Couldn't look it up. Try again.";
}

const REL_RE = /^[a-z][a-z0-9_]{0,31}$/;

function DependencyConfig({
  picked,
  onCancel,
  onAdd,
}: {
  picked: Picked;
  onCancel: () => void;
  onAdd: (edge: Omit<ReferenceEdge, "id">, base: string) => void;
}) {
  const detail = useDependencyDetail(picked);
  const ids = { version: useId(), mode: useId(), rel: useId(), relHelp: useId() };
  const [version, setVersion] = useState("");
  const [mode, setMode] = useState<ReferenceEdge["mode"]>("default");
  const [rel, setRel] = useState<string | null>(null);
  const ref = `@${picked.ns}/${picked.name}`;
  const d = detail.data;
  const releases = (d?.releases ?? []).filter((r) => r.status === "active");
  const latest = releases.find((r) => r.id === d?.latest_release?.id) ?? releases[0];
  const chosen = releases.find((r) => r.id === version) ?? latest;
  const relValue = rel ?? (d ? (DEFAULT_REL[d.type] ?? "uses") : "");
  const relOk = relValue === "" || REL_RE.test(relValue);

  return (
    <fieldset className="space-y-4 rounded-lg border bg-surface p-4">
      <legend className="sr-only">Add {ref}</legend>
      <div className="flex items-center gap-3">
        <TypeDot type={d?.type} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{d ? localized(d.display_name) : ref}</p>
          <p className="truncate font-mono text-xs text-text-3">{ref}</p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Cancel" onClick={onCancel}>
          <X aria-hidden />
        </Button>
      </div>

      {detail.isPending ? (
        <p className="flex items-center gap-2 text-sm text-text-2">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Looking it up…
        </p>
      ) : detail.isError ? (
        <p role="alert" className="text-sm text-danger">
          {lookupError(detail.error)}
        </p>
      ) : d?.type === "preset" || d?.type === "prompt-module" ? (
        <p role="alert" className="text-sm text-danger">
          Policy creations cannot be content dependencies. Use the policy or preset controls
          instead.
        </p>
      ) : !chosen ? (
        <p role="alert" className="text-sm text-danger">
          It has no release to depend on yet.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <label htmlFor={ids.version} className="text-xs font-medium">
                Version
              </label>
              <NativeSelect
                id={ids.version}
                className="font-mono"
                value={chosen.id}
                onChange={(e) => setVersion(e.target.value)}
              >
                {releases.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                    {r.id === latest?.id ? " (latest)" : ""}
                    {r.visibility === "private" ? " (private)" : ""}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <label htmlFor={ids.mode} className="text-xs font-medium">
                How it's used
              </label>
              <NativeSelect
                id={ids.mode}
                value={mode}
                onChange={(e) => setMode(e.target.value as ReferenceEdge["mode"])}
              >
                <option value="intrinsic">{MODE_HINT.intrinsic}</option>
                <option value="default">{MODE_HINT.default}</option>
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <label htmlFor={ids.rel} className="text-xs font-medium">
                Relationship
              </label>
              <Input
                id={ids.rel}
                className="font-mono"
                value={relValue}
                maxLength={32}
                aria-invalid={!relOk}
                aria-describedby={ids.relHelp}
                onChange={(e) => setRel(e.target.value.toLowerCase().replace(/[\s-]+/g, "_"))}
              />
            </div>
          </div>
          <p id={ids.relHelp} className={cn("text-xs", relOk ? "text-text-3" : "text-danger")}>
            {relOk
              ? "The relationship is only a label, e.g. lives_in or knows_about."
              : "Start with a letter; use lowercase letters, digits and underscores."}
          </p>
          {chosen.visibility === "private" ? (
            <p className="text-xs text-warning">
              This version is private. A public release can't depend on it.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ink"
              size="sm"
              disabled={!relOk}
              onClick={() =>
                onAdd(
                  {
                    use: ref,
                    pin: { release: chosen.id, semantic_digest: chosen.semantic_digest },
                    mode,
                    ...(relValue ? { rel: relValue } : {}),
                  },
                  picked.name,
                )
              }
            >
              <Plus aria-hidden /> Add dependency
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </fieldset>
  );
}
