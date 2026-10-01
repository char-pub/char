import {
  canonicalizeCreation,
  checkCreation,
  confirm,
  evaluateCondition,
  initStoryState,
  type Story,
  type StoryCondition,
  type StoryEffect,
} from "@char-pub/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import type { Working } from "@/lib/draft";
import { StoryConditionEditor, StoryEffectsEditor } from "./story-rules";

const initial: Working = {
  id: "cr_01j00000000000000000000001",
  ref: "@writer/rules",
  type: "scenario",
  display_name: "Rules",
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
  cast: [
    { key: "alice", who: { late: "character" } },
    { key: "bob", who: { late: "character" } },
  ],
  fragments: [
    {
      id: "secret",
      kind: "knowledge",
      stable: true,
      content: { type: "text", text: "A hidden tunnel" },
    },
  ],
  story: {
    version: 1,
    scenes: [
      { id: "room", title: "Room" },
      { id: "garden", title: "Garden" },
    ],
    beats: [
      { id: "reward", title: "Reward", description: "Gain trust" },
      { id: "probe", title: "Probe", description: "Test rules" },
    ],
    endings: [{ id: "leave", title: "Leave", description: "Leave the inn", after: "continue" }],
    events: [{ id: "rain", title: "Rain", description: "It already rained", kind: "background" }],
    vars: {
      flag: { type: "bool", init: false, description: "Flag" },
      trust: { type: "int", init: 2, min: 0, max: 10, description: "Trust" },
      mood: { type: "enum", init: "calm", values: ["calm", "tense"], description: "Mood" },
      bag: { type: "set", of: "item", init: [], description: "Inventory" },
      tags: { type: "set", init: ["kind"], values: ["kind", "brave"], description: "Traits" },
    },
    items: [
      { id: "key", title: "Key", description: "An iron key" },
      { id: "letter", title: "Letter", description: "A sealed letter" },
    ],
    knowing: { "#secret": { start: { knows: ["alice"], not: ["bob"] } } },
  } satisfies Story,
};
function Harness({
  start = initial,
  condition,
  effects = [],
}: {
  start?: Working;
  condition?: StoryCondition;
  effects?: StoryEffect[];
}) {
  const [working, update] = useState<Working>(() => ({
    ...start,
    story: {
      ...(start.story as Story),
      beats: ((start.story as Story).beats ?? []).map((beat) =>
        beat.id === "probe"
          ? { ...beat, ...(condition ? { when: condition } : {}), effects }
          : beat,
      ),
    },
  }));
  const story = working.story as Story;
  const probe = story.beats?.find((beat) => beat.id === "probe");
  return (
    <>
      <StoryConditionEditor
        working={working}
        value={probe?.when}
        onChange={(when) =>
          update((w) => {
            const s = w.story as Story;
            return {
              ...w,
              story: {
                ...s,
                beats: s.beats?.map((beat) => {
                  if (beat.id !== "probe") return beat;
                  const { when: _old, ...rest } = beat;
                  return when ? { ...rest, when } : rest;
                }),
              },
            };
          })
        }
      />
      <StoryEffectsEditor
        working={working}
        value={probe?.effects}
        onChange={(effects) =>
          update((w) => {
            const s = w.story as Story;
            return {
              ...w,
              story: {
                ...s,
                beats: s.beats?.map((beat) => (beat.id === "probe" ? { ...beat, effects } : beat)),
              },
            };
          })
        }
      />
      <button
        type="button"
        onClick={() => update((w) => ({ ...w, story: { ...(w.story as Story), vars: {} } }))}
      >
        Remove all variables elsewhere
      </button>
      <button type="button" onClick={() => update((w) => ({ ...w, references: [] }))}>
        Remove dependencies elsewhere
      </button>
      <output data-testid="working">{JSON.stringify(working)}</output>
    </>
  );
}
function current() {
  return JSON.parse(screen.getByTestId("working").textContent ?? "{}") as Working;
}
function story() {
  return current().story as Story;
}
function condition() {
  const value = story().beats?.find((beat) => beat.id === "probe")?.when;
  if (!value) throw new Error("condition missing");
  return value;
}
function effects() {
  return story().beats?.find((beat) => beat.id === "probe")?.effects ?? [];
}
function checked() {
  const result = checkCreation(canonicalizeCreation(current()).creation);
  expect(result.diagnostics.filter((issue) => issue.severity === "error")).toEqual([]);
}
const cast = ["alice", "bob"];
function truth() {
  const s = story();
  return evaluateCondition(s, cast, initStoryState(s, cast), condition());
}

