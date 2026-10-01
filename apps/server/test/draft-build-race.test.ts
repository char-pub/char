/** Real PostgreSQL row locking and private payload deletion through the draft-build API. */
import { DraftBuildResponseSchema, DraftSchema } from "@char-pub/contracts";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { QUEUE_NAMES } from "../src/jobs/definitions.js";
import { encodeId } from "../src/registry/ids.js";
import { type DraftBuildJob, handleDraftBuild } from "../src/worker/draft-build.js";
import { type ApiHarness, createHarness } from "./api-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let h: ApiHarness;
let owner: string;

function gate() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function readyBuild(name: string) {
  const me = h.as(owner);
  expect(
    (
      await me.post("/v1/namespaces/draft-race/creations", {
        name,
        type: "character",
        display_name: name,
      })
    ).status,
  ).toBe(201);
  const base = `/v1/creations/@draft-race/${name}`;
  const draft = DraftSchema.parse(await (await me.get(`${base}/draft`)).json());
  const saved = await me.put(
    `${base}/draft`,
    {
      working: {
        type: "character",
        display_name: name,
        meta: {
          default_locale: "en",
          rating: "general",
          rights: "original",
          license: "CC0-1.0",
        },
        fragments: [
          {
            id: "identity",
            stable: true,
            kind: "character",
            content: { type: "text", text: "A quiet host." },
          },
        ],
      },
    },
    { "if-match": String(draft.version) },
  );
  expect(saved.status, await saved.clone().text()).toBe(200);
  const current = DraftSchema.parse(await (await me.get(`${base}/draft`)).json());
  const response = await me.post(
    `${base}/draft-builds`,
    {},
    {
      "if-match": String(current.version),
    },
  );
  expect(response.status, await response.clone().text()).toBe(202);
  const build = DraftBuildResponseSchema.parse(await response.json());
  const jobs = await h.queue.boss.fetch<DraftBuildJob>(QUEUE_NAMES.draftBuild, { batchSize: 10 });
  expect(jobs).toHaveLength(1);
  for (const job of jobs ?? []) {
    expect(await handleDraftBuild(h.services, job.data)).toBe("ready");
    await h.queue.boss.complete(QUEUE_NAMES.draftBuild, job.id);
  }
  return `/v1/draft-builds/${build.origin.build_id}`;
}

beforeAll(async () => {
  t = await createTestDatabase();
  h = await createHarness(t, testCas());
  owner = await h.createUser("draft-race-owner");
  expect((await h.as(owner).post("/v1/namespaces", { slug: "draft-race" })).status).toBe(201);
});

afterAll(async () => {
  await h?.close();
  await t?.drop();
});

it("keeps anonymous DELETE indistinguishable for real and nonexistent private builds", async () => {
  const path = await readyBuild("hidden");
  const absent = `/v1/draft-builds/${encodeId("draft_build", h.services.ids.uuid())}`;
  const realResponse = await h.as(null).delete(path);
  const absentResponse = await h.as(null).delete(absent);
  expect(realResponse.status).toBe(404);
  expect(absentResponse.status).toBe(404);
  expect((await realResponse.json()).code).toBe("not_found");
  expect((await absentResponse.json()).code).toBe("not_found");
  expect((await h.as(owner).delete(path)).status).toBe(204);
});

it("serializes payload read/signing before DELETE and prevents new or retained payload access afterwards", async () => {
  const path = await readyBuild("locked-read");
  const me = h.as(owner);
  const original = await me.get(`${path}/artifact`);
  expect(original.status, await original.clone().text()).toBe(302);
  const originalUrl = original.headers.get("location");
  if (!originalUrl) throw new Error("Missing signed payload URL");
  expect((await fetch(originalUrl)).status).toBe(200);
  const payloads = h.services.draftPayloads;
  if (!payloads) throw new Error("Missing payload store");
  const entered = gate();
  const resume = gate();
  const readPayload = payloads.readPayload.bind(payloads);
  const reading = vi.spyOn(payloads, "readPayload").mockImplementation(async (...args) => {
    entered.resolve();
    await resume.promise;
    return readPayload(...args);
  });
  const signing = vi.spyOn(payloads, "signedGet");
  const get = me.get(`${path}/artifact`);
  let deletion: Promise<Response> | undefined;
  try {
    await entered.promise;
    deletion = me.delete(path);
    // Observe a real PostgreSQL lock wait, not an arbitrary sleep or only Promise timing.
    await expect
      .poll(
        async () => {
          const result = await t.app.db.execute<{ blocked: number }>(sql`
        select count(*)::int as blocked from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
          and cardinality(pg_blocking_pids(pid)) > 0
          and (query like '%draft_builds%' or query like '%creations%')
      `);
          return result.rows[0]?.blocked ?? 0;
        },
        { timeout: 5000, interval: 20 },
      )
      .toBeGreaterThan(0);
    expect(signing).not.toHaveBeenCalled();
    resume.resolve();
    expect((await get).status).toBe(302);
    expect((await deletion).status).toBe(204);
    expect(signing).toHaveBeenCalledTimes(1);
    reading.mockRestore();
    const after = await me.get(`${path}/artifact`);
    expect(after.status).toBe(410);
    expect(signing).toHaveBeenCalledTimes(1);
    expect((await fetch(originalUrl)).status).toBe(404);
    const status = DraftBuildResponseSchema.parse(await (await me.get(path)).json());
    expect(status.state).toBe("deleted");
  } finally {
    resume.resolve();
    await Promise.allSettled([get, ...(deletion ? [deletion] : [])]);
    reading.mockRestore();
    signing.mockRestore();
  }
});
