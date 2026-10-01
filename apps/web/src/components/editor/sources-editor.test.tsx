import { canonicalizeCreation, checkCreation, type KnowledgeSource } from "@char-pub/core";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import type { RegistryClient, UploadStatus } from "@/lib/api";
import type { Working } from "@/lib/draft";
import { fakeClient, ME, renderWithApp } from "@/test/render";
import { SourcesEditor } from "./sources-editor";

const initial: Working = {
  id: "cr_01j00000000000000000000000",
  ref: "@writer/world",
  type: "world",
  display_name: "World",
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
  fragments: [
    { id: "world", stable: true, kind: "world", content: { type: "text", text: "An old inn." } },
  ],
};
function Editor({ start = initial }: { start?: Working }) {
  const [working, update] = useState(start);
  return (
    <>
      <SourcesEditor working={working} update={update} />
      <button
        type="button"
        onClick={() => update((w) => ({ ...w, summary: "Edited while the file was uploading" }))}
      >
        Edit another field
      </button>
      <button
        type="button"
        onClick={() =>
          update({ ...initial, id: "cr_01j00000000000000000000001", ref: "@writer/other-world" })
        }
      >
        Switch work
      </button>
      <output data-testid="working">{JSON.stringify(working)}</output>
    </>
  );
}
function current(): Working {
  return JSON.parse(screen.getByTestId("working").textContent ?? "{}");
}
function documents(): KnowledgeSource[] {
  return (current().sources as KnowledgeSource[] | undefined) ?? [];
}
function uploadClient() {
  const requests = new Map<string, Parameters<RegistryClient["createUpload"]>[0]>();
  let n = 0;
  const createUpload = vi.fn<RegistryClient["createUpload"]>(async (body) => {
    const upload = `upload-${++n}`;
    requests.set(upload, body);
    return {
      upload,
      put_url: "https://upload.example.test/put",
      headers: {},
      expires_at: "2026-10-01T00:00:00Z",
    };
  });
  const ready = (id: string): UploadStatus => {
    const request = requests.get(id);
    if (!request) throw new Error("Unknown upload");
    return {
      upload: id,
      status: "ready",
      blob: { digest: request.sha256, size: request.size, media_type: request.content_type },
    };
  };
  const putUpload = vi.fn<RegistryClient["putUpload"]>(async () => {});
  const completeUpload = vi.fn<RegistryClient["completeUpload"]>(async (id) => ready(id));
  const upload = vi.fn<RegistryClient["upload"]>(async (id) => ready(id));
  return {
    client: fakeClient({ me: async () => ME, createUpload, putUpload, completeUpload, upload }),
    createUpload,
    putUpload,
    completeUpload,
    upload,
    ready,
  };
}
async function pick(description = "Inn maps and exits") {
  await userEvent.upload(
    await screen.findByLabelText("Reference file"),
    new File(["\uFEFF# Plans\r\nOriginal text\r\n"], "plans.md", { type: "text/markdown" }),
  );
  await userEvent.type(screen.getByLabelText("Document description"), description);
}

