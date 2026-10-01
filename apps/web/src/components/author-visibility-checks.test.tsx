import { type CreationInput, canonicalizeCreation, lateSlotKey, sha256Bytes } from "@char-pub/core";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { expect, it, vi } from "vitest";
import { authorVisibilityChecks, shareAuthorSource } from "@/lib/author-visibility";
import type { Working } from "@/lib/draft";
import { DEFAULT_SETTINGS } from "@/lib/preview";
import { buildTestCreation } from "@/test/build";
import { draftOrigin, readyDraft } from "@/test/draft-build";
import { fakeClient, ME, renderWithApp } from "@/test/render";
import { AuthorVisibilityChecks } from "./author-visibility-checks";
import { DraftPreview } from "./editor/draft-preview";
import { PreviewPanel } from "./preview-panel";

function fixture(scenario = false) {
  const body = new TextEncoder().encode("UNFETCHED_REFERENCE_BODY");
  const working = {
    id: "cr_01j00000000000000000000000",
    ref: "@writer/visibility",
    type: scenario ? "scenario" : "character",
    display_name: "Guard",
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    fragments: scenario
      ? []
      : [
          {
            id: "self",
            stable: true,
            kind: "character",
            content: { type: "text", text: "A guard." },
          },
        ],
    sources: [
      {
        id: "notes",
        title: "Guard notes",
        description: "Reference clues",
        asset: "notes",
        format: "text",
      },
    ],
    assets: [
      {
        slot: "notes",
        role: "context",
        variants: [
          {
            id: "default",
            media_type: "text/plain",
            blob: { digest: sha256Bytes(body), size: body.length, availability: "mirrored" },
          },
        ],
      },
    ],
    ...(scenario
      ? {
          cast: [
            { key: "alice", who: { late: "character" as const }, goal: "Find the key" },
            { key: "bob", who: { late: "character" as const } },
          ],
          story: {
            version: 1 as const,
            scenes: [
              {
                id: "hall",
                title: "Hall",
                cast: ["alice", "bob"],
                goals: { bob: "Watch the door" },
              },
            ],
          },
        }
      : {}),
  } satisfies CreationInput;
  const built = buildTestCreation({
    root: { creation: working, origin: draftOrigin, visibility: "private" },
  });
  if (built.artifact.kind !== "content") throw new Error("Expected content");
  const source = built.artifact.catalog_index.sources[0];
  if (!source) throw new Error("Expected source");
  return {
    working,
    artifact: built.artifact,
    source,
    receipt: {
      ...readyDraft,
      semantic_digest: built.artifact.root.semantic_digest,
      lock_digest: built.artifact.lock_digest,
      artifact_digest: built.digest,
    },
  };
}

it("checks each participant instance and distinguishes public bindings from private descriptions", () => {
  const { artifact } = fixture(true);
  const checks = authorVisibilityChecks(artifact, {
    [lateSlotKey("root", "alice")]: {
      kind: "character",
      display_name: "Twin",
      description: "PRIVATE_ALICE",
    },
    [lateSlotKey("root", "bob")]: {
      kind: "character",
      display_name: "Twin",
      outward_description: "A blue coat",
    },
  });
  expect(checks.filter((c) => c.kind === "outward").map((c) => c.title)).toContain("Twin · alice");
  expect(checks.filter((c) => c.kind === "outward").map((c) => c.title)).not.toContain(
    "Twin · bob",
  );
  expect(checks.filter((c) => c.kind === "goal")).toHaveLength(2);
  expect(checks.find((c) => c.kind === "source")).toMatchObject({
    subject: "sources[notes]",
    shareSource: artifact.catalog_index.sources[0]?.id,
  });
  expect(JSON.stringify(checks)).not.toContain("PRIVATE_ALICE");
});

it("recognizes an authored outward character fragment", () => {
  const { working } = fixture();
  const { artifact } = buildTestCreation({
    root: {
      creation: {
        ...working,
        fragments: [
          ...working.fragments,
          {
            id: "appearance",
            stable: true,
            kind: "character",
            outward: true,
            content: { type: "text", text: "A silver badge." },
          },
        ],
      },
      origin: draftOrigin,
      visibility: "private",
    },
  });
  if (artifact.kind !== "content") throw new Error("Expected content");
  expect(
    authorVisibilityChecks(artifact)
      .filter((check) => check.kind === "outward")
      .map((check) => check.id),
  ).not.toContain("self");
});

