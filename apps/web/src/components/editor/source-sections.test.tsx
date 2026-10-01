import {
  canonicalizeCreation,
  checkCreation,
  type KnowledgeSource,
  sha256Bytes,
} from "@char-pub/core";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import type { Working } from "@/lib/draft";
import { keys } from "@/lib/registry";
import { fakeClient, ME, renderWithApp } from "@/test/render";
import { SourceSections } from "./source-sections";

const TEXT = "\uFEFF# Intro\r\nFirst\r\n## Detail\r\nSecond\r\n# Ending\r\nEnd";
function initial(text = TEXT): Working {
  const bytes = new TextEncoder().encode(text);
  return {
    id: "cr_01j00000000000000000000001",
    ref: "@writer/story",
    type: "scenario",
    display_name: "Story",
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    cast: [{ key: "host", who: { late: "character" } }],
    story: { version: 1, scenes: [{ id: "hall", title: "Hall" }] },
    assets: [
      {
        slot: "book",
        role: "context",
        variants: [
          {
            id: "default",
            media_type: "text/markdown",
            blob: { availability: "mirrored", digest: sha256Bytes(bytes), size: bytes.length },
          },
        ],
      },
    ],
    sources: [
      {
        id: "book",
        title: "Book",
        description: "Useful notes",
        format: "markdown",
        asset: "book",
        visibility: { scope: "shared" },
        sections: [
          {
            id: "intro",
            title: { en: "Introduction", ja: "序章" },
            description: { en: "First part", ja: "説明" },
            anchor: "#Intro",
          },
        ],
        origin: { title: { en: "Original notes", ja: "原文" }, url: "https://example.test/book" },
      },
    ],
  };
}
function Harness({ start = initial() }: { start?: Working }) {
  const [working, update] = useState(start);
  const source = (working.sources as KnowledgeSource[])[0];
  if (!source) throw new Error("source required");
  return (
    <>
      <SourceSections
        working={working}
        source={source}
        updateSource={(fn) =>
          update((w) => ({
            ...w,
            sources: (w.sources as KnowledgeSource[]).map((current) =>
              current.id === source.id ? fn(current, w) : current,
            ),
          }))
        }
      />
      <button type="button" onClick={() => update((w) => ({ ...w, summary: "Later edit" }))}>
        Edit summary elsewhere
      </button>
      <button
        type="button"
        onClick={() => update((w) => ({ ...w, assets: initial("# Changed").assets ?? [] }))}
      >
        Replace body elsewhere
      </button>
      <button type="button" onClick={() => update((w) => ({ ...w, assets: start.assets ?? [] }))}>
        Restore body elsewhere
      </button>
      <button
        type="button"
        onClick={() =>
          update((w) => ({
            ...w,
            sources: (w.sources as KnowledgeSource[]).map((current) => ({
              ...current,
              sections: [
                ...(current.sections ?? []),
                { id: "elsewhere", title: "Other", anchor: "#Ending" },
              ],
            })),
          }))
        }
      >
        Add section elsewhere
      </button>
      <output data-testid="working">{JSON.stringify(working)}</output>
    </>
  );
}
const current = (): Working => JSON.parse(screen.getByTestId("working").textContent ?? "{}");
const document = (): KnowledgeSource =>
  (current().sources as KnowledgeSource[])[0] as KnowledgeSource;
async function ready(start = initial()) {
  const rendered = renderWithApp(<Harness start={start} />, fakeClient({ me: async () => ME }));
  await waitFor(() => expect(rendered.queryClient.getQueryData(keys.me)).toEqual(ME));
  await screen.findByLabelText("Title for book/intro");
  return rendered;
}
async function selectLocal(text = TEXT) {
  await userEvent.click(screen.getByText("Check a local file or generate headings"));
  await userEvent.upload(
    screen.getByLabelText("Local file for book"),
    new File([text], "book.md", { type: "text/markdown" }),
  );
  await screen.findByText("Local file matches the current asset. Nothing was uploaded.");
}

it("previews Core-generated headings before adding, preserving original translations and metadata", async () => {
  await ready();
  await selectLocal();
  await userEvent.click(
    screen.getByRole("button", { name: "Preview sections from headings for book" }),
  );
  expect(screen.getByRole("region", { name: "Proposed sections for book" })).toBeTruthy();
  expect(document().sections).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Add generated sections to book" }));
  expect(document().sections?.map((section) => section.id)).toEqual(["intro", "detail", "ending"]);
  expect(document().sections?.[0]).toMatchObject({
    title: { en: "Introduction", ja: "序章" },
    description: { en: "First part", ja: "説明" },
    anchor: "#Intro",
  });
  expect(document().visibility).toEqual({ scope: "shared" });
  expect(
    checkCreation(canonicalizeCreation(current()).creation).diagnostics.filter(
      (d) => d.severity === "error",
    ),
  ).toEqual([]);
});

