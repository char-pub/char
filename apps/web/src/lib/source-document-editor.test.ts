import type { AssetSlot, KnowledgeSource } from "@char-pub/core";
import { expect, it } from "vitest";
import type { Working } from "./draft";
import { replaceDocument, undoDocumentReplacement } from "./source-document-editor";

const asset: AssetSlot = {
  slot: "book",
  role: "context",
  variants: [
    {
      id: "default",
      media_type: "text/markdown",
      blob: { availability: "mirrored", digest: `sha256:${"a".repeat(64)}`, size: 10 },
    },
  ],
};
const source: KnowledgeSource = {
  id: "guide",
  title: "Guide",
  description: "A guide",
  asset: "book",
  format: "markdown",
  sections: [{ id: "door", title: "Door", anchor: "#Door" }],
};
const blob = {
  format: "markdown" as const,
  media_type: "text/markdown",
  digest: `sha256:${"b".repeat(64)}` as const,
  size: 20,
};
const w: Working = { sources: [source], assets: [asset] };
it("replaces only one source and removes exclusively used asset declarations, with reversible identity", () => {
  const r = replaceDocument({ ...w, summary: "other edit" }, source, asset, blob);
  expect(r.working.assets).toHaveLength(1);
  expect(r.working.sources).toEqual([{ ...source, asset: r.receipt.newAsset.slot }]);
  const restored = undoDocumentReplacement({ ...r.working, summary: "later edit" }, r.receipt);
  expect(restored.sources).toEqual([source]);
  expect(restored.assets).toEqual([asset]);
  expect(restored.summary).toBe("later edit");
});
it("keeps shared assets and refuses changed files or sections instead of overwriting", () => {
  const r = replaceDocument(
    { ...w, sources: [source, { ...source, id: "another" }] },
    source,
    asset,
    blob,
  );
  expect(r.working.assets).toHaveLength(2);
  expect(() => replaceDocument({ ...w, assets: [] }, source, asset, blob)).toThrow(
    /changed or was removed/,
  );
  expect(() =>
    undoDocumentReplacement(
      { ...r.working, sources: [{ ...source, asset: r.receipt.newAsset.slot, sections: [] }] },
      r.receipt,
    ),
  ).toThrow(/sections changed/);
});
it("keeps explicit license, rating and localized alt when replacing bytes", () => {
  const variant = asset.variants[0];
  if (!variant) throw new Error("missing variant");
  const attributed = {
    ...asset,
    variants: [
      {
        ...variant,
        license: "CC-BY-4.0",
        rating: "mature" as const,
        alt: { en: "Plans", ja: "地図" },
        blob: {
          ...variant.blob,
          locator: { provider: "http" as const, url: "https://example.com/old.txt" },
        },
      },
    ],
  };
  const r = replaceDocument({ ...w, assets: [attributed] }, source, attributed, blob);
  expect(r.receipt.newAsset.variants[0]).toMatchObject({
    license: "CC-BY-4.0",
    rating: "mature",
    alt: { en: "Plans", ja: "地図" },
    blob: { digest: blob.digest },
  });
  expect(r.receipt.newAsset.variants[0]?.blob).not.toHaveProperty("locator");
});
