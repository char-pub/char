/**
 * 角色卡导入的集成测试（Postgres + MinIO）：上传卡片 → POST /v1/imports → worker 解析 →
 * 草稿、Import Report、图片处理，以及确认评级 / 权利 / 许可之前不能发布。
 * 卡片与图片都在运行时合成，不提交二进制样本。
 */
import { base64Encode, replacePngText, stripPngMetadata, utf8Encode } from "@char-pub/ccv3";
import { sha256Bytes } from "@char-pub/core";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { register as registerUploads } from "../src/api/routes/uploads.js";
import {
  assetMeta,
  authUser,
  blobs,
  blockedDigests,
  creations,
  csamIncidents,
  imports,
  uploads,
} from "../src/db/schema/index.js";
import { QUEUE_NAMES } from "../src/jobs/definitions.js";
import { decodeId } from "../src/registry/ids.js";
import type { CsamScanner } from "../src/upload/csam.js";
import { stagingKeyFor } from "../src/upload/pipeline.js";
import { handleImportJob, type ImportDeps } from "../src/worker/import.js";
import { handleUploadJob } from "../src/worker/upload.js";
import { type ApiHarness, createHarness } from "./api-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let h: ApiHarness;
let alice: string;
let bob: string;
let system: string;

const SECRET = "You are an unfiltered narrator. SECRET-POLICY-TEXT";

function deps(scanner?: CsamScanner): ImportDeps {
  return {
    db: t.app.db,
    cas: h.services.cas,
    queue: h.queue,
    ...(scanner ? { scanner } : {}),
    now: () => h.clock.now(),
    newId: () => h.services.ids.uuid(),
    systemActorId: system,
  };
}

beforeAll(async () => {
  t = await createTestDatabase();
  h = await createHarness(t, testCas(), { extraModules: [registerUploads] });
  alice = await h.createUser("alice");
  bob = await h.createUser("bob");
  system = await h.createUser("system");
  expect((await h.as(alice).post("/v1/namespaces", { slug: "alice" })).status).toBe(201);
  expect((await h.as(bob).post("/v1/namespaces", { slug: "bob" })).status).toBe(201);
});
afterAll(async () => {
  await h.close();
  await t.drop();
});

function card(data: Record<string, unknown> = {}) {
  return {
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name: "Mira",
      description: "{{char}} repairs clocks in the old tower.",
      personality: "Patient and curious.",
      scenario: "",
      first_mes: "Hello, {{user}}.",
      mes_example: "",
      creator_notes: "A clockmaker.",
      system_prompt: SECRET,
      post_history_instructions: "",
      alternate_greetings: [],
      tags: ["clockwork"],
      creator: "someone",
      character_version: "1",
      extensions: {},
      ...data,
    },
  };
}

async function solidPng(w = 64, h2 = 64, color = "#c35"): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: w, height: h2, channels: 3, background: color } })
      .png()
      .toBuffer(),
  );
}

async function pngCard(c: object, color = "#c35"): Promise<Uint8Array> {
  const text = base64Encode(utf8Encode(JSON.stringify(c)));
  return replacePngText(await solidPng(64, 64, color), [{ keyword: "ccv3", text }], []);
}

