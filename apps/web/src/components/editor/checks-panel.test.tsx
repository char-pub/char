import { canonicalizeCreation, checkCreation, type Story } from "@char-pub/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { PublishReport } from "@/components/publish-report";
import type { Working } from "@/lib/draft";
import { storyConditionAnchor } from "@/lib/editor-location";
import { scrollToAnchor } from "./anchors";
import { buildChecks, ChecksPanel } from "./checks-panel";
import { StoryScenes } from "./story-scenes";
import { StoryStructure } from "./story-structure";

const working: Working = {
  id: "cr_01j00000000000000000000001",
  ref: "@writer/story",
  type: "scenario",
  display_name: "Story",
  summary: "Keep this unfinished note.",
  cast: [{ key: "guest", who: { late: "character" } }],
  meta: { default_locale: "zh", rating: "general", rights: "original", license: "CC0-1.0" },
  story: {
    version: 1,
    scenes: [{ id: "hall", title: { en: "Hall", zh: "大厅" } }],
    endings: [
      {
        id: "leave",
        title: { en: "Leave", zh: "一起离开" },
        description: "Leave together",
        after: "continue",
        when: { all: [{ not: { visited: "scene/missing" } }] },
      },
    ],
  } satisfies Story,
};
function diagnostics(value: Working) {
  return checkCreation(canonicalizeCreation(value).creation).diagnostics;
}

it("shows a real Core repair suggestion and focuses the exact nested rule without losing draft edits", async () => {
  const initial = structuredClone(working);
  function EditorChecks() {
    const [current, update] = useState(working);
    const found = diagnostics(current);
    const errors = found.filter((issue) => issue.severity === "error");
    const items = buildChecks({
      type: "scenario",
      working: current,
      state: errors.length
        ? { kind: "invalid", diagnostics: errors, message: undefined }
        : { kind: "saved", at: null },
      warnings: found.filter((issue) => issue.severity !== "error"),
      references: [],
    });
    return (
      <>
        <ChecksPanel items={items} onLocate={(target) => scrollToAnchor(target.anchor)} />
        <StoryStructure working={current} update={update} />
        <output aria-label="Current draft">{JSON.stringify(current)}</output>
      </>
    );
  }
  const issue = diagnostics(working).find(
    (item) => item.subject === "story.endings[leave]/when/all/0/not",
  );
  if (!issue?.detail) throw new Error("Expected real condition diagnostic");
  expect(issue.detail).toContain("Choose an existing scene");
  render(<EditorChecks />);
  const panel = screen.getByTestId("checks");
  expect(within(panel).getByText("Ending “一起离开” (leave)")).toBeTruthy();
  expect(within(panel).getByText(issue.subject)).toBeTruthy();
  await userEvent.click(within(panel).getByRole("button", { name: issue.detail }));
  const node = document.getElementById(storyConditionAnchor("endings", "leave", "/when/all/0/not"));
  expect(node).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(node?.querySelector("select")));
  expect(JSON.parse(screen.getByLabelText("Current draft").textContent ?? "")).toEqual(initial);
  await userEvent.selectOptions(screen.getByLabelText("Rule.1.not target"), "scene/hall");
  await waitFor(() => expect(within(panel).queryByText(issue.subject)).toBeNull());
  const repaired = JSON.parse(screen.getByLabelText("Current draft").textContent ?? "") as Working;
  expect(repaired.summary).toBe(initial.summary);
  expect((repaired.story as Story).endings?.[0]?.title).toEqual({ en: "Leave", zh: "一起离开" });
  expect(diagnostics(repaired).filter((entry) => entry.severity === "error")).toEqual([]);
  expect(working).toEqual(initial);
});

it("uses the same real condition anchor for scene entry diagnostics", async () => {
  const story = working.story as Story;
  const value: Working = {
    ...working,
    story: {
      ...story,
      endings: [],
      scenes: [
        {
          ...story.scenes[0],
          when: { not: { visited: "scene/missing" } },
        },
      ],
    },
  };
  const found = diagnostics(value).filter((entry) => entry.severity === "error");
  const items = buildChecks({
    type: "scenario",
    working: value,
    state: { kind: "invalid", diagnostics: found, message: undefined },
    warnings: [],
    references: [],
  });
  render(
    <>
      <ChecksPanel items={items} onLocate={(target) => scrollToAnchor(target.anchor)} />
      <StoryScenes working={value} update={vi.fn()} />
    </>,
  );
  const issue = found.find((entry) => entry.subject === "story.scenes[hall]/when/not");
  if (!issue?.detail) throw new Error("Expected scene condition diagnostic");
  await userEvent.click(screen.getByRole("button", { name: issue.detail }));
  const node = document.getElementById(storyConditionAnchor("scenes", "hall", "/when/not"));
  await waitFor(() => expect(document.activeElement).toBe(node?.querySelector("select")));
});

it("keeps Core suggestions, exact paths and current labels in a failed publication report", async () => {
  const found = diagnostics(working)
    .filter((entry) => entry.severity === "error")
    .map((entry) => ({ ...entry, severity: "error" as const }));
  const onLocate = vi.fn();
  render(
    <PublishReport
      report={{
        release: "rel_failed",
        label: "v1",
        state: "failed",
        idempotent: false,
        report: { issues: found, license_check: "pass" },
      }}
      context={{ root: "Story", references: [], working, onLocate }}
    />,
  );
  const issue = found.find((entry) => entry.subject === "story.endings[leave]/when/all/0/not");
  if (!issue?.detail) throw new Error("Expected condition diagnostic");
  expect(screen.getByText(issue.detail)).toBeTruthy();
  expect(screen.getByText(/story.endings\[leave\]\/when\/all\/0\/not/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Open Ending “一起离开” (leave)" }));
  expect(onLocate).toHaveBeenCalledWith({
    anchor: storyConditionAnchor("endings", "leave", "/when/all/0/not"),
    storyView: "scenes",
  });
});
