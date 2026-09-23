/**
 * 搜索：中日英混合语料上的短查询与长查询、mature 默认隐藏、类型与标签过滤、分页，
 * 以及 private / yanked / tombstoned 不出现在结果中。
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { userSettings } from "../src/db/schema/index.js";
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
