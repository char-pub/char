import type { Fragment } from "@char-pub/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { aboutRestoreError, draftAboutTarget, incomingAbout } from "@/lib/about-editor";
import type { Working } from "@/lib/draft";
import { ContentGroups } from "./content-groups";
import { FragmentAbout } from "./fragment-about";
import { FragmentsEditor } from "./fragments-editor";

const fragments: Fragment[] = [
  { id: "world", stable: true, kind: "world", content: { type: "text", text: "An inn" } },
  {
    id: "rumor",
    stable: true,
    kind: "knowledge",
    content: { type: "text", text: "A rumor" },
    about: ["@writer/inn#world", "cast:alice"],
  },
];
const initial: Working = {
  type: "world",
  ref: "@writer/inn",
  fragments,
  cast: [{ key: "alice", who: { late: "character" } }],
  groups: [{ id: "g", title: "Rumors", description: "Said locally", entries: ["rumor"] }],
};
it("treats local/self aliases as the same backlink but preserves foreign references and exact participant keys", () => {
  expect(incomingAbout(initial, { kind: "fragment", id: "world" }).map((f) => f.id)).toEqual([
    "rumor",
  ]);
  expect(draftAboutTarget(initial, "cast:alice")).toEqual({ kind: "participant", id: "alice" });
  expect(draftAboutTarget(initial, "cast:alice#world")).toBeNull();
  expect(draftAboutTarget(initial, "@writer/other#world")).toBeNull();
  expect(draftAboutTarget(initial, "#group/g")).toBeNull();
});
it("edits associations without copying content, changing visibility or activating targets", async () => {
  const onNavigate = vi.fn();
  const original = fragments[1];
  if (!original) throw new Error("missing fixture");
  function Editor({ seed }: { seed: Fragment }) {
    const [fragment, onChange] = useState(seed);
    return (
      <>
        <FragmentAbout
          working={initial}
          fragment={fragment}
          onChange={onChange}
          onNavigate={onNavigate}
        />
        <output data-testid="fragment">{JSON.stringify(fragment)}</output>
      </>
    );
  }
  render(<Editor seed={original} />);
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "About target for rumor" }),
    "@writer/inn",
  );
  await userEvent.click(screen.getByRole("button", { name: "View cast:alice" }));
  expect(onNavigate).toHaveBeenCalledWith("cast:alice");
  await userEvent.click(
    screen.getByRole("button", { name: "Remove about @writer/inn#world from rumor" }),
  );
  const next = JSON.parse(screen.getByTestId("fragment").textContent ?? "{}");
  expect(next.about).toEqual(["cast:alice", "@writer/inn"]);
  expect(next.content).toEqual(original.content);
  expect(next).not.toHaveProperty("visibility");
  expect(next).not.toHaveProperty("activation");
  await userEvent.click(screen.getByRole("button", { name: "Undo about link removal" }));
  expect(JSON.parse(screen.getByTestId("fragment").textContent ?? "{}").about).toEqual([
    "@writer/inn#world",
    "cast:alice",
    "@writer/inn",
  ]);
});
it("navigates from a filtered group to the target and back using actual entry cards", async () => {
  function Editor() {
    const [working, update] = useState(initial);
    return (
      <ContentGroups
        working={working}
        update={update}
        renderEntries={(ids, onNavigate) => (
          <FragmentsEditor
            type="world"
            working={working}
            update={update}
            diagnostics={[]}
            visibleIds={ids}
            onNavigate={onNavigate}
          />
        )}
      />
    );
  }
  render(<Editor />);
  await userEvent.click(screen.getByRole("button", { name: "Rumors" }));
  expect(screen.queryByRole("listitem", { name: "Passage 1" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "View @writer/inn#world" }));
  const target = screen.getByRole("listitem", { name: "Passage 1" });
  expect(within(target).getByRole("button", { name: "Open related entry rumor" })).toBeTruthy();
  await userEvent.click(within(target).getByRole("button", { name: "Open related entry rumor" }));
  expect(screen.getByRole("listitem", { name: "Passage 2" })).toBeTruthy();
});

it("refuses to restore a cast fragment link after its owner was removed or rebound", () => {
  expect(aboutRestoreError({ ...initial, cast: [] }, initial, "cast:alice#secret")).toContain(
    "removed or rebound",
  );
  expect(
    aboutRestoreError(
      { ...initial, cast: [{ key: "alice", who: "@writer/bob" }] },
      initial,
      "cast:alice#secret",
    ),
  ).toContain("removed or rebound");
  expect(
    aboutRestoreError({ ...initial, summary: "later edit" }, initial, "cast:alice#secret"),
  ).toBeNull();
});
