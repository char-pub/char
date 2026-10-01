import { type CreationInput, canonicalizeCreation } from "@char-pub/core";
import { expect, it } from "vitest";
import { buildSnapshot, type Snapshot } from "./content.js";

it("keeps canonical root and dependency fixture source bytes intact in release snapshots", () => {
  const body = "\uFEFF# Cafe\u0301  \r\nExact bytes\t\r\n";
  const creation: CreationInput = {
    id: "cr_01j00000000000000000000000",
    ref: "@test/source-fixture",
    type: "scenario",
    display_name: "Fixture",
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
    cast: [{ key: "player", who: { late: "persona" } }],
    assembly_tests: [
      {
        id: "fixture",
        root: "self",
        profile: {
          runtime: { name: "test", version: "1" },
          tokenizer: "estimate",
          context_window: 4096,
          reserve_for_output: 512,
          mode: "narrator",
          capabilities: { system_role: true },
        },
        session: { bindings: {}, history: [{ role: "user", text: "go\r\nnow\t" }] },
        source_texts: { asset: body },
        assembler: { name: "test", version: "1" },
        tokenizer: { name: "estimate", version: "1" },
        expected: { kind: "success", trace: [{ source: "history", included: true }] },
      },
    ],
  };
  const root = canonicalizeCreation(creation);
  const dep = canonicalizeCreation({
    ...creation,
    id: "cr_01j00000000000000000000001",
    ref: "@test/dependency",
  });
  const bytes = buildSnapshot(root.json, [
    {
      release: "rel_01j00000000000000000000001",
      ref: dep.creation.ref,
      semantic_digest: dep.semantic_digest,
      creation: dep.json,
      visibility: "public",
    },
  ]);
  const snapshot = JSON.parse(new TextDecoder().decode(bytes)) as Snapshot;
  expect(snapshot.root).toEqual(root.json);
  expect(snapshot.dependencies[0]?.creation).toEqual(dep.json);
  const restoredRoot = canonicalizeCreation(snapshot.root);
  const restoredDep = canonicalizeCreation(snapshot.dependencies[0]?.creation);
  expect(restoredRoot.semantic_digest).toBe(root.semantic_digest);
  expect(restoredDep.semantic_digest).toBe(dep.semantic_digest);
  expect(restoredDep.semantic_digest).toBe(snapshot.dependencies[0]?.semantic_digest);
  expect(Object.values(restoredRoot.creation.assembly_tests?.[0]?.source_texts ?? {})).toEqual([
    body,
  ]);
  expect(Object.values(restoredDep.creation.assembly_tests?.[0]?.source_texts ?? {})).toEqual([
    body,
  ]);
  expect(restoredRoot.creation.assembly_tests?.[0]?.session).toEqual(
    root.creation.assembly_tests?.[0]?.session,
  );
  expect(restoredDep.creation.assembly_tests?.[0]?.session).toEqual(
    dep.creation.assembly_tests?.[0]?.session,
  );
  const prior = snapshot.dependencies[0];
  if (!prior) throw new Error("Missing dependency");
  const newer = canonicalizeCreation({ ...dep.creation, display_name: "Revised dependency" });
  const next = {
    ...prior,
    release: "rel_01j00000000000000000000002",
    creation: newer.json,
    semantic_digest: newer.semantic_digest,
  };
  expect(buildSnapshot(root.json, [next, prior])).toEqual(buildSnapshot(root.json, [prior, next]));
});
