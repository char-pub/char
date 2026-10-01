import { lateSlotKey } from "@char-pub/core";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, previewPreparation, runPreview } from "@/lib/preview";
import { buildTestCreation } from "@/test/build";
import { fakeClient, renderWithApp } from "@/test/render";
import { PreviewPanel } from "./preview-panel";

function storyArtifact() {
  const { artifact } = buildTestCreation({
    root: {
      release: "rel_01j00000000000000000000000",
      visibility: "public",
      creation: {
        id: "cr_01j00000000000000000000000",
        ref: "@writer/inn",
        type: "scenario",
        display_name: "Inn",
        meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
        cast: [{ key: "player", who: { late: "persona" }, part: "Guest" }],
        fragments: [
          {
            id: "setting",
            stable: true,
            kind: "scenario",
            content: { type: "text", text: "An old inn." },
          },
        ],
        story: {
          version: 1,
          scenes: [
            { id: "arrival", title: "Arrival", opening: "{{user}} arrives before sunset." },
            { id: "night", title: "Night", opening: "{{user}} hears a knock after midnight." },
          ],
          starts: [
            {
              id: "early",
              title: "Before sunset",
              description: "Arrive while the inn is open.",
              scene: "arrival",
              greeting: { en: "Good evening, {{user}}.", de: "Guten Abend, {{user}}." },
            },
            {
              id: "late",
              title: "After midnight",
              description: "Arrive after everyone is asleep.",
              scene: "night",
              greeting: { en: "Who is there, {{user}}?", de: "Wer ist da, {{user}}?" },
            },
          ],
        },
      },
    },
  });
  if (artifact.kind !== "content") throw new Error("Expected content");
  return artifact;
}

it("lets an author change story openings and preserves sample messages", async () => {
  renderWithApp(
    <PreviewPanel
      artifact={storyArtifact()}
      initialSettings={{
        ...DEFAULT_SETTINGS,
        lateBindings: {
          [lateSlotKey("root", "player")]: {
            name: "Guest",
            description: "A visitor",
            kind: "persona",
          },
        },
      }}
    />,
    fakeClient({ me: async () => null }),
  );
  let messages = await screen.findByRole("list", { name: "Assembled messages" });
  expect(messages.textContent).toContain("Sam arrives before sunset.");
  expect(within(messages).getByText("Good evening, Sam.")).toBeTruthy();
  await userEvent.selectOptions(screen.getByLabelText("Story opening"), "late");
  messages = await screen.findByRole("list", { name: "Assembled messages" });
  expect(messages.textContent).toContain("Sam hears a knock after midnight.");
  expect(messages.textContent).not.toContain("arrives before sunset");
  expect(messages.textContent).not.toContain("Good evening");
  expect(within(messages).getByText("Who is there, Sam?")).toBeTruthy();
  await userEvent.selectOptions(screen.getByLabelText("Language"), "de");
  messages = await screen.findByRole("list", { name: "Assembled messages" });
  expect(within(messages).getByText("Wer ist da, Sam?")).toBeTruthy();
  expect(within(messages).getByText("Have you heard what Arasaka is planning?")).toBeTruthy();
});

it("reports an invalid explicit snapshot instead of replacing it with the opening", () => {
  const result = runPreview(storyArtifact(), {
    ...DEFAULT_SETTINGS,
    turn: { bindings: {}, history: [] },
  });
  expect(result).toMatchObject({ ok: false, code: "catalog.story_state_required" });
  const malformed = runPreview(storyArtifact(), {
    ...DEFAULT_SETTINGS,
    turn: { bindings: {}, history: [], present: "wrong" } as never,
  });
  expect(malformed).toMatchObject({ ok: false, code: "catalog.invalid_input" });
});

it("keeps opening metadata with the same initialized history and never guesses it for a supplied snapshot", () => {
  const artifact = storyArtifact();
  const settings = {
    ...DEFAULT_SETTINGS,
    historyText: "",
    lateBindings: {
      [lateSlotKey("root", "player")]: { name: "Guest", description: "", kind: "persona" },
    },
  };
  const initial = previewPreparation(artifact, settings);
  expect(initial.opening?.source).toEqual({ kind: "story-start", id: "early" });
  expect(
    (initial.input.turn.history ?? []).filter(
      (message) => message.text === initial.opening?.content,
    ),
  ).toHaveLength(1);
  const supplied = previewPreparation(artifact, {
    ...settings,
    start: "late",
    turn: initial.input.turn,
  });
  expect(supplied.opening).toBeNull();
  expect(supplied.input.turn).toBe(initial.input.turn);
});

it("shows actual image attachments when the preview model supports them and alt text otherwise", async () => {
  const { artifact } = buildTestCreation({
    root: {
      release: "rel_01j00000000000000000000000",
      visibility: "private",
      creation: {
        id: "cr_01j00000000000000000000000",
        ref: "@writer/portrait",
        type: "character",
        display_name: "Portrait",
        meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
        assets: [
          {
            slot: "portrait",
            role: "context",
            variants: [
              {
                id: "default",
                media_type: "image/png",
                alt: "A painted portrait",
                blob: { digest: `sha256:${"a".repeat(64)}`, size: 12, availability: "mirrored" },
              },
            ],
          },
        ],
        fragments: [
          {
            id: "description",
            stable: true,
            kind: "character",
            content: { type: "media", asset: "#asset/portrait" },
          },
        ],
      },
    },
  });
  if (artifact.kind !== "content") throw new Error("Expected content");
  renderWithApp(<PreviewPanel artifact={artifact} />, fakeClient({ me: async () => null }));
  const messages = await screen.findByRole("list", { name: "Assembled messages" });
  expect(messages.textContent).toContain("[Image: A painted portrait]");
  expect(screen.queryByRole("list", { name: "Prepared image attachments" })).toBeNull();
  await userEvent.click(screen.getByRole("checkbox", { name: "Model accepts image attachments" }));
  const attachments = await screen.findByRole("list", { name: "Prepared image attachments" });
  expect(attachments.textContent).toContain("A painted portrait");
  expect(attachments.textContent).toContain("image/png");
  expect(attachments.textContent).toContain(`sha256:${"a".repeat(64)}`);
});

it("locates the actual start greeting and scene context separately", async () => {
  const locate = vi.fn();
  renderWithApp(
    <PreviewPanel
      artifact={storyArtifact()}
      onLocateSource={locate}
      initialSettings={{
        ...DEFAULT_SETTINGS,
        lateBindings: {
          [lateSlotKey("root", "player")]: { name: "Guest", description: "", kind: "persona" },
        },
      }}
    />,
    fakeClient({ me: async () => null }),
  );
  await userEvent.click(await screen.findByRole("button", { name: "Edit message source" }));
  expect(locate).toHaveBeenLastCalledWith("story.starts[early].greeting");
  await userEvent.click(screen.getByRole("button", { name: "Edit scene context source" }));
  expect(locate).toHaveBeenLastCalledWith("story.scenes[arrival].opening");
});
