import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { OWNER_ME, VIEWER_ME } from "@/lib/mock-api";
import { renderWithApi } from "@/test/render";
import { AuditPage } from "./audit";
import { diffRows, JsonDiff } from "./json-diff";

describe("json diff", () => {
  it("lists added, removed and changed fields", () => {
    expect(
      diffRows(
        { enabled: true, reason: "x", nested: { a: 1 } },
        { enabled: false, nested: { a: 1, b: 2 } },
      ),
    ).toEqual([
      { key: "enabled", before: "true", after: "false", change: "changed" },
      { key: "nested.a", before: "1", after: "1", change: "same" },
      { key: "nested.b", after: "2", change: "added" },
      { key: "reason", before: '"x"', change: "removed" },
    ]);
    expect(diffRows(null, null)).toEqual([]);
  });

  it("renders values as text", async () => {
    renderWithApi(<JsonDiff before={null} after={{ note: "<script>alert(1)</script>" }} />);
    expect(await screen.findByText('"<script>alert(1)</script>"')).toBeTruthy();
    expect(document.querySelector("script")).toBeNull();
  });
});

describe("audit log page", () => {
  it("expands an entry to show the before / after diff", async () => {
    const user = userEvent.setup();
    renderWithApi(<AuditPage />, { me: OWNER_ME });
    await user.click(await screen.findByRole("button", { name: "Show changes of entry 3" }));
    const diff = screen.getByRole("table", { name: "Field changes" });
    expect(within(diff).getByText("enabled")).toBeTruthy();
    expect(within(diff).getByText("changed")).toBeTruthy();
    expect(within(diff).getByText("added")).toBeTruthy();
  });

  it("verifies the hash chain for staff who can read everything", async () => {
    const user = userEvent.setup();
    renderWithApi(<AuditPage />, { me: OWNER_ME });
    await user.click(await screen.findByRole("button", { name: "Verify hash chain" }));
    expect((await screen.findByRole("status")).textContent).toContain("Chain intact");
  });

  it("viewers only see their own entries and cannot verify", async () => {
    renderWithApi(<AuditPage />, { me: VIEWER_ME });
    expect(await screen.findByText("No audit entries match.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Verify hash chain" })).toBeNull();
  });
});
