import { ASSEMBLER, TOKENIZER_VERSIONS } from "@char-pub/assembler";
import type { ReferenceEdge } from "@char-pub/core";
import { useRouterState } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { describePath, explainIssue } from "@/components/publish-report";
import { ApiError, type Draft } from "@/lib/api";
import type { Working } from "@/lib/draft";
import { noteWriteSucceeded, useReadOnly } from "@/lib/read-only";
import type { SaveState } from "@/lib/use-draft-editor";
import { fakeClient, ME, renderWithApp } from "@/test/render";
import { ANCHOR, targetOf } from "./anchors";
import { DEFAULT_PROFILE } from "./assembly-editor";
import { buildChecks, checksSummary } from "./checks-panel";
import { Editor } from "./editor";
import { SaveStatus } from "./save-status";

const W: Working = {
  display_name: "Alice",
  fragments: [
    { id: "description", stable: true, kind: "character", content: { type: "text", text: "Hi" } },
  ],
  meta: {
    default_locale: "en",
    rating: "general",
    rights: "original",
    license: "LicenseRef-All-Rights-Reserved",
  },
};

const edge = (id: string, pin: ReferenceEdge["pin"]): ReferenceEdge => ({
  id,
  use: `@cyberpunk/${id}`,
  mode: "default",
  ...(pin ? { pin } : {}),
});

describe("buildChecks", () => {
  const saved = { kind: "saved", at: null } as const;

  it("reports complete basics and a missing greeting as a note", () => {
    const items = buildChecks({
      type: "character",
      working: W,
      state: saved,
      warnings: [],
      references: [],
    });
    expect(items.find((i) => i.key === "basics")?.tone).toBe("ok");
    expect(items.find((i) => i.key === "greeting")?.tone).toBe("info");
    expect(checksSummary(items)).toBe("Ready to publish.");
  });

  it("turns a missing name, check errors and unpinned dependencies into errors", () => {
    const items = buildChecks({
      type: "character",
      working: { ...W, display_name: "" },
      state: {
        kind: "invalid",
        message: undefined,
        diagnostics: [{ code: "meta.license_invalid", subject: "meta.license", severity: "error" }],
      },
      warnings: [
        {
          code: "publish.rating_raised",
          subject: "references[world]",
          severity: "warning",
          detail: "raised by a dependency",
        },
      ],
      references: [
        edge("world", undefined),
        edge("corps", { follow: "latest" }),
        edge("docks", { release: "rel_1", semantic_digest: `sha256:${"a".repeat(64)}` }),
      ],
    });
    const errors = items.filter((i) => i.tone === "error").map((i) => i.key);
    expect(errors).toContain("name");
    expect(errors).toContain("unpinned:world");
    const license = items.find((i) => i.code === "meta.license_invalid");
    expect(license?.target).toEqual({ anchor: ANCHOR.meta, section: "meta" });
    const warning = items.find((i) => i.code === "publish.rating_raised");
    expect(warning?.title).toBe("Raised by a dependency");
    expect(warning?.target?.section).toBe("dependencies");
    expect(items.find((i) => i.key === "following")?.tone).toBe("info");
    // 有依赖没锁定时不说“都已锁定”。
    expect(items.find((i) => i.key === "locked")).toBeUndefined();
    expect(checksSummary(items)).toBe("3 errors · 1 warning to fix before publishing.");
  });
});

describe("targetOf", () => {
  it("points each subject at its field", () => {
    expect(targetOf("display_name", "character", W)).toEqual({ anchor: ANCHOR.name });
    expect(targetOf("fragments[description].content", "character", W)).toEqual({
      anchor: "edit-fragment-description",
      section: "passages",
      contentSelection: "all",
    });
    expect(targetOf("fragments[habit]", "character", W)?.section).toBe("passages");
    expect(targetOf("@cyberpunk/corps", "character", W)?.section).toBe("dependencies");
    expect(targetOf("meta.default_locale", "character", W)?.section).toBe("language");
    expect(targetOf("bootstrap.greetings[0]", "character", W)).toEqual({
      anchor: ANCHOR.greeting,
    });
    expect(targetOf("something.else", "character", W)).toBeNull();
  });
});

