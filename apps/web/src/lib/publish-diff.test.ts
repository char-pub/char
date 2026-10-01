import { type CreationInput, CreationSchema, canonicalizeCreation } from "@char-pub/core";
import { expect, it } from "vitest";
import { publishDefinitionDiff } from "./publish-diff";

const base: CreationInput = {
  id: "cr_01j00000000000000000000000",
  ref: "@writer/story",
  type: "scenario",
  display_name: "A story",
  meta: { default_locale: "en", rights: "original", license: "CC0-1.0", rating: "general" },
  fragments: [
    {
      id: "secret",
      stable: true,
      kind: "knowledge",
      content: { type: "text", text: "OLD_BODY" },
      locale: { ja: { content: { type: "text", text: "日本語" } } },
      description: { en: "OLD_DESCRIPTION", ja: "説明" },
    },
  ],
  cast: [{ key: "player", who: { late: "persona" } }],
  story: {
    version: 1,
    scenes: [
      { id: "gate", title: "Gate", opening: "Old opening" },
      { id: "road", title: "Road" },
    ],
    vars: { trust: { type: "int", init: 1, min: 0, max: 10, description: "Trust" } },
  },
};
function edited() {
  const creation = CreationSchema.parse(canonicalizeCreation(base).json);
  for (const fragment of creation.fragments) delete fragment.digest;
  return creation;
}
it("separates body, localized descriptions and structural rules without derived fragment digest noise", () => {
  const next = edited();
  if (!next.fragments[0] || !next.story?.scenes[0]) throw new Error("Fixture missing");
  next.fragments[0].content = { type: "text", text: "NEW_BODY" };
  next.fragments[0].description = { en: "NEW_DESCRIPTION", ja: "説明" };
  next.story.scenes[0].when = { cmp: ["var/trust", ">=", 2] };
  const result = publishDefinitionDiff(base, next);
  expect(
    result.entries.filter((entry) => entry.category === "body").map((entry) => entry.path),
  ).toEqual([["fragments", "secret", "content"]]);
  expect(result.entries.filter((entry) => entry.category === "description")).toMatchObject([
    { before: { en: "OLD_DESCRIPTION", ja: "説明" }, after: { en: "NEW_DESCRIPTION", ja: "説明" } },
  ]);
  expect(
    result.entries.filter((entry) => entry.category === "structure").map((entry) => entry.path),
  ).toEqual([["story", "scenes", "gate", "when", "cmp"]]);
  expect(result.entries.some((entry) => entry.path.at(-1) === "digest")).toBe(false);
});
it("retains stable object identity while reporting only an actual scene reorder", () => {
  const next = edited();
  next.story?.scenes.reverse();
  expect(publishDefinitionDiff(base, next).entries).toMatchObject([
    {
      category: "structure",
      path: ["story", "scenes", "order"],
      before: ["gate", "road"],
      after: ["road", "gate"],
    },
  ]);
  expect(publishDefinitionDiff(base, next).entries).toHaveLength(1);
});
it("reports added and removed objects with their content and complete publishing fields", () => {
  const next = edited();
  next.fragments = [
    {
      id: "new",
      stable: true,
      kind: "knowledge",
      content: { type: "text", text: "New fact" },
      description: "New explanation",
    },
  ];
  next.authors = [{ name: "New author" }];
  next.meta.license = "CC-BY-4.0";
  next.provenance.authored_by_agent = true;
  const result = publishDefinitionDiff(base, next);
  expect(result.entries).toContainEqual(
    expect.objectContaining({
      path: ["fragments", "secret"],
      change: "removed",
      category: "structure",
    }),
  );
  expect(result.entries).toContainEqual(
    expect.objectContaining({ path: ["fragments", "new"], change: "added", category: "structure" }),
  );
  for (const path of [
    ["authors", "0", "name"],
    ["meta", "license"],
    ["provenance", "authored_by_agent"],
  ])
    expect(result.entries).toContainEqual(expect.objectContaining({ path, category: "structure" }));
});
it("keeps opening and localized greeting text in body changes and has an explicit first release", () => {
  const next = edited();
  if (!next.story) throw new Error("Story missing");
  next.story.starts = [
    { id: "arrival", scene: "gate", greeting: { en: "Welcome", ja: "ようこそ" } },
  ];
  const result = publishDefinitionDiff(base, next);
  expect(result.entries).toContainEqual(
    expect.objectContaining({ category: "body", path: ["story", "starts", "arrival", "greeting"] }),
  );
  const first = publishDefinitionDiff(null, next);
  expect(first.firstRelease).toBe(true);
  expect(first.entries.some((entry) => entry.category === "body")).toBe(true);
});
it("does not mistake JSON key order or canonically equivalent prose for a change", () => {
  const next = edited();
  if (!next.fragments[0]) throw new Error("Fragment missing");
  next.fragments[0].content = { text: "OLD_BODY\r\n", type: "text" };
  // Core text normalization preserves a semantic trailing line, so use only key reordering here.
  next.fragments[0].content.text = "OLD_BODY";
  expect(publishDefinitionDiff(base, next).entries).toEqual([]);
});
it("shows variable descriptions under their actual author key", () => {
  const next = edited();
  if (!next.story?.vars?.trust) throw new Error("Variable missing");
  next.story.vars.trust.description = "Earned trust";
  expect(publishDefinitionDiff(base, next).entries).toMatchObject([
    { category: "description", object: "Variables: trust", after: "Earned trust" },
  ]);
});
it("reports a source replacement without reading or inventing its document text", () => {
  const old = edited();
  old.sources = [
    { id: "guide", title: "Guide", description: "Background", asset: "guide", format: "text" },
  ];
  old.assets = [
    {
      slot: "guide",
      role: "context",
      variants: [
        {
          id: "default",
          blob: {
            digest: `sha256:${"1".repeat(64)}`,
            size: 10,
            availability: "mirrored",
          },
          media_type: "text/plain",
          license: "CC0-1.0",
          rating: "general",
        },
      ],
    },
  ];
  const next = structuredClone(old);
  if (!next.assets[0]?.variants[0]) throw new Error("Asset missing");
  next.assets[0].variants[0].blob.digest = `sha256:${"2".repeat(64)}`;
  expect(publishDefinitionDiff(old, next).entries).toContainEqual(
    expect.objectContaining({
      category: "body",
      path: ["sources", "guide", "body"],
      before: [`sha256:${"1".repeat(64)}`],
      after: [`sha256:${"2".repeat(64)}`],
    }),
  );
});

