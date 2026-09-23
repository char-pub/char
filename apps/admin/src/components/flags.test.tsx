import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { OWNER_ME, VIEWER_ME } from "@/lib/mock-api";
import { renderWithApi } from "@/test/render";
import { FlagsPage } from "./flags";

describe("kill switches", () => {
  it("lists every flag and marks the high-impact ones", async () => {
    renderWithApi(<FlagsPage />);
    const row = await screen.findByTestId("flag-read_only");
    expect(within(row).getByLabelText("High impact")).toBeTruthy();
    expect(within(screen.getByTestId("flag-uploads")).queryByLabelText("High impact")).toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(8);
  });

  it("does not show the switch button without the flags.toggle capability", async () => {
    renderWithApi(<FlagsPage />, { me: VIEWER_ME });
    await screen.findByTestId("flag-uploads");
    await waitFor(() => expect(screen.queryByRole("button", { name: /switch off/i })).toBeNull());
  });

  it("requires a reason of at least 10 characters and a confirmation before switching", async () => {
    const user = userEvent.setup();
    const { api } = renderWithApi(<FlagsPage />, { me: OWNER_ME });
    const row = await screen.findByTestId("flag-uploads");
    await user.click(await within(row).findByRole("button", { name: "Switch off" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/within 5 seconds/)).toBeTruthy();
    const submit = within(dialog).getByRole("button", { name: /switch off uploads/i });
    const reason = within(dialog).getByLabelText(/Reason/);

    await user.type(reason, "too short");
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByText("1 more character required.")).toBeTruthy();

    await user.type(reason, "!");
    // 理由够长但还没勾选确认。
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(dialog).getByRole("checkbox"));
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    await user.click(submit);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const flags = await api.listFlags();
    expect(flags.find((f) => f.key === "uploads")).toMatchObject({
      enabled: false,
      reason: "too short!",
    });
    const audit = await api.listAudit({});
    expect(audit.items[0]).toMatchObject({ action: "flag.toggle", subject: "flag:uploads" });
  });
});
