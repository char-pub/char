import { utf8ToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import { sha256Bytes } from "../src/canonical.js";
import type { CatalogIndex } from "../src/schema/catalog.js";
import type { IRAsset } from "../src/schema/ir.js";
import { materializeSourceText } from "../src/source-text.js";
import { tid } from "./fixtures.js";

function fixture(text: string, format: "text" | "markdown", anchor: string) {
  const source: CatalogIndex["sources"][number] = {
    id: "book",
    owner: "root",
    local_id: "book",
    title: "Book",
    description: "Guide",
    shared: true,
    asset: "asset",
    format,
    sections: [{ id: "intro", title: "Intro", anchor }],
  };
  const asset: IRAsset = {
    id: "asset",
    role: "context",
    media_type: format === "text" ? "text/plain" : "text/markdown",
    digest: sha256Bytes(utf8ToBytes(text)),
    availability: "mirrored",
    access: "public",
    rating: "general",
    license: "CC-BY-4.0",
    origin: {
      creation: "@djj/book",
      release: tid("rel", 71),
      slot: "book",
      variant: "default",
      instance_key: "root",
    },
  };
  return { source, asset };
}

describe("immutable source excerpts", () => {
  it("verifies the BOM as original bytes but excludes it from heading parsing", () => {
    const text = "\uFEFF# Intro\r\n正文";
    const { source, asset } = fixture(text, "markdown", "#Intro");
    expect(materializeSourceText(source, asset, text).sections.intro).toBe("# Intro\n正文");
    expect(() => materializeSourceText(source, asset, text.slice(1))).toThrowError(
      expect.objectContaining({ code: "source.asset_mismatch" }),
    );
  });
  it("verifies the original UTF-8 bytes before normalizing line endings", () => {
    const text = "一\r\n二\r\n三";
    const { source, asset } = fixture(text, "text", "L2-L3");
    expect(materializeSourceText(source, asset, text).sections.intro).toBe("二\n三");
    expect(() => materializeSourceText(source, asset, text.replace(/\r/g, ""))).toThrowError(
      expect.objectContaining({ code: "source.asset_mismatch" }),
    );
  });
  it("matches canonical Unicode headings while preserving the referenced body", () => {
    const text = "# Cafe\u0301\nBody";
    const { source, asset } = fixture(text, "markdown", "#Café");
    expect(materializeSourceText(source, asset, text).sections.intro).toBe(text);
    expect(() =>
      materializeSourceText(source, { ...asset, media_type: "image/png" }, text),
    ).toThrowError(expect.objectContaining({ code: "source.media_type_mismatch" }));
  });
  it("keeps nested headings with their parent and ignores headings inside fences", () => {
    const text = "# Intro\nFirst\n```md\n# Intro\n```\n## Detail\nNested\n# Next\nLast";
    const { source, asset } = fixture(text, "markdown", "#Intro");
    const result = materializeSourceText(source, asset, text);
    expect(result.sections.intro).toContain("Nested");
    expect(result.sections.intro).not.toContain("Last");
  });
  it("rejects absent or ambiguous anchors instead of silently returning another section", () => {
    const text = "# Intro\nA\n# Intro\nB";
    const { source, asset } = fixture(text, "markdown", "#Intro");
    expect(() => materializeSourceText(source, asset, text)).toThrowError(
      expect.objectContaining({ code: "source.anchor_ambiguous" }),
    );
    const plain = fixture("one\ntwo", "text", "L2-L9");
    expect(() => materializeSourceText(plain.source, plain.asset, "one\ntwo")).toThrowError(
      expect.objectContaining({ code: "source.anchor_missing" }),
    );
  });
});

describe("public authored Source analysis", () => {
  it("lists exactly the headings used by materialization, with normalized anchors and original line positions", async () => {
    const { listSourceHeadings, extractSourceSections } = await import("../src/source-text.js");
    const text =
      "\uFEFF# Cafe\u0301\r\nBody\r\n```md\r\n# Hidden\r\n```\r\nUnderlined\r\n---\r\nEnd";
    expect(listSourceHeadings(text)).toEqual([
      { text: "Cafe\u0301", anchor: "#Café", level: 1, line: 0 },
      { text: "Underlined", anchor: "#Underlined", level: 2, line: 5 },
    ]);
    const { source, asset } = fixture(text, "markdown", "#Café");
    expect(extractSourceSections(source, text)).toEqual(materializeSourceText(source, asset, text));
  });
  it("keeps duplicate headings visible so authors cannot generate ambiguous sections", async () => {
    const { listSourceHeadings, extractSourceSections } = await import("../src/source-text.js");
    const text = "# Same\nFirst\n# Same\nSecond";
    expect(listSourceHeadings(text).map((heading) => heading.anchor)).toEqual(["#Same", "#Same"]);
    expect(() =>
      extractSourceSections(fixture(text, "markdown", "#Same").source, text),
    ).toThrowError(expect.objectContaining({ code: "source.anchor_ambiguous" }));
  });
  it("validates plain-text ranges and binary bounds without pretending to authorize an asset", async () => {
    const { extractSourceSections } = await import("../src/source-text.js");
    const { source } = fixture("one\r\ntwo", "text", "L2-L2");
    expect(extractSourceSections(source, "one\r\ntwo").sections.intro).toBe("two");
    expect(() => extractSourceSections(source, "one")).toThrowError(
      expect.objectContaining({ code: "source.anchor_missing" }),
    );
    expect(() => extractSourceSections(source, "one\u0000")).toThrowError(
      expect.objectContaining({ code: "source.binary_content" }),
    );
  });
});
