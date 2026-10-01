import { utf8ToBytes } from "@noble/hashes/utils.js";
import { sha256Bytes } from "./canonical.js";
import { CharError } from "./errors.js";
import type { CatalogIndex } from "./schema/catalog.js";
import type { IRAsset } from "./schema/ir.js";

/** Same bound applies to upload, publication, and local materialization. */
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export interface SourceText {
  source: string;
  body: string;
  sections: Record<string, string>;
}

export interface SourceHeading {
  text: string;
  level: number;
  /** Zero-based line in the BOM-stripped, LF-normalized text. */
  line: number;
  /** Exact NFC heading anchor; duplicate values are ambiguous, not numbered slugs. */
  anchor: string;
}
const normalizedSource = (text: string) => text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

/** List Markdown headings using the same parser as excerpt materialization; this grants no asset access. */
export function listSourceHeadings(text: string): SourceHeading[] {
  return sourceHeadings(normalizedSource(text).split("\n"));
}
function sourceHeadings(lines: string[]): SourceHeading[] {
  const headings: Omit<SourceHeading, "anchor">[] = [];
  let fence: { marker: string; length: number } | undefined;
  for (let line = 0; line < lines.length; line++) {
    const value = lines[line] ?? "";
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(value);
    if (marker) {
      const run = marker[1] ?? "";
      if (!fence) fence = { marker: run[0] ?? "", length: run.length };
      else if (run[0] === fence.marker && run.length >= fence.length && !marker[2]?.trim())
        fence = undefined;
      continue;
    }
    if (fence) continue;
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)/.exec(value);
    if (atx)
      headings.push({
        text: (atx[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim(),
        level: atx[1]?.length ?? 1,
        line,
      });
    else if (line > 0 && /^ {0,3}(?:=+|-+)[ \t]*$/.test(value)) {
      const title = lines[line - 1]?.trim();
      if (title && !/^ {4}/.test(lines[line - 1] ?? ""))
        headings.push({ text: title, level: value.trim().startsWith("=") ? 1 : 2, line: line - 1 });
    }
  }
  return headings.map((heading) => ({ ...heading, anchor: `#${heading.text}`.normalize("NFC") }));
}

/** Verify caller-loaded UTF-8 text against the published asset before exposing any excerpt. */
export function materializeSourceText(
  source: CatalogIndex["sources"][number],
  asset: IRAsset,
  text: string,
): SourceText {
  const mediaTypes =
    source.format === "markdown" ? ["text/markdown", "text/plain"] : ["text/plain"];
  if (!mediaTypes.includes(asset.media_type))
    throw new CharError({ code: "source.media_type_mismatch", subject: source.id });
  const bytes = checkedSourceBytes(text, source.id);
  if (asset.id !== source.asset || asset.role !== "context" || sha256Bytes(bytes) !== asset.digest)
    throw new CharError({ code: "source.asset_mismatch", subject: source.id });
  return sourceSections(source, text);
}

type SourceDescriptor = Pick<CatalogIndex["sources"][number], "id" | "format" | "sections">;

/** Validate/extract authored anchors from supplied text; callers separately verify asset identity and access. */
export function extractSourceSections(source: SourceDescriptor, text: string): SourceText {
  checkedSourceBytes(text, source.id);
  return sourceSections(source, text);
}
function checkedSourceBytes(text: string, subject: string) {
  const bytes = utf8ToBytes(text);
  if (bytes.byteLength > MAX_SOURCE_BYTES)
    throw new CharError({ code: "source.too_large", subject });
  if (text.includes("\u0000")) throw new CharError({ code: "source.binary_content", subject });
  return bytes;
}
function sourceSections(source: SourceDescriptor, text: string): SourceText {
  const body = normalizedSource(text);
  const lines = body.split("\n");
  const headings = sourceHeadings(lines);
  const sections: Record<string, string> = {};
  for (const section of source.sections) {
    if (source.format === "text") {
      const match = /^L([1-9][0-9]*)-L([1-9][0-9]*)$/.exec(section.anchor);
      const start = Number(match?.[1]);
      const end = Number(match?.[2]);
      if (!match || !Number.isSafeInteger(end) || start > end || end > lines.length)
        throw new CharError({
          code: "source.anchor_missing",
          subject: `${source.id}/${section.id}`,
        });
      sections[section.id] = lines.slice(start - 1, end).join("\n");
    } else {
      const matches = headings.filter((h) => h.anchor === section.anchor.normalize("NFC"));
      const heading = matches[0];
      if (matches.length !== 1 || !heading)
        throw new CharError({
          code: matches.length ? "source.anchor_ambiguous" : "source.anchor_missing",
          subject: `${source.id}/${section.id}`,
        });
      const end =
        headings.find((h) => h.line > heading.line && h.level <= heading.level)?.line ??
        lines.length;
      sections[section.id] = lines.slice(heading.line, end).join("\n");
    }
  }
  return { source: source.id, body, sections };
}
