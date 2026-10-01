import { createPreparationCatalog, prepareContext } from "@char-pub/assembler";
import { type CreationInput, canonicalizeCreation } from "@char-pub/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, previewFragmentChoices, previewInput } from "@/lib/preview";
import { previewRelatedLinks } from "@/lib/preview-related-links";
import { buildTestCreation } from "@/test/build";
import { PreviewRelatedLinks } from "./preview-related-links";

type Fragment = NonNullable<CreationInput["fragments"]>[number];
const fragment = (id: string, rest: Partial<Fragment> = {}): Fragment => ({
  id,
  stable: true,
  kind: "knowledge",
  content: { type: "text", text: `BODY_${id}` },
  ...rest,
});
function creation(): CreationInput {
  return {
    id: "cr_01j00000000000000000000000",
    ref: "@writer/related",
    type: "scenario",
    display_name: { en: "Library", de: "Bibliothek" },
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    cast: [
      { key: "alice", who: { late: "character" } },
      { key: "bob", who: { late: "character" } },
    ],
    fragments: [
      fragment("clue", { about: ["#place", "cast:alice", "@writer/related"] }),
      fragment("place"),
    ],
  };
}
function inputFor(
  work = creation(),
  dependencies: Parameters<typeof buildTestCreation>[0]["dependencies"] = [],
) {
  const { artifact } = buildTestCreation({
    root: { creation: work, release: "rel_01j00000000000000000000000", visibility: "public" },
    dependencies,
  });
  if (artifact.kind !== "content") throw new Error("Expected content");
  const input = previewInput(artifact, {
    ...DEFAULT_SETTINGS,
    historyText: "",
    turn: { bindings: {}, history: [] },
  });
  input.turn.bindings = Object.fromEntries(
    artifact.ir.late_slots.map((slot) => [
      slot.key,
      { kind: slot.accepts[0] ?? "persona", display_name: `Bound ${slot.key}` },
    ]),
  );
  return input;
}

it("renders two-way in-artifact links without loading or changing selection, turn, or messages", async () => {
  const input = inputFor();
  const before = JSON.stringify(input);
  const messages = prepareContext(input).messages;
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  render(<PreviewRelatedLinks input={input} />);
  await userEvent.click(screen.getByText("Related references", { selector: "summary" }));
  const list = screen.getByRole("list", { name: "Related references" });
  expect(list.textContent).not.toContain("BODY_");
  const place = within(list).getByRole("link", { name: "place" });
  await userEvent.click(place);
  const target = document.getElementById(place.getAttribute("href")?.slice(1) ?? "");
  expect(document.activeElement).toBe(target);
  expect(target?.textContent).toContain("Referenced by:");
  const reverse = within(target as HTMLElement).getByRole("link", { name: "clue" });
  await userEvent.click(reverse);
  expect(document.activeElement?.textContent).toContain("About:");
  expect(JSON.stringify(input)).toBe(before);
  expect(prepareContext(input).messages).toEqual(messages);
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});

it("filters both ends in Bob's view, including private titles, identities and reverse links", () => {
  const work = creation();
  work.fragments = [
    fragment("clue", { about: ["#private-title"] }),
    fragment("private-title", {
      about: ["#place"],
      activation: { mode: "semantic" },
      description: "Private candidate metadata",
      visibility: { scope: "private", to: ["{{cast:alice}}"] },
    }),
    fragment("place"),
  ];
  const input = inputFor(work);
  input.profile.mode = "per-agent";
  input.turn.for_participant =
    input.artifact.kind === "content"
      ? input.artifact.ir.participants.find((p) => p.cast_key === "bob")?.key
      : "";
  expect(previewRelatedLinks(input)).toEqual({ nodes: [], links: [] });
  expect(previewFragmentChoices(input)).toEqual([]);
  input.turn.for_participant =
    input.artifact.kind === "content"
      ? input.artifact.ir.participants.find((p) => p.cast_key === "alice")?.key
      : "";
  expect(previewRelatedLinks(input).links).toHaveLength(2);
  expect(previewFragmentChoices(input).map((choice) => choice.title)).toEqual(["private-title"]);
});

