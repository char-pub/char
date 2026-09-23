/**
 * 读取与下载接口：详情、改名重定向、私有内容 404、tombstoned 410、yanked 警告、
 * IR 的公共 / 签名下载、CCv3 lazy build、反向依赖。
 */
import { sha256Bytes } from "@char-pub/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CCV3_EXPORT_VERSION } from "../src/api/routes/read.js";
import { buildArtifacts, creationRedirects, namespaceRedirects } from "../src/db/schema/index.js";
import { QUEUE_NAMES } from "../src/jobs/definitions.js";
import { exportCacheKey } from "../src/registry/read.js";
import { createHarness, type Harness, TEST_PUBLIC_BASE } from "./fixtures/harness.js";
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
let owner: string;
let stranger: string;
let world: PublishedRelease;
let alice: PublishedRelease;
let secret: PublishedRelease;
let nsId: string;

beforeAll(async () => {
  h = await createHarness();
  const { db, cas } = h.services;
  owner = await createUser(db, { name: "owner" });
  stranger = await createUser(db, { name: "stranger" });
  nsId = await createNamespace(db, "djj", owner);
  const cyber = await createNamespace(db, "cyberpunk");
  world = await publishRelease({
    db,
    cas,
    namespaceId: cyber,
    label: "1.0.0",
    publicAssetBaseUrl: TEST_PUBLIC_BASE(),
    creation: {
      ref: "@cyberpunk/night-city",
      type: "world",
      display_name: "Night City",
      fragments: [textFragment("world", "world", "A megacity.")],
      meta: { ...META, rating: "mature" },
    },
  });
  alice = await publishRelease({
    db,
    cas,
    namespaceId: nsId,
    label: "1.0.0",
    dependencies: [world],
    creation: {
      ref: "@djj/alice",
      type: "character",
      display_name: "Alice",
      fragments: [textFragment("description", "character", "{{self}} is a courier.")],
      references: [
        { id: "lives-in", use: "@cyberpunk/night-city", mode: "intrinsic", pin: pinOf(world) },
      ],
      meta: META,
    },
  });
  secret = await publishRelease({
    db,
    cas,
    namespaceId: nsId,
    label: "0.1.0",
    visibility: "private",
    creation: {
      ref: "@djj/secret",
      type: "character",
      display_name: "Secret",
      fragments: [textFragment("description", "character", "{{self}} is hidden.")],
      meta: META,
    },
  });
});

afterAll(async () => {
  await h.close();
});

describe("creation detail", () => {
  it("returns public creations to anyone, with effective rating from dependencies", async () => {
    const r = await h.request("/v1/creations/@djj/alice");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toContain("public");
    const body = await r.json();
    expect(body).toMatchObject({
      ref: "@djj/alice",
      type: "character",
      rating: "general",
      effective_rating: "mature",
      latest_release: { label: "1.0.0", status: "active" },
    });
    expect(body.id).toMatch(/^cr_/);
    expect(body.releases).toHaveLength(1);
  });

  it("counts public dependents", async () => {
    const body = await (await h.request("/v1/creations/@cyberpunk/night-city")).json();
    expect(body.dependents_count).toBe(1);
  });

  it("hides creations without public releases from non-members with 404", async () => {
    expect((await h.request("/v1/creations/@djj/secret")).status).toBe(404);
    expect((await h.request("/v1/creations/@djj/secret", { user: stranger })).status).toBe(404);
    const own = await h.request("/v1/creations/@djj/secret", { user: owner });
    expect(own.status).toBe(200);
    expect(own.headers.get("cache-control")).toBe("private, no-store");
    expect((await own.json()).releases[0].visibility).toBe("private");
  });

  it("returns 404 for unknown creations and namespaces", async () => {
    expect((await h.request("/v1/creations/@djj/nobody")).status).toBe(404);
    expect((await h.request("/v1/creations/@nobody/alice")).status).toBe(404);
    expect(
      ((await (await h.request("/v1/creations/@djj/nobody")).json()) as { code: string }).code,
    ).toBe("not_found");
  });

  it("redirects renamed namespaces and creations permanently", async () => {
    const { db } = h.services;
    await db.insert(namespaceRedirects).values({ oldSlug: "old-djj", namespaceId: nsId });
    await db
      .insert(creationRedirects)
      .values({ namespaceId: nsId, oldName: "alicia", creationId: alice.creationId });
    const a = await h.request("/v1/creations/@old-djj/alice/releases/1.0.0?x=1");
    expect(a.status).toBe(301);
    expect(a.headers.get("location")).toBe("/v1/creations/@djj/alice/releases/1.0.0?x=1");
    const b = await h.request("/v1/creations/@djj/alicia");
    expect(b.status).toBe(301);
    expect(b.headers.get("location")).toBe("/v1/creations/@djj/alice");
  });
});

