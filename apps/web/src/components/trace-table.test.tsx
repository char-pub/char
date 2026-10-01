import { prepareContext } from "@char-pub/assembler";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { buildSample, samples } from "@/fixtures/samples";
import { DEFAULT_SETTINGS, previewInput, runPreview } from "@/lib/preview";
import { buildTestCreation } from "@/test/build";
import { TraceSummary, TraceTable } from "./trace-table";

function worldSample() {
  const s = samples.find((x) => x.id === "world-lore");
  if (!s) throw new Error("fixture missing");
  return buildSample(s);
}

describe("TraceTable", () => {
  it("renders one row per trace entry with the result and a plain-words reason", () => {
    const artifact = worldSample();
    const ir = artifact.ir;
    const out = runPreview(artifact, DEFAULT_SETTINGS);
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
    expect(arasaka?.textContent).toContain("Included by the current scene or an activation rule.");
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
    const artifact = worldSample();
    const ir = artifact.ir;
    const out = runPreview(artifact, DEFAULT_SETTINGS);
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
    const artifact = worldSample();
    const ir = artifact.ir;
    const out = runPreview(artifact, DEFAULT_SETTINGS);
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
    const artifact = worldSample();
    const out = runPreview(artifact, DEFAULT_SETTINGS, {
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
    const artifact = worldSample();
    const out = runPreview(artifact, {
      ...DEFAULT_SETTINGS,
      persona: { name: "", description: "" },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe("assemble.late_slot_unbound");
      expect(out.title).toBe("A required role is not bound");
    }
  });

  it("explains pinned content that does not fit", () => {
    const artifact = worldSample();
    const out = runPreview(artifact, {
      ...DEFAULT_SETTINGS,
      contextWindow: 64,
      reserveForOutput: 56,
      turn: { bindings: { user: { kind: "persona", display_name: "Sam" } }, history: [] },
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe("assemble.pinned_over_budget");
      expect(out.title).toBe("Pinned content does not fit");
    }
  });
});

describe("compiled non-text trace details", () => {
  it("shows dialogue, extension data and media identities for actual included fragments without fetching assets", async () => {
    const { artifact } = buildTestCreation({
      root: {
        release: "rel_01j00000000000000000000001",
        visibility: "private",
        creation: {
          id: "cr_01j00000000000000000000001",
          ref: "@writer/media",
          type: "character",
          display_name: "Alice",
          meta: { default_locale: "en", license: "CC0-1.0", rights: "original", rating: "general" },
          assets: [
            {
              slot: "image",
              role: "context",
              variants: [
                {
                  id: "default",
                  media_type: "image/png",
                  alt: "A portrait",
                  blob: { digest: `sha256:${"a".repeat(64)}`, size: 12, availability: "mirrored" },
                },
              ],
            },
          ],
          fragments: [
            {
              id: "dialogue",
              stable: true,
              kind: "character",
              content: {
                type: "dialogue",
                turns: [
                  { speaker: "{{self}}", text: "Hello, {{user}}." },
                  { speaker: "{{user}}", text: "Good morning." },
                ],
              },
            },
            {
              id: "data",
              stable: true,
              kind: "knowledge",
              content: {
                type: "structured",
                schema: "example-record",
                data: { code: "door", opened: false },
              },
            },
            {
              id: "image",
              stable: true,
              kind: "knowledge",
              content: { type: "media", asset: "#asset/image" },
            },
          ],
        },
      },
    });
    if (artifact.kind !== "content") throw new Error("content");
    const input = previewInput(artifact, { ...DEFAULT_SETTINGS, historyText: "" });
    input.profile.capabilities.images = true;
    const result = prepareContext(input);
    const media = result.trace.entries.find((e) => e.origin?.fragment === "image");
    expect(media).toMatchObject({ decision: "included", tokens: 0 });
    expect(result.messages.flatMap((m) => m.attachments ?? [])).toHaveLength(1);
    render(<TraceTable trace={result.trace} ir={artifact.ir} />);
    for (const button of screen.getAllByRole("button", { name: /^Show details for/ }))
      await userEvent.click(button);
    expect(screen.getByRole("list", { name: "Compiled dialogue turns" }).textContent).toContain(
      "Hello, {{late:user}}.",
    );
    expect(screen.getByText("Structured extension data")).toBeTruthy();
    expect(screen.getByText('"door"', { exact: false })).toBeTruthy();
    const asset = screen.getByRole("list", { name: "Referenced media assets" });
    expect(asset.textContent).toContain("image/png · context · private");
    expect(asset.textContent).toContain(`sha256:${"a".repeat(64)}`);
    expect(asset.textContent).toContain("Metadata only");
    expect(asset.querySelector("img")).toBeNull();
    expect(screen.getAllByText(/Default language \(en\)/)).toHaveLength(3);
  });

  it("distinguishes media alt fallback from omitted media using the actual model profile", async () => {
    const { artifact } = buildTestCreation({
      root: {
        release: "rel_01j00000000000000000000001",
        visibility: "private",
        creation: {
          id: "cr_01j00000000000000000000001",
          ref: "@writer/media",
          type: "character",
          display_name: "Alice",
          meta: { default_locale: "en", license: "CC0-1.0", rights: "original", rating: "general" },
          fragments: [
            {
              id: "description",
              kind: "character",
              stable: true,
              content: { type: "text", text: "Alice" },
            },
            {
              id: "with-alt",
              kind: "knowledge",
              stable: true,
              content: { type: "media", asset: "#asset/with-alt" },
            },
            {
              id: "no-alt",
              kind: "knowledge",
              stable: true,
              content: { type: "media", asset: "#asset/no-alt" },
            },
          ],
          assets: ["with-alt", "no-alt"].map((slot) => ({
            slot,
            role: "context",
            variants: [
              {
                id: "default",
                media_type: "image/png",
                ...(slot === "with-alt" ? { alt: "Portrait description" } : {}),
                blob: { digest: `sha256:${"a".repeat(64)}`, size: 12, availability: "mirrored" },
              },
            ],
          })),
        },
      },
    });
    if (artifact.kind !== "content") throw new Error("content");
    const result = prepareContext(previewInput(artifact, { ...DEFAULT_SETTINGS, historyText: "" }));
    expect(result.trace.entries.find((e) => e.origin?.fragment === "with-alt")).toMatchObject({
      decision: "included",
      reason: "unsupported-media",
    });
    expect(result.trace.entries.find((e) => e.origin?.fragment === "no-alt")).toMatchObject({
      decision: "skipped",
      reason: "unsupported-media",
    });
    render(<TraceTable trace={result.trace} ir={artifact.ir} />);
    for (const button of screen.getAllByRole("button", { name: /^Show details for/ }))
      await userEvent.click(button);
    expect(screen.getAllByText(/The selected model profile does not support/)).toHaveLength(2);
    expect(screen.getByText(/There was no usable caption, alt or other text/)).toBeTruthy();
    expect(screen.getByText(/available text was retained/)).toBeTruthy();
    expect(screen.queryByText(/runtime can't show images/)).toBeNull();
  });
});
