import type { OpeningMessage } from "@char-pub/assembler";
import { Button } from "@/components/ui/button";

/** Source metadata comes from the same initialization that supplied the actual preview history. */
export function PreviewOpening({
  opening,
  supplied,
  onLocate,
  disabledReason,
}: {
  opening: OpeningMessage | null;
  supplied: boolean;
  onLocate?: ((subject: string) => void) | undefined;
  disabledReason?: string | undefined;
}) {
  const source = opening?.source;
  const subject =
    source?.kind === "story-start"
      ? `story.starts[${source.id}].greeting`
      : source
        ? `bootstrap.greetings[${source.id}]`
        : undefined;
  return (
    <section
      aria-label="First player-facing message"
      className="space-y-2 rounded-lg border bg-surface p-4"
    >
      <h3 className="font-semibold">First player-facing message</h3>
      {opening ? (
        <>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm">{opening.content}</pre>
          <p className="text-xs text-text-2">
            {source?.kind === "story-start"
              ? `Opening template: ${source.id}`
              : `Bootstrap greeting: ${source?.id}`}
            {opening.locale_fallback ? " · Using the default language." : ""}
          </p>
          <p className="text-xs text-text-2">
            Already included once in the preview history. Scene opening text provides context
            separately.
          </p>
          {onLocate && subject ? (
            <Button
              variant="outline"
              size="sm"
              disabled={!!disabledReason}
              onClick={() => onLocate(subject)}
            >
              Edit message source
            </Button>
          ) : null}
          {onLocate ? (
            <p className="text-xs text-text-2">
              The editor opens the source in the draft’s default language.
            </p>
          ) : null}
          {disabledReason ? <p className="text-xs text-text-2">{disabledReason}</p> : null}
        </>
      ) : (
        <p className="text-sm text-text-2">
          {supplied
            ? "This preview uses supplied history. No opening message was added."
            : "This opening has no player-facing message. Scene context can still be included."}
        </p>
      )}
    </section>
  );
}
