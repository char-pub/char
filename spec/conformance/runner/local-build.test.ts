/** Local input identity and actual consumption in Node, Chromium and workerd. */
import {
  ASSEMBLER,
  assemble,
  createPreparationCatalog,
  digestAssemblyMessages,
  fixedSelection,
  prepareContext,
  runAssemblyFixture,
  startSession,
  TOKENIZER_VERSIONS,
} from "@char-pub/assembler";
import { exportCCv3 } from "@char-pub/ccv3";
import {
  buildCreation,
  canonicalizeCreation,
  createLocalBuildInput,
  PRESET_REGIONS,
  sha256Bytes,
} from "@char-pub/core";
import { expect, it } from "vitest";

it("keeps local content/policy provenance through real opening, messages, trace and card export", () => {
  const meta = { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" };
  const policyCreation = {
    id: "cr_01j00000000000000000000001",
    ref: "@local/policy",
    type: "preset",
    display_name: "Policy",
    meta,
    policy: {
      version: "1-draft",
      blocks: [{ id: "voice", text: "LOCAL_POLICY_CONTEXT", default_at: "main" }],
      layout: [...PRESET_REGIONS],
      requires: { system_role: true },
    },
  };
  const publishedPolicy = {
    creation: policyCreation,
    release: "rel_01j00000000000000000000001",
    visibility: "public" as const,
  };
  const contentInput = createLocalBuildInput({
    root: {
      creation: {
        id: "cr_01j00000000000000000000002",
        ref: "@local/actor",
        type: "character",
        display_name: "Local",
        meta,
        fragments: [
          {
            id: "identity",
            stable: true,
            kind: "character",
            content: { type: "text", text: "LOCAL_CHARACTER_CONTEXT" },
          },
        ],
        bootstrap: { greetings: [{ id: "hello", text: "LOCAL_OPENING" }] },
      },
    },
    dependencies: [publishedPolicy],
    default_policy: {
      ref: "@local/policy",
      release: publishedPolicy.release,
      semantic_digest: canonicalizeCreation(policyCreation).semantic_digest,
    },
  });
  const localPolicy = createLocalBuildInput({ root: { creation: policyCreation } });
  const content = buildCreation(contentInput).artifact,
    policy = buildCreation(localPolicy).artifact;
  if (content.kind !== "content" || policy.kind !== "preset")
    throw new Error("Unexpected artifact kinds");
  const { turn } = startSession({
    artifact: content,
    bindings: { user: { kind: "persona", display_name: "Reader" } },
  });
  const result = assemble({
    artifact: content,
    preset: policy.preset,
    turn,
    profile: {
      runtime: { name: "conformance", version: "1" },
      tokenizer: "estimate",
      context_window: 4096,
      reserve_for_output: 0,
      mode: "narrator",
      capabilities: { system_role: true, multiple_system_messages: true },
    },
  });
  expect(result.messages.map((m) => m.content).join("\n")).toContain("LOCAL_POLICY_CONTEXT");
  expect(result.messages.map((m) => m.content).join("\n")).toContain("LOCAL_CHARACTER_CONTEXT");
  expect(result.messages.at(-1)?.content).toBe("Local: LOCAL_OPENING");
  expect(result.trace.ir).toMatchObject({
    root: "@local/actor",
    origin: contentInput.root.origin,
    semantic_digest: content.root.semantic_digest,
  });
  expect(result.trace.ir).not.toHaveProperty("release");
  expect(result.trace.preset).toMatchObject({ origin: localPolicy.root.origin });
  expect(result.trace.entries.find((entry) => entry.origin)?.origin).toMatchObject({
    origin: contentInput.root.origin,
  });
  const extension = exportCCv3(content, { resolvedPreset: policy.preset }).card.data.extensions
    .char_pub;
  expect(extension).toMatchObject({
    root: { origin: contentInput.root.origin },
    preset: { origin: localPolicy.root.origin },
  });
  expect(extension).not.toHaveProperty("root.release");
  expect(extension).not.toHaveProperty("preset.release");
});

it("replays a saved Creative fixture with exact Source bytes and an exact session in every runtime", async () => {
  const meta = { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" };
  const policy = {
    id: "cr_01j00000000000000000000011",
    ref: "@exact/policy",
    type: "preset",
    display_name: "Policy",
    meta,
    policy: {
      version: "1-draft",
      blocks: [],
      layout: [...PRESET_REGIONS],
      requires: { system_role: true },
    },
  };
  const dependency = {
    creation: policy,
    release: "rel_01j00000000000000000000011",
    visibility: "public" as const,
  };
  const pin = {
    ref: "@exact/policy",
    release: dependency.release,
    semantic_digest: canonicalizeCreation(policy).semantic_digest,
  };
  const text = "\uFEFF# One\r\nCafe\u0301  \r\n# Two\r\nUnselected\r\n";
  const bytes = new TextEncoder().encode(text);
  const creation = {
    id: "cr_01j00000000000000000000012",
    ref: "@exact/world",
    type: "world",
    display_name: "World",
    meta,
    fragments: [
      { id: "world", stable: true, kind: "world", content: { type: "text", text: "Inn" } },
      {
        id: "keyword",
        stable: true,
        kind: "knowledge",
        activation: { mode: "keyword", keys: ["go\nnow"] },
        content: { type: "text", text: "MUST_NOT_ACTIVATE" },
      },
    ],
    sources: [
      {
        id: "notes",
        title: "Notes",
        description: "Some notes",
        asset: "notes",
        format: "markdown",
        sections: [{ id: "one", title: "One", anchor: "#One" }],
      },
    ],
    assets: [
      {
        slot: "notes",
        role: "context",
        variants: [
          {
            id: "default",
            media_type: "text/markdown",
            blob: { digest: sha256Bytes(bytes), size: bytes.length, availability: "mirrored" },
          },
        ],
      },
    ],
  };
  const options = { dependencies: [dependency], default_policy: pin };
  const build = createLocalBuildInput({ root: { creation }, ...options });
  const artifact = buildCreation(build).artifact;
  if (artifact.kind !== "content") throw new Error("content");
  const source = artifact.catalog_index.sources[0];
  if (!source) throw new Error("source");
  const profile = {
    runtime: { name: "conformance", version: "1" },
    tokenizer: "estimate",
    context_window: 8192,
    reserve_for_output: 0,
    mode: "narrator" as const,
    capabilities: { images: false, system_role: true, multiple_system_messages: true },
  };
  const session = {
    history: [{ role: "user" as const, text: "go\r\nnow" }],
    bindings: { user: { kind: "persona" as const, display_name: "Reader" } },
  };
  const preparation = { artifact, profile, turn: session };
  const selection = [{ source: source.id, section: "one" }];
  const source_texts = { [source.asset]: text };
  const result = prepareContext({
    ...preparation,
    plan: fixedSelection(createPreparationCatalog(preparation), selection),
    source_texts,
  });
  expect(JSON.stringify(result.messages)).not.toContain("MUST_NOT_ACTIVATE");
  const fixture = {
    id: "preview",
    root: "self" as const,
    preset: pin,
    profile,
    session,
    selection,
    source_texts,
    assembler: ASSEMBLER,
    tokenizer: { name: "estimate", version: TOKENIZER_VERSIONS.estimate },
    expected: {
      kind: "success" as const,
      messages_digest: digestAssemblyMessages(result.messages),
    },
  };
  const saved = canonicalizeCreation({ ...creation, assembly_tests: [fixture] });
  const persisted = saved.creation.assembly_tests?.[0];
  if (!persisted) throw new Error("fixture");
  expect(persisted.session.history?.[0]?.text).toBe("go\r\nnow");
  expect(persisted.source_texts?.[source.asset]).toBe(text);
  const replay = await runAssemblyFixture({
    ...createLocalBuildInput({ root: { creation: saved.json }, ...options }),
    fixture: persisted,
  });
  expect(replay.ok, JSON.stringify(replay.issues)).toBe(true);
});
