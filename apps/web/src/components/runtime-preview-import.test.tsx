import { TOKENIZER_VERSIONS, validateRuntimePreviewInput } from "@char-pub/assembler";
import {
  buildIdentity,
  digestExactJSON,
  lateSlotKey,
  type RuntimePreviewInput,
} from "@char-pub/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, previewInput } from "@/lib/preview";
import { buildTestCreation } from "@/test/build";
import { fakeClient, ME, renderWithApp } from "@/test/render";
import { PreviewPanel } from "./preview-panel";
import { RuntimePreviewImport } from "./runtime-preview-import";

function fixture() {
  const { artifact } = buildTestCreation({
    root: {
      release: "rel_01j00000000000000000000000",
      visibility: "public",
      creation: {
        id: "cr_01j00000000000000000000000",
        ref: "@writer/handoff",
        type: "scenario",
        display_name: "Handoff",
        meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
        cast: [{ key: "player", who: { late: "persona" } }],
        story: {
          version: 1,
          scenes: [{ id: "hall", title: "Hall", opening: "{{user}} waits in the hall." }],
          starts: [{ id: "arrive", scene: "hall", greeting: "Original welcome, {{user}}." }],
        },
      },
    },
  });
  if (artifact.kind !== "content" || !artifact.default_policy)
    throw new Error("Content fixture required");
  const settings = {
    ...DEFAULT_SETTINGS,
    lateBindings: {
      [lateSlotKey("root", "player")]: { kind: "persona", name: "Guest", description: "" },
    },
  };
  const input = previewInput(artifact, settings);
  const turn = input.turn;
  const profile = { ...input.profile, context_window: 4096, locale: "en" };
  const payload = validateRuntimePreviewInput(artifact, {
    format: "char.pub/runtime-preview",
    version: 1,
    source: {
      root: artifact.root,
      lock_digest: artifact.lock_digest,
      artifact_json_digest: digestExactJSON(artifact),
    },
    preset: {
      ref: artifact.default_policy.ref,
      semantic_digest: artifact.default_policy.semantic_digest,
      ...buildIdentity(artifact.default_policy),
    },
    tokenizer: { name: "estimate", version: TOKENIZER_VERSIONS.estimate },
    profile,
    turn: {
      locale: "en",
      scene: turn.scene,
      present: turn.present,
      story: turn.story,
      bindings: { ...turn.bindings, user: { kind: "persona", display_name: "Synthetic visitor" } },
      history: [
        { role: "user", text: "A reviewed summary" },
        { role: "assistant", text: "A synthetic answer" },
      ],
    },
  });
  return { artifact, settings, payload };
}
const file = (value: unknown) =>
  new File([JSON.stringify(value)], "runtime-preview.json", { type: "application/json" });
async function upload(value: unknown) {
  await userEvent.upload(screen.getByLabelText("Runtime preview file"), file(value));
}

it("reviews locally before applying the complete synthetic turn and exact profile without adding an opening", async () => {
  const { artifact, settings, payload } = fixture();
  const onSaveTest = vi.fn(async () => "Saved by test callback");
  const putDraft = vi.fn();
  renderWithApp(
    <PreviewPanel artifact={artifact} initialSettings={settings} onSaveTest={onSaveTest} />,
    fakeClient({ me: async () => ME, putDraft }),
  );
  const messages = await screen.findByRole("list", { name: "Assembled messages" });
  expect(messages.textContent).toContain("Original welcome, Sam.");
  await upload(payload);
  await screen.findByRole("region", { name: "Review runtime preview" });
  expect(messages.textContent).not.toContain("A reviewed summary");
  expect(
    (screen.getByRole("button", { name: "Load into preview" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(onSaveTest).not.toHaveBeenCalled();
  expect(putDraft).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("checkbox", {
      name: "I reviewed the state, synthetic messages and role bindings.",
    }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Load into preview" }));
  await waitFor(() =>
    expect(screen.getByRole("list", { name: "Assembled messages" }).textContent).toContain(
      "A reviewed summary",
    ),
  );
  const importedMessages = screen.getByRole("list", { name: "Assembled messages" });
  expect(within(importedMessages).getAllByText("A reviewed summary")).toHaveLength(1);
  expect(importedMessages.textContent).toContain("Synthetic visitor waits in the hall.");
  expect(importedMessages.textContent).not.toContain("Original welcome");
  expect(screen.queryByRole("form", { name: "Session settings" })).toBeNull();
  expect(onSaveTest).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Save preview as author test" }));
  await waitFor(() => expect(onSaveTest).toHaveBeenCalledTimes(1));
  const capture = onSaveTest.mock.calls[0] as unknown as [
    { turn: RuntimePreviewInput["turn"]; profile: RuntimePreviewInput["profile"] },
  ];
  expect(capture[0].turn).toEqual(payload.turn);
  expect(capture[0].profile).toEqual(payload.profile);
  await userEvent.click(screen.getByRole("button", { name: "Exit imported preview" }));
  await waitFor(() =>
    expect(screen.getByRole("list", { name: "Assembled messages" }).textContent).toContain(
      "Original welcome, Sam.",
    ),
  );
  expect(screen.getByRole("form", { name: "Session settings" })).toBeTruthy();
  expect(putDraft).not.toHaveBeenCalled();
});

it("rejects a different artifact and does not trust file-borne approval or retain consent for another file", async () => {
  const { artifact, payload } = fixture();
  const onApply = vi.fn();
  render(
    <RuntimePreviewImport artifact={artifact} active={null} onApply={onApply} onExit={() => {}} />,
  );
  await upload({
    ...payload,
    source: { ...payload.source, artifact_json_digest: `sha256:${"a".repeat(64)}` },
  });
  expect((await screen.findByRole("alert")).textContent).toContain("source_mismatch");
  expect(screen.queryByRole("region", { name: "Review runtime preview" })).toBeNull();
  await upload({ ...payload, reviewed: true });
  expect((await screen.findByRole("alert")).textContent).toContain("invalid_input");
  await upload(payload);
  await screen.findByRole("region", { name: "Review runtime preview" });
  await userEvent.click(screen.getByRole("checkbox"));
  await upload({ ...payload, turn: { ...payload.turn, history: [] } });
  await waitFor(() =>
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false),
  );
  expect(
    (screen.getByRole("button", { name: "Load into preview" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(onApply).not.toHaveBeenCalled();
});

it("ignores a late file read after the account or artifact changes", async () => {
  const { artifact, payload } = fixture();
  const onApply = vi.fn();
  let resolve!: (bytes: ArrayBuffer) => void;
  let sameAccount = true;
  const slow = {
    name: "late.json",
    size: 100,
    arrayBuffer: () =>
      new Promise<ArrayBuffer>((done) => {
        resolve = done;
      }),
  };
  const { rerender } = render(
    <RuntimePreviewImport
      artifact={artifact}
      active={null}
      onApply={onApply}
      onExit={() => {}}
      isCurrent={() => sameAccount}
    />,
  );
  fireEvent.change(screen.getByLabelText("Runtime preview file"), { target: { files: [slow] } });
  sameAccount = false;
  await act(async () => resolve(new TextEncoder().encode(JSON.stringify(payload)).buffer));
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "Review runtime preview" })).toBeNull(),
  );
  sameAccount = true;
  rerender(
    <RuntimePreviewImport
      artifact={structuredClone(artifact)}
      active={null}
      onApply={onApply}
      onExit={() => {}}
    />,
  );
  expect(screen.queryByRole("region", { name: "Review runtime preview" })).toBeNull();
  expect(onApply).not.toHaveBeenCalled();
});
