import { canonicalizeCreation, sha256Bytes } from "@char-pub/core";
import { describe, expect, it } from "vitest";
import { buildTestCreation, withTestDefault } from "../../core/test/build.js";
import { DRAFT_ORIGIN, draftInput } from "../../core/test/draft-build-fixtures.js";
import { tid } from "../../core/test/fixtures.js";
import { ASSEMBLER } from "../src/assemble.js";
import { runAssemblyFixture } from "../src/fixtures.js";
import {
  assemble,
  createPreparationCatalog,
  fixedSelection,
  sourceRequests,
  startSession,
} from "../src/index.js";
import { TOKENIZER_VERSIONS } from "../src/tokens.js";

const profile = {
  runtime: { name: "test", version: "1" },
  tokenizer: "estimate",
  context_window: 10000,
  reserve_for_output: 0,
  mode: "narrator" as const,
  capabilities: { system_role: true, multiple_system_messages: true },
};
const bindings = { user: { kind: "persona" as const, display_name: "Player" } };

describe("draft artifacts through the public context contract", () => {
  it("starts and assembles selected draft Source text without a root Release ID", () => {
    const input = draftInput();
    const text = "DRAFT_REFERENCE_BODY";
    const notes = input.root.creation.assets?.find((asset) => asset.slot === "notes")?.variants[0];
    if (!notes) throw new Error("Missing notes");
    notes.blob = {
      availability: "mirrored",
      digest: sha256Bytes(new TextEncoder().encode(text)),
      size: text.length,
    };
    input.root.semantic_digest = canonicalizeCreation(input.root.creation).semantic_digest;
    const { artifact } = buildTestCreation(input);
    if (artifact.kind !== "content") throw new Error("Missing content");
    const source = artifact.catalog_index.sources[0];
    if (!source) throw new Error("Missing source");
    const { turn } = startSession({ artifact, bindings });
    const preparation = { artifact, turn, profile };
    const plan = fixedSelection(createPreparationCatalog(preparation), [{ source: source.id }]);
    expect(sourceRequests({ ...preparation, plan })).toEqual([
      expect.objectContaining({ source: source.id, asset: source.asset }),
    ]);
    const result = assemble({ ...preparation, plan, source_texts: { [source.asset]: text } });
    expect(result.messages.map((m) => m.content).join("\n")).toContain(text);
    expect(result.messages.at(-1)?.content).toBe("Alice: Hello Player.");
    expect(artifact.root).not.toHaveProperty("release");
    expect(
      result.trace.entries.find((e) => e.origin?.instance_key === "root")?.origin,
    ).toMatchObject({ origin: DRAFT_ORIGIN });
  });

  it("runs content-self and preset-self author fixtures without adding draft roots to dependencies", async () => {
    const content = withTestDefault(draftInput());
    const fixtureBase = {
      id: "draft",
      assembler: ASSEMBLER,
      tokenizer: { name: "estimate", version: TOKENIZER_VERSIONS.estimate },
      profile,
      session: { bindings, history: [] },
      expected: {
        kind: "success" as const,
        trace: [
          {
            source: "@draft/character#description~root",
            included: true,
            reason: "direct" as const,
          },
        ],
      },
    };
    const result = await runAssemblyFixture({
      ...content,
      fixture: { ...fixtureBase, root: "self" },
    });
    expect(result.ok).toBe(true);
    expect(result.trace?.entries.some((e) => e.origin && "origin" in e.origin)).toBe(true);
    const policy = draftInput("preset");
    const published = {
      creation: content.root.creation,
      visibility: "public" as const,
      release: tid("rel", 603),
      semantic_digest: content.root.semantic_digest,
    };
    const policyResult = await runAssemblyFixture(
      withTestDefault({
        ...policy,
        dependencies: [published],
        fixture: {
          ...fixtureBase,
          root: {
            ref: published.creation.ref,
            release: published.release,
            semantic_digest: published.semantic_digest,
          },
          preset: "self",
        },
      }),
    );
    expect(policyResult.ok).toBe(true);
    expect(policyResult.trace?.preset).toMatchObject({ origin: DRAFT_ORIGIN });
    expect(policyResult.trace?.preset).not.toHaveProperty("release");
    expect(
      policyResult.trace?.entries.find((e) => e.id === "preset:voice")?.policy_origin,
    ).toMatchObject({ origin: DRAFT_ORIGIN });
  });
});
