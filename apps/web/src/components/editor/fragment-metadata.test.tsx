import { canonicalizeCreation, checkCreation, type Fragment } from "@char-pub/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import type { Working } from "@/lib/draft";
import { DEFAULT_SETTINGS, runPreview } from "@/lib/preview";
import { buildTestCreation } from "@/test/build";
import { FragmentMetadata } from "./fragment-metadata";

const passage: Fragment = {
  id: "secret",
  kind: "character",
  stable: true,
  content: { type: "text", text: "SECRET EVIDENCE" },
};
const initial: Working = {
  id: "cr_01j00000000000000000000001",
  ref: "@writer/alice",
  type: "character",
  display_name: "Alice",
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
  fragments: [passage],
  sources: [
    {
      id: "guide",
      title: "Guide",
      description: "Archive",
      asset: "guide",
      format: "markdown",
      sections: [{ id: "door", title: "Door", anchor: "#Door" }],
    },
  ],
  assets: [
    {
      slot: "guide",
      role: "context",
      variants: [
        {
          id: "default",
          media_type: "text/markdown",
          blob: { digest: `sha256:${"a".repeat(64)}`, size: 12, availability: "mirrored" },
        },
      ],
    },
  ],
};
function Harness({
  fragment = passage,
  working = initial,
}: {
  fragment?: Fragment;
  working?: Working;
}) {
  const [w, setW] = useState<Working>({
    ...working,
    fragments: [fragment, ...(working.fragments ?? []).filter((f) => f.id !== fragment.id)],
  });
  const value = w.fragments?.[0];
  if (!value) throw new Error("fragment required");
  return (
    <>
      <FragmentMetadata
        working={w}
        fragment={value}
        onChange={(next) => setW({ ...w, fragments: [next, ...(w.fragments ?? []).slice(1)] })}
      />
      <button type="button" onClick={() => setW({ ...w, summary: "New summary" })}>
        Edit summary
      </button>
      <button type="button" onClick={() => setW({ ...w, sources: [] })}>
        Remove sources elsewhere
      </button>
      <output data-testid="working">{JSON.stringify(w)}</output>
    </>
  );
}
function current(): Working {
  return JSON.parse(screen.getByTestId("working").textContent ?? "{}");
}
function value(): Fragment {
  const value = current().fragments?.[0];
  if (!value) throw new Error("fragment required");
  return value;
}
function artifact(w: Working) {
  return buildTestCreation({
    root: {
      creation: canonicalizeCreation(w).creation,
      release: "rel_01j00000000000000000000001",
      visibility: "public",
    },
  }).artifact;
}
function messages(w: Working, mode: "narrator" | "per-agent", forParticipant?: string) {
  const a = artifact(w);
  if (a.kind !== "content") throw new Error("content required");
  const result = runPreview(a, {
    ...DEFAULT_SETTINGS,
    mode,
    historyText: "",
    lateBindings: Object.fromEntries(
      a.ir.late_slots
        .filter((slot) => slot.key !== "user")
        .map((slot) => [slot.key, { name: "Guest", description: "", kind: "persona" }]),
    ),
    ...(forParticipant ? { forParticipant } : {}),
  });
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  return JSON.stringify(result.result.messages);
}

it("does not write defaults and preserves other languages and unrelated metadata", async () => {
  const fragment = { ...passage, description: { en: "Secret", ja: "秘密" }, about: ["#secret"] };
  render(<Harness fragment={fragment} />);
  expect(value()).toEqual(fragment);
  await userEvent.clear(screen.getByLabelText("Passage description (en)"));
  expect(value().description).toEqual({ ja: "秘密" });
  await userEvent.type(screen.getByLabelText("Passage description (en)"), "Hidden evidence");
  expect(value().description).toEqual({ ja: "秘密", en: "Hidden evidence" });
  expect(value().about).toEqual(["#secret"]);
  await userEvent.click(screen.getByRole("button", { name: "Clear description in all languages" }));
  await userEvent.click(screen.getByRole("button", { name: "Edit summary" }));
  await userEvent.click(screen.getByRole("button", { name: "Undo metadata change" }));
  expect(value().description).toEqual({ ja: "秘密", en: "Hidden evidence" });
  expect(current().summary).toBe("New summary");
});

