import type { DraftBuildResponse } from "@char-pub/contracts";
import { requirePublishedArtifact } from "@char-pub/core";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { CreationDetail, Draft, RegistryClient } from "@/lib/api";
import { keys } from "@/lib/registry";
import { buildTestCreation } from "@/test/build";
import { draftOrigin } from "@/test/draft-build";
import { fakeClient, ME, renderWithApp } from "@/test/render";
import { ArtifactPicker } from "./artifact-picker";

const working = {
  id: "cr_01j00000000000000000000007",
  ref: "@writer/mira",
  type: "character",
  display_name: "Mira",
  authors: [{ name: "@writer", user: ME.id }],
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
  fragments: [
    {
      id: "description",
      stable: true,
      kind: "character",
      content: { type: "text", text: "Mira keeps the lighthouse." },
    },
  ],
};
const published = buildTestCreation({
  root: { release: "rel_01j00000000000000000000007", visibility: "public", creation: working },
});
const artifact = requirePublishedArtifact(published.artifact);
const summary = {
  id: artifact.root.release,
  label: "1.0.0",
  visibility: "public" as const,
  status: "active" as const,
  semantic_digest: artifact.root.semantic_digest,
  effective_rating: artifact.meta.rating,
  created_at: "2026-10-01T00:00:00.000Z",
};
const detail: CreationDetail = {
  id: working.id,
  ref: working.ref,
  type: "character",
  display_name: "Mira",
  rating: "general",
  tags: [],
  releases: [summary],
  latest_release: summary,
  dependents_count: 0,
  contribution_policy: "closed",
};
const initial: Draft = {
  version: 1,
  working,
  base_revision_id: null,
  updated_at: "2026-10-01T00:00:00.000Z",
};
const built = buildTestCreation({
  root: { origin: draftOrigin, visibility: "private", creation: working },
});
const receipt: DraftBuildResponse = {
  origin: draftOrigin,
  state: "ready",
  draft_version: 1,
  semantic_digest: built.artifact.root.semantic_digest,
  lock_digest: built.artifact.lock_digest,
  artifact_digest: built.digest,
};
function setup(overrides: Partial<RegistryClient> = {}) {
  const onPick = vi.fn();
  const result = renderWithApp(
    <ArtifactPicker label="Choose cast" types={["character", "persona"]} onPick={onPick} />,
    fakeClient({
      me: async () => ME,
      creation: async () => detail,
      getArtifact: async () => artifact,
      search: async () => ({ items: [detail], next_cursor: null }),
      ...overrides,
    }),
  );
  return { ...result, onPick };
}
async function lookup() {
  await userEvent.type(await screen.findByLabelText("Choose cast address"), working.ref);
  await userEvent.click(screen.getByRole("button", { name: "Look up" }));
  await screen.findByRole("option", { name: "1.0.0 · public" });
}
async function writeNewCharacter() {
  await userEvent.click(await screen.findByRole("button", { name: "Create a character here" }));
  await userEvent.type(screen.getByRole("textbox", { name: "New character name" }), "Mira");
  await userEvent.type(
    screen.getByRole("textbox", { name: "New character introduction" }),
    "Mira keeps the lighthouse.",
  );
  await userEvent.selectOptions(screen.getByLabelText("Character rating"), "general");
  await userEvent.selectOptions(screen.getByLabelText("Character rights"), "original");
  await userEvent.selectOptions(screen.getByLabelText("Character license"), "CC-BY-4.0");
}

it("keeps a failed account check stable until explicit retry", async () => {
  const me = vi.fn().mockRejectedValueOnce(new Error("Account unavailable")).mockResolvedValue(ME);
  const { onPick } = setup({ me });
  expect(await screen.findByText(/Could not check your account/)).toBeTruthy();
  expect(me).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "Retry choices" }));
  expect(await screen.findByLabelText("Choose cast address")).toBeTruthy();
  expect(me).toHaveBeenCalledTimes(2);
  expect(onPick).not.toHaveBeenCalled();
});

