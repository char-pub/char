/**
 * CCv3 导出的按需构建：第一次请求返回 202 并入队，worker 构建后再次请求得到 302 到导出物；
 * 导出物登记了反向引用，下架时会被一起删除。
 */
import { Ccv3LossReportSchema } from "@char-pub/contracts";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { register as registerRead } from "../src/api/routes/read.js";
import { REGISTRY_WRITE_MODULES } from "../src/api/routes/write.js";
import { createApi } from "../src/api/server.js";
import { blobRefs, buildArtifacts } from "../src/db/schema/index.js";
import { QUEUE_NAMES } from "../src/jobs/definitions.js";
import { type ExportJob, handleExportJob } from "../src/worker/export.js";
import { type ApiHarness, createHarness, ORIGIN, TEST_PUBLIC_BASE } from "./api-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let h: ApiHarness;
let api: ReturnType<typeof createApi>;
let userId: string;

beforeAll(async () => {
  t = await createTestDatabase();
  h = await createHarness(t, testCas());
  api = createApi({
    services: h.services,
    originSecrets: [],
    allowedOrigins: [ORIGIN],
    sessionPrincipal: async (req) => {
      const id = req.headers.get("x-test-user");
      return id ? { kind: "user", user_id: id, banned: false } : null;
    },
    modules: [...REGISTRY_WRITE_MODULES, registerRead],
  });
  userId = await h.createUser("exporter");
});
afterAll(async () => {
  await h.close();
  await t.drop();
});

const LEVEL0 = {
  display_name: "Mira",
  fragments: [
    {
      id: "description",
      stable: true,
      kind: "character",
      content: { type: "text", text: "{{self}} repairs clocks." },
    },
    {
      id: "lore/tower",
      stable: true,
      kind: "knowledge",
      content: { type: "text", text: "The clock tower hides a door." },
      activation: { mode: "keyword", keys: ["tower"] },
    },
  ],
  bootstrap: { greetings: [{ id: "default", text: "Hello {{user}}." }] },
  meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
};

async function publish() {
  const me = h.as(userId);
  await me.post("/v1/namespaces", { slug: "exp" });
  await me.post("/v1/namespaces/exp/creations", {
    name: "mira",
    type: "character",
    display_name: "Mira",
  });
  const d = (await (await me.get("/v1/creations/@exp/mira/draft")).json()) as { version: number };
  await me.put(
    "/v1/creations/@exp/mira/draft",
    { working: LEVEL0 },
    { "if-match": String(d.version) },
  );
  const rev = (await (await me.post("/v1/creations/@exp/mira/revisions", {})).json()) as {
    id: string;
  };
  await me.post(
    "/v1/creations/@exp/mira/releases",
    { revision: rev.id, label: "1.0.0", visibility: "public" },
    { "idempotency-key": "export-test-0001" },
  );
  expect(await h.runPublishJobs()).toEqual(["published"]);
}

