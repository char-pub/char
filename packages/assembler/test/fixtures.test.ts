import {
  type AssemblyFixture,
  buildCreation,
  type CreationInput,
  canonicalizeCreation,
  PRESET_REGIONS,
  type ReleaseInput,
} from "@char-pub/core";
import { describe, expect, it } from "vitest";
import { ASSEMBLER, assemble } from "../src/assemble.js";
import {
  assembleArtifact,
  digestAssemblyMessages,
  runAssemblyFixture,
  runAssemblyTests,
} from "../src/fixtures.js";
import { estimateCounter, TOKENIZER_VERSIONS } from "../src/tokens.js";

const release = "rel_01h455vb4pex5vsknk084sn001";
const meta = {
  default_locale: "en",
  rating: "general" as const,
  rights: "original" as const,
  license: "CC-BY-4.0",
};
const creation: CreationInput = {
  id: "cr_01h455vb4pex5vsknk084sn001",
  ref: "@test/scene",
  type: "scenario",
  display_name: "Scene",
  meta,
  cast: [{ key: "lead", who: { late: "character", hint: "Lead" }, role: "lead" }],
  fragments: [
    {
      id: "setting",
      stable: true,
      kind: "scenario",
      content: { type: "text", text: "Rain falls." },
    },
  ],
};
const root: ReleaseInput = { release, visibility: "public", creation };
const profile = {
  runtime: { name: "fixture", version: "1" },
  tokenizer: "estimate",
  context_window: 1024,
  reserve_for_output: 128,
  mode: "narrator" as const,
  capabilities: { system_role: true, multiple_system_messages: true },
};
const sampleArtifact = buildCreation({ root }).artifact;
if (sampleArtifact.kind !== "content") throw new Error("sample content required");
const session = {
  bindings: Object.fromEntries(
    sampleArtifact.ir.late_slots.map((slot) => [
      slot.key,
      {
        kind: slot.accepts[0] === "character" ? ("character" as const) : ("persona" as const),
        display_name: slot.key === "user" ? "User" : "Lead",
      },
    ]),
  ),
  history: [],
};

function fixture(): AssemblyFixture {
  return {
    id: "rain",
    root: "self",
    profile,
    session,
    assembler: ASSEMBLER,
    tokenizer: { name: "estimate", version: TOKENIZER_VERSIONS.estimate },
    expected: { kind: "success", messages_digest: `sha256:${"0".repeat(64)}` },
  };
}

it("checks messages and reports a mismatch without rewriting author expectations", async () => {
  const test = fixture();
  const initial = await runAssemblyFixture({ root, fixture: test });
  expect(initial.ok).toBe(false);
  expect(initial.messages_digest).toMatch(/^sha256:/);
  const digest = initial.messages_digest;
  if (!digest) throw new Error("no message digest");
  const passing = { ...test, expected: { kind: "success" as const, messages_digest: digest } };
  expect((await runAssemblyFixture({ root, fixture: passing })).ok).toBe(true);
  expect(
    (
      await runAssemblyFixture({
        root: {
          ...root,
          creation: {
            ...creation,
            fragments: [
              {
                id: "setting",
                stable: true,
                kind: "scenario",
                content: { type: "text", text: "Sun shines." },
              },
            ],
          },
        },
        fixture: passing,
      })
    ).ok,
  ).toBe(false);
  expect(test.expected).toEqual({ kind: "success", messages_digest: `sha256:${"0".repeat(64)}` });
});

it("validates activation trace assertions and distinguishes missing sources", async () => {
  const built = buildCreation({ root }).artifact;
  if (built.kind !== "content") throw new Error("content required");
  const source = built.ir.fragments[0]?.id;
  if (!source) throw new Error("fragment required");
  const test = {
    ...fixture(),
    expected: { kind: "success" as const, trace: [{ source, included: true, reason: "always" }] },
  };
  expect((await runAssemblyFixture({ root, fixture: test })).ok).toBe(true);
  test.expected.trace[0] = { source, included: false, reason: "budget" };
  expect((await runAssemblyFixture({ root, fixture: test })).issues).toHaveLength(2);
  test.expected.trace[0] = { source: "missing", included: true, reason: "always" };
  expect((await runAssemblyFixture({ root, fixture: test })).issues).toEqual([
    "trace source missing: missing",
  ]);
});

it("rejects engine mismatch even if the fixture expects that setup error", async () => {
  const test = {
    ...fixture(),
    tokenizer: { name: "estimate", version: "unknown" },
    expected: { kind: "error" as const, code: "assembly.tokenizer_version_unsupported" },
  };
  const result = await runAssemblyFixture({ root, fixture: test });
  expect(result.ok).toBe(false);
  expect(result.error?.code).toBe("assembly.tokenizer_version_unsupported");
  const wrongEngine = await runAssemblyFixture({
    root,
    fixture: { ...test, assembler: { name: ASSEMBLER.name, version: "future" } },
  });
  expect(wrongEngine.error?.code).toBe("assembly.assembler_version_unsupported");
});

