import {
  type AssemblyFixture,
  type CreationInput,
  canonicalizeCreation,
  sha256Bytes,
} from "@char-pub/core";
import { expect, it } from "vitest";
import { buildTestCreation, withTestDefault } from "../../core/test/build.js";
import {
  ASSEMBLER,
  createPreparationCatalog,
  digestAssemblyMessages,
  fixedSelection,
  prepareContext,
  runAssemblyTests,
  TOKENIZER_VERSIONS,
} from "../src/index.js";

it("replays a saved fixture with selected source's exact BOM/CRLF/NFD/trailing bytes after canonical persistence", async () => {
  const body = "\uFEFF# Cafe\u0301  \r\nSelected line\t\r\n# Other\r\nNot selected \r\n";
  const creation: CreationInput = {
    id: "cr_01j00000000000000000000000",
    ref: "@test/source-fixture",
    type: "scenario",
    display_name: "Source fixture",
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    cast: [{ key: "player", who: { late: "persona" } }],
    sources: [
      {
        id: "book",
        title: "Book",
        description: "Reference",
        asset: "book",
        format: "markdown",
        visibility: { scope: "shared" },
        sections: [
          { id: "selected", title: "Selected", description: "Selected section", anchor: "#Café" },
        ],
      },
    ],
    assets: [
      {
        slot: "book",
        role: "context",
        variants: [
          {
            id: "default",
            media_type: "text/markdown",
            blob: {
              availability: "mirrored",
              size: new TextEncoder().encode(body).length,
              digest: sha256Bytes(new TextEncoder().encode(body)),
            },
          },
        ],
      },
    ],
  };
  const root = {
    creation,
    release: "rel_01j00000000000000000000000",
    visibility: "public" as const,
  };
  const { artifact } = buildTestCreation({ root });
  if (artifact.kind !== "content") throw new Error("Expected content");
  const source = artifact.catalog_index.sources[0];
  if (!source) throw new Error("Expected source");
  const profile = {
    runtime: { name: "test", version: "1" },
    tokenizer: "estimate",
    context_window: 4096,
    reserve_for_output: 512,
    mode: "narrator" as const,
    capabilities: { system_role: true, multiple_system_messages: true },
  };
  const turn = {
    bindings: Object.fromEntries(
      artifact.ir.late_slots.map((slot) => [
        slot.key,
        { kind: slot.accepts[0] ?? "persona", display_name: "Visitor" },
      ]),
    ),
    history: [],
  };
  const selection = [{ source: source.id, section: "selected" }];
  const source_texts = { [source.asset]: body };
  const preparation = { artifact, profile, turn };
  const plan = fixedSelection(createPreparationCatalog(preparation), selection);
  const result = prepareContext({ ...preparation, plan, source_texts });
  expect(JSON.stringify(result.messages)).toContain("Selected line");
  expect(JSON.stringify(result.messages)).not.toContain("Not selected");
  const fixture: AssemblyFixture = {
    id: "source",
    root: "self",
    profile,
    session: turn,
    selection,
    source_texts,
    assembler: ASSEMBLER,
    tokenizer: { name: "estimate", version: TOKENIZER_VERSIONS.estimate },
    expected: { kind: "success", messages_digest: digestAssemblyMessages(result.messages) },
  };
  const saved = canonicalizeCreation({ ...creation, assembly_tests: [fixture] });
  expect(saved.semantic_digest).not.toBe(artifact.root.semantic_digest);
  const restored = canonicalizeCreation(JSON.parse(JSON.stringify(saved.json)));
  const tested = await runAssemblyTests(
    withTestDefault({ root: { ...root, creation: restored.json } }),
  );
  expect(tested.results).toHaveLength(1);
  expect(tested.results[0]?.issues).toEqual([]);
  expect(tested.ok).toBe(true);
  expect(tested.results[0]?.messages_digest).toBe(
    fixture.expected.kind === "success" ? fixture.expected.messages_digest : undefined,
  );
});
