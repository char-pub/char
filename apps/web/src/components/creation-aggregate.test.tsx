import {
  buildCreation,
  type CreationInput,
  canonicalizeCreation,
  PRESET_REGIONS,
  type ReleaseInput,
  requirePublishedArtifact,
} from "@char-pub/core";
import { act, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { CreationDetail, RegistryClient, ReleaseDetail } from "@/lib/api";
import { Route as OverviewRoute } from "@/routes/c.$ns.$name.index";
import { fakeClient, renderWithApp } from "@/test/render";
import { CreationShell } from "./creation-shell";

const meta = {
  default_locale: "en",
  rating: "general",
  rights: "original",
  license: "CC0-1.0",
} as const;
function published(n: number, creation: CreationInput): ReleaseInput & { semantic_digest: string } {
  return {
    release: `rel_01j0000000000000000000000${n}`,
    visibility: "public",
    creation,
    semantic_digest: canonicalizeCreation(creation).semantic_digest,
  };
}
const source = published(1, {
  id: "cr_01j00000000000000000000001",
  ref: "@original/world",
  type: "world",
  display_name: "Original world",
  meta: {
    ...meta,
    rating: "teen",
    license: "CC-BY-SA-4.0",
    content_warnings: ["Historical violence"],
  },
  authors: [{ name: "Original world author" }],
  fragments: [
    {
      id: "setting",
      stable: true,
      kind: "world",
      content: { type: "text", text: "SOURCE_BODY_MUST_NOT_BE_FETCHED" },
    },
  ],
});
const policy = published(2, {
  id: "cr_01j00000000000000000000002",
  ref: "@policy/narrator",
  type: "preset",
  display_name: "Narrator policy",
  meta: {
    ...meta,
    rating: "mature",
    license: "CC-BY-4.0",
    content_warnings: ["Policy mature themes"],
  },
  authors: [{ name: "Policy author" }],
  policy: {
    version: "1-draft",
    blocks: [],
    layout: [...PRESET_REGIONS],
    requires: { system_role: true },
  },
});
const root = published(3, {
  id: "cr_01j00000000000000000000003",
  ref: "@writer/sequel",
  type: "scenario",
  display_name: "New story",
  meta: { ...meta, license: "CC-BY-SA-4.0" },
  authors: [{ name: "New story author" }],
  provenance: {
    derived_from: [
      {
        ref: "@original/world",
        release: source.release,
        semantic_digest: source.semantic_digest,
        relation: "sequel",
      },
    ],
  },
  cast: [{ key: "player", who: { late: "persona" }, role: "user" }],
  fragments: [
    {
      id: "scene",
      stable: true,
      kind: "scenario",
      content: { type: "text", text: "CURRENT_BODY" },
    },
  ],
  story: {
    version: 1,
    scenes: [{ id: "arrival", title: "Arrival" }],
    vars: {
      trust: { type: "int", description: "Trust", min: 0, max: 5, init: 0 },
    },
  },
});
const built = buildCreation({
  root,
  dependencies: [source, policy],
  default_policy: {
    ref: "@policy/narrator",
    release: policy.release,
    semantic_digest: policy.semantic_digest,
  },
});
const publishedArtifact = requirePublishedArtifact(built.artifact);
if (publishedArtifact.kind !== "content") throw new Error("Content fixture required");
const artifact = publishedArtifact;
const selected = {
  id: root.release,
  label: "1.0.0",
  visibility: "public" as const,
  status: "active" as const,
  semantic_digest: artifact.root.semantic_digest,
  effective_rating: artifact.meta.rating,
  created_at: "2026-10-01T00:00:00.000Z",
};
const detail: CreationDetail = {
  id: "cr_01j00000000000000000000003",
  ref: "@writer/sequel",
  type: "scenario",
  display_name: "New story",
  rating: "general",
  effective_rating: artifact.meta.rating,
  tags: [],
  releases: [selected],
  latest_release: selected,
  dependents_count: 0,
  contribution_policy: "closed",
};
const release: ReleaseDetail = {
  ...selected,
  ref: detail.ref,
  creation: detail.id,
  artifact_digest: built.digest,
  lock_digest: artifact.lock_digest,
  context_ir_digest: null,
  license_check: "pass",
  availability: "complete",
};
const Overview = OverviewRoute.options.component;
function Page() {
  if (!Overview) throw new Error("Overview route component required");
  return (
    <CreationShell ns="writer" name="sequel" v="1.0.0">
      <Overview />
    </CreationShell>
  );
}
function client(
  getArtifact: RegistryClient["getArtifact"] = async () => artifact,
  overrides: Partial<RegistryClient> = {},
) {
  return fakeClient({
    me: async () => null,
    creation: async () => detail,
    release: async () => release,
    getIR: async () => artifact.ir,
    getArtifact,
    dependents: async () => ({ items: [], next_cursor: null }),
    ...overrides,
  });
}

it("renders source and policy metadata from the real aggregate even when Creative IR excludes both", async () => {
  expect(artifact.ir.meta.rating).toBe("general");
  expect(artifact.meta.rating).toBe("mature");
  expect(artifact.ir.meta.licenses.map((entry) => entry.ref)).not.toContain("@original/world");
  expect(artifact.ir.meta.licenses.map((entry) => entry.ref)).not.toContain("@policy/narrator");
  const sourceText = vi.fn();
  renderWithApp(<Page />, client(undefined, { sourceText }));
  await screen.findByText("Experimental capabilities");
  const why = await screen.findByRole("region", { name: "Why this rating" });
  expect(why.textContent).toContain("Mature, because a dependency is rated Mature");
  expect(why.textContent).toContain("@policy/narrator");
  const credits = screen.getByRole("region", { name: "Credits & licenses" });
  expect(credits.textContent).toContain("Original world author");
  expect(credits.textContent).toContain("Policy author");
  expect(credits.textContent).toContain("CC-BY-SA-4.0");
  expect(credits.textContent).toContain("CC-BY-4.0");
  expect(screen.getByText("Historical violence")).toBeTruthy();
  expect(screen.getByText("Policy mature themes")).toBeTruthy();
  expect(screen.queryByText("CURRENT_BODY")).toBeNull();
  expect(screen.queryByText("SOURCE_BODY_MUST_NOT_BE_FETCHED")).toBeNull();
  expect(sourceText).not.toHaveBeenCalled();
  const capabilities = screen.getByRole("region", { name: "Required runtime capabilities" });
  expect(within(capabilities).getByText("Locked prompt policy")).toBeTruthy();
  expect(within(capabilities).getByText("Story state and conditions (experimental)")).toBeTruthy();
  const dependencies = screen.getByRole("region", { name: "Built on" });
  expect(dependencies.textContent).toContain(source.release);
  expect(dependencies.textContent).toContain(policy.release);
});

it("keeps the effective Release rating while aggregate details load and never labels partial IR as complete", async () => {
  let finish!: (value: typeof artifact) => void;
  const pending = new Promise<typeof artifact>((resolve) => {
    finish = resolve;
  });
  renderWithApp(
    <Page />,
    client(() => pending),
  );
  await screen.findByText(
    "Loading complete credits, licenses, rating sources and runtime requirements…",
  );
  expect(await screen.findByText("Mature content is hidden")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Why this rating" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Credits & licenses" })).toBeNull();
  expect(screen.queryByText("CURRENT_BODY")).toBeNull();
  await act(async () => {
    finish(artifact);
  });
  expect(await screen.findByText("Policy mature themes")).toBeTruthy();
});

