import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ASSEMBLER, TOKENIZER_VERSIONS } from "@char-pub/assembler";
import {
  CreationArtifactSchema,
  canonicalizeCreation,
  PRESET_REGIONS,
  sha256Bytes,
} from "@char-pub/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_DEFAULT_POLICY } from "../../core/test/build.js";
import { buildLocal, cmdBuild, cmdPreview, cmdTest, type Output } from "../src/commands.js";

let dir: string;
let defaultPolicy: string;
const meta = TEST_DEFAULT_POLICY.creation.meta;
const character = {
  id: "cr_01h455vb4pex5vsknk084sn001",
  ref: "@local/hero",
  type: "character",
  display_name: "Hero",
  meta,
  fragments: [
    {
      id: "description",
      stable: true,
      kind: "character",
      content: { type: "text", text: "LOCAL_HERO_BODY" },
    },
  ],
};
const published = {
  release: "rel_01h455vb4pex5vsknk084sn001",
  visibility: "public",
  creation: character,
};
const pin = {
  ref: character.ref,
  release: published.release,
  semantic_digest: canonicalizeCreation(character).semantic_digest,
};
const policy = {
  ref: "@local/policy",
  type: "preset",
  display_name: "Local policy",
  meta,
  policy: {
    version: "1-draft",
    blocks: [{ id: "main", text: "LOCAL_POLICY_BODY", default_at: "main" }],
    layout: [...PRESET_REGIONS],
    requires: { system_role: true },
  },
};
const profile = {
  runtime: { name: "cli-fixture", version: "1" },
  tokenizer: "estimate",
  context_window: 4096,
  reserve_for_output: 256,
  mode: "narrator",
  capabilities: { system_role: true, multiple_system_messages: true },
};
const fixture = {
  id: "self-test",
  root: "self",
  profile,
  session: { bindings: { user: { kind: "persona", display_name: "Reader" } }, history: [] },
  assembler: ASSEMBLER,
  tokenizer: { name: "estimate", version: TOKENIZER_VERSIONS.estimate },
  expected: {
    kind: "success",
    trace: [{ source: "@local/hero#description~root", included: true }],
  },
};
function capture(): Output & { out: string[]; err: string[] } {
  const out: string[] = [],
    err: string[] = [];
  return { out, err, log: (line) => out.push(line), error: (line) => err.push(line) };
}
async function jsonFile(name: string, value: unknown) {
  const file = path.join(dir, name);
  await writeFile(file, JSON.stringify(value));
  return file;
}
const preview = (file: string) => ({
  file,
  defaultPolicy,
  tokenizer: "estimate" as const,
  contextWindow: 4096,
  mode: "narrator" as const,
  persona: "Reader",
  messages: ["Hello"],
});
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "char-local-build-"));
  defaultPolicy = await jsonFile("default-policy.json", TEST_DEFAULT_POLICY);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("CLI local compilation receipts", () => {
  it.each([
    { name: "character", creation: character, extra: "context-ir.json" },
    { name: "preset", creation: policy, extra: "preset.json" },
    {
      name: "module",
      creation: {
        ref: "@local/module",
        type: "prompt-module",
        display_name: "Module",
        meta,
        prompt_module: {
          version: "1-draft",
          blocks: [{ id: "detail", text: "LOCAL_MODULE_BODY", default_at: "main" }],
        },
      },
      extra: "prompt-module.json",
    },
  ])(
    "writes honest $name artifacts and reproducible bytes independently of paths",
    async ({ creation, extra }) => {
      const file = await jsonFile("char.yaml", creation);
      const copy = await jsonFile("moved.yaml", creation);
      const first = path.join(dir, "first"),
        second = path.join(dir, "second");
      const output = capture();
      expect(
        await cmdBuild({ file, defaultPolicy, outDir: first }, output),
        output.err.join("\n"),
      ).toBe(0);
      expect(
        await cmdBuild({ file: copy, defaultPolicy, outDir: second }, output),
        output.err.join("\n"),
      ).toBe(0);
      const bytes = await readFile(path.join(first, "artifact.json"), "utf8");
      expect(await readFile(path.join(second, "artifact.json"), "utf8")).toBe(bytes);
      const artifact = CreationArtifactSchema.parse(JSON.parse(bytes));
      expect(artifact.root).not.toHaveProperty("release");
      expect(artifact.root).toHaveProperty("origin.kind", "local-build");
      expect(artifact.root).toHaveProperty(
        "origin.input_digest",
        expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      );
      expect(bytes).not.toMatch(/rel_00000000000000000000000000|dbld_|rev_/);
      const resolved = JSON.parse(await readFile(path.join(first, extra), "utf8"));
      expect(extra === "context-ir.json" ? resolved.root.origin : resolved.origin).toEqual(
        "origin" in artifact.root ? artifact.root.origin : undefined,
      );
      expect(artifact.lock.every((entry) => entry.release === TEST_DEFAULT_POLICY.release)).toBe(
        true,
      );
      if (artifact.kind === "content")
        expect(artifact.ir.fragments[0]?.origin).toHaveProperty(
          "origin",
          "origin" in artifact.root ? artifact.root.origin : undefined,
        );
      else {
        const blocks =
          artifact.kind === "preset" ? artifact.preset.policy.blocks : artifact.module.blocks;
        expect(blocks[0]?.origin).toHaveProperty(
          "origin",
          "origin" in artifact.root ? artifact.root.origin : undefined,
        );
      }
    },
  );

  it("previews a local character with an independently built local Preset", async () => {
    const file = await jsonFile("char.yaml", character);
    const preset = await jsonFile("policy.yaml", policy);
    const output = capture();
    expect(await cmdPreview({ ...preview(file), preset }, output), output.err.join("\n")).toBe(0);
    expect(output.out.join("\n")).toContain("[system] LOCAL_POLICY_BODY");
    expect(output.out.join("\n")).toContain("LOCAL_HERO_BODY");
    expect(output.out.join("\n")).toContain("[user] Hello");
    const content = await buildLocal(file, [], defaultPolicy),
      selected = await buildLocal(preset);
    expect(content.artifact.root).not.toEqual(selected.artifact.root);
  });

  it("runs self content fixtures and local Preset fixtures over a published content root", async () => {
    const dependency = await jsonFile("hero-release.json", published);
    const selfFixture = {
      ...fixture,
      expected: {
        kind: "success",
        trace: [{ source: "@local/scene#setting~root", included: true }],
      },
    };
    const file = await jsonFile("char.yaml", {
      ref: "@local/scene",
      type: "scenario",
      display_name: "Scene",
      meta,
      references: [
        {
          id: "hero",
          use: pin.ref,
          mode: "default",
          pin: { release: pin.release, semantic_digest: pin.semantic_digest },
        },
      ],
      cast: [{ key: "hero", who: pin.ref }],
      fragments: [
        { id: "setting", kind: "scenario", content: { type: "text", text: "LOCAL_SCENE_BODY" } },
      ],
      assembly_tests: [selfFixture],
    });
    const output = capture();
    expect(
      await cmdTest({ file, deps: [dependency], defaultPolicy }, output),
      output.err.join("\n"),
    ).toBe(0);
    expect(output.out[0]).toMatch(/^PASS self-test sha256:/);
    const presetFile = await jsonFile("policy.yaml", {
      ...policy,
      assembly_tests: [{ ...fixture, root: pin, preset: "self" }],
    });
    const presetOutput = capture();
    expect(
      await cmdTest({ file: presetFile, deps: [dependency], defaultPolicy }, presetOutput),
      presetOutput.err.join("\n"),
    ).toBe(0);
    expect(presetOutput.out[0]).toMatch(/^PASS self-test sha256:/);
    expect(JSON.parse(await readFile(file, "utf8")).assembly_tests[0].expected).toEqual(
      selfFixture.expected,
    );
  });

  it("rejects a local root snapshot as a dependency or default-policy Release", async () => {
    const file = await jsonFile("char.yaml", character);
    const preset = await jsonFile("policy.yaml", policy);
    const local = await buildLocal(preset);
    const snapshot = await jsonFile("local-snapshot.json", local.root);
    for (const options of [{ deps: [snapshot], defaultPolicy }, { defaultPolicy: snapshot }]) {
      const output = capture();
      expect(await cmdBuild({ file, outDir: path.join(dir, "rejected"), ...options }, output)).toBe(
        1,
      );
      expect(output.err.join("\n")).toContain("build.release_required");
    }
  });

  it("validates local Source bytes before normalizing BOM and CRLF for preview", async () => {
    const text = "\uFEFF# Guide\r\nSOURCE_ORIGINAL_BYTES\r\n";
    const bytes = new TextEncoder().encode(text);
    const dependency = await jsonFile("hero-release.json", published);
    const file = await jsonFile("char.yaml", {
      ref: "@local/scene",
      type: "scenario",
      display_name: "Scene",
      meta,
      references: [
        {
          id: "hero",
          use: pin.ref,
          mode: "default",
          pin: { release: pin.release, semantic_digest: pin.semantic_digest },
        },
      ],
      cast: [{ key: "hero", who: pin.ref }],
      sources: [
        {
          id: "guide",
          title: "Guide",
          description: "A source for the scene",
          asset: "guide",
          format: "markdown",
          visibility: { scope: "shared" },
        },
      ],
      assets: [
        {
          slot: "guide",
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
      story: { version: 1, scenes: [{ id: "room", title: "Room", lore: ["#guide"] }] },
    });
    const built = await buildLocal(file, [dependency], defaultPolicy);
    if (built.artifact.kind !== "content") throw new Error("content required");
    const source = built.artifact.catalog_index.sources[0];
    if (!source) throw new Error("source required");
    const sourceTexts = await jsonFile("source-texts.json", { [source.asset]: text });
    const output = capture();
    expect(
      await cmdPreview({ ...preview(file), deps: [dependency], sourceTexts }, output),
      output.err.join("\n"),
    ).toBe(0);
    expect(output.out.join("\n")).toContain("SOURCE_ORIGINAL_BYTES");
    await writeFile(
      sourceTexts,
      JSON.stringify({ [source.asset]: text.replace(/\r/g, "").slice(1) }),
    );
    const altered = capture();
    expect(await cmdPreview({ ...preview(file), deps: [dependency], sourceTexts }, altered)).toBe(
      1,
    );
    expect(altered.err.join("\n")).toContain("source.asset_mismatch");
  });
});
