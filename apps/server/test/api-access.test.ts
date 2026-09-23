/**
 * Namespace、草稿、Token 的集成测试：保留名、改名重定向、乐观锁、越权访问与 Token scope。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeId } from "../src/registry/ids.js";
import { type ApiHarness, createHarness } from "./api-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let h: ApiHarness;
let owner: string;
let other: string;

beforeAll(async () => {
  t = await createTestDatabase();
  h = await createHarness(t, testCas());
  owner = await h.createUser("owner");
  other = await h.createUser("other");
  await h.as(owner).post("/v1/namespaces", { slug: "writer" });
  await h.as(owner).post("/v1/namespaces/writer/creations", {
    name: "hero",
    type: "character",
    display_name: "Hero",
  });
});

afterAll(async () => {
  await h.close();
  await t.drop();
});

async function json(r: Response) {
  return (await r.json()) as Record<string, unknown>;
}

const HERO = {
  display_name: "Hero",
  fragments: [
    {
      id: "description",
      stable: true,
      kind: "character",
      content: { type: "text", text: "{{self}} saves the day." },
    },
  ],
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
};

describe("namespaces", () => {
  it("requires sign-in, limits each account to one namespace, and rejects bad slugs", async () => {
    expect((await h.as(null).post("/v1/namespaces", { slug: "anon" })).status).toBe(401);
    const second = await h.as(owner).post("/v1/namespaces", { slug: "writer-two" });
    expect(second.status).toBe(409);
    expect(await json(second)).toMatchObject({ code: "namespace.limit" });
    expect((await h.as(other).post("/v1/namespaces", { slug: "Bad_Slug" })).status).toBe(422);
  });

  it.each(["commons", "admin", "api", "www", "official", "staging"])(
    "refuses the reserved name %s",
    async (slug) => {
      const r = await h.as(other).post("/v1/namespaces", { slug });
      expect(r.status).toBe(409);
      expect(await json(r)).toMatchObject({ code: "namespace.reserved" });
    },
  );

  it("refuses a taken name", async () => {
    const r = await h.as(other).post("/v1/namespaces", { slug: "writer" });
    expect(await json(r)).toMatchObject({ code: "namespace.taken" });
  });

  it("renames with a permanent redirect; the old name cannot be registered again", async () => {
    const r = await h.as(owner).patch("/v1/namespaces/writer", { new_slug: "author" });
    expect(r.status).toBe(200);
    const old = await h.as(null).get("/v1/namespaces/writer");
    expect(old.status).toBe(301);
    expect(old.headers.get("location")).toBe("/v1/namespaces/author");
    expect((await h.as(null).get("/v1/namespaces/author")).status).toBe(200);
    expect((await h.as(null).get("/v1/namespaces/nobody")).status).toBe(404);
    const grab = await h.as(other).post("/v1/namespaces", { slug: "writer" });
    expect(await json(grab)).toMatchObject({ code: "namespace.taken" });
    // 草稿仍能通过旧名找到，ref 更新为新名字。
    const draft = await json(await h.as(owner).get("/v1/creations/@writer/hero/draft"));
    expect((draft.working as { ref: string }).ref).toBe("@writer/hero");
    const saved = await h
      .as(owner)
      .put(
        "/v1/creations/@author/hero/draft",
        { working: HERO },
        { "if-match": String(draft.version) },
      );
    expect(saved.status).toBe(200);
    const after = await json(await h.as(owner).get("/v1/creations/@author/hero/draft"));
    expect((after.working as { ref: string }).ref).toBe("@author/hero");
  });

  it("only the owner can rename", async () => {
    const r = await h.as(other).patch("/v1/namespaces/author", { new_slug: "stolen" });
    expect(r.status).toBe(403);
  });
});

describe("creations and drafts", () => {
  it("only opens character, world and lorebook", async () => {
    const r = await h.as(owner).post("/v1/namespaces/author/creations", {
      name: "duo",
      type: "relationship",
      display_name: "Duo",
    });
    expect(r.status).toBe(422);
    expect(await json(r)).toMatchObject({ code: "creation.type_not_open" });
    const dup = await h.as(owner).post("/v1/namespaces/author/creations", {
      name: "hero",
      type: "character",
      display_name: "Hero",
    });
    expect(await json(dup)).toMatchObject({ code: "creation.taken" });
  });

  it("credits the creator in a new draft by their public handle, not their login name", async () => {
    const r = await h.as(owner).post("/v1/namespaces/author/creations", {
      name: "fresh",
      type: "world",
      display_name: "Fresh",
    });
    expect(r.status).toBe(201);
    const draft = await json(await h.as(owner).get("/v1/creations/@author/fresh/draft"));
    const working = draft.working as { authors?: unknown };
    expect(working.authors).toEqual([{ name: "@author", user: encodeId("user", owner) }]);
    // 作者可以改成别的署名，保存后不会被服务端覆盖。
    const put = await h.as(owner).put(
      "/v1/creations/@author/fresh/draft",
      {
        working: {
          ...(working as Record<string, unknown>),
          authors: [{ name: "Ada L.", user: encodeId("user", owner) }],
          fragments: [
            {
              id: "about",
              stable: true,
              kind: "world",
              content: { type: "text", text: "A quiet valley." },
            },
          ],
        },
      },
      { "if-match": String(draft.version) },
    );
    expect(put.status).toBe(200);
    const after = await json(await h.as(owner).get("/v1/creations/@author/fresh/draft"));
    expect((after.working as { authors?: unknown }).authors).toEqual([
      { name: "Ada L.", user: encodeId("user", owner) },
    ]);
  });

  it("other users cannot write and do not see private drafts", async () => {
    const create = await h.as(other).post("/v1/namespaces/author/creations", {
      name: "spy",
      type: "character",
      display_name: "Spy",
    });
    expect(create.status).toBe(403);
    // 还没有公开 Release 的 Creation 对其他人不存在。
    expect((await h.as(other).get("/v1/creations/@author/hero/draft")).status).toBe(404);
    expect((await h.as(null).get("/v1/creations/@author/hero/draft")).status).toBe(404);
    const write = await h
      .as(other)
      .put("/v1/creations/@author/hero/draft", { working: HERO }, { "if-match": "1" });
    expect(write.status).toBe(404);
    expect((await h.as(other).post("/v1/creations/@author/hero/revisions", {})).status).toBe(404);
  });

  it("uses optimistic locking and requires If-Match", async () => {
    const me = h.as(owner);
    const d = await json(await me.get("/v1/creations/@author/hero/draft"));
    const noHeader = await me.put("/v1/creations/@author/hero/draft", { working: HERO });
    expect(noHeader.status).toBe(428);
    const ok = await me.put(
      "/v1/creations/@author/hero/draft",
      { working: HERO },
      { "if-match": `"${d.version}"` },
    );
    expect(ok.status).toBe(200);
    const stale = await me.put(
      "/v1/creations/@author/hero/draft",
      { working: HERO },
      { "if-match": String(d.version) },
    );
    expect(stale.status).toBe(409);
    expect(await json(stale)).toMatchObject({ code: "draft.version_conflict" });
  });

  it("rejects drafts with check errors and returns warnings otherwise", async () => {
    const me = h.as(owner);
    const d = await json(await me.get("/v1/creations/@author/hero/draft"));
    const bad = await me.put(
      "/v1/creations/@author/hero/draft",
      {
        working: {
          ...HERO,
          fragments: [
            {
              id: "description",
              stable: true,
              kind: "character",
              content: { type: "text", text: "{{char}} is unknown" },
            },
          ],
        },
      },
      { "if-match": String(d.version) },
    );
    expect(bad.status).toBe(422);
    const body = await json(bad);
    expect(body.code).toBe("check.failed");
    expect(
      (body.diagnostics as { code: string }[]).some((x) => x.code === "check.unknown_placeholder"),
    ).toBe(true);
    const schema = await me.put(
      "/v1/creations/@author/hero/draft",
      { working: { ...HERO, meta: { rating: "nope" } } },
      { "if-match": String(d.version) },
    );
    expect(schema.status).toBe(422);
    expect(await json(schema)).toMatchObject({ code: "schema.invalid" });
    const notObject = await me.put(
      "/v1/creations/@author/hero/draft",
      { working: [1, 2] },
      { "if-match": String(d.version) },
    );
    expect(notObject.status).toBe(422);
  });

  it("accepts drafts up to 5 MiB but not ordinary bodies over 1 MiB", async () => {
    const me = h.as(owner);
    const d = await json(await me.get("/v1/creations/@author/hero/draft"));
    const big = "x".repeat(2 * 1024 * 1024);
    const r = await me.put(
      "/v1/creations/@author/hero/draft",
      {
        working: {
          ...HERO,
          fragments: [
            {
              id: "description",
              stable: true,
              kind: "character",
              content: { type: "text", text: big },
            },
          ],
        },
      },
      { "if-match": String(d.version) },
    );
    expect(r.status).toBe(200);
    const tooBig = await me.post("/v1/creations/@author/hero/revisions", { message: big });
    expect(tooBig.status).toBe(413);
  });
});

describe("personal access tokens", () => {
  it("are created with a browser session, shown once, scoped and revocable", async () => {
    const me = h.as(owner);
    const created = await me.post("/v1/me/tokens", {
      name: "cli",
      scopes: ["creations:read"],
      expires_in_days: 30,
    });
    expect(created.status).toBe(201);
    const tok = await json(created);
    expect(tok.token).toMatch(/^cp_pat_[0-9A-Za-z]{43}$/);

    const list = await json(await me.get("/v1/me/tokens"));
    const items = list.items as { id: string; prefix: string }[];
    expect(items).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(tok.token as string);

    const viaToken = h.withToken(tok.token as string);
    // 读草稿只需要 creations:read。
    expect((await viaToken.get("/v1/creations/@author/hero/draft")).status).toBe(200);
    // 写入需要 creations:write。
    const write = await viaToken.post("/v1/creations/@author/hero/revisions", {});
    expect(write.status).toBe(403);
    expect(await json(write)).toMatchObject({ code: "token.insufficient_scope" });
    // Token 不能管理 Token。
    const self = await viaToken.post("/v1/me/tokens", {
      name: "x",
      scopes: ["creations:read"],
      expires_in_days: 1,
    });
    expect(self.status).toBe(403);
    expect(await json(self)).toMatchObject({ code: "token.not_allowed" });

    expect((await me.delete(`/v1/me/tokens/${items[0]?.id}`)).status).toBe(204);
    expect((await me.delete(`/v1/me/tokens/${items[0]?.id}`)).status).toBe(404);
    const revoked = await viaToken.get("/v1/creations/@author/hero/draft");
    expect(revoked.status).toBe(401);
    expect(await json(revoked)).toMatchObject({ code: "auth.invalid_token" });
  });

  it("a publish token can publish but other users' tokens cannot", async () => {
    const me = h.as(owner);
    const pubTok = (await json(
      await me.post("/v1/me/tokens", {
        name: "publish",
        scopes: ["creations:read", "creations:write", "releases:publish"],
        expires_in_days: 7,
      }),
    )) as { token: string };
    const d = await json(await me.get("/v1/creations/@author/hero/draft"));
    await me.put(
      "/v1/creations/@author/hero/draft",
      { working: HERO },
      { "if-match": String(d.version) },
    );
    const api = h.withToken(pubTok.token);
    const rev = await json(await api.post("/v1/creations/@author/hero/revisions", {}));
    const pub = await api.post(
      "/v1/creations/@author/hero/releases",
      { revision: rev.id, label: "1.0.0", visibility: "private" },
      { "idempotency-key": "token-publish-01" },
    );
    expect(pub.status).toBe(202);

    const otherTok = (await json(
      await h.as(other).post("/v1/me/tokens", {
        name: "evil",
        scopes: ["creations:read", "creations:write", "releases:publish"],
        expires_in_days: 7,
      }),
    )) as { token: string };
    const stolen = await h
      .withToken(otherTok.token)
      .post(
        "/v1/creations/@author/hero/releases",
        { revision: rev.id, label: "9.9.9", visibility: "public" },
        { "idempotency-key": "token-publish-02" },
      );
    expect(stolen.status).toBe(404);
    expect((await h.as(null).get("/v1/me/tokens")).status).toBe(401);
  });

  it("rejects unknown revisions and reused idempotency keys", async () => {
    const me = h.as(owner);
    const bogus = await me.post(
      "/v1/creations/@author/hero/releases",
      { revision: "rev_01h455vb4pex5vsknk084sn02q", label: "5.0.0", visibility: "private" },
      { "idempotency-key": "token-publish-03" },
    );
    expect(bogus.status).toBe(404);
    const rev = await json(await me.post("/v1/creations/@author/hero/revisions", {}));
    const reused = await me.post(
      "/v1/creations/@author/hero/releases",
      { revision: rev.id, label: "5.0.0", visibility: "private" },
      { "idempotency-key": "token-publish-01" },
    );
    expect(reused.status).toBe(422);
    expect(await json(reused)).toMatchObject({ code: "request.idempotency_key_reused" });
  });
});