const presetCreation: CreationInput = {
  id: "cr_01h455vb4pex5vsknk084sn002",
  ref: "@test/preset",
  type: "preset",
  display_name: "Preset",
  meta,
  policy: {
    version: "0-draft",
    blocks: [{ id: "rules", position: "main", text: "Describe only observable actions." }],
    layout: [...PRESET_REGIONS],
    requires: { system_role: true },
  },
};
const presetRelease: ReleaseInput = {
  release: "rel_01h455vb4pex5vsknk084sn002",
  visibility: "public",
  creation: presetCreation,
};
const presetPin = {
  ref: presetCreation.ref,
  release: presetRelease.release,
  semantic_digest: canonicalizeCreation(presetCreation).semantic_digest,
};

describe("locked scenario execution", () => {
  it("uses exact policy and engine configuration with caller-owned Session", async () => {
    const assembly = {
      version: "0-draft" as const,
      preset: presetPin,
      profile,
      assembler: ASSEMBLER,
      tokenizer: { name: "estimate", version: TOKENIZER_VERSIONS.estimate },
    };
    const artifact = buildCreation({
      root: { ...root, creation: { ...creation, assembly } },
      dependencies: [presetRelease],
    }).artifact;
    const result = await assembleArtifact({ artifact, session });
    expect(result.messages[0]?.content).toBe("Describe only observable actions.");
    expect(result.trace.preset?.semantic_digest).toBe(presetPin.semantic_digest);
    if (artifact.kind !== "content" || !artifact.assembly) throw new Error("assembly required");
    expect(digestAssemblyMessages(result.messages)).toBe(
      digestAssemblyMessages(
        assemble({
          ir: artifact.ir,
          preset: artifact.assembly.preset,
          profile,
          session,
          counter: estimateCounter,
        }).messages,
      ),
    );
  });
  it("matches expected assembly errors and rejects changed or missing pins", async () => {
    const test = {
      ...fixture(),
      preset: presetPin,
      profile: { ...profile, capabilities: {} },
      expected: { kind: "error" as const, code: "assemble.preset_incompatible" },
    };
    expect(
      (await runAssemblyFixture({ root, dependencies: [presetRelease], fixture: test })).ok,
    ).toBe(true);
    expect((await runAssemblyFixture({ root, fixture: test })).error?.code).toBe(
      "assembly.release_missing",
    );
    expect(
      (
        await runAssemblyFixture({
          root,
          dependencies: [presetRelease],
          fixture: {
            ...test,
            preset: { ...presetPin, semantic_digest: `sha256:${"f".repeat(64)}` },
          },
        })
      ).error?.code,
    ).toBe("assembly.pin_mismatch");
  });
  it("runs fixtures attached to a preset against an exact external scenario", async () => {
    const scenarioPin = {
      ref: creation.ref,
      release,
      semantic_digest: canonicalizeCreation(creation).semantic_digest,
    };
    const test = {
      ...fixture(),
      root: scenarioPin,
      preset: "self" as const,
      profile: { ...profile, capabilities: {} },
      expected: { kind: "error" as const, code: "assemble.preset_incompatible" },
    };
    const report = await runAssemblyTests({
      root: { ...presetRelease, creation: { ...presetCreation, assembly_tests: [test] } },
      dependencies: [root],
    });
    expect(report.ok).toBe(true);
    expect(report.results).toHaveLength(1);
  });
});

it("compares attachment content identity independently of deployment URLs", () => {
  const message = {
    role: "system" as const,
    content: "A view",
    source: ["picture"],
    attachments: [
      {
        asset: "picture",
        media_type: "image/png",
        digest: `sha256:${"a".repeat(64)}`,
        url: "https://first.example/image",
      },
    ],
  };
  const elsewhere = {
    ...message,
    attachments: message.attachments.map((attachment) => ({
      ...attachment,
      url: "https://second.example/signed",
    })),
  };
  const offline = {
    ...message,
    attachments: message.attachments.map(({ url: _, ...attachment }) => attachment),
  };
  expect(digestAssemblyMessages([message])).toBe(digestAssemblyMessages([elsewhere]));
  expect(digestAssemblyMessages([message])).toBe(digestAssemblyMessages([offline]));
  const changed = {
    ...message,
    attachments: message.attachments.map((attachment) => ({
      ...attachment,
      digest: `sha256:${"b".repeat(64)}`,
    })),
  };
  expect(digestAssemblyMessages([message])).not.toBe(digestAssemblyMessages([changed]));
});
