import type { ReferenceImpactResponse } from "@char-pub/contracts";
import { localized } from "@/lib/text";
import { Button } from "../ui/button";

export function ReferenceImpact({
  pages,
  loading,
  error,
  onMore,
}: {
  pages: ReferenceImpactResponse[];
  loading: boolean;
  error: string | null;
  onMore: () => void;
}) {
  const first = pages[0];
  if (!first) return null;
  const items = pages.flatMap((page) => page.items);
  return (
    <section aria-label="References to removed objects" className="space-y-3 text-sm">
      <h3 className="font-semibold">References to removed objects</h3>
      <p className="text-text-2">
        Only published releases you can read are listed. Existing exact pins keep using their
        original content; these findings help authors review an upgrade.
      </p>
      {first.objects.length ? (
        <>
          <ul aria-label="Removed objects" className="list-inside list-disc">
            {first.objects.map((object) => (
              <li key={`${object.kind}:${object.parent ?? ""}:${object.id}`}>
                {object.kind} · {object.parent ? `${object.parent} / ` : ""}
                {object.id}
              </li>
            ))}
          </ul>
          {items.length ? (
            <ul className="space-y-3" aria-label="Referencing releases">
              {items.map((item) => (
                <li key={item.release.id} className="rounded border p-3">
                  <h4 className="font-medium">
                    {localized(item.display_name)} · {item.ref}@{item.release.label}
                  </h4>
                  <p className="text-xs text-text-2">
                    {item.release.visibility === "private"
                      ? "Private release you can read"
                      : "Public release"}
                  </p>
                  {item.uses.length ? (
                    <ul className="mt-2 space-y-2">
                      {item.uses.map((use, index) => (
                        <li key={`${use.path}:${index}`}>
                          <p>
                            {use.object.kind} · {use.object.parent ? `${use.object.parent} / ` : ""}
                            {use.object.id} —{" "}
                            {use.kind === "explicit"
                              ? "Explicit reference"
                              : "Included in this built release"}
                          </p>
                          <p className="break-words text-xs text-text-2">
                            {use.path} · defined in {use.defined_in.ref} ({use.defined_in.release})
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2">
                      This release pins a source version, but no static use of the removed objects
                      was found. This does not prove it is never used at runtime.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>No readable published releases were found on this page.</p>
          )}
          <p className="text-xs text-text-2">
            “Included” means retained in the built artifact, not necessarily selected for a model
            request.
          </p>
        </>
      ) : (
        <p>
          No stable object IDs were removed. Renaming a title keeps the same object; changing an ID
          removes its previous address.
        </p>
      )}
      {error ? <p role="alert">{error}</p> : null}
      {pages.at(-1)?.next_cursor ? (
        <Button type="button" variant="outline" disabled={loading} onClick={onMore}>
          {loading ? "Loading references…" : "Load more references"}
        </Button>
      ) : null}
    </section>
  );
}
