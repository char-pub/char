import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cmdBuild, cmdCheck, cmdInit, cmdPreview, type Output } from "../src/commands.js";
import { generateFragmentIds, loadCharYaml, placeholderCreationId } from "../src/project.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "char-cli-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function capture(): Output & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, log: (l) => out.push(l), error: (l) => err.push(l) };
}

const YAML_NO_IDS = `# Alice
ref: "@djj/alice"
type: character
display_name: Alice
fragments:
  - kind: character
    content: { type: text, text: ./description.md }
  - kind: knowledge
    content: { type: text, text: "Arasaka is a megacorp." }
    activation: { mode: keyword, keys: [Arasaka] }
  - kind: knowledge
    content: { type: text, text: "荒坂是一家公司。" }
meta: { default_locale: en, rating: general, rights: original, license: CC-BY-4.0 }
`;

describe("init", () => {
  it("creates a character project that passes check and build", async () => {
    const o = capture();
    expect(await cmdInit({ dir, ref: "@djj/alice", type: "character", name: "Alice" }, o)).toBe(0);
    const file = path.join(dir, "char.yaml");
    expect(await cmdCheck({ file }, o)).toBe(0);
    expect(o.out.at(-1)).toMatch(/^ok {2}@djj\/alice {2}sha256:/);
    expect(await cmdBuild({ file, outDir: path.join(dir, "dist") }, o)).toBe(0);
    const ir = JSON.parse(await readFile(path.join(dir, "dist", "context-ir.json"), "utf8"));
    expect(ir.fragments[0].content.text).toBe("Alice is ...\n");
    // 再次 init 不能覆盖已有文件。
    expect(await cmdInit({ dir, ref: "@djj/alice", type: "character", name: "Alice" }, o)).toBe(1);
  });

  it.each(["world", "lorebook"] as const)(
    "creates a %s project that passes check",
    async (type) => {
      const o = capture();
      expect(await cmdInit({ dir, ref: "@djj/thing", type, name: "Thing" }, o)).toBe(0);
      expect(await cmdCheck({ file: path.join(dir, "char.yaml") }, o)).toBe(0);
    },
  );
});

describe("check --fix", () => {
  it("reports missing ids without --fix, then writes stable ids back and is idempotent", async () => {
    const file = path.join(dir, "char.yaml");
    await writeFile(file, YAML_NO_IDS);
    await writeFile(path.join(dir, "description.md"), "{{self}} is a courier.\n");
    const o = capture();
    expect(await cmdCheck({ file }, o)).toBe(1);
    expect(o.err).toHaveLength(3);

    expect(await cmdCheck({ file, fix: true }, o)).toBe(0);
    const written = await readFile(file, "utf8");
    expect(written).toContain("# Alice");
    expect(written).toMatch(/id: character\/self-is-a-courier/);
    expect(written).toMatch(/id: lore\/arasaka-is-a-megacorp/);
    expect(written).toMatch(/id: lore\/[0-9a-f]{8}\n/);

    const again = capture();
    expect(await cmdCheck({ file, fix: true }, again)).toBe(0);
    expect(await readFile(file, "utf8")).toBe(written);
  });

  it("generates unique ids when titles collide", () => {
    const ids = generateFragmentIds(
      [
        { id: "lore/tea", kind: "knowledge", content: { text: "tea" } },
        { kind: "knowledge", content: { text: "tea" } },
        { kind: "knowledge", content: { text: "tea" } },
      ],
      [1, 2],
    );
    expect([...ids.values()]).toEqual(["lore/tea-2", "lore/tea-3"]);
  });
});

describe("safety of char.yaml", () => {
  it("rejects includes outside the project root", async () => {
    const sub = path.join(dir, "project");
    await writeFile(path.join(dir, "secret.md"), "top secret");
    await import("node:fs/promises").then((fs) => fs.mkdir(sub));
    const file = path.join(sub, "char.yaml");
    await writeFile(
      file,
      YAML_NO_IDS.replace("./description.md", "./../secret.md").replaceAll(
        "  - kind",
        "  - id: x\n    kind",
      ),
    );
    const o = capture();
    expect(await cmdCheck({ file }, o)).toBe(1);
    expect(o.err.join("\n")).toContain("cli.include_outside_project");
  });

  it("rejects custom tags, duplicate keys and alias bombs", async () => {
    const file = path.join(dir, "char.yaml");
    const o = capture();
    await writeFile(file, "ref: !!js/function 'x'\n");
    expect(await cmdCheck({ file }, o)).toBe(1);
    await writeFile(file, "ref: a\nref: b\n");
    expect(await cmdCheck({ file }, o)).toBe(1);
    const bomb = [
      "a: &a [x, x, x, x, x, x, x, x, x, x]",
      "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]",
      "c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]",
      "d: &d [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]",
    ].join("\n");
    await writeFile(file, bomb);
    await expect(loadCharYaml(file)).rejects.toThrow();
    await writeFile(file, "- not an object\n");
    expect(await cmdCheck({ file }, o)).toBe(1);
    expect(o.err.join("\n")).toContain("cli.yaml_not_object");
  });

  it("reports schema errors with codes instead of crashing", async () => {
    const file = path.join(dir, "char.yaml");
    await writeFile(file, 'ref: "@DJJ/Alice"\ntype: character\n');
    const o = capture();
    expect(await cmdCheck({ file }, o)).toBe(1);
    expect(o.err[0]).toMatch(/^error {2}schema\.invalid/);
  });

  it("derives a deterministic placeholder id from the ref", () => {
    expect(placeholderCreationId("@djj/alice")).toBe(placeholderCreationId("@djj/alice"));
    expect(placeholderCreationId("@djj/alice")).toMatch(/^cr_0[0-9a-hjkmnp-tv-z]{25}$/);
    expect(placeholderCreationId("@djj/bob")).not.toBe(placeholderCreationId("@djj/alice"));
  });
});

