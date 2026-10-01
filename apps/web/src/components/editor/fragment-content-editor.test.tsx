import { prepareContext } from "@char-pub/assembler";
import {
  canonicalizeCreation,
  checkCreation,
  type Fragment,
  type FragmentContent,
} from "@char-pub/core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCallback, useState } from "react";
import { expect, it, vi } from "vitest";
import type { Working } from "@/lib/draft";
import { DEFAULT_SETTINGS, previewInput } from "@/lib/preview";
import { buildTestCreation } from "@/test/build";
import { FragmentContentEditor } from "./fragment-content-editor";
import { FragmentsEditor } from "./fragments-editor";

const base: Working = {
  id: "cr_01j00000000000000000000001",
  ref: "@writer/alice",
  type: "character",
  display_name: "Alice",
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
};
const fragment = (content: FragmentContent): Fragment => ({
  id: "description",
  stable: true,
  kind: "character",
  content,
  locale: { ja: { content: { type: "text", text: "日本語" }, activation_keys: ["日本"] } },
});
function Harness({ content, all = false }: { content: FragmentContent; all?: boolean }) {
  const [working, update] = useState<Working>({ ...base, fragments: [fragment(content)] });
  const [hidden, hide] = useState(false);
  const [pending, pendingState] = useState(false);
  const onPending = useCallback((_key: string, value: boolean) => pendingState(value), []);
  const f = working.fragments?.[0];
  if (!f) throw new Error("fixture fragment");
  return (
    <>
      {all ? (
        <FragmentsEditor
          type="world"
          working={working}
          update={update}
          diagnostics={[]}
          visibleIds={hidden ? [] : [f.id]}
          onPendingChange={onPending}
        />
      ) : (
        <FragmentContentEditor
          working={working}
          fragment={f}
          onChange={(next) => update((w) => ({ ...w, fragments: [next] }))}
          onPendingChange={onPending}
        />
      )}
      <button type="button" onClick={() => hide(!hidden)}>
        Toggle filter
      </button>
      <button type="button" onClick={() => update((w) => ({ ...w, assets: [] }))}>
        Remove assets elsewhere
      </button>
      <button type="button" disabled={pending}>
        Build draft preview
      </button>
      <output data-testid="working">{JSON.stringify(working)}</output>
    </>
  );
}
const working = (): Working => JSON.parse(screen.getByTestId("working").textContent ?? "{}");
async function replace(type: string) {
  await userEvent.click(screen.getByText("Change content type"));
  await userEvent.selectOptions(screen.getByLabelText("Replacement content type"), type);
  await userEvent.click(screen.getByRole("button", { name: "Replace content" }));
}
function buildMessages(images = false) {
  const current = working();
  expect(checkCreation(canonicalizeCreation(current).creation).ok).toBe(true);
  const { artifact } = buildTestCreation({
    root: { release: "rel_01j00000000000000000000001", visibility: "private", creation: current },
  });
  if (artifact.kind !== "content") throw new Error("content artifact");
  const input = previewInput(artifact, { ...DEFAULT_SETTINGS, historyText: "" });
  input.profile.capabilities.images = images;
  return prepareContext(input);
}
it("authors actual ordered dialogue and preserves translations through Core build and prepare", async () => {
  render(<Harness content={{ type: "text", text: "Original" }} />);
  await replace("dialogue");
  await userEvent.selectOptions(screen.getByLabelText("Speaker for turn 1"), "{{self}}");
  fireEvent.change(screen.getByLabelText("Text for turn 1"), {
    target: { value: "Welcome, {{user}}." },
  });
  await userEvent.click(screen.getByRole("button", { name: "Add dialogue turn" }));
  await userEvent.type(screen.getByLabelText("Text for turn 2"), "Hello Alice.");
  const output = buildMessages();
  expect(output.messages.map((m) => m.content).join("\n")).toContain("Alice: Welcome, Sam.");
  expect(output.messages.map((m) => m.content).join("\n")).toContain("Sam: Hello Alice.");
  expect(working().fragments?.[0]?.locale?.ja).toEqual({
    content: { type: "text", text: "日本語" },
    activation_keys: ["日本"],
  });
});
it("selects an actual media asset and generates model attachments or alt fallback according to profile", async () => {
  render(<Harness content={{ type: "text", text: "Original" }} />);
  await replace("media");
  await userEvent.selectOptions(screen.getByLabelText("Context asset"), "#asset/portrait/default");
  await userEvent.type(screen.getByLabelText("Media caption"), "Alice at home");
  const attachments = buildMessages(true).messages.flatMap((m) => m.attachments ?? []);
  expect(attachments).toHaveLength(1);
  expect(attachments[0]).toMatchObject({
    media_type: "image/png",
    digest: `sha256:${"a".repeat(64)}`,
    alt: "A painted portrait",
  });
  expect(
    buildMessages()
      .messages.map((m) => m.content)
      .join("\n"),
  ).toContain("[Image: A painted portrait]");
});
it("provides local Undo without overwriting later content edits", async () => {
  render(<Harness content={{ type: "text", text: "Original" }} />);
  await replace("dialogue");
  await userEvent.click(screen.getByRole("button", { name: "Undo content change" }));
  expect((screen.getByLabelText("Text") as HTMLTextAreaElement).value).toBe("Original");
  await replace("dialogue");
  await userEvent.type(screen.getByLabelText("Text for turn 1"), "Newer edit");
  await userEvent.click(screen.getByRole("button", { name: "Undo content change" }));
  expect(screen.getByRole("alert").textContent).toContain("will not overwrite");
  expect((screen.getByLabelText("Text for turn 1") as HTMLTextAreaElement).value).toBe(
    "Newer edit",
  );
});
it("refuses restoring media whose asset was removed and never invents a replacement asset", async () => {
  render(<Harness content={{ type: "media", asset: "#asset/portrait" }} />);
  await replace("text");
  await userEvent.click(screen.getByRole("button", { name: "Remove assets elsewhere" }));
  await userEvent.click(screen.getByRole("button", { name: "Undo content change" }));
  expect(screen.getByRole("alert").textContent).toContain("no longer available");
  await userEvent.selectOptions(screen.getByLabelText("Replacement content type"), "media");
  expect(
    (screen.getByRole("button", { name: "Replace content" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
it("keeps invalid JSON raw text pending across filters and blocks leaving its language or deleting the passage", async () => {
  render(<Harness content={{ type: "structured", schema: "test", data: { value: 1 } }} all />);
  await userEvent.click(screen.getByRole("button", { name: "Edit JSON data" }));
  fireEvent.change(screen.getByLabelText("Structured JSON data"), {
    target: { value: '{"unfinished":' },
  });
  await userEvent.click(screen.getByRole("button", { name: "Apply JSON data" }));
  expect(screen.getByRole("alert").textContent).toContain("Enter valid JSON");
  expect(
    (screen.getByRole("button", { name: "Build draft preview" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect((screen.getByLabelText("Content language") as HTMLSelectElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Remove" }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Toggle filter" }));
  expect(screen.queryByLabelText("Structured JSON data")).not.toBeNull();
  expect(screen.queryByRole("textbox", { name: "Structured JSON data" })).toBeNull();
  expect(
    (screen.getByRole("button", { name: "Build draft preview" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Toggle filter" }));
  expect((screen.getByLabelText("Structured JSON data") as HTMLTextAreaElement).value).toBe(
    '{"unfinished":',
  );
  expect(working().fragments?.[0]?.content).toEqual({
    type: "structured",
    schema: "test",
    data: { value: 1 },
  });
  await userEvent.click(screen.getByRole("button", { name: "Discard JSON edits" }));
  expect(
    (screen.getByRole("button", { name: "Build draft preview" }) as HTMLButtonElement).disabled,
  ).toBe(false);
});
it("applies valid structured data explicitly and allows recovery", async () => {
  render(<Harness content={{ type: "structured", schema: "test", data: { value: 1 } }} />);
  await userEvent.click(screen.getByRole("button", { name: "Edit JSON data" }));
  fireEvent.change(screen.getByLabelText("Structured JSON data"), {
    target: { value: '{"value":[true,"new"]}' },
  });
  await userEvent.click(screen.getByRole("button", { name: "Apply JSON data" }));
  expect(working().fragments?.[0]?.content).toEqual({
    type: "structured",
    schema: "test",
    data: { value: [true, "new"] },
  });
  expect(checkCreation(canonicalizeCreation(working()).creation).ok).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Undo content change" }));
  expect(working().fragments?.[0]?.content).toEqual({
    type: "structured",
    schema: "test",
    data: { value: 1 },
  });
});
it("edits a translation without losing its keywords and restores a removed translation", async () => {
  render(<Harness content={{ type: "text", text: "Original", format: "plain" }} />);
  await userEvent.selectOptions(screen.getByLabelText("Content language"), "ja");
  await userEvent.clear(screen.getByLabelText("Text"));
  await userEvent.type(screen.getByLabelText("Text"), "更新");
  expect(working().fragments?.[0]?.content).toEqual({
    type: "text",
    text: "Original",
    format: "plain",
  });
  expect(working().fragments?.[0]?.locale?.ja?.activation_keys).toEqual(["日本"]);
  await userEvent.click(screen.getByText("Translations"));
  await userEvent.click(screen.getByRole("button", { name: "Remove this translation" }));
  await userEvent.click(screen.getByRole("button", { name: "Undo content change" }));
  expect(working().fragments?.[0]?.locale?.ja).toEqual({
    content: { type: "text", text: "更新" },
    activation_keys: ["日本"],
  });
});
it("reorders dialogue with keyboard-operable buttons and keeps a recoverable removal", async () => {
  render(
    <Harness
      content={{
        type: "dialogue",
        turns: [
          { speaker: "{{self}}", text: "First" },
          { speaker: "{{user}}", text: "Second" },
        ],
      }}
    />,
  );
  const second = screen.getByRole("group", { name: "Dialogue turn 2" });
  await userEvent.click(within(second).getByRole("button", { name: "Move turn up" }));
  expect((screen.getByLabelText("Text for turn 1") as HTMLTextAreaElement).value).toBe("Second");
  await userEvent.click(
    within(screen.getByRole("group", { name: "Dialogue turn 1" })).getByRole("button", {
      name: "Remove turn",
    }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Undo content change" }));
  expect((screen.getByLabelText("Text for turn 1") as HTMLTextAreaElement).value).toBe("Second");
});

it("keeps unapplied JSON recoverable when a reloaded source changes its content type", async () => {
  const onPendingChange = vi.fn();
  const props = { working: base, onChange: vi.fn(), onPendingChange };
  const { rerender } = render(
    <FragmentContentEditor
      {...props}
      fragment={fragment({ type: "structured", schema: "test", data: { value: 1 } })}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Edit JSON data" }));
  fireEvent.change(screen.getByLabelText("Structured JSON data"), {
    target: { value: '{"unfinished":' },
  });
  rerender(
    <FragmentContentEditor
      {...props}
      fragment={fragment({ type: "text", text: "Remote version" })}
    />,
  );
  expect(
    (screen.getByLabelText("Unapplied JSON from previous content") as HTMLTextAreaElement).value,
  ).toBe('{"unfinished":');
  expect(onPendingChange).toHaveBeenLastCalledWith(expect.any(String), true);
  expect(screen.queryByRole("button", { name: "Apply JSON data" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Discard JSON edits" }));
  expect(onPendingChange).toHaveBeenLastCalledWith(expect.any(String), false);
  expect((screen.getByLabelText("Text") as HTMLTextAreaElement).value).toBe("Remote version");
  expect(props.onChange).not.toHaveBeenCalled();
});
