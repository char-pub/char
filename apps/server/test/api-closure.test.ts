/**
 * 发布任务的边界情况：传递依赖（A → B → C）从快照中重建、内容被篡改时发布失败、
 * 重复投递的任务不重复生效、格式错误的 ID。
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blobRefs, releaseFragments, releaseLocks, releases } from "../src/db/schema/index.js";
import { decodeId, encodeId } from "../src/registry/ids.js";
import { handlePublish } from "../src/worker/publish.js";
import { type ApiHarness, createHarness } from "./api-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let h: ApiHarness;
let user: string;
const cas = testCas();

beforeAll(async () => {
  t = await createTestDatabase();
  h = await createHarness(t, cas);
  user = await h.createUser("chain");
  await h.as(user).post("/v1/namespaces", { slug: "chain" });
});

afterAll(async () => {
  await h.close();
  await t.drop();
});

async function json(r: Response) {
  return (await r.json()) as Record<string, unknown>;
}

const META = { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" };

/** 建一个 Creation、保存草稿、创建 Revision、发布并运行 worker，返回 Release 与 Revision。 */
async function publish(
  name: string,
  type: "world" | "lorebook" | "character",
  working: Record<string, unknown>,
  label = "1.0.0",
) {
  const me = h.as(user);
  await me.post("/v1/namespaces/chain/creations", { name, type, display_name: name });
  const d = await json(await me.get(`/v1/creations/@chain/${name}/draft`));
  const put = await me.put(
    `/v1/creations/@chain/${name}/draft`,
    { working },
    { "if-match": String(d.version) },
  );
  expect(put.status).toBe(200);
  const rev = await json(await me.post(`/v1/creations/@chain/${name}/revisions`, {}));
  const pub = await json(
    await me.post(
      `/v1/creations/@chain/${name}/releases`,
      { revision: rev.id, label, visibility: "public" },
      { "idempotency-key": `chain-${name}-${label}` },
    ),
  );
  const outcomes = await h.runPublishJobs();
  return { release: pub.release as string, semantic: rev.semantic_digest as string, outcomes };
}

describe("transitive dependencies", () => {
  it("rebuilds C from B's snapshot when A depends on B depends on C", async () => {
    const c = await publish("city", "world", {
      display_name: "City",
      fragments: [
        { id: "world", stable: true, kind: "world", content: { type: "text", text: "A city." } },
      ],
      meta: { ...META, rating: "teen" },
    });
    expect(c.outcomes).toEqual(["published"]);
    const b = await publish("guilds", "lorebook", {
      display_name: "Guilds",
      fragments: [
        {
          id: "lore/thieves",
          stable: true,
          kind: "knowledge",
          content: { type: "text", text: "The thieves guild." },
          activation: { mode: "keyword", keys: ["thief"] },
        },
      ],
      references: [
        {
          id: "setting",
          use: "@chain/city",
          mode: "default",
          pin: { release: c.release, semantic_digest: c.semantic },
        },
      ],
      meta: META,
    });
    expect(b.outcomes).toEqual(["published"]);
    const a = await publish("rogue", "character", {
      display_name: "Rogue",
      fragments: [
        {
          id: "description",
          stable: true,
          kind: "character",
          content: { type: "text", text: "{{self}} steals." },
        },
      ],
      references: [
        {
          id: "knows",
          use: "@chain/guilds",
          mode: "default",
          pin: { release: b.release, semantic_digest: b.semantic },
        },
      ],
      meta: META,
    });
    expect(a.outcomes).toEqual(["published"]);

    const id = decodeId("release", a.release) ?? "";
    const [row] = await t.app.db.select().from(releases).where(eq(releases.id, id));
    // effective rating 取闭包最大值：C 是 teen。
    expect(row?.effectiveRating).toBe("teen");
    const locks = await t.app.db.select().from(releaseLocks).where(eq(releaseLocks.releaseId, id));
    expect(locks.map((l) => l.via).sort()).toEqual([["knows"], ["knows", "setting"]]);
    const frags = await t.app.db
      .select()
      .from(releaseFragments)
      .where(eq(releaseFragments.releaseId, id));
    expect(frags.map((f) => f.ownerRef).sort()).toEqual([
      "@chain/city",
      "@chain/guilds",
      "@chain/rogue",
    ]);
    // 下架 C 的 fragment 时，通过 blob_refs 能找到 A。
    const cityFrag = frags.find((f) => f.ownerRef === "@chain/city");
    const refs = await t.app.db
      .select()
      .from(blobRefs)
      .where(eq(blobRefs.digest, cityFrag?.digest ?? ""));
    expect(refs.map((r) => r.releaseId)).toContain(id);
  });

  it("fails when a pinned release is unknown", async () => {
    const r = await publish(
      "orphan",
      "character",
      {
        display_name: "Orphan",
        fragments: [
          {
            id: "description",
            stable: true,
            kind: "character",
            content: { type: "text", text: "x" },
          },
        ],
        references: [
          {
            id: "missing",
            use: "@chain/city",
            mode: "default",
            pin: {
              release: encodeId("release", "01890a5d-ac96-774b-bcce-b302099a8057"),
              semantic_digest: `sha256:${"0".repeat(64)}`,
            },
          },
        ],
        meta: META,
      },
      "1.0.0",
    );
    expect(r.outcomes).toEqual(["failed"]);
    const report = await json(
      await h.as(user).get("/v1/creations/@chain/orphan/releases/1.0.0/report"),
    );
    expect((report.report as { issues: { code: string }[] }).issues[0]?.code).toBe(
      "publish.dependency_unavailable",
    );
  });
});

