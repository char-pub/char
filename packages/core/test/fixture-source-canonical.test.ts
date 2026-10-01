import { expect, it } from "vitest";
import {
  canonicalizeCreation,
  configurationDigest,
  digestJson,
  normalizeText,
  normalizeValue,
} from "../src/canonical.js";
import { createLocalBuildInput } from "../src/local-build.js";
import { mergeContribution, normalizeContributionChange } from "../src/merge.js";
import type { CreationInput } from "../src/schema/creation.js";
import { ChangeSchema } from "../src/schema/release.js";
import { buildTestCreation } from "./build.js";
import { level0Character } from "./fixtures.js";

const raw = "\uFEFF# Cafe\u0301  \r\nFirst line\t\r\nSecond line \r";
function input(body = raw): CreationInput {
  return {
    ...level0Character(),
    type: "scenario",
    cast: [{ key: "player", who: { late: "persona" } }],
    fragments: [],
    display_name: "Cafe\u0301  \r\n",
    assembly_tests: [
      {
        id: "source",
        root: "self",
        profile: {
          runtime: { name: "test", version: "1" },
          tokenizer: "estimate",
          context_window: 4096,
          reserve_for_output: 512,
          mode: "narrator",
          capabilities: { system_role: true },
        },
        session: { bindings: {}, history: [{ role: "user", text: raw }] },
        source_texts: { "@djj/alice#asset/book/default~root": body },
        assembler: { name: "test", version: "1" },
        tokenizer: { name: "estimate", version: "1" },
        expected: { kind: "success", trace: [{ source: "history", included: true }] },
      },
    ],
  };
}

it("preserves fixture source bytes through input, JSON, manifest, and repeated canonicalization", () => {
  const first = canonicalizeCreation(input());
  const second = canonicalizeCreation(JSON.parse(JSON.stringify(first.json)));
  const third = canonicalizeCreation(second.creation);
  for (const result of [first, second, third]) {
    expect(Object.values(result.creation.assembly_tests?.[0]?.source_texts ?? {})).toEqual([raw]);
    expect(
      (result.json as { assembly_tests: { source_texts: Record<string, string> }[] })
        .assembly_tests[0]?.source_texts,
    ).toEqual(first.creation.assembly_tests?.[0]?.source_texts);
    expect(
      (result.manifest as { assembly_tests: { source_texts: Record<string, string> }[] })
        .assembly_tests[0]?.source_texts,
    ).toEqual(first.creation.assembly_tests?.[0]?.source_texts);
    expect(result.semantic_digest).toBe(digestJson(result.manifest));
    expect(result.semantic_digest).toBe(first.semantic_digest);
    expect(result.creation.display_name).toBe("Café\n");
    expect(result.creation.assembly_tests?.[0]?.session.history[0]?.text).toBe(raw);
  }
  expect(canonicalizeCreation(input(normalizeText(raw))).semantic_digest).not.toBe(
    first.semantic_digest,
  );
});

it("preserves session record keys and strings but still rejects non-JSON snapshots", () => {
  const work = input();
  const fixture = work.assembly_tests?.[0];
  if (!fixture) throw new Error("Expected fixture");
  fixture.session.story = {
    start: "start",
    visited: ["start"],
    reached: [],
    ended: [],
    happened: [],
    stopped: false,
    vars: { "e\u0301": "value\t\r\n", é: "other", "assembly_tests[0].source_texts": raw },
    knowing: {},
  };
  const first = canonicalizeCreation(work);
  const second = canonicalizeCreation(first.json);
  expect(second.creation.assembly_tests?.[0]?.session).toEqual(
    first.creation.assembly_tests?.[0]?.session,
  );
  expect(second.creation.assembly_tests?.[0]?.session.story?.vars).toEqual(
    fixture.session.story.vars,
  );
  const invalid = structuredClone(work);
  if (invalid.assembly_tests?.[0]?.session.story)
    invalid.assembly_tests[0].session.story.vars.bad = Number.POSITIVE_INFINITY;
  expect(() => canonicalizeCreation(invalid)).toThrowError(
    expect.objectContaining({ code: "canonical.invalid_number" }),
  );
  if (invalid.assembly_tests?.[0]) invalid.assembly_tests[0].session = new Date() as never;
  expect(() => canonicalizeCreation(invalid)).toThrowError(
    expect.objectContaining({ code: "canonical.not_plain_object" }),
  );
});

it("does not let diagnostic paths or lookalike authored keys opt generic values into raw mode", () => {
  expect(normalizeValue(raw, "$.assembly_tests[0].source_texts.asset")).toBe(normalizeText(raw));
  expect(normalizeValue({ assembly_tests: [{ source_texts: { asset: raw } }] })).toEqual({
    assembly_tests: [{ source_texts: { asset: normalizeText(raw) } }],
  });
  const work = input();
  expect(() =>
    canonicalizeCreation({ ...work, "assembly_tests[0].source_texts": { asset: raw } }),
  ).toThrowError(expect.objectContaining({ code: "schema.invalid" }));
  const broken = structuredClone(work);
  if (broken.assembly_tests?.[0])
    broken.assembly_tests[0].source_texts = { asset: { source_texts: { raw } } } as never;
  expect(() => canonicalizeCreation(broken)).toThrowError(
    expect.objectContaining({ code: "schema.invalid" }),
  );
});

