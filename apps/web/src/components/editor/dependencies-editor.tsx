/**
 * 依赖：这个作品建立在哪些已发布的作品之上（例如角色所在的世界）。每个依赖都锁定到
 * 一个精确的 Release（Release ID + semantic digest），上游之后的更新不会悄悄改变它。
 */
import { type CheckDiagnostic, NAME_RE, type ReferenceEdge } from "@char-pub/core";
import { Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isApiError } from "@/lib/api";
import { getReferences, nextId, setReferences, type Working } from "@/lib/draft";
import { useRegistry } from "@/lib/registry";
import { parseRef } from "@/lib/text";
import { DiagnosticList, diagnosticsFor } from "./diagnostics";

const selectClass =
  "h-9 rounded-sm border border-input bg-card px-2 text-sm focus-visible:outline-2 focus-visible:outline-seal";

function pinText(r: ReferenceEdge): string {
  if (!r.pin) return "not pinned";
  return "follow" in r.pin ? "follows latest (pinned on publish)" : `locked to ${r.pin.release}`;
}

export function DependenciesEditor({
  working,
  update,
  diagnostics,
}: {
  working: Working;
  update: (fn: (w: Working) => Working) => void;
  diagnostics: readonly CheckDiagnostic[];
}) {
  const client = useRegistry();
  const refs = getReferences(working);
  const [use, setUse] = useState("");
  const [label, setLabel] = useState("");
  const [mode, setMode] = useState<ReferenceEdge["mode"]>("default");
  const [rel, setRel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { use: useId(), label: useId(), mode: useId(), rel: useId() };

  const add = async () => {
    setError(null);
    const target = parseRef(use.trim());
    if (!target) {
      setError("Use the form @namespace/name.");
      return;
    }
    setBusy(true);
    try {
      const detail = await client.creation(target.ns, target.name);
      const chosen = label.trim() || detail.latest_release?.label;
      if (!chosen) {
        setError("That creation has no public release to depend on yet.");
        return;
      }
      const release = await client.release(target.ns, target.name, chosen);
      if (release.status !== "active") {
        setError(`${chosen} is ${release.status}; choose another version.`);
        return;
      }
      const base = NAME_RE.test(target.name) ? target.name : "dep";
      const edge: ReferenceEdge = {
        id: nextId(
          refs.map((r) => r.id),
          base.slice(0, 64),
        ),
        use: `@${target.ns}/${target.name}`,
        pin: { release: release.id, semantic_digest: release.semantic_digest },
        mode,
        ...(rel.trim() ? { rel: rel.trim() } : {}),
      };
      update((w) => setReferences(w, [...getReferences(w), edge]));
      setUse("");
      setLabel("");
      setRel("");
    } catch (e) {
      setError(
        isApiError(e) && e.status === 404
          ? "No such creation or version, or it is not public."
          : isApiError(e) && e.status === 410
            ? "That version was removed."
            : "Could not look it up. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Depend on published creations — the world your character lives in, a shared lorebook. Each
        dependency is locked to an exact release.
      </p>
      {refs.length > 0 ? (
        <ul className="divide-y divide-rule border-y border-rule">
          {refs.map((r, i) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="block font-mono text-sm">{String(r.use)}</span>
                <span className="block font-mono text-xs text-muted-foreground">
                  #{r.id} · {r.mode}
                  {r.rel ? ` · ${r.rel}` : ""} · {pinText(r)}
                </span>
                <DiagnosticList items={diagnosticsFor(diagnostics, `references[${r.id}]`)} />
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  update((w) =>
                    setReferences(
                      w,
                      getReferences(w).filter((_, j) => j !== i),
                    ),
                  )
                }
              >
                <Trash2 aria-hidden /> Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[1fr_7rem_9rem_8rem_auto] sm:items-end">
        <div className="space-y-1">
          <label htmlFor={ids.use} className="text-xs">
            Creation
          </label>
          <Input
            id={ids.use}
            className="font-mono"
            placeholder="@namespace/name"
            value={use}
            onChange={(e) => setUse(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.label} className="text-xs">
            Version
          </label>
          <Input
            id={ids.label}
            className="font-mono"
            placeholder="latest"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.mode} className="text-xs">
            Relationship
          </label>
          <select
            id={ids.mode}
            className={`${selectClass} w-full`}
            value={mode}
            onChange={(e) => setMode(e.target.value as ReferenceEdge["mode"])}
          >
            <option value="default">default (replaceable)</option>
            <option value="intrinsic">intrinsic (part of it)</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.rel} className="text-xs">
            Label (optional)
          </label>
          <Input
            id={ids.rel}
            className="font-mono"
            placeholder="lives_in"
            value={rel}
            maxLength={32}
            onChange={(e) => setRel(e.target.value.toLowerCase())}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !use.trim()}
          onClick={() => void add()}
        >
          <Plus aria-hidden /> Add
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-seal">
          {error}
        </p>
      ) : null}
    </div>
  );
}
