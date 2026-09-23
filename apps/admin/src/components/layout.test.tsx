import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OWNER_ME, VIEWER_ME } from "@/lib/mock-api";
import { renderWithApi } from "@/test/render";
import { StaffBar } from "./layout";
import { CsamPage, LegalPage } from "./legal";

describe("staff bar", () => {
  it("always shows the staff email, roles and the audit notice", async () => {
    renderWithApi(<StaffBar />, { me: OWNER_ME });
    expect((await screen.findByTestId("staff-email")).textContent).toBe("owner@char.pub");
    expect(screen.getByText("roles: owner")).toBeTruthy();
    expect(screen.getByText("Every action is recorded in the audit log.")).toBeTruthy();
  });
});

describe("restricted pages", () => {
  it("legal and CSAM pages are not shown to viewers", async () => {
    renderWithApi(
      <>
        <LegalPage />
        <CsamPage />
      </>,
      { me: VIEWER_ME },
    );
    expect(await screen.findAllByRole("alert")).toHaveLength(2);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("legal staff see legal requests", async () => {
    renderWithApi(<LegalPage />, { me: OWNER_ME });
    expect(await screen.findByText("lr1")).toBeTruthy();
  });
});
