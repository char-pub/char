import { CharError, canonicalizeCreation } from "@char-pub/core";
import { describe, expect, it } from "vitest";
import { loadSourceAtCommit } from "./load-source.js";
import { MemoryGitHubSource, normalizeRepoPath } from "./source.js";

const REPO = "1001";
const SHA = "a".repeat(40);
const AT = {
  installation_id: "1",
  repository_id: REPO,
  commit: SHA,
  path: "chars/alice/char.yaml",
};
const EXPECTED = { ref: "@djj/alice", creationId: "cr_01h455vb4pex5vsknk084sn0a1" };

const YAML = `ref: "@djj/alice"
type: character
display_name: Alice
fragments:
  - { id: description, kind: character, content: { type: text, text: ./description.md } }
meta: { default_locale: en, rating: general, rights: original, license: CC-BY-4.0 }
`;

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e instanceof CharError ? e.code : String(e);
  }
  return undefined;
}

describe("loading a creation from a GitHub commit", () => {
  it("reads char.yaml and includes at the commit, and matches a local build", async () => {
    const gh = new MemoryGitHubSource();
    gh.put(REPO, SHA, "chars/alice/char.yaml", YAML);
    gh.put(REPO, SHA, "chars/alice/description.md", "{{self}} is a courier.\n");
    const out = await loadSourceAtCommit(gh, AT, EXPECTED);
    expect(out.files).toEqual(["chars/alice/char.yaml", "chars/alice/description.md"]);
    // 与直接用 core canonicalize 同样内容的结果一致。
    const local = canonicalizeCreation({
      id: EXPECTED.creationId,
      ref: "@djj/alice",
      type: "character",
      display_name: "Alice",
      fragments: [
        {
          id: "description",
          stable: true,
          kind: "character",
          content: { type: "text", text: "{{self}} is a courier.\n" },
        },
      ],
      meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
    });
    expect(out.semantic_digest).toBe(local.semantic_digest);
  });

  it("a different commit with different content gives a different digest", async () => {
    const gh = new MemoryGitHubSource();
    const other = "b".repeat(40);
    for (const [sha, text] of [
      [SHA, "A courier."],
      [other, "A netrunner."],
    ] as const) {
      gh.put(REPO, sha, "chars/alice/char.yaml", YAML);
      gh.put(REPO, sha, "chars/alice/description.md", text);
    }
    const a = await loadSourceAtCommit(gh, AT, EXPECTED);
    const b = await loadSourceAtCommit(gh, { ...AT, commit: other }, EXPECTED);
    expect(a.semantic_digest).not.toBe(b.semantic_digest);
  });

  it("rejects a repository that tries to publish someone else's creation", async () => {
    const gh = new MemoryGitHubSource();
    gh.put(REPO, SHA, "chars/alice/char.yaml", YAML.replace("@djj/alice", "@victim/alice"));
    gh.put(REPO, SHA, "chars/alice/description.md", "x");
    expect(await codeOf(loadSourceAtCommit(gh, AT, EXPECTED))).toBe("github.ref_mismatch");
  });

  it("rejects missing files, missing ids, and includes outside the repository", async () => {
    const gh = new MemoryGitHubSource();
    expect(await codeOf(loadSourceAtCommit(gh, AT, EXPECTED))).toBe("github.source_missing");
    gh.put(REPO, SHA, "chars/alice/char.yaml", YAML.replace("{ id: description, ", "{ "));
    gh.put(REPO, SHA, "chars/alice/description.md", "x");
    expect(await codeOf(loadSourceAtCommit(gh, AT, EXPECTED))).toBe("check.missing_fragment_id");
    gh.put(
      REPO,
      SHA,
      "chars/alice/char.yaml",
      YAML.replace("./description.md", "./../../../etc/passwd.md"),
    );
    expect(await codeOf(loadSourceAtCommit(gh, AT, EXPECTED))).toBe("cli.include_outside_project");
    gh.put(REPO, SHA, "chars/alice/char.yaml", YAML.replace("./description.md", "./nope.md"));
    expect(await codeOf(loadSourceAtCommit(gh, AT, EXPECTED))).toBe("cli.include_missing");
  });

  it("normalizes repository paths and rejects traversal", () => {
    expect(normalizeRepoPath("./a/b.yaml")).toBe("a/b.yaml");
    for (const bad of ["/etc/passwd", "a/../b", "a//b", "../x"]) {
      expect(() => normalizeRepoPath(bad)).toThrow();
    }
  });
});
