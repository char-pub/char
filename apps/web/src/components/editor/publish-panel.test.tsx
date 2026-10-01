import type {
  DraftBuildResponse,
  ReferenceImpactResponse,
  ReleaseSummary,
} from "@char-pub/contracts";
import { canonicalizeCreation, requirePublishedArtifact } from "@char-pub/core";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import type { Working } from "@/lib/draft";
import { keys } from "@/lib/registry";
import { buildTestCreation } from "@/test/build";
import { draftBuilt, draftOrigin, draftWorking, readyDraft } from "@/test/draft-build";
import { fakeClient, ME, renderWithApp } from "@/test/render";
import { PublishDialog } from "./publish-panel";

const storyWorking: Working = {
  ...draftWorking,
  type: "scenario",
  policy: undefined,
  cast: [{ key: "player", who: { late: "persona" } }],
  story: {
    version: 1,
    vars: { trust: { type: "int", init: 0, min: 0, max: 10, description: "Trust" } },
    scenes: [{ id: "gate", title: "Gate" }],
  },
};
delete storyWorking.policy;
const storyBuilt = buildTestCreation({
  root: { origin: draftOrigin, visibility: "private", creation: storyWorking },
});
const storyReceipt: DraftBuildResponse = {
  ...readyDraft,
  semantic_digest: storyBuilt.artifact.root.semantic_digest,
  lock_digest: storyBuilt.artifact.lock_digest,
  artifact_digest: storyBuilt.digest,
};
const report = {
  release: "rel_01j00000000000000000000001",
  state: "active" as const,
  idempotent: false,
  label: "1.0.0",
  report: { license_check: "pass" as const, issues: [] },
};
function props(working: Working = draftWorking) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    ns: "writer",
    name: "policy",
    displayName: "Private policy",
    existingLabels: [],
    basedOn: undefined,
    save: async () => ({ working, version: 2 }),
    working,
    onLocate: vi.fn(),
    blocked: null,
    warnings: [],
    references: [],
    onOpenDependencies: vi.fn(),
  };
}

it("automatically prepares an ordinary release and publishes only its reviewed revision", async () => {
  const publish = vi.fn(async () => report),
    createRevision = vi.fn();
  const createDraftBuild = vi.fn(async () => readyDraft);
  renderWithApp(
    <PublishDialog {...props()} />,
    fakeClient({
      me: async () => ME,
      createDraftBuild,
      draftArtifact: async () => draftBuilt.artifact,
      publish,
      createRevision,
    }),
  );
  await screen.findByText("Ready to publish the reviewed draft.");
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(createDraftBuild).toHaveBeenCalledWith("writer", "policy", 2, expect.any(AbortSignal));
  await userEvent.click(screen.getByRole("button", { name: "Publish 1.0.0" }));
  await screen.findByRole("heading", { name: "Published 1.0.0" });
  expect(publish).toHaveBeenCalledExactlyOnceWith(
    "writer",
    "policy",
    { revision: draftOrigin.revision, label: "1.0.0", visibility: "public" },
    expect.any(String),
  );
  expect(createRevision).not.toHaveBeenCalled();
});

