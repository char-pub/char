import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { diffPair, resolveSample } from "@/fixtures/samples";
import { ApiError, type CreationDetail, type CreationSummary, type Draft } from "@/lib/api";
import { fakeClient, ME, renderWithApp } from "@/test/render";
import { CreationView } from "./creation-view";
import { Editor } from "./editor/editor";
import { ImportWizard } from "./import-wizard";
import { MatureSetting } from "./mature-setting";
import { PublishReport } from "./publish-report";
import { SearchResults } from "./search-results";

const SUMMARY: CreationSummary = {
  id: "cr_01j00000000000000000000000",
  ref: "@djj/night-city",
  type: "world",
  display_name: { en: "Night City", zh: "夜之城" },
  summary: "A neon city.",
  rating: "general",
  effective_rating: "mature",
  tags: ["cyberpunk"],
};

describe("SearchResults", () => {
  it("links each result and shows its effective rating and tags", async () => {
    renderWithApp(<SearchResults items={[SUMMARY]} />);
    const list = await screen.findByRole("list", { name: "Search results" });
    const link = within(list).getByRole("link", { name: "Night City" });
    expect(link.getAttribute("href")).toBe("/c/djj/night-city");
    expect(within(list).getByText("Mature")).toBeTruthy();
    expect(within(list).getByRole("link", { name: "#cyberpunk" })).toBeTruthy();
  });

  it("explains an empty result", async () => {
    renderWithApp(<SearchResults items={[]} />);
    expect(await screen.findByText(/Nothing matches yet/)).toBeTruthy();
  });
});

