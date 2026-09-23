/**
 * Native → Native Contribution 的集成测试：提交、预览、自动 rebase、冲突、敏感变更的
 * 逐项确认、授权、agent 标记、限流、kill switch、贡献授权，以及接受后发布时贡献者进入
 * Context IR。
 */
import { canonicalFragment, digestOf } from "@char-pub/core";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyAuditChain } from "../src/audit/audit.js";
import { contributions, creations, releases } from "../src/db/schema/index.js";
import { casKey } from "../src/storage/cas.js";
import {
  type ContributionHarness,
  createContributionHarness,
  userTypeId,
} from "./contributions-harness.js";
import { BUCKETS } from "./global-setup.js";
import { createTestDatabase, type TestDatabase, testCas, testStorageEnv } from "./helpers.js";

let t: TestDatabase;
let h: ContributionHarness;
let contributor: string;
let stranger: string;
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

const digest = (f: ReturnType<typeof frag>) => canonicalFragment(f).digest;

function modify(id: string, before: string, after: string) {
  return {
    on: "fragment",
    op: "modify",
    id,
    base_digest: digest(frag(id, before)),
    after: frag(id, after),
  };
}

const ACK = { inbound_equals_outbound: true };

async function json(r: Response) {
  return (await r.json()) as Record<string, unknown>;
}

beforeAll(async () => {
  t = await createTestDatabase();
  h = await createContributionHarness(t, cas);
  contributor = await h.createUser("contrib");
  stranger = await h.createUser("stranger");
});

afterAll(async () => {
  await h.close();
  await t.drop();
});

describe("UC-5: automatic rebase and acceptance", () => {
  let path: string;
  let revision: string;
  let owner: string;

  it("accepts a contribution after the author changed another fragment", async () => {
    ({ owner, path, revision } = await h.setupCreation("uc5", "courier", WORKING));
    const submit = await h.asUser(contributor).post(`${path}/contributions`, {
      title: "Better description",
      base_revision: revision,
      changes: [modify("description", "{{self}} is a courier.", "{{self}} is a fast courier.")],
      rights_ack: ACK,
    });
    expect(submit.status).toBe(201);
    const created = await json(submit);
    expect(created).toMatchObject({ number: 1, status: "open", agent: false, sensitive_keys: [] });

    // 作者同时改了另一个 fragment。
    await h.editDraft(owner, path, (w) => {
      (w.fragments as ReturnType<typeof frag>[])[1] = frag("likes", "{{self}} likes coffee.");
    });

    const detail = await json(await h.asUser(owner).get(`${path}/contributions/1`));
    expect(detail.preview).toMatchObject({ mergeable: true, conflicts: [] });

    const accept = await h.asUser(owner).post(`${path}/contributions/1/accept`, {});
    expect(accept.status).toBe(200);
    const accepted = await json(accept);
    expect(accepted).toMatchObject({ status: "accepted", applied: ["fragment:description"] });

    const d = await h.draft(owner, path);
    const texts = (d.working.fragments as { content: { text: string } }[]).map(
      (f) => f.content.text,
    );
    expect(texts).toEqual(["{{self}} is a fast courier.", "{{self}} likes coffee."]);
    const provenance = d.working.provenance as { contributors: { author: string }[] };
    expect(provenance.contributors.map((c) => c.author)).toEqual([userTypeId(contributor)]);

    const [row] = await t.app.db.select().from(contributions).where(eq(contributions.number, 1));
    expect(row?.status).toBe("accepted");
    expect(row?.resultRevisionId).toBeTruthy();
  });

  it("puts the contributor into the next release's Context IR", async () => {
    const me = h.asUser(owner);
    const rev = await json(await me.post(`${path}/revisions`, {}));
    const pub = await me.post(
      `${path}/releases`,
      { revision: rev.id, label: "1.0.0", visibility: "public" },
      { "idempotency-key": "uc5-publish-0001" },
    );
    expect(pub.status).toBe(202);
    expect(await h.runPublishJobs()).toEqual(["published"]);
    const [creation] = await t.app.db.select().from(creations).where(eq(creations.name, "courier"));
    const [rel] = await t.app.db
      .select()
      .from(releases)
      .where(and(eq(releases.creationId, creation?.id ?? ""), eq(releases.label, "1.0.0")));
    const url = `${testStorageEnv().S3_ENDPOINT}/${BUCKETS.public}/${casKey(rel?.contextIrDigest ?? "")}`;
    const ir = await (await fetch(url)).json();
    expect(ir.meta.contributors).toEqual([
      expect.objectContaining({ ref: "@uc5/courier", author: userTypeId(contributor) }),
    ]);
  });

  it("an accepted contribution cannot be accepted again", async () => {
    const r = await h.asUser(owner).post(`${path}/contributions/1/accept`, {});
    expect(r.status).toBe(403);
    expect(await json(r)).toMatchObject({ code: "contribution.not_open" });
  });

  it("the same change submitted again is already applied, not a conflict", async () => {
    const rev = await json(await h.asUser(owner).post(`${path}/revisions`, {}));
    const again = await h.asUser(stranger).post(`${path}/contributions`, {
      title: "Same idea",
      base_revision: revision,
      changes: [modify("description", "{{self}} is a courier.", "{{self}} is a fast courier.")],
      rights_ack: ACK,
    });
    expect(again.status).toBe(201);
    const n = (await json(again)).number;
    const detail = await json(await h.asUser(owner).get(`${path}/contributions/${n}`));
    expect(detail.preview).toMatchObject({
      mergeable: true,
      outcomes: [expect.objectContaining({ state: "already_applied" })],
    });
    const acc = await json(await h.asUser(owner).post(`${path}/contributions/${n}/accept`, {}));
    expect(acc).toMatchObject({ applied: [], already_applied: ["fragment:description"] });
    expect(rev.id).toBeTruthy();
  });
});

