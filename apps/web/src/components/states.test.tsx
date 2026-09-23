import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { renderWithApp } from "@/test/render";
import { StatusBadge, Tag, TypeBadge } from "./badges";
import { RatingBadge } from "./rating";
import { SignInRequired } from "./sign-in-required";
import { EmptyState, ErrorState, NotFound, RemovedState } from "./states";

describe("page states", () => {
  it("offers a retry when loading fails and shows the error code", async () => {
    const retry = vi.fn();
    render(
      <ErrorState
        title="Search is unavailable right now"
        description="Your filters are kept."
        error={new ApiError(500, "internal")}
        onRetry={retry}
      />,
    );
    expect(screen.getByRole("heading", { name: "Search is unavailable right now" })).toBeTruthy();
    expect(screen.getByText("internal")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("calls a paused feature temporarily unavailable instead of an error", () => {
    render(<ErrorState title="Could not publish" error={new ApiError(503, "feature.disabled")} />);
    expect(screen.getByRole("heading", { name: "Temporarily unavailable" })).toBeTruthy();
    expect(screen.queryByText("Could not publish")).toBeNull();
  });

  it("uses one 404 that does not hint at private content", async () => {
    renderWithApp(<NotFound what="@djj/unknown" />);
    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Nothing at @djj/unknown");
    expect(document.body.textContent).not.toMatch(/permission|private|sign in/i);
    expect(screen.getByRole("link", { name: "Explore the registry" }).getAttribute("href")).toBe(
      "/browse",
    );
  });

  it("shows the public reason for removed content", () => {
    render(<RemovedState reason="legal.dmca" />);
    expect(screen.getByText("legal.dmca")).toBeTruthy();
    expect(screen.getByText(/Other versions may still be available/)).toBeTruthy();
  });

  it("gives an empty state a next step", () => {
    render(<EmptyState title="No creations yet" action={<button type="button">Create</button>} />);
    expect(screen.getByRole("heading", { name: "No creations yet" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
  });

  it("puts the sign-in button on pages that need an account", async () => {
    renderWithApp(<SignInRequired what="see your creations" />);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Sign in to see your creations" }),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    const dialog = await screen.findByRole("dialog", { name: "Sign in to char.pub" });
    expect(within(dialog).getByRole("button", { name: "Continue with GitHub" })).toBeTruthy();
  });
});

describe("badges", () => {
  it("labels types, ratings and statuses", async () => {
    renderWithApp(
      <div>
        <TypeBadge type="world" />
        <RatingBadge rating="explicit" />
        <StatusBadge status="tombstoned" />
        <StatusBadge status="yanked" label="Yanked · v1.2.0" />
        <Tag tag="cyberpunk" />
      </div>,
    );
    expect(await screen.findByText("World")).toBeTruthy();
    expect(screen.getByText("Explicit").getAttribute("data-variant")).toBe("danger-solid");
    expect(screen.getByText("Removed")).toBeTruthy();
    expect(screen.getByText("Yanked · v1.2.0")).toBeTruthy();
    expect(screen.getByRole("link", { name: "cyberpunk" }).getAttribute("href")).toBe(
      "/browse?tag=cyberpunk",
    );
  });
});
