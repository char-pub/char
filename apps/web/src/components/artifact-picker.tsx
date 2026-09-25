import type { CreationArtifact, CreationType } from "@char-pub/core";
import { useQuery } from "@tanstack/react-query";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useMe, useRegistry } from "@/lib/registry";
import { localized, parseRef } from "@/lib/text";

export interface ArtifactChoice {
  artifact: CreationArtifact;
  label: string;
  visibility: "public" | "private";
}

/** A selection always resolves a particular release; recommendations never silently select latest. */
export function ArtifactPicker(props: ComponentProps<typeof ScopedArtifactPicker>) {
  const me = useMe();
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
  const me = useMe();
  const [text, setText] = useState("");
  const [ref, setRef] = useState("");
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = parseRef(ref);
  const detail = useQuery({
    queryKey: ["asset-choice", me.data?.id ?? null, ref],
    queryFn: () => client.creation(target?.ns ?? "", target?.name ?? ""),
    enabled: !!target && !me.isPending,
  });
  const search = useQuery({
    queryKey: ["asset-search", me.data?.id ?? null, text, types],
    queryFn: () => client.search({ q: text, limit: 8 }),
    enabled: text.trim().length >= 2 && !text.startsWith("@") && !me.isPending,
  });
  const releases = detail.data?.releases.filter((r) => r.status === "active") ?? [];
  const validType = !types || (detail.data && types.includes(detail.data.type));
  const load = async () => {
    const selected = releases.find((r) => r.id === version);
    if (!target || !selected || !validType) return;
    setBusy(true);
    setError(null);
    try {
      const artifact = await client.getArtifact(target.ns, target.name, selected.label, {
        private: selected.visibility === "private",
      });
      if (!active.current) return;
      onPick({ artifact, label: selected.label, visibility: selected.visibility });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this release");
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset className="space-y-2 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">{label}</legend>
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
            setRef(text);
            setVersion("");
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
              setRef(item.ref);
              setText(item.ref);
              setVersion("");
            }}
          >
            {localized(item.display_name)} · {item.ref}
          </Button>
        ))}
      {detail.data ? (
        <>
          <p className="text-xs font-mono">{detail.data.ref}</p>
          {!validType ? (
            <p role="alert">Choose {types?.join(" or ")}.</p>
          ) : (
            <div className="flex gap-2">
              <NativeSelect
                aria-label={`${label} version`}
                value={version}
                onChange={(e) => setVersion(e.target.value)}
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
      {detail.isError || search.isError || error ? (
        <p role="alert" className="text-sm text-danger">
          {error ?? "Could not find this creation. Check its address and your access."}
        </p>
      ) : null}
    </fieldset>
  );
}