describe("conflicts", () => {
  it("reports a conflict when both sides changed the same fragment, and leaves the draft alone", async () => {
    const { owner, path, revision } = await h.setupCreation("conf", "alice", WORKING);
    await h.asUser(contributor).post(`${path}/contributions`, {
      title: "Mine",
      base_revision: revision,
      changes: [modify("likes", "{{self}} likes tea.", "{{self}} likes green tea.")],
      rights_ack: ACK,
    });
    await h.editDraft(owner, path, (w) => {
      (w.fragments as ReturnType<typeof frag>[])[1] = frag("likes", "{{self}} likes black tea.");
    });
    const before = await h.draft(owner, path);
    const detail = await json(await h.asUser(owner).get(`${path}/contributions/1`));
    expect(detail.preview).toMatchObject({ mergeable: false, conflicts: ["fragment:likes"] });
    const r = await h.asUser(owner).post(`${path}/contributions/1/accept`, {});
    expect(r.status).toBe(409);
    expect(await json(r)).toMatchObject({
      code: "contribution.conflict",
      conflicts: [{ key: "fragment:likes", reason: "diverged" }],
    });
    expect(await h.draft(owner, path)).toEqual(before);
  });
});

describe("sensitive changes need one-by-one confirmation", () => {
  it("rejects acceptance until rating and license changes are confirmed individually", async () => {
    const { owner, path, revision } = await h.setupCreation("sens", "alice", WORKING);
    const r = await h.asUser(contributor).post(`${path}/contributions`, {
      title: "Rating and license",
      base_revision: revision,
      changes: [
        {
          on: "metadata",
          field: "meta.rating",
          op: "set",
          base_digest: digestOf("general"),
          after: "teen",
          // 客户端声称不敏感：服务端不采信。
          sensitive: false,
        },
        {
          on: "metadata",
          field: "meta.license",
          op: "set",
          base_digest: digestOf("CC-BY-4.0"),
          after: "CC-BY-SA-4.0",
          sensitive: false,
        },
      ],
      rights_ack: ACK,
    });
    expect(r.status).toBe(201);
    expect((await json(r)).sensitive_keys).toEqual([
      "metadata:meta.rating",
      "metadata:meta.license",
    ]);

    const none = await h.asUser(owner).post(`${path}/contributions/1/accept`, {});
    expect(none.status).toBe(422);
    expect(await json(none)).toMatchObject({ code: "contribution.sensitive_unconfirmed" });
    const partial = await h.asUser(owner).post(`${path}/contributions/1/accept`, {
      confirm_sensitive: ["metadata:meta.rating"],
    });
    expect(partial.status).toBe(422);
    const wildcard = await h.asUser(owner).post(`${path}/contributions/1/accept`, {
      confirm_sensitive: ["metadata:*"],
    });
    expect(wildcard.status).toBe(422);
    expect(await json(wildcard)).toMatchObject({ code: "contribution.sensitive_wildcard" });

    const ok = await h.asUser(owner).post(`${path}/contributions/1/accept`, {
      confirm_sensitive: ["metadata:meta.rating", "metadata:meta.license"],
    });
    expect(ok.status).toBe(200);
    const d = await h.draft(owner, path);
    expect(d.working.meta).toMatchObject({ rating: "teen", license: "CC-BY-SA-4.0" });
  });
});

