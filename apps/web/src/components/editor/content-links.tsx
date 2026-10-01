import type { ContentGroup, KnowledgeSource } from "@char-pub/core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { localeOf, type Working } from "@/lib/draft";
import { storyText } from "@/lib/story-editor";

/** Associations store references; the build resolves external instances and the view filters them. */
export function ContentLinks({
  working,
  value = [],
  onChange,
  label,
}: {
  working: Working;
  value?: string[];
  onChange: (next: string[]) => void;
  label: string;
}) {
  const [external, setExternal] = useState("");
  const locale = localeOf(working);
  const options = [
    ...(working.fragments ?? []).map((f) => ({ ref: `#${f.id}`, title: `Entry: ${f.id}` })),
    ...((working.groups ?? []) as ContentGroup[]).map((g) => ({
      ref: `#group/${g.id}`,
      title: `Group: ${storyText(g.title, locale) || g.id}`,
    })),
    ...((working.sources ?? []) as KnowledgeSource[]).flatMap((s) => [
      { ref: `#source/${s.id}`, title: `Document: ${storyText(s.title, locale) || s.id}` },
      ...(s.sections ?? []).map((part) => ({
        ref: `#source/${s.id}/${part.id}`,
        title: `Section: ${storyText(s.title, locale)} / ${storyText(part.title, locale)}`,
      })),
    ]),
  ];
  const append = (ref: string) => {
    if (ref && !value.includes(ref)) onChange([...value, ref]);
  };
  return (
    <section className="space-y-2" aria-label={label}>
      <p className="text-xs text-text-2">
        Link entries, groups or document sections. Visibility and knowledge rules still apply;
        linking does not reveal hidden information.
      </p>
      <ul className="space-y-1">
        {value.map((ref) => (
          <li key={ref} className="flex flex-wrap items-center justify-between gap-2">
            <span>{options.find((o) => o.ref === ref)?.title ?? ref}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove ${ref} from ${label}`}
              onClick={() => onChange(value.filter((v) => v !== ref))}
            >
              Remove link
            </Button>
          </li>
        ))}
      </ul>
      <Label className="block">
        {label}
        <NativeSelect aria-label={label} value="" onChange={(e) => append(e.target.value)}>
          <option value="">Choose related reading…</option>
          {options
            .filter((o) => !value.includes(o.ref))
            .map((o) => (
              <option key={o.ref} value={o.ref}>
                {o.title}
              </option>
            ))}
        </NativeSelect>
      </Label>
      <details>
        <summary>Link a referenced work's content</summary>
        <p className="my-2 text-xs text-text-2">
          Use @author/work#entry or cast:person#entry. Add the dependency first; the draft build
          verifies the exact target.
        </p>
        <Label className="block">
          External reference for {label}
          <Input value={external} onChange={(e) => setExternal(e.target.value)} />
        </Label>
        <Button
          type="button"
          variant="outline"
          disabled={!/^(?:@[a-z0-9][^\s#]*|cast:[a-z0-9][^\s#]*)#[^\s#]+$/.test(external)}
          onClick={() => {
            append(external);
            setExternal("");
          }}
        >
          Add related reference
        </Button>
      </details>
    </section>
  );
}
