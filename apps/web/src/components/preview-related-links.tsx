import type { ContextAssemblyInput } from "@char-pub/assembler";
import { useId } from "react";
import { previewRelatedLinks } from "@/lib/preview-related-links";

/** In-artifact navigation only: no fetching, selection, or session mutation. */
export function PreviewRelatedLinks({ input }: { input: ContextAssemblyInput }) {
  const prefix = useId();
  let directory: ReturnType<typeof previewRelatedLinks>;
  try {
    directory = previewRelatedLinks(input);
  } catch {
    return <p role="status">Related references are unavailable for this preview.</p>;
  }
  if (!directory.links.length) return null;
  const ids = new Map(
    directory.nodes.map((node, index) => [node.key, `${prefix}-related-${index}`]),
  );
  const labels = new Map(directory.nodes.map((node) => [node.key, node.label]));
  const link = (key: string) => (
    <a
      key={key}
      href={`#${ids.get(key)}`}
      className="underline"
      onClick={(event) => {
        event.preventDefault();
        document.getElementById(ids.get(key) ?? "")?.focus();
      }}
    >
      {labels.get(key)}
    </a>
  );
  return (
    <details className="rounded border p-3">
      <summary className="cursor-pointer font-medium">Related references</summary>
      <p className="my-2 text-sm text-muted-foreground">
        Links within the current view and exposed directory. Following a link does not select its
        content.
      </p>
      <ul aria-label="Related references" className="space-y-3">
        {directory.nodes.map((node) => {
          const outgoing = directory.links.filter((edge) => edge.from === node.key);
          const incoming = directory.links.filter((edge) => edge.to === node.key);
          return (
            <li
              key={node.key}
              id={ids.get(node.key)}
              tabIndex={-1}
              className="rounded border p-2 focus:outline"
            >
              <p className="font-medium">
                {node.label} <span className="text-xs text-muted-foreground">({node.kind})</span>
              </p>
              <p className="break-all text-xs text-muted-foreground">{node.identity}</p>
              {outgoing.length > 0 && (
                <div>
                  About:{" "}
                  <ul>
                    {outgoing.map((edge) => (
                      <li key={edge.to}>{link(edge.to)}</li>
                    ))}
                  </ul>
                </div>
              )}
              {incoming.length > 0 && (
                <div>
                  Referenced by:{" "}
                  <ul>
                    {incoming.map((edge) => (
                      <li key={edge.from}>{link(edge.from)}</li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