describe("authorization", () => {
  let path: string;
  let revision: string;
  let owner: string;

  beforeAll(async () => {
    ({ owner, path, revision } = await h.setupCreation("authz", "alice", WORKING));
  });

  const body = () => ({
    title: "Change",
    base_revision: revision,
    changes: [modify("likes", "{{self}} likes tea.", "{{self}} likes cake.")],
    rights_ack: ACK,
  });

  async function setPolicy(policy: string) {
    const r = await h.asUser(owner).put(`${path}/contribution-settings`, { policy });
    expect(r.status).toBe(200);
  }

  it("signed-in: anonymous gets 401", async () => {
    await setPolicy("signed-in");
    const r = await h.anonymous().post(`${path}/contributions`, body());
    expect(r.status).toBe(401);
  });

  it("closed: 403", async () => {
    await setPolicy("closed");
    const r = await h.asUser(contributor).post(`${path}/contributions`, body());
    expect(r.status).toBe(403);
    expect(await json(r)).toMatchObject({ code: "contribution.closed" });
  });

  it("invited: only invited users and members", async () => {
    await setPolicy("invited");
    const denied = await h.asUser(contributor).post(`${path}/contributions`, body());
    expect(denied.status).toBe(403);
    expect(await json(denied)).toMatchObject({ code: "contribution.not_invited" });
    const inv = await h.asUser(owner).post(`${path}/contribution-invites`, {
      user: userTypeId(contributor),
    });
    expect(inv.status).toBe(200);
    expect((await h.asUser(contributor).post(`${path}/contributions`, body())).status).toBe(201);
    // 只有成员能改设置与邀请名单。
    expect(
      (
        await h
          .asUser(stranger)
          .post(`${path}/contribution-invites`, { user: userTypeId(stranger) })
      ).status,
    ).toBe(403);
    const un = await h
      .asUser(owner)
      .delete(`${path}/contribution-invites/${userTypeId(contributor)}`);
    expect(un.status).toBe(200);
    expect((await h.asUser(contributor).post(`${path}/contributions`, body())).status).toBe(403);
  });

  it("anyone: verified guests can contribute unless guest access is switched off", async () => {
    await setPolicy("anyone");
    await h.createGuest("guest-1", "Visitor");
    const ok = await h.asGuest("guest-1").post(`${path}/contributions`, body());
    expect(ok.status).toBe(201);
    const number = (await json(ok)).number;
    const detail = await json(await h.asGuest("guest-1").get(`${path}/contributions/${number}`));
    expect(detail.author).toEqual({ guest_id: "guest-1", display_name: "Visitor" });
    // 接受访客的 Contribution 后，provenance 里记录的是访客的显示名。
    const acc = await h.asUser(owner).post(`${path}/contributions/${number}/accept`, {});
    expect(acc.status).toBe(200);
    const d = await h.draft(owner, path);
    expect((d.working.provenance as { contributors: unknown[] }).contributors).toEqual([
      expect.objectContaining({ author: { guest_id: "guest-1", display_name: "Visitor" } }),
    ]);
    // 没有访客会话（或会话无效）的请求按匿名处理，不能提交。
    expect((await h.asGuest("nobody").post(`${path}/contributions`, body())).status).toBe(401);
    await h.setFlag("guest_access", false);
    expect((await h.asGuest("guest-1").post(`${path}/contributions`, body())).status).toBe(503);
    await h.setFlag("guest_access", true);
  });

  it("others cannot see, decide or withdraw someone else's contribution", async () => {
    await setPolicy("signed-in");
    const r = await h.asUser(contributor).post(`${path}/contributions`, body());
    const n = (await json(r)).number;
    expect((await h.asUser(stranger).get(`${path}/contributions/${n}`)).status).toBe(404);
    expect((await h.anonymous().get(`${path}/contributions/${n}`)).status).toBe(404);
    expect((await h.asUser(stranger).post(`${path}/contributions/${n}/accept`, {})).status).toBe(
      404,
    );
    expect((await h.asUser(contributor).post(`${path}/contributions/${n}/accept`, {})).status).toBe(
      403,
    );
    expect(
      (await h.asUser(contributor).post(`${path}/contributions/${n}/reject`, { reason: "no" }))
        .status,
    ).toBe(403);
    expect((await h.asUser(owner).post(`${path}/contributions/${n}/withdraw`, {})).status).toBe(
      403,
    );
    const w = await h.asUser(contributor).post(`${path}/contributions/${n}/withdraw`, {});
    expect(w.status).toBe(200);
    expect(await json(w)).toMatchObject({ status: "withdrawn" });
    // 列表：非成员只看到自己的，匿名看不到。
    const mine = await json(await h.asUser(contributor).get(`${path}/contributions`));
    expect((mine.items as unknown[]).length).toBeGreaterThan(0);
    const anon = await json(await h.anonymous().get(`${path}/contributions`));
    expect(anon.items).toEqual([]);
  });

  it("members can reject", async () => {
    const r = await h.asUser(contributor).post(`${path}/contributions`, body());
    const n = (await json(r)).number;
    const rej = await h
      .asUser(owner)
      .post(`${path}/contributions/${n}/reject`, { reason: "not now" });
    expect(rej.status).toBe(200);
    expect(await json(await h.asUser(owner).get(`${path}/contributions/${n}`))).toMatchObject({
      status: "rejected",
      preview: null,
    });
  });
});

