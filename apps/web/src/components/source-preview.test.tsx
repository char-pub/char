import { ASSEMBLER, TOKENIZER_VERSIONS } from "@char-pub/assembler";
import {
  buildCreation,
  type CreationInput,
  createLocalBuildInput,
  lateSlotKey,
  publishedIdentity,
  sha256Bytes,
} from "@char-pub/core";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { sampleDefaultPolicy } from "@/fixtures/samples";
import { ApiError } from "@/lib/api";
import { DEFAULT_SETTINGS, type PreviewSettings } from "@/lib/preview";
import { buildTestCreation } from "@/test/build";
import { fakeClient, ME, renderWithApp } from "@/test/render";
import { PreviewPanel } from "./preview-panel";

const BODY = "THE_SELECTED_DOCUMENT_BODY";
const settings: PreviewSettings = {
  ...DEFAULT_SETTINGS,
  historyText: "user: A private sample message",
  lateBindings: {
    [lateSlotKey("root", "player")]: {
      name: "Visitor",
      kind: "persona",
      description: "Private binding",
    },
  },
};
function fixture(direct = false, draft: boolean | string = false) {
  const creation: CreationInput = {
    id: "cr_01j00000000000000000000000",
    ref: "@writer/sources",
    type: "scenario",
    display_name: "Library",
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    cast: [{ key: "player", who: { late: "persona" } }],
    fragments: [
      {
        id: "outside-context",
        stable: true,
        kind: "knowledge",
        visibility: { scope: "story-scene", scene: "outside" },
        content: { type: "text", text: "HIDDEN_OUTSIDE_BODY" },
      },
    ],
    sources: ["book", "other", "private"].map((id) => ({
      id,
      title: `${id} reference`,
      description: `${id} description`,
      asset: id,
      format: "text",
      ...(id !== "private" ? { visibility: { scope: "shared" as const } } : {}),
    })),
    assets: ["book", "other", "private"].map((slot) => ({
      slot,
      role: "context",
      variants: [
        {
          id: "default",
          media_type: "text/plain",
          blob: {
            digest: sha256Bytes(new TextEncoder().encode(BODY)),
            size: new TextEncoder().encode(BODY).length,
            availability: "mirrored",
          },
        },
      ],
    })),
    story: {
      version: 1,
      vars: { ready: { type: "bool", init: false, description: "Ready" } },
      scenes: [
        { id: "lobby", title: "Lobby", ...(direct ? { lore: ["#book"] } : {}) },
        { id: "outside", title: "Outside" },
      ],
      starts: [
        { id: "inside", title: "Inside", description: "Start inside", scene: "lobby" },
        { id: "outside", title: "Outside", description: "Start outside", scene: "outside" },
      ],
    },
  };
  const { artifact } =
    draft === "local"
      ? buildCreation(
          createLocalBuildInput({
            root: { creation },
            dependencies: [sampleDefaultPolicy],
            default_policy: {
              ref: "@examples/preview-policy",
              release: sampleDefaultPolicy.release,
              semantic_digest: sampleDefaultPolicy.semantic_digest,
            },
          }),
        )
      : buildTestCreation({
          root:
            draft === true
              ? {
                  creation,
                  visibility: "private",
                  origin: {
                    kind: "draft-build",
                    build_id: "dbld_01j00000000000000000000000",
                    revision: "rev_01j00000000000000000000000",
                    expires_at: "2026-10-08T00:00:00.000Z",
                  },
                }
              : {
                  creation,
                  release: typeof draft === "string" ? draft : "rel_01j00000000000000000000000",
                  visibility: "public",
                },
        });
  if (artifact.kind !== "content") throw new Error("content required");
  const source = artifact.catalog_index.sources.find((s) => s.local_id === "book");
  const asset = artifact.assets.find((a) => a.id === source?.asset);
  if (!source || !asset) throw new Error("source required");
  return {
    artifact,
    response: { source: source.id, asset: asset.id, digest: asset.digest, text: BODY },
  };
}

