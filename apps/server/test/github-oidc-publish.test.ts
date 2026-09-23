/**
 * UC-4：作者在 GitHub 仓库里维护 char.yaml，CI 用 GitHub OIDC 发布。
 *
 * GitHub 是替身（内存仓库 + 本地签发的 OIDC token + 真实 HMAC 的 webhook），Registry 其余部分
 * 全部是真实的：Postgres、MinIO、pg-boss 与发布 worker。覆盖正常发布，以及各种冒用方式：
 * 改名后重建同名仓库、仓库转移、换绑、token 重放、请求其他 Creation、char.yaml 冒充别人的 ref、
 * 内容与上报的 digest 不一致、pull_request_target 触发、installation 被删除。
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyAuditChain } from "../src/audit/audit.js";
import { auditLog, creations, releases, revisions } from "../src/db/schema/index.js";
import { loadSourceAtCommit } from "../src/github/load-source.js";
import { encodeId } from "../src/registry/ids.js";
import {
  charYaml,
  createGitHubHarness,
  type GitHubHarness,
  listed,
  putCharSource,
  type RepoFixture,
  repoClaims,
  repoJson,
} from "./github-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let g: GitHubHarness;
let alice: string;
let bob: string;
const cas = testCas();

const INSTALL = "3001";
const REPO: RepoFixture = { id: "1001", owner_id: "2001", owner_login: "djj", name: "alice-card" };
const REPO2: RepoFixture = { id: "1002", owner_id: "2001", owner_login: "djj", name: "lore" };
const DIR = "chars/alice";
const PATH = `${DIR}/char.yaml`;
const SHA1 = "1".repeat(40);
const SHA2 = "2".repeat(40);
const SHA_EVIL = "e".repeat(40);
const OTHER_DIGEST = `sha256:${"0".repeat(64)}`;

async function json(r: Response) {
  return (await r.json()) as Record<string, unknown>;
}

async function creationId(name: string) {
  const [c] = await t.app.db.select().from(creations).where(eq(creations.name, name));
  if (!c) throw new Error(`no creation ${name}`);
  return c.id;
}

/** Action 在本地用同一个解析器算出的 digest。 */
async function digestAt(repo: RepoFixture, sha: string, ref = "@djj/alice", name = "alice") {
  const loaded = await loadSourceAtCommit(
    g.source,
    { installation_id: INSTALL, repository_id: repo.id, commit: sha, path: PATH },
    { ref, creationId: encodeId("creation", await creationId(name)) },
  );
  return loaded.semantic_digest;
}

