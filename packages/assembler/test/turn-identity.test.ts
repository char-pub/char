/** A saved selection must identify the exact Runtime text seen by the provider. */
import { sha256Bytes, type TurnViewInput } from "@char-pub/core";
import { describe, expect, it } from "vitest";
import { buildTestCreation } from "../../core/test/build.js";
import { level0Character, tid } from "../../core/test/fixtures.js";
import {
  createPreparationCatalog,
  digestAssemblyMessages,
  fixedSelection,
  prepareContext,
  selectorView,
  sourceRequests,
} from "../src/index.js";

function preparation(turn: TurnViewInput) {
  const body = "REFERENCE_BODY";
  const { artifact } = buildTestCreation({
    root: {
      creation: level0Character({
        bootstrap: undefined,
        sources: [
          {
            id: "book",
            title: "Book",
            description: "Optional reference",
            asset: "book",
            format: "text",
            visibility: { scope: "shared" },
          },
        ],
        assets: [
          {
            slot: "book",
            role: "context",
            variants: [
              {
                id: "default",
                media_type: "text/plain",
                blob: {
                  availability: "mirrored",
                  size: body.length,
                  digest: sha256Bytes(new TextEncoder().encode(body)),
                },
              },
            ],
          },
        ],
      }),
      release: tid("rel", 1),
      visibility: "public",
    },
  });
  if (artifact.kind !== "content") throw new Error("content fixture required");
  const source = artifact.catalog_index.sources[0];
  if (!source) throw new Error("source fixture required");
  return {
    source,
    input: {
      artifact,
      profile: {
        runtime: { name: "test", version: "1" },
        tokenizer: "estimate",
        context_window: 4096,
        reserve_for_output: 512,
        mode: "narrator" as const,
        capabilities: { system_role: true, multiple_system_messages: true },
      },
      turn: { bindings: { user: { kind: "persona" as const, display_name: "Player" } }, ...turn },
      source_texts: { [source.asset]: body },
    },
  };
}
const pairs = [
  ["line endings", "First\r\nSecond", "First\nSecond"],
  ["Unicode", "Cafe\u0301", "Café"],
  ["trailing whitespace", "Read this \t", "Read this"],
] as const;

describe.each(["history", "focus"] as const)("exact %s binding", (field) => {
  it.each(pairs)(
    "invalidates both preparation and Source requests after %s change",
    (_name, original, changed) => {
      const turn = (text: string): TurnViewInput =>
        field === "history" ? { history: [{ role: "user", text }] } : { focus: text };
      const { input, source } = preparation(turn(original));
      const before = createPreparationCatalog(input);
      const plan = fixedSelection(before, [{ source: source.id }]);
      const previous = prepareContext({ ...input, plan });
      expect(sourceRequests({ ...input, plan })).toHaveLength(1);
      const next = { ...input, turn: { ...input.turn, ...turn(changed) } };
      const after = createPreparationCatalog(next);
      expect(after.input.catalog_digest).toBe(before.input.catalog_digest);
      expect(selectorView(after.context)).not.toEqual(selectorView(before.context));
      const current = prepareContext({
        ...next,
        plan: fixedSelection(after, [{ source: source.id }]),
      });
      if (field === "history") {
        expect(previous.messages.find((message) => message.role === "user")?.content).toBe(
          original,
        );
        expect(current.messages.find((message) => message.role === "user")?.content).toBe(changed);
      }
      expect.soft(after.input.turn_digest).not.toBe(before.input.turn_digest);
      expect
        .soft(() => prepareContext({ ...next, plan }))
        .toThrowError(expect.objectContaining({ code: "selection.input_mismatch" }));
      expect
        .soft(() => sourceRequests({ ...next, plan }))
        .toThrowError(expect.objectContaining({ code: "selection.input_mismatch" }));
    },
  );
});

it.each(pairs)(
  "message digests distinguish exact %s while authored canonical semantics remain separate",
  (_name, original, changed) => {
    const message = (content: string) => [{ role: "user" as const, content, source: ["history"] }];
    expect(digestAssemblyMessages(message(original))).not.toBe(
      digestAssemblyMessages(message(changed)),
    );
  },
);

it("keeps a saved Plan usable when only JSON property order or absent optional values differ", () => {
  const { input, source } = preparation({
    focus: "Cafe\u0301 \r\n",
    history: [{ role: "user", text: "Exact \t" }],
    overlay: { state: { b: "Two", a: "One" } },
  });
  const first = createPreparationCatalog(input);
  const plan = fixedSelection(first, [{ source: source.id }]);
  const next = {
    ...input,
    turn: {
      history: input.turn.history,
      overlay: { state: { a: "One", b: "Two" } },
      bindings: input.turn.bindings,
      focus: input.turn.focus,
      locale: undefined,
    },
  };
  expect(createPreparationCatalog(next).input.turn_digest).toBe(first.input.turn_digest);
  expect(prepareContext({ ...next, plan }).messages).toEqual(
    prepareContext({ ...input, plan }).messages,
  );
  expect(sourceRequests({ ...next, plan })).toEqual(sourceRequests({ ...input, plan }));
});

it.each<[string, TurnViewInput, TurnViewInput]>([
  ["memory", { overlay: { memory: ["Raw \t"] } }, { overlay: { memory: ["Raw"] } }],
  [
    "dictionary key",
    { overlay: { state: { "e\u0301": "Raw" } } },
    { overlay: { state: { é: "Raw" } } },
  ],
  [
    "binding text",
    { bindings: { user: { kind: "persona", display_name: "Cafe\u0301" } } },
    { bindings: { user: { kind: "persona", display_name: "Café" } } },
  ],
])("binds the complete runtime snapshot including %s", (_name, before, after) => {
  const { input, source } = preparation(before);
  const plan = fixedSelection(createPreparationCatalog(input), [{ source: source.id }]);
  const next = { ...input, turn: { ...input.turn, ...after } };
  expect(() => prepareContext({ ...next, plan })).toThrowError(
    expect.objectContaining({ code: "selection.input_mismatch" }),
  );
});

it("trace identity preserves a selector's exact note rather than normalizing its recorded decision", () => {
  const { input, source } = preparation({});
  const plan = fixedSelection(createPreparationCatalog(input), [{ source: source.id }]);
  const first = {
    ...plan,
    decisions: plan.decisions.map((decision) => ({ ...decision, note: "Evidence \r\n" })),
  };
  const second = {
    ...plan,
    decisions: plan.decisions.map((decision) => ({ ...decision, note: "Evidence\n" })),
  };
  expect(prepareContext({ ...input, plan: first }).trace.selection?.plan_digest).not.toBe(
    prepareContext({ ...input, plan: second }).trace.selection?.plan_digest,
  );
});
