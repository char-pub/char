import type { AssetSlot, KnowledgeSource } from "@char-pub/core";
import { type BlobInfo, nextId, type Working } from "./draft";
export const documentsOf = (w: Working): KnowledgeSource[] =>
  Array.isArray(w.sources) ? (w.sources as KnowledgeSource[]) : [];
export function sourceAssetUsed(w: Working, slot: string, remaining = documentsOf(w)): boolean {
  const matches = (ref: string) => ref === `#asset/${slot}` || ref.startsWith(`#asset/${slot}/`);
  return (
    remaining.some((s) => s.asset === slot) ||
    (w.fragments ?? []).some(
      (f) =>
        (f.asset_refs ?? []).some(matches) ||
        (f.content.type === "media" && matches(f.content.asset)) ||
        Object.values(f.locale ?? {}).some(
          (v) => v.content.type === "media" && matches(v.content.asset),
        ),
    )
  );
}
export interface DocumentReplacement {
  source: KnowledgeSource;
  oldAsset: AssetSlot;
  newAsset: AssetSlot;
  format: KnowledgeSource["format"];
}
export function replaceDocument(
  w: Working,
  source: KnowledgeSource,
  oldAsset: AssetSlot,
  blob: BlobInfo & { format: KnowledgeSource["format"] },
): { working: Working; receipt: DocumentReplacement } {
  const current = documentsOf(w).find((s) => s.id === source.id);
  if (
    !current ||
    current.asset !== source.asset ||
    current.format !== source.format ||
    JSON.stringify(w.assets?.find((a) => a.slot === source.asset)) !== JSON.stringify(oldAsset)
  )
    throw new Error("This document’s file changed or was removed. Select the replacement again.");
  const slot = nextId(
    (w.assets ?? []).map((a) => a.slot),
    `source-${source.id}`.slice(0, 56),
  );
  const newAsset: AssetSlot = {
    slot,
    role: "context",
    variants: oldAsset.variants.map((variant) =>
      variant.id === "default"
        ? {
            ...variant,
            media_type: blob.media_type,
            blob: { digest: blob.digest, size: blob.size, availability: "mirrored" },
          }
        : variant,
    ),
  };
  const sources = documentsOf(w).map((s) =>
    s.id === source.id ? { ...s, asset: slot, format: blob.format } : s,
  );
  const next = { ...w, sources, assets: [...(w.assets ?? []), newAsset] };
  if (!sourceAssetUsed(next, oldAsset.slot))
    next.assets = next.assets.filter((a) => a.slot !== oldAsset.slot);
  return { working: next, receipt: { source: current, oldAsset, newAsset, format: blob.format } };
}
export function undoDocumentReplacement(w: Working, r: DocumentReplacement): Working {
  const current = documentsOf(w).find((s) => s.id === r.source.id);
  if (
    !current ||
    current.asset !== r.newAsset.slot ||
    current.format !== r.format ||
    JSON.stringify(current.sections) !== JSON.stringify(r.source.sections) ||
    JSON.stringify(w.assets?.find((a) => a.slot === r.newAsset.slot)) !== JSON.stringify(r.newAsset)
  )
    throw new Error(
      "The document file or sections changed after replacement. Restore those changes before undoing.",
    );
  const old = w.assets?.find((a) => a.slot === r.oldAsset.slot);
  if (old && JSON.stringify(old) !== JSON.stringify(r.oldAsset))
    throw new Error("The previous file slot is now in use. Undo cannot overwrite it.");
  const sources = documentsOf(w).map((s) =>
    s.id === current.id ? { ...s, asset: r.source.asset, format: r.source.format } : s,
  );
  const next = {
    ...w,
    sources,
    assets: old ? [...(w.assets ?? [])] : [...(w.assets ?? []), r.oldAsset],
  };
  if (!sourceAssetUsed(next, r.newAsset.slot))
    next.assets = next.assets.filter((a) => a.slot !== r.newAsset.slot);
  return next;
}
