import { type CreationInput, configurationDigest, mergeContribution } from "@char-pub/core";
import { expect, it } from "vitest";
import { buildChanges, contributionBase } from "./contribution";

it("emits a fixture configuration change and exact base digest for a CRLF-only session edit", () => {
  const work: CreationInput = {
    id: "cr_01j00000000000000000000000",
    ref: "@test/fixture",
    type: "scenario",
    display_name: "Fixture",
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    cast: [{ key: "player", who: { late: "persona" } }],
    assembly_tests: [
      {
        id: "test",
        root: "self",
        profile: {
          runtime: { name: "test", version: "1" },
          tokenizer: "estimate",
          mode: "narrator",
          context_window: 4096,
          reserve_for_output: 512,
          capabilities: { system_role: true },
        },
        session: { history: [{ role: "user", text: "go\r\nnow" }], bindings: {} },
        assembler: { name: "test", version: "1" },
        tokenizer: { name: "estimate", version: "1" },
        expected: { kind: "success", trace: [{ source: "history", included: true }] },
      },
    ],
  };
  const base = contributionBase(work);
  const after = structuredClone(base.canonical.creation.assembly_tests ?? []);
  if (after[0]) after[0].session.history = [{ role: "user", text: "go\nnow" }];
  const changes = buildChanges(base.canonical, {
    ...base.edit,
    configuration: { ...base.edit.configuration, assembly_tests: after },
  });
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({
    on: "configuration",
    field: "assembly_tests",
    base_digest: configurationDigest("assembly_tests", base.canonical.creation.assembly_tests),
  });
  const merged = mergeContribution(base.canonical.creation, changes);
  expect(merged.conflicts).toEqual([]);
  expect(merged.result?.creation.assembly_tests?.[0]?.session.history[0]?.text).toBe("go\nnow");
  expect(base.canonical.creation.assembly_tests?.[0]?.session.history[0]?.text).toBe("go\r\nnow");
});