describe("diamond conflicts", () => {
  const ctx = {
    root: "Alice",
    references: [
      { id: "a-knows", use: "@cyberpunk/corps", mode: "default" },
      { id: "b-lives", use: "@cyberpunk/night-city", mode: "intrinsic" },
    ] satisfies ReferenceEdge[],
  };

  it("describes both paths from the creation to the conflicting dependency", () => {
    expect(describePath({ release: "r1", via: ["b-lives"] }, "@cyberpunk/night-city", ctx)).toBe(
      "Alice → @cyberpunk/night-city",
    );
    expect(
      describePath({ release: "r2", via: ["a-knows", "setting"] }, "@cyberpunk/night-city", ctx),
    ).toBe("Alice → @cyberpunk/corps → @cyberpunk/night-city");
  });

  it("explains the error in plain words and points to Dependencies", () => {
    const e = explainIssue(
      {
        code: "publish.diamond_conflict",
        subject: "@cyberpunk/night-city",
        severity: "error",
        data: { ref: "@cyberpunk/night-city", releases: [] },
      },
      ctx,
    );
    expect(e.title).toBe("Two versions of the same dependency");
    expect(e.dependencies).toBe(true);
  });
});

describe("SaveStatus", () => {
  it.each([
    [{ kind: "saved", at: new Date() }, "All changes saved"],
    [{ kind: "saving" }, "Saving…"],
    [{ kind: "dirty" }, "Unsaved changes"],
    [{ kind: "conflict" }, "Not saved — changed elsewhere"],
    [{ kind: "invalid", diagnostics: [], message: undefined }, "Not saved — fix the errors"],
    [{ kind: "error", message: "Could not save." }, "Could not save."],
  ] satisfies [SaveState, string][])("shows %o as %s", (state, text) => {
    render(<SaveStatus state={state} />);
    const el = screen.getByText(text).closest("[data-save-state]");
    expect(el?.getAttribute("data-save-state")).toBe(state.kind);
  });
});

const DRAFT: Draft = {
  version: 3,
  working: W,
  base_revision_id: null,
  updated_at: "2026-09-22T12:00:00.000Z",
};

function ReadOnlyProbe() {
  return <p>{useReadOnly() ? "read-only on" : "read-only off"}</p>;
}

function EditorLocationProbe() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return <output aria-label="Current editor test path">{pathname}</output>;
}

function renderStructuredEditor() {
  const putDraft = vi.fn(async () => {
    throw new Error("Unapplied data must not save a draft");
  });
  const createDraftBuild = vi.fn(async () => {
    throw new Error("Unapplied data must not build a draft");
  });
  renderWithApp(
    <>
      <EditorLocationProbe />
      <Editor
        ns="writer"
        name="alice"
        type="character"
        permissions={{
          read_draft: true,
          edit: true,
          publish: true,
          update_sensitive: true,
          manage_source: true,
          manage_collaborators: true,
        }}
        draft={{
          ...DRAFT,
          working: {
            ...W,
            fragments: [
              ...(W.fragments ?? []),
              {
                id: "extension",
                stable: true,
                kind: "knowledge",
                content: { type: "structured", schema: "test", data: { saved: true } },
              },
            ],
            assembly_tests: [
              {
                id: "example",
                root: "self",
                profile: DEFAULT_PROFILE,
                session: { history: [] },
                assembler: ASSEMBLER,
                tokenizer: { name: "estimate", version: TOKENIZER_VERSIONS.estimate },
                expected: { kind: "success", trace: [] },
              },
            ],
          },
        }}
        existingLabels={[]}
      />
    </>,
    fakeClient({ me: async () => ME, putDraft, createDraftBuild }),
  );
  return { putDraft, createDraftBuild };
}