it("does not activate manual entries or unfold grouped semantic entries through about", () => {
  const work = creation();
  work.fragments = [
    fragment("clue", { about: ["#manual", "#deep"] }),
    fragment("manual", { activation: { mode: "manual" } }),
    fragment("deep", { activation: { mode: "semantic" }, description: "Directory metadata" }),
  ];
  work.groups = [
    { id: "shelf", title: "Shelf", description: "Grouped entries", entries: ["deep"] },
  ];
  const input = inputFor(work);
  const build = createPreparationCatalog(input);
  expect([...build.nodes.values()].some((node) => node.title === "deep")).toBe(true);
  expect(previewRelatedLinks(input)).toEqual({ nodes: [], links: [] });
  expect(JSON.stringify(prepareContext(input).messages)).not.toContain("BODY_deep");
  expect(JSON.stringify(prepareContext(input).messages)).not.toContain("BODY_manual");
  // The separate author selection tool may deliberately discover this path.
  expect(previewFragmentChoices(input).some((node) => node.title === "deep")).toBe(true);
});

it("fails closed when the directory cannot fit its budget", () => {
  const work = creation();
  work.fragments?.push(
    fragment("candidate", { activation: { mode: "semantic" }, description: "Candidate" }),
  );
  work.fragments?.[0]?.about?.push("#candidate");
  const input = inputFor(work);
  input.selection = { catalog_budget: 0, max_depth: 4 };
  expect(() => previewRelatedLinks(input)).toThrowError(
    expect.objectContaining({ code: "catalog.directory_over_budget" }),
  );
  render(<PreviewRelatedLinks input={input} />);
  expect(screen.getByRole("status").textContent).toContain("unavailable");
  expect(screen.queryByRole("link")).toBeNull();
  expect(() => previewFragmentChoices(input)).toThrowError(
    expect.objectContaining({ code: "catalog.directory_over_budget" }),
  );
});

it("distinguishes work instances and filters absent late participants", () => {
  const input = inputFor();
  if (input.artifact.kind !== "content") throw new Error("Expected content");
  const bob = input.artifact.ir.participants.find((p) => p.cast_key === "bob");
  input.turn.present = bob ? [bob.key] : [];
  input.turn.locale = "de";
  const result = previewRelatedLinks(input);
  expect(result.nodes.some((node) => node.kind === "participant")).toBe(false);
  expect(result.nodes.find((node) => node.kind === "work")?.label).toBe("Bibliothek");
  expect(result.links).toHaveLength(2);
});

it("keeps duplicate dependency instances separate by complete resolved identity", () => {
  const child: CreationInput = {
    ...creation(),
    id: "cr_01j00000000000000000000001",
    ref: "@writer/child",
    type: "lorebook",
    cast: undefined,
    fragments: [fragment("clue", { about: ["#place"] }), fragment("place")],
  };
  const dependency = {
    creation: child,
    release: "rel_01j00000000000000000000001",
    visibility: "public" as const,
    semantic_digest: canonicalizeCreation(child).semantic_digest,
  };
  const root = creation();
  root.fragments = [];
  root.references = ["left", "right"].map((id) => ({
    id,
    use: child.ref,
    mode: "default",
    pin: { release: dependency.release, semantic_digest: dependency.semantic_digest },
  }));
  const result = previewRelatedLinks(inputFor(root, [dependency]));
  expect(result.links).toHaveLength(2);
  expect(result.nodes).toHaveLength(4);
  expect(new Set(result.nodes.map((node) => node.identity)).size).toBe(4);
  for (const edge of result.links)
    expect(edge.from.split("~").at(-1)).toBe(edge.to.split("~").at(-1));
});
