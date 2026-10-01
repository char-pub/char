import type { Fragment } from "@char-pub/core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  aboutRestoreError,
  draftAboutOptions,
  draftAboutTarget,
  incomingAbout,
} from "@/lib/about-editor";
import type { Working } from "@/lib/draft";
export type AboutNavigate = (ref: string) => void;
export function FragmentAbout({
  working,
  fragment,
  onChange,
  onNavigate,
}: {
  working: Working;
  fragment: Fragment;
  onChange: (next: Fragment) => void;
  onNavigate?: AboutNavigate;
}) {
  const [entry, setEntry] = useState("");
  const [removed, setRemoved] = useState<{
    ref: string;
    index: number;
    after: string[];
    baseline: Working;
  } | null>(null);
  const [error, setError] = useState("");
  const options = draftAboutOptions(working);
  const incoming = incomingAbout(working, { kind: "fragment", id: fragment.id });
  const add = (ref: string) => {
    if (ref && !fragment.about?.includes(ref))
      onChange({ ...fragment, about: [...(fragment.about ?? []), ref] });
  };
  return (
    <details
      open={!!fragment.about?.length || !!incoming.length || !!removed}
      className="space-y-2 rounded border p-3"
    >
      <summary>About and related entries</summary>
      <p className="text-xs text-text-2">
        Describe what this entry is about. These links do not activate content or tell a participant
        something new.
      </p>
      <ul aria-label={`About links from ${fragment.id}`}>
        {(fragment.about ?? []).map((ref) => (
          <li key={ref} className="flex flex-wrap items-center gap-2">
            <span>{options.find((o) => o.ref === ref)?.label ?? ref}</span>
            {onNavigate && draftAboutTarget(working, ref) ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => onNavigate(ref)}>
                View {ref}
              </Button>
            ) : (
              <span className="text-xs text-text-2">Checked when building</span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove about ${ref} from ${fragment.id}`}
              onClick={() => {
                const after = (fragment.about ?? []).filter((r) => r !== ref);
                setRemoved({
                  ref,
                  index: (fragment.about ?? []).indexOf(ref),
                  after,
                  baseline: structuredClone(working),
                });
                setError("");
                onChange({ ...fragment, about: after });
              }}
            >
              Remove link
            </Button>
          </li>
        ))}
      </ul>
      {removed ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (JSON.stringify(fragment.about ?? []) !== JSON.stringify(removed.after)) {
              setError("About links changed after removal. Undo cannot overwrite them.");
              return;
            }
            const problem = aboutRestoreError(working, removed.baseline, removed.ref);
            if (problem) {
              setError(problem);
              return;
            }
            const about = [...(fragment.about ?? [])];
            about.splice(Math.min(removed.index, about.length), 0, removed.ref);
            onChange({ ...fragment, about });
            setRemoved(null);
            setError("");
          }}
        >
          Undo about link removal
        </Button>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <Label className="block">
        About target for {fragment.id}
        <NativeSelect
          aria-label={`About target for ${fragment.id}`}
          value=""
          onChange={(e) => add(e.target.value)}
        >
          <option value="">Choose an entry, participant or work…</option>
          {options
            .filter((o) => !fragment.about?.includes(o.ref))
            .map((o) => (
              <option key={o.ref} value={o.ref}>
                {o.label}
              </option>
            ))}
        </NativeSelect>
      </Label>
      <details>
        <summary>Link content from a referenced work</summary>
        <p className="text-xs text-text-2">
          Use @author/work#entry, cast:person#entry or @author/work. The build verifies the target
          and rejects ambiguous instances.
        </p>
        <Label className="block">
          External about reference for {fragment.id}
          <Input value={entry} onChange={(e) => setEntry(e.target.value)} />
        </Label>
        <Button
          type="button"
          variant="outline"
          disabled={!/^(?:@[a-z0-9][^\s#]*|cast:[a-z0-9][^\s#]*)(?:#[^\s#]+)?$/.test(entry)}
          onClick={() => {
            add(entry);
            setEntry("");
          }}
        >
          Add about reference
        </Button>
      </details>
      <div>
        <h4 className="text-sm font-semibold">Entries about this entry</h4>
        {incoming.length ? (
          <ul>
            {incoming.map((f) => (
              <li key={f.id}>
                {onNavigate ? (
                  <Button type="button" variant="link" onClick={() => onNavigate(`#${f.id}`)}>
                    Open related entry {f.id}
                  </Button>
                ) : (
                  f.id
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-text-2">No incoming links yet.</p>
        )}
      </div>
    </details>
  );
}
export function AboutDirectory({
  working,
  target,
  onTargetChange,
  onNavigate,
}: {
  working: Working;
  target: string;
  onTargetChange: (ref: string) => void;
  onNavigate: AboutNavigate;
}) {
  const options = draftAboutOptions(working).filter((o) => draftAboutTarget(working, o.ref));
  const resolved = draftAboutTarget(working, target);
  const incoming = resolved ? incomingAbout(working, resolved) : [];
  return (
    <details id="edit-about-directory" open={!!target} className="space-y-2 rounded border p-3">
      <summary>Find related entries</summary>
      <Label className="block">
        Find entries about
        <NativeSelect
          aria-label="Find entries about"
          value={resolved ? target : ""}
          onChange={(e) => onTargetChange(e.target.value)}
        >
          <option value="">Choose a subject…</option>
          {options.map((o) => (
            <option key={o.ref} value={o.ref}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      </Label>
      {resolved ? (
        <>
          <p className="text-sm">{options.find((o) => o.ref === target)?.label ?? target}</p>
          {resolved.kind === "fragment" ? (
            <Button type="button" variant="link" onClick={() => onNavigate(target)}>
              Open subject {resolved.id}
            </Button>
          ) : null}
          <ul aria-label="Entries about selected subject">
            {incoming.map((f) => (
              <li key={f.id}>
                <Button type="button" variant="link" onClick={() => onNavigate(`#${f.id}`)}>
                  Open related entry {f.id}
                </Button>
              </li>
            ))}
          </ul>
          {!incoming.length ? (
            <p className="text-xs">No entries link to this subject yet.</p>
          ) : null}
        </>
      ) : null}
    </details>
  );
}