it("shows descriptions without fetching unselected bodies, then adds only the selected source to messages", async () => {
  const { artifact, response } = fixture();
  const sourceText = vi.fn(async () => response);
  renderWithApp(
    <PreviewPanel artifact={artifact} initialSettings={settings} />,
    fakeClient({ me: async () => null, sourceText }),
  );
  await screen.findByRole("list", { name: "Assembled messages" });
  expect(screen.getByText("book description")).toBeTruthy();
  expect(sourceText).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Required runtime capabilities").textContent).toContain(
    "Reference documents",
  );
  expect(screen.getByText("Story state and conditions (experimental)")).toBeTruthy();
  await userEvent.click(screen.getByRole("checkbox", { name: /book reference/ }));
  await waitFor(() =>
    expect(screen.getByRole("list", { name: "Assembled messages" }).textContent).toContain(BODY),
  );
  expect(sourceText).toHaveBeenCalledExactlyOnceWith(
    publishedIdentity(artifact.root).release,
    response.source,
    expect.any(AbortSignal),
  );
});

it("hides private source descriptions from a participant view", async () => {
  const { artifact } = fixture();
  const sourceText = vi.fn();
  renderWithApp(
    <PreviewPanel
      artifact={artifact}
      initialSettings={{ ...settings, mode: "per-agent", forParticipant: "player" }}
    />,
    fakeClient({ me: async () => null, sourceText }),
  );
  await screen.findByRole("list", { name: "Assembled messages" });
  expect(screen.getByText("book description")).toBeTruthy();
  expect(screen.queryByText("private description")).toBeNull();
  expect(sourceText).not.toHaveBeenCalled();
});

it("fetches story-linked documents through the same path in the locked setup", async () => {
  const { artifact, response } = fixture(true);
  if (!artifact.default_policy) throw new Error("policy required");
  artifact.assembly = {
    version: "1-draft",
    preset: artifact.default_policy,
    profile: {
      runtime: { name: "Preview", version: "1" },
      tokenizer: "estimate",
      context_window: 8192,
      reserve_for_output: 1024,
      mode: "narrator",
      capabilities: { system_role: true, multiple_system_messages: true },
    },
    assembler: ASSEMBLER,
    tokenizer: { name: "estimate", version: TOKENIZER_VERSIONS.estimate },
  };
  const sourceText = vi.fn(async () => response);
  renderWithApp(
    <PreviewPanel artifact={artifact} initialSettings={settings} />,
    fakeClient({ me: async () => null, sourceText }),
  );
  await waitFor(() =>
    expect(screen.getByRole("list", { name: "Assembled messages" }).textContent).toContain(BODY),
  );
  expect(sourceText).toHaveBeenCalledExactlyOnceWith(
    publishedIdentity(artifact.root).release,
    response.source,
    expect.any(AbortSignal),
  );
  expect(
    (screen.getByRole("checkbox", { name: /book reference/ }) as HTMLInputElement).disabled,
  ).toBe(true);
});

