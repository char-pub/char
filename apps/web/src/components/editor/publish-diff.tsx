import type { JSONValue } from "@char-pub/core";
import {
  type PublishDefinitionDiff,
  type PublishDiffCategory,
  publishFieldLabel,
} from "@/lib/publish-diff";

const CATEGORIES: { id: PublishDiffCategory; title: string; description: string }[] = [
  {
    id: "body",
    title: "Body content",
    description: "Passages, openings and other text used during play.",
  },
  {
    id: "description",
    title: "Descriptions",
    description: "Explanations used to understand and choose content.",
  },
  {
    id: "structure",
    title: "Structure and settings",
    description: "Objects, ordering, conditions, references, publishing details and policies.",
  },
];
function Value({ value }: { value: JSONValue | undefined }) {
  if (value === undefined) return <span className="text-text-3">Not set</span>;
  if (value === null) return <span>None</span>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value === "string")
    return <p className="whitespace-pre-wrap break-words">{value || "Empty text"}</p>;
  if (typeof value === "number") return <span>{value}</span>;
  if (Array.isArray(value))
    return value.length ? (
      <ol className="list-inside list-decimal space-y-1">
        {value.map((item, index) => (
          <li key={index}>
            <Value value={item} />
          </li>
        ))}
      </ol>
    ) : (
      <span>No entries</span>
    );
  return (
    <dl className="space-y-1">
      {Object.entries(value).map(([key, item]) => (
        <div key={key}>
          <dt className="font-medium text-text-2">{publishFieldLabel(key)}</dt>
          <dd className="pl-3">
            <Value value={item} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Named objects and field-level values; technical JSON is never the primary review surface. */
export function PublicationDiff({
  diff,
  baseline,
}: {
  diff: PublishDefinitionDiff;
  baseline: string | null;
}) {
  return (
    <section className="space-y-3" aria-label="Changes in this release">
      <h3 className="font-semibold">Changes in this release</h3>
      <p className="text-sm text-text-2">
        {baseline
          ? `Compared with ${baseline}.`
          : "First release — this content has no previous published version."}
      </p>
      {CATEGORIES.map((category) => {
        const entries = diff.entries.filter((entry) => entry.category === category.id);
        return (
          <details
            key={category.id}
            open={baseline !== null && entries.length > 0}
            className="rounded-lg border p-3"
          >
            <summary className="cursor-pointer font-medium">
              {category.title} · {entries.length} {entries.length === 1 ? "change" : "changes"}
            </summary>
            <p className="mt-2 text-xs text-text-2">{category.description}</p>
            {entries.length === 0 ? (
              <p className="mt-2 text-sm">Unchanged.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {entries.map((entry, index) => (
                  <li key={`${entry.path.join("/")}:${index}`} className="space-y-2 border-t pt-3">
                    <h4 className="text-sm font-semibold">
                      {entry.object} — {entry.field}
                    </h4>
                    <p className="text-xs text-text-2">
                      {entry.change === "added"
                        ? "Added"
                        : entry.change === "removed"
                          ? "Removed"
                          : "Changed"}{" "}
                      · {entry.path.map(publishFieldLabel).join(" / ")}
                    </p>
                    {entry.path.at(-1) === "body" && entry.path[0] === "sources" ? (
                      <p className="text-sm">
                        The reference document bytes changed. Review the matching source file; its
                        contents are not downloaded by this comparison.
                      </p>
                    ) : null}
                    <div className="grid gap-3 text-sm sm:grid-cols-2">
                      <section
                        aria-label="Previous value"
                        className="max-h-64 overflow-auto rounded bg-surface-2 p-2"
                      >
                        <h5 className="mb-1 text-xs font-semibold">Previous</h5>
                        <Value value={entry.before} />
                      </section>
                      <section
                        aria-label="Reviewed value"
                        className="max-h-64 overflow-auto rounded bg-surface-2 p-2"
                      >
                        <h5 className="mb-1 text-xs font-semibold">Reviewed draft</h5>
                        <Value value={entry.after} />
                      </section>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </details>
        );
      })}
    </section>
  );
}
