import { type KnowledgeSource, sha256Bytes } from "@char-pub/core";
import { expect, it } from "vitest";
import type { Working } from "./draft";
import {
  decodeSourceDocument,
  proposedSourceSections,
  validateSourceDocument,
  verifiedSourceDocument,
} from "./source-sections";

it("verifies original UTF-8/BOM/CRLF bytes before parsing and rejects mismatching assets", () => {
  const raw = "\uFEFF# Intro\r\nBody";
  const bytes = new TextEncoder().encode(raw);
  const source: KnowledgeSource = {
    id: "book",
    title: "Book",
    description: "Guide",
    format: "markdown",
    asset: "book",
  };
  const w: Working = {
    assets: [
      {
        slot: "book",
        role: "context",
        variants: [
          {
            id: "default",
            media_type: "text/markdown",
            blob: { availability: "mirrored", size: bytes.length, digest: sha256Bytes(bytes) },
          },
        ],
      },
    ],
  };
  expect(verifiedSourceDocument(w, source, bytes)).toBe(raw);
  expect(() =>
    verifiedSourceDocument(w, source, new TextEncoder().encode(raw.replace(/\r/g, ""))),
  ).toThrow("does not match");
  expect(() => decodeSourceDocument(new Uint8Array([0xff]))).toThrow("UTF-8");
});
it("appends only new unique headings while preserving existing translated section metadata", () => {
  const source: KnowledgeSource = {
    id: "book",
    title: "Book",
    description: "Guide",
    format: "markdown",
    asset: "book",
    sections: [
      {
        id: "intro",
        title: { en: "Custom title", ja: "序章" },
        description: { en: "Custom", ja: "説明" },
        anchor: "#Intro",
      },
    ],
  };
  const before = JSON.stringify(source);
  expect(proposedSourceSections(source, "# Intro\n# Next\n## Detail")).toEqual([
    { id: "next", title: "Next", anchor: "#Next" },
    { id: "detail", title: "Detail", anchor: "#Detail" },
  ]);
  expect(JSON.stringify(source)).toBe(before);
  expect(() => proposedSourceSections(source, "# Same\n# Same")).toThrow("Repeated headings");
  expect(() => proposedSourceSections(source, "# Café\n# Cafe\u0301")).toThrow("Repeated headings");
  expect(() => validateSourceDocument(source, "# Other")).toThrow("source.anchor_missing");
});