describe("Editor unapplied structured data", () => {
  it("blocks build and publish and guards author-test saving before JSON is applied", async () => {
    const { putDraft, createDraftBuild } = renderStructuredEditor();
    const build = (await screen.findByRole("button", {
      name: "Build draft preview",
    })) as HTMLButtonElement;
    const publish = screen.getByRole("button", { name: "Publish…" }) as HTMLButtonElement;
    expect(build.disabled).toBe(false);
    expect(publish.disabled).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Edit JSON data" }));
    const raw = '{\n  "local": true,\n';
    const input = screen.getByRole("textbox", { name: "Structured JSON data" });
    fireEvent.change(input, { target: { value: raw } });
    expect(await screen.findByText("Unapplied data edits")).toBeTruthy();
    expect(build.disabled).toBe(true);
    expect(publish.disabled).toBe(true);

    const run = screen.getByRole("button", { name: "Run author tests" }) as HTMLButtonElement;
    expect(run.disabled).toBe(false);
    await userEvent.click(run);
    expect(
      await screen.findByText(
        "Save the draft successfully before previewing. Your edits are kept in the editor.",
      ),
    ).toBeTruthy();
    expect(putDraft).not.toHaveBeenCalled();
    expect(createDraftBuild).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toBe(raw);
  });

  it("keeps the raw buffer across collapsing More options and staying after SPA navigation", async () => {
    const { putDraft, createDraftBuild } = renderStructuredEditor();
    await userEvent.click(await screen.findByRole("button", { name: "Edit JSON data" }));
    const raw = '{\n  "unfinished": "keep these spaces"  \n';
    fireEvent.change(screen.getByRole("textbox", { name: "Structured JSON data" }), {
      target: { value: raw },
    });
    const passages = screen.getByRole("button", { name: "Passages" });
    expect(passages.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(passages);
    expect(passages.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("textbox", { name: "Structured JSON data" })).toBeNull();
    expect(screen.getByText("Unapplied data edits")).toBeTruthy();
    await userEvent.click(passages);
    expect(
      (screen.getByRole("textbox", { name: "Structured JSON data" }) as HTMLTextAreaElement).value,
    ).toBe(raw);

    await userEvent.click(screen.getByRole("link", { name: "Back to the creation page" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Leave unapplied data edits?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Stay and edit" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByLabelText("Current editor test path").textContent).toBe("/");
    expect(
      (screen.getByRole("textbox", { name: "Structured JSON data" }) as HTMLTextAreaElement).value,
    ).toBe(raw);
    expect(screen.getByText("Unapplied data edits")).toBeTruthy();
    expect(putDraft).not.toHaveBeenCalled();
    expect(createDraftBuild).not.toHaveBeenCalled();
  });
});

describe("Editor", () => {
  it("reports an autosave that hit read-only mode to the site-wide notice", async () => {
    noteWriteSucceeded();
    const putDraft = vi.fn(async () => {
      throw new ApiError(503, "feature.read_only");
    });
    renderWithApp(
      <>
        <ReadOnlyProbe />
        <Editor ns="writer" name="alice" type="character" draft={DRAFT} existingLabels={[]} />
      </>,
      fakeClient({ putDraft, me: async () => ME }),
    );
    await userEvent.type(await screen.findByLabelText("Summary"), "x");
    expect(await screen.findByText("read-only on", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText("Could not save. Your changes are kept here.")).toBeTruthy();
    noteWriteSucceeded();
  });

  it("does not offer contribution settings", async () => {
    renderWithApp(
      <Editor ns="writer" name="alice" type="character" draft={DRAFT} existingLabels={[]} />,
      fakeClient({ me: async () => ME }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Rating, license & tags" }));
    expect(screen.getByLabelText("License")).toBeTruthy();
    expect(screen.queryByText(/Who can suggest changes/)).toBeNull();
  });

  it("won't reuse a version label and explains why publishing is blocked", async () => {
    renderWithApp(
      <Editor
        permissions={{
          read_draft: true,
          edit: true,
          publish: true,
          update_sensitive: true,
          manage_source: true,
          manage_collaborators: true,
        }}
        ns="writer"
        name="alice"
        type="character"
        draft={{ ...DRAFT, working: { ...W, display_name: "" } }}
        existingLabels={["1.0.0"]}
      />,
      fakeClient({ me: async () => ME }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Publish…" }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText("Version label") as HTMLInputElement;
    expect(input.value).toBe("1.0.1");
    expect(within(dialog).getByRole("alert").textContent).toBe("Give it a name before publishing.");
    await userEvent.clear(input);
    await userEvent.type(input, "1.0.0");
    expect(within(dialog).getByText("1.0.0 is already used. Pick another label.")).toBeTruthy();
    const publish = within(dialog).getByRole("button", { name: "Publish 1.0.0" });
    expect((publish as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens the dependencies section from the checks panel", async () => {
    renderWithApp(
      <Editor
        permissions={{
          read_draft: true,
          edit: true,
          publish: true,
          update_sensitive: true,
          manage_source: true,
          manage_collaborators: true,
        }}
        ns="writer"
        name="alice"
        type="character"
        draft={{
          ...DRAFT,
          working: { ...W, references: [edge("world", { follow: "latest" })] },
        }}
        existingLabels={[]}
      />,
      fakeClient({
        me: async () => ME,
        creation: async () => {
          throw new ApiError(404, "not_found");
        },
      }),
    );
    const section = await screen.findByRole("button", { name: "Dependencies" });
    await userEvent.click(section);
    expect(section.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(screen.getByRole("button", { name: /follows the latest release/ }));
    await waitFor(() => expect(section.getAttribute("aria-expanded")).toBe("true"));
  });
});

it("gives collaborators editable content and tags without owner publishing or sensitive controls", async () => {
  renderWithApp(
    <Editor
      ns="writer"
      name="alice"
      type="character"
      draft={{ version: 1, working: W, base_revision_id: null, updated_at: "2026-10-01T00:00:00Z" }}
      existingLabels={[]}
      permissions={{
        read_draft: true,
        edit: true,
        publish: false,
        update_sensitive: false,
        manage_source: false,
        manage_collaborators: false,
      }}
    />,
    fakeClient({ me: async () => ME }),
  );
  await userEvent.click(await screen.findByRole("button", { name: "Rating, license & tags" }));
  expect(screen.queryByRole("button", { name: "Publish…" })).toBeNull();
  for (const label of ["Rating", "License", "Rights", "Content warnings"])
    expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText("Tags") as HTMLInputElement).disabled).toBe(false);
});

describe("agent-assisted draft origin", () => {
  it.each([undefined, false])(
    "shows a non-agent derivation's exact source without an agent notice (%s)",
    async (flag) => {
      const source = {
        ref: "@source/story",
        release: "rel_01j00000000000000000000000",
        semantic_digest: `sha256:${"a".repeat(64)}`,
        relation: "remix",
      };
      const putDraft = vi.fn();
      renderWithApp(
        <Editor
          ns="writer"
          name="alice"
          type="character"
          draft={{
            ...DRAFT,
            working: {
              ...W,
              provenance: {
                derived_from: [source],
                ...(flag === undefined ? {} : { authored_by_agent: flag }),
              },
            },
          }}
          existingLabels={[]}
        />,
        fakeClient({ me: async () => ME, putDraft }),
      );
      const origin = await screen.findByRole("region", { name: "Draft origin" });
      expect(origin.textContent).toContain(source.ref);
      expect(origin.textContent).toContain(source.release);
      expect(origin.textContent).toContain(source.semantic_digest);
      expect(within(origin).queryByText(/agent-assisted content/)).toBeNull();
      expect(within(origin).queryByRole("button")).toBeNull();
      expect(within(origin).queryByRole("checkbox")).toBeNull();
      expect(putDraft).not.toHaveBeenCalled();
    },
  );

  it("shows exact read-only sources and preserves provenance through an ordinary edit without a new publish gate", async () => {
    const provenance = {
      authored_by_agent: true,
      client_id: "CLIENT_METADATA_NOT_FOR_DISPLAY",
      derived_from: [
        {
          ref: "@source/story",
          release: "rel_01j00000000000000000000000",
          semantic_digest: `sha256:${"a".repeat(64)}`,
          relation: "sequel",
        },
        { release: "rel_01j00000000000000000000001", relation: "import" },
      ],
    };
    const putDraft = vi.fn(
      async (_ns: string, _name: string, _version: number, _working: unknown) => ({
        version: 4,
        semantic_digest: `sha256:${"b".repeat(64)}`,
        warnings: [],
      }),
    );
    const createRevision = vi.fn(async () => {
      throw new Error("Publishing requires the existing explicit action");
    });
    renderWithApp(
      <Editor
        ns="writer"
        name="alice"
        type="character"
        draft={{ ...DRAFT, working: { ...W, provenance } }}
        existingLabels={[]}
        permissions={{
          read_draft: true,
          edit: true,
          publish: true,
          update_sensitive: true,
          manage_source: true,
          manage_collaborators: true,
        }}
      />,
      fakeClient({ me: async () => ME, putDraft, createRevision }),
    );
    const origin = await screen.findByRole("region", { name: "Draft origin" });
    expect(
      within(origin).getByText(
        "This draft includes agent-assisted content. Review the opening, initial state and source before publishing.",
      ),
    ).toBeTruthy();
    const sources = within(origin).getByRole("list", { name: "Creation sources" });
    expect(within(sources).getAllByRole("listitem")).toHaveLength(2);
    expect(sources.textContent).toContain("@source/story");
    expect(sources.textContent).toContain(provenance.derived_from[0]?.release);
    expect(sources.textContent).toContain(`sha256:${"a".repeat(64)}`);
    expect(sources.textContent).toContain("Historical source");
    expect(within(origin).queryByRole("checkbox")).toBeNull();
    expect(within(origin).queryByRole("button")).toBeNull();
    expect(screen.queryByText("CLIENT_METADATA_NOT_FOR_DISPLAY")).toBeNull();
    expect(putDraft).not.toHaveBeenCalled();
    expect(createRevision).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Summary"), "An edited summary");
    await waitFor(() => expect(putDraft).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(putDraft.mock.calls[0]?.[3]).toMatchObject({ provenance });
    expect(screen.getByRole("region", { name: "Draft origin" })).toBeTruthy();
    const publish = screen.getByRole("button", { name: "Publish…" }) as HTMLButtonElement;
    expect(publish.disabled).toBe(false);
    await userEvent.click(publish);
    expect(await screen.findByRole("dialog", { name: "Publish Alice" })).toBeTruthy();
    expect(createRevision).not.toHaveBeenCalled();
  });

  it.each([undefined, false])(
    "does not label an unmarked draft as agent-assisted (%s)",
    async (flag) => {
      renderWithApp(
        <Editor
          ns="writer"
          name="alice"
          type="character"
          draft={{
            ...DRAFT,
            working: {
              ...W,
              ...(flag === undefined ? {} : { provenance: { authored_by_agent: flag } }),
            },
          }}
          existingLabels={[]}
        />,
        fakeClient({ me: async () => ME }),
      );
      await screen.findByRole("heading", { name: "Editing Alice" });
      expect(screen.queryByRole("region", { name: "Draft origin" })).toBeNull();
    },
  );
});
