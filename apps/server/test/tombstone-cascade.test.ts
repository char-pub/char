/**
 * yank 与 tombstone 级联。
 *
 * 级联用例：C 是被依赖的 World，B（Lorebook）依赖 C，A（Character）依赖 B。
 * 对 C 的一个 fragment 执行 tombstone 之后：
 * - A、B、C 的 Release 全部进入 tombstoned，读取时返回 410 和原因代码；
 * - 快照、IR 和被下架的 fragment 从 public 桶中删除，CDN 替身收到对应 URL；
 * - 依赖它们的解析报 tombstoned；
 * - 同样的内容不能再次发布；
 * - 审计链完整。
 */
import {
  CharError,
  canonicalizeCreation,
  checkPublish,
  isCharError,
  resolve,
} from "@char-pub/core";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyAuditChain } from "../src/audit/audit.js";
import {
  auditLog,
  blobs,
  blockedDigests,
  moderationActions,
  releases,
} from "../src/db/schema/index.js";
import { QUEUE_NAMES } from "../src/jobs/definitions.js";
import { publicObjectUrl } from "../src/registry/read.js";
import {
  executeTombstone,
  loadBlockedDigests,
  previewTombstone,
  type TombstoneCascadeJob,
} from "../src/registry/tombstone.js";
import { RecordingPurger, runTombstoneCascade } from "../src/worker/tombstone.js";
import { createHarness, type Harness, TEST_PUBLIC_BASE } from "./fixtures/harness.js";
import {
  createNamespace,
  createUser,
  META,
  type PublishedRelease,
  pinOf,
  publishRelease,
  textFragment,
} from "./fixtures/published.js";

let h: Harness;
let staff: string;
let owner: string;
let stranger: string;
let nsId: string;
let c: PublishedRelease;
let b: PublishedRelease;
let a: PublishedRelease;
let unrelated: PublishedRelease;
let bystander: PublishedRelease;

const cWorld = {
  ref: "@commons/night-city",
  type: "world" as const,
  display_name: "Night City",
  fragments: [
    textFragment("world", "world", "A megacity."),
    textFragment("lore/leak", "knowledge", "Infringing text copied from a novel."),
  ],
  meta: { ...META, license: "CC-BY-4.0" },
};

function publicUrl(digest: string) {
  return publicObjectUrl(TEST_PUBLIC_BASE(), digest);
}

beforeAll(async () => {
  h = await createHarness();
  const { db, cas } = h.services;
  staff = await createUser(db, { name: "staff" });
  owner = await createUser(db, { name: "owner" });
  stranger = await createUser(db, { name: "stranger" });
  const commons = await createNamespace(db, "commons");
  nsId = await createNamespace(db, "djj", owner);
  c = await publishRelease({ db, cas, namespaceId: commons, label: "1.0.0", creation: cWorld });
  b = await publishRelease({
    db,
    cas,
    namespaceId: commons,
    label: "1.0.0",
    dependencies: [c],
    creation: {
      ref: "@commons/corps",
      type: "lorebook",
      display_name: "Corps",
      fragments: [textFragment("lore/arasaka", "knowledge", "Arasaka.")],
      references: [{ id: "setting", use: "@commons/night-city", mode: "default", pin: pinOf(c) }],
      meta: META,
    },
  });
  a = await publishRelease({
    db,
    cas,
    namespaceId: nsId,
    label: "1.0.0",
    dependencies: [b],
    creation: {
      ref: "@djj/alice",
      type: "character",
      display_name: "Alice",
      fragments: [textFragment("description", "character", "{{self}} is a courier.")],
      references: [{ id: "knows", use: "@commons/corps", mode: "default", pin: pinOf(b) }],
      meta: META,
    },
  });
  unrelated = await publishRelease({
    db,
    cas,
    namespaceId: nsId,
    label: "1.0.0",
    creation: {
      ref: "@djj/bob",
      type: "character",
      display_name: "Bob",
      fragments: [textFragment("description", "character", "{{self}} is unrelated.")],
      meta: META,
    },
  });
  bystander = await publishRelease({
    db,
    cas,
    namespaceId: nsId,
    label: "2.0.0",
    creation: {
      ref: "@djj/carol",
      type: "character",
      display_name: "Carol",
      fragments: [textFragment("description", "character", "{{self}} gets yanked.")],
      meta: META,
    },
  });
});

