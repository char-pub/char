import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { OWNER_ME } from "@/lib/mock-api";
import { renderWithApi } from "@/test/render";
import { ContentPage, ReportsPage } from "./moderation";
import { TombstonePage } from "./tombstone";

const NOW = new Date("2026-09-22T12:00:00.000Z");

describe("tombstone four-eyes flow", () => {
  async function requestLargeTombstone(otherEligibleStaff: number) {
    const user = userEvent.setup();
    const r = renderWithApi(<TombstonePage now={() => NOW.getTime()} />, {
      me: OWNER_ME,
      now: () => NOW,
      otherEligibleStaff,
    });
    const subject = screen.getByLabelText(/Subject/);
    await user.clear(subject);
    await user.type(subject, "@commons/night-city#world");
    await user.click(screen.getByRole("button", { name: "Preview impact" }));
    const preview = await screen.findByRole("region", { name: "Impact preview" });
    expect(within(preview).getByText("needs a second staff member")).toBeTruthy();
    await user.selectOptions(
      within(preview).getByLabelText("Public reason code"),
      "policy.illegal",
    );
    await user.type(
      within(preview).getByLabelText(/Reason/),
      "illegal content confirmed by review",
    );
    await user.click(within(preview).getByRole("checkbox"));
    await user.click(within(preview).getByRole("button", { name: /Request tombstone/ }));
    await screen.findByText(/Waiting for confirmation/);
    return { ...r, user };
  }

  it("with a single eligible staff member shows the cooling-off period instead of a confirm button", async () => {
    await requestLargeTombstone(0);
    const approval = await screen.findByTestId("approval-ap1");
    expect(within(approval).getByTestId("cooling-off").textContent).toMatch(/24h 0m/);
    expect(within(approval).queryByRole("button", { name: "Confirm" })).toBeNull();
  });

  it("with other eligible staff waits for a second person", async () => {
    await requestLargeTombstone(2);
    const approval = await screen.findByTestId("approval-ap1");
    expect(
      within(approval).getByText("Waiting for a second staff member to confirm."),
    ).toBeTruthy();
    expect(within(approval).queryByRole("button", { name: "Confirm" })).toBeNull();
  });

  it("legal reason codes require selecting a legal request", async () => {
    const user = userEvent.setup();
    renderWithApi(<TombstonePage />, { me: OWNER_ME, now: () => NOW });
    await user.click(screen.getByRole("button", { name: "Preview impact" }));
    const preview = await screen.findByRole("region", { name: "Impact preview" });
    await user.type(within(preview).getByLabelText(/Reason/), "DMCA notice verified");
    await user.click(within(preview).getByRole("checkbox"));
    const submit = within(preview).getByRole("button", {
      name: "Execute tombstone",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.selectOptions(await within(preview).findByLabelText("Legal request"), "lr1");
    expect(submit.disabled).toBe(false);
    await user.click(submit);
    expect(await screen.findByText(/Tombstone executed/)).toBeTruthy();
  });
});

describe("user content is shown as text", () => {
  it("report details with markup are not interpreted", async () => {
    renderWithApi(<ReportsPage />, { me: OWNER_ME });
    const row = await screen.findByTestId("report-rp1");
    expect(within(row).getByText(/<script>alert\(1\)<\/script>/)).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
  });

  it("creation summaries with markup are not interpreted", async () => {
    renderWithApi(<ContentPage />, { me: OWNER_ME });
    expect(await screen.findByText(/<img src=x onerror=alert\(1\)>/)).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });

  it("sorts reports by severity and hides actions for viewers", async () => {
    renderWithApi(<ReportsPage />, {
      me: { email: "v@char.pub", roles: ["viewer"], capabilities: ["overview.read"] },
    });
    const rows = await screen.findAllByTestId(/^report-/);
    expect(rows.map((r) => r.dataset.testid)).toEqual(["report-rp1", "report-rp2", "report-rp3"]);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull());
  });
});
