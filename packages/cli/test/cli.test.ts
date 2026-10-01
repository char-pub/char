import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ASSEMBLER, TOKENIZER_VERSIONS } from "@char-pub/assembler";
import { canonicalizeCreation } from "@char-pub/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_DEFAULT_PIN, TEST_DEFAULT_POLICY } from "../../core/test/build.js";
import {
  cmdCheck,
  cmdInit,
  type Output,
  cmdBuild as rawBuild,
  cmdPreview as rawPreview,
  cmdTest as rawTest,
} from "../src/commands.js";
import {
  generateFragmentIds,
  loadCharYaml,
  parseCharYaml,
  placeholderCreationId,
} from "../src/project.js";

let dir: string;
const cmdBuild = (input: Parameters<typeof rawBuild>[0], output: Output) =>
  rawBuild({ defaultPolicy: path.join(dir, "default-policy.json"), ...input }, output);
const cmdPreview = (input: Parameters<typeof rawPreview>[0], output: Output) =>
  rawPreview({ defaultPolicy: path.join(dir, "default-policy.json"), ...input }, output);
const cmdTest = (input: Parameters<typeof rawTest>[0], output: Output) =>
  rawTest({ defaultPolicy: path.join(dir, "default-policy.json"), ...input }, output);
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "char-cli-"));
  await writeFile(path.join(dir, "default-policy.json"), JSON.stringify(TEST_DEFAULT_POLICY));
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

  it.each([
    "world",
    "lorebook",
    "persona",
    "style",
    "relationship",
    "scenario",
    "preset",
    "prompt-module",
  ] as const)("creates a %s project that passes check", async (type) => {
    const o = capture();
    expect(await cmdInit({ dir, ref: "@djj/thing", type, name: "Thing" }, o)).toBe(0);
    expect(await cmdCheck({ file: path.join(dir, "char.yaml") }, o)).toBe(0);
    expect(
      await cmdBuild({ file: path.join(dir, "char.yaml"), outDir: path.join(dir, "dist") }, o),
    ).toBe(0);
    const artifact = JSON.parse(await readFile(path.join(dir, "dist", "artifact.json"), "utf8"));
    expect(artifact.kind).toBe(type === "preset" || type === "prompt-module" ? type : "content");
  });
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
  it("expands localized Story prose without following source provenance or structured data paths", async () => {
    const reads: string[] = [];
    const data = {
      ref: "@djj/prose",
      type: "scenario",
      display_name: "Prose",
      fragments: [
        {
          kind: "knowledge",
          content: { type: "structured", schema: "test/data", data: { text: "./payload.md" } },
        },
      ],
      story: {
        version: 1,
        scenes: [{ id: "lobby", title: "Lobby", opening: { en: "./opening.md" } }],
        starts: [{ id: "start", greeting: { ref: "./literal.md" } }],
      },
      sources: [{ id: "book", origin: { note: "./origin.md" } }],
      assets: [
        {
          slot: "book",
          variants: [
            {
              blob: {
                locator: { provider: "http", path: "./book.md", url: "https://example.com/book" },
              },
            },
          ],
        },
      ],
    };
    const parsed = await parseCharYaml(
      new TextEncoder().encode(JSON.stringify(data)),
      "char.yaml",
      async (file) => {
        reads.push(file);
        return new TextEncoder().encode("Included prose");
      },
    );
    expect(reads).toEqual(["opening.md"]);
    expect(JSON.stringify(parsed.creation)).toContain("Included prose");
    expect(JSON.stringify(parsed.creation)).toContain("./book.md");
    expect(JSON.stringify(parsed.creation)).toContain("./payload.md");
    expect(JSON.stringify(parsed.creation)).toContain("./literal.md");
  });

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
  it("requires a pinned default for local content builds", async () => {
    const out = capture();
    expect(await cmdInit({ dir, ref: "@djj/actor", type: "character", name: "Actor" }, out)).toBe(
      0,
    );
    expect(
      await rawBuild({ file: path.join(dir, "char.yaml"), outDir: path.join(dir, "dist") }, out),
    ).toBe(1);
    expect(out.err.join("\n")).toContain("resolve.default_policy_required");
  });
  async function project(text: string) {
    const file = path.join(dir, "char.yaml");
    await writeFile(file, text);
    return file;
  }

  it("uses the locked profile language for both startup greeting and scene context", async () => {
    const actor = {
      release: "rel_01j00000000000000000000002",
      visibility: "public",
      creation: {
        id: "cr_01j00000000000000000000002",
        ref: "@djj/locale-host",
        type: "character",
        display_name: "Host",
        meta: TEST_DEFAULT_POLICY.creation.meta,
        fragments: [
          {
            id: "description",
            stable: true,
            kind: "character",
            content: { type: "text", text: "A host." },
          },
        ],
      },
    };
    const dependency = path.join(dir, "locale-host.json");
    await writeFile(dependency, JSON.stringify(actor));
    const file = await project(
      JSON.stringify({
        ref: "@djj/locale-start",
        references: [
          {
            id: "host",
            use: actor.creation.ref,
            mode: "default",
            pin: {
              release: actor.release,
              semantic_digest: canonicalizeCreation(actor.creation).semantic_digest,
            },
          },
        ],
        cast: [{ key: "host", who: actor.creation.ref }],
        type: "scenario",
        display_name: "Locale start",
        meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
        story: {
          version: 1,
          scenes: [{ id: "lobby", title: "Lobby", opening: { en: "EN_SCENE", ja: "JA_SCENE" } }],
          starts: [{ id: "arrive", greeting: { en: "EN_GREETING", ja: "JA_GREETING" } }],
        },
        assembly: {
          version: "1-draft",
          preset: TEST_DEFAULT_PIN,
          profile: {
            runtime: { name: "locked", version: "1" },
            tokenizer: "estimate",
            context_window: 4096,
            reserve_for_output: 256,
            mode: "narrator",
            locale: "ja",
            capabilities: { system_role: true, multiple_system_messages: true },
          },
          assembler: ASSEMBLER,
          tokenizer: { name: "estimate", version: TOKENIZER_VERSIONS.estimate },
        },
      }),
    );
    const options = {
      file,
      deps: [dependency],
      tokenizer: "estimate" as const,
      contextWindow: 4096,
      mode: "narrator" as const,
      persona: "Sam",
      messages: [],
    };
    const result = capture();
    expect(await cmdPreview(options, result), result.err.join("\n")).toBe(0);
    expect(result.out.join("\n")).toContain("JA_SCENE");
    expect(result.out.join("\n")).toContain("JA_GREETING");
    expect(result.out.join("\n")).not.toContain("EN_GREETING");
    const explicit = capture();
    expect(await cmdPreview({ ...options, locale: "en" }, explicit), explicit.err.join("\n")).toBe(
      0,
    );
    expect(explicit.out.join("\n")).toContain("EN_SCENE");
    expect(explicit.out.join("\n")).toContain("EN_GREETING");
  });

  it("previews the selected story opening and rejects partial supplied snapshots", async () => {
    const { canonicalizeCreation } = await import("@char-pub/core");
    const host = {
      release: "rel_01j00000000000000000000001",
      visibility: "public",
      creation: {
        id: "cr_01j00000000000000000000001",
        ref: "@djj/host",
        type: "character",
        display_name: "Host",
        meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
        fragments: [
          {
            id: "description",
            stable: true,
            kind: "character",
            content: { type: "text", text: "A quiet innkeeper." },
          },
        ],
      },
    };
    const dependency = path.join(dir, "host.json");
    await writeFile(dependency, JSON.stringify(host));
    const file = await project(
      JSON.stringify({
        ref: "@djj/inn",
        type: "scenario",
        display_name: "Inn",
        meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
        references: [
          {
            id: "host",
            use: host.creation.ref,
            mode: "default",
            pin: {
              release: host.release,
              semantic_digest: canonicalizeCreation(host.creation).semantic_digest,
            },
          },
        ],
        cast: [{ key: "host", who: host.creation.ref, part: "Innkeeper" }],
        fragments: [
          {
            id: "setting",
            stable: true,
            kind: "scenario",
            content: { type: "text", text: "An old inn." },
          },
        ],
        story: {
          version: 1,
          scenes: [
            { id: "arrival", title: "Arrival", opening: "{{user}} arrives before sunset." },
            { id: "night", title: "Night", opening: "{{user}} hears a knock after midnight." },
          ],
          starts: [
            {
              id: "early",
              title: "Before sunset",
              description: "Arrive while the inn is open.",
              scene: "arrival",
            },
            {
              id: "late",
              title: "After midnight",
              description: "Arrive after everyone is asleep.",
              scene: "night",
              greeting: "Welcome after midnight, {{user}}.",
            },
          ],
        },
      }),
    );
    const options = {
      file,
      deps: [dependency],
      tokenizer: "estimate" as const,
      contextWindow: 4096,
      mode: "narrator" as const,
      persona: "Sam",
      messages: [],
    };
    const out = capture();
    const code = await cmdPreview({ ...options, start: "late" }, out);
    expect(code, out.err.join("\n")).toBe(0);
    expect(out.out.join("\n")).toContain("Sam hears a knock after midnight.");
    expect(out.out.join("\n")).not.toContain("arrives before sunset");
    expect(out.out.join("\n")).toContain("Welcome after midnight, Sam.");
    const unselected = capture();
    expect(await cmdPreview(options, unselected)).toBe(1);
    expect(unselected.err.join("\n")).toContain("story.start_required");
    const session = path.join(dir, "session.json");
    await writeFile(
      session,
      JSON.stringify({ bindings: { user: { kind: "persona", display_name: "Sam" } }, history: [] }),
    );
    const partial = capture();
    expect(await cmdPreview({ ...options, session }, partial)).toBe(1);
    expect(partial.err.join("\n")).toContain("catalog.story_state_required");
    const conflict = capture();
    expect(await cmdPreview({ ...options, session, start: "late" }, conflict)).toBe(1);
    expect(conflict.err.join("\n")).toContain("cli.conflicting_options");
  });

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
    expect(body).toMatch(/included\s+direct\s+\d+\s+@djj\/alice#description~root/);
    expect(body).toMatch(/included\s+direct\s+\d+\s+@djj\/alice#lore\/arasaka/);
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

describe("policy and author-test commands", () => {
  it("previews content with an explicitly selected local policy and shows final messages", async () => {
    const o = capture();
    const characterDir = path.join(dir, "character");
    const presetDir = path.join(dir, "preset");
    await cmdInit({ dir: characterDir, ref: "@test/hero", type: "character", name: "Hero" }, o);
    await cmdInit({ dir: presetDir, ref: "@test/preset", type: "preset", name: "Policy" }, o);
    expect(
      await cmdPreview(
        {
          file: path.join(characterDir, "char.yaml"),
          preset: path.join(presetDir, "char.yaml"),
          tokenizer: "estimate",
          contextWindow: 2048,
          mode: "narrator",
          persona: "Reader",
          messages: ["Hello"],
        },
        o,
      ),
    ).toBe(0);
    expect(o.out.join("\n")).toContain("[system] Write the next turn of the story.");
    expect(o.out.join("\n")).toContain("[user] Hello");
    expect(o.out.join("\n")).toContain("preset:main");
  });
  it("reports zero fixtures without creating or changing expectations", async () => {
    const o = capture();
    await cmdInit({ dir, ref: "@test/scene", type: "scenario", name: "Scene" }, o);
    const file = path.join(dir, "char.yaml");
    const before = await readFile(file, "utf8");
    expect(await cmdTest({ file }, o)).toBe(0);
    expect(o.out.at(-1)).toBe("0 assembly test(s)");
    expect(await readFile(file, "utf8")).toBe(before);
  });
});
