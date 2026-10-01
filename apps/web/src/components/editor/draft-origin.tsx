import { DerivationSourceSchema } from "@char-pub/core";
import { FactCard } from "@/components/creation-facts";
import type { Working } from "@/lib/draft";

/** Read-only authoring history; editing content does not remove agent attribution. */
export function DraftOrigin({ working }: { working: Working }) {
  const provenance = working.provenance;
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) return null;
  const agentAssisted = "authored_by_agent" in provenance && provenance.authored_by_agent === true;
  const sources =
    "derived_from" in provenance && Array.isArray(provenance.derived_from)
      ? provenance.derived_from.flatMap((value) => {
          const parsed = DerivationSourceSchema.safeParse(value);
          return parsed.success ? [parsed.data] : [];
        })
      : [];
  if (!agentAssisted && sources.length === 0) return null;
  return (
    <FactCard id="draft-origin-heading" title="Draft origin">
      {agentAssisted ? (
        <p className="text-sm text-text-2">
          This draft includes agent-assisted content. Review the opening, initial state and source
          before publishing.
        </p>
      ) : null}
      {sources.length ? (
        <ul aria-label="Creation sources" className="space-y-3 text-sm">
          {sources.map((source, index) => (
            <li key={`${source.release}:${source.relation}:${index}`} className="space-y-1">
              <p>
                <span className="capitalize">{source.relation}</span>
                {"ref" in source ? <> · {source.ref}</> : " · Historical source"}
              </p>
              <p className="break-all font-mono text-xs text-text-2">Release: {source.release}</p>
              {"semantic_digest" in source ? (
                <p className="break-all font-mono text-xs text-text-3">
                  Digest: {source.semantic_digest}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </FactCard>
  );
}
