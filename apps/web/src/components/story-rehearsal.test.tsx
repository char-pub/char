import { prepareContext } from "@char-pub/assembler";
import { confirm, initStoryState, lateSlotKey } from "@char-pub/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import { DEFAULT_SETTINGS, type PreviewSettings, previewInput, previewTurn } from "@/lib/preview";
import { buildTestCreation } from "@/test/build";
import { StoryRehearsalPanel } from "./story-rehearsal";

const result = buildTestCreation({
  root: {
    release: "rel_01j00000000000000000000000",
    visibility: "public",
    creation: {
      id: "cr_01j00000000000000000000000",
      ref: "@writer/rehearsal",
      type: "scenario",
      display_name: "Rehearsal",
      meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
      cast: [
        { key: "alice", who: { late: "character" } },
        { key: "bob", who: { late: "character" } },
      ],
      story: {
        version: 1,
        vars: { trust: { type: "int", min: 0, max: 3, init: 0, description: "Trust" } },
        scenes: [
          {
            id: "lobby",
            title: "Lobby",
            cast: ["alice"],
            when: { judge: "Has the door opened?" },
            choices: ["ask"],
          },
          { id: "garden", title: "Garden", cast: ["alice"] },
        ],
        starts: [{ id: "arrival", scene: "lobby", greeting: "Welcome, {{user}}." }],
        beats: [
          {
            id: "help",
            title: "Help",
            description: "The guest helps.",
            when: { not: { judge: "Did the guest refuse?" } },
            effects: [{ add: ["var/trust", 1] }],
          },
        ],
        endings: [
          {
            id: "leave",
            title: "Leave",
            description: "The guest departs.",
            when: { cmp: ["var/trust", ">=", 1] },
            after: "stop",
          },
        ],
        choices: [{ id: "ask", label: "Ask for help", intent: "Ask the innkeeper for help." }],
      },
    },
  },
});
if (result.artifact.kind !== "content") throw new Error("content required");
const artifact = result.artifact;
const settings: PreviewSettings = {
  ...DEFAULT_SETTINGS,
  start: "arrival",
  historyText: "user: Can I help?",
  lateBindings: {
    [lateSlotKey("root", "alice")]: { kind: "character", name: "Alice", description: "Innkeeper" },
    [lateSlotKey("root", "bob")]: { kind: "character", name: "Bob", description: "Guest" },
  },
};
const openingJudge = {
  target: "scene/lobby",
  path: "/when",
  result: "true" as const,
  provider: { name: "manual", version: "1" },
};

it("rehearses three-valued conditions, explicit confirmation, presence and stop without editing the artifact", async () => {
  const original = JSON.stringify(artifact);
  function Editor() {
    const [current, onChange] = useState(settings);
    return (
      <>
        <StoryRehearsalPanel artifact={artifact} settings={current} onChange={onChange} />
        <output data-testid="settings">{JSON.stringify(current)}</output>
      </>
    );
  }
  render(<Editor />);
  const user = userEvent.setup();
  await user.click(screen.getByText("Check story logic"));
  expect(screen.getByRole("alert").textContent).toContain("Cannot enter the opening yet");
  await user.selectOptions(screen.getByLabelText("Judge scene/lobby/when"), "true");
  const help = screen.getByRole("button", { name: "Confirm Help" });
  expect((help as HTMLButtonElement).disabled).toBe(true);
  await user.selectOptions(screen.getByLabelText("Judge beat/help/when/not"), "false");
  expect((help as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByText(/Available suggestions:/).textContent).toContain("Ask for help");
  await user.click(help);
  expect((screen.getByRole("button", { name: "Confirm Help" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(screen.getByRole("definition").textContent).toBe("1");
  await user.click(screen.getByRole("checkbox", { name: "bob" }));
  const changed = JSON.parse(screen.getByTestId("settings").textContent ?? "{}") as PreviewSettings;
  expect(changed.rehearsal?.state.present).toEqual(["alice", "bob"]);
  await user.selectOptions(screen.getByLabelText("Judge scene/lobby/when"), "false");
  const current = JSON.parse(screen.getByTestId("settings").textContent ?? "{}") as PreviewSettings;
  const turn = previewTurn(artifact, current);
  expect(turn.story?.vars.trust).toBe(1);
  expect(turn.present).toEqual(["alice", "bob"]);
  expect(turn.history?.filter((m) => m.role === "assistant")).toHaveLength(1);
  expect(
    prepareContext(previewInput(artifact, current)).messages.some(
      (m) => typeof m.content === "string" && m.content.includes("Welcome, Sam."),
    ),
  ).toBe(true);
  await user.click(screen.getByText("Set preview variables"));
  const trust = screen.getByLabelText("Preview variable trust");
  await user.clear(trust);
  await user.type(trust, "2");
  expect(screen.getByRole("definition").textContent).toBe("2");
  expect(artifact.story?.vars?.trust?.init).toBe(0);
  await user.clear(trust);
  await user.type(trust, "9");
  expect(screen.getByRole("alert").textContent).toContain("This edit has not been applied");
  expect(screen.getByRole("definition").textContent).toBe("2");
  await user.clear(trust);
  await user.type(trust, "2");
  await user.click(screen.getByRole("button", { name: "Confirm Leave" }));
  expect(screen.getByText(/Current scene:/).textContent).toContain("Story stopped");
  expect(trust.closest("fieldset")?.disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Enter Garden" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  await user.click(screen.getByRole("button", { name: "Reset rehearsal" }));
  expect(screen.getByRole("alert").textContent).toContain("Cannot enter the opening yet");
  expect(JSON.stringify(artifact)).toBe(original);
});

it("keeps opening admission fixed while current judgments change and rejects invalid snapshots", () => {
  if (!artifact.story) throw new Error("story required");
  const cast = ["alice", "bob"];
  const initial = initStoryState(artifact.story, cast, "arrival", [openingJudge]);
  const current = confirm(artifact.story, cast, initial, "beat/help", [
    {
      target: "beat/help",
      path: "/when/not",
      result: "false",
      provider: { name: "manual", version: "1" },
    },
  ]);
  const input = {
    ...settings,
    judgments: [{ ...openingJudge, result: "false" as const }],
    rehearsal: { state: current, openingJudgments: [openingJudge] },
  };
  expect(previewTurn(artifact, input).story?.reached).toEqual(["help"]);
  expect(previewTurn(artifact, input).judgments?.[0]?.result).toBe("false");
  expect(() =>
    previewTurn(artifact, {
      ...input,
      rehearsal: { ...input.rehearsal, state: { ...current, vars: { trust: 99 } } },
    }),
  ).toThrowError(expect.objectContaining({ code: "story.invalid_state" }));
});