it("requires an unchecked explicit confirmation for capabilities from the actual build", async () => {
  const publish = vi.fn(async () => report);
  renderWithApp(
    <PublishDialog {...props(storyWorking)} />,
    fakeClient({
      me: async () => ME,
      createDraftBuild: async () => storyReceipt,
      draftArtifact: async () => storyBuilt.artifact,
      publish,
    }),
  );
  await screen.findByText("Story state and conditions");
  const checkbox = screen.getByRole("checkbox", {
    name: "I understand this release uses experimental capabilities.",
  });
  expect((checkbox as HTMLInputElement).checked).toBe(false);
  const button = screen.getByRole("button", { name: "Publish 1.0.0" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(button);
  expect(publish).not.toHaveBeenCalled();
  await userEvent.click(checkbox);
  await userEvent.click(button);
  await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
});

it("keeps the draft and label while a failed preparation is retried", async () => {
  const createDraftBuild = vi
    .fn()
    .mockRejectedValueOnce(new Error("Connection interrupted"))
    .mockResolvedValueOnce(readyDraft);
  renderWithApp(
    <PublishDialog {...props()} />,
    fakeClient({
      me: async () => ME,
      createDraftBuild,
      draftArtifact: async () => draftBuilt.artifact,
    }),
  );
  await screen.findByText("Connection interrupted");
  await userEvent.clear(screen.getByLabelText("Version label"));
  await userEvent.type(screen.getByLabelText("Version label"), "reviewed");
  await userEvent.click(screen.getByRole("button", { name: "Prepare again" }));
  await screen.findByText("Ready to publish the reviewed draft.");
  expect((screen.getByLabelText("Version label") as HTMLInputElement).value).toBe("reviewed");
  expect(createDraftBuild).toHaveBeenCalledTimes(2);
});

it("rejects a stale local draft after confirmation, instead of snapshotting and publishing newer edits", async () => {
  let edit!: () => void;
  const publish = vi.fn();
  function Harness() {
    const [working, setWorking] = useState(storyWorking);
    edit = () => setWorking({ ...working, display_name: "New local title" });
    return <PublishDialog {...props(working)} />;
  }
  renderWithApp(
    <Harness />,
    fakeClient({
      me: async () => ME,
      createDraftBuild: async () => storyReceipt,
      draftArtifact: async () => storyBuilt.artifact,
      publish,
    }),
  );
  await screen.findByText("Story state and conditions");
  await userEvent.click(screen.getByRole("checkbox"));
  act(edit);
  expect(
    (screen.getByRole("button", { name: "Publish 1.0.0" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain("draft changed");
  expect(publish).not.toHaveBeenCalled();
});

it("does not publish or display a prior account's late build", async () => {
  let finish!: (value: typeof storyBuilt.artifact) => void;
  const late = new Promise<typeof storyBuilt.artifact>((resolve) => {
    finish = resolve;
  });
  const publish = vi.fn(),
    draftArtifact = vi.fn(() => late);
  const { queryClient } = renderWithApp(
    <PublishDialog {...props(storyWorking)} />,
    fakeClient({
      me: async () => ME,
      createDraftBuild: async () => storyReceipt,
      draftArtifact,
      publish,
    }),
  );
  await waitFor(() => expect(draftArtifact).toHaveBeenCalledTimes(1));
  await act(async () => {
    queryClient.setQueryData(keys.me, null);
    finish(storyBuilt.artifact);
  });
  await screen.findByText("Sign in before preparing a release.");
  expect(screen.queryByText("Story state and conditions")).toBeNull();
  expect(publish).not.toHaveBeenCalled();
});

it("cannot publish an expired build", async () => {
  const publish = vi.fn();
  renderWithApp(
    <PublishDialog {...props()} />,
    fakeClient({
      me: async () => ME,
      createDraftBuild: async () => ({
        ...readyDraft,
        origin: { ...draftOrigin, expires_at: "2000-01-01T00:00:00.000Z" },
      }),
      draftArtifact: async () => draftBuilt.artifact,
      publish,
    }),
  );
  await screen.findByText("This build expired. Prepare it again before publishing.");
  expect(
    (screen.getByRole("button", { name: "Publish 1.0.0" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(publish).not.toHaveBeenCalled();
});

it("cancels preparation on close and does not consume its late result", async () => {
  let finish!: (value: typeof readyDraft) => void;
  const draftArtifact = vi.fn();
  const createDraftBuild = vi.fn(
    () =>
      new Promise<typeof readyDraft>((resolve) => {
        finish = resolve;
      }),
  );
  function Harness() {
    const [open, setOpen] = useState(true);
    return <PublishDialog {...props()} open={open} onOpenChange={setOpen} />;
  }
  renderWithApp(<Harness />, fakeClient({ me: async () => ME, createDraftBuild, draftArtifact }));
  await waitFor(() => expect(createDraftBuild).toHaveBeenCalled());
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await act(async () => {
    finish(readyDraft);
  });
  expect(draftArtifact).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("checks the current QueryClient actor before a POST even before React rerenders", async () => {
  const publish = vi.fn();
  const { queryClient } = renderWithApp(
    <PublishDialog {...props()} />,
    fakeClient({
      me: async () => ME,
      createDraftBuild: async () => readyDraft,
      draftArtifact: async () => draftBuilt.artifact,
      publish,
    }),
  );
  await screen.findByText("Ready to publish the reviewed draft.");
  const button = screen.getByRole("button", { name: "Publish 1.0.0" });
  act(() => {
    queryClient.setQueryData(keys.me, { ...ME, id: "usr_01j00000000000000000000002" });
    fireEvent.click(button);
  });
  expect(publish).not.toHaveBeenCalled();
});

it("retries an uncertain publish with the same reviewed revision and idempotency key", async () => {
  const publish = vi
    .fn()
    .mockRejectedValueOnce(new Error("Connection lost"))
    .mockResolvedValueOnce(report);
  const createDraftBuild = vi.fn(async () => readyDraft);
  renderWithApp(
    <PublishDialog {...props()} />,
    fakeClient({
      me: async () => ME,
      createDraftBuild,
      draftArtifact: async () => draftBuilt.artifact,
      publish,
    }),
  );
  await screen.findByText("Ready to publish the reviewed draft.");
  await userEvent.click(screen.getByRole("button", { name: "Publish 1.0.0" }));
  await screen.findByText("The publishing result could not be confirmed.");
  expect(screen.queryByText("Nothing was published.")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("heading", { name: "Published 1.0.0" });
  expect(publish.mock.calls[1]).toEqual(publish.mock.calls[0]);
  expect(createDraftBuild).toHaveBeenCalledTimes(1);
});

it("checks expiry again at the publish side effect, even without a render", async () => {
  const publish = vi.fn();
  renderWithApp(
    <PublishDialog {...props()} />,
    fakeClient({
      me: async () => ME,
      createDraftBuild: async () => readyDraft,
      draftArtifact: async () => draftBuilt.artifact,
      publish,
    }),
  );
  await screen.findByText("Ready to publish the reviewed draft.");
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(draftOrigin.expires_at) + 1);
  try {
    fireEvent.click(screen.getByRole("button", { name: "Publish 1.0.0" }));
  } finally {
    clock.mockRestore();
  }
  expect(publish).not.toHaveBeenCalled();
});

const previousWorking = {
  ...draftWorking,
  ref: "@old-owner/original-policy",
  display_name: "Original title",
};
const previousCanonical = canonicalizeCreation(previousWorking);
const previousArtifact = requirePublishedArtifact(
  buildTestCreation({
    root: {
      release: "rel_01j00000000000000000000010",
      visibility: "public",
      creation: previousWorking,
    },
  }).artifact,
);
const previousRelease: ReleaseSummary = {
  id: "rel_01j00000000000000000000010",
  label: "0.9.0",
  semantic_digest: previousCanonical.semantic_digest,
  status: "active",
  visibility: "public",
  effective_rating: "general",
  created_at: "2026-09-01T00:00:00Z",
};
const previousSource = {
  revision: "rev_01j00000000000000000000010",
  semantic_digest: previousCanonical.semantic_digest,
  creation: previousCanonical.json,
};
const noImpact: ReferenceImpactResponse = {
  base: {
    ref: previousWorking.ref,
    release: previousRelease.id,
    semantic_digest: previousRelease.semantic_digest,
  },
  candidate: { origin: readyDraft.origin, semantic_digest: readyDraft.semantic_digest },
  objects: [],
  items: [],
  next_cursor: null,
  scope: "readable-published-releases",
};
function baselineClient(overrides: Parameters<typeof fakeClient>[0] = {}) {
  return fakeClient({
    me: async () => ME,
    createDraftBuild: async () => readyDraft,
    draftArtifact: async () => draftBuilt.artifact,
    releaseSource: async () => previousSource,
    getArtifact: async () => previousArtifact,
    draftReferenceImpact: async () => noImpact,
    ...overrides,
  });
}
function baselineProps() {
  return { ...props(), basedOn: previousRelease.label, releases: [previousRelease] };
}

it("compares the exact published author definition after a work rename, never an IR-only projection", async () => {
  const publish = vi.fn(async () => report),
    createRevision = vi.fn();
  renderWithApp(
    <PublishDialog {...baselineProps()} />,
    baselineClient({ publish, createRevision }),
  );
  await screen.findByText("Ready to publish the reviewed draft.");
  expect(screen.getByRole("region", { name: "Changes in this release" }).textContent).toContain(
    "Compared with @old-owner/original-policy@0.9.0.",
  );
  expect(screen.getByText("Original title")).toBeTruthy();
  expect(screen.getByText(`Previous revision: ${previousSource.revision}`)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Publish 1.0.0" }));
  await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
  expect(publish).toHaveBeenCalledWith(
    "writer",
    "policy",
    expect.objectContaining({ revision: readyDraft.origin.revision }),
    expect.any(String),
  );
  expect(createRevision).not.toHaveBeenCalled();
});
it("does not use a source whose digest differs from the selected immutable release", async () => {
  const publish = vi.fn();
  renderWithApp(
    <PublishDialog {...baselineProps()} />,
    baselineClient({
      publish,
      releaseSource: async () => ({
        ...previousSource,
        semantic_digest: `sha256:${"0".repeat(64)}`,
      }),
    }),
  );
  await screen.findByText(
    "The previous release definition changed identity. Keep this comparison and try loading it again.",
  );
  expect(
    (screen.getByRole("button", { name: "Publish 1.0.0" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.queryByRole("region", { name: "Changes in this release" })).toBeNull();
  expect(publish).not.toHaveBeenCalled();
});
it("retries a failed baseline load without selecting a different previous release", async () => {
  const releaseSource = vi
    .fn()
    .mockRejectedValueOnce(new Error("Previous source unavailable"))
    .mockResolvedValueOnce(previousSource);
  renderWithApp(<PublishDialog {...baselineProps()} />, baselineClient({ releaseSource }));
  await screen.findByText("Previous source unavailable");
  expect((screen.getByLabelText("Compare with published version") as HTMLSelectElement).value).toBe(
    previousRelease.id,
  );
  await userEvent.click(screen.getByRole("button", { name: "Prepare again" }));
  await screen.findByText("Ready to publish the reviewed draft.");
  expect(releaseSource.mock.calls).toEqual([
    ["writer", "policy", "0.9.0"],
    ["writer", "policy", "0.9.0"],
  ]);
});
it("invalidates a review when the release list changes without silently switching its baseline", async () => {
  let addRelease!: () => void;
  const publish = vi.fn();
  function Harness() {
    const [releases, setReleases] = useState([previousRelease]);
    addRelease = () =>
      setReleases([
        { ...previousRelease, id: "rel_01j00000000000000000000011", label: "0.9.1" },
        previousRelease,
      ]);
    return <PublishDialog {...baselineProps()} releases={releases} />;
  }
  renderWithApp(<Harness />, baselineClient({ publish }));
  await screen.findByText("Ready to publish the reviewed draft.");
  act(addRelease);
  expect((screen.getByLabelText("Compare with published version") as HTMLSelectElement).value).toBe(
    previousRelease.id,
  );
  expect(
    (screen.getByRole("button", { name: "Publish 1.0.0" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(publish).not.toHaveBeenCalled();
});
it("does not render a previous account's late baseline definition", async () => {
  let finish!: (value: typeof previousSource) => void;
  const releaseSource = vi.fn(
    () =>
      new Promise<typeof previousSource>((resolve) => {
        finish = resolve;
      }),
  );
  const { queryClient } = renderWithApp(
    <PublishDialog {...baselineProps()} />,
    baselineClient({ releaseSource }),
  );
  await waitFor(() => expect(releaseSource).toHaveBeenCalled());
  await act(async () => {
    queryClient.setQueryData(keys.me, null);
    finish(previousSource);
  });
  await screen.findByText("Sign in before preparing a release.");
  expect(screen.queryByRole("region", { name: "Changes in this release" })).toBeNull();
  expect(screen.queryByText("Original title")).toBeNull();
});
it("rejects a reference-impact response for another draft build", async () => {
  renderWithApp(
    <PublishDialog {...baselineProps()} />,
    baselineClient({
      draftReferenceImpact: async () => ({
        ...noImpact,
        candidate: { ...noImpact.candidate, semantic_digest: `sha256:${"0".repeat(64)}` },
      }),
    }),
  );
  await screen.findByText(
    "The reference-impact response does not match this review. Prepare it again.",
  );
  expect(
    (screen.getByRole("button", { name: "Publish 1.0.0" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it("keeps the visibility Undo available while a shared-source edit makes the publication review stale", async () => {
  const { sampleDefaultPolicy } = await import("@/fixtures/samples");
  const working: Working = {
    ...storyWorking,
    story: { version: 1, scenes: [{ id: "gate", title: "Gate" }] },
    sources: [
      {
        id: "notes",
        title: "Player notes",
        description: "A reference",
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
            blob: { digest: `sha256:${"1".repeat(64)}`, size: 5, availability: "mirrored" },
          },
        ],
      },
    ],
    assembly: {
      version: "1-draft",
      assembler: { name: "@char-pub/assembler", version: "0.0.0" },
      tokenizer: { name: "estimate", version: "1" },
      preset: {
        ref: "@examples/preview-policy",
        release: sampleDefaultPolicy.release,
        semantic_digest: sampleDefaultPolicy.semantic_digest,
      },
      profile: {
        runtime: { name: "test", version: "1" },
        tokenizer: "estimate",
        mode: "per-agent",
        context_window: 8192,
        reserve_for_output: 512,
        locale: "en",
        capabilities: { system_role: true, multiple_system_messages: true },
      },
    },
  };
  const built = buildTestCreation({
    root: { origin: draftOrigin, creation: working, visibility: "private" },
  });
  const receipt: DraftBuildResponse = {
    ...readyDraft,
    semantic_digest: built.artifact.root.semantic_digest,
    lock_digest: built.artifact.lock_digest,
    artifact_digest: built.digest,
  };
  let current = working;
  function Harness() {
    const [value, setValue] = useState(working);
    current = value;
    return <PublishDialog {...props(value)} update={(change) => setValue((old) => change(old))} />;
  }
  renderWithApp(
    <Harness />,
    fakeClient({
      me: async () => ME,
      createDraftBuild: async () => receipt,
      draftArtifact: async () => built.artifact,
    }),
  );
  await screen.findByText("Ready to publish the reviewed draft.");
  await userEvent.click(screen.getByText("Checks for individual character views"));
  await userEvent.click(
    screen.getByRole("button", { name: "Share Player notes with all characters" }),
  );
  expect(current.sources).toMatchObject([{ visibility: { scope: "shared" } }]);
  expect(
    (screen.getByRole("button", { name: "Publish 1.0.0" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Undo sharing" }));
  expect(current.sources).toEqual(working.sources);
  // Undo restores author data; it does not silently revive a cancelled publication review.
  expect(
    (screen.getByRole("button", { name: "Publish 1.0.0" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
