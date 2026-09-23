import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { diffPair, resolveSample } from "@/fixtures/samples";
import { CreationPage } from "./creation-page";
import { MatureGate } from "./mature-gate";
import { UserMarkdown, UserText } from "./user-content";

describe("MatureGate", () => {
  it("hides mature content until the user confirms", async () => {
    render(
      <MatureGate rating="mature">
        <p>secret scene</p>
      </MatureGate>,
    );
    expect(screen.queryByText("secret scene")).toBeNull();
    expect(screen.getByText("Mature content is hidden")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show mature content" }));
    expect(screen.getByText("secret scene")).toBeTruthy();
  });

  it("shows general and teen content directly, and respects the account setting", () => {
    const { rerender } = render(
      <MatureGate rating="teen">
        <p>teen scene</p>
      </MatureGate>,
    );
    expect(screen.getByText("teen scene")).toBeTruthy();
    rerender(
      <MatureGate rating="explicit" allowed>
        <p>allowed scene</p>
      </MatureGate>,
    );
    expect(screen.getByText("allowed scene")).toBeTruthy();
  });
});

describe("user content is never executed", () => {
  it("renders <script> in markdown as text, not as an element", () => {
    const { container } = render(
      <UserMarkdown
        text={'Hello <script>window.__pwned = 1</script> <img src=x onerror="alert(1)">'}
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("drops javascript: links", () => {
    const { container } = render(<UserMarkdown text="[click](javascript:alert(1))" />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("click");
  });

  it("keeps safe links with rel protections", () => {
    const { container } = render(<UserMarkdown text="[site](https://example.com)" />);
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(a?.getAttribute("rel")).toContain("noopener");
  });

  it("plain text shows markup literally", () => {
    const { container } = render(<UserText text="<script>alert(1)</script>" />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toBe("<script>alert(1)</script>");
  });
});

describe("CreationPage", () => {
  it("explains where the effective rating comes from and gates mature content", async () => {
    const ir = resolveSample(diffPair.to).ir;
    render(<CreationPage ir={ir} summary="A courier." />);
    expect(ir.meta.rating).toBe("mature");
    expect(screen.getByText("Why this rating")).toBeTruthy();
    expect(screen.getByText("sets the rating")).toBeTruthy();
    expect(screen.getByText("Night City")).toBeTruthy();
    expect(screen.queryByText("What it says")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show mature content" }));
    expect(screen.getByText("What it says")).toBeTruthy();
  });
});