it("wraps a localized judgment without losing it and Core preserves unknown through Not", async () => {
  render(<Harness condition={{ judge: { en: "Did the guest agree?", ja: "同意した？" } }} />);
  await userEvent.clear(screen.getByLabelText("Rule condition description"));
  await userEvent.type(
    screen.getByLabelText("Rule condition description"),
    "Did the guest promise?",
  );
  await userEvent.selectOptions(screen.getByLabelText("Rule rule"), "not");
  checked();
  expect(truth()).toBe("unknown");
  expect(condition()).toEqual({
    not: { judge: { en: "Did the guest promise?", ja: "同意した？" } },
  });
  await userEvent.click(screen.getByRole("button", { name: "Undo condition edit" }));
  expect(condition()).toEqual({ judge: { en: "Did the guest promise?", ja: "同意した？" } });
});

it("edits nested alternatives and restores a removed branch with Core truth unchanged", async () => {
  render(<Harness condition={{ any: [{ is: "var/flag" }, { in: "scene/room" }] }} />);
  expect(truth()).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Remove rule Rule.2" }));
  expect(truth()).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Undo condition edit" }));
  expect(truth()).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Move rule Rule.2 up" }));
  checked();
  expect(truth()).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Undo condition edit" }));
  await userEvent.selectOptions(screen.getByLabelText("Rule rule"), "all");
  checked();
  expect(truth()).toBe(true);
  await userEvent.selectOptions(screen.getByLabelText("Rule rule"), "judge");
  await userEvent.click(screen.getByRole("button", { name: "Undo condition edit" }));
  expect(truth()).toBe(true);
});

it.each([
  ["in", "scene/room", true],
  ["visited", "scene/garden", false],
  ["reached", "beat/reward", false],
  ["ended", "ending/leave", false],
  ["happened", "event/rain", true],
] as const)(
  "selects existing %s progress targets and evaluates them in Core",
  async (kind, target, expected) => {
    render(<Harness />);
    await userEvent.selectOptions(screen.getByLabelText("Add condition"), kind);
    await userEvent.selectOptions(screen.getByLabelText("Rule target"), target);
    checked();
    expect(truth()).toBe(expected);
  },
);

it("offers typed variables and enum/item values without coercing declarations", async () => {
  render(<Harness />);
  await userEvent.selectOptions(screen.getByLabelText("Add condition"), "cmp");
  expect(
    [...screen.getByLabelText<HTMLSelectElement>("Rule integer variable").options].map(
      (option) => option.value,
    ),
  ).toEqual(["var/trust"]);
  await userEvent.selectOptions(screen.getByLabelText("Rule comparison"), ">=");
  await userEvent.clear(screen.getByLabelText("Rule compare with"));
  await userEvent.type(screen.getByLabelText("Rule compare with"), "2");
  checked();
  expect(truth()).toBe(true);
  await userEvent.selectOptions(screen.getByLabelText("Rule rule"), "eq");
  await userEvent.selectOptions(screen.getByLabelText("Rule value"), "tense");
  checked();
  expect(truth()).toBe(false);
  await userEvent.selectOptions(screen.getByLabelText("Rule rule"), "has");
  await userEvent.selectOptions(screen.getByLabelText("Rule value"), "item/key");
  checked();
  expect(truth()).toBe(false);
  expect(story().vars).toEqual((initial.story as Story).vars);
});

