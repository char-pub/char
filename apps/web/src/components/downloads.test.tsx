import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fakeClient, ME, renderWithApp } from "@/test/render";
import { DownloadMenu } from "./downloads";

describe("CCv3 export review", () => {
  it("shows the actual loss report and downloads the card separately from its wrapper", async () => {
    const exportCcv3 = vi.fn(async () => ({
      state: "ready" as const,
      url: "https://api.test/export/ccv3",
    }));
    const getCcv3Loss = vi.fn(async () => ({
      target: "ccv3" as const,
      profile: { mode: "narrator" as const, tokenizer: "estimate" as const },
      flattened_dependencies: [],
      activation_downgrades: [],
      visibility: [],
      participants: [],
      context_assets: [],
      locales: { exported: "en", dropped: ["ja"] },
      policy_fields: [],
      other: [{ subject: "assembly", detail: "Runtime budget is not preserved." }],
      tokens: { description: 1, scenario: 0, character_book: 0, mes_example: 0, total: 1 },
    }));
    renderWithApp(
      <DownloadMenu ns="writer" name="hero" label="1.0.0" canExportCard />,
      fakeClient({ me: async () => ME, exportCcv3, getCcv3Loss }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Download" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Character card/ }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Prepare selected settings" }),
    );
    const report = await screen.findByRole("region", { name: "Export loss report" });
    expect(report.textContent).toContain("1 other changes");
    expect(exportCcv3).toHaveBeenCalledWith("writer", "hero", "1.0.0", undefined);
    expect(getCcv3Loss).toHaveBeenCalledWith("writer", "hero", "1.0.0", undefined);
    expect(
      within(report).getByRole("link", { name: "Download character card" }).getAttribute("href"),
    ).toBe("https://api.test/export/ccv3?part=card");
    expect(
      within(report).getByRole("link", { name: "Download loss report" }).getAttribute("href"),
    ).toBe("https://api.test/export/ccv3?part=loss");
    await userEvent.click(within(report).getByText("Full loss report"));
    expect(report.textContent).toContain("Runtime budget is not preserved.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Omit policy" }));
    expect(screen.queryByRole("region", { name: "Export loss report" })).toBeNull();
  });
});
