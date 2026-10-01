import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import type { Working } from "@/lib/draft";
import { editorLocation } from "@/lib/editor-location";
import { StoryWorkspace } from "./story-workspace";

it("navigates Story views by keyboard and opens character settings without losing scene edits", async () => {
  function Editor() {
    const [working, update] = useState<Working>({
      meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
      story: { version: 1, scenes: [{ id: "lobby", title: "Lobby" }] },
    });
    return (
      <>
        <StoryWorkspace working={working} update={update} />
        <details data-testid="settings">
          <summary>Settings</summary>
          <div id="edit-composition">
            <button type="button">Add character</button>
          </div>
        </details>
      </>
    );
  }
  render(<Editor />);
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText("Scene lobby title"));
  await user.type(screen.getByLabelText("Scene lobby title"), "Midnight lobby");
  screen.getByRole("tab", { name: "Scenes" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Plotlines" }).getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Plotlines" }));
  expect(screen.queryByRole("button", { name: "Add scene" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Add plotline" }));
  expect((screen.getByLabelText("Midnight lobby") as HTMLInputElement).checked).toBe(true);
  screen.getByRole("tab", { name: "Plotlines" }).focus();
  await user.keyboard("{End}");
  expect(screen.getByRole("tab", { name: "Timelines" }).getAttribute("aria-selected")).toBe("true");
  await user.click(screen.getByRole("button", { name: "Add timeline" }));
  await user.selectOptions(screen.getByLabelText("Add next moment"), "scene/lobby");
  screen.getByRole("tab", { name: "Timelines" }).focus();
  await user.keyboard("{Home}");
  expect((screen.getByLabelText("Scene lobby title") as HTMLInputElement).value).toBe(
    "Midnight lobby",
  );
  await user.click(screen.getByRole("button", { name: "Choose characters" }));
  await waitFor(() =>
    expect((screen.getByTestId("settings") as HTMLDetailsElement).open).toBe(true),
  );
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add character" }));
});

it("reveals and focuses a hidden scene once per navigation request, then permits manual view changes", async () => {
  function Editor() {
    const [working, update] = useState<Working>({
      meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
      story: {
        version: 1,
        scenes: [{ id: "lobby", title: "Lobby", opening: "Rain at the windows" }],
      },
    });
    const [request, setRequest] = useState(0);
    const target = editorLocation(working, "story.scenes[lobby].opening");
    if (!target) throw new Error("location missing");
    return (
      <>
        <button type="button" onClick={() => setRequest((n) => n + 1)}>
          Locate scene opening
        </button>
        <StoryWorkspace
          working={working}
          update={update}
          navigation={request ? { ...target, request } : undefined}
        />
      </>
    );
  }
  render(<Editor />);
  await userEvent.click(screen.getByRole("tab", { name: "Plotlines" }));
  expect(screen.queryByRole("textbox", { name: "Opening situation for lobby" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Locate scene opening" }));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText("Opening situation for lobby")),
  );
  expect(screen.getByRole("tab", { name: "Scenes" }).getAttribute("aria-selected")).toBe("true");
  await userEvent.click(screen.getByRole("tab", { name: "Timelines" }));
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  expect(screen.getByRole("tab", { name: "Timelines" }).getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Timelines" }));
  expect(screen.queryByRole("textbox", { name: "Opening situation for lobby" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Locate scene opening" }));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText("Opening situation for lobby")),
  );
  expect(screen.getByRole("tab", { name: "Scenes" }).getAttribute("aria-selected")).toBe("true");
});
