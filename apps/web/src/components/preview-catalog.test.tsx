import {
  type ContextAssemblyInput,
  catalogKey,
  createPreparationCatalog,
  fixedSelection,
  sourceRequests,
} from "@char-pub/assembler";
import { sha256Bytes } from "@char-pub/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { buildTestCreation } from "@/test/build";
import { DEFAULT_PROFILE } from "./editor/assembly-editor";
import { PreviewCatalog } from "./preview-catalog";

function fixture(): ContextAssemblyInput {
  const bytes = new TextEncoder().encode("Reference body that the panel must not download");
  const { artifact } = buildTestCreation({
    root: {
      release: "rel_01j00000000000000000000000",
      visibility: "public",
      creation: {
        id: "cr_01j00000000000000000000000",
        ref: "@writer/directory",
        type: "world",
        display_name: "Directory world",
        description: "A world for inspecting the initial directory",
        meta: {
          default_locale: "en",
          rating: "general",
          rights: "original",
          license: "CC0-1.0",
        },
        fragments: [
          {
            id: "required-note",
            stable: true,
            kind: "world",
            importance: "pinned",
            content: { type: "text", text: "Required premise" },
          },
          {
            id: "direct-note",
            stable: true,
            kind: "knowledge",
            activation: { mode: "always" },
            content: { type: "text", text: "Always active note" },
          },
          {
            id: "deep-entry",
            stable: true,
            kind: "knowledge",
            activation: { mode: "semantic" },
            description: "Deep candidate description",
            content: { type: "text", text: "Deep body" },
          },
        ],
        groups: [
          { id: "outer", title: "Outer group", description: "First level", groups: ["inner"] },
          { id: "inner", title: "Inner group", description: "Second level", groups: ["deep"] },
          { id: "deep", title: "Deep group", description: "Third level", entries: ["deep-entry"] },
        ],
        sources: [
          {
            id: "guide",
            title: "Reference guide",
            description: "Guide description",
            format: "text",
            asset: "guide-file",
            visibility: { scope: "shared" },
            sections: [{ id: "appendix", title: "Deep appendix", anchor: "L1-L1" }],
          },
        ],
        assets: [
          {
            slot: "guide-file",
            role: "context",
            variants: [
              {
                id: "default",
                media_type: "text/plain",
                blob: {
                  digest: sha256Bytes(bytes),
                  size: bytes.length,
                  availability: "mirrored",
                },
              },
            ],
          },
        ],
      },
    },
  });
  return { artifact, profile: DEFAULT_PROFILE, turn: { history: [] } };
}

it("shows only initial exposed candidates and inspects without changing selection or loading sources", async () => {
  const input = fixture();
  const build = createPreparationCatalog(input);
  const source = build.context.artifact.catalog_index.sources[0];
  if (!source) throw new Error("Source fixture required");
  const section = { source: source.id, section: "appendix" };
  const plan = fixedSelection(build, [section]);
  input.plan = plan;
  expect(plan.decisions.some((decision) => decision.action === "expand")).toBe(true);
  expect(build.nodes.has(catalogKey(section))).toBe(true);
  expect([...build.nodes.values()].some((node) => node.title === "Deep group")).toBe(true);
  expect(JSON.stringify(build.catalog.candidates)).not.toContain("Deep appendix");
  expect(JSON.stringify(build.catalog.candidates)).not.toContain("Deep group");
  const before = structuredClone(input);
  const requests = sourceRequests(input);
  expect(requests).toHaveLength(1);
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected download"));
  try {
    render(<PreviewCatalog input={input} />);
    await userEvent.click(screen.getByText("Author context directory", { selector: "summary" }));
    const panel = within(screen.getByRole("region", { name: "Author context directory" }));
    expect(panel.getByRole("list", { name: "Required content" }).textContent).toContain(
      "required-note",
    );
    expect(panel.getByRole("list", { name: "Directly associated content" }).textContent).toContain(
      "direct-note",
    );
    expect(panel.getByText("Outer group", { exact: false })).toBeTruthy();
    expect(panel.getByText("Reference guide", { exact: false })).toBeTruthy();
    for (const hiddenTitle of ["Inner group", "Deep group", "Deep appendix", "deep-entry"])
      expect(panel.queryByText(hiddenTitle, { exact: false })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(input).toEqual(before);
    expect(input.plan).toBe(plan);
    expect(sourceRequests(input)).toEqual(requests);
  } finally {
    fetch.mockRestore();
  }
});

it("reports an unavailable directory when its real budget is insufficient without widening limits", async () => {
  const input = fixture();
  input.selection = { catalog_budget: 0, max_depth: 1 };
  const before = structuredClone(input);
  expect(() => createPreparationCatalog(input)).toThrowError(
    expect.objectContaining({ code: "catalog.directory_over_budget" }),
  );
  const requests = sourceRequests(input);
  expect(requests).toEqual([]);
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected download"));
  try {
    render(<PreviewCatalog input={input} />);
    await userEvent.click(screen.getByText("Author context directory", { selector: "summary" }));
    expect(screen.getByRole("status").textContent).toContain("Author directory unavailable:");
    expect(screen.queryByRole("region", { name: "Author context directory" })).toBeNull();
    expect(screen.queryByText("Initial candidates")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(input).toEqual(before);
    expect(sourceRequests(input)).toEqual(requests);
    expect(() => createPreparationCatalog(input)).toThrowError(
      expect.objectContaining({ code: "catalog.directory_over_budget" }),
    );
  } finally {
    fetch.mockRestore();
  }
});
