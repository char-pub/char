/**
 * Release 与 Contribution schema 的接受 / 拒绝用例，以及 Creation 中 URL 字段的补充用例。
 *
 * 每个用例同时用 zod 和发布到 spec/schema/ 的 JSON Schema 校验，两者必须给出相同结论：
 * 外部实现只能看到 JSON Schema，它和 zod 不一致就意味着两边会接受不同的数据。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { CreationSchema } from "../src/schema/creation.js";
import { ContributionSchema, ReleaseSchema } from "../src/schema/release.js";
import { D, level0Character, tid } from "./fixtures.js";

const specDir = join(dirname(fileURLToPath(import.meta.url)), "../../../spec/schema");
const ajv = new Ajv2020({ strict: false, allErrors: true });
const compile = (name: string) =>
  ajv.compile(JSON.parse(readFileSync(join(specDir, `${name}.schema.json`), "utf8")));
const validateRelease = compile("release");
const validateContribution = compile("contribution");
const validateCreation = compile("creation");

type Obj = Record<string, unknown>;

function without(o: Obj, key: string): Obj {
  const { [key]: _drop, ...rest } = o;
  return rest;
}

/** 必填字段：zod shape 中不接受 undefined 的键。 */
function requiredKeys(schema: z.ZodObject): string[] {
  return Object.entries(schema.shape)
    .filter(([, s]) => !(s as z.ZodType).safeParse(undefined).success)
    .map(([k]) => k);
}

// ---------------------------------------------------------------------------
// Release
// ---------------------------------------------------------------------------

const SHA = "0123456789abcdef0123456789abcdef01234567";

function release(overrides: Obj = {}): Obj {
  return {
    id: tid("rel", 1),
    creation: tid("cr", 1),
    label: "1.0.0",
    visibility: "public",
    status: "active",
    source: { provider: "native", revision: tid("rev", 1) },
    source_digest: D("1"),
    semantic_digest: D("2"),
    attribution: [{ ref: "@djj/alice", authors: [{ name: "DJJ", user: tid("usr", 1) }] }],
    contributors: [],
    provenance: {},
    lock: [],
    snapshot: { digest: D("3"), size: 2048, availability: "mirrored" },
    availability: "complete",
    effective_rating: "general",
    license_check: "pass",
    created_at: "2026-09-22T10:00:00Z",
    published_by: tid("usr", 1),
    ...overrides,
  };
}

const oidcClaims: Obj = {
  repository_id: "123456789",
  repository_owner_id: "987654321",
  sha: SHA,
  ref: "refs/heads/main",
  workflow_ref: "djj/alice/.github/workflows/publish.yml@refs/heads/main",
  job_workflow_ref: "char-pub/publish/.github/workflows/publish.yml@refs/tags/v1",
  run_id: "42",
  run_attempt: "1",
  actor_id: "1001",
  event_name: "push",
  jti: "b6f1a1d2-0000-4000-8000-000000000000",
};

function expectRelease(value: unknown, ok: boolean): void {
  expect(ReleaseSchema.safeParse(value).success).toBe(ok);
  expect(validateRelease(value)).toBe(ok);
}

describe("ReleaseSchema accepts", () => {
  it.each([
    ["the minimal native release", release()],
    [
      "a GitHub source published through OIDC",
      release({
        source: {
          provider: "github",
          repository_id: "123456789",
          repository_owner_id: "987654321",
          commit: SHA,
          path: "char.yaml",
        },
        published_by: { oidc: oidcClaims },
      }),
    ],
    [
      "an import source",
      release({
        source: {
          provider: "import",
          format: "ccv3",
          upload: { digest: D("4"), size: 10, availability: "mirrored" },
        },
      }),
    ],
    [
      "an https source",
      release({
        source: {
          provider: "http",
          url: "https://example.com/alice.json",
          fetched_at: "2026-09-22T10:00:00Z",
        },
      }),
    ],
    [
      "a yanked private release with a lock, contributors and a context IR",
      release({
        visibility: "private",
        status: "yanked",
        status_reason: "author.superseded",
        lock: [
          {
            ref: "@djj/night-city",
            release: tid("rel", 2),
            semantic_digest: D("5"),
            via: ["home"],
          },
        ],
        contributors: [
          { ref: "@djj/alice", author: tid("usr", 2), contribution: tid("ctb", 1) },
          { ref: "@djj/alice", author: { guest_id: "gst_1", display_name: "Guest" } },
        ],
        context_ir: { digest: D("6"), size: 512, availability: "mirrored" },
        availability: "linked",
        effective_rating: "mature",
        license_check: "warn",
      }),
    ],
  ])("%s", (_name, value) => {
    expectRelease(value, true);
  });
});