it("adds a valid reference and its context asset together after upload, with required description", async () => {
  const c = uploadClient();
  renderWithApp(<Editor />, c.client);
  await userEvent.upload(
    await screen.findByLabelText("Reference file"),
    new File(["# Plans"], "plans.md", { type: "text/markdown" }),
  );
  expect(
    (screen.getByRole("button", { name: "Upload reference" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(c.createUpload).not.toHaveBeenCalled();
  await userEvent.type(screen.getByLabelText("Document description"), "Inn maps and exits");
  await userEvent.click(screen.getByLabelText("Share with every participant"));
  await userEvent.click(screen.getByRole("button", { name: "Upload reference" }));
  await screen.findByText("Document added. Build a draft preview to check and use it.");
  expect(documents()).toMatchObject([
    {
      id: "plans",
      title: "plans",
      description: "Inn maps and exits",
      format: "markdown",
      visibility: { scope: "shared" },
    },
  ]);
  const document = documents()[0];
  expect(current().assets).toMatchObject([
    {
      slot: document?.asset,
      role: "context",
      variants: [{ media_type: "text/markdown", blob: { availability: "mirrored" } }],
    },
  ]);
  expect(checkCreation(canonicalizeCreation(current()).creation).ok).toBe(true);
});

it("merges the completed document into current edits, not the pre-upload working snapshot", async () => {
  const c = uploadClient();
  let complete: (status: UploadStatus) => void = () => {};
  c.completeUpload.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  renderWithApp(<Editor />, c.client);
  await pick();
  await userEvent.click(screen.getByRole("button", { name: "Upload reference" }));
  await waitFor(() => expect(c.completeUpload).toHaveBeenCalledTimes(1));
  expect(documents()).toHaveLength(0);
  expect(current().assets).toBeUndefined();
  await userEvent.click(screen.getByRole("button", { name: "Edit another field" }));
  await act(async () => {
    complete(c.ready("upload-1"));
  });
  await screen.findByText("Document added. Build a draft preview to check and use it.");
  expect(current().summary).toBe("Edited while the file was uploading");
  expect(documents()).toHaveLength(1);
});

it("cancels adding without applying a late ready response", async () => {
  const c = uploadClient();
  let complete: (status: UploadStatus) => void = () => {};
  c.completeUpload.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  renderWithApp(<Editor />, c.client);
  await pick();
  await userEvent.click(screen.getByRole("button", { name: "Upload reference" }));
  await waitFor(() => expect(c.completeUpload).toHaveBeenCalled());
  await userEvent.click(screen.getByRole("button", { name: "Cancel adding document" }));
  await act(async () => {
    complete(c.ready("upload-1"));
  });
  expect(documents()).toHaveLength(0);
  expect(current().assets).toBeUndefined();
  expect(screen.getByText(/Cancelled. No document was added/)).toBeTruthy();
});

it("does not attach a late upload to a different work", async () => {
  const c = uploadClient();
  let complete: (status: UploadStatus) => void = () => {};
  c.completeUpload.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  renderWithApp(<Editor />, c.client);
  await pick();
  await userEvent.click(screen.getByRole("button", { name: "Upload reference" }));
  await waitFor(() => expect(c.completeUpload).toHaveBeenCalled());
  await userEvent.click(screen.getByRole("button", { name: "Switch work" }));
  await act(async () => {
    complete(c.ready("upload-1"));
  });
  expect(current().ref).toBe("@writer/other-world");
  expect(documents()).toHaveLength(0);
  expect(current().assets).toBeUndefined();
});

it("keeps document details and checks an uncertain completion without reuploading", async () => {
  const c = uploadClient();
  c.completeUpload.mockRejectedValueOnce(new Error("lost acknowledgement"));
  renderWithApp(<Editor />, c.client);
  await pick();
  await userEvent.click(screen.getByRole("button", { name: "Upload reference" }));
  expect((await screen.findByRole("alert")).textContent).toContain("file was sent");
  expect((screen.getByLabelText("Document description") as HTMLTextAreaElement).value).toBe(
    "Inn maps and exits",
  );
  expect(documents()).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Check processing" }));
  await screen.findByText("Document added. Build a draft preview to check and use it.");
  expect(c.createUpload).toHaveBeenCalledTimes(1);
  expect(c.putUpload).toHaveBeenCalledTimes(1);
  expect(c.upload).toHaveBeenCalledWith("upload-1");
});

it("edits only the default language, preserves sections, and restores the removed asset declaration on undo", async () => {
  const document: KnowledgeSource = {
    id: "book",
    title: { en: "Guide", ja: "案内" },
    description: { en: "Original description", ja: "案内文" },
    format: "markdown",
    asset: "book-file",
    sections: [{ id: "inn", title: "Inn", description: "The inn", anchor: "#Inn" }],
  };
  const start: Working = {
    ...initial,
    sources: [document],
    assets: [
      {
        slot: "book-file",
        role: "context",
        variants: [
          {
            id: "default",
            media_type: "text/markdown",
            blob: { digest: `sha256:${"a".repeat(64)}`, size: 10, availability: "mirrored" },
          },
        ],
      },
    ],
  };
  const c = uploadClient();
  renderWithApp(<Editor start={start} />, c.client);
  await userEvent.clear(await screen.findByLabelText("Description for book"));
  await userEvent.type(screen.getByLabelText("Description for book"), "Updated reference summary");
  expect(documents()[0]).toMatchObject({
    description: { en: "Updated reference summary", ja: "案内文" },
    sections: document.sections,
  });
  await userEvent.click(screen.getByRole("button", { name: "Remove book" }));
  expect(documents()).toHaveLength(0);
  expect(current().assets).toEqual([]);
  await userEvent.click(screen.getByRole("button", { name: "Undo document removal" }));
  expect(documents()[0]).toMatchObject({
    id: "book",
    description: { en: "Updated reference summary", ja: "案内文" },
    sections: document.sections,
  });
  expect(current().assets).toEqual(start.assets);
  expect(c.createUpload).not.toHaveBeenCalled();
});

it("ignores a late ready upload after switching the signed-in account", async () => {
  const c = uploadClient();
  let complete: (status: UploadStatus) => void = () => {};
  c.completeUpload.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const { queryClient } = renderWithApp(<Editor />, c.client);
  await pick();
  await userEvent.click(screen.getByRole("button", { name: "Upload reference" }));
  await waitFor(() => expect(c.completeUpload).toHaveBeenCalled());
  await act(async () => {
    queryClient.setQueryData(["me"], { ...ME, id: "usr_01j00000000000000000000001" });
  });
  await act(async () => {
    complete(c.ready("upload-1"));
  });
  expect(documents()).toHaveLength(0);
  expect(current().assets).toBeUndefined();
  expect(
    screen.queryByText("Document added. Build a draft preview to check and use it."),
  ).toBeNull();
});

it("keeps an overlong description editable and prevents invalid Source creation", async () => {
  const c = uploadClient();
  renderWithApp(<Editor />, c.client);
  await pick("x".repeat(201));
  expect(
    (screen.getByRole("button", { name: "Upload reference" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain("1–200");
  expect(c.createUpload).not.toHaveBeenCalled();
  await userEvent.clear(screen.getByLabelText("Document description"));
  await userEvent.type(screen.getByLabelText("Document description"), "A useful description");
  await userEvent.click(screen.getByRole("button", { name: "Upload reference" }));
  await screen.findByText("Document added. Build a draft preview to check and use it.");
  expect(documents()[0]?.description).toBe("A useful description");
});

it("keeps an asset declaration that another document still uses", async () => {
  const start: Working = {
    ...initial,
    sources: [
      { id: "one", title: "One", description: "First guide", asset: "shared-file", format: "text" },
      {
        id: "two",
        title: "Two",
        description: "Second guide",
        asset: "shared-file",
        format: "text",
      },
    ],
    assets: [
      {
        slot: "shared-file",
        role: "context",
        variants: [
          {
            id: "default",
            media_type: "text/plain",
            blob: { digest: `sha256:${"b".repeat(64)}`, size: 12, availability: "mirrored" },
          },
        ],
      },
    ],
  };
  renderWithApp(<Editor start={start} />, uploadClient().client);
  await userEvent.click(await screen.findByRole("button", { name: "Remove one" }));
  expect(documents().map((source) => source.id)).toEqual(["two"]);
  expect(current().assets).toEqual(start.assets);
});

it("does not assign an old component's selected file to a newly cached account", async () => {
  const c = uploadClient();
  const { queryClient } = renderWithApp(<Editor />, c.client);
  await pick();
  const button = screen.getByRole("button", { name: "Upload reference" });
  await act(async () => {
    queryClient.setQueryData(["me"], { ...ME, id: "usr_01j00000000000000000000001" });
    button.click();
  });
  expect(c.createUpload).not.toHaveBeenCalled();
  expect(c.putUpload).not.toHaveBeenCalled();
  expect(documents()).toHaveLength(0);
});

it("does not PUT an old account's file when upload reservation finishes during account switching", async () => {
  const c = uploadClient();
  const reserve = c.createUpload.getMockImplementation();
  if (!reserve) throw new Error("Missing reservation");
  let finish!: (target: Awaited<ReturnType<RegistryClient["createUpload"]>>) => void;
  let target!: Awaited<ReturnType<RegistryClient["createUpload"]>>;
  c.createUpload.mockImplementationOnce(async (body) => {
    target = await reserve(body);
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const { queryClient } = renderWithApp(<Editor />, c.client);
  await pick();
  await userEvent.click(screen.getByRole("button", { name: "Upload reference" }));
  await waitFor(() => expect(finish).toBeDefined());
  await act(async () => {
    queryClient.setQueryData(["me"], { ...ME, id: "usr_01j00000000000000000000001" });
    finish(target);
  });
  expect(c.putUpload).not.toHaveBeenCalled();
  expect(c.completeUpload).not.toHaveBeenCalled();
  expect(documents()).toHaveLength(0);
});

const replacementSource: KnowledgeSource = {
  id: "book",
  title: "Plans",
  description: "Inn plans",
  asset: "book",
  format: "markdown",
  sections: [{ id: "door", title: "Door", anchor: "#Door" }],
};
const replacementStart: Working = {
  ...initial,
  sources: [replacementSource],
  assets: [
    {
      slot: "book",
      role: "context",
      variants: [
        {
          id: "default",
          media_type: "text/markdown",
          blob: { availability: "mirrored", digest: `sha256:${"a".repeat(64)}`, size: 10 },
        },
      ],
    },
  ],
};
it("replaces original bytes while preserving stable section IDs and supports local undo", async () => {
  const c = uploadClient();
  renderWithApp(<Editor start={replacementStart} />, c.client);
  await screen.findByLabelText("Reference file");
  await userEvent.click(screen.getByText("Replace file for book"));
  await userEvent.upload(
    screen.getByLabelText("Replacement file for book"),
    new File(["\uFEFF# Door\r\nA new door.\r\n"], "new.md", { type: "text/markdown" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Replace document file" }));
  await screen.findByText(/File replaced. Document and section IDs were kept/);
  expect(documents()[0]?.sections).toEqual(replacementSource.sections);
  expect(documents()[0]?.asset).not.toBe("book");
  expect(c.putUpload).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "Edit another field" }));
  await userEvent.click(screen.getByRole("button", { name: "Undo file replacement" }));
  expect(documents()[0]).toEqual(replacementSource);
  expect(current().summary).toBe("Edited while the file was uploading");
  expect(current().assets).toEqual(replacementStart.assets);
});
it("rejects missing anchors before uploading and protects sources referenced by scenes", async () => {
  const c = uploadClient();
  renderWithApp(
    <Editor
      start={{
        ...replacementStart,
        story: {
          version: 1,
          scenes: [{ id: "inn", title: "Inn", lore: ["#source/book/door"] }],
          starts: [{ id: "start", scene: "inn", greeting: "Welcome" }],
        },
      }}
    />,
    c.client,
  );
  await screen.findByLabelText("Reference file");
  await userEvent.click(screen.getByText("Replace file for book"));
  await userEvent.upload(
    screen.getByLabelText("Replacement file for book"),
    new File(["# Missing"], "new.md", { type: "text/markdown" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Replace document file" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("source.anchor_missing"),
  );
  expect(c.createUpload).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Remove book" }));
  expect(documents()).toHaveLength(1);
  expect(screen.getByText(/Remove document references first/).textContent).toContain(
    "story.scenes[inn].lore[0]",
  );
});
it("cancels a replacement and ignores its late ready response", async () => {
  const c = uploadClient();
  let complete: (s: UploadStatus) => void = () => {};
  c.completeUpload.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  renderWithApp(<Editor start={replacementStart} />, c.client);
  await screen.findByLabelText("Reference file");
  await userEvent.click(screen.getByText("Replace file for book"));
  await userEvent.upload(
    screen.getByLabelText("Replacement file for book"),
    new File(["# Door\nNew"], "new.md", { type: "text/markdown" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Replace document file" }));
  await waitFor(() => expect(c.completeUpload).toHaveBeenCalled());
  await userEvent.click(screen.getByRole("button", { name: "Cancel replacement" }));
  await act(async () => {
    complete(c.ready("upload-1"));
  });
  expect(documents()).toEqual([replacementSource]);
  expect(current().assets).toEqual(replacementStart.assets);
});