afterAll(async () => {
  await h.close();
});

describe("yank", () => {
  const path = "/v1/creations/@djj/carol/releases/2.0.0/yank";

  it("requires membership", async () => {
    const body = JSON.stringify({ reason: "broken" });
    expect((await h.request(path, { method: "POST", body })).status).toBe(401);
    expect((await h.request(path, { method: "POST", body, user: stranger })).status).toBe(403);
  });

  it("validates the reason", async () => {
    const r = await h.request(path, { method: "POST", body: JSON.stringify({}), user: owner });
    expect(r.status).toBe(422);
  });

  it("yanks, keeps the release readable with a warning, and audits", async () => {
    const r = await h.request(path, {
      method: "POST",
      body: JSON.stringify({ reason: "greeting is broken" }),
      user: owner,
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: "yanked", status_reason: "greeting is broken" });
    const read = await (await h.request("/v1/creations/@djj/carol/releases/2.0.0")).json();
    expect(read.warning).toContain("greeting is broken");
    const [log] = await h.services.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.subject, `release:${bystander.releaseId}`));
    expect(log).toMatchObject({ action: "release.yank", actor: { kind: "user", id: owner } });
    // 重复 yank 是幂等的，不会再写一条审计。
    expect(
      (
        await h.request(path, {
          method: "POST",
          body: JSON.stringify({ reason: "again!" }),
          user: owner,
        })
      ).status,
    ).toBe(200);
    const logs = await h.services.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.subject, `release:${bystander.releaseId}`));
    expect(logs).toHaveLength(1);
  });

  it("does not yank tombstoned releases", async () => {
    const { db, cas } = h.services;
    await publishRelease({
      db,
      cas,
      namespaceId: nsId,
      label: "1.0.0",
      status: "tombstoned",
      statusReason: "legal.dmca",
      creation: {
        ref: "@djj/removed",
        type: "character",
        display_name: "Removed",
        fragments: [textFragment("description", "character", "{{self}} was removed.")],
        meta: META,
      },
    });
    const r = await h.request("/v1/creations/@djj/removed/releases/1.0.0/yank", {
      method: "POST",
      body: JSON.stringify({ reason: "cleanup" }),
      user: owner,
    });
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("release.tombstoned");
  });
});

