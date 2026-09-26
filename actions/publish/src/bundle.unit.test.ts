import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("runs the committed distribution with isolated vendors and writes runner outputs", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "char-action-bundle-"));
  try {
    const file = path.join(dir, "char.yaml");
    const output = path.join(dir, "output");
    await writeFile(output, "");
    await writeFile(
      file,
      `ref: "@djj/alice"
type: character
display_name: Alice
fragments:
  - { id: description, kind: character, content: { type: text, text: "{{self}} is a courier." } }
meta: { default_locale: en, rating: general, rights: original, license: CC-BY-4.0 }
`,
    );
    const result = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
      {
        cwd: dir,
        env: {
          ...process.env,
          INPUT_PATH: file,
          "INPUT_DRY-RUN": "true",
          INPUT_DEPENDENCIES: "",
          INPUT_LABEL: "1.2.0",
          GITHUB_SHA: "a".repeat(40),
          GITHUB_EVENT_NAME: "push",
          GITHUB_REF_TYPE: "tag",
          GITHUB_REF_NAME: "v1.2.0",
          GITHUB_OUTPUT: output,
        },
      },
    );
    expect(result.stdout).toContain("dry run: not publishing");
    expect(await readFile(output, "utf8")).toMatch(
      /semantic-digest<<char_pub_[a-f0-9-]+\r?\nsha256:[a-f0-9]{64}/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
