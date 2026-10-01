import { base64Encode, replacePngText, utf8Encode } from "@char-pub/ccv3";
import { DraftSchema, UploadStatusSchema } from "@char-pub/contracts";
import { type CreationInput, PRESET_REGIONS, sha256Bytes } from "@char-pub/core";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { register as uploadRoutes } from "../src/api/routes/uploads.js";
import {
  creationAssetGrants,
  creationCollaborators,
  releases,
  uploads,
} from "../src/db/schema/index.js";
import { decodeId } from "../src/registry/ids.js";
import { processUpload } from "../src/upload/pipeline.js";
import { handleImportJob } from "../src/worker/import.js";
import { type ApiHarness, createHarness } from "./api-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let h: ApiHarness;
let owner: string;
let other: string;
let privateImage: BlobInfo;

interface BlobInfo {
  digest: string;
  size: number;
  media_type: string;
}
type Working = Omit<CreationInput, "id" | "ref">;
const META = {
  default_locale: "en",
  rating: "general" as const,
  rights: "original" as const,
  license: "CC0-1.0",
};

function pipelineDeps() {
  return {
    db: t.app.db,
    cas: h.services.cas,
    queue: h.queue,
    now: () => h.clock.now(),
    newId: () => h.services.ids.uuid(),
    systemActorId: owner,
  };
}

async function png(color: string): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width: 64, height: 48, channels: 3, background: color } })
      .png()
      .toBuffer(),
  );
}

