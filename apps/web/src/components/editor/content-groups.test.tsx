import { type ContentGroup, canonicalizeCreation, checkCreation } from "@char-pub/core";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import type { Working } from "@/lib/draft";
import { editorLocation } from "@/lib/editor-location";
import { ContentGroups } from "./content-groups";
import { FragmentsEditor } from "./fragments-editor";

const initial: Working = {
  id: "cr_01j00000000000000000000001",
  ref: "@writer/library",
  type: "lorebook",
  display_name: "Library",
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
  fragments: ["door", "case", "loose"].map((id) => ({
    id,
    kind: "knowledge",
    stable: true,
    content: { type: "text", text: `${id} body` },
  })),
};
function Harness({ start = initial }: { start?: Working }) {
  const [working, update] = useState(start);
  return (
    <>
      <ContentGroups
        working={working}
        update={update}
        renderEntries={(ids) => (
          <ul aria-label="Edited entries">
            {ids.map((id) => (
              <li key={id}>{id}</li>
            ))}
          </ul>
        )}
      />
      <button type="button" onClick={() => update((w) => ({ ...w, summary: "Later edit" }))}>
        Edit summary elsewhere
      </button>
      <button
        type="button"
        onClick={() =>
          update((w) => ({
            ...w,
            fragments: (w.fragments ?? []).filter((fragment) => fragment.id !== "door"),
          }))
        }
      >
        Remove door elsewhere
      </button>
      <output data-testid="working">{JSON.stringify(working)}</output>
    </>
  );
}
function current(): Working {
  return JSON.parse(screen.getByTestId("working").textContent ?? "{}");
}
function groups() {
  return (current().groups as ContentGroup[] | undefined) ?? [];
}
async function create(title: string, description: string) {
  await userEvent.click(screen.getByRole("button", { name: "New group" }));
  await userEvent.type(screen.getByLabelText("New group title"), title);
  await userEvent.type(screen.getByLabelText("New group description"), description);
  await userEvent.click(screen.getByRole("button", { name: "Create group" }));
}
function nav() {
  return screen.getByRole("navigation", { name: "Group navigation" });
}

it("creates a described group and keeps multi-membership entries as references", async () => {
  render(<Harness />);
  await create("Buildings", "Doors and exits");
  await userEvent.click(screen.getByLabelText("Include entry door"));
  await create("History", "The old disappearance");
  await userEvent.click(screen.getByLabelText("Include entry door"));
  await userEvent.click(screen.getByLabelText("Include entry case"));
  expect(current().fragments).toEqual(initial.fragments);
  expect(groups().map((group) => group.entries)).toEqual([["door"], ["door", "case"]]);
  await userEvent.click(within(nav()).getByRole("button", { name: "Ungrouped (1)" }));
  expect(screen.getByRole("list", { name: "Edited entries" }).textContent).toBe("loose");
  expect(checkCreation(canonicalizeCreation(current()).creation).ok).toBe(true);
});

it("retains group translations when editing the default language", async () => {
  render(
    <Harness
      start={{
        ...initial,
        groups: [
          {
            id: "building",
            title: { en: "Building", ja: "建物" },
            description: { en: "Doors", ja: "入口" },
            entries: ["door"],
          },
        ],
      }}
    />,
  );
  await userEvent.click(within(nav()).getByRole("button", { name: "Building" }));
  await userEvent.clear(screen.getByLabelText("Group title"));
  await userEvent.type(screen.getByLabelText("Group title"), "The inn");
  await userEvent.clear(screen.getByLabelText("Group description"));
  await userEvent.type(screen.getByLabelText("Group description"), "Doors and cellar");
  expect(groups()[0]).toMatchObject({
    title: { en: "The inn", ja: "建物" },
    description: { en: "Doors and cellar", ja: "入口" },
    entries: ["door"],
  });
});