it("uses controlled knowledge and excludes wildcard from knows", async () => {
  render(<Harness />);
  await userEvent.selectOptions(screen.getByLabelText("Add condition"), "knows");
  const select = screen.getByLabelText<HTMLSelectElement>("Rule person");
  expect([...select.options].map((option) => option.value)).toEqual(["alice", "bob"]);
  checked();
  expect(truth()).toBe(true);
  await userEvent.selectOptions(select, "bob");
  checked();
  expect(truth()).toBe(false);
});

it("does not invent a target when no compatible variable exists and shows old missing references for repair", async () => {
  render(
    <Harness
      start={{ ...initial, story: { ...(initial.story as Story), vars: {} } }}
      condition={{ is: "var/deleted" }}
    />,
  );
  expect(screen.getByText("Missing or incompatible: var/deleted")).toBeTruthy();
  await userEvent.selectOptions(screen.getByLabelText("Rule rule"), "cmp");
  expect(condition()).toEqual({ is: "var/deleted" });
  expect(screen.getByText(/Add the required object or variable first/)).toBeTruthy();
  await userEvent.selectOptions(screen.getByLabelText("Rule rule"), "in");
  checked();
  expect(truth()).toBe(true);
});

it("executes set/add/put/drop/learn in declared order through Core exactly once", async () => {
  render(<Harness />);
  await userEvent.selectOptions(screen.getByLabelText("Add effect"), "set");
  await userEvent.selectOptions(screen.getByLabelText("Effect 1 value"), "true");
  await userEvent.selectOptions(screen.getByLabelText("Add effect"), "add");
  await userEvent.clear(screen.getByLabelText("Effect 2 amount"));
  await userEvent.type(screen.getByLabelText("Effect 2 amount"), "50");
  await userEvent.selectOptions(screen.getByLabelText("Add effect"), "put");
  await userEvent.selectOptions(screen.getByLabelText("Add effect"), "drop");
  await userEvent.selectOptions(screen.getByLabelText("Add effect"), "learn");
  expect(screen.getByLabelText<HTMLSelectElement>("Effect 5 person").value).toBe("*");
  checked();
  const s = story(),
    start = initStoryState(s, cast);
  expect(start.vars.trust).toBe(2); // The editor has never applied an effect.
  const reached = confirm(s, cast, start, "beat/probe");
  expect(reached.vars).toMatchObject({ flag: true, trust: 10, bag: [] });
  expect(reached.knowing["#secret"]).toEqual(["alice", "bob"]);
  expect(() => confirm(s, cast, reached, "beat/probe")).toThrow();
  await userEvent.click(screen.getByRole("button", { name: "Move effect 4 up" }));
  const reordered = story();
  expect(confirm(reordered, cast, initStoryState(reordered, cast), "beat/probe").vars.bag).toEqual([
    "key",
  ]);
  await userEvent.click(screen.getByRole("button", { name: "Undo effects edit" }));
  const restored = story();
  expect(confirm(restored, cast, initStoryState(restored, cast), "beat/probe").vars.bag).toEqual(
    [],
  );
});