it("lists own characters, keeps drafts unselectable and requires an exact published version", async () => {
  const { onPick } = setup({
    myCreations: async () => ({
      items: [
        {
          ref: working.ref,
          type: "character",
          display_name: "Mira",
          status: "active",
          latest_release: summary,
          draft_updated_at: null,
        },
        {
          ref: "@writer/unfinished",
          type: "character",
          display_name: "Unfinished",
          status: "active",
          latest_release: null,
          draft_updated_at: null,
        },
        {
          ref: "@other/shared",
          type: "character",
          display_name: "Another owner's work",
          status: "active",
          latest_release: summary,
          draft_updated_at: null,
        },
      ],
    }),
  });
  await userEvent.click(await screen.findByRole("button", { name: "My creations" }));
  const draft = await screen.findByRole("button", { name: "Unfinished · @writer/unfinished" });
  expect((draft as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText("Another owner's work")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Mira · @writer/mira" }));
  expect(onPick).not.toHaveBeenCalled();
  await userEvent.selectOptions(screen.getByLabelText("Choose cast version"), summary.id);
  await userEvent.click(screen.getByRole("button", { name: "Use version" }));
  expect(onPick).toHaveBeenCalledExactlyOnceWith({
    artifact,
    label: "1.0.0",
    visibility: "public",
  });
});

it("saves and removes personal favorites without selecting them or pretending a creation is a version", async () => {
  const setFavorite = vi.fn(async (_ns: string, _name: string, saved: boolean) => ({
    favorited: saved,
  }));
  const favorites = vi.fn(async () => ({ items: [detail], next_cursor: null }));
  const { onPick } = setup({ favorites, setFavorite });
  await lookup();
  await userEvent.click(screen.getByRole("button", { name: "Save to favorites" }));
  expect(setFavorite).toHaveBeenCalledWith("writer", "mira", true);
  await userEvent.click(screen.getByRole("button", { name: "Favorites" }));
  await userEvent.click(await screen.findByRole("button", { name: "Mira · @writer/mira" }));
  expect(onPick).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Choose cast version") as HTMLSelectElement).value).toBe("");
  await userEvent.click(screen.getByRole("button", { name: "Remove @writer/mira from favorites" }));
  expect(setFavorite).toHaveBeenCalledWith("writer", "mira", false);
});

it("does not bind a late artifact after the QueryClient account changes before React rerenders", async () => {
  let finish!: (value: typeof artifact) => void;
  const getArtifact = vi.fn(
    () =>
      new Promise<typeof artifact>((resolve) => {
        finish = resolve;
      }),
  );
  const { queryClient, onPick } = setup({ getArtifact });
  await lookup();
  await userEvent.selectOptions(screen.getByLabelText("Choose cast version"), summary.id);
  fireEvent.click(screen.getByRole("button", { name: "Use version" }));
  await waitFor(() => expect(getArtifact).toHaveBeenCalledTimes(1));
  await act(async () => {
    queryClient.setQueryData(keys.me, { ...ME, id: "usr_01j00000000000000000000009" });
    finish(artifact);
  });
  expect(onPick).not.toHaveBeenCalled();
});

it("creates valid initial content, explicitly publishes through the real dialog, then selects only the published artifact", async () => {
  let active = false;
  let finish!: (value: typeof artifact) => void;
  const getArtifact = vi
    .fn(async () => artifact)
    .mockImplementationOnce(
      () =>
        new Promise<typeof artifact>((resolve) => {
          finish = resolve;
        }),
    );
  const createCreation = vi.fn(async () => ({
    id: working.id,
    ref: working.ref,
    type: "character" as const,
  }));
  const publish = vi.fn(async () => {
    active = true;
    return { release: summary.id, state: "active" as const, idempotent: false };
  });
  const { onPick } = setup({
    createCreation,
    draft: async () => initial,
    createDraftBuild: async () => receipt,
    draftArtifact: async () => built.artifact,
    publish,
    getArtifact,
    creation: async () => ({
      ...detail,
      releases: active ? [summary] : [],
      latest_release: active ? summary : undefined,
    }),
  });
  await writeNewCharacter();
  await userEvent.click(screen.getByRole("button", { name: "Create character draft" }));
  expect(await screen.findByRole("button", { name: "Review and publish character" })).toBeTruthy();
  expect(createCreation).toHaveBeenCalledWith(
    "writer",
    expect.objectContaining({
      name: "mira",
      type: "character",
      working: {
        fragments: working.fragments,
        meta: working.meta,
      },
    }),
  );
  expect(publish).not.toHaveBeenCalled();
  expect(onPick).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Review and publish character" }));
  await screen.findByText("Ready to publish the reviewed draft.");
  await userEvent.click(screen.getByRole("button", { name: "Publish 1.0.0" }));
  await screen.findByRole("heading", { name: "Published 1.0.0" });
  expect(publish).toHaveBeenCalledWith(
    "writer",
    "mira",
    { revision: draftOrigin.revision, label: "1.0.0", visibility: "public" },
    expect.any(String),
  );
  expect(onPick).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Back to editor" }));
  await screen.findByLabelText("Published character version");
  await userEvent.selectOptions(screen.getByLabelText("Published character version"), summary.id);
  await userEvent.click(screen.getByRole("button", { name: "Use published character" }));
  await userEvent.click(screen.getByRole("button", { name: "Search" }));
  await act(async () => {
    finish(artifact);
  });
  expect(onPick).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Create a character here" }));
  await userEvent.click(screen.getByRole("button", { name: "Use published character" }));
  expect(onPick).toHaveBeenCalledExactlyOnceWith({
    artifact,
    label: "1.0.0",
    visibility: "public",
  });
});

it("recovers a created draft after a read fails instead of creating a second character", async () => {
  const createCreation = vi.fn(async () => ({
    id: working.id,
    ref: working.ref,
    type: "character" as const,
  }));
  const draft = vi
    .fn()
    .mockRejectedValueOnce(new Error("Read interrupted"))
    .mockResolvedValueOnce(initial);
  const { onPick } = setup({ createCreation, draft });
  await writeNewCharacter();
  await userEvent.click(screen.getByRole("button", { name: "Create character draft" }));
  await userEvent.click(await screen.findByRole("button", { name: "Load saved draft" }));
  expect(await screen.findByRole("button", { name: "Review and publish character" })).toBeTruthy();
  expect(createCreation).toHaveBeenCalledTimes(1);
  expect(onPick).not.toHaveBeenCalled();
});
