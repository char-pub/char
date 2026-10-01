import { canonicalizeCreation, checkCreation, type Story, StorySchema } from "@char-pub/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import type { Working } from "@/lib/draft";
import { StoryScenes } from "./story-scenes";

const initial: Working = {
  id: "cr_01j00000000000000000000001",
  ref: "@writer/scene",
  type: "scenario",
  display_name: "Story",
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
  cast: [
    {
      key: "alice",
      who: { late: "character" },
      part: { en: "Host", ja: "主人" },
      goal: "Protect the inn",
    },
    { key: "bob", who: { late: "character" } },
  ],
};
function Harness({ start = initial }: { start?: Working }) {
  const [working, update] = useState(start);
  return (
    <>
      <StoryScenes working={working} update={update} />
      <button
        type="button"
        onClick={() => update((w) => ({ ...w, summary: "Another later edit" }))}
      >
        Edit summary elsewhere
      </button>
      <button
        type="button"
        onClick={() => update((w) => ({ ...w, story: { ...(w.story as Story), beats: [] } }))}
      >
        Remove unused change elsewhere
      </button>
      <button
        type="button"
        onClick={() =>
          update((w) => ({
            ...w,
            story: {
              ...(w.story as Story),
              scenes: (w.story as Story).scenes.filter((scene) => scene.id !== "garden"),
            },
          }))
        }
      >
        Remove unused garden elsewhere
      </button>
      <output data-testid="working">{JSON.stringify(working)}</output>
    </>
  );
}
function current(): Working {
  return JSON.parse(screen.getByTestId("working").textContent ?? "{}");
}
function story(): Story {
  return StorySchema.parse(current().story);
}

