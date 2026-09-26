import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { createPinnedTokenCounter, TOKENIZER_VERSIONS } from "../src/tokens.js";

it("keeps reproducibility identities aligned with the installed implementations", async () => {
  const tokenx = JSON.parse(
    await readFile(new URL("../node_modules/tokenx/package.json", import.meta.url), "utf8"),
  );
  const gpt = JSON.parse(
    await readFile(new URL("../node_modules/gpt-tokenizer/package.json", import.meta.url), "utf8"),
  );
  expect(TOKENIZER_VERSIONS.estimate).toBe(`tokenx@${tokenx.version}`);
  expect(TOKENIZER_VERSIONS.o200k_base).toBe(`gpt-tokenizer@${gpt.version}`);
  expect(TOKENIZER_VERSIONS.cl100k_base).toBe(`gpt-tokenizer@${gpt.version}`);
});

it("loads each exact tokenizer under its pinned identity and rejects unknown names", async () => {
  for (const name of ["o200k_base", "cl100k_base"] as const) {
    const counter = await createPinnedTokenCounter({ name, version: TOKENIZER_VERSIONS[name] });
    expect(counter.tokenizer).toBe(name);
    expect(counter.estimated).toBe(false);
    expect(counter.count("你好, world.")).toBeGreaterThan(0);
  }
  await expect(createPinnedTokenCounter({ name: "unknown", version: "1" })).rejects.toMatchObject({
    code: "assembly.tokenizer_version_unsupported",
  });
});
