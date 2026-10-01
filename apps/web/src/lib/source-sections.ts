/** Local Source authoring checks share Core's exact heading and excerpt parser. */
import {
  extractSourceSections,
  type KnowledgeSource,
  listSourceHeadings,
  MAX_SOURCE_BYTES,
  sha256Bytes,
} from "@char-pub/core";
import { nextId, type Working } from "./draft";

type Section = NonNullable<KnowledgeSource["sections"]>[number];
export function sourceDocumentIdentity(w: Working, source: KnowledgeSource): string {
  const asset = w.assets?.find((asset) => asset.slot === source.asset);
  const variant = asset?.variants.find((variant) => variant.id === "default");
  return JSON.stringify([
    w.id ?? w.ref,
    source.id,
    source.asset,
    source.format,
    asset?.role,
    variant?.blob.availability,
    variant?.blob.digest,
    variant?.blob.size,
    variant?.media_type,
  ]);
}
export function validateSourceDocument(source: KnowledgeSource, body: string): void {
  extractSourceSections(
    { id: source.id, format: source.format, sections: source.sections ?? [] },
    body,
  );
}
/** Decode original bytes without dropping a BOM, so matching the uploaded digest is exact. */
export function decodeSourceDocument(bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_SOURCE_BYTES)
    throw new Error("Reference documents can be at most 8 MiB.");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error("Save this document as UTF-8 text and try again.");
  }
  if (text.includes("\u0000")) throw new Error("Choose a text document without binary data.");
  return text;
}
/** The author supplies this file; no private asset is fetched from a digest. */
export function verifiedSourceDocument(
  w: Working,
  source: KnowledgeSource,
  bytes: Uint8Array,
): string {
  const asset = w.assets?.find((asset) => asset.slot === source.asset);
  const variant = asset?.variants.find((variant) => variant.id === "default");
  if (!variant || asset?.role !== "context" || variant.blob.availability !== "mirrored")
    throw new Error("This document needs a mirrored context asset before checking a local file.");
  if (
    source.format === "markdown"
      ? !["text/markdown", "text/plain"].includes(variant.media_type)
      : variant.media_type !== "text/plain"
  )
    throw new Error("The asset media type does not match this document format.");
  const text = decodeSourceDocument(bytes);
  if (sha256Bytes(bytes) !== variant.blob.digest || bytes.byteLength !== variant.blob.size)
    throw new Error(
      "This file does not match the document's current asset. Choose the original file, or replace the document first.",
    );
  return text;
}

export function proposedSourceSections(source: KnowledgeSource, body: string): Section[] {
  if (source.format !== "markdown")
    throw new Error(
      "Heading generation is available for Markdown documents. Use line ranges for plain text.",
    );
  const headings = listSourceHeadings(body);
  if (new Set(headings.map((heading) => heading.anchor)).size !== headings.length)
    throw new Error(
      "Repeated headings have ambiguous anchors. Edit the document to use unique headings before generating sections.",
    );
  if (headings.some((heading) => !heading.text.trim()))
    throw new Error("Give every heading a title before generating sections.");
  const existing = source.sections ?? [];
  const ids = existing.map((section) => section.id);
  const sections: Section[] = [];
  for (const heading of headings) {
    if (existing.some((section) => section.anchor.normalize("NFC") === heading.anchor)) continue;
    const stem =
      heading.text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48)
        .replace(/-$/g, "") || "section";
    const id = nextId(ids, stem);
    ids.push(id);
    sections.push({ id, title: heading.text, anchor: heading.anchor });
  }
  return sections;
}
