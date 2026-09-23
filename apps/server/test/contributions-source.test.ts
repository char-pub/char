/**
 * Contribution 流程的辅助接口：Release 的源内容（贡献者修改的基线）、作者的邀请名单、
 * 列表与详情中的作者显示信息、访客查看自己的提交。
 */
import { canonicalFragment } from "@char-pub/core";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creations, releases } from "../src/db/schema/index.js";
import {
  type ContributionHarness,
  createContributionHarness,
  userTypeId,
} from "./contributions-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let h: ContributionHarness;
const cas = testCas();

const frag = (id: string, text: string) => ({
  id,
  stable: true,
  kind: "character" as const,
  content: { type: "text" as const, text },
});

const WORKING = {
  display_name: "Alice",
  fragments: [frag("description", "{{self}} is a courier."), frag("likes", "{{self}} likes tea.")],
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
};

const ACK = { inbound_equals_outbound: true };

async function json(r: Response) {
  return (await r.json()) as Record<string, unknown>;
}

async function releaseRow(path: string, label: string) {
  const name = path.split("/").pop() ?? "";
  const [row] = await t.app.db
    .select({ id: releases.id, semanticDigest: releases.semanticDigest })
    .from(releases)
    .innerJoin(creations, eq(creations.id, releases.creationId))
    .where(and(eq(creations.name, name), eq(releases.label, label)));
  if (!row) throw new Error(`no release ${path}@${label}`);
  return row;
}

beforeAll(async () => {
  t = await createTestDatabase();
  h = await createContributionHarness(t, cas);
});

afterAll(async () => {
  await h.close();
  await t.drop();
});

