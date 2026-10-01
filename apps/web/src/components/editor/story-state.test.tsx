import {
  canonicalizeCreation,
  checkCreation,
  initStoryState,
  type Story,
  StorySchema,
} from "@char-pub/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import type { Working } from "@/lib/draft";
import { StoryStateEditor } from "./story-state";

const initial = (): Working => ({
  id: "cr_01j00000000000000000000001",
  ref: "@writer/story",
  type: "scenario",
  display_name: "Inn",
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
  cast: [
    { key: "alice", who: { late: "character" } },
    { key: "bob", who: { late: "character" } },
  ],
  fragments: [
    { id: "secret", stable: true, kind: "knowledge", content: { type: "text", text: "A secret" } },
  ],
  story: {
    version: 1,
    scenes: [
      { id: "hall", title: "Hall" },
      { id: "garden", title: "Garden" },
    ],
  },
});
function Harness({ start = initial() }: { start?: Working }) {
  const [working, update] = useState(start);
  return (
    <>
      <StoryStateEditor working={working} update={update} />
      <button type="button" onClick={() => update((w) => ({ ...w, cast: [] }))}>
        Remove cast elsewhere
      </button>
      <button type="button" onClick={() => update((w) => ({ ...w, cast: initial().cast }))}>
        Restore cast elsewhere
      </button>
      <button
        type="button"
        onClick={() => update((w) => ({ ...w, summary: "Later unrelated edit" }))}
      >
        Edit summary elsewhere
      </button>
      <button type="button" onClick={() => update((w) => ({ ...w, sources: [], fragments: [] }))}>
        Remove local material elsewhere
      </button>
      <button
        type="button"
        onClick={() =>
          update((w) => ({ ...w, sources: start.sources, fragments: start.fragments ?? [] }))
        }
      >
        Restore local material elsewhere
      </button>
      <output data-testid="working">{JSON.stringify(working)}</output>
    </>
  );
}
const current = (): Working => JSON.parse(screen.getByTestId("working").textContent ?? "{}");
const story = (): Story => current().story as Story;
function valid() {
  StorySchema.parse(story());
  expect(
    checkCreation(canonicalizeCreation(current()).creation).diagnostics.filter(
      (d) => d.severity === "error",
    ),
  ).toEqual([]);
}
async function open(title: string) {
  const summary = screen.getByText(title, { selector: "summary" });
  if (!(summary.parentElement as HTMLDetailsElement).open) await userEvent.click(summary);
}

it("authors all variable types through fields and produces valid Core initial state", async () => {
  render(<Harness />);
  const user = userEvent.setup();
  await open("Variables");
  await user.click(screen.getByRole("button", { name: "Add variable" }));
  await user.type(screen.getByLabelText("Description for variable"), "Door unlocked");
  await user.click(screen.getByLabelText("Initial value for variable"));
  await user.click(screen.getByRole("button", { name: "Add variable" }));
  await user.type(screen.getByLabelText("Description for variable-2"), "Trust");
  await user.selectOptions(screen.getByLabelText("Type for variable-2"), "int");
  await user.clear(screen.getByLabelText("Minimum for variable-2"));
  await user.type(screen.getByLabelText("Minimum for variable-2"), "-10");
  await user.clear(screen.getByLabelText("Maximum for variable-2"));
  await user.type(screen.getByLabelText("Maximum for variable-2"), "10");
  await user.clear(screen.getByLabelText("Initial value for variable-2"));
  await user.type(screen.getByLabelText("Initial value for variable-2"), "3");
  await user.click(screen.getByRole("button", { name: "Add variable" }));
  await user.type(screen.getByLabelText("Description for variable-3"), "Mood");
  await user.selectOptions(screen.getByLabelText("Type for variable-3"), "enum");
  await user.clear(screen.getByLabelText("Allowed value 1 for variable-3"));
  await user.type(screen.getByLabelText("Allowed value 1 for variable-3"), "calm");
  await user.selectOptions(screen.getByLabelText("Initial value for variable-3"), "calm");
  await user.click(screen.getByRole("button", { name: "Add allowed value to variable-3" }));
  await user.click(screen.getByRole("button", { name: "Add variable" }));
  await user.type(screen.getByLabelText("Description for variable-4"), "Clues");
  await user.selectOptions(screen.getByLabelText("Type for variable-4"), "set");
  await user.selectOptions(screen.getByLabelText("Set members for variable-4"), "values");
  await user.click(screen.getByRole("button", { name: "Add allowed value to variable-4" }));
  await user.click(screen.getByLabelText("variable-4 initially includes value"));
  valid();
  expect(initStoryState(story(), ["alice", "bob"]).vars).toEqual({
    variable: true,
    "variable-2": 3,
    "variable-3": "calm",
    "variable-4": ["value"],
  });
  expect(story().vars?.["variable-2"]).toMatchObject({ min: -10, max: 10 });
});

