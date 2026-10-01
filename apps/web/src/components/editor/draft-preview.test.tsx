import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { expect, it, vi } from "vitest";
import { PreviewPanel } from "@/components/preview-panel";
import { ApiError } from "@/lib/api";
import type { Working } from "@/lib/draft";
import { buildTestCreation } from "@/test/build";
import { draftBuilt, draftOrigin, draftWorking, readyDraft } from "@/test/draft-build";
import { fakeClient, ME, renderWithApp } from "@/test/render";
import { DraftPreview } from "./draft-preview";

it("uses the successfully saved version and displays the downloaded server artifact", async () => {
  const save = vi.fn(async () => ({ working: draftWorking, version: 2 }));
  const createDraftBuild = vi.fn(async () => readyDraft),
    draftArtifact = vi.fn(async () => draftBuilt.artifact);
  renderWithApp(
    <DraftPreview ns="writer" name="policy" working={draftWorking} save={save} />,
    fakeClient({ me: async () => ME, createDraftBuild, draftArtifact }),
  );
  await userEvent.click(await screen.findByRole("button", { name: "Build draft preview" }));
  expect(await screen.findByText("PRIVATE_DRAFT_POLICY")).toBeTruthy();
  expect(createDraftBuild).toHaveBeenCalledExactlyOnceWith(
    "writer",
    "policy",
    2,
    expect.any(AbortSignal),
  );
  expect(draftArtifact).toHaveBeenCalledExactlyOnceWith(readyDraft, expect.any(AbortSignal));
  expect(save).toHaveBeenCalledTimes(1);
});