describe("MatureSetting", () => {
  it("asks for the 18+ confirmation before turning mature content on", async () => {
    const onChange = vi.fn();
    renderWithApp(<MatureSetting enabled={false} confirmedAt={null} onChange={onChange} />);
    await userEvent.click(await screen.findByRole("switch"));
    const confirm = screen.getByRole("button", { name: "Show mature content" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByLabelText("I am 18 or older"));
    await userEvent.click(confirm);
    expect(onChange).toHaveBeenCalledWith({ show_mature: true, confirm_adult: true });
  });

  it("turns it off without a dialog", async () => {
    const onChange = vi.fn();
    renderWithApp(
      <MatureSetting enabled confirmedAt="2026-09-22T12:00:00.000Z" onChange={onChange} />,
    );
    await userEvent.click(await screen.findByRole("switch"));
    expect(onChange).toHaveBeenCalledWith({ show_mature: false });
    expect(screen.queryByText("Are you 18 or older?")).toBeNull();
  });
});

describe("CreationView", () => {
  const ir = resolveSample(diffPair.to).ir;
  const detail: CreationDetail = {
    ...SUMMARY,
    ref: ir.root.ref,
    type: "character",
    display_name: "Courier",
    releases: [
      {
        id: "rel_01j00000000000000000000000",
        label: "2.0.0",
        visibility: "public",
        status: "active",
        semantic_digest: `sha256:${"a".repeat(64)}`,
        effective_rating: "mature",
        created_at: "2026-09-22T12:00:00.000Z",
      },
      {
        id: "rel_01j00000000000000000000001",
        label: "1.0.0",
        visibility: "public",
        status: "tombstoned",
        status_reason: "legal.dmca",
        semantic_digest: `sha256:${"b".repeat(64)}`,
        effective_rating: "general",
        created_at: "2026-09-01T12:00:00.000Z",
      },
    ],
    dependents_count: 0,
    contribution_policy: "signed-in",
  };
  const props = {
    ns: "djj",
    name: "courier",
    detail,
    onSelectLabel: () => {},
    release: undefined,
    dependents: [],
    canEdit: false,
  };

  it("explains which source sets the effective rating and gates the content", async () => {
    renderWithApp(
      <CreationView
        {...props}
        label="2.0.0"
        tombstoned={null}
        ir={ir}
        irState="ready"
        allowMature={false}
      />,
    );
    expect(await screen.findByText("Why this rating")).toBeTruthy();
    expect(screen.getByText("sets the rating")).toBeTruthy();
    expect(screen.getByText("Mature content is hidden")).toBeTruthy();
    expect(screen.getByText(/removed after a copyright \(DMCA\) notice/)).toBeTruthy();
  });

  it("shows the public reason code for a removed version", async () => {
    renderWithApp(
      <CreationView
        {...props}
        label="1.0.0"
        tombstoned={{ reason: "legal.dmca" }}
        ir={undefined}
        irState="none"
        allowMature={false}
      />,
    );
    expect(await screen.findByText("This version is no longer available")).toBeTruthy();
    expect(screen.getByText("(legal.dmca)")).toBeTruthy();
  });
});

describe("PublishReport", () => {
  it("lists errors and warnings with the license check", async () => {
    renderWithApp(
      <PublishReport
        report={{
          release: "rel_01j00000000000000000000000",
          label: "1.0.0",
          state: "failed",
          idempotent: false,
          report: {
            license_check: "fail",
            issues: [
              {
                code: "license.incompatible",
                subject: "references[world]",
                severity: "error",
                detail: "NC cannot be combined",
              },
              { code: "asset.unscanned", subject: "assets#avatar", severity: "warning" },
            ],
          },
        }}
      />,
    );
    expect(await screen.findByText("Could not publish 1.0.0")).toBeTruthy();
    expect(screen.getByText("Licenses do not allow this combination.")).toBeTruthy();
    expect(screen.getByText("license.incompatible")).toBeTruthy();
    expect(screen.getByText("asset.unscanned")).toBeTruthy();
  });
});

describe("ImportWizard", () => {
  const SECRET = "NEVER-SHOW-THIS-SYSTEM-PROMPT";
  const card = {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name: "Mira",
      description: "{{char}} keeps the lighthouse.",
      personality: "",
      scenario: "",
      first_mes: "Hello, {{user}}.",
      mes_example: "",
      creator_notes: "",
      system_prompt: SECRET,
      post_history_instructions: `${SECRET}-PHI`,
      alternate_greetings: [],
      tags: [],
      creator: "someone",
      character_version: "1",
      extensions: {},
      group_only_greetings: [],
    },
  };

  it("shows omitted policy field names but never their values, and keeps them out of the draft", async () => {
    const putDraft = vi.fn(async () => ({
      version: 2,
      semantic_digest: `sha256:${"c".repeat(64)}` as const,
      warnings: [],
    }));
    const onCreated = vi.fn();
    const client = fakeClient({
      createCreation: async () => ({
        id: "cr_01j00000000000000000000000",
        ref: "@writer/mira",
        type: "character",
      }),
      draft: async () => ({
        version: 1,
        working: {},
        base_revision_id: null,
        updated_at: "2026-09-22T12:00:00.000Z",
      }),
      putDraft,
    });
    renderWithApp(<ImportWizard ns="writer" onCreated={onCreated} />, client);
    const file = new File([JSON.stringify(card)], "mira.json", { type: "application/json" });
    await userEvent.upload(await screen.findByLabelText("Character card"), file);
    const omitted = await screen.findByRole("list", { name: "Omitted fields" });
    expect(within(omitted).getByText("system_prompt")).toBeTruthy();
    expect(within(omitted).getByText("post_history_instructions")).toBeTruthy();
    expect(document.body.textContent).not.toContain(SECRET);

    await userEvent.selectOptions(screen.getByLabelText("Rating"), "general");
    await userEvent.selectOptions(screen.getByLabelText("Rights"), "original");
    await userEvent.selectOptions(screen.getByLabelText("License"), "CC-BY-4.0");
    await userEvent.click(screen.getByRole("button", { name: "Import as a new character" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("mira"));
    expect(JSON.stringify(putDraft.mock.calls[0])).not.toContain(SECRET);
  });
});

describe("Editor", () => {
  it("stops autosaving on a version conflict and offers to reload", async () => {
    const initial: Draft = {
      version: 3,
      working: { display_name: "Hero", fragments: [], meta: { default_locale: "en" } },
      base_revision_id: null,
      updated_at: "2026-09-22T12:00:00.000Z",
    };
    const putDraft = vi.fn(async () => {
      throw new ApiError(409, "draft.version_conflict");
    });
    const draft = vi.fn(async () => ({ ...initial, version: 5 }));
    renderWithApp(
      <Editor ns="writer" name="hero" type="character" draft={initial} existingLabels={[]} />,
      fakeClient({ putDraft, draft, me: async () => ME }),
    );
    await userEvent.type(await screen.findByLabelText("Name"), "!");
    expect(
      await screen.findByText("This draft was changed somewhere else", {}, { timeout: 3000 }),
    ).toBeTruthy();
    expect(putDraft).toHaveBeenCalledWith("writer", "hero", 3, expect.anything());
    await userEvent.click(screen.getByRole("button", { name: "Reload the latest draft" }));
    await waitFor(() => expect(draft).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByText("This draft was changed somewhere else")).toBeNull(),
    );
  });
});
