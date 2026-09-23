/**
 * 用 GitHub 官方的 webhook 示例负载（`@octokit/webhooks-examples`，由 GitHub 的 webhook 文档
 * 生成）检验 webhook 处理：先确认订阅的每种事件的每个官方示例都能被解析，再把其中一组示例
 * 用运行时生成的密钥重新签名，走真实的 webhook 入口，完成安装 → 绑定 → push → 仓库转移与改名。
 *
 * 官方的 push 示例来自仓库 webhook；GitHub App 的投递会多一个 `installation` 字段，示例 4、5
 * 自带这个字段，这里用的是示例 4。
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Services } from "../src/api/app.js";
import { creations, githubInstallations, sourceBindings } from "../src/db/schema/index.js";
import { QUEUE_NAMES } from "../src/jobs/definitions.js";
import { startGitHubWorkers } from "../src/processes/modules.js";
import { normalizeEvent, SUBSCRIBED_EVENTS, type SubscribedEvent } from "../src/webhook/github.js";
import { createGitHubHarness, type GitHubHarness } from "./github-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

interface Definition {
  name: string;
  examples: Record<string, unknown>[];
}

const EXAMPLES: Definition[] = JSON.parse(
  readFileSync(createRequire(import.meta.url).resolve("@octokit/webhooks-examples"), "utf8"),
);

function examplesOf(name: string): Record<string, unknown>[] {
  const d = EXAMPLES.find((x) => x.name === name);
  if (!d) throw new Error(`no official examples for ${name}`);
  return d.examples;
}

function example(name: string, where: (e: Record<string, unknown>) => boolean) {
  const e = examplesOf(name).find(where);
  if (!e) throw new Error(`no matching official example for ${name}`);
  return structuredClone(e);
}

describe("official GitHub example payloads", () => {
  it.each([...SUBSCRIBED_EVENTS])("every %s example is understood", (event) => {
    const examples = examplesOf(event);
    expect(examples.length).toBeGreaterThan(0);
    for (const payload of examples) {
      expect(() => normalizeEvent(event as SubscribedEvent, payload)).not.toThrow();
    }
  });

  it("maps the fields char.pub relies on", () => {
    const push = example("push", (e) => e.ref === "refs/heads/master" && "installation" in e);
    expect(normalizeEvent("push", push)).toEqual({
      kind: "push",
      installation_id: "1",
      repository_id: "186853002",
      repository_owner_id: "21031067",
      ref: "refs/heads/master",
      commit: "6113728f27ae82c7b1a177c8d03f9e96e0adf246",
      default_branch: "master",
      forced: false,
    });
    const deletedTag = example("push", (e) => e.deleted === true);
    expect(normalizeEvent("push", deletedTag)).toMatchObject({ kind: "push", commit: null });
    const transferred = example("repository", (e) => e.action === "transferred");
    expect(normalizeEvent("repository", transferred)).toEqual({
      kind: "repository.transferred",
      repository_id: "186853261",
      previous_owner_id: "1",
      previous_owner_login: "octocat",
      new_owner_id: "38302899",
      new_owner_login: "Octocoders",
      full_name: "Octocoders/Hello-World",
    });
    const edited = example("repository", (e) => e.action === "edited");
    expect(normalizeEvent("repository", edited)).toBeNull();
  });
});

let t: TestDatabase;
let g: GitHubHarness;
let alice: string;

async function json(r: Response) {
  return (await r.json()) as Record<string, unknown>;
}

async function bindingOf(name: string) {
  const [c] = await t.app.db.select().from(creations).where(eq(creations.name, name));
  const [b] = await t.app.db
    .select()
    .from(sourceBindings)
    .where(eq(sourceBindings.creationId, c?.id ?? ""));
  return b;
}

async function syncJobs() {
  const out: unknown[] = [];
  for (;;) {
    const jobs = await g.h.queue.boss.fetch(QUEUE_NAMES.githubSync, { batchSize: 10 });
    if (!jobs || jobs.length === 0) return out;
    for (const job of jobs) {
      out.push(job.data);
      await g.h.queue.boss.complete(QUEUE_NAMES.githubSync, job.id);
    }
  }
}

beforeAll(async () => {
  t = await createTestDatabase();
  g = await createGitHubHarness(t, testCas());
  alice = await g.h.createUser("alice");
  const me = g.h.as(alice);
  expect((await me.post("/v1/namespaces", { slug: "octo" })).status).toBe(201);
  for (const name of ["hello", "coders"]) {
    const r = await me.post("/v1/namespaces/octo/creations", {
      name,
      type: "character",
      display_name: name,
    });
    expect(r.status).toBe(201);
  }
});

afterAll(async () => {
  await g.h.close();
  await t.drop();
});

describe("official payloads through the real webhook endpoint", () => {
  it("installs, binds by numeric id, syncs on push, and freezes on transfer", async () => {
    const created = example(
      "installation",
      (e) => e.action === "created" && (e.installation as { id: number }).id === 957387,
    );
    expect((await g.deliver("installation", created)).status).toBe(200);
    const [inst] = await t.app.db
      .select()
      .from(githubInstallations)
      .where(eq(githubInstallations.installationId, 957387n));
    expect(inst).toMatchObject({ accountId: 21031067n, accountType: "User" });

    // installation 能访问的仓库（生产中由 GitHub API 返回）。第二个仓库在转移前属于 octocat。
    g.source.repos.set("957387", [
      { id: "186853002", owner_id: "21031067", full_name: "Codertocat/Hello-World" },
      { id: "186853261", owner_id: "1", full_name: "octocat/Hello-World" },
    ]);
    const me = g.h.as(alice);
    const bindHello = await me.post("/v1/creations/@octo/hello/source-binding", {
      installation_id: "957387",
      repository_id: "186853002",
      path: "char.yaml",
      tracked_ref: "refs/heads/master",
    });
    expect(bindHello.status).toBe(201);
    const bindCoders = await me.post("/v1/creations/@octo/coders/source-binding", {
      installation_id: "957387",
      repository_id: "186853261",
      path: "char.yaml",
    });
    expect(bindCoders.status).toBe(201);

    const added = example("installation_repositories", (e) => e.action === "added");
    expect((await g.deliver("installation_repositories", added)).status).toBe(200);

    // 被跟踪分支上的 push 触发一次同步；删除 tag 的 push 什么也不做。
    const push = example("push", (e) => e.ref === "refs/heads/master" && "installation" in e);
    expect(await json(await g.deliver("push", push))).toMatchObject({ ok: true, synced: 1 });
    expect(await syncJobs()).toEqual([
      {
        binding_id: (await bindingOf("hello"))?.id,
        commit: "6113728f27ae82c7b1a177c8d03f9e96e0adf246",
      },
    ]);
    const deletedTag = example("push", (e) => e.deleted === true && "installation" in e);
    expect(await json(await g.deliver("push", deletedTag))).toMatchObject({ synced: 0 });
    expect(await syncJobs()).toEqual([]);

    // octocat 把仓库转给了 Octocoders：binding 冻结，等作者确认。
    const transferred = example("repository", (e) => e.action === "transferred");
    expect(await json(await g.deliver("repository", transferred))).toMatchObject({ frozen: 1 });
    expect(await bindingOf("coders")).toMatchObject({
      status: "frozen",
      displayFullName: "Octocoders/Hello-World",
    });
    expect(await bindingOf("hello")).toMatchObject({ status: "active" });

    // 改名只更新展示用的名字。
    const renamed = example("repository", (e) => e.action === "renamed");
    expect((await g.deliver("repository", renamed)).status).toBe(200);
    expect(await bindingOf("coders")).toMatchObject({ displayFullName: "Octocoders/Hello-World" });

    // 同一个 delivery 重复投递只处理一次。
    const delivery = crypto.randomUUID();
    expect((await g.deliver("push", push, { delivery })).status).toBe(200);
    expect(await json(await g.deliver("push", push, { delivery }))).toEqual({ duplicate: true });
  });

  it("rejects an official payload whose signature was made with another secret", async () => {
    const push = example("push", (e) => e.ref === "refs/heads/master" && "installation" in e);
    const r = await g.deliver("push", push, { secret: `whsec-${crypto.randomUUID()}` });
    expect(r.status).toBe(401);
  });
});

describe("worker schedules", () => {
  it("registers the periodic GitHub reconciliation", async () => {
    const services = {
      db: t.app.db,
      queue: g.h.queue,
      clock: { now: () => new Date() },
    } as unknown as Services;
    await startGitHubWorkers(services, g.source);
    const schedules = await g.h.queue.boss.getSchedules();
    expect(schedules.find((s) => s.name === QUEUE_NAMES.githubReconcile)).toMatchObject({
      name: QUEUE_NAMES.githubReconcile,
      cron: "23 */6 * * *",
    });
  });
});
