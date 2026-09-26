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
import { level0Character, tid } from "./fixtures.js";

const specDir = join(dirname(fileURLToPath(import.meta.url)), "../../../spec/schema");
const names = Object.keys(PUBLISHED_SCHEMAS) as PublishedSchemaName[];

function committed(name: PublishedSchemaName): string {
  return readFileSync(join(specDir, `${name}.schema.json`), "utf8");
}

describe("published JSON Schema", () => {
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

    it("accepts the Level 0 character, in both written and canonical form", () => {
      const input = level0Character();
      expect(validate(input)).toBe(true);
      expect(validate(canonicalizeCreation(input).json)).toBe(true);
    });

    it("expresses Preset domain boundaries and complete layouts in the published schema", () => {
      const input = {
        ...level0Character({ type: "preset", fragments: [], bootstrap: undefined }),
        policy: {
          version: "0-draft",
          blocks: [{ id: "main", text: "Narrate", position: "main" }],
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
          policy: { ...input.policy, blocks: [{ id: "main", text: "  ", position: "main" }] },
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
