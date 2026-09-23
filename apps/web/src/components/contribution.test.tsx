import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ContributionDetail } from "@/lib/api";
import { fakeClient, ME, renderWithApp } from "@/test/render";
import { authorLabel, timeAgo } from "./contribution-list";
import { ContributionReview } from "./contribution-review";

const OTHER = "usr_01j00000000000000000000001";

function detail(over: Partial<ContributionDetail> = {}): ContributionDetail {
  return {
    id: "ctb_01j00000000000000000000001",
    number: 1,
    title: "Mention the old lighthouse",
    status: "open",
    agent: false,
    author: { user: OTHER, display_name: "Other", namespace: "@other" },
    base_revision: "rev_01j00000000000000000000000",
    created_at: "2026-09-22T12:00:00.000Z",
    decided_at: null,
    changes: [
      {
        on: "metadata",
        field: "meta.rating",
        op: "set",
        after: "teen",
        sensitive: true,
      },
    ],
    preview: {
      mergeable: true,
      outcomes: [
        {
          key: "metadata:meta.rating",
          on: "metadata",
          op: "set",
          state: "applied",
          sensitive: true,
        },
      ],
      conflicts: [],
      sensitive_keys: ["metadata:meta.rating"],
    },
    result_revision: null,
    ...over,
  };
}

describe("authorLabel", () => {
  it("never makes a guest look like a signed-in user", () => {
    expect(authorLabel({ guest_id: "gst_1", display_name: "Wren" })).toBe("guest · Wren");
    expect(authorLabel({ guest_id: "gst_1", display_name: "Wren" }, { guest: "gst_1" })).toBe(
      "you",
    );
    expect(authorLabel({ user: OTHER, display_name: "Other", namespace: "@other" })).toBe(
      "Other (@other)",
    );
  });

  it("formats relative times", () => {
    const now = Date.parse("2026-09-23T12:00:00.000Z");
    expect(timeAgo("2026-09-21T12:00:00.000Z", now)).toBe("2 days ago");
    expect(timeAgo("2026-09-23T11:59:30.000Z", now)).toBe("just now");
  });
});

describe("ContributionReview", () => {
  it("accepts only after each sensitive change is confirmed, and sends only those keys", async () => {
    const acceptContribution = vi.fn(async () => ({
      status: "accepted" as const,
      revision: "rev_01j00000000000000000000009",
      semantic_digest: `sha256:${"c".repeat(64)}`,
      applied: ["metadata:meta.rating"],
      already_applied: [],
    }));
    renderWithApp(
      <ContributionReview ns="writer" name="mira" number={1} member meId={ME.id} />,
      fakeClient({ contribution: async () => detail(), acceptContribution }),
    );
    const accept = await screen.findByRole("button", { name: "Accept into the draft" });
    expect((accept as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(
      screen.getByLabelText("I have reviewed this rating change and accept it"),
    );
    expect((accept as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(accept);
    await waitFor(() =>
      expect(acceptContribution).toHaveBeenCalledWith("writer", "mira", 1, [
        "metadata:meta.rating",
      ]),
    );
    expect(await screen.findByRole("heading", { name: "Accepted" })).toBeTruthy();
  });

  it("shows the rejection reason to the contributor", async () => {
    renderWithApp(
      <ContributionReview ns="writer" name="mira" number={1} member={false} meId={OTHER} />,
      fakeClient({
        contribution: async () =>
          detail({
            status: "rejected",
            preview: null,
            decided_at: "2026-09-23T09:00:00.000Z",
            decision_reason: "The lighthouse was torn down.",
          }),
      }),
    );
    const rejected = await screen.findByRole("region", { name: "Rejected" });
    expect(within(rejected).getByText("The lighthouse was torn down.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Withdraw this contribution" })).toBeNull();
  });
});