describe("release source", () => {
  let path: string;
  let owner: string;
  let revision: string;

  beforeAll(async () => {
    ({ owner, path, revision } = await h.setupCreation("src", "courier", WORKING));
  });

  it("returns the revision and canonical creation of a public release to anyone", async () => {
    const r = await h.anonymous().get(`${path}/releases/0.1.0/source`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
    const body = await json(r);
    const row = await releaseRow(path, "0.1.0");
    expect(body.revision).toBe(revision);
    expect(body.semantic_digest).toBe(row.semanticDigest);
    expect(body.warning).toBeUndefined();
    const creation = body.creation as {
      ref: string;
      fragments: { id: string; digest: string }[];
    };
    expect(creation.ref).toBe("@src/courier");
    // 返回的就是 canonical 形式：每个 fragment 的 digest 可以由内容重新算出。
    expect(creation.fragments.map((f) => f.digest)).toEqual(
      WORKING.fragments.map((f) => canonicalFragment(f).digest),
    );
  });

  it("is a usable base for a contribution", async () => {
    const contributor = await h.createUser("src-contrib");
    const src = await json(await h.asUser(contributor).get(`${path}/releases/0.1.0/source`));
    const base = (src.creation as { fragments: { id: string; digest: string }[] }).fragments[0];
    const r = await h.asUser(contributor).post(`${path}/contributions`, {
      title: "Faster",
      base_revision: src.revision,
      changes: [
        {
          on: "fragment",
          op: "modify",
          id: "description",
          base_digest: base?.digest,
          after: frag("description", "{{self}} is a fast courier."),
        },
      ],
      rights_ack: ACK,
    });
    expect(r.status).toBe(201);
  });

  it("hides private releases from everyone but members", async () => {
    const me = h.asUser(owner);
    const rev = await json(await me.post(`${path}/revisions`, { message: "private" }));
    const pub = await me.post(
      `${path}/releases`,
      { revision: rev.id, label: "0.2.0-beta", visibility: "private" },
      { "idempotency-key": "src-private-0001" },
    );
    expect(pub.status).toBe(202);
    await h.runPublishJobs();

    const stranger = await h.createUser("src-stranger");
    expect((await h.anonymous().get(`${path}/releases/0.2.0-beta/source`)).status).toBe(404);
    expect((await h.asUser(stranger).get(`${path}/releases/0.2.0-beta/source`)).status).toBe(404);
    const own = await me.get(`${path}/releases/0.2.0-beta/source`);
    expect(own.status).toBe(200);
    expect(own.headers.get("cache-control")).toBe("private, no-store");
    expect((await json(own)).revision).toBe(rev.id);
  });

  it("returns yanked releases with a warning and tombstoned ones as 410", async () => {
    const row = await releaseRow(path, "0.1.0");
    await t.owner.db
      .update(releases)
      .set({ status: "yanked", statusReason: "typo" })
      .where(eq(releases.id, row.id));
    const yanked = await json(await h.anonymous().get(`${path}/releases/0.1.0/source`));
    expect(yanked.warning).toBe("release 0.1.0 was yanked: typo");

    await t.owner.db
      .update(releases)
      .set({ status: "tombstoned", statusReason: "legal.dmca" })
      .where(eq(releases.id, row.id));
    const gone = await h.asUser(owner).get(`${path}/releases/0.1.0/source`);
    expect(gone.status).toBe(410);
    expect(await json(gone)).toMatchObject({ code: "release.tombstoned", reason: "legal.dmca" });
  });

  it("returns 404 for unknown labels", async () => {
    expect((await h.anonymous().get(`${path}/releases/9.9.9/source`)).status).toBe(404);
  });
});

describe("invite list", () => {
  it("lists invited users with names and namespaces, only to the author", async () => {
    const { owner, path } = await h.setupCreation("inv", "courier", WORKING);
    const invitee = await h.createUser("invitee");
    expect((await h.asUser(invitee).post("/v1/namespaces", { slug: "invitee" })).status).toBe(201);
    const plain = await h.createUser("plain");
    const me = h.asUser(owner);
    expect((await me.put(`${path}/contribution-settings`, { policy: "invited" })).status).toBe(200);
    for (const u of [invitee, plain]) {
      expect((await me.post(`${path}/contribution-invites`, { user: userTypeId(u) })).status).toBe(
        200,
      );
    }

    const r = await me.get(`${path}/contribution-invites`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    const body = (await r.json()) as { items: Record<string, unknown>[] };
    expect(body.items.map((i) => ({ ...i, invited_at: typeof i.invited_at }))).toEqual([
      {
        user: userTypeId(invitee),
        display_name: "invitee",
        namespace: "@invitee",
        invited_at: "string",
      },
      { user: userTypeId(plain), display_name: "plain", namespace: null, invited_at: "string" },
    ]);
    expect(JSON.stringify(body)).not.toContain("@example.test");

    // 被邀请的人与其他登录用户都看不到名单；匿名请求要求先登录。
    for (const who of [invitee, plain]) {
      const r = await h.asUser(who).get(`${path}/contribution-invites`);
      expect(r.status).toBe(403);
    }
    expect((await h.anonymous().get(`${path}/contribution-invites`)).status).toBe(401);
  });
});

describe("author display", () => {
  it("shows the display name and namespace of signed-in contributors, never the email", async () => {
    const { owner, path, revision } = await h.setupCreation("disp", "courier", WORKING);
    const named = await h.createUser("named");
    expect((await h.asUser(named).post("/v1/namespaces", { slug: "named" })).status).toBe(201);
    const bare = await h.createUser("bare");
    const base = canonicalFragment(WORKING.fragments[0] ?? frag("x", "")).digest;
    for (const [u, text] of [
      [named, "{{self}} is a named courier."],
      [bare, "{{self}} is a bare courier."],
    ] as const) {
      const r = await h.asUser(u).post(`${path}/contributions`, {
        title: text,
        base_revision: revision,
        changes: [
          {
            on: "fragment",
            op: "modify",
            id: "description",
            base_digest: base,
            after: frag("description", text),
          },
        ],
        rights_ack: ACK,
      });
      expect(r.status).toBe(201);
    }

    const list = (await json(await h.asUser(owner).get(`${path}/contributions`))) as {
      items: { number: number; author: unknown }[];
    };
    expect(list.items.map((i) => [i.number, i.author])).toEqual([
      [2, { user: userTypeId(bare), display_name: "bare" }],
      [1, { user: userTypeId(named), display_name: "named", namespace: "@named" }],
    ]);
    expect(JSON.stringify(list)).not.toContain("@example.test");

    const detail = await json(await h.asUser(named).get(`${path}/contributions/1`));
    expect(detail.author).toEqual({
      user: userTypeId(named),
      display_name: "named",
      namespace: "@named",
    });
  });
});

describe("guests see their own contributions", () => {
  it("lists only the guest's own submissions", async () => {
    const { owner, path, revision } = await h.setupCreation("gst", "courier", WORKING);
    expect(
      (await h.asUser(owner).put(`${path}/contribution-settings`, { policy: "anyone" })).status,
    ).toBe(200);
    await h.createGuest("gst_one", "One");
    await h.createGuest("gst_two", "Two");
    const base = canonicalFragment(WORKING.fragments[0] ?? frag("x", "")).digest;
    for (const [g, text] of [
      ["gst_one", "{{self}} is courier one."],
      ["gst_two", "{{self}} is courier two."],
    ] as const) {
      const r = await h.asGuest(g).post(`${path}/contributions`, {
        title: text,
        base_revision: revision,
        changes: [
          {
            on: "fragment",
            op: "modify",
            id: "description",
            base_digest: base,
            after: frag("description", text),
          },
        ],
        rights_ack: ACK,
      });
      expect(r.status).toBe(201);
    }

    const mine = (await json(await h.asGuest("gst_one").get(`${path}/contributions`))) as {
      items: { number: number; author: unknown }[];
    };
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0]?.author).toEqual({ guest_id: "gst_one", display_name: "One" });

    const theirs = (await json(await h.asGuest("gst_two").get(`${path}/contributions`))) as {
      items: { number: number }[];
    };
    expect(theirs.items.map((i) => i.number)).toEqual([2]);

    // 没有会话的访客 cookie 按匿名处理，看不到任何条目；作者看到全部。
    const anon = (await json(await h.asGuest("gst_nobody").get(`${path}/contributions`))) as {
      items: unknown[];
    };
    expect(anon.items).toEqual([]);
    const all = (await json(await h.asUser(owner).get(`${path}/contributions`))) as {
      items: unknown[];
    };
    expect(all.items).toHaveLength(2);
  });
});