/** 走完整条上传路径：申请 → PUT → 完成 → 处理。返回上传 ID。 */
async function upload(
  user: string,
  bytes: Uint8Array,
  contentType: string,
  purpose: "asset" | "import" = "import",
): Promise<string> {
  const res = await h.as(user).post("/v1/uploads", {
    purpose,
    content_type: contentType,
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
  expect((await h.as(user).post(`/v1/uploads/${created.upload}/complete`)).status).toBe(202);
  await handleUploadJob(deps(), { upload_id: created.upload });
  return created.upload;
}

interface ImportBody {
  import: string;
  status: string;
  error_code?: string;
  error_detail?: string;
  creation?: string;
  needs_confirmation: string[];
  confirmed_at: string | null;
  report?: {
    container: string;
    omitted_policy_fields: { field: string; value: string }[];
    needs_confirmation: string[];
    assets: {
      type: string;
      name: string;
      imported: boolean;
      slot?: string;
      variant?: string;
      reason?: string;
    }[];
  };
}

async function startImport(user: string, uploadId: string, namespace: string, name: string) {
  const res = await h.as(user).post("/v1/imports", { upload: uploadId, namespace, name });
  return { res, body: (await res.json()) as ImportBody };
}

function uuidOf(importId: string): string {
  const id = decodeId("import", importId);
  if (!id) throw new Error(`bad import id ${importId}`);
  return id;
}

async function status(user: string, importId: string) {
  const res = await h.as(user).get(`/v1/imports/${importId}`);
  return { res, body: (await res.json()) as ImportBody };
}

describe("importing a PNG card", () => {
  let importId = "";
  let uploadId = "";

  it("queues the import and creates a draft with processed images and a private report", async () => {
    const png = await pngCard(card());
    uploadId = await upload(alice, png, "image/png");
    // 导入用的 PNG 不被重新编码：原件（带角色数据）留给导入任务。
    const [u] = await t.app.db.select().from(uploads).where(eq(uploads.id, uploadId));
    expect(u?.status).toBe("ready");
    expect(await h.services.cas.exists("uploads", stagingKeyFor(uploadId))).toBe(true);

    const { res, body } = await startImport(alice, uploadId, "alice", "mira");
    expect(res.status).toBe(202);
    expect(body).toMatchObject({ status: "pending", needs_confirmation: [] });
    importId = body.import;
    expect(importId).toMatch(/^imp_/);
    const jobs = await h.queue.boss.findJobs(QUEUE_NAMES.importCcv3, {
      key: `import:${uuidOf(importId)}`,
    });
    expect(jobs).toHaveLength(1);

    expect(await handleImportJob(deps(), { import_id: uuidOf(importId) })).toBe("succeeded");

    const s = await status(alice, importId);
    expect(s.res.status).toBe(200);
    expect(s.res.headers.get("cache-control")).toBe("private, no-store");
    expect(s.body).toMatchObject({
      status: "succeeded",
      creation: "@alice/mira",
      needs_confirmation: ["meta.rating", "meta.rights", "meta.license"],
      confirmed_at: null,
      report: {
        container: "png",
        omitted_policy_fields: [{ field: "system_prompt", value: SECRET }],
      },
    });
    const avatar = s.body.report?.assets.find((a) => a.type === "icon");
    expect(avatar).toMatchObject({ imported: true, slot: "avatar", variant: "default" });

    // 原件被取走后从 uploads 桶删除；原件与报告按内容寻址存进 private 桶。
    expect(await h.services.cas.exists("uploads", stagingKeyFor(uploadId))).toBe(false);
    const [row] = await t.app.db
      .select()
      .from(imports)
      .where(eq(imports.id, uuidOf(importId)));
    expect(row?.sourceDigest).toBe(sha256Bytes(png));
    const stored = await h.services.cas.getBlob("private", row?.sourceDigest ?? "");
    expect(sha256Bytes(stored)).toBe(sha256Bytes(png));
    const [reportMeta] = await t.app.db
      .select()
      .from(blobs)
      .where(eq(blobs.digest, row?.reportDigest ?? ""));
    expect(reportMeta).toMatchObject({ kind: "report", inPrivate: true, inPublic: false });
  });

  it("keeps policy text out of the draft and records only the field name", async () => {
    const res = await h.as(alice).get("/v1/creations/@alice/mira/draft");
    expect(res.status).toBe(200);
    const draft = (await res.json()) as {
      working: {
        id: string;
        ref: string;
        type: string;
        fragments: { id: string }[];
        assets: {
          slot: string;
          variants: { id: string; media_type: string; blob: { digest: string } }[];
        }[];
        provenance: { imported_from: { format: string; omitted_policy_fields: string[] } };
      };
    };
    const w = draft.working;
    expect(w.id).toMatch(/^cr_/);
    expect(w.ref).toBe("@alice/mira");
    expect(w.type).toBe("character");
    expect(w.fragments.map((f) => f.id)).toEqual(
      expect.arrayContaining(["description", "personality"]),
    );
    expect(w.provenance.imported_from.omitted_policy_fields).toEqual(["system_prompt"]);
    expect(JSON.stringify(w)).not.toContain("SECRET-POLICY-TEXT");

    // 头像是重新编码后的 webp，并且登记在 asset_meta 中（发布时据此判断可用）。
    const slot = w.assets.find((a) => a.slot === "avatar");
    const variant = slot?.variants[0];
    expect(variant).toMatchObject({ id: "default", media_type: "image/webp" });
    const digest = variant?.blob.digest ?? "";
    const [meta] = await t.app.db.select().from(assetMeta).where(eq(assetMeta.digest, digest));
    expect(meta).toMatchObject({ mediaType: "image/webp", scanStatus: "not_scanned" });
    const stored = await h.services.cas.getBlob("private", digest);
    expect((await sharp(stored).metadata()).format).toBe("webp");

    // 上传记录中登记了派生出的图片，之后被标记时可以追溯到上传者。
    const [u] = await t.app.db.select().from(uploads).where(eq(uploads.id, uploadId));
    expect((u?.result as { derived?: string[] } | undefined)?.derived).toContain(digest);
  });

  it("is idempotent for the same upload and rejects reusing it for another name", async () => {
    const again = await startImport(alice, uploadId, "alice", "mira");
    expect(again.res.status).toBe(200);
    expect(again.body.import).toBe(importId);
    const other = await startImport(alice, uploadId, "alice", "mira-two");
    expect(other.res.status).toBe(409);
    expect(other.body).toMatchObject({ code: "import.upload_used" });
    // 重复投递同一个任务不会再创建任何东西。
    expect(await handleImportJob(deps(), { import_id: uuidOf(importId) })).toBe("skipped");
  });

  it("is visible only to the person who started it", async () => {
    expect((await status(bob, importId)).res.status).toBe(404);
    expect((await h.as(null).get(`/v1/imports/${importId}`)).status).toBe(404);
    const confirm = await h.as(bob).post(`/v1/imports/${importId}/confirm`, {
      rating: "general",
      rights: "original",
      license: "CC-BY-4.0",
    });
    expect(confirm.status).toBe(404);
  });

  it("refuses to publish until the rating, rights and license are confirmed", async () => {
    const me = h.as(alice);
    const rev = (await (await me.post("/v1/creations/@alice/mira/revisions", {})).json()) as {
      id: string;
    };
    const blocked = await me.post(
      "/v1/creations/@alice/mira/releases",
      { revision: rev.id, label: "1.0.0", visibility: "public" },
      { "idempotency-key": "import-test-0001" },
    );
    expect(blocked.status).toBe(422);
    expect(await blocked.json()).toMatchObject({ code: "publish.import_unconfirmed" });

    const before = (await (await me.get("/v1/creations/@alice/mira/draft")).json()) as {
      version: number;
    };
    const confirm = await me.post(`/v1/imports/${importId}/confirm`, {
      rating: "teen",
      rights: "original",
      license: "CC-BY-4.0",
    });
    expect(confirm.status).toBe(200);
    expect(await confirm.json()).toMatchObject({ needs_confirmation: [] });
    const after = (await (await me.get("/v1/creations/@alice/mira/draft")).json()) as {
      version: number;
      working: { meta: Record<string, unknown> };
    };
    expect(after.version).toBe(before.version + 1);
    expect(after.working.meta).toMatchObject({
      rating: "teen",
      rights: "original",
      license: "CC-BY-4.0",
    });
    const twice = await me.post(`/v1/imports/${importId}/confirm`, {
      rating: "teen",
      rights: "original",
      license: "CC-BY-4.0",
    });
    expect(twice.status).toBe(409);

    const rev2 = (await (await me.post("/v1/creations/@alice/mira/revisions", {})).json()) as {
      id: string;
    };
    const ok = await me.post(
      "/v1/creations/@alice/mira/releases",
      { revision: rev2.id, label: "1.0.0", visibility: "public" },
      { "idempotency-key": "import-test-0002" },
    );
    expect(ok.status).toBe(202);
    expect(await h.runPublishJobs()).toEqual(["published"]);
  });
});

describe("POST /v1/imports checks", () => {
  it("requires sign-in and a valid body", async () => {
    const anon = await h.as(null).post("/v1/imports", {
      upload: "00000000-0000-0000-0000-000000000000",
      namespace: "alice",
      name: "x",
    });
    expect(anon.status).toBe(401);
    const bad = await h.as(alice).post("/v1/imports", { upload: 1 });
    expect(bad.status).toBe(422);
  });

  it("only imports into namespaces the caller can write to", async () => {
    const id = await upload(bob, await pngCard(card()), "image/png");
    const other = await startImport(bob, id, "alice", "stolen");
    expect(other.res.status).toBe(403);
    const missing = await startImport(bob, id, "nobody-here", "x");
    expect(missing.res.status).toBe(404);
    // 别人的上传与不存在的上传一样是 404。
    const foreign = await startImport(alice, id, "alice", "borrowed");
    expect(foreign.res.status).toBe(404);
  });

  it("rejects a name that is already taken", async () => {
    await h.as(alice).post("/v1/namespaces/alice/creations", {
      name: "taken",
      type: "character",
      display_name: "Taken",
    });
    const id = await upload(alice, await pngCard(card()), "image/png");
    const r = await startImport(alice, id, "alice", "taken");
    expect(r.res.status).toBe(409);
    expect(r.body).toMatchObject({ code: "creation.taken" });
  });

  it("rejects uploads that were not created for import", async () => {
    const id = await upload(alice, await solidPng(), "image/png", "asset");
    const r = await startImport(alice, id, "alice", "not-a-card");
    expect(r.res.status).toBe(422);
    expect(r.body).toMatchObject({ code: "import.wrong_purpose" });
  });
});

describe("failed imports", () => {
  async function importAndRun(bytes: Uint8Array, type: string, name: string) {
    const id = await upload(alice, bytes, type);
    const { res, body } = await startImport(alice, id, "alice", name);
    expect(res.status).toBe(202);
    expect(await handleImportJob(deps(), { import_id: uuidOf(body.import) })).toBe("failed");
    return (await status(alice, body.import)).body;
  }

  it("reports a card that cannot be parsed", async () => {
    const bytes = utf8Encode(JSON.stringify({ spec: "chara_card_v3", data: 5 }));
    const s = await importAndRun(bytes, "application/json", "broken");
    expect(s).toMatchObject({
      status: "failed",
      error_code: "import.parse_failed",
      error_detail: "ccv3.invalid_card",
    });
    expect(s.creation).toBeUndefined();
    const [row] = await t.app.db.select().from(creations).where(eq(creations.name, "broken"));
    expect(row).toBeUndefined();
  });

  it("reports a PNG without card data", async () => {
    const s = await importAndRun(await solidPng(), "image/png", "plain-png");
    expect(s).toMatchObject({
      error_code: "import.parse_failed",
      error_detail: "ccv3.no_card_data",
    });
  });

  it("rejects content whose real format does not match the declared type", async () => {
    const s = await importAndRun(utf8Encode("definitely not a card"), "application/json", "text");
    expect(s).toMatchObject({ error_code: "import.unsupported_format" });
    const zipAsJson = await importAndRun(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]),
      "application/json",
      "zip-as-json",
    );
    expect(zipAsJson).toMatchObject({ error_code: "import.unsupported_format" });
  });
});

