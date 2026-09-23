import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { createMockApi, OWNER_ME } from "@/lib/mock-api";
import { renderWithApi } from "@/test/render";
import { LegalPage } from "./legal";

it("shows the account, purpose and reason of a self-service deletion request to reviewers", async () => {
  const api = createMockApi({ me: OWNER_ME });
  const detail = await api.getLegalRequest("lr1");
  api.getLegalRequest = async () => ({
    ...detail,
    kind: "gdpr",
    requester: {
      name: "usr_requester",
      user: "usr_requester",
      request: "account_deletion",
      reason: "Please remove my personal account data.",
    },
  });
  renderWithApi(<LegalPage />, { api });
  const row = await screen.findByTestId("legal-lr1");
  await userEvent.click(within(row).getByRole("button", { name: "Open" }));
  const dialog = await screen.findByRole("dialog");
  expect(await within(dialog).findByText("Account deletion")).toBeTruthy();
  expect(within(dialog).getByTestId("legal-requester").textContent).toContain("usr_requester");
  expect(within(dialog).getByText("Please remove my personal account data.")).toBeTruthy();
});