it("retains existing raw fixture bodies when merging an unrelated metadata change", () => {
  const base = canonicalizeCreation(input());
  const merged = mergeContribution(base.creation, [
    { on: "metadata", field: "meta.tags", op: "set", after: ["noir"], sensitive: false },
  ]);
  expect(merged.conflicts).toEqual([]);
  expect(merged.result?.creation.meta.tags).toEqual(["noir"]);
  expect(Object.values(merged.result?.creation.assembly_tests?.[0]?.source_texts ?? {})).toEqual([
    raw,
  ]);
  expect(merged.result?.creation.assembly_tests?.[0]?.session).toEqual(
    base.creation.assembly_tests?.[0]?.session,
  );
  expect(merged.result?.semantic_digest).toBe(
    canonicalizeCreation({ ...input(), meta: { ...input().meta, tags: ["noir"] } }).semantic_digest,
  );
  expect(base.creation.meta.tags).toBeUndefined();
});

it("preserves exact source and TurnView values through contribution route parsing and configuration set", () => {
  const work = input();
  const { assembly_tests: tests, ...withoutTests } = work;
  const change = { on: "configuration", field: "assembly_tests", op: "set", after: tests };
  // This is the same normalization/schema boundary used by the Registry route.
  const parsed = ChangeSchema.parse(normalizeContributionChange(change));
  expect(parsed.after).toEqual(tests);
  const merged = mergeContribution(withoutTests, [parsed]);
  expect(merged.conflicts).toEqual([]);
  expect(merged.result?.creation.assembly_tests?.[0]?.source_texts).toEqual(
    tests?.[0]?.source_texts,
  );
  expect(merged.result?.creation.assembly_tests?.[0]?.session).toEqual(tests?.[0]?.session);
  expect(merged.outcomes[0]?.after_digest).toBe(configurationDigest("assembly_tests", tests));
  expect(mergeContribution(merged.result?.creation ?? work, [parsed]).outcomes[0]?.state).toBe(
    "already_applied",
  );
});

it.each(["session", "source_texts"] as const)(
  "detects a concurrent CRLF-only change in fixture %s",
  (field) => {
    const base = input();
    const concurrent = input();
    const proposed = input();
    const currentFixture = concurrent.assembly_tests?.[0];
    const nextFixture = proposed.assembly_tests?.[0];
    if (!currentFixture || !nextFixture) throw new Error("Expected fixture");
    if (field === "session")
      currentFixture.session.history = [{ role: "user", text: raw.replaceAll("\r\n", "\n") }];
    else
      currentFixture.source_texts = {
        "@djj/alice#asset/book/default~root": raw.replaceAll("\r\n", "\n"),
      };
    nextFixture.session.history = [
      ...(nextFixture.session.history ?? []),
      { role: "user", text: "Later conversation" },
    ];
    const change = {
      on: "configuration",
      field: "assembly_tests",
      op: "set",
      base_digest: configurationDigest("assembly_tests", base.assembly_tests),
      after: proposed.assembly_tests,
    };
    expect(configurationDigest("assembly_tests", concurrent.assembly_tests)).not.toBe(
      change.base_digest,
    );
    const result = mergeContribution(concurrent, [change]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.result).toBeNull();
  },
);

it("rejects repeated build identities with different raw sessions while accepting equivalent authored prose", () => {
  const root = {
    creation: input(),
    release: "rel_01j00000000000000000000000",
    visibility: "public" as const,
  };
  const equivalent = { ...root, creation: { ...input(), display_name: "Café\n" } };
  expect(buildTestCreation({ root, dependencies: [equivalent] }).json).toBe(
    buildTestCreation({ root }).json,
  );
  const changed = input();
  if (changed.assembly_tests?.[0])
    changed.assembly_tests[0].session.history = [
      { role: "user", text: raw.replaceAll("\r\n", "\n") },
    ];
  expect(() =>
    buildTestCreation({ root, dependencies: [{ ...root, creation: changed }] }),
  ).toThrowError(expect.objectContaining({ code: "resolve.duplicate_release" }));
  const local = createLocalBuildInput({
    root: { creation: input() },
    dependencies: [root, equivalent],
  });
  expect(local.dependencies).toHaveLength(1);
  expect(() =>
    createLocalBuildInput({
      root: { creation: input() },
      dependencies: [root, { ...root, creation: changed }],
    }),
  ).toThrowError(expect.objectContaining({ code: "resolve.duplicate_release" }));
  expect(createLocalBuildInput({ root: { creation: changed } }).root.origin).not.toEqual(
    createLocalBuildInput({ root: { creation: input() } }).root.origin,
  );
});
