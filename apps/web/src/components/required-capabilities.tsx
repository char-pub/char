import type { Capability } from "@char-pub/core";
import { CAPABILITY_NAMES } from "@/lib/capabilities";
import { FactCard } from "./creation-facts";

/** Requirements from the verified selected artifact, not inferred from its creation type. */
export function RequiredCapabilities({ capabilities }: { capabilities: readonly Capability[] }) {
  return (
    <FactCard id="c-capabilities" title="Required runtime capabilities">
      <p className="text-xs text-text-2">
        Your runtime must support these features or explain its limitations.
      </p>
      {capabilities.length ? (
        <ul className="list-disc space-y-1 pl-4 text-sm">
          {capabilities.map((capability) => (
            <li key={capability.id}>
              {CAPABILITY_NAMES[capability.id] ?? capability.id}
              {capability.experimental ? " (experimental)" : ""}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-2">No additional runtime capabilities declared.</p>
      )}
    </FactCard>
  );
}
