import { canonicalizeCreation, checkCreation, type Story } from "@char-pub/core";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { expect, it } from "vitest";
import type { Working } from "@/lib/draft";
import { buildTestCreation } from "@/test/build";
import { renderWithApp } from "@/test/render";
import { StoryStructure } from "./story-structure";

const initial: Working = {
  id: "cr_01j00000000000000000000000",
  ref: "@writer/inn",
  type: "scenario",
  display_name: "Inn",
  cast: [{ key: "host", who: { late: "character" } }],
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
  story: {
    version: 1,
    scenes: [
      { id: "lobby", title: "Lobby" },
      { id: "garden", title: "Garden" },
    ],
  },
};
function Harness({ start = initial }: { start?: Working }) {
  const [working, update] = useState(start);
  return (
    <>
      <StoryStructure working={working} update={update} />
      <button
        type="button"
        onClick={() =>
          update((w) => ({
            ...w,
            story: {
              ...(w.story as Story),
              scenes: (w.story as Story).scenes.filter((s) => s.id !== "lobby"),
            },
          }))
        }
      >
        Remove lobby elsewhere
      </button>
      <button
        type="button"
        onClick={() =>
          update((w) => ({
            ...w,
            story: {
              ...(w.story as Story),
              scenes: [{ id: "lobby", title: "Restored lobby" }, ...(w.story as Story).scenes],
            },
          }))
        }
      >
        Restore lobby elsewhere
      </button>
      <output data-testid="working">{JSON.stringify(working)}</output>
    </>
  );
}
async function renderReady(ui: ReactNode) {
  renderWithApp(ui);
  await screen.findByRole("region", { name: "Story development" });
}
function current(): Working {
  return JSON.parse(screen.getByTestId("working").textContent ?? "{}");
}
function story(): Story {
  return current().story as Story;
}

