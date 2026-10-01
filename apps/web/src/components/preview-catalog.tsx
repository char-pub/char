import {
  type CatalogNode,
  type ContextAssemblyInput,
  catalogKey,
  createPreparationCatalog,
} from "@char-pub/assembler";
import type { CatalogRef } from "@char-pub/core";
import { useMemo } from "react";
import { localized } from "@/lib/text";

const reasons: Record<string, string> = {
  "view.source_not_shared": "This reference document is not shared with individual characters.",
  "view.other_scene": "This content belongs to another scene.",
  "view.style_other_cast": "This style belongs to another participant.",
  "view.absent": "The participant is not present.",
  "view.style_replaced": "A later style replaces this style in the same scope.",
  "view.not_outward": "Another character's internal content is not marked as outward.",
  "view.not_knowing": "This participant does not know this information.",
  "view.private": "This participant is outside the private audience.",
};

function Refs({
  title,
  refs,
  labels,
}: {
  title: string;
  refs: readonly CatalogRef[];
  labels: ReadonlyMap<string, string>;
}) {
  return (
    <section className="space-y-1">
      <h4 className="font-semibold">{title}</h4>
      {refs.length ? (
        <ul aria-label={title} className="space-y-1 text-xs">
          {refs.map((ref) => (
            <li key={catalogKey(ref)} className="break-all">
              <p>{labels.get(catalogKey(ref)) ?? catalogKey(ref)}</p>
              {labels.has(catalogKey(ref)) ? (
                <code className="text-text-3">{catalogKey(ref)}</code>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-text-2">None in this view.</p>
      )}
    </section>
  );
}
function Nodes({ nodes }: { nodes: readonly CatalogNode[] }) {
  return (
    <ul className="space-y-2 border-l pl-3">
      {nodes.map((node) => (
        <li key={catalogKey(node.ref)}>
          <p>
            {node.title} <span className="text-text-3">({node.kind})</span>
          </p>
          {node.description ? <p className="text-xs text-text-2">{node.description}</p> : null}
          {node.child_count !== undefined ? (
            <p className="text-xs text-text-3">
              {node.child_count} visible child entries; {node.children?.length ?? 0} exposed in this
              directory.
            </p>
          ) : null}
          {node.children?.length ? <Nodes nodes={node.children} /> : null}
        </li>
      ))}
    </ul>
  );
}

/** Trusted author inspection only. Never serialize this panel's data into a provider request. */
export function PreviewCatalog({ input }: { input: ContextAssemblyInput }) {
  const result = useMemo(() => {
    try {
      const build = createPreparationCatalog(input);
      const locale = build.context.turn.locale ?? build.context.artifact.ir.meta.default_locale;
      const labels = new Map<string, string>();
      for (const fragment of build.context.artifact.ir.fragments)
        labels.set(
          catalogKey({ fragment: fragment.id }),
          `${fragment.origin.fragment} · ${fragment.origin.creation}`,
        );
      for (const source of build.context.artifact.catalog_index.sources) {
        labels.set(catalogKey({ source: source.id }), localized(source.title, locale));
        for (const section of source.sections)
          labels.set(
            catalogKey({ source: source.id, section: section.id }),
            `${localized(source.title, locale)} / ${localized(section.title, locale)}`,
          );
      }
      for (const scene of build.context.artifact.story?.scenes ?? [])
        labels.set(catalogKey({ story: "scene", id: scene.id }), localized(scene.title, locale));
      return { build, labels };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "The directory could not be prepared.",
      };
    }
  }, [input]);
  return (
    <details className="space-y-3 rounded border p-3">
      <summary className="cursor-pointer font-semibold">Author context directory</summary>
      <p className="text-xs text-text-2">
        Inspect the initial directory for this view. Hidden identities and reasons are author
        diagnostics, not model or selector input. Opening this panel does not select or download any
        content.
      </p>
      {result.build ? (
        <section className="space-y-4" aria-label="Author context directory">
          <Refs
            title="Required content"
            refs={result.build.catalog.required}
            labels={result.labels}
          />
          <Refs
            title="Directly associated content"
            refs={result.build.catalog.direct}
            labels={result.labels}
          />
          <section className="space-y-1">
            <h4 className="font-semibold">Initial candidates</h4>
            {result.build.catalog.candidates.length ? (
              <Nodes nodes={result.build.catalog.candidates} />
            ) : (
              <p className="text-xs text-text-2">
                No optional candidates in the initial directory.
              </p>
            )}
          </section>
          <section className="space-y-1">
            <h4 className="font-semibold">Fragments and documents hidden from this view</h4>
            <ul aria-label="Hidden content reasons" className="space-y-2 text-xs">
              {[...result.build.visibility]
                .filter(([, value]) => value.status !== "visible")
                .map(([key, value]) => (
                  <li key={key}>
                    <p className="break-all">{result.labels.get(key) ?? key}</p>
                    <code className="break-all text-text-3">{key}</code>
                    <p>
                      {value.reason
                        ? (reasons[value.reason] ?? value.reason)
                        : "Unavailable in this view."}
                    </p>
                    <code className="text-text-3">
                      {value.status}
                      {value.reason ? ` · ${value.reason}` : ""}
                    </code>
                  </li>
                ))}
            </ul>
            {[...result.build.visibility.values()].every((value) => value.status === "visible") ? (
              <p className="text-xs text-text-2">
                No fragments or reference documents are hidden by the current view.
              </p>
            ) : null}
          </section>
        </section>
      ) : (
        <p role="status">Author directory unavailable: {result.error}</p>
      )}
    </details>
  );
}