describe("tombstone cascade over A → B → C", () => {
  const leak = () => {
    const f = c.creation.fragments.find((x) => x.id === "lore/leak");
    if (!f) throw new Error("fixture");
    return f.digest;
  };

  it("previews every release that contains the fragment, including downstream ones", async () => {
    const p = await previewTombstone(
      h.services.db,
      { kind: "fragment", digest: leak() },
      {
        publicAssetBaseUrl: TEST_PUBLIC_BASE(),
      },
    );
    expect(p.releases.map((r) => [r.ref, r.via])).toEqual([
      ["@commons/corps", "direct"],
      ["@commons/night-city", "direct"],
      ["@djj/alice", "direct"],
    ]);
    // fragment 在闭包中物化，所以三个 Release 都直接包含它；未受影响的 Release 不在列表里。
    expect(p.releases.map((r) => r.ref)).not.toContain("@djj/bob");
    const digests = p.objects.map((o) => o.digest);
    for (const r of [a, b, c]) {
      expect(digests).toContain(r.irDigest);
      expect(digests).toContain(r.snapshotDigest);
    }
    expect(digests).toContain(leak());
    // 其他共享 fragment（例如 C 的 world）不在删除列表里，除非它就是被下架的对象。
    const world = c.creation.fragments.find((x) => x.id === "world")?.digest;
    expect(digests).not.toContain(world);
    expect(p.cdn_urls).toContain(publicUrl(a.irDigest));
    expect(p.downstream_namespaces).toEqual([]);
    expect(p.block).toEqual([leak()]);
  });

  it("walks reverse edges when a release is tombstoned as a whole", async () => {
    const p = await previewTombstone(
      h.services.db,
      { kind: "release", release_id: c.releaseId },
      {
        publicAssetBaseUrl: TEST_PUBLIC_BASE(),
      },
    );
    expect(p.releases.map((r) => [r.ref, r.via])).toEqual([
      ["@commons/corps", "closure"],
      ["@commons/night-city", "direct"],
      ["@djj/alice", "closure"],
    ]);
    expect(p.downstream_namespaces).toEqual(["djj"]);
    expect(p.block).toEqual([c.semanticDigest]);
  });

  it("rejects invalid input before touching anything", async () => {
    const base = {
      subject: { kind: "fragment" as const, digest: leak() },
      actor: { staff_user_id: staff },
      now: new Date(),
      action_id: h.services.ids.uuid(),
      publicAssetBaseUrl: TEST_PUBLIC_BASE(),
    };
    const code = async (p: Promise<unknown>) =>
      p.then(
        () => "ok",
        (e: unknown) => (isCharError(e) ? e.code : String(e)),
      );
    expect(
      await code(
        executeTombstone(h.services.db, h.queue, {
          ...base,
          reason_code: "bogus" as never,
          note: "long enough reason",
        }),
      ),
    ).toBe("tombstone.invalid_reason");
    expect(
      await code(
        executeTombstone(h.services.db, h.queue, {
          ...base,
          reason_code: "policy.illegal",
          note: "short",
        }),
      ),
    ).toBe("admin.reason_required");
    expect(
      await code(
        executeTombstone(h.services.db, h.queue, {
          ...base,
          reason_code: "legal.dmca",
          note: "DMCA notice received",
        }),
      ),
    ).toBe("admin.legal_request_required");
    expect(
      await code(
        executeTombstone(h.services.db, h.queue, {
          ...base,
          subject: { kind: "fragment", digest: `sha256:${"0".repeat(64)}` },
          reason_code: "policy.illegal",
          note: "long enough reason",
        }),
      ),
    ).toBe("tombstone.subject_not_found");
    const [row] = await h.services.db.select().from(releases).where(eq(releases.id, c.releaseId));
    expect(row?.status).toBe("active");
  });

  it("tombstones, withholds, blocks and audits in one transaction, then removes copies", async () => {
    const { db, cas } = h.services;
    const actionId = h.services.ids.uuid();
    const result = await executeTombstone(db, h.queue, {
      subject: { kind: "fragment", digest: leak() },
      reason_code: "policy.illegal",
      note: "Severe violation confirmed by trust & safety",
      actor: { staff_user_id: staff },
      now: new Date(),
      action_id: actionId,
      publicAssetBaseUrl: TEST_PUBLIC_BASE(),
    });
    expect(result.job_id).not.toBeNull();

    const rels = await db
      .select()
      .from(releases)
      .where(inArray(releases.id, [a.releaseId, b.releaseId, c.releaseId]));
    expect(rels.map((r) => [r.status, r.statusReason])).toEqual([
      ["tombstoned", "policy.illegal"],
      ["tombstoned", "policy.illegal"],
      ["tombstoned", "policy.illegal"],
    ]);
    const [other] = await db.select().from(releases).where(eq(releases.id, unrelated.releaseId));
    expect(other?.status).toBe("active");
    const withheld = await db
      .select()
      .from(blobs)
      .where(inArray(blobs.digest, [a.irDigest, leak()]));
    expect(withheld.map((x) => x.status)).toEqual(["withheld", "withheld"]);
    expect(
      await db.select().from(blockedDigests).where(eq(blockedDigests.digest, leak())),
    ).toHaveLength(1);
    const [action] = await db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.id, actionId));
    expect(action).toMatchObject({ action: "tombstone", blastRadius: { releases: 3 } });

    // 读取立刻返回 410，即使副本还没删除。
    for (const path of [
      "/v1/creations/@djj/alice/releases/1.0.0",
      "/v1/creations/@commons/night-city/releases/1.0.0/ir",
    ]) {
      const r = await h.request(path);
      expect(r.status).toBe(410);
      expect((await r.json()).reason).toBe("policy.illegal");
    }
    // 在 public 桶中还能直接取到（worker 尚未执行）。
    expect((await fetch(publicUrl(a.irDigest))).status).toBe(200);

    // 运行删除任务。
    const jobs = await h.queue.boss.findJobs<TombstoneCascadeJob>(QUEUE_NAMES.tombstoneCascade);
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    if (!job) throw new Error("no job");
    const cdn = new RecordingPurger();
    const run1 = await runTombstoneCascade({ db, cas, cdn, now: () => new Date() }, job.data);
    expect(run1.skipped).toBe(false);
    for (const r of [a, b, c]) {
      expect((await fetch(publicUrl(r.irDigest))).status).toBe(404);
      expect((await fetch(publicUrl(r.snapshotDigest))).status).toBe(404);
      expect(cdn.purged).toContain(publicUrl(r.irDigest));
    }
    expect((await fetch(publicUrl(leak()))).status).toBe(404);
    // 未受影响的 Release 与共享的其他 fragment 仍然可以下载。
    expect((await fetch(publicUrl(unrelated.irDigest))).status).toBe(200);
    const world = c.creation.fragments.find((x) => x.id === "world")?.digest ?? "";
    expect((await fetch(publicUrl(world))).status).toBe(200);

    // 重复投递：不再重复执行，也不再写审计。
    const run2 = await runTombstoneCascade({ db, cas, cdn, now: () => new Date() }, job.data);
    expect(run2.skipped).toBe(true);
    expect(cdn.purged.filter((u) => u === publicUrl(a.irDigest))).toHaveLength(1);

    const chain = await verifyAuditChain(db);
    expect(chain.ok).toBe(true);
    const actions = (await db.select({ a: auditLog.action }).from(auditLog)).map((x) => x.a);
    expect(actions).toContain("release.tombstone");
    expect(actions.filter((x) => x === "tombstone.copies_removed")).toHaveLength(1);
  });

  it("makes resolve fail with the reason for anything depending on a tombstoned release", async () => {
    const [row] = await h.services.db.select().from(releases).where(eq(releases.id, b.releaseId));
    const creation = {
      id: "cr_01h455vb4pex5vsknk084sn0zz",
      ref: "@djj/newcomer",
      type: "character" as const,
      display_name: "Newcomer",
      fragments: [textFragment("description", "character", "{{self}} is new.")],
      references: [{ id: "knows", use: "@commons/corps", mode: "default" as const, pin: pinOf(b) }],
      meta: META,
    };
    let err: unknown;
    try {
      resolve({
        root: { release: "rel_01h455vb4pex5vsknk084sn0zz", visibility: "public", creation },
        dependencies: [
          { ...b.input, status: row?.status ?? "active", status_reason: row?.statusReason ?? "" },
          { ...c.input, status: "tombstoned", status_reason: "policy.illegal" },
        ],
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CharError);
    expect((err as CharError).code).toBe("resolve.tombstoned");
    expect((err as CharError).detail).toBe("policy.illegal");
  });

  it("blocks republishing the same content under a new name", async () => {
    const renamed = { ...cWorld, id: "cr_01h455vb4pex5vsknk084sn0zy", ref: "@djj/copy" };
    const candidates = canonicalizeCreation(renamed).creation.fragments.map((f) => f.digest);
    const blocked = await loadBlockedDigests(h.services.db, candidates);
    expect(blocked.has(leak())).toBe(true);
    const report = checkPublish({
      release: "rel_01h455vb4pex5vsknk084sn0zy",
      label: "1.0.0",
      visibility: "public",
      creation: renamed,
      dependencies: [],
      registry: {
        existingLabels: {},
        assetStatus: {},
        blockedDigests: blocked,
        ownerNamespaces: new Set(["djj"]),
      },
    });
    expect(report.ok).toBe(false);
    expect(report.issues.map((i) => i.code)).toContain("publish.blocked_content");
  });
});