it("sets bounded integers, enum values and item sets with explicit type repair", async () => {
  render(
    <Harness
      effects={[{ set: ["var/trust", 2] }, { set: ["var/mood", "calm"] }, { set: ["var/bag", []] }]}
    />,
  );
  await userEvent.clear(screen.getByLabelText("Effect 1 value"));
  await userEvent.type(screen.getByLabelText("Effect 1 value"), "99");
  expect(effects()[0]).toEqual({ set: ["var/trust", 9] }); // 99 was not committed.
  expect(screen.getByText(/This edit has not been applied/)).toBeTruthy();
  await userEvent.clear(screen.getByLabelText("Effect 1 value"));
  await userEvent.type(screen.getByLabelText("Effect 1 value"), "7");
  await userEvent.selectOptions(screen.getByLabelText("Effect 2 value"), "tense");
  const bag = screen.getByRole("group", { name: "Effect 3 value" });
  await userEvent.click(within(bag).getByLabelText("key"));
  checked();
  const s = story();
  expect(confirm(s, cast, initStoryState(s, cast), "beat/probe").vars).toMatchObject({
    trust: 7,
    mood: "tense",
    bag: ["key"],
  });
  await userEvent.selectOptions(screen.getByLabelText("Effect 1 variable"), "var/bag");
  expect(effects()[0]).toEqual({ set: ["var/bag", 7] });
  expect(screen.getByText("The stored value is not a set.")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Use an empty set" }));
  checked();
});

it("retains removed rules when undo would restore a deleted variable and does not overwrite later edits", async () => {
  render(<Harness condition={{ is: "var/flag" }} effects={[{ add: ["var/trust", 1] }]} />);
  await userEvent.click(screen.getByRole("button", { name: "Remove condition" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove effect 1" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove all variables elsewhere" }));
  await userEvent.click(screen.getByRole("button", { name: "Undo condition edit" }));
  expect(story().beats?.find((beat) => beat.id === "probe")?.when).toBeUndefined();
  await userEvent.click(screen.getByRole("button", { name: "Undo effects edit" }));
  expect(effects()).toEqual([]);
  expect(screen.getAllByText(/Cannot undo yet/).length).toBe(2);
});

it("clears only the current judgment language and retains other translations", async () => {
  render(<Harness condition={{ judge: { en: "Agree?", ja: "同意？" } }} />);
  await userEvent.clear(screen.getByLabelText("Rule condition description"));
  expect(condition()).toEqual({ judge: { ja: "同意？" } });
  checked();
  expect(truth()).toBe("unknown");
  await userEvent.type(screen.getByLabelText("Rule condition description"), "Promise?");
  expect(condition()).toEqual({ judge: { ja: "同意？", en: "Promise?" } });
});

it("refuses to replace later edits with an older rule or effects snapshot", async () => {
  render(<Harness condition={{ is: "var/flag" }} effects={[{ add: ["var/trust", 1] }]} />);
  await userEvent.selectOptions(screen.getByLabelText("Rule rule"), "cmp");
  await userEvent.clear(screen.getByLabelText("Rule compare with"));
  await userEvent.type(screen.getByLabelText("Rule compare with"), "3");
  expect(
    (screen.getByRole("button", { name: "Undo condition edit" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await userEvent.selectOptions(screen.getByLabelText("Effect 1 operation"), "learn");
  await userEvent.click(screen.getByRole("button", { name: "Undo effects edit" }));
  expect(effects()).toEqual([{ add: ["var/trust", 1] }]);
  await userEvent.selectOptions(screen.getByLabelText("Effect 1 operation"), "set");
  await userEvent.selectOptions(screen.getByLabelText("Effect 1 value"), "true");
  expect(
    (screen.getByRole("button", { name: "Undo effects edit" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it.each([
  ["all", true],
  ["any", false],
] as const)("shows and evaluates the empty %s group explicitly", async (kind, expected) => {
  render(<Harness />);
  await userEvent.selectOptions(screen.getByLabelText("Add condition"), kind);
  checked();
  expect(truth()).toBe(expected);
  expect(
    screen.getByText(
      kind === "all" ? "An empty All group is true." : "An empty Any group is false.",
    ),
  ).toBeTruthy();
});

it("does not create an effect when its compatible targets are absent", async () => {
  render(
    <Harness
      start={{
        ...initial,
        fragments: [],
        story: { ...(initial.story as Story), vars: {}, knowing: {} },
      }}
    />,
  );
  await userEvent.selectOptions(screen.getByLabelText("Add effect"), "put");
  expect(effects()).toEqual([]);
  expect(screen.getByText(/Add a typed variable or information fragment first/)).toBeTruthy();
  await userEvent.selectOptions(screen.getByLabelText("Add effect"), "learn");
  expect(effects()).toEqual([]);
});

it("describes opening effects separately from confirmation effects", () => {
  render(
    <StoryEffectsEditor
      working={initial}
      value={[{ set: ["var/flag", true] }]}
      onChange={() => {}}
      phase="opening"
    />,
  );
  expect(
    screen.getByText(
      /Opening effects run after initial variable and knowledge values, before entering the scene/,
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/only after Runtime confirms/)).toBeNull();
});

it("shows existing bare item references as valid item choices without rewriting their saved values", () => {
  render(
    <Harness condition={{ has: ["var/bag", "key"] }} effects={[{ put: ["var/bag", "key"] }]} />,
  );
  expect(screen.getByLabelText<HTMLSelectElement>("Rule value").value).toBe("item/key");
  expect(screen.getByLabelText<HTMLSelectElement>("Effect 1 member").value).toBe("item/key");
  expect(condition()).toEqual({ has: ["var/bag", "key"] });
  expect(effects()).toEqual([{ put: ["var/bag", "key"] }]);
  checked();
  expect(screen.queryByText(/Missing or incompatible/)).toBeNull();
});

it("retains declared controlled public information without pretending the direct edge list is a resolved closure", async () => {
  const external = "@indirect/archive#fact";
  render(
    <Harness
      start={{
        ...initial,
        story: {
          ...(initial.story as Story),
          knowing: {
            ...((initial.story as Story).knowing ?? {}),
            [external]: { start: { knows: ["alice"] } },
          },
        },
      }}
      condition={{ knows: { who: "alice", info: external } }}
      effects={[{ learn: { who: "bob", info: external } }]}
    />,
  );
  expect(screen.getByLabelText<HTMLSelectElement>("Rule information").value).toBe(external);
  expect(screen.getByLabelText<HTMLSelectElement>("Effect 1 information").value).toBe(external);
  expect(screen.queryByText(`Missing or incompatible: ${external}`)).toBeNull();
  expect(screen.getByText(/Dependency references are checked when the draft builds/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Remove condition" }));
  await userEvent.click(screen.getByRole("button", { name: "Undo condition edit" }));
  expect(condition()).toEqual({ knows: { who: "alice", info: external } });
  // checkCreation does not fetch a dependency closure; the eventual draft build remains authoritative.
  checked();
});

it("restores the only Learn declaration of external information using the candidate information set", async () => {
  const external = "@indirect/archive#fact";
  render(<Harness effects={[{ learn: { who: "alice", info: external } }]} />);
  await userEvent.click(screen.getByRole("button", { name: "Remove effect 1" }));
  expect(effects()).toEqual([]);
  await userEvent.click(screen.getByRole("button", { name: "Undo effects edit" }));
  expect(effects()).toEqual([{ learn: { who: "alice", info: external } }]);
  expect(screen.queryByText(/Cannot undo yet/)).toBeNull();
});

it("keeps Learn undo pending when the dependency snapshot has changed since removal", async () => {
  const external = "@indirect/archive#fact";
  const start: Working = {
    ...initial,
    references: [
      {
        id: "world",
        use: "@direct/world",
        mode: "default",
        pin: {
          release: "rel_01j00000000000000000000001",
          semantic_digest: `sha256:${"a".repeat(64)}`,
        },
      },
    ],
  };
  render(<Harness start={start} effects={[{ learn: { who: "alice", info: external } }]} />);
  await userEvent.click(screen.getByRole("button", { name: "Remove effect 1" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove dependencies elsewhere" }));
  await userEvent.click(screen.getByRole("button", { name: "Undo effects edit" }));
  expect(effects()).toEqual([]);
  expect(screen.getByText(/Dependencies changed/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Undo effects edit" })).toBeTruthy();
});