it("nests references to three levels, prevents cycles, and protects inbound group references", async () => {
  render(
    <Harness
      start={{
        ...initial,
        groups: ["a", "b", "c", "d"].map((id, index) => ({
          id,
          title: id.toUpperCase(),
          description: id,
          ...(index < 2 ? { groups: [String.fromCharCode(id.charCodeAt(0) + 1)] } : {}),
        })),
      }}
    />,
  );
  await userEvent.click(within(nav()).getByRole("button", { name: "C" }));
  await userEvent.click(screen.getByText("Nested groups", { exact: true }));
  expect((screen.getByLabelText("Nest group a") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText("Nest group d") as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText(/three group levels/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Remove group" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(screen.getByText(/Used by: groups\[b\].groups/)).toBeTruthy();
  await userEvent.click(within(nav()).getByRole("button", { name: "B" }));
  await userEvent.click(screen.getByLabelText("Nest group c"));
  await userEvent.click(within(nav()).getByRole("button", { name: "C" }));
  await userEvent.click(screen.getByLabelText("Nest group d"));
  expect(groups().find((group) => group.id === "c")?.groups).toEqual(["d"]);
  expect(checkCreation(canonicalizeCreation(current()).creation).ok).toBe(true);
});

it("removes only a group and restores it without reverting a later edit", async () => {
  render(
    <Harness
      start={{
        ...initial,
        groups: [{ id: "building", title: "Building", description: "Doors", entries: ["door"] }],
      }}
    />,
  );
  await userEvent.click(within(nav()).getByRole("button", { name: "Building" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove group" }));
  expect(current().fragments).toEqual(initial.fragments);
  expect(screen.getByRole("list", { name: "Edited entries" }).textContent).toBe("doorcaseloose");
  await userEvent.click(screen.getByRole("button", { name: "Edit summary elsewhere" }));
  await userEvent.click(screen.getByRole("button", { name: "Undo group removal" }));
  expect(groups()).toEqual([
    { id: "building", title: "Building", description: "Doors", entries: ["door"] },
  ]);
  expect(current().summary).toBe("Later edit");
});

it("keeps undo pending when a deleted group's fragment has since been removed", async () => {
  render(
    <Harness
      start={{
        ...initial,
        groups: [{ id: "building", title: "Building", description: "Doors", entries: ["door"] }],
      }}
    />,
  );
  await userEvent.click(within(nav()).getByRole("button", { name: "Building" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove group" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove door elsewhere" }));
  await userEvent.click(screen.getByRole("button", { name: "Undo group removal" }));
  expect(groups()).toEqual([]);
  expect(screen.getByRole("alert").textContent).toContain("entry door");
  expect(screen.getByRole("button", { name: "Undo group removal" })).toBeTruthy();
});

it("protects group references from Story lore and self-root fixture selections", async () => {
  render(
    <Harness
      start={{
        ...initial,
        groups: [{ id: "building", title: "Building", description: "Doors" }],
        story: { version: 1, scenes: [{ id: "room", title: "Room", lore: ["#group/building"] }] },
        assembly_tests: [
          {
            id: "example",
            root: "self",
            session: {},
            selection: [{ group: "@writer/library#group/building~root" }],
            expected: { kind: "error", code: "example" },
          },
        ],
      }}
    />,
  );
  await userEvent.click(within(nav()).getByRole("button", { name: "Building" }));
  expect((screen.getByRole("button", { name: "Remove group" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(screen.getByText(/story.scenes\[room\].lore\[0\]/)).toBeTruthy();
  expect(screen.getByText(/assembly_tests\[example\].selection/)).toBeTruthy();
});

it("can undo an unfinished group description and continue editing without losing translations", async () => {
  render(
    <Harness
      start={{
        ...initial,
        groups: [
          {
            id: "building",
            title: "Building",
            description: { en: "", ja: "入口" },
            entries: ["door"],
          },
        ],
      }}
    />,
  );
  await userEvent.click(within(nav()).getByRole("button", { name: "Building" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove group" }));
  await userEvent.click(screen.getByRole("button", { name: "Undo group removal" }));
  expect(groups()[0]?.description).toEqual({ en: "", ja: "入口" });
  await userEvent.type(screen.getByLabelText("Group description"), "Doors and exits");
  expect(checkCreation(canonicalizeCreation(current()).creation).ok).toBe(true);
  expect(groups()[0]?.description).toEqual({ en: "Doors and exits", ja: "入口" });
});

it("reveals and focuses a filtered passage once, without trapping later manual group navigation", async () => {
  function Editor() {
    const [working, update] = useState<Working>({
      ...initial,
      groups: [{ id: "doors", title: "Doors", description: "Entrances", entries: ["door"] }],
    });
    const [request, setRequest] = useState(0);
    const target = editorLocation(working, "fragments[case].content");
    if (!target) throw new Error("location missing");
    return (
      <>
        <button type="button" onClick={() => setRequest((n) => n + 1)}>
          Locate case passage
        </button>
        <ContentGroups
          working={working}
          update={update}
          navigation={request ? { ...target, request } : undefined}
          renderEntries={(ids, onNavigate) => (
            <FragmentsEditor
              type="lorebook"
              working={working}
              update={update}
              diagnostics={[]}
              visibleIds={ids}
              onNavigate={onNavigate}
            />
          )}
        />
      </>
    );
  }
  render(<Editor />);
  const group = () => within(nav()).getByRole("button", { name: "Doors" });
  await userEvent.click(group());
  expect(screen.queryByRole("listitem", { name: "Passage 2" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Locate case passage" }));
  await waitFor(() => {
    const row = screen.getByRole("listitem", { name: "Passage 2" });
    expect(document.activeElement).toBe(within(row).getByLabelText("ID"));
  });
  await userEvent.click(group());
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  expect(screen.queryByRole("listitem", { name: "Passage 2" })).toBeNull();
  expect(document.activeElement).toBe(group());
  await userEvent.click(screen.getByRole("button", { name: "Locate case passage" }));
  await waitFor(() => {
    const row = screen.getByRole("listitem", { name: "Passage 2" });
    expect(document.activeElement).toBe(within(row).getByLabelText("ID"));
  });
});
