import { type CreationInput, canonicalizeCreation } from "@char-pub/core";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { Working } from "@/lib/draft";
import { fakeClient, ME, renderWithApp } from "@/test/render";
import { ContributionForm } from "./contribution-form";

let pendingUpdate: ((fn: (w: Working) => Working) => void) | undefined;
vi.mock("./editor/sources-editor", () => ({
  SourcesEditor: ({ update }: { update: (fn: (w: Working) => Working) => void }) => (
    <div>
      <button
        type="button"
        onClick={() => {
          pendingUpdate = update;
        }}
      >
        Start pending attachment
      </button>
      <button
        type="button"
        onClick={() =>
          pendingUpdate?.((w) => ({
            ...w,
            groups: [{ id: "notes", title: "Notes", description: "Attached notes" }],
          }))
        }
      >
        Finish pending attachment
      </button>
    </div>
  ),
}));
const root: CreationInput = {
  id: "cr_01j00000000000000000000001",
  ref: "@writer/port",
  type: "scenario",
  display_name: "Port",
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
  cast: [{ key: "visitor", who: { late: "persona" } }],
  fragments: [
    {
      id: "premise",
      kind: "scenario",
      stable: true,
      content: { type: "text", text: "Meet at the port." },
    },
  ],
  story: { version: 1, scenes: [{ id: "port", title: "Port" }] },
};
it("applies a delayed editor update to the latest proposal without losing intervening text", async () => {
  const base = canonicalizeCreation(root);
  const submitContribution = vi.fn(async () => ({
    id: "ctb_1",
    number: 1,
    status: "open",
    agent: false,
    sensitive_keys: [],
  }));
  renderWithApp(
    <ContributionForm
      ns="writer"
      name="port"
      label="1.0.0"
      type="scenario"
      onSubmitted={() => {}}
    />,
    fakeClient({
      me: async () => ME,
      releaseSource: async () => ({
        revision: "rev_01j00000000000000000000001",
        semantic_digest: base.semantic_digest,
        creation: base.json,
      }),
      submitContribution,
    }),
  );
  await userEvent.click(await screen.findByRole("button", { name: "Start pending attachment" }));
  const passage = screen.getByRole("textbox", { name: /#premise/ });
  await userEvent.clear(passage);
  await userEvent.type(passage, "The visitor arrives with a sealed letter.");
  await userEvent.click(screen.getByRole("button", { name: "Finish pending attachment" }));
  expect((passage as HTMLTextAreaElement).value).toBe("The visitor arrives with a sealed letter.");
  await userEvent.type(screen.getByLabelText("Title", { exact: true }), "A letter at the port");
  await userEvent.click(screen.getByRole("checkbox", { name: /I license my contribution/ }));
  await userEvent.click(screen.getByRole("button", { name: "Submit 2 changes" }));
  await waitFor(() => expect(submitContribution).toHaveBeenCalledTimes(1));
  expect(submitContribution.mock.calls[0]).toEqual([
    "writer",
    "port",
    expect.objectContaining({
      changes_version: 1,
      changes: expect.arrayContaining([
        expect.objectContaining({
          on: "fragment",
          id: "premise",
          after: expect.objectContaining({
            content: { type: "text", text: "The visitor arrives with a sealed letter." },
          }),
        }),
        expect.objectContaining({ on: "group", id: "notes", op: "add" }),
      ]),
    }),
  ]);
});
