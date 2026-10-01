/** Build a local SDK snapshot for independent consumers; never publishes to a registry. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const destination = process.argv[2];
if (!destination || process.argv.length !== 3) {
  throw new Error("Usage: node scripts/pack-runtime-sdk.mjs <new-output-directory>");
}
const out = resolve(destination);
// Refuse to overwrite an earlier snapshot: each manifest identifies immutable tarball bytes.
await mkdir(out, { recursive: false });
const run = (args, cwd = root) => execFileSync("pnpm", args, { cwd, encoding: "utf8" });
run(["exec", "tsc", "-b", "packages/core", "packages/assembler", "packages/contracts"]);
const packages = [];
for (const directory of ["core", "assembler", "contracts"]) {
  const cwd = resolve(root, "packages", directory);
  const manifest = JSON.parse(await readFile(resolve(cwd, "package.json"), "utf8"));
  run(["pack", "--pack-destination", out], cwd);
  const file = `${manifest.name.replace(/^@/, "").replaceAll("/", "-")}-${manifest.version}.tgz`;
  const bytes = await readFile(resolve(out, file));
  packages.push({
    name: manifest.name,
    version: manifest.version,
    file,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    license: manifest.license,
  });
}
const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
await writeFile(
  resolve(out, "manifest.json"),
  `${JSON.stringify(
    {
      format: 1,
      source_revision: git(["rev-parse", "HEAD"]),
      source_dirty: git(["status", "--porcelain"]).length > 0,
      package_manager: run(["--version"]).trim(),
      packages,
    },
    null,
    2,
  )}\n`,
);
console.log(`SDK snapshot written to ${out}`);