it.each(["digest", "asset", "source", "text"] as const)(
  "rejects a mismatched response %s",
  async (field) => {
    const { artifact, response } = fixture(true);
    renderWithApp(
      <PreviewPanel artifact={artifact} initialSettings={settings} />,
      fakeClient({
        me: async () => null,
        sourceText: async () => ({
          ...response,
          [field]: field === "digest" ? `sha256:${"0".repeat(64)}` : "WRONG",
        }),
      }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      field === "text" ? "source.asset_mismatch" : "source.response_mismatch",
    );
    expect(screen.queryByRole("list", { name: "Assembled messages" })).toBeNull();
  },
);

it("reports source access failure and allows recovery by changing the opening", async () => {
  const { artifact } = fixture(true);
  const sourceText = vi.fn(async () => {
    throw new ApiError(403, "release.forbidden", "Forbidden");
  });
  renderWithApp(
    <PreviewPanel artifact={artifact} initialSettings={settings} />,
    fakeClient({ me: async () => null, sourceText }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain("unavailable to this account");
  await userEvent.selectOptions(screen.getByLabelText("Story opening"), "outside");
  await screen.findByRole("list", { name: "Assembled messages" });
  expect(sourceText).toHaveBeenCalledTimes(1);
});

it("loads draft sources through the actual build identity without requesting a Release", async () => {
  const { artifact, response } = fixture(true, true);
  const sourceText = vi.fn();
  const draftSourceText = vi.fn(async () => response);
  renderWithApp(
    <PreviewPanel artifact={artifact} initialSettings={settings} />,
    fakeClient({ me: async () => ME, sourceText, draftSourceText }),
  );
  expect((await screen.findByRole("list", { name: "Assembled messages" })).textContent).toContain(
    BODY,
  );
  expect(draftSourceText).toHaveBeenCalledExactlyOnceWith(
    "dbld_01j00000000000000000000000",
    response.source,
    expect.any(AbortSignal),
  );
  expect(sourceText).not.toHaveBeenCalled();
});

it("ignores a late source response after changing settings", async () => {
  const { artifact, response } = fixture(true);
  let resolve!: (value: typeof response) => void;
  const sourceText = vi.fn(
    () =>
      new Promise<typeof response>((done) => {
        resolve = done;
      }),
  );
  renderWithApp(
    <PreviewPanel artifact={artifact} initialSettings={settings} />,
    fakeClient({ me: async () => null, sourceText }),
  );
  await waitFor(() => expect(sourceText).toHaveBeenCalledTimes(1));
  await userEvent.selectOptions(screen.getByLabelText("Story opening"), "outside");
  await screen.findByRole("list", { name: "Assembled messages" });
  await act(async () => resolve(response));
  expect(screen.getByRole("list", { name: "Assembled messages" }).textContent).not.toContain(BODY);
});

it("ignores a late source response after replacing the artifact", async () => {
  const old = fixture(true);
  const next = fixture(false, "rel_01j00000000000000000000001");
  let resolve!: (value: typeof old.response) => void;
  const sourceText = vi.fn(
    () =>
      new Promise<typeof old.response>((done) => {
        resolve = done;
      }),
  );
  function Harness() {
    const [artifact, setArtifact] = useState(old.artifact);
    return (
      <>
        <button type="button" onClick={() => setArtifact(next.artifact)}>
          Next release
        </button>
        <PreviewPanel artifact={artifact} initialSettings={settings} />
      </>
    );
  }
  renderWithApp(<Harness />, fakeClient({ me: async () => null, sourceText }));
  await waitFor(() => expect(sourceText).toHaveBeenCalledTimes(1));
  await userEvent.click(screen.getByText("Next release"));
  await screen.findByRole("list", { name: "Assembled messages" });
  await act(async () => resolve(old.response));
  expect(screen.getByRole("list", { name: "Assembled messages" }).textContent).not.toContain(BODY);
});

it("does not reuse a pending response after the account changes", async () => {
  const { artifact, response } = fixture(true);
  let resolve!: (value: typeof response) => void;
  const sourceText = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<typeof response>((done) => {
          resolve = done;
        }),
    )
    .mockRejectedValue(new ApiError(403, "release.forbidden", "Forbidden"));
  const app = renderWithApp(
    <PreviewPanel artifact={artifact} initialSettings={settings} />,
    fakeClient({ me: async () => ME, sourceText }),
  );
  await waitFor(() => expect(sourceText).toHaveBeenCalled());
  await act(async () => {
    app.queryClient.setQueryData(["me"], { ...ME, id: "usr_01j00000000000000000000001" });
  });
  await screen.findByRole("alert");
  await act(async () => resolve(response));
  expect(screen.queryByRole("list", { name: "Assembled messages" })).toBeNull();
  expect(
    within(screen.getByRole("alert")).getByText(
      "A reference document is unavailable to this account",
    ),
  ).toBeTruthy();
});

it("retries a failed reference request without changing session inputs", async () => {
  const { artifact, response } = fixture(true);
  const sourceText = vi
    .fn()
    .mockRejectedValueOnce(new ApiError(0, "network.unreachable", "could not reach the registry"))
    .mockResolvedValue(response);
  renderWithApp(
    <PreviewPanel artifact={artifact} initialSettings={settings} />,
    fakeClient({ me: async () => null, sourceText }),
  );
  await screen.findByRole("alert");
  await userEvent.click(screen.getByRole("button", { name: "Retry preview" }));
  await waitFor(() =>
    expect(screen.getByRole("list", { name: "Assembled messages" }).textContent).toContain(BODY),
  );
  expect(sourceText).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("list", { name: "Assembled messages" }).textContent).toContain(
    "A private sample message",
  );
});

it("requires local source bodies instead of turning a local receipt into Registry access", async () => {
  const { artifact } = fixture(true, "local");
  const sourceText = vi.fn(),
    draftSourceText = vi.fn();
  renderWithApp(
    <PreviewPanel artifact={artifact} initialSettings={settings} />,
    fakeClient({ me: async () => ME, sourceText, draftSourceText }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain("source.local_body_required");
  expect(sourceText).not.toHaveBeenCalled();
  expect(draftSourceText).not.toHaveBeenCalled();
});

it.each([false, true])(
  "keeps author hidden-source explanations separate from model input (locked=%s)",
  async (locked) => {
    const { artifact } = fixture();
    if (locked) {
      if (!artifact.default_policy) throw new Error("policy required");
      artifact.assembly = {
        version: "1-draft",
        preset: artifact.default_policy,
        profile: {
          runtime: { name: "Preview", version: "1" },
          tokenizer: "estimate",
          context_window: 8192,
          reserve_for_output: 1024,
          mode: "per-agent",
          capabilities: { system_role: true, multiple_system_messages: true },
        },
        assembler: ASSEMBLER,
        tokenizer: { name: "estimate", version: TOKENIZER_VERSIONS.estimate },
      };
    }
    const sourceText = vi.fn();
    renderWithApp(
      <PreviewPanel
        authorDiagnostics
        artifact={artifact}
        initialSettings={{ ...settings, mode: "per-agent", forParticipant: "player" }}
      />,
      fakeClient({ me: async () => ME, sourceText }),
    );
    const messages = await screen.findByRole("list", { name: "Assembled messages" });
    await userEvent.click(screen.getByText("Author context directory", { selector: "summary" }));
    const directory = screen.getByRole("region", { name: "Author context directory" });
    const hidden = within(directory).getByRole("list", { name: "Hidden content reasons" });
    expect(hidden.textContent).toContain("view.source_not_shared");
    expect(hidden.textContent).toContain("private");
    expect(hidden.textContent).toContain("outside-context");
    expect(screen.queryByRole("button", { name: /Show details for .*outside-context/ })).toBeNull();
    expect(messages.textContent).not.toContain("HIDDEN_OUTSIDE_BODY");
    expect(directory.textContent).not.toContain(BODY);
    expect(messages.textContent).not.toContain(BODY);
    expect(sourceText).not.toHaveBeenCalled();
    if (!locked) {
      await userEvent.click(screen.getByRole("radio", { name: "Narrator" }));
      await waitFor(() =>
        expect(
          within(screen.getByRole("region", { name: "Author context directory" })).getByRole(
            "list",
            { name: "Hidden content reasons" },
          ).textContent,
        ).not.toContain("view.source_not_shared"),
      );
      expect(sourceText).not.toHaveBeenCalled();
    }
  },
);

it("does not offer author-only diagnostics on the public preview", async () => {
  const { artifact } = fixture();
  renderWithApp(
    <PreviewPanel
      artifact={artifact}
      initialSettings={{ ...settings, mode: "per-agent", forParticipant: "player" }}
    />,
    fakeClient({ me: async () => null }),
  );
  await screen.findByRole("list", { name: "Assembled messages" });
  expect(screen.queryByText("Author context directory", { selector: "summary" })).toBeNull();
  expect(screen.queryByText(/view.source_not_shared/)).toBeNull();
  expect(screen.queryByText("private description")).toBeNull();
  expect(screen.queryByRole("button", { name: /Show details for .*outside-context/ })).toBeNull();
});
