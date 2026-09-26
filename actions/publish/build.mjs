/** Keep dependency implementations separate from the first-party code CodeQL owns. */

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = import.meta.dirname;
const dist = path.join(root, "dist");
const vendor = path.join(dist, "vendor");
const dependencies = new Map([
  ["@actions/core", "actions-core"],
  ["zod", "zod"],
]);
const common = {
  absWorkingDir: root,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  legalComments: "linked",
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
};

await rm(dist, { recursive: true, force: true });
await mkdir(vendor, { recursive: true });
for (const [dependency, name] of dependencies) {
  const result = await build({
    ...common,
    entryPoints: [fileURLToPath(import.meta.resolve(dependency))],
    outfile: path.join(vendor, `${name}.js`),
    metafile: true,
  });
  // Fail closed if a dependency ever pulls workspace code into the scan exclusion.
  for (const input of Object.keys(result.metafile.inputs)) {
    if (!realpathSync(path.resolve(root, input)).split(path.sep).includes("node_modules")) {
      throw new Error(`first-party source must not enter the vendor bundle: ${input}`);
    }
  }
}
await build({
  ...common,
  entryPoints: ["src/index.ts"],
  outfile: path.join(dist, "index.js"),
  conditions: ["@char-pub/source"],
  plugins: [
    {
      name: "isolated-vendor-dependencies",
      setup(builder) {
        builder.onResolve({ filter: /^(?:@actions\/core|zod)$/ }, ({ path: dependency }) => ({
          path: `./vendor/${dependencies.get(dependency)}.js`,
          external: true,
        }));
      },
    },
  ],
});

if (process.argv.includes("--check")) {
  const gitOptions = { cwd: path.resolve(root, "../.."), encoding: "utf8" };
  // Compare with the index so the pre-commit hook accepts staged generated files.
  // Also catch new outputs: git diff alone cannot see an untracked vendor file.
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", "--", "actions/publish/dist"],
    gitOptions,
  );
  const untracked = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "--", "actions/publish/dist"],
    gitOptions,
  );
  if (changed.trim() || untracked.trim()) {
    throw new Error(
      `Action distribution is stale or untracked; rebuild and stage all generated files:\n${changed}${untracked}`,
    );
  }
}
