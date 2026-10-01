/** Exercise the real accept command in an isolated copied tool tree; never accept repository cases. */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { createDraftReviewReceipt } from "../runner/review.js";
import { renderDraft, runCase } from "../runner/run.js";
import type { BundledCase } from "../runner/types.js";
import { CONFORMANCE_ROOT } from "./cases.js";

it("refuses changed inputs before touching expected files, case review metadata or the bundle", () => {
  const temporary = mkdtempSync(join(tmpdir(), "conformance-accept-"));
  try {
    const root = join(temporary, "conformance");
    mkdirSync(join(root, "scripts"), { recursive: true });
    mkdirSync(join(root, "runner"));
    mkdirSync(join(root, "cases"));
    writeFileSync(join(root, "package.json"), '{"type":"module"}\n');
    symlinkSync(join(CONFORMANCE_ROOT, "node_modules"), join(root, "node_modules"), "dir");
    for (const file of ["accept.ts", "cases.ts"])
      cpSync(join(CONFORMANCE_ROOT, "scripts", file), join(root, "scripts", file));
    for (const file of ["run.ts", "types.ts", "story.ts", "review.ts", "assemble.ts", "ccv3.ts"])
      cpSync(join(CONFORMANCE_ROOT, "runner", file), join(root, "runner", file));
    const c: BundledCase = {
      dir: "201-isolated",
      meta: {
        id: "201-isolated",
        kind: "story",
        expect: "story",
        title: "Isolated",
        spec_refs: ["story-v1/14.2"],
        status: "draft",
      },
      input: {
        deps: [],
        story: {
          kind: "evaluation",
          story: { version: 1, scenes: [{ id: "room", title: "Room" }] },
          cast: [],
          operations: [{ op: "input", text: "Before" }],
        },
      },
      expected: {},
    };
    const base = join(root, "story-v1", c.dir);
    for (const dir of ["input", "draft", "expected"])
      mkdirSync(join(base, dir), { recursive: true });
    const meta = JSON.stringify(c.meta);
    writeFileSync(join(base, "case.json"), meta);
    const rendered = renderDraft(runCase(c));
    if (!rendered) throw new Error("candidate required");
    writeFileSync(join(base, "draft", "story.json"), rendered.text);
    writeFileSync(
      join(base, "draft", "review.json"),
      JSON.stringify(createDraftReviewReceipt(c, rendered)),
    );
    writeFileSync(join(base, "expected", "sentinel"), "DO NOT DELETE");
    if (c.input.story?.kind !== "evaluation") throw new Error("evaluation required");
    c.input.story.operations = [
      { op: "input", text: "After: same state output, different reviewed input" },
    ];
    expect(renderDraft(runCase(c))?.text).toBe(rendered.text);
    writeFileSync(join(base, "input", "story.json"), JSON.stringify(c.input.story));
    const command = () =>
      spawnSync(
        process.execPath,
        [
          "--import",
          fileURLToPath(import.meta.resolve("tsx/esm")),
          "--conditions=@char-pub/source",
          join(root, "scripts", "accept.ts"),
          c.dir,
          "--reviewer",
          "isolated-test",
        ],
        { cwd: root, encoding: "utf8" },
      );
    const stale = command();
    expect(stale.status, stale.stderr).toBe(1);
    expect(stale.stderr).toContain("cannot accept stale or invalid draft");
    expect(readFileSync(join(base, "expected", "sentinel"), "utf8")).toBe("DO NOT DELETE");
    expect(readFileSync(join(base, "case.json"), "utf8")).toBe(meta);
    expect(existsSync(join(base, "draft", "story.json"))).toBe(true);
    expect(existsSync(join(root, "runner", "cases.gen.json"))).toBe(false);
    rmSync(join(base, "draft", "review.json"));
    const missing = command();
    expect(missing.status, missing.stderr).toBe(1);
    expect(missing.stderr).toContain("Missing or invalid review receipt");
    expect(readFileSync(join(base, "expected", "sentinel"), "utf8")).toBe("DO NOT DELETE");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
