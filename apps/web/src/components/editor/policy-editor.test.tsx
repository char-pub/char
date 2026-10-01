import { canonicalizeCreation, resolvePreset } from "@char-pub/core";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import type { Working } from "@/lib/draft";
import { fakeClient, renderWithApp } from "@/test/render";
import { defaultPolicy, PolicyEditor } from "./policy-editor";

function Editor() {
  const [working, update] = useState<Working>({
    id: "cr_01j00000000000000000000000",
    ref: "@writer/preset",
    type: "preset",
    display_name: "Preset",
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
    policy: defaultPolicy(),
  });
  return (
    <>
      <PolicyEditor working={working} update={update} />
      <output data-testid="source">{JSON.stringify(working)}</output>
    </>
  );
}

it("authors two placements without duplicating the underlying block definition", async () => {
  renderWithApp(<Editor />, fakeClient({ me: async () => null }));
  await userEvent.click(await screen.findByText("Arrange and repeat blocks"));
  expect(
    (screen.getByRole("button", { name: "Add placement" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Add prompt block" }));
  await userEvent.type(
    screen.getByLabelText("Purpose of instructions"),
    "Keep the player's agency",
  );
  await userEvent.click(screen.getByRole("button", { name: "Add placement" }));
  await userEvent.click(screen.getByRole("button", { name: "Add placement" }));
  const placements = screen.getByRole("list", { name: "Block placements" });
  const rows = within(placements).getAllByRole("listitem");
  const second = rows[1];
  if (!second) throw new Error("Missing placement row");
  await userEvent.selectOptions(within(second).getByRole("combobox"), "after-history");
  const creation = canonicalizeCreation(
    JSON.parse(screen.getByTestId("source").textContent ?? "{}"),
  );
  const resolved = resolvePreset({
    creation: creation.creation,
    release: "rel_01j00000000000000000000000",
    semantic_digest: creation.semantic_digest,
  });
  expect(creation.creation.policy?.blocks).toHaveLength(1);
  expect(resolved.policy.blocks.map((b) => b.position)).toEqual(["main", "after-history"]);
  expect(new Set(resolved.policy.blocks.map((b) => b.id)).size).toBe(2);
  expect(resolved.policy.blocks[1]?.purpose).toBe("Keep the player's agency");
});
