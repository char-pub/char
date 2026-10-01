import { checkStory, type Story } from "@char-pub/core";
import { expect, it } from "vitest";
import type { Working } from "./draft";
import {
  bootstrapGreetingAnchor,
  describeEditorSubject,
  editorLocation,
  sourceObjectAnchor,
  storyConditionAnchor,
  storyFieldAnchor,
  storyObjectAnchor,
} from "./editor-location";

const story: Story = {
  version: 1,
  scenes: [{ id: "hall", title: "Hall", when: { all: [{ cmp: ["var/count", ">", 2] }] } }],
  starts: [{ id: "visitor", greeting: "Hello" }],
  vars: { count: { type: "int", init: 0, min: 0, max: 1, description: "Count" } },
  plotlines: [{ id: "truth", title: "Truth", scenes: ["hall"] }],
  timelines: [{ id: "past", title: "Past", order: ["scene/hall"] }],
};
const w: Working = {
  story,
  fragments: [
    { id: "0", kind: "knowledge", stable: true, content: { type: "text", text: "Fact" } },
    { id: "lore/door", kind: "knowledge", stable: true, content: { type: "text", text: "Door" } },
  ],
  groups: [{ id: "rooms", title: "Rooms", entries: ["lore/door"] }],
  sources: [{ id: "guide", sections: [{ id: "intro" }] }],
  bootstrap: {
    greetings: [
      { id: "default", text: "Hi" },
      { id: "other", text: "Other" },
    ],
  },
};

it("locates a real nested Core warning without changing author input", () => {
  const original = structuredClone(w);
  const warning = checkStory(story, []).find((d) => d.code === "story.condition_constant");
  expect(warning).toBeDefined();
  if (!warning) throw new Error("Expected condition warning");
  expect(editorLocation(w, warning.subject)).toEqual({
    anchor: storyConditionAnchor("scenes", "hall", "/when/all/0"),
    storyView: "scenes",
  });
  expect(w).toEqual(original);
});
it("locates only existing nested conditions and uses the current author language for labels", () => {
  expect(editorLocation(w, "story.scenes.0.when.all.0")?.anchor).toBe(
    storyConditionAnchor("scenes", "hall", "/when/all/0"),
  );
  for (const suffix of [
    "/when/all/1",
    "/when/not",
    "/when/all/00",
    "/whenever",
    "/when/all/0/nope",
  ])
    expect(editorLocation(w, `story.scenes[hall]${suffix}`)?.anchor).toBe(
      storyObjectAnchor("scenes", "hall"),
    );
  const localized: Working = {
    ...w,
    meta: { default_locale: "zh", rating: "general", rights: "original", license: "CC0-1.0" },
    story: { ...story, scenes: [{ ...story.scenes[0], title: { en: "Hall", zh: "大厅" } }] },
  };
  expect(describeEditorSubject(localized, "story.scenes[hall]/when/all/0")).toEqual({
    objectLabel: "Scene “大厅” (hall)",
    path: "/when/all/0",
  });
  expect(describeEditorSubject(localized, "story.scenes[missing]/when")).toBeNull();
  expect(
    describeEditorSubject(
      { ...w, story: { scenes: [story.scenes[0], story.scenes[0]] } },
      "story.scenes[hall]/when",
    ),
  ).toBeNull();
});
it("locates specific opening fields and matching Story tabs", () => {
  expect(editorLocation(w, "story.starts[visitor].greeting.en")).toEqual({
    anchor: storyFieldAnchor("starts", "visitor", "greeting"),
    storyView: "scenes",
  });
  expect(editorLocation(w, "story.scenes[hall].opening")).toEqual({
    anchor: storyFieldAnchor("scenes", "hall", "opening"),
    storyView: "scenes",
  });
  expect(editorLocation(w, "story.plotlines[truth].scenes")).toEqual({
    anchor: storyObjectAnchor("plotlines", "truth"),
    storyView: "plotlines",
  });
  expect(editorLocation(w, "story.timelines[past].order")).toEqual({
    anchor: storyObjectAnchor("timelines", "past"),
    storyView: "timelines",
  });
});
it("reveals exact fragments across groups and keeps numeric IDs distinct from indices", () => {
  expect(editorLocation(w, "fragments[lore/door].content")?.contentSelection).toBe("all");
  expect(editorLocation(w, "fragments[0].content")?.anchor).toBe("edit-fragment-0");
  expect(editorLocation(w, "fragments.1.content")?.anchor).toBe("edit-fragment-lore%2Fdoor");
  expect(editorLocation(w, "groups[rooms].entries")?.contentSelection).toBe("group:rooms");
});
it("falls back for absent or duplicate IDs and never guesses a different object", () => {
  const fragment = w.fragments?.[0];
  if (!fragment) throw new Error("fragment");
  expect(editorLocation(w, "story.scenes[missing].opening")?.anchor).toBe("edit-story");
  expect(
    editorLocation({ ...w, fragments: [fragment, fragment] }, "fragments[0].content")?.anchor,
  ).toBe("edit-passages");
  expect(editorLocation(w, "storyboard.scenes[hall]")).toBeNull();
});
it("addresses sources, sections and all editable bootstrap greetings", () => {
  expect(editorLocation(w, "sources[guide].sections[intro].anchor")?.anchor).toBe(
    sourceObjectAnchor("guide", "intro"),
  );
  expect(editorLocation(w, "bootstrap.greetings[default].text")?.anchor).toBe(
    bootstrapGreetingAnchor("default"),
  );
  expect(editorLocation(w, "bootstrap.greetings[other].text")?.anchor).toBe(
    bootstrapGreetingAnchor("other"),
  );
  expect(editorLocation(w, "bootstrap.greetings.0.text")?.anchor).toBe(
    bootstrapGreetingAnchor("default"),
  );
});
it("does not parse partial Working through canonicalization or traverse prototype keys", () => {
  expect(
    editorLocation({ story: { vars: { constructor: {} } } }, "story.vars.constructor.init")?.anchor,
  ).toBe(storyObjectAnchor("vars", "constructor"));
  expect(editorLocation({ story: null }, "story.scenes.0.opening")?.anchor).toBe("edit-story");
});
