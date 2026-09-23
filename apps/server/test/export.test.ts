/**
 * CCv3 导出的按需构建：第一次请求返回 202 并入队，worker 构建后再次请求得到 302 到导出物；
 * 导出物登记了反向引用，下架时会被一起删除。
 */
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
    const first = await api.request(path);
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

    const [artifact] = await t.app.db.select().from(buildArtifacts);
    expect(artifact?.blobDigest).toBe(digest);
    const refs = await t.app.db.select().from(blobRefs).where(eq(blobRefs.digest, digest));
    expect(refs.map((r) => r.role)).toEqual(["export"]);
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
