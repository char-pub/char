import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import type { Working } from "@/lib/draft";
import { FragmentsEditor } from "./fragments-editor";

const initial: Working = {
  type: "world",
  ref: "@writer/inn",
  fragments: [
    { id: "world", stable: true, kind: "world", content: { type: "text", text: "World text" } },
    {
      id: "door",
      stable: true,
      kind: "knowledge",
      content: { type: "text", text: "Door text" },
      source: { use: "#source/book" },
    },
  ],
  sources: [{ id: "book", title: "Book", description: "Reference", asset: "book", format: "text" }],
};
function Editor({ start = initial }: { start?: Working }) {
  const [working, update] = useState(start);
  return (
    <>
      <FragmentsEditor
        type="world"
        working={working}
        update={update}
        diagnostics={[]}
        visibleIds={["door"]}
      />
      <button type="button" onClick={() => update((w) => ({ ...w, sources: [] }))}>
        Remove source
      </button>
      <output data-testid="working">{JSON.stringify(working)}</output>
    </>
  );
}
const current = (): Working => JSON.parse(screen.getByTestId("working").textContent ?? "{}");
it("edits a filtered row in the original array and protects its ID and deletion when grouped", async () => {
  render(
    <Editor
      start={{
        ...initial,
        groups: [{ id: "history", title: "History", description: "Past", entries: ["door"] }],
      }}
    />,
  );
  const row = screen.getByRole("listitem", { name: "Passage 2" });
  expect(screen.queryByRole("listitem", { name: "Passage 1" })).toBeNull();
  await userEvent.clear(within(row).getByLabelText("Text"));
  await userEvent.type(within(row).getByLabelText("Text"), "Changed door");
  expect(current().fragments?.[0]?.content).toEqual({ type: "text", text: "World text" });
  expect(current().fragments?.[1]?.content).toEqual({ type: "text", text: "Changed door" });
  expect((within(row).getByLabelText("ID") as HTMLInputElement).readOnly).toBe(true);
  await userEvent.click(within(row).getByRole("button", { name: "Remove" }));
  expect(screen.getByRole("alert").textContent).toContain("groups[history].entries");
  expect(current().fragments).toHaveLength(2);
});
it("refuses undo after the removed passage's source was deleted", async () => {
  render(<Editor />);
  await userEvent.click(screen.getByRole("button", { name: "Remove" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove source" }));
  await userEvent.click(screen.getByRole("button", { name: "Undo passage removal" }));
  expect(screen.getByRole("alert").textContent).toContain("Restore source book");
  expect(current().fragments).toHaveLength(1);
});
