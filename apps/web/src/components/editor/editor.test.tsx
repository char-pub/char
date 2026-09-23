import type { ReferenceEdge } from "@char-pub/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { describePath, explainIssue } from "@/components/publish-report";
import { ApiError, type Draft } from "@/lib/api";
import type { Working } from "@/lib/draft";
import { noteWriteSucceeded, useReadOnly } from "@/lib/read-only";
import type { SaveState } from "@/lib/use-draft-editor";
import { fakeClient, ME, renderWithApp } from "@/test/render";
import { ANCHOR, targetOf } from "./anchors";
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
      anchor: ANCHOR.main,
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
