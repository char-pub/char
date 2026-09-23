/**
 * 导入任务重试用尽时的处理（Postgres + MinIO + 真实的 pg-boss worker）：
 * - 最后一次尝试失败 → 导入标记为 failed（`import.internal_error`），任务进入死信队列，原件保留；
 * - 从死信重新投递（与 admin 任务面板的“重试”相同：按原数据投回业务队列）→ 导入重新处理成功；
 * - 卡片本身的问题（解析失败等）不会因为重新投递而被再次处理；
 * - 重投时同名的另一个导入正在进行，旧导入保持失败，不影响新导入。
 */
import { utf8Encode } from "@char-pub/ccv3";
import { sha256Bytes } from "@char-pub/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { register as registerUploads } from "../src/api/routes/uploads.js";
import { imports } from "../src/db/schema/index.js";
import { DEAD_LETTER_SUFFIX, QUEUE_NAMES } from "../src/jobs/definitions.js";
import { isFinalAttempt } from "../src/jobs/queue.js";
import { decodeId } from "../src/registry/ids.js";
import type { Cas } from "../src/storage/cas.js";
import { stagingKeyFor } from "../src/upload/pipeline.js";
import {
  handleImportJob,
  IMPORT_INTERNAL_ERROR,
  type ImportDeps,
  registerImportWorker,
} from "../src/worker/import.js";
import { handleUploadJob } from "../src/worker/upload.js";
import { type ApiHarness, createHarness } from "./api-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let h: ApiHarness;
let alice: string;
let system: string;

const Q = QUEUE_NAMES.importCcv3;
const DEAD = `${Q}${DEAD_LETTER_SUFFIX}`;

function deps(cas: Cas = h.services.cas): ImportDeps {
  return {
    db: t.app.db,
    cas,
    queue: h.queue,
    now: () => h.clock.now(),
    newId: () => h.services.ids.uuid(),
    systemActorId: system,
  };
}

/** 读取上传原件总是失败的存储，模拟存储长时间不可用。 */
function brokenStorage(): Cas {
  const cas = Object.create(h.services.cas) as Cas;
  cas.getUpload = async () => {
    throw new Error("storage unavailable");
  };
  return cas;
}

beforeAll(async () => {
  t = await createTestDatabase();
  h = await createHarness(t, testCas(), { extraModules: [registerUploads] });
  alice = await h.createUser("alice");
  system = await h.createUser("system");
  expect((await h.as(alice).post("/v1/namespaces", { slug: "alice" })).status).toBe(201);
});
afterAll(async () => {
  await h.close();
  await t.drop();
});

function jsonCard(name: string): Uint8Array {
  return utf8Encode(
    JSON.stringify({
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name,
        description: "{{char}} keeps the lighthouse.",
        personality: "Calm.",
        scenario: "",
        first_mes: "Hello, {{user}}.",
        mes_example: "",
        creator_notes: "",
        system_prompt: "",
        post_history_instructions: "",
        alternate_greetings: [],
        tags: [],
        creator: "someone",
        character_version: "1",
        extensions: {},
      },
    }),
  );
}

async function upload(bytes: Uint8Array): Promise<string> {
  const res = await h.as(alice).post("/v1/uploads", {
    purpose: "import",
    content_type: "application/json",
    size: bytes.byteLength,
    sha256: sha256Bytes(bytes),
  });
  expect(res.status).toBe(201);
  const created = (await res.json()) as {
    upload: string;
    put_url: string;
    headers: Record<string, string>;
  };
  const put = await fetch(created.put_url, {
    method: "PUT",
    body: Buffer.from(bytes),
    headers: created.headers,
  });
  expect(put.status).toBe(200);
  expect((await h.as(alice).post(`/v1/uploads/${created.upload}/complete`)).status).toBe(202);
  await handleUploadJob(deps(), { upload_id: created.upload });
  return created.upload;
}

async function startImport(uploadId: string, name: string): Promise<{ id: string; uuid: string }> {
  const res = await h.as(alice).post("/v1/imports", { upload: uploadId, namespace: "alice", name });
  expect(res.status).toBe(202);
  const id = ((await res.json()) as { import: string }).import;
  const uuid = decodeId("import", id);
  if (!uuid) throw new Error(`bad import id ${id}`);
  return { id, uuid };
}

async function row(uuid: string) {
  const [r] = await t.app.db.select().from(imports).where(eq(imports.id, uuid));
  if (!r) throw new Error("import row missing");
  return r;
}

