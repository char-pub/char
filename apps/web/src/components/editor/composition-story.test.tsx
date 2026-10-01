import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import type { Working } from "@/lib/draft";
import { fakeClient, renderWithApp } from "@/test/render";
import { BindingField, CompositionEditor } from "./composition-editor";

it("limits cast binding choices without removing slot binding macros", () => {
  const working: Working = {
    cast: [{ key: "alice", who: "@writer/alice" }],
    references: [{ id: "world", use: "@writer/world", mode: "default" }],
  };
  render(
    <>
      <BindingField
        label="Cast identity"
        forCast
        working={working}
        value={{ late: "character" }}
        onChange={() => {}}
      />
      <BindingField label="Slot binding" working={working} value="{{self}}" onChange={() => {}} />
    </>,
  );
  const cast = screen.getByRole("combobox", { name: /Cast identity/ });
  expect(within(cast).queryByRole("option", { name: "{{self}}" })).toBeNull();
  expect(within(cast).queryByRole("option", { name: "{{cast:alice}}" })).toBeNull();
  expect(within(cast).queryByRole("option", { name: "@writer/world" })).toBeNull();
  expect(within(cast).getByRole("option", { name: "@writer/alice" })).toBeTruthy();
  expect(
    within(screen.getByRole("combobox", { name: /Slot binding/ })).getByRole("option", {
      name: "{{cast:alice}}",
    }),
  ).toBeTruthy();
});

it("retains cast Undo when its pinned dependency was removed", async () => {
  const initial: Working = {
    id: "cr_01j00000000000000000000000",
    ref: "@writer/inn",
    type: "scenario",
    display_name: "Inn",
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    cast: [
      { key: "alice", who: "@writer/alice" },
      { key: "user", who: { late: "persona" } },
    ],
    references: [
      {
        id: "alice",
        use: "@writer/alice",
        mode: "intrinsic",
        pin: {
          release: "rel_01j00000000000000000000001",
          semantic_digest: `sha256:${"a".repeat(64)}`,
        },
      },
    ],
    story: { version: 1, scenes: [{ id: "lobby", title: "Lobby" }] },
  };
  function Editor() {
    const [working, update] = useState(initial);
    return (
      <>
        <CompositionEditor type="scenario" working={working} update={update} />
        <button type="button" onClick={() => update((w) => ({ ...w, references: [] }))}>
          Remove dependency elsewhere
        </button>
        <button
          type="button"
          onClick={() => update((w) => ({ ...w, references: initial.references ?? [] }))}
        >
          Restore dependency elsewhere
        </button>
        <output data-testid="cast">{JSON.stringify(working.cast)}</output>
      </>
    );
  }
  renderWithApp(<Editor />, fakeClient({ me: async () => null }));
  const user = userEvent.setup();
  await screen.findByText("Cast and roles");
  await user.click(
    screen.getAllByRole("button", { name: "Remove cast member" })[0] as HTMLButtonElement,
  );
  await user.click(screen.getByRole("button", { name: "Remove dependency elsewhere" }));
  await user.click(screen.getByRole("button", { name: "Undo cast removal" }));
  expect(screen.getByRole("alert").textContent).toContain("Dependencies changed");
  expect(screen.getByTestId("cast").textContent).not.toContain("alice");
  await user.click(screen.getByRole("button", { name: "Restore dependency elsewhere" }));
  await user.click(screen.getByRole("button", { name: "Undo cast removal" }));
  expect(JSON.parse(screen.getByTestId("cast").textContent ?? "[]")).toEqual(initial.cast);
});
