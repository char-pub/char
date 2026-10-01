import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { DraftConflict } from "@/lib/use-draft-editor";
import { ConflictNotice } from "./draft-conflict";

const snapshot: DraftConflict = {
  base: { display_name: "Original" },
  local: { display_name: "Mine" },
  latest: { display_name: "Theirs", summary: "Keep the remote-only summary" },
  version: 12,
};

it("requires an explicit object choice, supports keyboard selection and preserves remote-only fields", async () => {
  const user = userEvent.setup();
  const reapplyConflict = vi.fn(async () => true);
  render(
    <ConflictNotice
      editor={{
        working: snapshot.local,
        reload: vi.fn(),
        reviewConflict: async () => snapshot,
        reapplyConflict,
      }}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Compare changes" }));
  const region = await screen.findByRole("region", { name: "Changes to review" });
  const save = within(region).getByRole("button", { name: "Apply choices and save" });
  expect(save.hasAttribute("disabled")).toBe(true);
  expect(reapplyConflict).not.toHaveBeenCalled();
  const group = within(region).getByRole("group", { name: "Name" });
  expect(within(group).getByText('"Mine"')).toBeTruthy();
  expect(within(group).getByText('"Theirs"')).toBeTruthy();
  const mine = within(group).getByRole("radio", { name: "Use my version" });
  mine.focus();
  await user.keyboard(" ");
  expect((mine as HTMLInputElement).checked).toBe(true);
  expect(save.hasAttribute("disabled")).toBe(false);
  await user.click(save);
  expect(reapplyConflict).toHaveBeenCalledWith(snapshot, {
    display_name: "Mine",
    summary: "Keep the remote-only summary",
  });
});

it("refreshing comparisons clears previous conflicting choices", async () => {
  const user = userEvent.setup();
  const reviewConflict = vi
    .fn()
    .mockResolvedValueOnce(snapshot)
    .mockResolvedValueOnce({ ...snapshot, version: 13, latest: { display_name: "New remote" } });
  const reapplyConflict = vi.fn(async () => true);
  render(
    <ConflictNotice
      editor={{ working: snapshot.local, reload: vi.fn(), reviewConflict, reapplyConflict }}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Compare changes" }));
  await user.click(await screen.findByRole("radio", { name: "Keep latest version" }));
  await user.click(screen.getByRole("button", { name: "Refresh comparison" }));
  expect(
    screen.getByRole("button", { name: "Apply choices and save" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByText('"New remote"')).toBeTruthy();
  expect(reapplyConflict).not.toHaveBeenCalled();
});

it("keeps recovery actions and explains failed reads or failed discard reloads", async () => {
  const user = userEvent.setup();
  const reload = vi.fn().mockRejectedValue(new Error("offline"));
  const reviewConflict = vi.fn().mockRejectedValue(new Error("offline"));
  render(
    <ConflictNotice
      editor={{ working: snapshot.local, reload, reviewConflict, reapplyConflict: vi.fn() }}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Compare changes" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Could not read the latest draft. Your edits are still here. Try comparing again.",
  );
  await user.click(screen.getByRole("button", { name: "Discard my edits and reload" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Could not reload the draft. Your edits have not been discarded.",
  );
  expect(screen.getByRole("button", { name: "Copy my version" })).toBeTruthy();
});
