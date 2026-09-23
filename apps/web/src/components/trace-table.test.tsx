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
  it("renders one row per trace entry with the result and a plain-words reason", () => {
    const ir = worldSample();
    const out = runPreview(ir, DEFAULT_SETTINGS);
    if (!out.ok) throw new Error(out.detail);
    render(<TraceTable trace={out.result.trace} ir={ir} />);
    const table = screen.getByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual(["Details", "Passage", "Where", "Tokens", "Result", "Why"]);

    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(out.result.trace.entries.length);

    // 历史消息提到了 Arasaka，对应的 lore 被关键词触发；Militech 没被提到。
    // IR 里的 id 带着实例后缀（`~…`），按片段 id 匹配。
    const row = (id: string) => rows.find((r) => r.getAttribute("data-id")?.includes(id));
    const arasaka = row("#lore/arasaka");
    expect(arasaka?.getAttribute("data-decision")).toBe("included");
    expect(arasaka?.textContent).toContain("Included");
    expect(arasaka?.textContent).toContain("The chat mentions “Arasaka”.");
    // 原始的 reason code 不在表格行里，只在展开后作为次要信息。
    expect(arasaka?.textContent).not.toContain("keyword:Arasaka");
    const militech = row("#lore/militech");
    expect(militech?.getAttribute("data-decision")).toBe("skipped");
    expect(militech?.textContent).toMatch(/Not triggered — the chat doesn't mention “Militech”/);
    // intrinsic 依赖带来的设定说明是哪条依赖让它进来的。
    expect(row("#districts")?.textContent).toContain(
      "Always included, because Alice lives in Night City (Core).",
    );
  });

  it("expands a row to explain where the passage came from in words", async () => {
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
    const details = screen.getByText("Overridden by").closest("dl");
    if (!details) throw new Error("details missing");
    expect(details.textContent).toMatch(/\(@cyberpunk\/corps\).*through the “knows” reference/);
    expect(details.textContent).toContain("Alice changed it through its “knows” reference.");
    expect(details.textContent).toMatch(/In the system prompt/);
    // 原始代码作为次要信息保留。
    expect(within(details).getByText(/^inactive · region/)).toBeTruthy();
  });
});

describe("TraceSummary", () => {
  it("marks estimated counts explicitly and breaks the total down by source", () => {
    const ir = worldSample();
    const out = runPreview(ir, DEFAULT_SETTINGS);
    if (!out.ok) throw new Error(out.detail);
    render(<TraceSummary trace={out.result.trace} ir={ir} />);
    const summary = screen.getByTestId("trace-summary");
    expect(summary.textContent).toContain("Estimated count — tokenizer: estimate");
    expect(summary.textContent).toContain("of 8,192 tokens");
    const sources = within(summary).getByRole("list", { name: "Tokens by source" });
    expect(within(sources).getByText("@djj/alice")).toBeTruthy();
    expect(within(sources).getByText("@cyberpunk/night-city")).toBeTruthy();
    expect(within(sources).getByText(/passages? skipped/)).toBeTruthy();
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
    expect(summary.textContent).toContain("Exact count — tokenizer: o200k_base");
    expect(summary.textContent).not.toContain("Estimated");
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
