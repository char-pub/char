/**
 * GitHub Source 的 HTTP 入口与后台任务：webhook 验签与去重、push 触发的同步检查、仓库转移
 * 冻结、定期对账，以及 binding 管理接口的权限与防伪造。
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyAuditChain } from "../src/audit/audit.js";
import { auditLog, creations, sourceBindings } from "../src/db/schema/index.js";
import { runGitHubReconcile, runGitHubSync, type SyncJob } from "../src/worker/github.js";
import {
  charYaml,
  createGitHubHarness,
  type GitHubHarness,
  grantRepositoryAccess,
  listed,
  putCharSource,
  type RepoFixture,
  repoJson,
} from "./github-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let g: GitHubHarness;
let alice: string;
let bob: string;
const cas = testCas();

const INSTALL = "4001";
const REPO: RepoFixture = { id: "5001", owner_id: "6001", owner_login: "djj", name: "alice-card" };
const PRIVATE: RepoFixture = { id: "5002", owner_id: "6001", owner_login: "djj", name: "secret" };
const PATH = "char.yaml";
const SHA1 = "a".repeat(40);
const SHA2 = "b".repeat(40);
const BINDING = "/v1/creations/@djj/alice/source-binding";

async function json(r: Response) {
  return (await r.json()) as Record<string, unknown>;
}

async function codeOf(r: Response) {
  return [r.status, (await json(r)).code];
}

function pushPayload(sha: string, ref = "refs/heads/main", repo: RepoFixture = REPO) {
  return {
    ref,
    before: `${"0".repeat(39)}1`,
    after: sha,
    forced: false,
    repository: repoJson(repo),
    installation: { id: Number(INSTALL) },
  };
}

async function syncJobs(): Promise<SyncJob[]> {
  const out: SyncJob[] = [];
  for (;;) {
    const jobs = await g.h.queue.boss.fetch<SyncJob>("github.sync", { batchSize: 10 });
    if (!jobs || jobs.length === 0) return out;
    for (const job of jobs) {
      out.push(job.data);
      await g.h.queue.boss.complete("github.sync", job.id);
    }
  }
}

const deps = () => ({ db: t.app.db, source: g.source, now: () => g.h.clock.now() });

async function binding() {
  const [c] = await t.app.db.select().from(creations).where(eq(creations.name, "alice"));
  const [b] = await t.app.db
    .select()
    .from(sourceBindings)
    .where(eq(sourceBindings.creationId, c?.id ?? ""));
  return b;
}

beforeAll(async () => {
  t = await createTestDatabase();
  g = await createGitHubHarness(t, cas);
  alice = await g.h.createUser("alice");
  await grantRepositoryAccess(t, g, alice, ["5001", "5002"]);
  bob = await g.h.createUser("bob");
  const me = g.h.as(alice);
  expect((await me.post("/v1/namespaces", { slug: "djj" })).status).toBe(201);
  const r = await me.post("/v1/namespaces/djj/creations", {
    name: "alice",
    type: "character",
    display_name: "Alice",
  });
  expect(r.status).toBe(201);
});

afterAll(async () => {
  await g.h.close();
  await t.drop();
});

describe("webhook delivery", () => {
  it("rejects missing, malformed and wrong signatures with 401", async () => {
    const body = { action: "created", installation: { id: 1 } };
    const wrong = await g.deliver("installation", body, { secret: "not-the-webhook-secret" });
    expect(await codeOf(wrong)).toEqual([401, "webhook.signature_invalid"]);
    const malformed = await g.deliver("installation", body, { signature: "sha1=abc" });
    expect(await codeOf(malformed)).toEqual([401, "webhook.signature_malformed"]);
    const missing = await g.h.app.request("/v1/github/webhook", {
      method: "POST",
      headers: { "x-github-event": "push", "x-github-delivery": crypto.randomUUID() },
      body: JSON.stringify(body),
    });
    expect(await codeOf(missing)).toEqual([401, "webhook.signature_missing"]);
  });

  it("acknowledges events it does not subscribe to without acting on them", async () => {
    const r = await g.deliver("issues", { action: "opened" });
    expect(r.status).toBe(200);
    expect(await json(r)).toEqual({ ignored: true });
  });

  it("accepts deliveries larger than the default request body limit", async () => {
    const big = { ...pushPayload(SHA1, "refs/heads/other"), padding: "x".repeat(3 * 1024 * 1024) };
    const r = await g.deliver("push", big);
    expect(r.status).toBe(200);
  });

  it("records the installation", async () => {
    await g.install(INSTALL, REPO, [REPO]);
    const r = await g.h.as(alice).post(BINDING, {
      installation_id: INSTALL,
      repository_id: REPO.id,
      path: PATH,
    });
    expect(r.status).toBe(201);
  });
});

describe("binding management", () => {
  it("only members of the namespace can manage the binding", async () => {
    const body = { installation_id: INSTALL, repository_id: REPO.id, path: PATH };
    // 还没有公开 Release 的 Creation 对非成员（包括匿名访问）不可见。
    expect((await g.h.as(null).post(BINDING, body)).status).toBe(404);
    expect((await g.h.as(bob).post(BINDING, body)).status).toBe(404);
    expect((await g.h.as(bob).get(BINDING)).status).toBe(404);
    expect((await g.h.as(bob).delete(BINDING)).status).toBe(404);
    expect(await json(await g.h.as(alice).get(BINDING))).toMatchObject({
      status: "active",
      repository_id: REPO.id,
      repository_owner_id: REPO.owner_id,
      full_name: "djj/alice-card",
      tracked_ref: "refs/heads/main",
      publish_refs: ["refs/heads/main", "refs/tags/*"],
    });
  });

  it("a second binding for the same creation is refused", async () => {
    const r = await g.h.as(alice).post(BINDING, {
      installation_id: INSTALL,
      repository_id: REPO.id,
      path: PATH,
    });
    expect(await codeOf(r)).toEqual([409, "binding.exists"]);
  });

  it("owner ids come from GitHub, never from the request", async () => {
    await g.h.as(alice).post("/v1/namespaces/djj/creations", {
      name: "beta",
      type: "character",
      display_name: "Beta",
    });
    const path = "/v1/creations/@djj/beta/source-binding";
    const forged = await g.h.as(alice).post(path, {
      installation_id: INSTALL,
      repository_id: REPO.id,
      repository_owner_id: "9999",
      path: "beta/char.yaml",
    });
    expect(await codeOf(forged)).toEqual([422, "request.invalid"]);
    const ok = await g.h.as(alice).post(path, {
      installation_id: INSTALL,
      repository_id: REPO.id,
      path: "beta/char.yaml",
    });
    expect(ok.status).toBe(201);
    expect(await json(ok)).toMatchObject({ repository_owner_id: REPO.owner_id });
    expect((await g.h.as(alice).delete(path)).status).toBe(204);
  });

  it("refuses repositories the installation cannot access, unknown installations and bad paths", async () => {
    const path = "/v1/creations/@djj/beta/source-binding";
    const me = g.h.as(alice);
    const hidden = await me.post(path, {
      installation_id: INSTALL,
      repository_id: PRIVATE.id,
      path: PATH,
    });
    expect(await codeOf(hidden)).toEqual([422, "github.repository_not_accessible"]);
    const noInstall = await me.post(path, {
      installation_id: "4999",
      repository_id: REPO.id,
      path: PATH,
    });
    expect(await codeOf(noInstall)).toEqual([422, "github.installation_unavailable"]);
    const traversal = await me.post(path, {
      installation_id: INSTALL,
      repository_id: REPO.id,
      path: "a/../../char.yaml",
    });
    expect(await codeOf(traversal)).toEqual([422, "github.invalid_path"]);
  });

  it("resolving a binding that is not frozen is refused", async () => {
    const r = await g.h.as(alice).post(`${BINDING}/resolve`, { action: "rebind" });
    expect(await codeOf(r)).toEqual([409, "binding.not_frozen"]);
  });
});

describe("push, sync and reconciliation", () => {
  it("a push on the tracked branch enqueues one sync; a duplicate delivery is applied once", async () => {
    putCharSource(g.source, REPO, SHA1, ".", charYaml("@djj/alice", "{{self}} is a courier.\n"));
    const delivery = crypto.randomUUID();
    const first = await g.deliver("push", pushPayload(SHA1), { delivery });
    expect(await json(first)).toMatchObject({ ok: true, synced: 1 });
    const again = await g.deliver("push", pushPayload(SHA1), { delivery });
    expect(await json(again)).toEqual({ duplicate: true });
    const jobs = await syncJobs();
    expect(jobs).toEqual([{ binding_id: (await binding())?.id, commit: SHA1 }]);

    // 其他分支的 push 不触发同步。
    const other = await g.deliver("push", pushPayload(SHA2, "refs/heads/feature"));
    expect(await json(other)).toMatchObject({ synced: 0 });
    expect(await syncJobs()).toEqual([]);

    // 同步只检查、不发布，结果写在 binding 上。
    const check = await runGitHubSync(deps(), jobs[0] as SyncJob);
    expect(check).toMatchObject({ commit: SHA1, ok: true });
    const status = await json(await g.h.as(alice).get(BINDING));
    expect(status).toMatchObject({
      last_seen_commit: SHA1,
      last_check: { commit: SHA1, ok: true },
    });
  });

  it("a commit whose char.yaml is broken records a failed check", async () => {
    putCharSource(g.source, REPO, SHA2, ".", charYaml("@someone/else", "x"));
    await g.deliver("push", pushPayload(SHA2));
    const [job] = await syncJobs();
    const check = await runGitHubSync(deps(), job as SyncJob);
    expect(check).toMatchObject({ ok: false, diagnostics: [{ code: "github.ref_mismatch" }] });
  });

  it("a transfer freezes the binding and notifies the owner; sync skips frozen bindings", async () => {
    const r = await g.deliver("repository", {
      action: "transferred",
      repository: repoJson({ ...REPO, owner_id: "6002", owner_login: "new-owner" }),
      changes: { owner: { from: { user: { id: Number(REPO.owner_id), login: "djj" } } } },
    });
    expect(await json(r)).toMatchObject({ frozen: 1 });
    const b = await binding();
    expect(b?.status).toBe("frozen");
    const notified = await t.app.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "binding.owner_notified"));
    expect(notified.map((n) => n.subject)).toEqual([`creation:${b?.creationId}`]);
    expect(await runGitHubSync(deps(), { binding_id: b?.id ?? "", commit: SHA1 })).toBeNull();

    g.source.repos.set(INSTALL, [listed({ ...REPO, owner_id: "6002", owner_login: "new-owner" })]);
    const resolved = await g.h.as(alice).post(`${BINDING}/resolve`, { action: "rebind" });
    expect(await json(resolved)).toMatchObject({ status: "active", repository_owner_id: "6002" });
  });

  it("reconciliation freezes bindings whose owner changed without a webhook", async () => {
    g.source.repos.set(INSTALL, [listed({ ...REPO, owner_id: "6003", owner_login: "third" })]);
    const out = await runGitHubReconcile(deps());
    const b = await binding();
    expect(out).toEqual({ frozen: [b?.id], inaccessible: [] });
    expect(b?.status).toBe("frozen");
    // 再跑一次没有变化：冻结的 binding 不再处理。
    expect(await runGitHubReconcile(deps())).toEqual({ frozen: [], inaccessible: [] });
  });

  it("reconciliation records bindings whose repository the installation can no longer access", async () => {
    g.source.repos.set(INSTALL, [listed({ ...REPO, owner_id: "6003", owner_login: "third" })]);
    expect((await g.h.as(alice).post(`${BINDING}/resolve`, { action: "rebind" })).status).toBe(200);
    g.source.repos.set(INSTALL, []);
    const out = await runGitHubReconcile(deps());
    const id = (await binding())?.id;
    expect(out.inaccessible).toEqual([id]);
    const audits = () =>
      t.app.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "binding.repository_inaccessible"));
    expect(await audits()).toHaveLength(1);
    expect(await json(await g.h.as(alice).get(BINDING))).toMatchObject({
      status: "active",
      last_check: { ok: false, diagnostics: [{ code: "github.repository_not_accessible" }] },
    });
    // 之后的对账仍然报告它，但不重复写审计。
    expect((await runGitHubReconcile(deps())).inaccessible).toEqual([id]);
    expect(await audits()).toHaveLength(1);
  });

  it("a binding cannot be rebound to a repository the installation cannot access", async () => {
    g.source.repos.set(INSTALL, [listed({ ...REPO, owner_id: "6004", owner_login: "fourth" })]);
    expect((await runGitHubReconcile(deps())).frozen).toEqual([(await binding())?.id]);
    g.source.repos.set(INSTALL, []);
    const r = await g.h.as(alice).post(`${BINDING}/resolve`, { action: "rebind" });
    expect(await codeOf(r)).toEqual([422, "github.repository_not_accessible"]);
    expect((await g.h.as(alice).post(`${BINDING}/resolve`, { action: "unbind" })).status).toBe(200);
    expect((await g.h.as(alice).get(BINDING)).status).toBe(404);
  });

  it("every change is audited and the chain is intact", async () => {
    expect((await verifyAuditChain(t.app.db)).ok).toBe(true);
  });
});
