/**
 * Import Report：角色卡导入时每个字段去了哪里、哪些没有导入、哪些需要作者确认。
 *
 * 被省略的策略字段（例如卡片里的 system prompt）只显示字段名，绝不显示内容：
 * 这些内容会改写模型行为，不属于作品本身，它们只留在作者自己的原件里。
 */
import type { ImportReport as Report } from "@char-pub/contracts";
import type { ReactNode } from "react";

interface LoreEntry {
  index: number;
  activation: string;
  notes: string[];
}

interface Placeholder {
  placeholder: string;
  location: string;
}

function asLore(e: Record<string, unknown>): LoreEntry {
  return {
    index: typeof e.index === "number" ? e.index : -1,
    activation: typeof e.activation === "string" ? e.activation : "",
    notes: Array.isArray(e.notes) ? e.notes.filter((n): n is string => typeof n === "string") : [],
  };
}

function asPlaceholder(p: Record<string, unknown>): Placeholder {
  return {
    placeholder: typeof p.placeholder === "string" ? p.placeholder : "",
    location: typeof p.location === "string" ? p.location : "",
  };
}

function Section({
  title,
  children,
  empty,
}: {
  title: string;
  children: ReactNode;
  empty?: boolean;
}) {
  if (empty) return null;
  return (
    <section className="space-y-2">
      <h3 className="font-display text-lg">{title}</h3>
      {children}
    </section>
  );
}

export function ImportReport({
  report,
  unstable,
}: {
  report: Report;
  unstable: readonly string[];
}) {
  const droppedLore = report.lorebook.map(asLore).filter((e) => e.activation === "dropped");
  const placeholders = report.placeholders.map(asPlaceholder);
  const skippedAssets = report.assets.filter((a) => !a.imported);
  return (
    <section className="space-y-6" aria-label="Import report">
      <p className="text-sm text-muted-foreground">
        Read a <span className="font-mono">{report.format}</span> card
        {report.spec_version ? ` (spec ${report.spec_version})` : ""} from a{" "}
        {report.container.toUpperCase()} file.
      </p>

      <Section title="How fields were mapped" empty={report.mappings.length === 0}>
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-1 font-normal">In the card</th>
              <th className="py-1 font-normal">On char.pub</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule font-mono text-xs">
            {report.mappings.map((m) => (
              <tr key={`${m.from}->${m.to}`}>
                <td className="py-1 pr-3">{m.from}</td>
                <td className="py-1">{m.to}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Left out on purpose" empty={report.omitted_policy_fields.length === 0}>
        <p className="text-sm text-muted-foreground">
          These fields tell a chat app how to steer the model. They are not part of the character,
          so they were not imported; only their names are recorded. Your original file still has
          them.
        </p>
        <ul className="flex flex-wrap gap-2" aria-label="Omitted fields">
          {report.omitted_policy_fields.map((f) => (
            <li key={f.field} className="stamp border-rule font-mono">
              {f.field}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Lore entries others can't build on" empty={unstable.length === 0}>
        <p className="text-sm text-muted-foreground">
          These entries had no stable identity in the card. They work as usual, but other creations
          can't override them until you mark them stable in the editor.
        </p>
        <ul className="flex flex-wrap gap-2 font-mono text-xs">
          {unstable.map((id) => (
            <li key={id} className="stamp border-amber/60 bg-amber-soft">
              {id}
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Not imported"
        empty={
          report.dropped.length === 0 && droppedLore.length === 0 && skippedAssets.length === 0
        }
      >
        <ul className="space-y-1 text-sm">
          {report.dropped.map((d) => (
            <li key={d.field}>
              <span className="font-mono text-xs">{d.field}</span>
              <span className="text-muted-foreground"> — {d.reason}</span>
            </li>
          ))}
          {droppedLore.map((e) => (
            <li key={`lore-${e.index}`}>
              <span className="font-mono text-xs">character_book.entries[{e.index}]</span>
              <span className="text-muted-foreground"> — {e.notes.join("; ") || "dropped"}</span>
            </li>
          ))}
          {skippedAssets.map((a) => (
            <li key={`${a.type}:${a.name}:${a.uri}`}>
              <span className="font-mono text-xs">
                asset {a.type}/{a.name}
              </span>
              <span className="text-muted-foreground"> — {a.reason ?? "not imported"}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Macros kept as text" empty={placeholders.length === 0}>
        <ul className="space-y-1 font-mono text-xs">
          {placeholders.map((p) => (
            <li key={`${p.location}:${p.placeholder}`}>
              {p.placeholder} <span className="text-muted-foreground">in {p.location}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Warnings" empty={report.warnings.length === 0}>
        <ul className="space-y-1 text-sm">
          {report.warnings.map((w) => (
            <li key={`${w.code}:${w.detail}`}>
              <span className="font-mono text-xs">{w.code}</span>
              <span className="text-muted-foreground"> — {w.detail}</span>
            </li>
          ))}
        </ul>
      </Section>
    </section>
  );
}