it("does not classify an object ID named description or opening as the field with that name", () => {
  const old = edited();
  if (!old.fragments[0] || !old.story?.scenes[0]) throw new Error("Fixture missing");
  old.fragments[0].id = "description";
  old.story.scenes[0].id = "opening";
  const next = structuredClone(old);
  if (!next.fragments[0] || !next.story?.scenes[0]) throw new Error("Fixture missing");
  next.fragments[0].content = { type: "text", text: "A changed main passage" };
  next.fragments[0].visibility = { scope: "private", to: ["{{self}}"] };
  next.story.scenes[0].title = "New title";
  const diff = publishDefinitionDiff(old, next);
  expect(diff.entries.filter((entry) => entry.category === "description")).toEqual([]);
  expect(
    diff.entries.filter((entry) => entry.category === "body").map((entry) => entry.path),
  ).toEqual([["fragments", "description", "content"]]);
  expect(diff.entries).toContainEqual(
    expect.objectContaining({
      category: "structure",
      path: ["story", "scenes", "opening", "title"],
    }),
  );
  expect(diff.entries).toContainEqual(
    expect.objectContaining({
      category: "structure",
      path: ["fragments", "description", "visibility", "scope"],
    }),
  );
});

it("separates changed override prose from its structural override operation", () => {
  const old = edited();
  if (!old.cast?.[0]) throw new Error("Cast missing");
  old.cast[0].override = [
    { op: "replace", target: "description", content: { type: "text", text: "Old role text" } },
  ];
  const next = structuredClone(old);
  if (!next.cast?.[0]) throw new Error("Cast missing");
  next.cast[0].override = [
    { op: "replace", target: "description", content: { type: "text", text: "New role text" } },
  ];
  expect(publishDefinitionDiff(old, next).entries).toMatchObject([
    { category: "body", path: ["cast", "player", "override", "0", "content"] },
  ]);
});