it("authors a change, suggestion and continuing ending that pass Core checks and build", async () => {
  const user = userEvent.setup();
  await renderReady(<Harness />);
  await user.click(screen.getByText("Possible changes", { exact: true }));
  await user.click(screen.getByRole("button", { name: "Add change" }));
  await user.type(screen.getByLabelText("What happens"), "The guest earns the innkeeper's trust.");
  await user.click(screen.getByLabelText("Lobby"));
  await user.click(screen.getByText("Suggested actions", { exact: true }));
  await user.click(screen.getByRole("button", { name: "Add action" }));
  await user.type(
    screen.getByLabelText("What the player is trying to do"),
    "Ask about the missing letter.",
  );
  await user.click(within(screen.getByRole("group", { name: /action ·/ })).getByLabelText("Lobby"));
  await user.click(screen.getByText("Endings", { exact: true }));
  await user.click(screen.getByRole("button", { name: "Add ending" }));
  const ending = screen.getByRole("group", { name: /ending ·/ });
  await user.type(
    within(ending).getByLabelText("What happens"),
    "The snow stops and the guests leave.",
  );
  expect((within(ending).getByLabelText("Show the description") as HTMLSelectElement).value).toBe(
    "on-reach",
  );
  await user.selectOptions(screen.getByLabelText("After this ending"), "continue");
  const creation = canonicalizeCreation(current()).creation;
  expect(checkCreation(creation).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const artifact = buildTestCreation({
    root: { creation, release: "rel_01j00000000000000000000000", visibility: "public" },
  }).artifact;
  expect(artifact.kind).toBe("content");
  if (artifact.kind !== "content") throw new Error("content required");
  expect(artifact.story?.scenes[0]?.beats).toEqual([story().beats?.[0]?.id]);
  expect(artifact.story?.choices?.[0]).not.toHaveProperty("effects");
  expect(artifact.story?.endings?.[0]?.after).toBe("continue");
});

it("preserves localized conditions and advanced effects while editing prose", async () => {
  const user = userEvent.setup();
  await renderReady(
    <Harness
      start={{
        ...initial,
        story: {
          ...(initial.story as Story),
          vars: { trust: { type: "int", min: 0, max: 4, init: 0, description: "Trust" } },
          beats: [
            {
              id: "trust",
              title: { en: "Trust", ja: "信頼" },
              description: "A sign of trust",
              when: { judge: { en: "Did they help?", ja: "助けましたか？" } },
              effects: [{ add: ["var/trust", 1] }],
            },
          ],
          events: [
            {
              id: "gift",
              kind: "planned",
              title: "Gift",
              description: "A gift arrives",
              effects: [{ add: ["var/trust", 1] }],
            },
          ],
        },
      }}
    />,
  );
  await user.clear(screen.getByLabelText("change title"));
  await user.type(screen.getByLabelText("change title"), "Confidence");
  const beat = screen.getByRole("group", { name: "change · trust" });
  await user.clear(within(beat).getByLabelText("Rule condition description"));
  expect(story().beats?.[0]).toMatchObject({
    title: { en: "Confidence", ja: "信頼" },
    when: { judge: { ja: "助けましたか？" } },
    effects: [{ add: ["var/trust", 1] }],
  });
  expect(
    (screen.getByRole("option", { name: "Already happened" }) as HTMLOptionElement).disabled,
  ).toBe(true);
  expect(story().events?.[0]?.effects).toEqual([{ add: ["var/trust", 1] }]);
});

it("links plotlines and parallel timeline moments without duplicating objects", async () => {
  const user = userEvent.setup();
  await renderReady(<Harness />);
  await user.click(screen.getByText("Plotlines", { exact: true }));
  await user.click(screen.getByRole("button", { name: "Add plotline" }));
  await user.click(screen.getByLabelText("Garden"));
  await user.click(screen.getByText("Timelines", { exact: true }));
  await user.click(screen.getByRole("button", { name: "Add timeline" }));
  await user.selectOptions(screen.getByLabelText("Add next moment"), "scene/lobby");
  await user.selectOptions(screen.getByLabelText("Add alongside"), "scene/garden");
  expect(story().timelines?.[0]?.order).toEqual([["scene/lobby", "scene/garden"]]);
  expect(story().plotlines?.[0]?.scenes).toEqual(["lobby", "garden"]);
  expect(story().scenes).toHaveLength(2);
  const originalScenes = story().scenes;
  await user.click(screen.getByRole("button", { name: "Move Garden in New plotline up" }));
  expect(story().plotlines?.[0]?.scenes).toEqual(["garden", "lobby"]);
  expect(story().scenes).toEqual(originalScenes);
  expect(story().timelines?.[0]?.order).toEqual([["scene/lobby", "scene/garden"]]);
  const ordered = screen.getByRole("list", { name: "New plotline scenes" });
  expect(
    within(ordered)
      .getAllByRole("checkbox")
      .map((el) => el.closest("label")?.textContent),
  ).toEqual(["Garden", "Lobby"]);
  expect(
    (screen.getByRole("button", { name: "Move Garden in New plotline up" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await user.click(screen.getByRole("button", { name: "Remove plotline" }));
  await user.clear(screen.getByLabelText("Timeline title"));
  await user.type(screen.getByLabelText("Timeline title"), "Parallel meetings");
  await user.click(screen.getByRole("button", { name: "Undo track removal" }));
  expect(story().plotlines).toHaveLength(1);
  expect(story().plotlines?.[0]?.scenes).toEqual(["garden", "lobby"]);
  expect(story().timelines?.[0]?.title).toBe("Parallel meetings");
  expect(checkCreation(canonicalizeCreation(current()).creation)).toMatchObject({ ok: true });
});

it("protects referenced objects and restores a removed definition without replacing other edits", async () => {
  const user = userEvent.setup();
  await renderReady(
    <Harness
      start={{
        ...initial,
        story: {
          ...(initial.story as Story),
          scenes: [{ id: "lobby", title: "Lobby", beats: ["trust"] }],
          beats: [{ id: "trust", title: "Trust", description: "Someone helps" }],
          endings: [{ id: "leave", title: "Leave", description: "The guest departs" }],
        },
      }}
    />,
  );
  expect(
    (screen.getByRole("button", { name: "Remove change" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await user.click(screen.getByLabelText("Lobby"));
  await user.click(screen.getByRole("button", { name: "Remove change" }));
  await user.clear(screen.getByLabelText("ending title"));
  await user.type(screen.getByLabelText("ending title"), "Departure");
  await user.click(screen.getByRole("button", { name: "Undo removal" }));
  expect(story().beats?.[0]?.id).toBe("trust");
  expect(story().endings?.[0]?.title).toBe("Departure");
});

it("keeps Undo available when a deleted dependency must be restored first", async () => {
  const user = userEvent.setup();
  await renderReady(
    <Harness
      start={{
        ...initial,
        story: {
          ...(initial.story as Story),
          beats: [
            {
              id: "trust",
              title: "Trust",
              description: "A guest helps",
              when: { visited: "scene/lobby" },
            },
          ],
        },
      }}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Remove change" }));
  await user.click(screen.getByRole("button", { name: "Remove lobby elsewhere" }));
  await user.click(screen.getByRole("button", { name: "Undo removal" }));
  expect(story().beats).toEqual([]);
  expect(screen.getByRole("alert").textContent).toContain("Cannot restore yet");
  await user.click(screen.getByRole("button", { name: "Restore lobby elsewhere" }));
  await user.click(screen.getByRole("button", { name: "Undo removal" }));
  expect(story().beats?.[0]?.when).toEqual({ visited: "scene/lobby" });
  expect(story().scenes[0]?.title).toBe("Restored lobby");
});

it("can undo an unfinished new change and continue writing its description", async () => {
  const user = userEvent.setup();
  await renderReady(<Harness />);
  await user.click(screen.getByText("Possible changes"));
  await user.click(screen.getByRole("button", { name: "Add change" }));
  await user.click(screen.getByRole("button", { name: "Remove change" }));
  await user.click(screen.getByRole("button", { name: "Undo removal" }));
  await user.type(screen.getByLabelText("What happens"), "The visitor offers to help.");
  expect(story().beats?.[0]?.description).toBe("The visitor offers to help.");
});