describe("release detail", () => {
  it("redirects @ns/name@label to the release path", async () => {
    const r = await h.request("/v1/creations/@djj/alice@1.0.0");
    expect(r.status).toBe(308);
    expect(r.headers.get("location")).toBe("/v1/creations/@djj/alice/releases/1.0.0");
  });

  it("returns release metadata", async () => {
    const r = await h.request("/v1/creations/@djj/alice/releases/1.0.0");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      label: "1.0.0",
      semantic_digest: alice.semanticDigest,
      context_ir_digest: alice.irDigest,
      effective_rating: "mature",
    });
  });

  it("hides private releases from others with 404, even by exact label", async () => {
    expect((await h.request("/v1/creations/@djj/secret/releases/0.1.0")).status).toBe(404);
    expect(
      (await h.request("/v1/creations/@djj/secret/releases/0.1.0/ir", { user: stranger })).status,
    ).toBe(404);
    expect((await h.request("/v1/creations/@djj/alice/releases/9.9.9")).status).toBe(404);
  });

  it("returns 410 with the public reason code for tombstoned releases", async () => {
    const { db, cas } = h.services;
    const gone = await publishRelease({
      db,
      cas,
      namespaceId: nsId,
      label: "1.0.0",
      status: "tombstoned",
      statusReason: "legal.dmca",
      creation: {
        ref: "@djj/gone",
        type: "character",
        display_name: "Gone",
        fragments: [textFragment("description", "character", "{{self}} was removed.")],
        meta: META,
      },
    });
    for (const path of ["", "/ir", "/export/ccv3"]) {
      const r = await h.request(`/v1/creations/@djj/gone/releases/${gone.label}${path}`);
      expect(r.status).toBe(410);
      expect(r.headers.get("content-type")).toBe("application/problem+json");
      expect(await r.json()).toMatchObject({
        code: "release.tombstoned",
        reason: "legal.dmca",
        ref: "@djj/gone@1.0.0",
      });
    }
  });

  it("returns yanked releases with a warning", async () => {
    const { db, cas } = h.services;
    await publishRelease({
      db,
      cas,
      namespaceId: nsId,
      label: "2.0.0",
      status: "yanked",
      statusReason: "broken greeting",
      creation: {
        ref: "@djj/yanked",
        type: "character",
        display_name: "Yanked",
        fragments: [textFragment("description", "character", "{{self}} was yanked.")],
        meta: META,
      },
    });
    const r = await h.request("/v1/creations/@djj/yanked/releases/2.0.0");
    expect(r.status).toBe(200);
    expect((await r.json()).warning).toContain("broken greeting");
    const detail = await (await h.request("/v1/creations/@djj/yanked")).json();
    expect(detail.warning).toContain("yanked");
  });
});