describe("lazy CCv3 export", () => {
  it("returns 202 first, builds once, then redirects to an export with a card and loss report", async () => {
    await publish();
    const path = "/v1/creations/@exp/mira/releases/1.0.0/export/ccv3";
    const first = await api.request(`${path}?part=card`);
    expect(first.status).toBe(202);
    expect(first.headers.get("retry-after")).toBeTruthy();

    const jobs = await h.queue.boss.fetch<ExportJob>(QUEUE_NAMES.exportBuild, { batchSize: 5 });
    expect(jobs).toHaveLength(1);
    const job = jobs?.[0];
    if (!job) throw new Error("no job");
    expect(await handleExportJob({ db: t.app.db, cas: h.services.cas }, job.data)).toBe("built");
    expect(await handleExportJob({ db: t.app.db, cas: h.services.cas }, job.data)).toBe("cached");

    const second = await api.request(path);
    expect(second.status).toBe(302);
    const location = second.headers.get("location") ?? "";
    expect(location.startsWith(`${TEST_PUBLIC_BASE}/`)).toBe(true);
    const digest = `sha256:${location.split("/").at(-1)}`;
    const bytes = await h.services.cas.getBlob("public", digest);
    const out = JSON.parse(new TextDecoder().decode(bytes)) as {
      card: {
        spec: string;
        data: {
          name: string;
          description: string;
          first_mes: string;
          character_book?: { entries: unknown[] };
        };
      };
      loss: { target: string; policy_fields: unknown[] };
    };
    expect(out.card.spec).toBe("chara_card_v3");
    expect(out.card.data.name).toBe("Mira");
    expect(out.card.data.description).toContain("Mira repairs clocks.");
    expect(out.card.data.first_mes).toBe("Hello {{user}}.");
    expect(out.card.data.character_book?.entries).toHaveLength(1);
    expect(out.loss.target).toBe("ccv3");
    const card = await api.request(`${path}?part=card`);
    expect(card.status).toBe(200);
    expect(card.headers.get("cache-control")).toBe("private, no-store");
    expect(card.headers.get("content-disposition")).toBe('attachment; filename="mira-1.0.0.json"');
    expect(await card.json()).toEqual(out.card);
    const loss = await api.request(`${path}?part=loss`);
    expect(loss.status).toBe(200);
    expect(loss.headers.get("cache-control")).toBe("private, no-store");
    expect(loss.headers.get("content-disposition")).toBe(
      'attachment; filename="mira-1.0.0-loss.json"',
    );
    expect(Ccv3LossReportSchema.parse(await loss.json())).toEqual(out.loss);
    const invalid = await api.request(`${path}?part=unknown`);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: "export.invalid_part" });

    const [artifact] = await t.app.db.select().from(buildArtifacts);
    expect(artifact?.blobDigest).toBe(digest);
    const refs = await t.app.db.select().from(blobRefs).where(eq(blobRefs.digest, digest));
    expect(refs.map((r) => r.role)).toEqual(["export"]);
  });

  it("exports published Story greetings with isolated locale caches and explicit structure loss", async () => {
    const me = h.as(await h.createUser("story-exporter"));
    const namespace = await me.post("/v1/namespaces", { slug: "story-exp" });
    expect(namespace.status, await namespace.clone().text()).toBe(201);
    const created = await me.post("/v1/namespaces/story-exp/creations", {
      name: "inn",
      type: "scenario",
      display_name: "Inn",
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const draft = (await (await me.get("/v1/creations/@story-exp/inn/draft")).json()) as {
      version: number;
    };
    const working = {
      display_name: "Inn",
      cast: [{ key: "guest", who: { late: "persona" } }],
      meta: LEVEL0.meta,
      bootstrap: {
        greetings: [
          { id: "fallback", text: "DEFAULT_GREETING" },
          {
            id: "blackout",
            text: "Darkness, {{user}}.",
            locale: { ja: { content: { type: "text", text: "停電、{{user}}。" } } },
          },
          { id: "unreferenced", text: "UNREFERENCED_LEGACY" },
        ],
      },
      story: {
        version: 1,
        scenes: [
          {
            id: "lobby",
            title: "Lobby",
            opening: { en: "Rain in the lobby.", ja: "雨のロビー。" },
          },
          { id: "attic", title: "Attic", opening: "DISCARDED_SCENE" },
        ],
        vars: { trust: { type: "int", init: 0, min: 0, max: 5, description: "Trust" } },
        starts: [
          {
            id: "guest",
            title: "Guest",
            description: "Arrive",
            greeting: { en: "Come in, {{user}}.", ja: "ようこそ、{{user}}。" },
            set: [{ set: ["var/trust", 2] }],
          },
          { id: "storm", title: "Storm", description: "Blackout", greeting: { ref: "blackout" } },
          { id: "plain", title: "Plain", description: "Fallback" },
        ],
      },
    };
    const saved = await me.put(
      "/v1/creations/@story-exp/inn/draft",
      { working },
      { "if-match": String(draft.version) },
    );
    expect(saved.status).toBe(200);
    const revision = (await (
      await me.post("/v1/creations/@story-exp/inn/revisions", {})
    ).json()) as { id: string };
    const published = await me.post(
      "/v1/creations/@story-exp/inn/releases",
      { revision: revision.id, label: "1.0.0", visibility: "public" },
      { "idempotency-key": "export-story-0001" },
    );
    expect(published.status).toBe(202);
    expect(await h.runPublishJobs()).toEqual(["published"]);
    const path = "/v1/creations/@story-exp/inn/releases/1.0.0/export/ccv3";
    const keys: string[] = [];
    for (const locale of ["en", "ja"]) {
      expect((await api.request(`${path}?part=card&locale=${locale}`)).status).toBe(202);
      const jobs = await h.queue.boss.fetch<ExportJob>(QUEUE_NAMES.exportBuild, { batchSize: 5 });
      expect(jobs).toHaveLength(1);
      const job = jobs?.[0];
      if (!job) throw new Error("missing export job");
      expect(job.data.locale).toBe(locale);
      keys.push(job.data.cache_key);
      expect(await handleExportJob({ db: t.app.db, cas: h.services.cas }, job.data)).toBe("built");
      await h.queue.boss.complete(QUEUE_NAMES.exportBuild, job.id);
      const response = await api.request(`${path}?part=card&locale=${locale}`);
      expect(response.status).toBe(200);
      const card = (await response.json()) as {
        data: { first_mes: string; alternate_greetings: string[]; scenario: string };
      };
      expect(card.data.first_mes).toBe(
        locale === "en" ? "Come in, {{user}}." : "ようこそ、{{user}}。",
      );
      expect(card.data.alternate_greetings).toEqual([
        locale === "en" ? "Darkness, {{user}}." : "停電、{{user}}。",
        "DEFAULT_GREETING",
      ]);
      expect(card.data.scenario).toContain(locale === "en" ? "Rain in the lobby." : "雨のロビー。");
      expect(JSON.stringify(card)).not.toContain("UNREFERENCED_LEGACY");
      expect(card.data.scenario).not.toContain("DISCARDED_SCENE");
      const loss = Ccv3LossReportSchema.parse(
        await (await api.request(`${path}?part=loss&locale=${locale}`)).json(),
      );
      expect(loss.other.some((item) => item.subject.includes("story"))).toBe(true);
      expect(loss.locales.exported).toBe(locale);
    }
    expect(new Set(keys).size).toBe(2);
    expect((await api.request(`${path}?locale=../../invalid`)).status).toBe(400);
  });

  it("keeps same-content releases and public/private export buckets separate", async () => {
    const owner = await h.createUser("same-content-exporter");
    const me = h.as(owner);
    expect((await me.post("/v1/namespaces", { slug: "export-copies" })).status).toBe(201);
    expect(
      (
        await me.post("/v1/namespaces/export-copies/creations", {
          name: "mira",
          type: "character",
          display_name: "Mira",
        })
      ).status,
    ).toBe(201);
    const base = "/v1/creations/@export-copies/mira";
    const draft = (await (await me.get(`${base}/draft`)).json()) as { version: number };
    expect(
      (await me.put(`${base}/draft`, { working: LEVEL0 }, { "if-match": String(draft.version) }))
        .status,
    ).toBe(200);
    const revision = (await (await me.post(`${base}/revisions`, {})).json()) as { id: string };
    const keys: string[] = [];
    const digests: string[] = [];
    const locks: string[] = [];
    for (const [index, visibility] of (["private", "public", "public"] as const).entries()) {
      const label = `1.0.${index}`;
      expect(
        (
          await me.post(
            `${base}/releases`,
            { revision: revision.id, label, visibility },
            { "idempotency-key": `same-content-export-${index}` },
          )
        ).status,
      ).toBe(202);
      expect(await h.runPublishJobs()).toEqual(["published"]);
      const releaseResponse = await api.request(`${base}/releases/${label}`, {
        headers: { "x-test-user": owner },
      });
      expect(releaseResponse.status, await releaseResponse.clone().text()).toBe(200);
      const release = (await releaseResponse.json()) as {
        id: string;
        semantic_digest: string;
        lock_digest: string;
      };
      digests.push(release.semantic_digest);
      locks.push(release.lock_digest);
      const path = `${base}/releases/${label}/export/ccv3?part=card`;
      const headers = visibility === "private" ? { "x-test-user": owner } : {};
      expect((await api.request(path, { headers })).status).toBe(202);
      const jobs = await h.queue.boss.fetch<ExportJob>(QUEUE_NAMES.exportBuild, { batchSize: 5 });
      expect(jobs).toHaveLength(1);
      const job = jobs?.[0];
      if (!job) throw new Error("missing export job");
      keys.push(job.data.cache_key);
      expect(await handleExportJob({ db: t.app.db, cas: h.services.cas }, job.data)).toBe("built");
      await h.queue.boss.complete(QUEUE_NAMES.exportBuild, job.id);
      const response = await api.request(path, { headers });
      expect(response.status).toBe(200);
      const output = (await response.json()) as {
        data: { extensions: { char_pub: { root: { release: string } } } };
      };
      expect(output.data.extensions.char_pub.root.release).toBe(release.id);
      const [cache] = await t.app.db
        .select()
        .from(buildArtifacts)
        .where(eq(buildArtifacts.cacheKey, job.data.cache_key));
      if (!cache) throw new Error("missing export cache");
      expect((await h.services.cas.getBlob(visibility, cache.blobDigest)).length).toBeGreaterThan(
        0,
      );
      const refs = await t.app.db
        .select()
        .from(blobRefs)
        .where(eq(blobRefs.digest, cache.blobDigest));
      expect(refs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ releaseId: job.data.release_id, role: "export" }),
        ]),
      );
      if (visibility === "private") {
        expect((await api.request(path)).status).toBe(404);
        await expect(h.services.cas.getBlob("public", cache.blobDigest)).rejects.toThrow();
      }
    }
    expect(new Set(digests).size).toBe(1);
    expect(new Set(locks).size).toBe(1);
    expect(new Set(keys).size).toBe(3);
  });

  it("does not build for unknown or unpublished releases", async () => {
    expect(
      await handleExportJob(
        { db: t.app.db, cas: h.services.cas },
        { release_id: "00000000-0000-7000-8000-000000000000", target: "ccv3", cache_key: "x" },
      ),
    ).toBe("skipped");
  });
});