describe("build and preview", () => {
  async function project(text: string) {
    const file = path.join(dir, "char.yaml");
    await writeFile(file, text);
    return file;
  }

  it("refuses to build before ids are fixed, and fails on check errors", async () => {
    const o = capture();
    const file = await project(YAML_NO_IDS);
    await writeFile(path.join(dir, "description.md"), "x");
    expect(await cmdBuild({ file, outDir: path.join(dir, "dist") }, o)).toBe(1);
    expect(o.err[0]).toContain("check.missing_fragment_id");

    const bad = await project(
      'ref: "@djj/w"\ntype: world\ndisplay_name: W\nfragments: [{ id: x, kind: knowledge, content: { type: text, text: hi } }]\nmeta: { default_locale: en, rating: general, rights: original, license: CC0-1.0 }\n',
    );
    expect(await cmdBuild({ file: bad, outDir: path.join(dir, "dist") }, o)).toBe(1);
    expect(o.err.at(-1)).toContain("check.type_requirement");
  });

  it("builds with a local dependency snapshot and previews the trace", async () => {
    const world = {
      release: "rel_01h455vb4pex5vsknk084sn0w1",
      visibility: "public",
      creation: {
        id: "cr_01h455vb4pex5vsknk084sn0w1",
        ref: "@cyberpunk/night-city",
        type: "world",
        display_name: "Night City",
        fragments: [
          {
            id: "world",
            stable: true,
            kind: "world",
            content: { type: "text", text: "A megacity." },
          },
        ],
        meta: { default_locale: "en", rating: "mature", rights: "original", license: "CC-BY-4.0" },
      },
    };
    const { canonicalizeCreation } = await import("@char-pub/core");
    const digest = canonicalizeCreation(world.creation).semantic_digest;
    const depFile = path.join(dir, "night-city.json");
    await writeFile(depFile, JSON.stringify(world));
    const file = await project(`ref: "@djj/alice"
type: character
display_name: Alice
fragments:
  - { id: description, kind: character, content: { type: text, text: "{{self}} lives here." } }
  - { id: lore/arasaka, kind: knowledge, content: { type: text, text: "Arasaka." }, activation: { mode: keyword, keys: [Arasaka] } }
references:
  - id: lives-in
    use: "@cyberpunk/night-city"
    mode: intrinsic
    pin: { release: ${world.release}, semantic_digest: "${digest}" }
meta: { default_locale: en, rating: general, rights: original, license: CC-BY-4.0 }
`);
    const o = capture();
    expect(await cmdBuild({ file, deps: [depFile], outDir: path.join(dir, "dist") }, o)).toBe(0);
    const ir = JSON.parse(await readFile(path.join(dir, "dist", "context-ir.json"), "utf8"));
    expect(ir.meta.rating).toBe("mature");
    const lock = JSON.parse(await readFile(path.join(dir, "dist", "lock.json"), "utf8"));
    expect(lock[0].ref).toBe("@cyberpunk/night-city");

    const p = capture();
    const code = await cmdPreview(
      {
        file,
        deps: [depFile],
        tokenizer: "estimate",
        contextWindow: 4096,
        mode: "narrator",
        persona: "Sam",
        messages: ["Tell me about Arasaka"],
      },
      p,
    );
    expect(code).toBe(0);
    expect(p.out[0]).toMatch(/^Context Preview · \d+ tokens · tokenizer: estimate \(estimate\)$/);
    const body = p.out.join("\n");
    expect(body).toMatch(/included\s+always\s+\d+\s+@djj\/alice#description~root/);
    expect(body).toMatch(/included\s+keyword:Arasaka/);
    expect(body).toContain("via: lives-in");
  });

  it("reports preview errors such as an unfixable build", async () => {
    const file = await project(YAML_NO_IDS);
    await writeFile(path.join(dir, "description.md"), "x");
    const o = capture();
    expect(
      await cmdPreview(
        {
          file,
          tokenizer: "estimate",
          contextWindow: 100,
          mode: "narrator",
          persona: "Sam",
          messages: [],
        },
        o,
      ),
    ).toBe(1);
  });
});