describe("IR download", () => {
  it("redirects public IR to the immutable CDN URL, which serves the exact bytes", async () => {
    const r = await h.request("/v1/creations/@djj/alice/releases/1.0.0/ir");
    expect(r.status).toBe(302);
    expect(r.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const location = r.headers.get("location") ?? "";
    const hex = alice.irDigest.slice("sha256:".length);
    expect(location).toBe(`${TEST_PUBLIC_BASE()}/${hex.slice(0, 2)}/${hex}`);
    const blob = new Uint8Array(await (await fetch(location)).arrayBuffer());
    expect(sha256Bytes(blob)).toBe(alice.irDigest);
    const ir = JSON.parse(new TextDecoder().decode(blob));
    expect(ir.root.ref).toBe("@djj/alice");
    // IR 永远不包含签名 URL：只有 public + mirrored 的 asset 才有稳定的公共 URL。
    expect(JSON.stringify(ir)).not.toMatch(/X-Amz-Signature|X-Amz-Credential/i);
  });

  it("gives members a short-lived signed URL for private IR, and nobody else", async () => {
    const r = await h.request("/v1/creations/@djj/secret/releases/0.1.0/ir", { user: owner });
    expect(r.status).toBe(302);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    const location = r.headers.get("location") ?? "";
    expect(location).toContain("X-Amz-Expires=300");
    const res = await fetch(location);
    expect(res.status).toBe(200);
    expect(sha256Bytes(new Uint8Array(await res.arrayBuffer()))).toBe(secret.irDigest);
    // 私有对象不在 public 桶里：猜到 digest 也读不到。
    const hex = secret.irDigest.slice("sha256:".length);
    expect((await fetch(`${TEST_PUBLIC_BASE()}/${hex.slice(0, 2)}/${hex}`)).status).toBe(404);
  });
});

describe("CCv3 export (lazy build)", () => {
  it("schedules a build once and answers 202 with Retry-After until it is cached", async () => {
    const path = "/v1/creations/@djj/alice/releases/1.0.0/export/ccv3";
    const a = await h.request(path);
    expect(a.status).toBe(202);
    expect(a.headers.get("retry-after")).toBe("5");
    expect((await h.request(path)).status).toBe(202);
    const jobs = await h.queue.boss.findJobs<{ cache_key: string }>(QUEUE_NAMES.exportBuild);
    expect(jobs.filter((j) => j.state === "created")).toHaveLength(1);

    const key = exportCacheKey({
      semantic_digest: alice.semanticDigest,
      lock_digest: (await (await h.request("/v1/creations/@djj/alice/releases/1.0.0")).json())
        .lock_digest,
      target: "ccv3",
      compiler_version: CCV3_EXPORT_VERSION,
    });
    expect(jobs[0]?.data.cache_key).toBe(key);
    const exported = await h.services.cas.putBlob(h.services.db, {
      bucket: "public",
      bytes: new TextEncoder().encode('{"spec":"chara_card_v3"}'),
      mediaType: "application/json",
      kind: "export",
    });
    await h.services.db
      .insert(buildArtifacts)
      .values({ cacheKey: key, target: "ccv3", blobDigest: exported.digest });
    const hit = await h.request(path);
    expect(hit.status).toBe(302);
    expect(hit.headers.get("location")).toContain(exported.digest.slice(7));
  });
});

describe("dependents", () => {
  it("lists public dependents with pagination", async () => {
    const { db, cas } = h.services;
    for (let i = 0; i < 3; i++) {
      await publishRelease({
        db,
        cas,
        namespaceId: nsId,
        label: "1.0.0",
        dependencies: [world],
        creation: {
          ref: `@djj/visitor-${i}`,
          type: "character",
          display_name: `Visitor ${i}`,
          fragments: [textFragment("description", "character", "{{self}} visits.")],
          references: [
            { id: "w", use: "@cyberpunk/night-city", mode: "default", pin: pinOf(world) },
          ],
          meta: META,
        },
      });
    }
    // 私有的依赖方不出现在列表里。
    await publishRelease({
      db,
      cas,
      namespaceId: nsId,
      label: "1.0.0",
      visibility: "private",
      dependencies: [world],
      creation: {
        ref: "@djj/private-visitor",
        type: "character",
        display_name: "Private visitor",
        fragments: [textFragment("description", "character", "{{self}} hides.")],
        references: [{ id: "w", use: "@cyberpunk/night-city", mode: "default", pin: pinOf(world) }],
        meta: META,
      },
    });
    const first = await (
      await h.request("/v1/creations/@cyberpunk/night-city/dependents?limit=2")
    ).json();
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).toMatch(/^rel_/);
    const second = await (
      await h.request(
        `/v1/creations/@cyberpunk/night-city/dependents?limit=2&cursor=${first.next_cursor}`,
      )
    ).json();
    const refs = [...first.items, ...second.items].map((x: { ref: string }) => x.ref).sort();
    expect(refs).toEqual(["@djj/alice", "@djj/visitor-0", "@djj/visitor-1", "@djj/visitor-2"]);
    expect(second.next_cursor).toBeNull();
    expect(refs).not.toContain("@djj/private-visitor");
  });
});
