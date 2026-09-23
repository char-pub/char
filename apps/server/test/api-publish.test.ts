/**
 * Registry 写路径的集成测试：真实的 Postgres、MinIO 与 pg-boss。
 *
 * 主流程对应“不懂 Git 的创作者”：登录 → 注册 namespace → 新建 Character → 填写名字、
 * 简介、开场白和头像 → 保存 Revision → 发布 1.0.0 → worker 完成构建 → Release 生效，
 * 依赖闭包、blob 反向引用齐全，IR 在 public 桶中可以匿名读取。
 */
import { canonicalizeCreation, sha256Bytes } from "@char-pub/core";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyAuditChain } from "../src/audit/audit.js";
import {
  assetMeta,
  blobRefs,
  blobs,
  creations,
  releaseFragments,
  releaseLocks,
  releases,
  reverseEdges,
} from "../src/db/schema/index.js";
import { casKey } from "../src/storage/cas.js";
import { type ApiHarness, createHarness } from "./api-harness.js";
import { BUCKETS } from "./global-setup.js";
import { createTestDatabase, type TestDatabase, testCas, testStorageEnv } from "./helpers.js";

let t: TestDatabase;
let h: ApiHarness;
let alice: string;
const cas = testCas();

/** 预置一张已经处理完成的头像（跳过上传管线，直接登记为 ready）。 */
async function readyAvatar(seed: string) {
  const bytes = new TextEncoder().encode(`avatar-${seed}`);
  const put = await cas.putBlob(t.app.db, {
    bucket: "private",
    bytes,
    mediaType: "image/webp",
    kind: "asset",
  });
  await t.app.db
    .insert(assetMeta)
    .values({ digest: put.digest, width: 256, height: 256, mediaType: "image/webp" })
    .onConflictDoNothing();
  return { digest: put.digest, size: bytes.length };
}

function level0(avatar: { digest: string; size: number }) {
  return {
    display_name: "Alice",
    summary: "A courier who is always late.",
    fragments: [
      {
        id: "description",
        stable: true,
        kind: "character",
        content: { type: "text", text: "{{self}} is a courier in Night City." },
      },
    ],
    bootstrap: { greetings: [{ id: "default", text: "Hi, you're late again." }] },
    assets: [
      {
        slot: "avatar",
        role: "presentation",
        variants: [
          {
            id: "default",
            media_type: "image/webp",
            blob: { digest: avatar.digest, size: avatar.size, availability: "mirrored" },
          },
        ],
      },
    ],
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
  };
}

beforeAll(async () => {
  t = await createTestDatabase();
  h = await createHarness(t, cas);
  alice = await h.createUser("alice");
});

afterAll(async () => {
  await h.close();
  await t.drop();
});

async function json(r: Response) {
  return (await r.json()) as Record<string, unknown>;
}