it("preserves localized prose and item lore, connects scenes, and fills an item set", async () => {
  const start = initial();
  start.story = {
    ...(start.story as Story),
    vars: {
      inventory: {
        type: "set",
        of: "item",
        init: [],
        description: { en: "Held items", ja: "持ち物" },
      },
    },
    items: [
      {
        id: "key",
        title: { en: "Key", ja: "鍵" },
        description: { en: "Brass key", ja: "真鍮の鍵" },
        lore: ["#secret"],
        reveal: "on-reach",
      },
    ],
  };
  render(<Harness start={start} />);
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText("Description for inventory"));
  await user.type(screen.getByLabelText("Description for inventory"), "Player inventory");
  await user.clear(screen.getByLabelText("Title for item key"));
  await user.type(screen.getByLabelText("Title for item key"), "Back door key");
  await user.click(screen.getByLabelText("key in hall"));
  await user.click(screen.getByLabelText("inventory initially includes key"));
  valid();
  expect(story().vars?.inventory).toMatchObject({
    description: { en: "Player inventory", ja: "持ち物" },
    init: ["key"],
    of: "item",
  });
  expect(story().items?.[0]).toMatchObject({
    title: { en: "Back door key", ja: "鍵" },
    description: { en: "Brass key", ja: "真鍮の鍵" },
    lore: ["#secret"],
    reveal: "on-reach",
  });
  expect(
    (screen.getByRole("button", { name: "Remove item key" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(initStoryState(story(), ["alice", "bob"]).vars.inventory).toEqual(["key"]);
});

it("blocks referenced variable removal and type changes, including set member source", () => {
  const start = initial();
  start.story = {
    ...(start.story as Story),
    vars: {
      flag: { type: "bool", init: false, description: "Flag" },
      bag: { type: "set", of: "item", init: [], description: "Bag" },
    },
    beats: [
      {
        id: "ready",
        title: "Ready",
        description: "Ready",
        when: { is: "var/flag" },
        effects: [{ set: ["var/bag", []] }],
      },
    ],
  };
  render(<Harness start={start} />);
  expect((screen.getByLabelText("Type for flag") as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByLabelText("Set members for bag") as HTMLSelectElement).disabled).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Remove variable flag" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getAllByText(/Remove references before changing type/).length).toBe(2);
});

it("changes an unused variable type without dropping other language descriptions and undoes deletion", async () => {
  const start = initial();
  start.story = {
    ...(start.story as Story),
    vars: {
      mood: {
        type: "enum",
        init: "calm",
        values: ["calm"],
        description: { en: "Mood", ja: "気分" },
      },
    },
  };
  render(<Harness start={start} />);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Type for mood"), "bool");
  expect(story().vars?.mood).toEqual({
    type: "bool",
    init: false,
    description: { en: "Mood", ja: "気分" },
  });
  await user.click(screen.getByRole("button", { name: "Remove variable mood" }));
  await user.click(screen.getByRole("button", { name: "Edit summary elsewhere" }));
  await user.click(screen.getByRole("button", { name: "Undo state removal" }));
  expect(story().vars?.mood?.description).toEqual({ en: "Mood", ja: "気分" });
  expect(current().summary).toBe("Later unrelated edit");
  valid();
});

it("distinguishes undeclared and explicit ignorance, reports wildcard conflicts without changing lists", async () => {
  render(<Harness />);
  const user = userEvent.setup();
  await open("Who knows what");
  await user.selectOptions(screen.getByLabelText("Local information fragment"), "#secret");
  await user.click(screen.getByRole("button", { name: "Add knowledge entry" }));
  expect(screen.getByText("alice: Not declared")).toBeTruthy();
  await user.selectOptions(
    screen.getByLabelText("Does not know #secret at start audience"),
    "selected",
  );
  await user.click(screen.getByLabelText("Does not know #secret at start: bob"));
  expect(screen.getByText("bob: Explicitly does not know")).toBeTruthy();
  await user.selectOptions(screen.getByLabelText("Knows #secret at start audience"), "all");
  expect(story().knowing?.["#secret"]?.start).toEqual({ knows: "*", not: ["bob"] });
  expect(screen.getByText("bob: Conflict: listed on both sides")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("both knowing and not knowing");
  await user.click(screen.getByLabelText("Does not know #secret at start: bob"));
  valid();
  expect(initStoryState(story(), ["alice", "bob"]).knowing["#secret"]).toEqual(["alice", "bob"]);
});

it("authors per-scene knowledge and preserves * for future participants", async () => {
  const start = initial();
  start.story = { ...(start.story as Story), knowing: { "#secret": { start: { not: "*" } } } };
  render(<Harness start={start} />);
  const user = userEvent.setup();
  await user.click(screen.getByLabelText("Learn #secret on entering hall"));
  await user.selectOptions(screen.getByLabelText("Learns #secret in hall audience"), "all");
  valid();
  expect(story().knowing?.["#secret"]).toEqual({
    start: { not: "*" },
    enter: { hall: { knows: "*" } },
  });
  expect(initStoryState(story(), ["alice", "bob", "later"]).knowing["#secret"]).toEqual([
    "alice",
    "bob",
    "later",
  ]);
  await user.click(screen.getByLabelText("Learn #secret on entering hall"));
  expect(story().knowing?.["#secret"]?.enter).toEqual({});
  await user.click(screen.getByRole("button", { name: "Undo state removal" }));
  expect(story().knowing?.["#secret"]?.enter?.hall).toEqual({ knows: "*" });
});

it("lists only local fragments, validates explicit cast refs, and does not claim a public closure", async () => {
  render(<Harness />);
  const user = userEvent.setup();
  await open("Who knows what");
  expect(
    within(screen.getByLabelText("Local information fragment"))
      .getAllByRole("option")
      .map((o) => o.getAttribute("value")),
  ).toEqual(["", "#secret"]);
  await user.type(screen.getByLabelText("Information reference"), "cast:absent#fact");
  await user.click(screen.getByRole("button", { name: "Add knowledge entry" }));
  expect(screen.getByRole("alert").textContent).toContain("existing cast key");
  await user.clear(screen.getByLabelText("Information reference"));
  await user.type(screen.getByLabelText("Information reference"), "@other/world#fact");
  await user.click(screen.getByRole("button", { name: "Add knowledge entry" }));
  expect(story().knowing?.["@other/world#fact"]).toEqual({ start: { knows: [] } });
  expect(screen.getByText(/checked in the dependency closure when building/)).toBeTruthy();
});

it("refuses knowledge Undo after cast removal without losing the removed entry", async () => {
  const start = initial();
  start.story = {
    ...(start.story as Story),
    knowing: { "#secret": { start: { knows: ["alice"] } } },
  };
  render(<Harness start={start} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Remove knowledge #secret" }));
  await user.click(screen.getByRole("button", { name: "Remove cast elsewhere" }));
  await user.click(screen.getByRole("button", { name: "Undo state removal" }));
  expect(screen.getByRole("alert").textContent).toContain("Unknown participant");
  expect(story().knowing).toEqual({});
  await user.click(screen.getByRole("button", { name: "Restore cast elsewhere" }));
  await user.click(screen.getByRole("button", { name: "Undo state removal" }));
  expect(story().knowing?.["#secret"]?.start.knows).toEqual(["alice"]);
  valid();
});

it("keeps a knowledge declaration referenced by a condition and reports empty/conflicting starts", async () => {
  const start = initial();
  start.story = {
    ...(start.story as Story),
    knowing: { "#secret": { start: { knows: [] } } },
    beats: [
      {
        id: "test",
        title: "Test",
        description: "Test",
        when: { knows: { who: "alice", info: "#secret" } },
      },
    ],
  };
  render(<Harness start={start} />);
  expect(
    (screen.getByRole("button", { name: "Remove knowledge #secret" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await userEvent.selectOptions(screen.getByLabelText("Knows #secret at start audience"), "unset");
  expect(screen.getByRole("alert").textContent).toContain("Knowledge needs knows or not");
});

it("keeps Source-section lore through editing and blocks Undo after that local Source is removed", async () => {
  const start = initial();
  start.sources = [
    {
      id: "notes",
      title: "Notes",
      description: "Author notes",
      asset: "notes",
      format: "markdown",
      sections: [
        { id: "intro", title: "Introduction", anchor: "#intro", description: "Introduction" },
      ],
    },
  ];
  start.assets = [
    {
      slot: "notes",
      role: "context",
      variants: [
        {
          id: "default",
          media_type: "text/markdown",
          blob: { availability: "mirrored", digest: `sha256:${"1".repeat(64)}`, size: 4 },
        },
      ],
    },
  ];
  start.story = {
    ...(start.story as Story),
    items: [{ id: "letter", title: "Letter", description: "", lore: ["#source/notes/intro"] }],
  };
  render(<Harness start={start} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Description for item letter"), "An introduction letter");
  expect(story().items?.[0]?.lore).toEqual(["#source/notes/intro"]);
  valid();
  await user.click(screen.getByRole("button", { name: "Remove item letter" }));
  await user.click(screen.getByRole("button", { name: "Remove local material elsewhere" }));
  await user.click(screen.getByRole("button", { name: "Undo state removal" }));
  expect(screen.getByRole("alert").textContent).toContain("missing local information");
  expect(story().items).toEqual([]);
  await user.click(screen.getByRole("button", { name: "Restore local material elsewhere" }));
  await user.click(screen.getByRole("button", { name: "Undo state removal" }));
  expect(story().items?.[0]?.lore).toEqual(["#source/notes/intro"]);
  valid();
});