it("does not request a build when saving fails", async () => {
  const createDraftBuild = vi.fn();
  renderWithApp(
    <DraftPreview ns="writer" name="policy" working={draftWorking} save={async () => null} />,
    fakeClient({ me: async () => ME, createDraftBuild }),
  );
  await userEvent.click(await screen.findByRole("button", { name: "Build draft preview" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Save the draft successfully");
  expect(createDraftBuild).not.toHaveBeenCalled();
});

it("stops waiting and ignores a late completed build without deleting it", async () => {
  let finish!: (value: typeof readyDraft) => void;
  const createDraftBuild = vi.fn(
    () =>
      new Promise<typeof readyDraft>((resolve) => {
        finish = resolve;
      }),
  );
  const draftArtifact = vi.fn();
  renderWithApp(
    <DraftPreview
      ns="writer"
      name="policy"
      working={draftWorking}
      save={async () => ({ working: draftWorking, version: 2 })}
    />,
    fakeClient({ me: async () => ME, createDraftBuild, draftArtifact }),
  );
  await userEvent.click(await screen.findByRole("button", { name: "Build draft preview" }));
  await waitFor(() => expect(createDraftBuild).toHaveBeenCalled());
  await userEvent.click(screen.getByRole("button", { name: "Stop waiting" }));
  await act(async () => {
    finish(readyDraft);
  });
  expect(draftArtifact).not.toHaveBeenCalled();
  expect(screen.queryByText("PRIVATE_DRAFT_POLICY")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("server build may still finish");
});

it("shows failed build checks and allows a fresh request after corrections", async () => {
  const createDraftBuild = vi
    .fn()
    .mockResolvedValueOnce({
      ...readyDraft,
      state: "failed",
      report: { issues: [{ code: "source.anchor_not_found", subject: "chapter" }] },
    })
    .mockResolvedValueOnce(readyDraft);
  renderWithApp(
    <DraftPreview
      ns="writer"
      name="policy"
      working={draftWorking}
      save={async () => ({ working: draftWorking, version: 2 })}
    />,
    fakeClient({
      me: async () => ME,
      createDraftBuild,
      draftArtifact: async () => draftBuilt.artifact,
    }),
  );
  await userEvent.click(await screen.findByRole("button", { name: "Build draft preview" }));
  expect((await screen.findByRole("alert")).textContent).toContain("could not be built");
  expect(screen.getByText("Build checks")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Build draft preview" }));
  expect(await screen.findByText("PRIVATE_DRAFT_POLICY")).toBeTruthy();
});

it("does not download a completed private build after the account cache changes before remount", async () => {
  let finish!: (value: typeof readyDraft) => void;
  const createDraftBuild = vi.fn(
    () =>
      new Promise<typeof readyDraft>((resolve) => {
        finish = resolve;
      }),
  );
  const draftArtifact = vi.fn();
  const { queryClient } = renderWithApp(
    <DraftPreview
      ns="writer"
      name="policy"
      working={draftWorking}
      save={async () => ({ working: draftWorking, version: 2 })}
    />,
    fakeClient({ me: async () => ME, createDraftBuild, draftArtifact }),
  );
  await userEvent.click(await screen.findByRole("button", { name: "Build draft preview" }));
  await waitFor(() => expect(createDraftBuild).toHaveBeenCalled());
  await act(async () => {
    queryClient.setQueryData(["me"], { ...ME, id: "usr_01j00000000000000000000002" });
    finish(readyDraft);
  });
  expect(draftArtifact).not.toHaveBeenCalled();
  expect(screen.queryByText("PRIVATE_DRAFT_POLICY")).toBeNull();
});

const contentWorking: Working = {
  id: "cr_01j00000000000000000000000",
  ref: "@writer/world",
  type: "world",
  display_name: "World",
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
  fragments: [
    { id: "world", stable: true, kind: "world", content: { type: "text", text: "A quiet inn." } },
  ],
};
const contentBuilt = buildTestCreation({
  root: { origin: draftOrigin, visibility: "private", creation: contentWorking },
});
function captureClient() {
  return fakeClient({
    me: async () => ME,
    createDraftBuild: async () => ({
      ...readyDraft,
      semantic_digest: contentBuilt.artifact.root.semantic_digest,
      lock_digest: contentBuilt.artifact.lock_digest,
      artifact_digest: contentBuilt.digest,
    }),
    draftArtifact: async () => contentBuilt.artifact,
  });
}
it.each(["Build draft preview", "Try draft in Runtime"])(
  "explains missing service policy for %s and can retry without changing the draft",
  async (action) => {
    const original = structuredClone(contentWorking);
    const receipt = {
      ...readyDraft,
      semantic_digest: contentBuilt.artifact.root.semantic_digest,
      lock_digest: contentBuilt.artifact.lock_digest,
      artifact_digest: contentBuilt.digest,
    };
    const createDraftBuild = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(503, "draft_build.default_policy_unavailable"))
      .mockResolvedValueOnce(receipt);
    const draftArtifact = vi.fn(async () => contentBuilt.artifact);
    renderWithApp(
      <DraftPreview
        ns="writer"
        name="world"
        working={contentWorking}
        save={async () => ({ working: contentWorking, version: 2 })}
      />,
      fakeClient({ me: async () => ME, createDraftBuild, draftArtifact }),
    );
    await userEvent.click(await screen.findByRole("button", { name: action }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("default context preset");
    expect(alert.textContent).toContain("administrator");
    expect(alert.textContent).toContain("editing it will not fix this service configuration");
    expect(alert.textContent).not.toContain("draft_build.default_policy_unavailable");
    expect(draftArtifact).not.toHaveBeenCalled();
    expect(contentWorking).toEqual(original);
    await userEvent.click(screen.getByRole("button", { name: action }));
    await waitFor(() => expect(draftArtifact).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(createDraftBuild).toHaveBeenNthCalledWith(
      2,
      "writer",
      "world",
      2,
      expect.any(AbortSignal),
    );
  },
);
it("builds the saved draft before opening its exact Runtime handoff", async () => {
  const save = vi.fn(async () => ({ working: contentWorking, version: 2 }));
  const createDraftBuild = vi.fn(async () => ({
    ...readyDraft,
    semantic_digest: contentBuilt.artifact.root.semantic_digest,
    lock_digest: contentBuilt.artifact.lock_digest,
    artifact_digest: contentBuilt.digest,
  }));
  renderWithApp(
    <DraftPreview ns="writer" name="world" working={contentWorking} save={save} />,
    fakeClient({
      me: async () => ME,
      createDraftBuild,
      draftArtifact: async () => contentBuilt.artifact,
    }),
  );
  await userEvent.click(await screen.findByRole("button", { name: "Try draft in Runtime" }));
  const dialog = await screen.findByRole("dialog", { name: "Open in a Runtime" });
  expect(dialog.textContent).toContain(`@writer/world · ${draftOrigin.build_id}`);
  expect(createDraftBuild).toHaveBeenCalledExactlyOnceWith(
    "writer",
    "world",
    2,
    expect.any(AbortSignal),
  );
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Runtime launch URL")).toBeTruthy();
});
function CaptureHarness() {
  const [working, setWorking] = useState(contentWorking);
  const latest = useRef(working);
  latest.current = working;
  const update = (fn: (w: Working) => Working) => {
    const next = fn(latest.current);
    latest.current = next;
    setWorking(next);
  };
  return (
    <>
      <DraftPreview
        ns="writer"
        name="world"
        working={working}
        update={update}
        save={async () => ({ working: latest.current, version: 2 })}
      />
      <button type="button" onClick={() => update((w) => ({ ...w, summary: "A later change" }))}>
        Change draft
      </button>
      <output data-testid="capture-working">{JSON.stringify(working)}</output>
    </>
  );
}
it("saves one actual preview expectation and disables capturing the now older build", async () => {
  renderWithApp(<CaptureHarness />, captureClient());
  await userEvent.click(await screen.findByRole("button", { name: "Build draft preview" }));
  const save = await screen.findByRole("button", { name: "Save preview as author test" });
  await userEvent.click(save);
  await screen.findByText(
    "Saved author test preview. Run author tests to verify it against a new build.",
  );
  const working = JSON.parse(screen.getByTestId("capture-working").textContent ?? "{}");
  expect(working.assembly_tests).toHaveLength(1);
  expect(working.assembly_tests[0]).toMatchObject({
    id: "preview",
    root: "self",
    expected: { kind: "success" },
  });
  expect(working.assembly_tests[0].expected.messages_digest).toMatch(/^sha256:/);
  expect((save as HTMLButtonElement).disabled).toBe(true);
});
it("refuses an old preview after editing or after the account cache changes", async () => {
  const { queryClient } = renderWithApp(<CaptureHarness />, captureClient());
  await userEvent.click(await screen.findByRole("button", { name: "Build draft preview" }));
  const save = await screen.findByRole("button", { name: "Save preview as author test" });
  await act(async () => {
    queryClient.setQueryData(["me"], { ...ME, id: "usr_01j00000000000000000000002" });
    save.click();
  });
  expect(JSON.parse(screen.getByTestId("capture-working").textContent ?? "{}")).not.toHaveProperty(
    "assembly_tests",
  );
});
it("disables capture when current author edits differ from the built snapshot", async () => {
  renderWithApp(<CaptureHarness />, captureClient());
  await userEvent.click(await screen.findByRole("button", { name: "Build draft preview" }));
  const save = await screen.findByRole("button", { name: "Save preview as author test" });
  await userEvent.click(screen.getByRole("button", { name: "Change draft" }));
  expect((save as HTMLButtonElement).disabled).toBe(true);
});

it("refuses capturing an expired cached draft without changing the work", async () => {
  renderWithApp(<CaptureHarness />, captureClient());
  await userEvent.click(await screen.findByRole("button", { name: "Build draft preview" }));
  const button = await screen.findByRole("button", { name: "Save preview as author test" });
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2100-01-01T00:00:00Z"));
  try {
    await userEvent.click(button);
    expect((await screen.findByRole("alert")).textContent).toContain("has expired");
    expect(
      JSON.parse(screen.getByTestId("capture-working").textContent ?? "{}"),
    ).not.toHaveProperty("assembly_tests");
  } finally {
    clock.mockRestore();
  }
});
it("does not show a saved notice on a different preview job", async () => {
  if (contentBuilt.artifact.kind !== "content") throw new Error("content expected");
  let finish: (message: string) => void = () => {};
  const save = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  renderWithApp(
    <PreviewPanel artifact={contentBuilt.artifact} onSaveTest={save} />,
    captureClient(),
  );
  await userEvent.click(await screen.findByRole("button", { name: "Save preview as author test" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  await userEvent.clear(screen.getByLabelText("Persona name"));
  await userEvent.type(screen.getByLabelText("Persona name"), "Another reader");
  await act(async () => {
    finish("OLD_SAVED_NOTICE");
  });
  await screen.findByRole("button", { name: "Save preview as author test" });
  expect(screen.queryByText("OLD_SAVED_NOTICE")).toBeNull();
});