/** Real upload authorization, signed PUT and processing; no synthetic ready/grant rows. */
async function upload(bytes: Uint8Array, purpose: "asset" | "import" = "asset") {
  const me = h.as(owner);
  const response = await me.post("/v1/uploads", {
    purpose,
    content_type: "image/png",
    size: bytes.byteLength,
    sha256: sha256Bytes(bytes),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  const target = (await response.json()) as {
    upload: string;
    put_url: string;
    headers: Record<string, string>;
  };
  expect(
    (
      await fetch(target.put_url, {
        method: "PUT",
        headers: target.headers,
        body: Buffer.from(bytes),
      })
    ).status,
  ).toBe(200);
  expect((await me.post(`/v1/uploads/${target.upload}/complete`)).status).toBe(202);
  expect((await processUpload(pipelineDeps(), target.upload)).state).toBe("ready");
  const status = UploadStatusSchema.parse(
    await (await me.get(`/v1/uploads/${target.upload}`)).json(),
  );
  expect(status.status).toBe("ready");
  const [row] = await t.app.db.select().from(uploads).where(eq(uploads.id, target.upload));
  if (!row) throw new Error("Missing real upload");
  return { id: target.upload, status, row };
}

function asset(blob: BlobInfo, role: "presentation" | "context" = "presentation") {
  return {
    slot: role === "presentation" ? "avatar" : "illustration",
    role,
    variants: [
      {
        id: "default",
        media_type: blob.media_type,
        blob: { digest: blob.digest, size: blob.size, availability: "mirrored" as const },
      },
    ],
  };
}

function working(
  blob: BlobInfo,
  type: "character" | "preset" = "character",
  role: "presentation" | "context" = "presentation",
): Working {
  return {
    type,
    display_name: "Asset ownership fixture",
    meta: META,
    assets: [asset(blob, role)],
    ...(type === "preset"
      ? {
          policy: {
            version: "1-draft" as const,
            blocks: [],
            layout: [...PRESET_REGIONS],
            requires: { system_role: true },
          },
        }
      : {
          fragments: [
            {
              id: "identity",
              stable: true,
              kind: "character" as const,
              content: { type: "text" as const, text: "A character with an illustration." },
            },
          ],
        }),
  };
}

async function publishWorking(
  user: string,
  base: string,
  body: Working,
  label = "1",
  visibility: "public" | "private" = "public",
) {
  const me = h.as(user);
  const draft = DraftSchema.parse(await (await me.get(`${base}/draft`)).json());
  const save = await me.put(
    `${base}/draft`,
    { working: body },
    { "if-match": String(draft.version) },
  );
  expect(save.status, await save.clone().text()).toBe(200);
  const revisionResponse = await me.post(`${base}/revisions`, {});
  expect([200, 201]).toContain(revisionResponse.status);
  const revision = (await revisionResponse.json()) as { id: string };
  const response = await me.post(
    `${base}/releases`,
    { revision: revision.id, label, visibility },
    { "idempotency-key": `${base}-${label}` },
  );
  expect(response.status, await response.clone().text()).toBe(202);
  const created = (await response.json()) as { release: string };
  const outcomes = await h.runPublishJobs();
  const id = decodeId("release", created.release);
  if (!id) throw new Error("Invalid release response");
  const [row] = await t.app.db.select().from(releases).where(eq(releases.id, id));
  if (!row) throw new Error("Missing processed release");
  return { base, release: created.release, outcomes, row };
}

async function publishNew(
  name: string,
  body: Working,
  user = owner,
  visibility: "public" | "private" = "public",
) {
  const ns = user === owner ? "asset-owner" : "asset-other";
  const response = await h.as(user).post(`/v1/namespaces/${ns}/creations`, {
    name,
    type: body.type,
    display_name: name,
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return publishWorking(user, `/v1/creations/@${ns}/${name}`, body, "1", visibility);
}

async function acceptLibraryAccess(creationId: string) {
  await t.app.db.insert(creationCollaborators).values({
    creationId,
    userId: other,
    invitedBy: owner,
    license: META.license,
    acceptedAt: h.clock.now(),
  });
}

/** The work owner never owned this upload. Its first version uses an authorized
 * private library; the next removes that dependency to exercise only local history.
 * No persisted work grant is manufactured or removed to disguise an existing grant.
 */
async function publishFromPrivateLibrary(name: string, blob: BlobInfo) {
  const dependency = await publishNew(`${name}-library`, working(blob), owner, "private");
  expect(dependency.outcomes).toEqual(["published"]);
  await acceptLibraryAccess(dependency.row.creationId);
  const first = await publishNew(
    name,
    {
      ...working(blob),
      references: [
        {
          id: "library",
          use: `@asset-owner/${name}-library`,
          mode: "default",
          pin: { release: dependency.release, semantic_digest: dependency.row.semanticDigest },
        },
      ],
    },
    other,
    "private",
  );
  expect(
    await t.app.db
      .select()
      .from(creationAssetGrants)
      .where(eq(creationAssetGrants.creationId, first.row.creationId)),
  ).toEqual([]);
  return first;
}

beforeAll(async () => {
  t = await createTestDatabase();
  h = await createHarness(t, testCas(), { extraModules: [uploadRoutes] });
  owner = await h.createUser("asset-owner");
  other = await h.createUser("asset-other");
  for (const [user, slug] of [
    [owner, "asset-owner"],
    [other, "asset-other"],
  ] as const)
    expect((await h.as(user).post("/v1/namespaces", { slug })).status).toBe(201);
  const uploaded = await upload(await png("#123956"));
  if (!uploaded.status.blob) throw new Error("Expected processed image");
  privateImage = uploaded.status.blob;
});

afterAll(async () => {
  await h?.close();
  await t?.drop();
});

describe("root mirrored asset authorization through the publish worker", () => {
  it.each([
    ["character-presentation", "character", "presentation"],
    ["character-context", "character", "context"],
    ["preset-presentation", "preset", "presentation"],
  ] as const)(
    "rejects another user's private %s without copying it public",
    async (name, type, role) => {
      await expect(h.services.cas.getBlob("public", privateImage.digest)).rejects.toThrow();
      expect(await h.services.cas.getBlob("private", privateImage.digest)).toBeInstanceOf(
        Uint8Array,
      );
      const published = await publishNew(name, working(privateImage, type, role), other);
      expect(published.outcomes).toEqual(["failed"]);
      expect(published.row.publishState).toBe("failed");
      expect(published.row.publishReport).toMatchObject({
        issues: [expect.objectContaining({ code: "asset.not_authorized" })],
      });
      await expect(h.services.cas.getBlob("public", privateImage.digest)).rejects.toThrow();
    },
  );

  it("allows the publisher's real ready upload blob", async () => {
    const uploaded = await upload(await png("#476192"));
    if (!uploaded.status.blob) throw new Error("Expected image blob");
    const published = await publishNew("owned-blob", working(uploaded.status.blob));
    expect(published.outcomes).toEqual(["published"]);
    expect(await h.services.cas.getBlob("public", uploaded.status.blob.digest)).toEqual(
      await h.services.cas.getBlob("private", uploaded.status.blob.digest),
    );
  });

  it("allows the publisher's real upload thumbnail, independently of result.blob", async () => {
    const uploaded = await upload(await png("#965127"));
    const result = uploaded.row.result as { thumbnail: string; blob: { digest: string } };
    expect(result.thumbnail).not.toBe(result.blob.digest);
    const bytes = await h.services.cas.getBlob("private", result.thumbnail);
    const published = await publishNew(
      "owned-thumbnail",
      working({ digest: result.thumbnail, size: bytes.length, media_type: "image/webp" }),
    );
    expect(published.outcomes).toEqual(["published"]);
    expect(await h.services.cas.getBlob("public", result.thumbnail)).toEqual(bytes);
  });

  it("allows actual PNG import derived images and thumbnails without forging upload results", async () => {
    const card = {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        name: "Imported owner",
        description: "A clockmaker.",
        personality: "Patient.",
        scenario: "",
        first_mes: "Hello.",
        mes_example: "",
        creator_notes: "",
        system_prompt: "",
        post_history_instructions: "",
        alternate_greetings: [],
        tags: [],
        creator: "owner",
        character_version: "1",
        extensions: {},
      },
    };
    const cardPng = replacePngText(
      await png("#659137"),
      [{ keyword: "ccv3", text: base64Encode(utf8Encode(JSON.stringify(card))) }],
      [],
    );
    const uploaded = await upload(cardPng, "import");
    const response = await h.as(owner).post("/v1/imports", {
      upload: uploaded.id,
      namespace: "asset-owner",
      name: "imported-card",
    });
    expect(response.status, await response.clone().text()).toBe(202);
    const body = (await response.json()) as { import: string };
    const importId = decodeId("import", body.import);
    if (!importId) throw new Error("Invalid import ID");
    expect(await handleImportJob(pipelineDeps(), { import_id: importId })).toBe("succeeded");
    const confirmed = await h.as(owner).post(`/v1/imports/${body.import}/confirm`, {
      rating: "general",
      rights: "original",
      license: "CC0-1.0",
    });
    expect(confirmed.status, await confirmed.clone().text()).toBe(200);
    const [row] = await t.app.db.select().from(uploads).where(eq(uploads.id, uploaded.id));
    const result = row?.result as { derived: string[]; blob?: { digest: string } };
    expect(row?.status).toBe("ready");
    expect(result.derived).toHaveLength(2);
    expect(new Set(result.derived).size).toBe(2);
    for (const [index, digest] of result.derived.entries()) {
      expect(digest).not.toBe(result.blob?.digest);
      const bytes = await h.services.cas.getBlob("private", digest);
      const published = await publishNew(
        `import-derived-${index}`,
        working({ digest, size: bytes.length, media_type: "image/webp" }),
      );
      expect(published.outcomes).toEqual(["published"]);
      expect(await h.services.cas.getBlob("public", digest)).toEqual(bytes);
    }
  });

  it("allows the work owner to reuse a real earlier asset without an independent work grant", async () => {
    const uploaded = await upload(await png("#257984"));
    if (!uploaded.status.blob) throw new Error("Expected image blob");
    const body = working(uploaded.status.blob);
    const first = await publishFromPrivateLibrary("history", uploaded.status.blob);
    expect(first.outcomes).toEqual(["published"]);
    const second = await publishWorking(
      other,
      first.base,
      { ...body, display_name: "Reusing only the work's own history" },
      "2",
    );
    expect(second.outcomes).toEqual(["published"]);
    expect(await h.services.cas.getBlob("public", uploaded.status.blob.digest)).toEqual(
      await h.services.cas.getBlob("private", uploaded.status.blob.digest),
    );
  });

  it("allows an asset supplied by a genuinely authorized pinned private dependency", async () => {
    const uploaded = await upload(await png("#834279"));
    if (!uploaded.status.blob) throw new Error("Expected image blob");
    const dependency = await publishNew(
      "asset-library",
      working(uploaded.status.blob),
      owner,
      "private",
    );
    expect(dependency.outcomes).toEqual(["published"]);
    await acceptLibraryAccess(dependency.row.creationId);
    const root: Working = {
      ...working(uploaded.status.blob),
      references: [
        {
          id: "library",
          use: "@asset-owner/asset-library",
          mode: "default",
          pin: { release: dependency.release, semantic_digest: dependency.row.semanticDigest },
        },
      ],
    };
    const published = await publishNew("authorized-dependency", root, other, "private");
    expect(published.outcomes).toEqual(["published"]);
    expect(published.row.publishState).toBe("done");
    await expect(h.services.cas.getBlob("public", uploaded.status.blob.digest)).rejects.toThrow();
  });

  it("does not upgrade an authorized linked dependency into a grant for private CAS bytes", async () => {
    const linked: Working = {
      ...working(privateImage),
      assets: [
        {
          ...asset(privateImage),
          variants: [
            {
              id: "default",
              media_type: privateImage.media_type,
              blob: {
                digest: privateImage.digest,
                size: privateImage.size,
                availability: "linked",
                locator: { provider: "http", url: "https://example.test/external-image.webp" },
              },
            },
          ],
        },
      ],
    };
    const dependency = await publishNew("linked-library", linked, other);
    expect(dependency.outcomes).toEqual(["published"]);
    await expect(h.services.cas.getBlob("public", privateImage.digest)).rejects.toThrow();
    const published = await publishNew(
      "linked-dependency-upgrade",
      {
        ...working(privateImage),
        references: [
          {
            id: "library",
            use: "@asset-other/linked-library",
            mode: "default",
            pin: { release: dependency.release, semantic_digest: dependency.row.semanticDigest },
          },
        ],
      },
      other,
    );
    expect(published.outcomes).toEqual(["failed"]);
    expect(published.row.publishReport).toMatchObject({
      issues: [expect.objectContaining({ code: "asset.not_authorized" })],
    });
    await expect(h.services.cas.getBlob("public", privateImage.digest)).rejects.toThrow();
  });

  it("does not treat the same creation's earlier linked asset as a mirrored grant", async () => {
    const linked: Working = {
      ...working(privateImage),
      assets: [
        {
          ...asset(privateImage),
          variants: [
            {
              id: "default",
              media_type: privateImage.media_type,
              blob: {
                digest: privateImage.digest,
                size: privateImage.size,
                availability: "linked",
                locator: { provider: "http", url: "https://example.test/external-image.webp" },
              },
            },
          ],
        },
      ],
    };
    const first = await publishNew("linked-history", linked, other);
    expect(first.outcomes).toEqual(["published"]);
    const second = await publishWorking(other, first.base, working(privateImage), "2");
    expect(second.outcomes).toEqual(["failed"]);
    expect(second.row.publishReport).toMatchObject({
      issues: [expect.objectContaining({ code: "asset.not_authorized" })],
    });
    await expect(h.services.cas.getBlob("public", privateImage.digest)).rejects.toThrow();
  });

  it("does not grant the work owner bytes found only in tombstoned history", async () => {
    const uploaded = await upload(await png("#527439"));
    if (!uploaded.status.blob) throw new Error("Expected image blob");
    const body = working(uploaded.status.blob);
    const first = await publishFromPrivateLibrary("tombstoned-history", uploaded.status.blob);
    expect(first.outcomes).toEqual(["published"]);
    await t.app.db
      .update(releases)
      .set({ status: "tombstoned", statusReason: "test-history-grant-revoked" })
      .where(eq(releases.id, first.row.id));
    const second = await publishWorking(
      other,
      first.base,
      { ...body, display_name: "After tombstone" },
      "2",
    );
    expect(second.outcomes).toEqual(["failed"]);
    expect(second.row.publishReport).toMatchObject({
      issues: [expect.objectContaining({ code: "asset.not_authorized" })],
    });
    await expect(h.services.cas.getBlob("public", uploaded.status.blob.digest)).rejects.toThrow();
  });
});