describe("ReleaseSchema rejects", () => {
  it.each(requiredKeys(ReleaseSchema))("a release without %s", (key) => {
    expectRelease(without(release(), key), false);
  });

  it.each([
    ["an unknown top-level field", release({ downloads: 3 })],
    [
      "an unknown field in the source",
      release({ source: { provider: "native", revision: tid("rev", 1), branch: "x" } }),
    ],
    ["visibility outside the enum", release({ visibility: "unlisted" })],
    ["status outside the enum", release({ status: "deleted" })],
    ["a failed license check (such releases are never stored)", release({ license_check: "fail" })],
    ["availability outside the enum", release({ availability: "partial" })],
    ["a rating outside the enum", release({ effective_rating: "adult" })],
    ["a label with a slash", release({ label: "1.0/0" })],
    ["a revision id in the release id", release({ id: tid("rev", 1) })],
    ["a malformed digest", release({ semantic_digest: "sha256:XYZ" })],
    ["a timestamp with an offset", release({ created_at: "2026-09-22T10:00:00+08:00" })],
    ["a date without time", release({ created_at: "2026-09-22" })],
    [
      "a negative snapshot size",
      release({ snapshot: { digest: D("3"), size: -1, availability: "mirrored" } }),
    ],
    [
      "an unknown source provider",
      release({ source: { provider: "gitlab", revision: tid("rev", 1) } }),
    ],
    [
      "a plain http source",
      release({
        source: {
          provider: "http",
          url: "http://example.com/a.json",
          fetched_at: "2026-09-22T10:00:00Z",
        },
      }),
    ],
    [
      "a GitHub repository id written as a number",
      release({
        source: {
          provider: "github",
          repository_id: 123456789,
          repository_owner_id: "987654321",
          commit: SHA,
          path: "char.yaml",
        },
      }),
    ],
    [
      "a GitHub id with a leading zero",
      release({
        source: {
          provider: "github",
          repository_id: "0123",
          repository_owner_id: "987654321",
          commit: SHA,
          path: "char.yaml",
        },
      }),
    ],
    [
      "an abbreviated commit",
      release({
        source: {
          provider: "github",
          repository_id: "1",
          repository_owner_id: "2",
          commit: "0123456",
          path: "char.yaml",
        },
      }),
    ],
    [
      "OIDC claims from a pull_request_target run",
      release({ published_by: { oidc: { ...oidcClaims, event_name: "pull_request_target" } } }),
    ],
    ["OIDC claims without a jti", release({ published_by: { oidc: without(oidcClaims, "jti") } })],
    [
      "OIDC claims with an extra claim",
      release({ published_by: { oidc: { ...oidcClaims, repository: "djj/alice" } } }),
    ],
    ["a publisher that is not a user id", release({ published_by: tid("cr", 1) })],
    [
      "a lock entry pinned to a versioned ref",
      release({
        lock: [
          {
            ref: "@djj/night-city@1.0.0",
            release: tid("rel", 2),
            semantic_digest: D("5"),
            via: [],
          },
        ],
      }),
    ],
    [
      "a lock entry whose path contains a fragment id with a slash",
      release({
        lock: [
          { ref: "@djj/night-city", release: tid("rel", 2), semantic_digest: D("5"), via: ["a/b"] },
        ],
      }),
    ],
    [
      "an attribution author without a name",
      release({ attribution: [{ ref: "@djj/alice", authors: [{ user: tid("usr", 1) }] }] }),
    ],
  ])("%s", (_name, value) => {
    expectRelease(value, false);
  });
});

// ---------------------------------------------------------------------------
// Contribution
// ---------------------------------------------------------------------------

const fragmentAdd: Obj = {
  on: "fragment",
  op: "add",
  id: "lore/arasaka",
  after: {
    id: "lore/arasaka",
    stable: true,
    kind: "knowledge",
    content: { type: "text", text: "Arasaka runs the city." },
  },
};

function contribution(overrides: Obj = {}): Obj {
  return {
    id: tid("ctb", 1),
    target: tid("cr", 1),
    base: { revision: tid("rev", 1), semantic_digest: D("1") },
    author: tid("usr", 2),
    title: "Add Arasaka lore",
    status: "open",
    transport: { type: "native" },
    changes: [fragmentAdd],
    rights_ack: { inbound_equals_outbound: true },
    ...overrides,
  };
}

function expectContribution(value: unknown, ok: boolean): void {
  expect(ContributionSchema.safeParse(value).success).toBe(ok);
  expect(validateContribution(value)).toBe(ok);
}