it("rejects a mismatching local file and refuses duplicate headings after digest verification", async () => {
  await ready(initial("# Same\nFirst\n# Same\nSecond"));
  await userEvent.click(screen.getByText("Check a local file or generate headings"));
  await userEvent.upload(
    screen.getByLabelText("Local file for book"),
    new File(["# Wrong"], "book.md", { type: "text/markdown" }),
  );
  await screen.findByText(/does not match the document's current asset/);
  expect(
    (
      screen.getByRole("button", {
        name: "Preview sections from headings for book",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await userEvent.upload(
    screen.getByLabelText("Local file for book"),
    new File(["# Same\nFirst\n# Same\nSecond"], "book.md", { type: "text/markdown" }),
  );
  await screen.findByText("Local file matches the current asset. Nothing was uploaded.");
  await userEvent.click(
    screen.getByRole("button", { name: "Preview sections from headings for book" }),
  );
  expect(screen.getByRole("alert").textContent).toContain("Repeated headings");
  expect(screen.queryByRole("button", { name: "Add generated sections to book" })).toBeNull();
  expect(document().sections).toHaveLength(1);
});

it("edits section and attribution prose in one locale without losing other languages", async () => {
  await ready();
  await userEvent.clear(screen.getByLabelText("Title for book/intro"));
  await userEvent.type(screen.getByLabelText("Title for book/intro"), "Start here");
  await userEvent.clear(screen.getByLabelText("Description for book/intro"));
  await userEvent.clear(screen.getByLabelText("Origin title for book"));
  await userEvent.type(screen.getByLabelText("Origin title for book"), "Writer notes");
  expect(document().sections?.[0]?.title).toEqual({ en: "Start here", ja: "序章" });
  expect(document().sections?.[0]?.description).toEqual({ ja: "説明" });
  expect(document().origin).toEqual({
    title: { en: "Writer notes", ja: "原文" },
    url: "https://example.test/book",
  });
});

it("protects referenced sections and refuses Undo after the document body changes", async () => {
  const w = initial();
  w.story = { version: 1, scenes: [{ id: "hall", title: "Hall", lore: ["#source/book/intro"] }] };
  const view = await ready(w);
  expect(
    (screen.getByRole("button", { name: "Remove section book/intro" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  view.unmount();
  await ready();
  await userEvent.click(screen.getByRole("button", { name: "Remove section book/intro" }));
  await userEvent.click(screen.getByRole("button", { name: "Replace body elsewhere" }));
  await userEvent.click(screen.getByRole("button", { name: "Undo section removal for book" }));
  expect(screen.getByRole("alert").textContent).toContain("document file changed");
  await userEvent.click(screen.getByRole("button", { name: "Restore body elsewhere" }));
  await userEvent.click(screen.getByRole("button", { name: "Edit summary elsewhere" }));
  await userEvent.click(screen.getByRole("button", { name: "Undo section removal for book" }));
  expect(document().sections?.[0]?.id).toBe("intro");
  expect(current().summary).toBe("Later edit");
});

it("does not overwrite sections edited after the heading preview", async () => {
  await ready();
  await selectLocal();
  await userEvent.click(
    screen.getByRole("button", { name: "Preview sections from headings for book" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Add section elsewhere" }));
  await userEvent.click(screen.getByRole("button", { name: "Add generated sections to book" }));
  expect(screen.getByRole("alert").textContent).toContain("Sections changed since this preview");
  expect(document().sections?.map((section) => section.id)).toEqual(["intro", "elsewhere"]);
});

it("drops a late local file result when the account cache changes before the read finishes", async () => {
  const { queryClient } = await ready();
  await userEvent.click(screen.getByText("Check a local file or generate headings"));
  const file = new File([TEXT], "book.md", { type: "text/markdown" });
  let finish: ((bytes: ArrayBuffer) => void) | undefined;
  vi.spyOn(file, "arrayBuffer").mockImplementation(
    () =>
      new Promise<ArrayBuffer>((resolve) => {
        finish = resolve;
      }),
  );
  await userEvent.upload(screen.getByLabelText("Local file for book"), file);
  await act(async () => {
    queryClient.setQueryData(keys.me, { ...ME, id: "usr_01j00000000000000000000002" });
    finish?.(new TextEncoder().encode(TEXT).buffer);
  });
  expect(screen.queryByText(/Verified local file:/)).toBeNull();
  expect(screen.queryByRole("region", { name: "Proposed sections for book" })).toBeNull();
  expect(document().sections).toHaveLength(1);
});