it("shares only a local source and undoes without overwriting unrelated edits or subsequent source changes", () => {
  const { artifact, working, source } = fixture();
  const change = shareAuthorSource(working, artifact, source.id);
  const rebuilt = buildTestCreation({
    root: { creation: change.working, origin: draftOrigin, visibility: "private" },
  });
  if (rebuilt.artifact.kind !== "content") throw new Error("Expected content");
  expect(rebuilt.artifact.catalog_index.sources[0]?.shared).toBe(true);
  expect(source.shared).toBe(false);
  const later = { ...change.working, summary: "Keep this edit" };
  expect(change.undo(later)).toEqual({ ...working, summary: "Keep this edit" });
  expect(() => change.undo({ ...later, sources: [] })).toThrow("changed after sharing");
  expect(() =>
    change.undo({
      ...later,
      sources: [{ ...working.sources?.[0], title: "Changed", visibility: { scope: "shared" } }],
    }),
  ).toThrow("changed after sharing");
  expect(() => shareAuthorSource(working, artifact, "missing")).toThrow(
    "Only an unshared document",
  );
});

it("names an imported source's authoring work without offering a local visibility edit", () => {
  const { working } = fixture();
  const world: CreationInput = {
    ...working,
    id: "cr_01j00000000000000000000001",
    ref: "@writer/library",
    type: "world",
    fragments: [
      { id: "world", stable: true, kind: "world", content: { type: "text", text: "A library." } },
    ],
  };
  const release = "rel_01j00000000000000000000001";
  const root = {
    ...working,
    sources: [],
    assets: [],
    references: [
      {
        id: "library",
        use: world.ref,
        mode: "default",
        pin: { release, semantic_digest: canonicalizeCreation(world).semantic_digest },
      },
    ],
  } satisfies CreationInput;
  const { artifact } = buildTestCreation({
    root: { creation: root, origin: draftOrigin, visibility: "private" },
    dependencies: [{ creation: world, release, visibility: "public" }],
  });
  if (artifact.kind !== "content") throw new Error("Expected content");
  const check = authorVisibilityChecks(artifact).find((entry) => entry.kind === "source");
  expect(check?.detail).toContain("@writer/library");
  expect(check?.shareSource).toBeUndefined();
  expect(check?.subject).toBeUndefined();
  expect(() => shareAuthorSource(root, artifact, check?.id ?? "")).toThrow(
    "Only an unshared document",
  );
});

it("shows read-only checks without offering write actions", async () => {
  renderWithApp(
    <AuthorVisibilityChecks artifact={fixture().artifact} />,
    fakeClient({ me: async () => ME }),
  );
  await userEvent.click(await screen.findByText("Checks for individual character views"));
  expect(screen.getByText("Guard notes")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Share|Locate|Undo/ })).toBeNull();
});

it("keeps author suggestions out of public previews and projects only a late role's outward description to others", async () => {
  const { artifact } = fixture(true);
  const sourceText = vi.fn();
  renderWithApp(
    <PreviewPanel
      artifact={artifact}
      initialSettings={{
        ...DEFAULT_SETTINGS,
        mode: "per-agent",
        forParticipant: "alice",
        lateBindings: {
          [lateSlotKey("root", "alice")]: {
            kind: "character",
            name: "Alice",
            description: "ALICE_SECRET",
          },
          [lateSlotKey("root", "bob")]: {
            kind: "character",
            name: "Bob",
            description: "BOB_SECRET",
            outwardDescription: "BOB_PUBLIC_COAT",
          },
        },
      }}
    />,
    fakeClient({ me: async () => ME, sourceText }),
  );
  const messages = await screen.findByRole("list", { name: "Assembled messages" });
  expect(messages.textContent).toContain("BOB_PUBLIC_COAT");
  expect(messages.textContent).not.toContain("BOB_SECRET");
  expect(screen.queryByText("Checks for individual character views")).toBeNull();
  const outward = screen.getAllByRole("textbox", { name: /^Outward description/ })[1];
  if (!outward) throw new Error("Expected Bob's outward input");
  await userEvent.clear(outward);
  await userEvent.type(outward, "BOB_PUBLIC_HAT");
  await waitFor(() =>
    expect(screen.getByRole("list", { name: "Assembled messages" }).textContent).toContain(
      "BOB_PUBLIC_HAT",
    ),
  );
  const updated = screen.getByRole("list", { name: "Assembled messages" });
  expect(updated.textContent).not.toContain("BOB_SECRET");
  expect(updated.textContent).not.toContain("BOB_PUBLIC_COAT");
  expect(sourceText).not.toHaveBeenCalled();
});