describe("ContributionSchema accepts", () => {
  it.each([
    ["the minimal native contribution", contribution()],
    [
      "a guest author with explicit grant and an agent flag",
      contribution({
        author: { guest_id: "gst_1", display_name: "Guest" },
        rights_ack: { explicit_grant: true },
        agent: true,
        description: "d".repeat(20000),
      }),
    ],
    [
      "a GitHub pull request transport",
      contribution({ transport: { type: "github-pr", repository_id: "123", number: 7 } }),
    ],
    ["a 200-character title", contribution({ title: "t".repeat(200) })],
    [
      "every kind of change",
      contribution({
        status: "accepted",
        changes: [
          fragmentAdd,
          { on: "fragment", op: "remove", id: "old", base_digest: D("2") },
          {
            on: "edge",
            op: "modify",
            id: "home",
            base_digest: D("3"),
            after: { id: "home", use: "@djj/night-city", mode: "intrinsic" },
          },
          { on: "asset", op: "remove", slot: "avatar", variant: "happy", base_digest: D("4") },
          {
            on: "asset",
            op: "add",
            slot: "banner",
            after: {
              slot: "banner",
              role: "presentation",
              variants: [
                {
                  id: "default",
                  media_type: "image/webp",
                  blob: { digest: D("5"), size: 10, availability: "mirrored" },
                },
              ],
            },
          },
          { on: "metadata", field: "meta.tags", op: "set", after: ["cyberpunk"], sensitive: false },
          { on: "metadata", field: "summary", op: "unset", base_digest: D("6"), sensitive: false },
          {
            on: "metadata",
            field: "meta.rating",
            op: "set",
            base_digest: D("7"),
            after: "teen",
            sensitive: true,
          },
        ],
      }),
    ],
  ])("%s", (_name, value) => {
    expectContribution(value, true);
  });
});

describe("ContributionSchema rejects", () => {
  it.each(requiredKeys(ContributionSchema))("a contribution without %s", (key) => {
    expectContribution(without(contribution(), key), false);
  });

  it.each([
    ["an unknown top-level field", contribution({ labels: ["lore"] })],
    ["an empty change list", contribution({ changes: [] })],
    ["an empty title", contribution({ title: "" })],
    ["a 201-character title", contribution({ title: "t".repeat(201) })],
    ["a description over 20000 characters", contribution({ description: "d".repeat(20001) })],
    ["status outside the enum", contribution({ status: "merged" })],
    [
      "a rights acknowledgement set to false",
      contribution({ rights_ack: { inbound_equals_outbound: false } }),
    ],
    [
      "both rights acknowledgements at once",
      contribution({ rights_ack: { inbound_equals_outbound: true, explicit_grant: true } }),
    ],
    ["an empty rights acknowledgement", contribution({ rights_ack: {} })],
    ["an unknown transport", contribution({ transport: { type: "email" } })],
    [
      "a pull request number of zero",
      contribution({ transport: { type: "github-pr", repository_id: "1", number: 0 } }),
    ],
    [
      "a guest author with an empty display name",
      contribution({ author: { guest_id: "g", display_name: "" } }),
    ],
    ["an author that is a namespace ref", contribution({ author: "@djj" })],
    ["a base without a semantic digest", contribution({ base: { revision: tid("rev", 1) } })],
    [
      "a base pointing at a release",
      contribution({ base: { revision: tid("rel", 1), semantic_digest: D("1") } }),
    ],
    [
      "a change on an unknown target",
      contribution({ changes: [{ on: "slot", op: "add", id: "x" }] }),
    ],
    [
      "a fragment change with the set operation",
      contribution({ changes: [{ ...fragmentAdd, op: "set" }] }),
    ],
    [
      "a fragment change with an invalid id",
      contribution({ changes: [{ ...fragmentAdd, id: "Lore/Arasaka" }] }),
    ],
    [
      "an edge change whose id has a slash",
      contribution({ changes: [{ on: "edge", op: "remove", id: "a/b", base_digest: D("1") }] }),
    ],
    [
      "a metadata change without the sensitive flag",
      contribution({ changes: [{ on: "metadata", field: "meta.tags", op: "set", after: [] }] }),
    ],
    [
      "a metadata change on a field that is not editable",
      contribution({
        changes: [
          { on: "metadata", field: "meta.authors", op: "set", after: [], sensitive: false },
        ],
      }),
    ],
    [
      "a metadata change with the add operation",
      contribution({
        changes: [{ on: "metadata", field: "meta.tags", op: "add", after: [], sensitive: false }],
      }),
    ],
    [
      "a change with an unknown field",
      contribution({ changes: [{ ...fragmentAdd, sensitive: true }] }),
    ],
  ])("%s", (_name, value) => {
    expectContribution(value, false);
  });
});

// ---------------------------------------------------------------------------
// Creation：外链 asset 的 URL
// ---------------------------------------------------------------------------

function withLinkedAvatar(url: string): unknown {
  return level0Character({
    assets: [
      {
        slot: "avatar",
        role: "presentation",
        variants: [
          {
            id: "default",
            media_type: "image/webp",
            blob: {
              digest: D("a"),
              size: 1024,
              availability: "linked",
              locator: { provider: "http", url },
            },
          },
        ],
      },
    ],
  });
}

describe("CreationSchema asset locator URL", () => {
  it.each([
    ["https://example.com/a.webp", true],
    ["http://example.com/a.webp", false],
    ["ftp://example.com/a.webp", false],
    ["example.com/a.webp", false],
  ])("%s → %s", (url, ok) => {
    const value = withLinkedAvatar(url);
    expect(CreationSchema.safeParse(value).success).toBe(ok);
    expect(validateCreation(value)).toBe(ok);
  });
});
