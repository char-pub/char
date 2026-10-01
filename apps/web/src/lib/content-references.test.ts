import { expect, it } from "vitest";
import { contentReferences, contentRestoreError } from "./content-references";
import type { Working } from "./draft";

const w: Working = {
  ref: "@writer/inn",
  fragments: [
    {
      id: "secret",
      stable: true,
      kind: "knowledge",
      content: { type: "text", text: "#book/door is prose" },
      source: { use: "#source/book/door" },
    },
  ],
  groups: [{ id: "history", title: "History", description: "Past", entries: ["secret"] }],
  sources: [
    {
      id: "book",
      title: "Book",
      description: "Plans",
      asset: "book",
      format: "markdown",
      sections: [{ id: "door", title: "Door", anchor: "#Door" }],
    },
  ],
  story: {
    version: 1,
    scenes: [{ id: "inn", title: "Inn", lore: ["#history", "#source/book/door"] }],
    starts: [{ id: "start", scene: "inn", greeting: "Hi" }],
    knowing: { "#secret": { start: { knows: ["*"] } } },
  },
};
it("protects typed local and public self aliases without treating prose or external references as links", () => {
  expect(contentReferences(w, "fragment", "secret")).toEqual([
    "groups[history].entries",
    "story.knowing.#secret",
  ]);
  expect(contentReferences(w, "group", "history")).toEqual(["story.scenes[inn].lore[0]"]);
  expect(contentReferences(w, "source", "book")).toEqual([
    "fragments[secret].source.use",
    "story.scenes[inn].lore[1]",
  ]);
  expect(contentReferences(w, "section", "book", "door")).toHaveLength(2);
  const fragment = w.fragments?.[0];
  if (!fragment) throw new Error("fixture fragment missing");
  const next = {
    ...w,
    fragments: [
      {
        ...fragment,
        source: { use: "@writer/inn#book/door" },
        about: ["@writer/other#secret"],
      },
    ],
  };
  expect(contentReferences(next, "section", "book", "door")).toHaveLength(2);
  expect(contentReferences(next, "fragment", "secret")).toHaveLength(2);
});
it("protects self fixture selection and section trace without conflating foreign instances", () => {
  const fixture = {
    id: "reading",
    root: "self",
    session: {},
    selection: [{ source: "@writer/inn#source/book~root", section: "door" }],
    source_texts: { "@writer/inn#source/book~root": "#Door" },
    expected: {
      kind: "success",
      trace: [{ source: "source:@writer/inn#source/book~root/section:door" }],
    },
  };
  const next = {
    ...w,
    assembly_tests: [
      fixture,
      { ...fixture, id: "foreign", root: { ref: "@writer/else", release: "rel_x" } },
    ],
  };
  expect(
    contentReferences(next, "section", "book", "door").filter((p) => p.startsWith("assembly")),
  ).toHaveLength(2);
  expect(
    contentReferences(next, "source", "book").filter((p) => p.startsWith("assembly")),
  ).toHaveLength(3);
});
it("refuses restore after an outbound section was removed, without rejecting baseline unfinished prose", () => {
  const before = { ...w, fragments: [], sources: [] };
  expect(contentRestoreError(before, { ...before, fragments: w.fragments ?? [] }, w)).toContain(
    "Restore section book/door",
  );
  expect(contentRestoreError({ ...w, fragments: [] }, { ...w, display_name: "" }, w)).toBeNull();
});