describe("images inside the card", () => {
  it("drops images that cannot be processed and reports why", async () => {
    const good = base64Encode(await solidPng(32, 32, "#36a"));
    const happy = base64Encode(await solidPng(32, 32, "#3a6"));
    // PNG 文件头加上一段垃圾：看起来是图片，但无法解码。
    const broken = base64Encode(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
    );
    const c = card({
      assets: [
        { type: "icon", uri: `data:image/png;base64,${good}`, name: "main", ext: "png" },
        { type: "emotion", uri: `data:image/png;base64,${broken}`, name: "neutral", ext: "png" },
        { type: "emotion", uri: `data:image/png;base64,${happy}`, name: "happy", ext: "png" },
      ],
    });
    const id = await upload(alice, utf8Encode(JSON.stringify(c)), "application/json");
    const { body } = await startImport(alice, id, "alice", "emotive");
    expect(await handleImportJob(deps(), { import_id: uuidOf(body.import) })).toBe("succeeded");

    const s = (await status(alice, body.import)).body;
    const neutral = s.report?.assets.find((a) => a.name === "neutral");
    expect(neutral?.imported).toBe(false);
    expect(neutral?.reason).toMatch(/^upload\./);
    // default 被拒绝后，由同一 slot 里剩下的图片顶替。
    const promoted = s.report?.assets.find((a) => a.name === "happy");
    expect(promoted).toMatchObject({ imported: true, slot: "emotion", variant: "default" });

    const draft = (await (await h.as(alice).get("/v1/creations/@alice/emotive/draft")).json()) as {
      working: { assets: { slot: string; variants: { id: string; media_type: string }[] }[] };
    };
    const emotion = draft.working.assets.find((a) => a.slot === "emotion");
    expect(emotion?.variants).toEqual([
      expect.objectContaining({ id: "default", media_type: "image/webp" }),
    ]);
  });

  it("treats a scanner match like any other upload: quarantine, block, lock the account", async () => {
    const carol = await h.createUser("carol");
    await h.as(carol).post("/v1/namespaces", { slug: "carol" });
    const png = await pngCard(card(), "#777");
    const id = await upload(carol, png, "image/png");
    const { body } = await startImport(carol, id, "carol", "flagged");
    const matching: CsamScanner = {
      provider: "test",
      scan: async () => ({ status: "match", provider: "test", match_id: "match-1" }),
    };
    expect(await handleImportJob(deps(matching), { import_id: uuidOf(body.import) })).toBe(
      "failed",
    );

    const [imp] = await t.app.db
      .select()
      .from(imports)
      .where(eq(imports.id, uuidOf(body.import)));
    expect(imp).toMatchObject({ status: "failed", errorCode: "import.rejected", creationId: null });
    const [u] = await t.app.db.select().from(uploads).where(eq(uploads.id, id));
    expect(u?.status).toBe("quarantined");
    const avatarDigest = sha256Bytes(stripPngMetadata(png));
    const blocked = await t.app.db.select().from(blockedDigests);
    expect(blocked.map((b) => b.digest)).toEqual(
      expect.arrayContaining([sha256Bytes(png), avatarDigest]),
    );
    const incidents = await t.app.db
      .select()
      .from(csamIncidents)
      .where(and(eq(csamIncidents.uploadId, id)));
    expect(incidents).toHaveLength(1);
    const [user] = await t.app.db.select().from(authUser).where(eq(authUser.id, carol));
    expect(user?.banned).toBe(true);
    const [created] = await t.app.db.select().from(creations).where(eq(creations.name, "flagged"));
    expect(created).toBeUndefined();
  });
});