describe("UC-1: a creator publishes a Level 0 character", () => {
  let releaseId: string;

  it("walks from sign-in to an active public release", async () => {
    const me = h.as(alice);
    expect((await me.post("/v1/namespaces", { slug: "djj" })).status).toBe(201);
    const created = await me.post("/v1/namespaces/djj/creations", {
      name: "alice",
      type: "character",
      display_name: "Alice",
    });
    expect(created.status).toBe(201);
    expect(await json(created)).toMatchObject({ ref: "@djj/alice", type: "character" });

    const draft = await me.get("/v1/creations/@djj/alice/draft");
    expect(draft.status).toBe(200);
    const d = await json(draft);
    expect(d.version).toBe(1);

    const avatar = await readyAvatar("uc1");
    const put = await me.put(
      "/v1/creations/@djj/alice/draft",
      { working: { ...level0(avatar), ref: "@evil/other", type: "world" } },
      { "if-match": String(d.version) },
    );
    expect(put.status).toBe(200);
    expect(put.headers.get("etag")).toBe('"2"');
    const saved = await json(await me.get("/v1/creations/@djj/alice/draft"));
    // ref 与 type 由服务端强制，客户端提交的值被覆盖。
    expect(saved.working).toMatchObject({ ref: "@djj/alice", type: "character" });

    const rev = await me.post("/v1/creations/@djj/alice/revisions", { message: "first" });
    expect(rev.status).toBe(201);
    const revision = await json(rev);
    expect(revision.id).toMatch(/^rev_/);
    // 同样的内容再次创建 Revision，返回已有的那个。
    const again = await me.post("/v1/creations/@djj/alice/revisions", {});
    expect(again.status).toBe(200);
    expect((await json(again)).id).toBe(revision.id);

    const pub = await me.post(
      "/v1/creations/@djj/alice/releases",
      { revision: revision.id, label: "1.0.0", visibility: "public" },
      { "idempotency-key": "uc1-publish-0001" },
    );
    expect(pub.status).toBe(202);
    const pr = await json(pub);
    expect(pr).toMatchObject({ state: "pending", idempotent: false });
    releaseId = pr.release as string;

    expect(await h.runPublishJobs()).toEqual(["published"]);
    const report = await json(await me.get("/v1/creations/@djj/alice/releases/1.0.0/report"));
    expect(report).toMatchObject({ state: "active", release: releaseId, label: "1.0.0" });
  });

  it("materializes the closure and blob references, and exposes the IR publicly", async () => {
    const [row] = await t.app.db.select().from(releases).where(eq(releases.label, "1.0.0"));
    expect(row).toMatchObject({
      publishState: "done",
      status: "active",
      visibility: "public",
      effectiveRating: "general",
      licenseCheck: "pass",
    });
    if (!row?.contextIrDigest || !row.snapshotDigest) throw new Error("missing artifacts");
    const frags = await t.app.db
      .select()
      .from(releaseFragments)
      .where(eq(releaseFragments.releaseId, row.id));
    expect(frags.map((f) => [f.ownerRef, f.fragmentId])).toEqual([["@djj/alice", "description"]]);
    const refs = await t.app.db.select().from(blobRefs).where(eq(blobRefs.releaseId, row.id));
    expect(new Set(refs.map((r) => r.role))).toEqual(
      new Set(["snapshot", "ir", "manifest", "fragment", "asset"]),
    );

    // public 桶允许匿名读取（模拟 CDN）：IR 可以直接下载，内容与 digest 相符。
    const env = testStorageEnv();
    const url = `${env.S3_ENDPOINT}/${BUCKETS.public}/${casKey(row.contextIrDigest)}`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(sha256Bytes(bytes)).toBe(row.contextIrDigest);
    const ir = JSON.parse(new TextDecoder().decode(bytes));
    expect(ir.root.ref).toBe("@djj/alice");
    expect(ir.fragments[0].content.text).toBe("Alice is a courier in Night City.");
    expect(ir.assets[0].url).toMatch(/^https:\/\/assets\.char\.pub\/cas\/sha256\//);

    // fragment 与 manifest 随 public Release 复制到了 public 桶。
    const [frag] = frags;
    const [fb] = await t.app.db
      .select()
      .from(blobs)
      .where(eq(blobs.digest, frag?.digest ?? ""));
    expect(fb?.inPublic).toBe(true);
    const [c] = await t.app.db.select().from(creations).where(eq(creations.name, "alice"));
    expect(c?.latestReleaseId).toBe(row.id);
  });

  it("is idempotent for the same label and content, and refuses different content", async () => {
    const me = h.as(alice);
    const revs = await json(await me.post("/v1/creations/@djj/alice/revisions", {}));
    const sameLabel = await me.post(
      "/v1/creations/@djj/alice/releases",
      { revision: revs.id, label: "1.0.0", visibility: "public" },
      { "idempotency-key": "uc1-publish-0002" },
    );
    expect(sameLabel.status).toBe(200);
    expect(await json(sameLabel)).toMatchObject({ idempotent: true, state: "active" });
    // 同一个 Idempotency-Key 重放：返回同一个 Release。
    const replay = await me.post(
      "/v1/creations/@djj/alice/releases",
      { revision: revs.id, label: "1.0.0", visibility: "public" },
      { "idempotency-key": "uc1-publish-0001" },
    );
    expect(replay.status).toBe(200);
    expect(await json(replay)).toMatchObject({ release: releaseId, idempotent: true });

    const draft = await json(await me.get("/v1/creations/@djj/alice/draft"));
    const working = { ...(draft.working as Record<string, unknown>), summary: "Changed." };
    expect(
      (
        await me.put(
          "/v1/creations/@djj/alice/draft",
          { working },
          { "if-match": String(draft.version) },
        )
      ).status,
    ).toBe(200);
    const rev2 = await json(await me.post("/v1/creations/@djj/alice/revisions", {}));
    const conflict = await me.post(
      "/v1/creations/@djj/alice/releases",
      { revision: rev2.id, label: "1.0.0", visibility: "public" },
      { "idempotency-key": "uc1-publish-0003" },
    );
    expect(conflict.status).toBe(409);
    expect(await json(conflict)).toMatchObject({ code: "publish.label_taken" });
  });

  it("requires an Idempotency-Key to publish", async () => {
    const me = h.as(alice);
    const rev = await json(await me.post("/v1/creations/@djj/alice/revisions", {}));
    const r = await me.post("/v1/creations/@djj/alice/releases", {
      revision: rev.id,
      label: "2.0.0",
      visibility: "public",
    });
    expect(r.status).toBe(400);
    expect(await json(r)).toMatchObject({ code: "request.idempotency_key_required" });
  });

  it("keeps the audit chain intact", async () => {
    expect(await verifyAuditChain(t.app.db)).toMatchObject({ ok: true });
  });
});

describe("dependencies", () => {
  it("records locks and reverse edges, and fails cleanly on a tombstoned dependency", async () => {
    const me = h.as(alice);
    await me.post("/v1/namespaces/djj/creations", {
      name: "night-city",
      type: "world",
      display_name: "Night City",
    });
    const wd = await json(await me.get("/v1/creations/@djj/night-city/draft"));
    await me.put(
      "/v1/creations/@djj/night-city/draft",
      {
        working: {
          display_name: "Night City",
          fragments: [
            {
              id: "world",
              stable: true,
              kind: "world",
              content: { type: "text", text: "A megacity." },
            },
          ],
          meta: {
            default_locale: "en",
            rating: "mature",
            rights: "original",
            license: "CC-BY-4.0",
          },
        },
      },
      { "if-match": String(wd.version) },
    );
    const wrev = await json(await me.post("/v1/creations/@djj/night-city/revisions", {}));
    const wpub = await json(
      await me.post(
        "/v1/creations/@djj/night-city/releases",
        { revision: wrev.id, label: "1.0.0", visibility: "public" },
        { "idempotency-key": "world-publish-01" },
      ),
    );
    expect(await h.runPublishJobs()).toEqual(["published"]);

    await me.post("/v1/namespaces/djj/creations", {
      name: "bob",
      type: "character",
      display_name: "Bob",
    });
    const bd = await json(await me.get("/v1/creations/@djj/bob/draft"));
    const bob = {
      display_name: "Bob",
      fragments: [
        {
          id: "description",
          stable: true,
          kind: "character",
          content: { type: "text", text: "{{self}} lives here." },
        },
      ],
      references: [
        {
          id: "lives-in",
          use: "@djj/night-city",
          mode: "intrinsic",
          pin: { release: wpub.release, semantic_digest: wrev.semantic_digest },
        },
      ],
      meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
    };
    await me.put(
      "/v1/creations/@djj/bob/draft",
      { working: bob },
      { "if-match": String(bd.version) },
    );
    const brev = await json(await me.post("/v1/creations/@djj/bob/revisions", {}));
    await me.post(
      "/v1/creations/@djj/bob/releases",
      { revision: brev.id, label: "1.0.0", visibility: "public" },
      { "idempotency-key": "bob-publish-0001" },
    );
    expect(await h.runPublishJobs()).toEqual(["published"]);

    const [bobRel] = await t.app.db
      .select()
      .from(releases)
      .innerJoin(creations, eq(creations.id, releases.creationId))
      .where(and(eq(creations.name, "bob"), eq(releases.label, "1.0.0")));
    if (!bobRel) throw new Error("no bob release");
    expect(bobRel.releases.effectiveRating).toBe("mature");
    const locks = await t.app.db
      .select()
      .from(releaseLocks)
      .where(eq(releaseLocks.releaseId, bobRel.releases.id));
    expect(locks).toHaveLength(1);
    expect(locks[0]?.via).toEqual(["lives-in"]);
    const rev = await t.app.db
      .select()
      .from(reverseEdges)
      .where(eq(reverseEdges.dependentReleaseId, bobRel.releases.id));
    expect(rev.map((r) => [r.mode, r.rel])).toEqual([["intrinsic", null]]);
    const frags = await t.app.db
      .select()
      .from(releaseFragments)
      .where(eq(releaseFragments.releaseId, bobRel.releases.id));
    expect(frags.map((f) => f.ownerRef).sort()).toEqual(["@djj/bob", "@djj/night-city"]);

    // 下架依赖后再发布：失败、label 释放、报告说明原因。
    const [world] = await t.app.db.select().from(creations).where(eq(creations.name, "night-city"));
    if (!world) throw new Error("no world");
    await t.app.db
      .update(releases)
      .set({ status: "tombstoned", statusReason: "legal.dmca" })
      .where(eq(releases.creationId, world.id));
    const pub = await me.post(
      "/v1/creations/@djj/bob/releases",
      { revision: brev.id, label: "1.0.1", visibility: "public" },
      { "idempotency-key": "bob-publish-0002" },
    );
    expect(pub.status).toBe(202);
    expect(await h.runPublishJobs()).toEqual(["failed"]);
    const report = await json(await me.get("/v1/creations/@djj/bob/releases/1.0.1/report"));
    expect(report.state).toBe("failed");
    expect((report.report as { issues: { code: string }[] }).issues[0]?.code).toBe(
      "publish.tombstoned_dependency",
    );
    // 失败释放了 label：恢复依赖后可以用同一个 label 再次发布。
    await t.app.db
      .update(releases)
      .set({ status: "active", statusReason: null })
      .where(eq(releases.creationId, world.id));
    const retry = await me.post(
      "/v1/creations/@djj/bob/releases",
      { revision: brev.id, label: "1.0.1", visibility: "public" },
      { "idempotency-key": "bob-publish-0003" },
    );
    expect(retry.status).toBe(202);
    expect(await h.runPublishJobs()).toEqual(["published"]);
  });

  it("fails when an asset is not ready", async () => {
    const me = h.as(alice);
    await me.post("/v1/namespaces/djj/creations", {
      name: "carol",
      type: "character",
      display_name: "Carol",
    });
    const d = await json(await me.get("/v1/creations/@djj/carol/draft"));
    const working = level0({ digest: `sha256:${"e".repeat(64)}`, size: 10 });
    working.display_name = "Carol";
    await me.put("/v1/creations/@djj/carol/draft", { working }, { "if-match": String(d.version) });
    const rev = await json(await me.post("/v1/creations/@djj/carol/revisions", {}));
    await me.post(
      "/v1/creations/@djj/carol/releases",
      { revision: rev.id, label: "1.0.0", visibility: "public" },
      { "idempotency-key": "test-idempotency-carol" },
    );
    expect(await h.runPublishJobs()).toEqual(["failed"]);
    const report = await json(await me.get("/v1/creations/@djj/carol/releases/1.0.0/report"));
    expect((report.report as { issues: { code: string }[] }).issues.map((i) => i.code)).toContain(
      "publish.asset_not_ready",
    );
  });
});

describe("kill switch", () => {
  it("rejects publish requests with 503 while publishing is switched off, and defers queued jobs", async () => {
    const me = h.as(alice);
    const rev = await json(await me.post("/v1/creations/@djj/alice/revisions", {}));
    const pending = await me.post(
      "/v1/creations/@djj/alice/releases",
      { revision: rev.id, label: "3.0.0", visibility: "private" },
      { "idempotency-key": "test-idempotency-kill-a" },
    );
    expect(pending.status).toBe(202);
    await h.setFlag("publish", false);
    try {
      const blocked = await me.post(
        "/v1/creations/@djj/alice/releases",
        { revision: rev.id, label: "3.0.1", visibility: "private" },
        { "idempotency-key": "test-idempotency-kill-b" },
      );
      expect(blocked.status).toBe(503);
      expect(await json(blocked)).toMatchObject({ code: "feature.disabled" });
      // 已经排队的任务暂停，Release 保持 pending。
      expect(await h.runPublishJobs()).toEqual(["deferred"]);
    } finally {
      await h.setFlag("publish", true);
    }
    const { requeuePendingPublishes } = await import("../src/worker/publish.js");
    h.clock.advance(60_000);
    expect(await requeuePendingPublishes(t.app.db, h.queue, h.clock.now())).toBe(1);
    expect(await h.runPublishJobs()).toEqual(["published"]);
    const [row] = await t.app.db.select().from(releases).where(eq(releases.label, "3.0.0"));
    expect(row?.publishState).toBe("done");
    // private Release 的 IR 只在 private 桶。
    const [ir] = await t.app.db
      .select()
      .from(blobs)
      .where(eq(blobs.digest, row?.contextIrDigest ?? ""));
    expect(ir).toMatchObject({ inPrivate: true, inPublic: false });
  });
});

describe("canonical storage", () => {
  it("stores revision content so it can be rebuilt byte-for-byte", async () => {
    const { loadRevisionContent } = await import("../src/registry/content.js");
    const [rev] = await t.app.db.select().from(releases).where(eq(releases.label, "3.0.0"));
    const rebuilt = await loadRevisionContent(cas, rev?.semanticDigest ?? "");
    expect(canonicalizeCreation(rebuilt.json).semantic_digest).toBe(rev?.semanticDigest);
  });
});