it("requires discovery description for keyword selection and protects its last language", async () => {
  render(<Harness fragment={{ ...passage, activation: { mode: "keyword", keys: ["case"] } }} />);
  expect(
    (
      screen.getByRole("checkbox", {
        name: "Allow AI selection without a keyword match",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await userEvent.type(screen.getByLabelText("Passage description (en)"), "Evidence in the case");
  await userEvent.click(
    screen.getByRole("checkbox", { name: "Allow AI selection without a keyword match" }),
  );
  expect(value().selectable).toBe(true);
  const built = artifact(current());
  if (built.kind !== "content" || !built.ir.fragments[0]) throw new Error("content");
  expect(messages(current(), "narrator")).not.toContain("SECRET EVIDENCE");
  const selected = runPreview(built, {
    ...DEFAULT_SETTINGS,
    historyText: "",
    selection: [{ fragment: built.ir.fragments[0].id }],
  });
  if (!selected.ok) throw new Error(selected.detail);
  expect(JSON.stringify(selected.result.messages)).toContain("SECRET EVIDENCE");
  await userEvent.clear(screen.getByLabelText("Passage description (en)"));
  expect(value().description).toBe("Evidence in the case");
  expect(screen.getByRole("alert").textContent).toContain("Turn off AI selection");
  expect(checkCreation(canonicalizeCreation(current()).creation).ok).toBe(true);
  await userEvent.click(
    screen.getByRole("checkbox", { name: "Allow AI selection without a keyword match" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Clear description in all languages" }));
  expect(value().description).toBeUndefined();
  expect(value().selectable).toBeUndefined();
});

it("builds a speaker claim and enforces private recipients despite outward content", async () => {
  render(<Harness />);
  await userEvent.selectOptions(screen.getByLabelText("Passage perspective"), "claim");
  await userEvent.selectOptions(screen.getByLabelText("Perspective speaker"), "{{self}}");
  await userEvent.click(screen.getByText("Advanced visibility"));
  await userEvent.click(screen.getByRole("checkbox", { name: "Outward character information" }));
  await userEvent.selectOptions(screen.getByLabelText("Passage visibility"), "private");
  const built = artifact(current());
  if (built.kind !== "content") throw new Error("content");
  expect(built.ir.fragments[0]?.perspective).toEqual({ claim: "participant:self" });
  expect(messages(current(), "per-agent")).not.toContain("SECRET EVIDENCE");
  expect(messages(current(), "narrator")).toContain("SECRET EVIDENCE");
  await userEvent.click(screen.getByRole("checkbox", { name: "Private recipient {{self}}" }));
  expect(messages(current(), "per-agent")).toContain("SECRET EVIDENCE");
  await userEvent.selectOptions(screen.getByLabelText("Passage perspective"), "rumor");
  expect(messages(current(), "per-agent")).toContain("传闻");
});

it("uses source sections as provenance without activating the source body and refuses a stale undo", async () => {
  render(<Harness />);
  await userEvent.selectOptions(screen.getByLabelText("Passage source"), "#source/guide/door");
  const built = artifact(current());
  if (built.kind !== "content") throw new Error("content");
  expect(built.ir.fragments[0]?.source?.use).toContain("#source/guide/door");
  expect(messages(current(), "narrator")).toContain("SECRET EVIDENCE");
  await userEvent.click(screen.getByRole("button", { name: "Remove source attribution" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove sources elsewhere" }));
  await userEvent.click(screen.getByRole("button", { name: "Undo metadata change" }));
  expect(screen.getByRole("alert").textContent).toContain("Missing source");
  expect(value().source).toBeUndefined();
});

it("retains external references without claiming the unloaded closure is missing", async () => {
  render(
    <Harness
      fragment={{
        ...passage,
        perspective: { belief: "@indirect/actor" },
        source: { use: "@indirect/archive#guide/door" },
      }}
    />,
  );
  expect((screen.getByLabelText("Perspective speaker") as HTMLSelectElement).value).toBe(
    "@indirect/actor",
  );
  expect((screen.getByLabelText("Passage source") as HTMLSelectElement).value).toBe(
    "@indirect/archive#guide/door",
  );
  await userEvent.selectOptions(screen.getByLabelText("Passage perspective"), "rumor");
  await userEvent.click(screen.getByRole("button", { name: "Undo metadata change" }));
  expect(value().perspective).toEqual({ belief: "@indirect/actor" });
  expect(value().source).toEqual({ use: "@indirect/archive#guide/door" });
});

it("supports real slot and cast targets and makes missing retained targets repairable", async () => {
  render(
    <Harness
      working={{
        ...initial,
        type: "scenario",
        cast: [{ key: "guest", who: { late: "persona" } }],
        slots: { guide: { accepts: "character" } },
      }}
      fragment={{ ...passage, kind: "knowledge", perspective: { claim: "{{cast:missing}}" } }}
    />,
  );
  expect(screen.getByText(/Missing speaker target/)).toBeTruthy();
  await userEvent.selectOptions(screen.getByLabelText("Perspective speaker"), "{{slot:guide}}");
  expect(value().perspective).toEqual({ claim: "{{slot:guide}}" });
  await userEvent.selectOptions(screen.getByLabelText("Perspective speaker"), "{{cast:guest}}");
  expect(value().perspective).toEqual({ claim: "{{cast:guest}}" });
  expect(screen.queryByRole("checkbox", { name: "Outward character information" })).toBeNull();
});

it("uses authored Story scenes rather than confusing them with resolved passage scenes", async () => {
  render(
    <Harness
      fragment={{ ...passage, kind: "knowledge" }}
      working={{
        ...initial,
        type: "scenario",
        cast: [{ key: "guest", who: { late: "persona" } }],
        story: {
          version: 1,
          scenes: [
            { id: "hall", title: "Hall" },
            { id: "cellar", title: "Cellar" },
          ],
        },
      }}
    />,
  );
  await userEvent.click(screen.getByText("Advanced visibility"));
  await userEvent.selectOptions(screen.getByLabelText("Passage visibility"), "story-scene");
  await userEvent.selectOptions(screen.getByLabelText("Story visibility scene"), "cellar");
  expect(value().visibility).toEqual({ scope: "story-scene", scene: "cellar" });
  expect(messages(current(), "narrator")).not.toContain("SECRET EVIDENCE");
  await userEvent.selectOptions(screen.getByLabelText("Story visibility scene"), "hall");
  expect(messages(current(), "narrator")).toContain("SECRET EVIDENCE");
  await userEvent.selectOptions(screen.getByLabelText("Passage visibility"), "scene");
  await userEvent.selectOptions(screen.getByLabelText("Passage scene target"), "secret");
  expect(value().visibility).toEqual({ scope: "scene", scene: "secret" });
});

it("does not undo over a later edit of the same field", async () => {
  render(<Harness fragment={{ ...passage, description: "Old description" }} />);
  await userEvent.click(screen.getByRole("button", { name: "Clear description in all languages" }));
  await userEvent.type(screen.getByLabelText("Passage description (en)"), "New description");
  await userEvent.click(screen.getByRole("button", { name: "Undo metadata change" }));
  expect(screen.getByRole("alert").textContent).toContain("newer edit");
  expect(value().description).toBe("New description");
});

it("refuses empty private recipients and offers repair for imported unsupported settings", async () => {
  render(
    <Harness
      working={{ ...initial, type: "lorebook" }}
      fragment={{
        ...passage,
        kind: "knowledge",
        outward: false,
        selectable: false,
        visibility: { scope: "private", to: ["{{user}}"] },
      }}
    />,
  );
  await userEvent.click(screen.getByRole("checkbox", { name: "Private recipient {{user}}" }));
  expect(screen.getByRole("alert").textContent).toContain("at least one recipient");
  expect(value().visibility).toEqual({ scope: "private", to: ["{{user}}"] });
  await userEvent.click(screen.getByRole("button", { name: "Remove unsupported outward setting" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Remove unsupported selection setting" }),
  );
  expect(value().outward).toBeUndefined();
  expect(value().selectable).toBeUndefined();
  expect(checkCreation(canonicalizeCreation(current()).creation).ok).toBe(true);
});

it.each(["#guide/door", "#source/guide/door"])(
  "restores the valid local Source alias %s without rewriting it",
  async (use) => {
    render(<Harness fragment={{ ...passage, source: { use } }} />);
    expect(artifact(current()).kind).toBe("content");
    await userEvent.click(screen.getByRole("button", { name: "Remove source attribution" }));
    await userEvent.click(screen.getByRole("button", { name: "Undo metadata change" }));
    expect(value().source).toEqual({ use });
  },
);

it.each([
  "@writer/alice#source/guide/door",
  "cast:guide#source/guide/door",
  "cast:guide#guide/door",
])("preserves and builds the scoped Source reference %s", async (use) => {
  const creation = canonicalizeCreation(initial).creation;
  const dependency = {
    creation,
    release: "rel_01j00000000000000000000002",
    semantic_digest: canonicalizeCreation(initial).semantic_digest,
    visibility: "public" as const,
  };
  const w: Working = {
    ...initial,
    type: "scenario",
    ref: "@writer/scene",
    id: "cr_01j00000000000000000000002",
    sources: [],
    assets: [],
    cast: [{ key: "guide", who: creation.ref }],
    references: [
      {
        id: "guide",
        use: creation.ref,
        mode: "default",
        pin: { release: dependency.release, semantic_digest: dependency.semantic_digest },
      },
    ],
  };
  render(<Harness working={w} fragment={{ ...passage, kind: "knowledge", source: { use } }} />);
  await userEvent.click(screen.getByRole("button", { name: "Remove source attribution" }));
  await userEvent.click(screen.getByRole("button", { name: "Undo metadata change" }));
  expect(value().source).toEqual({ use });
  const built = buildTestCreation({
    root: {
      creation: canonicalizeCreation(current()).creation,
      release: "rel_01j00000000000000000000001",
      visibility: "public",
    },
    dependencies: [dependency],
  }).artifact;
  expect(built.kind).toBe("content");
});