function publish(token: string | null, body: Record<string, unknown>, key: string = randomUUID()) {
  return g.h.app.request("/v1/publish/oidc", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function publishFrom(
  repo: RepoFixture,
  sha: string,
  label: string,
  over: { claims?: Record<string, unknown>; body?: Record<string, unknown>; key?: string } = {},
) {
  const token = await g.oidcToken(repoClaims(repo, sha, over.claims));
  const body = {
    creation: "@djj/alice",
    label,
    visibility: "public",
    commit: sha,
    path: PATH,
    semantic_digest: await digestAt(repo, sha).catch(() => OTHER_DIGEST),
    ...over.body,
  };
  return publish(token, body, over.key);
}

async function codeOf(r: Response) {
  return [r.status, (await json(r)).code];
}

beforeAll(async () => {
  t = await createTestDatabase();
  g = await createGitHubHarness(t, cas);
  alice = await g.h.createUser("alice");
  bob = await g.h.createUser("bob");
  const me = g.h.as(alice);
  expect((await me.post("/v1/namespaces", { slug: "djj" })).status).toBe(201);
  for (const name of ["alice", "beta"]) {
    const r = await me.post("/v1/namespaces/djj/creations", {
      name,
      type: "character",
      display_name: name,
    });
    expect(r.status).toBe(201);
  }
  const b = g.h.as(bob);
  expect((await b.post("/v1/namespaces", { slug: "bobns" })).status).toBe(201);
  expect(
    (
      await b.post("/v1/namespaces/bobns/creations", {
        name: "victim",
        type: "character",
        display_name: "Victim",
      })
    ).status,
  ).toBe(201);

  await g.install(INSTALL, REPO, [REPO, REPO2]);
  putCharSource(g.source, REPO, SHA1, DIR, charYaml("@djj/alice", "{{self}} is a courier.\n"));
  putCharSource(g.source, REPO, SHA2, DIR, charYaml("@djj/alice", "{{self}} is a netrunner.\n"));
  putCharSource(g.source, REPO, SHA_EVIL, DIR, charYaml("@bobns/victim", "Stolen.\n"));
  const bind = await me.post("/v1/creations/@djj/alice/source-binding", {
    installation_id: INSTALL,
    repository_id: REPO.id,
    path: PATH,
  });
  expect(bind.status).toBe(201);
});

afterAll(async () => {
  await g.h.close();
  await t.drop();
});

describe("UC-4: publishing from GitHub with OIDC", () => {
  it("rejects requests without a valid GitHub token", async () => {
    const body = {
      creation: "@djj/alice",
      label: "0.0.1",
      visibility: "public",
      commit: SHA1,
      path: PATH,
      semantic_digest: await digestAt(REPO, SHA1),
    };
    expect(await codeOf(await publish(null, body))).toEqual([401, "oidc.missing"]);
    const forged = await g.oidcToken(repoClaims(REPO, SHA1), { wrongKey: true });
    expect(await codeOf(await publish(forged, body))).toEqual([401, "oidc.invalid_signature"]);
    const wrongAud = await g.oidcToken(repoClaims(REPO, SHA1, { aud: "https://evil.example" }));
    expect(await codeOf(await publish(wrongAud, body))).toEqual([401, "oidc.wrong_audience"]);
  });

  it("publishes the bound repository at the token's commit", async () => {
    const r = await publishFrom(REPO, SHA1, "1.0.0", { key: "uc4-key-0001" });
    expect(r.status).toBe(202);
    const out = await json(r);
    expect(out).toMatchObject({ state: "pending", idempotent: false });
    expect(await g.h.runPublishJobs()).toEqual(["published"]);

    const [row] = await t.app.db.select().from(releases).where(eq(releases.label, "1.0.0"));
    expect(row).toMatchObject({ publishState: "done", status: "active", visibility: "public" });
    expect(row?.source).toEqual({
      provider: "github",
      repository_id: REPO.id,
      repository_owner_id: REPO.owner_id,
      commit: SHA1,
      path: PATH,
    });
    expect(row?.publishedBy).toMatchObject({
      oidc: {
        repository_id: REPO.id,
        repository_owner_id: REPO.owner_id,
        sha: SHA1,
        ref: "refs/heads/main",
        event_name: "push",
      },
    });
    // Registry 自己在那个 commit 上读取并构建：Release 的 digest 就是 Action 上报的那个。
    expect(row?.semanticDigest).toBe(await digestAt(REPO, SHA1));
    const [rev] = await t.app.db
      .select()
      .from(revisions)
      .where(eq(revisions.id, row?.revisionId ?? ""));
    expect([rev?.authorKind, rev?.authorUserId]).toEqual(["source", null]);
    expect(rev?.message).toContain(SHA1.slice(0, 12));

    const report = await json(
      await g.h.as(alice).get("/v1/creations/@djj/alice/releases/1.0.0/report"),
    );
    expect(report).toMatchObject({ state: "active", label: "1.0.0" });
    // 有了公开 Release 之后非成员能看到 Creation，但仍然不能管理它的 binding。
    const path = "/v1/creations/@djj/alice/source-binding";
    expect((await g.h.as(bob).get(path)).status).toBe(403);
    expect((await g.h.as(bob).delete(path)).status).toBe(403);
  });

  it("each token works once; a retry uses a new token and the same Idempotency-Key", async () => {
    const token = await g.oidcToken(repoClaims(REPO, SHA2));
    const body = {
      creation: "@djj/alice",
      label: "1.1.0",
      visibility: "public",
      commit: SHA2,
      path: PATH,
      semantic_digest: await digestAt(REPO, SHA2),
    };
    expect((await publish(token, body, "uc4-key-0002")).status).toBe(202);
    expect(await codeOf(await publish(token, body, "uc4-key-0002"))).toEqual([403, "oidc.replay"]);
    const retry = await publish(await g.oidcToken(repoClaims(REPO, SHA2)), body, "uc4-key-0002");
    expect(retry.status).toBe(200);
    expect(await json(retry)).toMatchObject({ idempotent: true });
    // 同一个 key 换了内容：拒绝。
    const reused = await publishFrom(REPO, SHA1, "1.1.1", { key: "uc4-key-0002" });
    expect(await codeOf(reused)).toEqual([422, "request.idempotency_key_reused"]);
    expect(await g.h.runPublishJobs()).toEqual(["published"]);
  });

  it("rejects a commit other than the one the run was triggered for", async () => {
    const r = await publishFrom(REPO, SHA1, "1.2.0", {
      body: { commit: SHA2, semantic_digest: await digestAt(REPO, SHA2) },
    });
    expect(await codeOf(r)).toEqual([403, "oidc.commit_mismatch"]);
  });

  it("rejects content that does not match the digest the workflow reported", async () => {
    const r = await publishFrom(REPO, SHA1, "1.2.0", { body: { semantic_digest: OTHER_DIGEST } });
    expect(r.status).toBe(422);
    const p = await json(r);
    expect(p).toMatchObject({
      code: "publish.source_digest_mismatch",
      reported: OTHER_DIGEST,
      computed: await digestAt(REPO, SHA1),
    });
    // 报的是另一个 commit 的 digest（例如 workflow 在工作区里改了文件）：同样拒绝。
    const other = await publishFrom(REPO, SHA1, "1.2.0", {
      body: { semantic_digest: await digestAt(REPO, SHA2) },
    });
    expect(await codeOf(other)).toEqual([422, "publish.source_digest_mismatch"]);
  });

  it("rejects runs triggered by pull_request_target or pull_request", async () => {
    for (const event_name of ["pull_request_target", "pull_request"]) {
      const r = await publishFrom(REPO, SHA1, "1.2.0", { claims: { event_name } });
      expect(await codeOf(r)).toEqual([403, "oidc.event_not_allowed"]);
    }
  });

  it("rejects refs outside the binding's publish refs", async () => {
    const r = await publishFrom(REPO, SHA1, "1.2.0", { claims: { ref: "refs/heads/feature" } });
    expect(await codeOf(r)).toEqual([403, "binding.ref_not_allowed"]);
  });

  it("rejects a creation the repository is not bound to", async () => {
    for (const creation of ["@djj/beta", "@bobns/victim"]) {
      const r = await publishFrom(REPO, SHA1, "1.2.0", { body: { creation } });
      expect(await codeOf(r)).toEqual([403, "binding.mismatch"]);
    }
    const missing = await publishFrom(REPO, SHA1, "1.2.0", { body: { creation: "@djj/nope" } });
    expect(await codeOf(missing)).toEqual([403, "binding.not_found"]);
  });

  it("rejects a char.yaml that claims someone else's creation", async () => {
    const r = await publishFrom(REPO, SHA_EVIL, "1.2.0", {
      body: { semantic_digest: OTHER_DIGEST },
    });
    expect(await codeOf(r)).toEqual([422, "github.ref_mismatch"]);
    // 直接请求那个 Creation 也不行：仓库没有绑定到它。
    const direct = await publishFrom(REPO, SHA_EVIL, "1.2.0", {
      body: { creation: "@bobns/victim", semantic_digest: OTHER_DIGEST },
    });
    expect(await codeOf(direct)).toEqual([403, "binding.mismatch"]);
  });

  it("rejects a path other than the bound one", async () => {
    const r = await publishFrom(REPO, SHA1, "1.2.0", { body: { path: "other/char.yaml" } });
    expect(await codeOf(r)).toEqual([403, "binding.path_mismatch"]);
  });

  it("a repository re-created under the old name cannot publish (rename hijack)", async () => {
    // 原仓库改名后，有人用旧名字新建了一个仓库：名字一样，数字 ID 不同。
    const renamed = await g.deliver("repository", {
      action: "renamed",
      repository: repoJson({ ...REPO, name: "alice-v2" }),
      changes: { repository: { name: { from: REPO.name } } },
    });
    expect(renamed.status).toBe(200);
    const impostor: RepoFixture = { ...REPO, id: "1999", owner_id: "6666", owner_login: "djj" };
    putCharSource(g.source, impostor, SHA1, DIR, charYaml("@djj/alice", "{{self}} is fake.\n"));
    const r = await publishFrom(impostor, SHA1, "1.2.0");
    expect(await codeOf(r)).toEqual([403, "binding.not_found"]);
    // 同一个仓库 ID 但 owner 不同（token 与 binding 不一致）：同样拒绝。
    const spoofed = await publishFrom(REPO, SHA1, "1.2.0", {
      claims: { repository_owner_id: "6666" },
    });
    expect(await codeOf(spoofed)).toEqual([403, "binding.mismatch"]);
  });

  it("the publish kill switch returns 503", async () => {
    await g.h.setFlag("publish", false);
    const r = await publishFrom(REPO, SHA1, "1.2.0");
    expect(await codeOf(r)).toEqual([503, "feature.disabled"]);
    await g.h.setFlag("publish", true);
  });

  it("a transfer freezes the binding; rebinding to the new owner restores publishing", async () => {
    const NEW_OWNER = { ...REPO, owner_id: "2002", owner_login: "new-owner" };
    const transferred = await g.deliver("repository", {
      action: "transferred",
      repository: repoJson(NEW_OWNER),
      changes: {
        owner: { from: { user: { id: Number(REPO.owner_id), login: REPO.owner_login } } },
      },
    });
    expect(await json(transferred)).toMatchObject({ ok: true, frozen: 1 });
    const status = await json(await g.h.as(alice).get("/v1/creations/@djj/alice/source-binding"));
    expect(status).toMatchObject({ status: "frozen" });

    // 新 owner 的 token：owner 与 binding 不一致。
    const fromNew = await publishFrom(NEW_OWNER, SHA1, "1.2.0");
    expect(await codeOf(fromNew)).toEqual([403, "binding.mismatch"]);
    // 冻结期间，旧 owner 的 claim 也不能发布。
    const fromOld = await publishFrom(REPO, SHA1, "1.2.0");
    expect(await codeOf(fromOld)).toEqual([403, "binding.frozen"]);

    // 作者确认：新 owner 从 GitHub 读取。
    g.source.repos.set(INSTALL, [listed(NEW_OWNER), listed(REPO2)]);
    const resolved = await g.h
      .as(alice)
      .post("/v1/creations/@djj/alice/source-binding/resolve", { action: "rebind" });
    expect(resolved.status).toBe(200);
    expect(await json(resolved)).toMatchObject({
      status: "active",
      repository_owner_id: NEW_OWNER.owner_id,
    });
    const r = await publishFrom(NEW_OWNER, SHA1, "1.2.0");
    expect(r.status).toBe(202);
    expect(await g.h.runPublishJobs()).toEqual(["published"]);
  });

  it("after unbinding, the old repository cannot publish; a newly bound one can", async () => {
    const NEW_OWNER = { ...REPO, owner_id: "2002", owner_login: "new-owner" };
    const me = g.h.as(alice);
    expect((await me.delete("/v1/creations/@djj/alice/source-binding")).status).toBe(204);
    expect((await me.get("/v1/creations/@djj/alice/source-binding")).status).toBe(404);
    const old = await publishFrom(NEW_OWNER, SHA2, "1.3.0");
    expect(await codeOf(old)).toEqual([403, "binding.not_found"]);

    const bind = await me.post("/v1/creations/@djj/alice/source-binding", {
      installation_id: INSTALL,
      repository_id: REPO2.id,
      path: PATH,
    });
    expect(bind.status).toBe(201);
    putCharSource(g.source, REPO2, SHA2, DIR, charYaml("@djj/alice", "{{self}} moved repos.\n"));
    const r = await publishFrom(REPO2, SHA2, "1.3.0");
    expect(r.status).toBe(202);
    expect(await g.h.runPublishJobs()).toEqual(["published"]);
    const [row] = await t.app.db
      .select()
      .from(releases)
      .where(and(eq(releases.label, "1.3.0"), eq(releases.creationId, await creationId("alice"))));
    expect(row?.source).toMatchObject({ repository_id: REPO2.id });
  });

  it("a deleted installation cannot publish", async () => {
    const deleted = await g.deliver("installation", {
      action: "deleted",
      installation: {
        id: Number(INSTALL),
        account: { id: Number(REPO.owner_id), login: REPO.owner_login, type: "User" },
      },
    });
    expect(deleted.status).toBe(200);
    const r = await publishFrom(REPO2, SHA2, "1.4.0");
    expect(await codeOf(r)).toEqual([403, "github.installation_unavailable"]);
  });

  it("records OIDC publishes in the audit log, and the chain is intact", async () => {
    const rows = await t.app.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "release.publish_requested"));
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.every((r) => (r.actor as { kind: string }).kind === "oidc")).toBe(true);
    expect((await verifyAuditChain(t.app.db)).ok).toBe(true);
  });
});