function draftHarness(skipUpdate = false) {
  const { working: original, artifact, receipt } = fixture();
  const createDraftBuild = vi.fn(async () => receipt);
  const sourceText = vi.fn();
  function Harness() {
    const [working, setWorking] = useState<Working>(original);
    const latest = useRef(working);
    const update = (fn: (value: Working) => Working) => {
      if (skipUpdate) return;
      latest.current = fn(latest.current);
      setWorking(latest.current);
    };
    return (
      <>
        <DraftPreview
          ns="writer"
          name="visibility"
          working={working}
          update={update}
          save={async () => ({ working: latest.current, version: 2 })}
        />
        <button
          type="button"
          onClick={() => update((value) => ({ ...value, summary: "Later edit" }))}
        >
          Edit summary
        </button>
        <output data-testid="working">{JSON.stringify(working)}</output>
      </>
    );
  }
  const rendered = renderWithApp(
    <Harness />,
    fakeClient({
      me: async () => ME,
      createDraftBuild,
      draftArtifact: async () => artifact,
      sourceText,
    }),
  );
  return { ...rendered, createDraftBuild, sourceText, original };
}

async function openChecks() {
  await userEvent.click(await screen.findByRole("button", { name: "Build draft preview" }));
  await screen.findByRole("list", { name: "Assembled messages" });
  await userEvent.click(screen.getByRole("radio", { name: "Per-agent" }));
  await userEvent.selectOptions(screen.getByLabelText("Speaking participant"), "self");
  await userEvent.click(await screen.findByText("Checks for individual character views"));
  return screen.getByRole("button", { name: "Share Guard notes with all characters" });
}

it("shares from the exact draft preview, requires rebuilding, and supports undo while preserving later edits", async () => {
  const { createDraftBuild, sourceText, original } = draftHarness();
  await userEvent.click(await openChecks());
  expect(
    JSON.parse(screen.getByTestId("working").textContent ?? "{}").sources[0].visibility,
  ).toEqual({ scope: "shared" });
  expect(
    screen
      .getByRole("button", { name: "Share Guard notes with all characters" })
      .hasAttribute("disabled"),
  ).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Edit summary" }));
  await userEvent.click(screen.getByRole("button", { name: "Undo sharing" }));
  expect(JSON.parse(screen.getByTestId("working").textContent ?? "{}")).toEqual({
    ...original,
    summary: "Later edit",
  });
  expect(createDraftBuild).toHaveBeenCalledTimes(1);
  expect(sourceText).not.toHaveBeenCalled();
});

it("does not claim success when the editor rejects an update", async () => {
  const { original } = draftHarness(true);
  await userEvent.click(await openChecks());
  expect(
    await screen.findByText(
      "The draft cannot be edited now. Resolve its save state before sharing.",
    ),
  ).toBeTruthy();
  expect(JSON.parse(screen.getByTestId("working").textContent ?? "{}")).toEqual(original);
  expect(screen.queryByRole("button", { name: "Undo sharing" })).toBeNull();
});

it("rejects a sharing click when the actor changes before the view catches up", async () => {
  const { queryClient, original } = draftHarness();
  const share = await openChecks();
  await act(async () => {
    queryClient.setQueryData(["me"], { ...ME, id: "usr_01j00000000000000000000002" });
    share.click();
  });
  await waitFor(() =>
    expect(JSON.parse(screen.getByTestId("working").textContent ?? "{}")).toEqual(original),
  );
  expect(within(document.body).queryByRole("button", { name: "Undo sharing" })).toBeNull();
});

it("rejects a preview that expires immediately before sharing", async () => {
  const { original } = draftHarness();
  const share = await openChecks();
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse(draftOrigin.expires_at));
  try {
    await act(async () => share.click());
    expect(
      screen.getByText("This preview expired. Build it again before sharing a document."),
    ).toBeTruthy();
    expect(JSON.parse(screen.getByTestId("working").textContent ?? "{}")).toEqual(original);
    expect(screen.queryByRole("button", { name: "Undo sharing" })).toBeNull();
  } finally {
    now.mockRestore();
  }
});