it("offers a retry for unavailable aggregate metadata without claiming the Creative IR is the whole release", async () => {
  const getArtifact = vi
    .fn()
    .mockRejectedValueOnce(new Error("Metadata unavailable"))
    .mockResolvedValueOnce(artifact);
  renderWithApp(<Page />, client(getArtifact));
  const retry = await screen.findByRole("button", { name: "Retry release details" });
  expect(screen.queryByRole("region", { name: "Credits & licenses" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Required runtime capabilities" })).toBeNull();
  await act(async () => {
    retry.click();
  });
  expect(await screen.findByRole("region", { name: "Required runtime capabilities" })).toBeTruthy();
  expect(getArtifact).toHaveBeenCalledTimes(2);
});

it("rejects an artifact from another exact Release instead of displaying its requirements", async () => {
  const other = requirePublishedArtifact(
    buildCreation({
      root: { ...root, release: "rel_01j00000000000000000000004" },
      dependencies: [source, policy],
      default_policy: {
        ref: "@policy/narrator",
        release: policy.release,
        semantic_digest: policy.semantic_digest,
      },
    }).artifact,
  );
  renderWithApp(
    <Page />,
    client(async () => other),
  );
  await screen.findByRole("button", { name: "Retry release details" });
  expect(screen.queryByText("Experimental capabilities")).toBeNull();
  expect(screen.queryByText("Policy mature themes")).toBeNull();
  expect(screen.queryByRole("region", { name: "Credits & licenses" })).toBeNull();
});

it("marks legacy releases without an artifact as incomplete instead of waiting forever", async () => {
  const getArtifact = vi.fn(async () => artifact);
  const { artifact_digest: _digest, ...legacy } = release;
  renderWithApp(<Page />, client(getArtifact, { release: async () => legacy }));
  expect(await screen.findByText(/This release has no complete artifact/)).toBeTruthy();
  expect(getArtifact).not.toHaveBeenCalled();
  expect(screen.queryByRole("region", { name: "Required runtime capabilities" })).toBeNull();
});
