import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { resolveSample, samples } from "@/fixtures/samples";
import { DEFAULT_SETTINGS, runPreview } from "@/lib/preview";
import { TraceSummary, TraceTable } from "./trace-table";

function worldSample() {
  const s = samples.find((x) => x.id === "world-lore");
  if (!s) throw new Error("fixture missing");
  return resolveSample(s).ir;
}

describe("TraceTable", () => {
  it("renders one row per trace entry with decision and reason", () => {
    const ir = worldSample();
    const out = runPreview(ir, DEFAULT_SETTINGS);
    if (!out.ok) throw new Error(out.detail);
    render(<TraceTable trace={out.result.trace} ir={ir} />);
    const table = screen.getByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual(["Details", "Kind", "Fragment", "Tokens", "Decision", "Reason"]);

    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(out.result.trace.entries.length);

    // 历史消息提到了 Arasaka，对应的 lore 被关键词触发；Militech 没被提到。
    const arasaka = rows.find((r) => r.textContent?.includes("lore/arasaka"));
    expect(arasaka?.getAttribute("data-decision")).toBe("included");
    expect(arasaka?.textContent).toContain("keyword:Arasaka");
    const militech = rows.find((r) => r.textContent?.includes("lore/militech"));
    expect(militech?.getAttribute("data-decision")).toBe("skipped");
    expect(militech?.textContent).toContain("inactive");
  });

  it("expands a row to explain where the fragment came from", async () => {
    const ir = worldSample();
    const out = runPreview(ir, DEFAULT_SETTINGS);
    if (!out.ok) throw new Error(out.detail);
    render(<TraceTable trace={out.result.trace} ir={ir} />);
    const button = screen.getByRole("button", {
      name: /details for @cyberpunk\/corps#lore\/militech/,
    });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("root → knows")).toBeTruthy();
    expect(screen.getByText(/@djj\/alice \(knows\) patch/)).toBeTruthy();
  });
});

describe("TraceSummary", () => {
  it("marks estimated counts explicitly", () => {
    const ir = worldSample();
    const out = runPreview(ir, DEFAULT_SETTINGS);
    if (!out.ok) throw new Error(out.detail);
    render(<TraceSummary trace={out.result.trace} />);
    const summary = screen.getByTestId("trace-summary");
    expect(summary.textContent).toMatch(/tokens · tokenizer: estimate/);
    expect(within(summary).getByText("estimate", { selector: ".stamp" })).toBeTruthy();
  });

  it("does not claim an estimate when an exact tokenizer was used", () => {
    const ir = worldSample();
    const out = runPreview(ir, DEFAULT_SETTINGS, {
      tokenizer: "o200k_base",
      estimated: false,
      count: (t) => t.length,
    });
    if (!out.ok) throw new Error(out.detail);
    render(<TraceSummary trace={out.result.trace} />);
    const summary = screen.getByTestId("trace-summary");
    expect(summary.textContent).toContain("tokenizer: o200k_base");
    expect(within(summary).queryByText("estimate", { selector: ".stamp" })).toBeNull();
  });
});

describe("runPreview errors", () => {
  it("explains an unbound persona in plain words", () => {
    const ir = worldSample();
    const out = runPreview(ir, { ...DEFAULT_SETTINGS, persona: { name: "", description: "" } });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe("assemble.late_slot_unbound");
      expect(out.title).toBe("A required role is not bound");
    }
  });

  it("explains pinned content that does not fit", () => {
    const ir = worldSample();
    const out = runPreview(ir, { ...DEFAULT_SETTINGS, contextWindow: 64, reserveForOutput: 56 });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe("assemble.pinned_over_budget");
      expect(out.title).toBe("Pinned content does not fit");
    }
  });
});
