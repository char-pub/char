import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setOutput } from "./output.js";

const hook = vi.hoisted(() => ({ afterOpen: undefined as (() => void) | undefined }));
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    fstatSync: (fd: number) => {
      hook.afterOpen?.();
      return original.fstatSync(fd);
    },
  };
});
let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "char-action-output-"));
  file = path.join(dir, "output");
  await writeFile(file, "existing=yes\n");
});
afterEach(async () => {
  hook.afterOpen = undefined;
  await rm(dir, { recursive: true, force: true });
});

it("appends multiline values using a fresh delimiter instead of a workflow command", () => {
  setOutput("semantic-digest", "first\n::error::literal\nlast", file);
  const text = readFileSync(file, "utf8");
  expect(text).toMatch(
    /^existing=yes\nsemantic-digest<<(char_pub_[a-f0-9-]+)\r?\nfirst\n::error::literal\nlast\r?\n\1\r?\n$/,
  );
});
it("writes to the opened file even when its pathname is replaced after opening", () => {
  const opened = path.join(dir, "original");
  hook.afterOpen = () => {
    renameSync(file, opened);
    writeFileSync(file, "replacement");
  };
  setOutput("release", "rel_example", file);
  expect(readFileSync(file, "utf8")).toBe("replacement");
  expect(readFileSync(opened, "utf8")).toContain("rel_example");
});
it("refuses missing runner files and output names that could inject protocol lines", () => {
  expect(() => setOutput("release", "x", path.join(dir, "missing"))).toThrow();
  expect(() => setOutput("release\ninjected", "x", file)).toThrow("invalid output name");
  expect(readFileSync(file, "utf8")).toBe("existing=yes\n");
});
it.skipIf(process.platform === "win32")(
  "does not follow a symlink substituted for the runner file",
  async () => {
    const link = path.join(dir, "link");
    await symlink(file, link);
    expect(() => setOutput("release", "x", link)).toThrow();
    expect(readFileSync(file, "utf8")).toBe("existing=yes\n");
  },
);
