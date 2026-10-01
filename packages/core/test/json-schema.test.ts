import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { canonicalizeCreation } from "../src/canonical.js";
import {
  PUBLISHED_SCHEMAS,
  type PublishedSchemaName,
  renderJsonSchema,
} from "../src/json-schema.js";
import { PRESET_REGIONS } from "../src/schema/policy.js";
import { buildTestCreation } from "./build.js";
import { level0Character, tid } from "./fixtures.js";

const specDir = join(dirname(fileURLToPath(import.meta.url)), "../../../spec/schema");
const names = Object.keys(PUBLISHED_SCHEMAS) as PublishedSchemaName[];

function committed(name: PublishedSchemaName): string {
  return readFileSync(join(specDir, `${name}.schema.json`), "utf8");
}

describe("published JSON Schema", () => {
  it("requires a fixed policy and version 1 in the public artifact schema", () => {
    const validate = new Ajv2020({ strict: false }).compile(
      JSON.parse(committed("creation-artifact")),
    );
    const { artifact } = buildTestCreation({
      root: { creation: level0Character(), release: tid("rel", 1), visibility: "public" },
    });
    expect(validate(artifact)).toBe(true);
    const withoutCapabilities = JSON.parse(JSON.stringify(artifact));
    delete withoutCapabilities.capabilities;
    expect(validate(withoutCapabilities)).toBe(false);
    expect(validate({ ...artifact, capabilities: [{ id: "story.v1", experimental: false }] })).toBe(
      false,
    );
    const missing = JSON.parse(JSON.stringify(artifact));
    delete missing.default_policy;
    expect(validate(missing)).toBe(false);
    expect(validate({ ...artifact, version: "0-draft" })).toBe(false);
  });
  it.each(names)("spec/schema/%s.schema.json matches the zod definition", (name) => {
    // 不一致时运行 `pnpm schema:export` 重新生成，并 review 生成的 diff。
    expect(committed(name)).toBe(renderJsonSchema(name));
  });

  it.each(names)("%s is a valid draft 2020-12 schema", (name) => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    expect(() => ajv.compile(JSON.parse(committed(name)))).not.toThrow();
  });

  describe("creation schema accepts and rejects the same things as zod", () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    const validate = ajv.compile(JSON.parse(committed("creation")));

    it("allows author tests on every Creative type while keeping module and self-Preset boundaries", () => {
      const fixture = {
        id: "preview",
        root: "self",
        profile: {
          runtime: { name: "test", version: "1" },
          tokenizer: "estimate",
          context_window: 4096,
          reserve_for_output: 256,
          capabilities: { images: false, system_role: true, multiple_system_messages: true },
          mode: "narrator",
        },
        session: { history: [], bindings: {} },
        assembler: { name: "@char-pub/assembler", version: "0.0.0" },
        tokenizer: { name: "estimate", version: "1" },
        expected: { kind: "error", code: "example.error" },
      };
      for (const type of [
        "character",
        "world",
        "lorebook",
        "scenario",
        "persona",
        "style",
        "relationship",
      ] as const) {
        const input = { ...level0Character(), type, assembly_tests: [fixture] };
        expect(validate(input), JSON.stringify(validate.errors)).toBe(true);
        expect(() => canonicalizeCreation(input)).not.toThrow();
        expect(validate({ ...input, assembly_tests: [{ ...fixture, preset: "self" }] })).toBe(
          false,
        );
      }
      const module = {
        ...level0Character(),
        type: "prompt-module",
        fragments: [],
        bootstrap: undefined,
        prompt_module: {
          version: "1-draft",
          blocks: [{ id: "main", text: "Tell a story", default_at: "main" }],
        },
        assembly_tests: [fixture],
      };
      expect(validate(module)).toBe(false);
      expect(() => canonicalizeCreation(module)).toThrow();
    });

    it("accepts the Level 0 character, in both written and canonical form", () => {
      const input = level0Character();
      expect(validate(input)).toBe(true);
      expect(validate(canonicalizeCreation(input).json)).toBe(true);
    });

    it("expresses Preset domain boundaries and complete layouts in the published schema", () => {
      const input = {
        ...level0Character({ type: "preset", fragments: [], bootstrap: undefined }),
        policy: {
          version: "1-draft",
          blocks: [{ id: "main", text: "Narrate", default_at: "main" }],
          layout: [...PRESET_REGIONS],
          requires: { system_role: true },
        },
      };
      expect(validate(input)).toBe(true);
      expect(validate(canonicalizeCreation(input).json)).toBe(true);
      expect(validate({ ...input, policy: undefined })).toBe(false);
      expect(validate({ ...input, type: "character" })).toBe(false);
      expect(validate({ ...input, fragments: level0Character().fragments })).toBe(false);
      expect(
        validate({
          ...input,
          policy: { ...input.policy, layout: PRESET_REGIONS.map(() => "history") },
        }),
      ).toBe(false);
      expect(
        validate({
          ...input,
          policy: { ...input.policy, blocks: [{ id: "main", text: "  ", default_at: "main" }] },
        }),
      ).toBe(false);
      expect(
        validate({ ...input, policy: { ...input.policy, region_budgets: { history: 5 } } }),
      ).toBe(false);
    });

    it.each([
      ["an unknown field", { ...level0Character(), extra: 1 }],
      ["an uppercase namespace", level0Character({ ref: "@DJJ/alice" })],
      ["a malformed creation id", level0Character({ id: tid("rel", 1) })],
      [
        "an unknown fragment kind",
        level0Character({
          fragments: [
            {
              id: "x",
              stable: true,
              kind: "memory" as never,
              content: { type: "text", text: "x" },
            },
          ],
        }),
      ],
      [
        "a malformed digest",
        level0Character({
          fragments: [
            {
              id: "x",
              stable: true,
              kind: "character",
              content: { type: "text", text: "x" },
              digest: "sha256:XYZ",
            },
          ],
        }),
      ],
    ])("rejects %s", (_name, input) => {
      expect(validate(input)).toBe(false);
    });
  });
});