describe("agents, rate limits and the kill switch", () => {
  let path: string;
  let revision: string;
  let owner: string;

  beforeAll(async () => {
    ({ owner, path, revision } = await h.setupCreation("agents", "alice", WORKING));
  });

  const body = (extra: Record<string, unknown> = {}) => ({
    title: "Agent change",
    base_revision: revision,
    changes: [modify("likes", "{{self}} likes tea.", "{{self}} likes pie.")],
    rights_ack: ACK,
    ...extra,
  });

  it("marks agent-token submissions as agent, even if the body says otherwise", async () => {
    const bot = await h.token(contributor, { agent: true });
    const r = await bot.post(`${path}/contributions`, body({ agent: false }));
    expect(r.status).toBe(201);
    expect((await json(r)).agent).toBe(true);
    const human = await h.asUser(contributor).post(`${path}/contributions`, body());
    expect((await json(human)).agent).toBe(false);
    const selfDeclared = await h
      .asUser(contributor)
      .post(`${path}/contributions`, body({ agent: true }));
    expect((await json(selfDeclared)).agent).toBe(true);

    const filtered = await json(await h.asUser(owner).get(`${path}/contributions?agent=false`));
    expect((filtered.items as { agent: boolean }[]).every((i) => !i.agent)).toBe(true);
    expect((filtered.items as unknown[]).length).toBe(1);
  });

  it("rejects tokens without the contributions scope", async () => {
    const readOnly = await h.token(contributor, { scopes: ["creations:read"] });
    const r = await readOnly.post(`${path}/contributions`, body());
    expect(r.status).toBe(403);
    expect(await json(r)).toMatchObject({ code: "token.insufficient_scope" });
  });

  it("rate limits per account", async () => {
    const heavy = await h.createUser("heavy");
    let last: Response | undefined;
    for (let i = 0; i < 21; i++) last = await h.asUser(heavy).post(`${path}/contributions`, body());
    expect(last?.status).toBe(429);
    expect(await json(last as Response)).toMatchObject({ code: "rate_limited" });
    expect(Number(last?.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("the contributions kill switch returns 503", async () => {
    await h.setFlag("contributions", false);
    const r = await h.asUser(stranger).post(`${path}/contributions`, body());
    expect(r.status).toBe(503);
    await h.setFlag("contributions", true);
  });
});

describe("validation and rights", () => {
  it("rejects a foreign base revision, malformed and duplicate changes", async () => {
    const { path } = await h.setupCreation("valid", "alice", WORKING);
    const other = await h.setupCreation("valid2", "bob", WORKING);
    const foreign = await h.asUser(contributor).post(`${path}/contributions`, {
      title: "x",
      base_revision: other.revision,
      changes: [modify("likes", "{{self}} likes tea.", "{{self}} likes pie.")],
      rights_ack: ACK,
    });
    expect(foreign.status).toBe(422);
    expect(await json(foreign)).toMatchObject({ code: "contribution.base_not_found" });

    const { revision } = await h.setupCreation("valid3", "carol", WORKING);
    const p3 = "/v1/creations/@valid3/carol";
    const dup = await h.asUser(contributor).post(`${p3}/contributions`, {
      title: "dup",
      base_revision: revision,
      changes: [
        modify("likes", "{{self}} likes tea.", "{{self}} likes pie."),
        modify("likes", "{{self}} likes tea.", "{{self}} likes jam."),
      ],
      rights_ack: ACK,
    });
    expect(dup.status).toBe(422);
    expect(await json(dup)).toMatchObject({ code: "contribution.duplicate_key" });
    const bad = await h.asUser(contributor).post(`${p3}/contributions`, {
      title: "bad",
      base_revision: revision,
      changes: [{ on: "fragment", op: "modify", id: "likes" }],
      rights_ack: ACK,
    });
    expect(bad.status).toBe(422);
  });

  it("requires an explicit grant when the target reserves all rights", async () => {
    const reserved = {
      ...WORKING,
      meta: { ...WORKING.meta, license: "LicenseRef-All-Rights-Reserved" },
    };
    const { path, revision } = await h.setupCreation("arr", "alice", reserved);
    const change = modify("likes", "{{self}} likes tea.", "{{self}} likes pie.");
    const implicit = await h.asUser(contributor).post(`${path}/contributions`, {
      title: "x",
      base_revision: revision,
      changes: [change],
      rights_ack: ACK,
    });
    expect(implicit.status).toBe(422);
    expect(await json(implicit)).toMatchObject({ code: "contribution.rights_ack_required" });
    const explicit = await h.asUser(contributor).post(`${path}/contributions`, {
      title: "x",
      base_revision: revision,
      changes: [change],
      rights_ack: { explicit_grant: true },
    });
    expect(explicit.status).toBe(201);
  });

  it("re-checks the grant against the license at acceptance time", async () => {
    const { owner, path, revision } = await h.setupCreation("relic", "alice", WORKING);
    await h.asUser(contributor).post(`${path}/contributions`, {
      title: "x",
      base_revision: revision,
      changes: [modify("likes", "{{self}} likes tea.", "{{self}} likes pie.")],
      rights_ack: ACK,
    });
    // 作者在提交之后改成了保留所有权利。
    await h.editDraft(owner, path, (w) => {
      (w.meta as Record<string, unknown>).license = "LicenseRef-All-Rights-Reserved";
    });
    const r = await h.asUser(owner).post(`${path}/contributions/1/accept`, {});
    expect(r.status).toBe(422);
    expect(await json(r)).toMatchObject({ code: "contribution.rights_ack_required" });
  });

  it("numbers concurrent submissions from 1 without duplicates", async () => {
    const { path, revision } = await h.setupCreation("race", "alice", WORKING);
    const racer = await h.createUser("racer");
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        h.asUser(racer).post(`${path}/contributions`, {
          title: `race ${i}`,
          base_revision: revision,
          changes: [modify("likes", "{{self}} likes tea.", `{{self}} likes pie ${i}.`)],
          rights_ack: ACK,
        }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(201));
    const numbers = await Promise.all(results.map(async (r) => (await json(r)).number));
    expect([...numbers].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("keeps the audit chain intact", async () => {
    expect(await verifyAuditChain(t.app.db)).toMatchObject({ ok: true });
  });
});
