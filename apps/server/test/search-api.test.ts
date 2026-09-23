/**
 * 搜索：中日英混合语料上的短查询与长查询、mature 默认隐藏、类型与标签过滤、分页，
 * private / yanked / tombstoned 不出现在结果中，以及按 namespace 精确过滤（作者主页）。
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creations, namespaceRedirects, namespaces, userSettings } from "../src/db/schema/index.js";
import { createHarness, type Harness } from "./fixtures/harness.js";
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
let adult: string;
let plain: string;

const refs = (body: { items: { ref: string }[] }) => body.items.map((i) => i.ref).sort();

async function search(q: string, user?: string) {
  const r = await h.request(`/v1/search?q=${encodeURIComponent(q)}`, user ? { user } : {});
  expect(r.status).toBe(200);
  return r.json();
}

beforeAll(async () => {
  h = await createHarness();
  const { db, cas } = h.services;
  adult = await createUser(db, { showMature: true });
  plain = await createUser(db, { showMature: false });
  const ns = await createNamespace(db, "djj");
  const mk = (
    name: string,
    display: unknown,
    extra: Record<string, unknown> = {},
    opts: {
      visibility?: "public" | "private";
      status?: "yanked" | "tombstoned";
      dependencies?: PublishedRelease[];
    } = {},
  ) =>
    publishRelease({
      db,
      cas,
      namespaceId: ns,
      label: "1.0.0",
      ...opts,
      creation: {
        ref: `@djj/${name}`,
        type: "world",
        display_name: display as string,
        fragments: [textFragment("world", "world", "x")],
        meta: META,
        ...extra,
      },
    });
  await mk("night-city", { en: "Night City", zh: "夜之城" }, { summary: "赛博朋克都市" });
  await mk("tokyo", { en: "Tokyo", ja: "東京" }, { summary: "ネオン街" });
  await mk("cat-cafe", "猫咖啡馆", { meta: { ...META, tags: ["cozy"] } });
  await mk("magic-school", "魔法学校");
  await mk("magic-forest", { ja: "魔法の森" });
  const mature = await mk("red-light", "魔法之夜", { meta: { ...META, rating: "mature" } });
  // general 作品依赖 mature 作品：effective rating 变成 mature，默认也要隐藏。
  await mk(
    "inherits-mature",
    "魔法街",
    { references: [{ id: "base", use: "@djj/red-light", mode: "default", pin: pinOf(mature) }] },
    { dependencies: [mature] },
  );
  await mk("private-world", "魔法秘境", {}, { visibility: "private" });
  await mk("yanked-world", "魔法废墟", {}, { status: "yanked" });
  await mk("gone-world", "魔法遗迹", {}, { status: "tombstoned" });
});

afterAll(async () => {
  await h.close();
});

describe("CJK short queries use the n-gram index", () => {
  it("finds one-character queries", async () => {
    expect(refs(await search("猫"))).toEqual(["@djj/cat-cafe"]);
    expect(refs(await search("城"))).toEqual(["@djj/night-city"]);
  });

  it("finds two-character queries across Chinese and Japanese", async () => {
    expect(refs(await search("魔法"))).toEqual(["@djj/magic-forest", "@djj/magic-school"]);
    expect(refs(await search("東京"))).toEqual(["@djj/tokyo"]);
    expect(refs(await search("夜之"))).toEqual(["@djj/night-city"]);
  });

  it("matches words in summaries and full-width input", async () => {
    expect(refs(await search("朋克"))).toEqual(["@djj/night-city"]);
    expect(refs(await search("ﾈｵﾝ"))).toEqual(["@djj/tokyo"]);
  });
});

describe("longer queries use trigrams", () => {
  it("finds three or more characters in any script", async () => {
    expect(refs(await search("夜之城"))).toEqual(["@djj/night-city"]);
    expect(refs(await search("night"))).toEqual(["@djj/night-city"]);
    expect(refs(await search("TOKYO"))).toEqual(["@djj/tokyo"]);
    expect(refs(await search("魔法学校"))).toEqual(["@djj/magic-school"]);
  });

  it("returns nothing for unrelated queries and escapes LIKE wildcards", async () => {
    expect(refs(await search("unrelated-zzz"))).toEqual([]);
    expect(refs(await search("%%%"))).toEqual([]);
  });
});

describe("mature content filtering is enforced on the server", () => {
  it("hides mature creations and creations inheriting mature dependencies by default", async () => {
    for (const user of [undefined, plain]) {
      const r = refs(await search("魔法", user));
      expect(r).not.toContain("@djj/red-light");
      expect(r).not.toContain("@djj/inherits-mature");
    }
  });

  it("shows them after the user opts in and confirms", async () => {
    expect(refs(await search("魔法", adult))).toEqual([
      "@djj/inherits-mature",
      "@djj/magic-forest",
      "@djj/magic-school",
      "@djj/red-light",
    ]);
    const item = (await search("魔法之夜", adult)).items[0];
    expect(item.effective_rating).toBe("mature");
  });

  it("requires the confirmation timestamp, not just the flag", async () => {
    await h.services.db
      .update(userSettings)
      .set({ matureConfirmedAt: null })
      .where(eq(userSettings.userId, adult));
    expect(refs(await search("魔法", adult))).not.toContain("@djj/red-light");
    await h.services.db
      .update(userSettings)
      .set({ matureConfirmedAt: new Date() })
      .where(eq(userSettings.userId, adult));
  });

  it("does not cache personalised results publicly", async () => {
    const anon = await h.request("/v1/search?q=%E9%AD%94%E6%B3%95");
    expect(anon.headers.get("cache-control")).toContain("public");
    const signed = await h.request("/v1/search?q=%E9%AD%94%E6%B3%95", { user: adult });
    expect(signed.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("only published public content appears", () => {
  it("excludes private, yanked and tombstoned releases", async () => {
    const r = refs(await search("魔法", adult));
    expect(r).not.toContain("@djj/private-world");
    expect(r).not.toContain("@djj/yanked-world");
    expect(r).not.toContain("@djj/gone-world");
  });
});

describe("filters and pagination", () => {
  it("filters by tag and type", async () => {
    expect(refs(await (await h.request("/v1/search?tag=cozy")).json())).toEqual(["@djj/cat-cafe"]);
    expect(refs(await (await h.request("/v1/search?type=character")).json())).toEqual([]);
  });

  it("paginates with an opaque cursor", async () => {
    const first = await (await h.request("/v1/search?limit=2")).json();
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).toBe("o2");
    const all: string[] = [...refs(first)];
    let cursor = first.next_cursor;
    while (cursor) {
      const page = await (await h.request(`/v1/search?limit=2&cursor=${cursor}`)).json();
      all.push(...refs(page));
      cursor = page.next_cursor;
    }
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual([
      "@djj/cat-cafe",
      "@djj/magic-forest",
      "@djj/magic-school",
      "@djj/night-city",
      "@djj/tokyo",
    ]);
  });

  it("rejects invalid parameters", async () => {
    expect((await h.request("/v1/search?limit=500")).status).toBe(422);
    expect((await h.request("/v1/search?cursor=bogus")).status).toBe(422);
    expect((await h.request("/v1/search?type=spaceship")).status).toBe(422);
  });
});

describe("filtering by namespace", () => {
  let kate: string;
  let hiddenId: string;

  // 放在最后一组：这里新增的作品不会影响上面按全部结果断言的分页测试。
  beforeAll(async () => {
    const { db, cas } = h.services;
    kate = await createNamespace(db, "kate");
    const mk = (
      name: string,
      extra: Record<string, unknown> = {},
      visibility: "public" | "private" = "public",
    ) =>
      publishRelease({
        db,
        cas,
        namespaceId: kate,
        label: "1.0.0",
        visibility,
        creation: {
          ref: `@kate/${name}`,
          type: "character",
          display_name: `Kate ${name}`,
          fragments: [textFragment("description", "character", "x")],
          meta: META,
          ...extra,
        },
      });
    await mk("courier");
    await mk("magic-cat", { display_name: "魔法猫" });
    await mk("after-dark", { meta: { ...META, rating: "explicit" } });
    await mk("secret", {}, "private");
    hiddenId = (await mk("hidden-one")).creationId;
    await db.update(creations).set({ status: "hidden" }).where(eq(creations.id, hiddenId));
    await db.insert(namespaceRedirects).values({ oldSlug: "kate-old", namespaceId: kate });
  });

  const nsSearch = async (qs: string, user?: string) => {
    const r = await h.request(`/v1/search?${qs}`, user ? { user } : {});
    expect(r.status).toBe(200);
    return refs(await r.json());
  };

  it("returns only public creations of that namespace", async () => {
    expect(await nsSearch("ns=kate")).toEqual(["@kate/courier", "@kate/magic-cat"]);
    const djj = await nsSearch("ns=djj&limit=100");
    expect(djj.length).toBeGreaterThan(0);
    expect(djj.every((r) => r.startsWith("@djj/"))).toBe(true);
  });

  it("keeps the other filters: query, type, mature, private and hidden", async () => {
    expect(await nsSearch("ns=kate&q=%E9%AD%94%E6%B3%95")).toEqual(["@kate/magic-cat"]);
    expect(await nsSearch("ns=djj&q=%E9%AD%94%E6%B3%95")).toEqual([
      "@djj/magic-forest",
      "@djj/magic-school",
    ]);
    expect(await nsSearch("ns=kate&type=world")).toEqual([]);
    expect(await nsSearch("ns=kate", plain)).not.toContain("@kate/after-dark");
    expect(await nsSearch("ns=kate", adult)).toEqual([
      "@kate/after-dark",
      "@kate/courier",
      "@kate/magic-cat",
    ]);
    for (const user of [undefined, adult]) {
      const r = await nsSearch("ns=kate", user);
      expect(r).not.toContain("@kate/secret");
      expect(r).not.toContain("@kate/hidden-one");
    }
  });

  it("matches the current slug exactly and hides suspended namespaces", async () => {
    expect(await nsSearch("ns=kat")).toEqual([]);
    expect(await nsSearch("ns=kate-old")).toEqual([]);
    expect(await nsSearch("ns=nobody")).toEqual([]);
    const { db } = h.services;
    await db.update(namespaces).set({ status: "suspended" }).where(eq(namespaces.id, kate));
    expect(await nsSearch("ns=kate")).toEqual([]);
    await db.update(namespaces).set({ status: "active" }).where(eq(namespaces.id, kate));
  });

  it("rejects a malformed namespace", async () => {
    for (const ns of ["%40kate", "Kate", "-kate", "a".repeat(40)]) {
      const r = await h.request(`/v1/search?ns=${ns}`);
      expect(r.status).toBe(422);
      expect(((await r.json()) as { code: string }).code).toBe("request.invalid");
    }
  });
});