describe("worker robustness", () => {
  it("skips unknown or already finished releases, and fails on corrupted content", async () => {
    expect(
      await handlePublish(h.publishDeps, { release_id: "01890a5d-ac96-774b-bcce-b302099a8057" }),
    ).toBe("skipped");
    const [done] = await t.app.db
      .select()
      .from(releases)
      .where(eq(releases.publishState, "done"))
      .limit(1);
    expect(await handlePublish(h.publishDeps, { release_id: done?.id ?? "" })).toBe("skipped");

    // 伪造一个指向不存在内容的 pending Release：重建失败，发布标记为 failed。
    const [any] = await t.app.db.select().from(releases).limit(1);
    if (!any) throw new Error("no release");
    const id = "01890a5d-ac96-774b-bcce-b302099a8058";
    await t.app.db.insert(releases).values({
      ...any,
      id,
      label: "9.9.9",
      publishState: "pending",
      semanticDigest: `sha256:${"1".repeat(64)}`,
      idempotencyKey: "corrupt-case-01",
      publishReport: null,
    });
    expect(await handlePublish(h.publishDeps, { release_id: id })).toBe("failed");
    const [row] = await t.app.db.select().from(releases).where(eq(releases.id, id));
    expect(row?.publishState).toBe("failed");
  });

  it("rejects malformed ids and unknown creations", async () => {
    const me = h.as(user);
    expect((await me.get("/v1/creations/@chain/nope/draft")).status).toBe(404);
    expect((await me.get("/v1/creations/@nobody/nope/draft")).status).toBe(404);
    const bad = await me.post(
      "/v1/creations/@chain/rogue/releases",
      { revision: "not-a-typeid", label: "2.0.0", visibility: "public" },
      { "idempotency-key": "test-idempotency-bad-rev" },
    );
    expect(bad.status).toBe(404);
    expect((await me.delete("/v1/me/tokens/not-a-uuid")).status).toBe(404);
    expect(decodeId("release", "cr_01h455vb4pex5vsknk084sn02q")).toBeNull();
    expect((await me.get("/v1/creations/@chain/rogue/releases/0.0.1/report")).status).toBe(404);
  });
});
