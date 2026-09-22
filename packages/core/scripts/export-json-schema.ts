/** 把 core 的 zod schema 导出为 `spec/schema/*.schema.json`。用法：`pnpm schema:export`。 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PUBLISHED_SCHEMAS,
  type PublishedSchemaName,
  renderJsonSchema,
} from "../src/json-schema.js";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "../../../spec/schema");
mkdirSync(outDir, { recursive: true });
for (const name of Object.keys(PUBLISHED_SCHEMAS) as PublishedSchemaName[]) {
  const file = join(outDir, `${name}.schema.json`);
  writeFileSync(file, renderJsonSchema(name));
  console.log(`wrote ${file}`);
}