async function waitFor<T>(what: string, probe: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** 取消 API 入队的任务（默认 5 次重试加退避，太慢），换成只重试一次、没有延迟的同一任务。 */
async function replaceWithFastRetryingJob(uuid: string): Promise<void> {
  const [queued] = await h.queue.boss.findJobs(Q, { key: `import:${uuid}` });
  if (queued) await h.queue.boss.cancel(Q, queued.id);
  const id = await h.queue.boss.send(
    Q,
    { import_id: uuid },
    { retryLimit: 1, retryDelay: 0, retryBackoff: false },
  );
  expect(id).toBeTypeOf("string");
}

describe("isFinalAttempt", () => {
  it("is true once the retry count reaches the retry limit", () => {
    expect(isFinalAttempt({ retryCount: 0, retryLimit: 1 })).toBe(false);
    expect(isFinalAttempt({ retryCount: 1, retryLimit: 1 })).toBe(true);
    expect(isFinalAttempt({ retryCount: 0, retryLimit: 0 })).toBe(true);
  });
});

describe("an import whose retries are exhausted", () => {
  let imp = { id: "", uuid: "" };
  let uploadId = "";

  it("is marked failed with import.internal_error and its job moves to the dead letter queue", async () => {
    uploadId = await upload(jsonCard("Keeper"));
    imp = await startImport(uploadId, "keeper");
    await replaceWithFastRetryingJob(imp.uuid);

    await registerImportWorker(h.queue, deps(brokenStorage()), { pollingIntervalSeconds: 0.5 });
    const failed = await waitFor("the import to fail", async () => {
      const r = await row(imp.uuid);
      return r.status === "failed" ? r : undefined;
    });
    await h.queue.boss.offWork(Q, { wait: true });

    expect(failed).toMatchObject({
      status: "failed",
      errorCode: IMPORT_INTERNAL_ERROR,
      errorDetail: "storage unavailable",
      creationId: null,
    });
    const dead = await waitFor("the dead letter job", async () => {
      const jobs = await h.queue.boss.findJobs<{ import_id: string }>(DEAD, { queued: true });
      return jobs.find((j) => j.data.import_id === imp.uuid);
    });
    expect(dead.data).toEqual({ import_id: imp.uuid });

    // 发起人看到的是失败，而不是一直“处理中”。
    const res = await h.as(alice).get(`/v1/imports/${imp.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "failed", error_code: IMPORT_INTERNAL_ERROR });

    // 原件保留，重新投递之后还能继续处理。
    expect(await h.services.cas.exists("uploads", stagingKeyFor(uploadId))).toBe(true);
  });

  it("is processed again and succeeds when the dead letter job is redelivered", async () => {
    const jobs = await h.queue.boss.findJobs<{ import_id: string }>(DEAD, { queued: true });
    const dead = jobs.find((j) => j.data.import_id === imp.uuid);
    if (!dead) throw new Error("dead letter job missing");
    // 与 admin 任务面板的“重试”相同：按原数据投回业务队列，再把死信标记为完成。
    await h.queue.boss.send(Q, dead.data);
    await h.queue.boss.complete(DEAD, dead.id);

    await registerImportWorker(h.queue, deps(), { pollingIntervalSeconds: 0.5 });
    const done = await waitFor("the import to succeed", async () => {
      const r = await row(imp.uuid);
      return r.status === "succeeded" ? r : undefined;
    });
    await h.queue.boss.offWork(Q, { wait: true });

    expect(done.errorCode).toBeNull();
    expect(done.errorDetail).toBeNull();
    expect(done.creationId).not.toBeNull();
    const res = await h.as(alice).get(`/v1/imports/${imp.id}`);
    expect(await res.json()).toMatchObject({ status: "succeeded", creation: "@alice/keeper" });
    expect((await h.as(alice).get("/v1/creations/@alice/keeper/draft")).status).toBe(200);
  });
});

describe("redelivery does not reopen other failures", () => {
  it("a card that failed to parse stays failed", async () => {
    const uploadId = await upload(utf8Encode('{"spec": "chara_card_v3", "data": 5}'));
    const imp = await startImport(uploadId, "broken");
    expect(await handleImportJob(deps(), { import_id: imp.uuid })).toBe("failed");
    const first = await row(imp.uuid);
    expect(first.errorCode).not.toBe(IMPORT_INTERNAL_ERROR);

    expect(await handleImportJob(deps(), { import_id: imp.uuid })).toBe("skipped");
    expect(await row(imp.uuid)).toMatchObject({ status: "failed", errorCode: first.errorCode });
  });

  it("an internal failure stays failed when another import of the same name is in progress", async () => {
    const oldUpload = await upload(jsonCard("Twin"));
    const old = await startImport(oldUpload, "twin");
    await t.app.db
      .update(imports)
      .set({ status: "failed", errorCode: IMPORT_INTERNAL_ERROR, errorDetail: "timeout" })
      .where(eq(imports.id, old.uuid));

    // 用户换一个上传、用同一个名字重新导入，新的导入还没处理。
    const next = await startImport(await upload(jsonCard("Twin again")), "twin");
    expect((await row(next.uuid)).status).toBe("pending");

    expect(await handleImportJob(deps(), { import_id: old.uuid })).toBe("skipped");
    expect(await row(old.uuid)).toMatchObject({
      status: "failed",
      errorCode: IMPORT_INTERNAL_ERROR,
    });
    expect(await handleImportJob(deps(), { import_id: next.uuid })).toBe("succeeded");
  });
});
