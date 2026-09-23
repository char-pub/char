import { diffContextIR } from "@char-pub/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { diffPair, locksOf, resolveSample } from "@/fixtures/samples";
import { DiffView } from "./diff-view";

function upgradeDiff(withTokens = true) {
  return diffContextIR(resolveSample(diffPair.from).ir, resolveSample(diffPair.to).ir, {
    locks: { from: locksOf(diffPair.from), to: locksOf(diffPair.to) },
    ...(withTokens ? { countTokens: (t: string) => Math.ceil(t.length / 4) } : {}),
  });
}

describe("DiffView", () => {
  it("highlights rating and license changes with icon, label and explanation", () => {
    render(<DiffView diff={upgradeDiff()} />);
    const alerts = screen.getAllByRole("alert");
    const fields = alerts.map((a) => a.getAttribute("data-highlight"));
    expect(fields).toEqual(["rating", "licenses"]);
    const rating = alerts[0];
    expect(rating?.textContent).toContain("rating changed");
    expect(rating?.textContent).toMatch(/decides who can see/);
    expect(rating?.querySelector("svg")).toBeTruthy();
    expect(alerts[1]?.textContent).toContain("license changed");
    expect(alerts[1]?.textContent).toContain("CC-BY-NC-4.0");
  });

  it("lists dependency, fragment and token changes", () => {
    const { container } = render(<DiffView diff={upgradeDiff()} />);
    expect(screen.getByText("1.0.0 → 2.0.0")).toBeTruthy();
    expect(container.querySelector('[data-change="added"]')?.textContent).toContain(
      "@cyberpunk/night-city#blackout",
    );
    expect(container.querySelector('[data-change="modified"]')?.textContent).toContain(
      "changed: content",
    );
    expect(screen.getByText("Always in context")).toBeTruthy();
  });

  it("does not show a highlight when nothing sensitive changed", () => {
    const same = resolveSample(diffPair.from).ir;
    render(<DiffView diff={diffContextIR(same, same)} />);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(screen.getAllByText("No changes.").length).toBeGreaterThan(0);
  });
});
