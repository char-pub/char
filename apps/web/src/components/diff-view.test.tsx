import { diffContextIR } from "@char-pub/core";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { diffPair, locksOf, resolveSample } from "@/fixtures/samples";
import { DiffView } from "./diff-view";

function upgrade(withTokens = true) {
  const from = resolveSample(diffPair.from).ir;
  const to = resolveSample(diffPair.to).ir;
  const diff = diffContextIR(from, to, {
    locks: { from: locksOf(diffPair.from), to: locksOf(diffPair.to) },
    ...(withTokens ? { countTokens: (t: string) => Math.ceil(t.length / 4) } : {}),
  });
  return { diff, from, to };
}

describe("DiffView", () => {
  it("puts rating and license changes first, with an icon, the values and an explanation", () => {
    const { diff } = upgrade();
    const { container } = render(<DiffView diff={diff} />);
    const attention = screen.getByRole("region", { name: "Check these before you upgrade" });
    expect(attention.querySelector("svg")).toBeTruthy();
    const rows = [...attention.querySelectorAll("[data-highlight]")];
    expect(rows.map((r) => r.getAttribute("data-highlight"))).toEqual(["rating", "licenses"]);
    expect(rows[0]?.textContent).toMatch(/Teen.*changed to.*Mature/);
    expect(rows[0]?.textContent).toMatch(/decides who can see/);
    expect(rows[1]?.textContent).toContain("CC-BY-NC-4.0");
    expect(rows[1]?.textContent).toContain("@cyberpunk/night-city: CC-BY-4.0 → CC-BY-NC-4.0");
    // 高亮区域在依赖和片段之前。
    const first = container.firstElementChild?.firstElementChild;
    expect(first).toBe(attention);
  });

  it("lists dependency, passage and token changes", () => {
    const { diff, from, to } = upgrade();
    render(<DiffView diff={diff} from={from} to={to} />);
    expect(screen.getByText("1.0.0 → 2.0.0")).toBeTruthy();
    // 带上两边的 IR 时，依赖显示 Core / Recommended 与关系。
    expect(screen.getByText("Core · lives in")).toBeTruthy();

    const passages = screen.getByRole("heading", { name: "Passages" }).closest("section");
    if (!passages) throw new Error("passages section missing");
    const added = passages.querySelector('[data-change="added"]');
    expect(added?.textContent).toContain("@cyberpunk/night-city#blackout");
    expect(added?.textContent).toContain("New — activates on “blackout”");
    expect(passages.querySelector('[data-change="modified"]')?.textContent).toContain(
      "Text edited",
    );
    expect(within(screen.getByTestId("token-delta")).getByText("Always in context")).toBeTruthy();
  });

  it("keeps metadata other than rating and licenses folded away", () => {
    const { diff } = upgrade();
    const { container } = render(<DiffView diff={diff} />);
    const details = container.querySelector("details");
    if (diff.meta_changes.some((m) => m.field !== "rating" && m.field !== "licenses")) {
      expect(details?.open).toBe(false);
      expect(details?.textContent).toContain("Other changes");
    }
  });

  it("does not show a highlight when nothing sensitive changed", () => {
    const same = resolveSample(diffPair.from).ir;
    render(<DiffView diff={diffContextIR(same, same)} />);
    expect(screen.queryByRole("region", { name: "Check these before you upgrade" })).toBeNull();
    expect(screen.getAllByText("No changes.").length).toBeGreaterThan(0);
  });
});