it("creates the first scene with stable IDs and lets the author grow a story without editing JSON", async () => {
  render(<Harness />);
  expect(screen.queryByLabelText("Scene scene title")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Add first scene" }));
  expect(story()).toEqual({ version: 1, scenes: [{ id: "scene", title: "First scene" }] });
  await userEvent.clear(screen.getByLabelText("Scene scene title"));
  await userEvent.type(screen.getByLabelText("Scene scene title"), "The inn");
  await userEvent.type(screen.getByLabelText("Time for scene"), "Midnight");
  await userEvent.type(screen.getByLabelText("Place description for scene"), "The lobby");
  await userEvent.type(screen.getByLabelText("Opening situation for scene"), "The lamps go out.");
  await userEvent.click(screen.getByRole("button", { name: "Add scene" }));
  expect(story().scenes[0]).toEqual({
    id: "scene",
    title: "The inn",
    time: "Midnight",
    where: "The lobby",
    opening: "The lamps go out.",
  });
  expect(new Set(story().scenes.map((s) => s.id)).size).toBe(2);
});

it("preserves translations and advanced fields while editing scene prose and global versus scene roles", async () => {
  const advanced: Story = {
    version: 1,
    scenes: [
      {
        id: "inn",
        title: { en: "Inn", ja: "宿" },
        opening: { en: "Rain", ja: "雨" },
        when: { judge: "Enter?" },
        lore: ["#guide"],
        goals: { bob: { en: "Investigate", ja: "調査" } },
      },
    ],
    beats: [
      {
        id: "truth",
        title: "Truth",
        description: "Learn the truth",
        effects: [{ set: ["var/truth", true] }],
      },
    ],
    vars: { truth: { type: "bool", init: false, description: "Truth known" } },
  };
  render(<Harness start={{ ...initial, story: advanced }} />);
  await userEvent.clear(screen.getByLabelText("Scene inn title"));
  await userEvent.type(screen.getByLabelText("Scene inn title"), "Old inn");
  await userEvent.clear(screen.getByLabelText("Opening situation for inn"));
  await userEvent.click(screen.getByText("alice: part and goals"));
  await userEvent.clear(screen.getByLabelText("alice part across the story (inn)"));
  await userEvent.type(screen.getByLabelText("alice part across the story (inn)"), "Owner");
  await userEvent.click(screen.getByText("bob: part and goals"));
  await userEvent.clear(screen.getByLabelText("bob goal in inn"));
  await userEvent.type(screen.getByLabelText("bob goal in inn"), "Ask questions");
  expect(story()).toMatchObject({
    ...advanced,
    scenes: [
      {
        ...advanced.scenes[0],
        title: { en: "Old inn", ja: "宿" },
        opening: { en: "", ja: "雨" },
        goals: { bob: { en: "Ask questions", ja: "調査" } },
      },
    ],
  });
  expect(current().cast).toMatchObject([
    { key: "alice", part: { en: "Owner", ja: "主人" }, goal: "Protect the inn" },
    { key: "bob" },
  ]);
});

it("distinguishes inheriting every cast member from an explicitly empty scene", async () => {
  render(
    <Harness
      start={{ ...initial, story: { version: 1, scenes: [{ id: "inn", title: "Inn" }] } }}
    />,
  );
  const all = screen.getByLabelText("Include all cast, including people added later");
  expect((all as HTMLInputElement).checked).toBe(true);
  await userEvent.click(screen.getByLabelText("alice present in inn"));
  expect(story().scenes[0]?.cast).toEqual(["bob"]);
  expect((all as HTMLInputElement).checked).toBe(false);
  await userEvent.click(screen.getByLabelText("bob present in inn"));
  expect(story().scenes[0]?.cast).toEqual([]);
  expect(screen.getByText("No people are present by default in this scene.")).toBeTruthy();
  await userEvent.click(all);
  expect(story().scenes[0]).not.toHaveProperty("cast");
});

it("blocks referenced scenes and the last scene, and undo keeps unrelated later edits", async () => {
  render(
    <Harness
      start={{
        ...initial,
        story: {
          version: 1,
          scenes: [
            { id: "inn", title: "Inn" },
            { id: "garden", title: "Garden" },
          ],
          starts: [{ id: "arrival", scene: "inn" }],
        },
      }}
    />,
  );
  expect(
    (screen.getByRole("button", { name: "Remove scene inn" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText(/Used by: story.starts\[0\].scene/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Remove scene garden" }));
  expect(
    (screen.getByRole("button", { name: "Remove scene inn" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText("Keep at least one scene.")).toBeTruthy();
  await userEvent.type(screen.getByLabelText("Time for inn"), "Dawn");
  await userEvent.click(screen.getByRole("button", { name: "Edit summary elsewhere" }));
  await userEvent.click(screen.getByRole("button", { name: "Undo removal" }));
  expect(story().scenes).toEqual([
    { id: "inn", title: "Inn", time: "Dawn" },
    { id: "garden", title: "Garden" },
  ]);
  expect(current().summary).toBe("Another later edit");
});

it("edits localized opening templates and bootstrap references without presenting them as resolved messages", async () => {
  render(
    <Harness
      start={{
        ...initial,
        bootstrap: { greetings: [{ id: "welcome", text: "Hello {{user}}." }] },
        story: {
          version: 1,
          scenes: [{ id: "inn", title: "Inn" }],
          starts: [
            {
              id: "arrival",
              title: { en: "Arrival", ja: "到着" },
              greeting: { en: "Welcome {{user}}.", ja: "ようこそ {{user}}。" },
              set: [{ set: ["var/count", 1] }],
              reached: ["ready"],
            },
            { id: "reference", greeting: { ref: "welcome" } },
          ],
        },
      }}
    />,
  );
  await userEvent.clear(screen.getByLabelText("Authored opening template for arrival"));
  await userEvent.type(screen.getByLabelText("Authored opening template for arrival"), "Come in.");
  expect(story().starts?.[0]).toMatchObject({
    greeting: { en: "Come in.", ja: "ようこそ {{user}}。" },
    reached: ["ready"],
    set: [{ set: ["var/count", 1] }],
  });
  expect(screen.getByText("Hello {{user}}.")).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Build a draft preview for resolved opening messages" })
      .getAttribute("href"),
  ).toBe("#edit-draft-preview");
  await userEvent.selectOptions(
    screen.getByLabelText("First message source for arrival"),
    "bootstrap:welcome",
  );
  expect(story().starts?.[0]?.greeting).toEqual({ ref: "welcome" });
  await userEvent.selectOptions(
    screen.getByLabelText("First message source for arrival"),
    "fallback",
  );
  expect(story().starts?.[0]).not.toHaveProperty("greeting");
  expect(screen.getByText(/If none exists, this opening has no first message/)).toBeTruthy();
});

it("removes the last explicit opening as an implicit default and restores only that opening", async () => {
  render(
    <Harness
      start={{
        ...initial,
        story: {
          version: 1,
          scenes: [{ id: "inn", title: "Inn" }],
          starts: [{ id: "arrival", title: "Arrival", greeting: "Hello" }],
        },
      }}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Remove opening arrival" }));
  expect(story()).not.toHaveProperty("starts");
  await userEvent.type(screen.getByLabelText("Place description for inn"), "Riverside");
  await userEvent.click(screen.getByRole("button", { name: "Undo removal" }));
  expect(story().starts).toEqual([{ id: "arrival", title: "Arrival", greeting: "Hello" }]);
  expect(story().scenes[0]?.where).toBe("Riverside");
});

it("preserves missing bootstrap references for repair and blocks opening deletion used by a self fixture", async () => {
  render(
    <Harness
      start={{
        ...initial,
        story: {
          version: 1,
          scenes: [{ id: "inn", title: "Inn" }],
          starts: [{ id: "lost", greeting: { ref: "gone" } }],
        },
        assembly_tests: [
          {
            id: "opening-test",
            root: "self",
            session: { story: { start: "lost" } },
            expected: { kind: "error", code: "example" },
          },
        ],
      }}
    />,
  );
  expect(
    within(screen.getByRole("alert")).getByText(/This bootstrap greeting is missing/),
  ).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Remove opening lost" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(story().starts?.[0]?.greeting).toEqual({ ref: "gone" });
});

it("refuses undo when a newly added scene has reused the removed ID", async () => {
  render(
    <Harness
      start={{
        ...initial,
        story: {
          version: 1,
          scenes: [
            { id: "scene", title: "Keep" },
            { id: "scene-2", title: "Deleted text" },
          ],
        },
      }}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Remove scene scene-2" }));
  await userEvent.click(screen.getByRole("button", { name: "Add scene" }));
  expect(story().scenes[1]).toEqual({ id: "scene-2", title: "New scene" });
  expect((screen.getByRole("button", { name: "Undo removal" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(screen.getByRole("alert").textContent).toContain("Undo cannot replace it");
});

it("keeps a scene goal until the author clears it before removing that participant", async () => {
  render(
    <Harness
      start={{
        ...initial,
        story: {
          version: 1,
          scenes: [{ id: "inn", title: "Inn", goals: { alice: "Find the key" } }],
        },
      }}
    />,
  );
  const checkbox = screen.getByLabelText(/alice present in inn/);
  expect((checkbox as HTMLInputElement).disabled).toBe(true);
  await userEvent.click(screen.getByText("alice: part and goals"));
  await userEvent.clear(screen.getByLabelText("alice goal in inn"));
  await userEvent.click(checkbox);
  expect(story().scenes[0]?.cast).toEqual(["bob"]);
  expect(story().scenes[0]).not.toHaveProperty("goals");
});

it("explicitly clears a scene goal in all languages and undo restores that field without reverting later edits", async () => {
  render(
    <Harness
      start={{
        ...initial,
        story: {
          version: 1,
          scenes: [
            {
              id: "inn",
              title: "Inn",
              goals: { alice: { en: "Protect", ja: "守る" }, bob: "Observe" },
            },
          ],
        },
      }}
    />,
  );
  await userEvent.click(screen.getByText("alice: part and goals"));
  await userEvent.click(
    screen.getByRole("button", { name: "Clear alice scene goal in all languages" }),
  );
  expect(story().scenes[0]?.goals).toEqual({ bob: "Observe" });
  await userEvent.type(screen.getByLabelText("Time for inn"), "Night");
  await userEvent.click(screen.getByRole("button", { name: "Edit summary elsewhere" }));
  await userEvent.click(screen.getByRole("button", { name: "Undo scene goal removal" }));
  expect(story().scenes[0]).toMatchObject({
    time: "Night",
    goals: { alice: { en: "Protect", ja: "守る" }, bob: "Observe" },
  });
  expect(current().summary).toBe("Another later edit");
});

it("does not let goal undo overwrite a newly authored goal", async () => {
  render(
    <Harness
      start={{
        ...initial,
        story: {
          version: 1,
          scenes: [{ id: "inn", title: "Inn", goals: { alice: { en: "Protect", ja: "守る" } } }],
        },
      }}
    />,
  );
  await userEvent.click(screen.getByText("alice: part and goals"));
  await userEvent.click(
    screen.getByRole("button", { name: "Clear alice scene goal in all languages" }),
  );
  await userEvent.type(screen.getByLabelText("alice goal in inn"), "New goal");
  expect(
    (screen.getByRole("button", { name: "Undo scene goal removal" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain("Undo cannot replace it");
  expect(story().scenes[0]?.goals?.alice).toBe("New goal");
});

it("authors descriptions for two openings that pass the real Core check", async () => {
  render(
    <Harness
      start={{
        ...initial,
        story: {
          version: 1,
          scenes: [{ id: "inn", title: "Inn" }],
          starts: [{ id: "start", title: "Arrival", description: { en: "Original", ja: "到着" } }],
        },
      }}
    />,
  );
  await userEvent.clear(screen.getByLabelText("Opening start description"));
  await userEvent.type(screen.getByLabelText("Opening start description"), "Arrive before dusk");
  await userEvent.click(screen.getByRole("button", { name: "Add opening" }));
  const before = checkCreation(canonicalizeCreation(current()).creation);
  expect(before.ok).toBe(false);
  expect(
    before.diagnostics.some((diagnostic) =>
      diagnostic.detail?.includes("Multiple starts need title and description"),
    ),
  ).toBe(true);
  await userEvent.type(
    screen.getByLabelText("Opening start-2 description"),
    "Arrive after midnight",
  );
  await userEvent.selectOptions(screen.getByLabelText("Scene for start-2", { exact: true }), "inn");
  expect(checkCreation(canonicalizeCreation(current()).creation).ok).toBe(true);
  expect(story().starts?.[0]?.description).toEqual({ en: "Arrive before dusk", ja: "到着" });
});

it("keeps scene undo available when a referenced change has since been removed", async () => {
  render(
    <Harness
      start={{
        ...initial,
        story: {
          version: 1,
          scenes: [
            { id: "inn", title: "Inn" },
            { id: "garden", title: "Garden", beats: ["trust"] },
          ],
          beats: [{ id: "trust", title: "Trust", description: "Earn trust" }],
        },
      }}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Remove scene garden" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove unused change elsewhere" }));
  await userEvent.click(screen.getByRole("button", { name: "Undo removal" }));
  expect(story().scenes.map((scene) => scene.id)).toEqual(["inn"]);
  expect(screen.getByText(/Cannot restore yet:/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Undo removal" })).toBeTruthy();
});

it("keeps opening undo available when its scene has since been removed", async () => {
  render(
    <Harness
      start={{
        ...initial,
        story: {
          version: 1,
          scenes: [
            { id: "inn", title: "Inn" },
            { id: "garden", title: "Garden" },
          ],
          starts: [{ id: "garden-start", scene: "garden", greeting: "Garden greeting" }],
        },
      }}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Remove opening garden-start" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove unused garden elsewhere" }));
  await userEvent.click(screen.getByRole("button", { name: "Undo removal" }));
  expect(story()).not.toHaveProperty("starts");
  expect(screen.getByText(/Cannot restore yet:/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Undo removal" })).toBeTruthy();
});

it("restores a scene goal while preserving an unrelated unfinished title", async () => {
  render(
    <Harness
      start={{
        ...initial,
        story: { version: 1, scenes: [{ id: "inn", title: "Inn", goals: { alice: "Protect" } }] },
      }}
    />,
  );
  await userEvent.click(screen.getByText("alice: part and goals"));
  await userEvent.click(
    screen.getByRole("button", { name: "Clear alice scene goal in all languages" }),
  );
  await userEvent.clear(screen.getByLabelText("Scene inn title"));
  await userEvent.click(screen.getByRole("button", { name: "Undo scene goal removal" }));
  expect((current().story as Story).scenes[0]?.goals?.alice).toBe("Protect");
  expect((current().story as Story).scenes[0]?.title).toBe("");
  await userEvent.type(screen.getByLabelText("Scene inn title"), "Repaired");
  expect(story().scenes[0]?.goals?.alice).toBe("Protect");
  expect(checkCreation(canonicalizeCreation(current()).creation).ok).toBe(true);
});

it("restores a newly added opening whose description was not finished, then lets the author complete it", async () => {
  render(
    <Harness
      start={{
        ...initial,
        story: {
          version: 1,
          scenes: [{ id: "inn", title: "Inn" }],
          starts: [{ id: "start", title: "Arrival", description: "Arrive at dawn" }],
        },
      }}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Add opening" }));
  expect(checkCreation(canonicalizeCreation(current()).creation).ok).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Remove opening start-2" }));
  expect(checkCreation(canonicalizeCreation(current()).creation).ok).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Undo removal" }));
  expect(story().starts?.map((start) => start.id)).toEqual(["start", "start-2"]);
  await userEvent.type(screen.getByLabelText("Opening start-2 description"), "Arrive after dark");
  expect(checkCreation(canonicalizeCreation(current()).creation).ok).toBe(true);
});

it("links a group and Source section to a scene without copying bodies or discarding external links", async () => {
  render(
    <Harness
      start={{
        ...initial,
        groups: [{ id: "history", title: "History", description: "Past", entries: [] }],
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
          scenes: [{ id: "inn", title: "Inn", lore: ["@writer/shared#rumor"] }],
          starts: [{ id: "start", scene: "inn", greeting: "Welcome" }],
        },
      }}
    />,
  );
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Related reading for inn" }),
    "#group/history",
  );
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Related reading for inn" }),
    "#source/book/door",
  );
  expect(story().scenes[0]?.lore).toEqual([
    "@writer/shared#rumor",
    "#group/history",
    "#source/book/door",
  ]);
  await userEvent.click(
    screen.getByRole("button", { name: "Remove #group/history from Related reading for inn" }),
  );
  expect(story().scenes[0]?.lore).toEqual(["@writer/shared#rumor", "#source/book/door"]);
  expect((current().sources as { sections: unknown[] }[])[0]?.sections).toHaveLength(1);
});
