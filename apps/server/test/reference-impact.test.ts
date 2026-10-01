import {
  DraftBuildResponseSchema,
  DraftSchema,
  ReferenceImpactResponseSchema,
} from "@char-pub/contracts";
import type { CreationInput } from "@char-pub/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { register as reads } from "../src/api/routes/read.js";
import { displayPrefix, generateToken, hashToken } from "../src/auth/tokens.js";
import { apiTokens, creationCollaborators, releases } from "../src/db/schema/index.js";
import { decodeId } from "../src/registry/ids.js";
import { handleDraftBuild } from "../src/worker/draft-build.js";
import { type ApiHarness, createHarness } from "./api-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let h: ApiHarness;
let owner: string;
let other: string;
let seq = 0;
const meta = {
  default_locale: "en",
  license: "CC0-1.0",
  rights: "original",
  rating: "general",
} as const;
const fragment = (id: string) => ({
  id,
  stable: true,
  kind: "knowledge" as const,
  content: { type: "text" as const, text: `Content ${id}` },
});
const working = (extra: Partial<CreationInput> = {}) => ({
  type: "character",
  display_name: "Impact source",
  meta,
  fragments: [
    {
      id: "description",
      stable: true,
      kind: "character",
      content: { type: "text", text: "A courier" },
    },
    fragment("obsolete"),
  ],
  ...extra,
});
async function json(response: Response, status: number) {
  expect(response.status, await response.clone().text()).toBe(status);
  return response.json();
}
const id = (kind: "creation" | "release" | "draft_build", value: string) => {
  const result = decodeId(kind, value);
  if (!result) throw new Error("Invalid test ID");
  return result;
};
async function create(user: string, ns: string, body = working()) {
  const result = await json(
    await h.as(user).post(`/v1/namespaces/${ns}/creations`, {
      name: `work-${++seq}`,
      type: body.type,
      display_name: body.display_name,
      working: body,
    }),
    201,
  );
  return {
    user,
    ref: result.ref as string,
    path: `/v1/creations/${result.ref}`,
    creationId: id("creation", result.id),
  };
}
type Work = Awaited<ReturnType<typeof create>>;
async function publish(w: Work, visibility: "public" | "private" = "public") {
  const revisionResponse = await h.as(w.user).post(`${w.path}/revisions`, {});
  expect([200, 201]).toContain(revisionResponse.status);
  const revision = await revisionResponse.json();
  const receipt = await json(
    await h
      .as(w.user)
      .post(
        `${w.path}/releases`,
        { revision: revision.id, label: "1.0.0", visibility },
        { "idempotency-key": `impact-${++seq}` },
      ),
    202,
  );
  expect(await h.runPublishJobs()).toEqual(["published"]);
  return {
    ref: w.ref,
    release: receipt.release as string,
    semantic_digest: revision.semantic_digest as string,
  };
}
async function candidate(w: Work) {
  const draft = DraftSchema.parse(await json(await h.as(w.user).get(`${w.path}/draft`), 200));
  const current = draft.working as CreationInput;
  await json(
    await h.as(w.user).put(
      `${w.path}/draft`,
      {
        working: { ...current, fragments: current.fragments?.filter((f) => f.id !== "obsolete") },
      },
      { "if-match": String(draft.version) },
    ),
    200,
  );
  const newer = DraftSchema.parse(await json(await h.as(w.user).get(`${w.path}/draft`), 200));
  const receipt = DraftBuildResponseSchema.parse(
    await json(
      await h.as(w.user).post(`${w.path}/draft-builds`, {}, { "if-match": String(newer.version) }),
      202,
    ),
  );
  expect(
    await handleDraftBuild(h.services, { build_id: id("draft_build", receipt.origin.build_id) }),
  ).toBe("ready");
  return receipt;
}
const edge = (pin: Awaited<ReturnType<typeof publish>>) => ({
  id: "upstream",
  use: pin.ref,
  mode: "default" as const,
  pin: { release: pin.release, semantic_digest: pin.semantic_digest },
});
beforeAll(async () => {
  t = await createTestDatabase();
  h = await createHarness(t, testCas(), { extraModules: [reads] });
  owner = await h.createUser("Impact owner");
  other = await h.createUser("Other author");
  await json(await h.as(owner).post("/v1/namespaces", { slug: "impact-owner" }), 201);
  await json(await h.as(other).post("/v1/namespaces", { slug: "impact-other" }), 201);
});
afterAll(async () => {
  await h?.close();
  await t?.drop();
});

it("computes removals from reviewed immutable revisions and distinguishes included vs explicit use without changing exact pins", async () => {
  const source = await create(owner, "impact-owner");
  const pin = await publish(source);
  const included = await create(other, "impact-other", working({ references: [edge(pin)] }));
  const includedPin = await publish(included);
  const excluded = await create(
    other,
    "impact-other",
    working({ references: [{ ...edge(pin), select: { exclude: ["obsolete"] } }] }),
  );
  await publish(excluded);
  const receipt = await candidate(source);
  const path = `/v1/draft-builds/${receipt.origin.build_id}/reference-impact?base_release=${pin.release}`;
  const response = await h.as(owner).get(path);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const report = ReferenceImpactResponseSchema.parse(await json(response, 200));
  expect(report.objects).toEqual([{ kind: "fragment", id: "obsolete" }]);
  expect(report.candidate.origin).toEqual(receipt.origin);
  expect(report.items.find((item) => item.ref === included.ref)?.uses).toContainEqual(
    expect.objectContaining({ kind: "included", object: { kind: "fragment", id: "obsolete" } }),
  );
  const excludeUses = report.items.find((item) => item.ref === excluded.ref)?.uses;
  expect(excludeUses).toContainEqual(
    expect.objectContaining({ kind: "explicit", path: "references[upstream].select.exclude[0]" }),
  );
  expect(excludeUses?.some((use) => use.kind === "included")).toBe(false);
  expect(
    report.items.every((item) => item.pins.some((locked) => locked.release === pin.release)),
  ).toBe(true);
  expect((await h.as(other).get(path)).status).toBe(404);
  expect((await h.as(null).get(path)).status).toBe(404);
  expect((await h.as(owner).get(path.replace(pin.release, includedPin.release))).status).toBe(404);
  // New local edits cannot silently replace the exact reviewed revision used by this receipt.
  const draft = DraftSchema.parse(await json(await h.as(owner).get(`${source.path}/draft`), 200));
  await json(
    await h
      .as(owner)
      .put(
        `${source.path}/draft`,
        { working: { ...(draft.working as CreationInput), fragments: working().fragments } },
        { "if-match": String(draft.version) },
      ),
    200,
  );
  const again = ReferenceImpactResponseSchema.parse(await json(await h.as(owner).get(path), 200));
  expect(again.objects).toEqual(report.objects);
  expect(again.candidate).toEqual(report.candidate);
});

it("does not expose inaccessible private release identities, counts or pagination positions; accepted collaborators are revalidated", async () => {
  const source = await create(owner, "impact-owner");
  const pin = await publish(source);
  const pub = await create(other, "impact-other", working({ references: [edge(pin)] }));
  await publish(pub);
  const own = await create(owner, "impact-owner", working({ references: [edge(pin)] }));
  await publish(own, "private");
  const receipt = await candidate(source);
  const path = `/v1/draft-builds/${receipt.origin.build_id}/reference-impact?base_release=${pin.release}&limit=1`;
  const before = ReferenceImpactResponseSchema.parse(await json(await h.as(owner).get(path), 200));
  const hidden = await create(other, "impact-other", working({ references: [edge(pin)] }));
  const secretPin = await publish(hidden, "private");
  const after = ReferenceImpactResponseSchema.parse(await json(await h.as(owner).get(path), 200));
  expect(after).toEqual(before);
  expect(JSON.stringify(after)).not.toContain(secretPin.release);
  expect(after.next_cursor).toBeTruthy();
  const second = ReferenceImpactResponseSchema.parse(
    await json(await h.as(owner).get(`${path}&cursor=${after.next_cursor}`), 200),
  );
  expect(second.items.map((item) => item.ref)).toEqual([pub.ref]);
  expect(second.next_cursor).toBeNull();
  await t.app.db.insert(creationCollaborators).values({
    creationId: hidden.creationId,
    userId: owner,
    invitedBy: other,
    license: "CC0-1.0",
    acceptedAt: h.clock.now(),
  });
  const allowed = ReferenceImpactResponseSchema.parse(await json(await h.as(owner).get(path), 200));
  expect(allowed.items[0]?.ref).toBe(hidden.ref);
  await t.app.db
    .delete(creationCollaborators)
    .where(eq(creationCollaborators.creationId, hidden.creationId));
  expect(ReferenceImpactResponseSchema.parse(await json(await h.as(owner).get(path), 200))).toEqual(
    before,
  );
});

it("reports scan failure instead of an empty impact when a readable downstream snapshot is unavailable", async () => {
  const source = await create(owner, "impact-owner");
  const pin = await publish(source);
  const downstream = await create(other, "impact-other", working({ references: [edge(pin)] }));
  const dep = await publish(downstream);
  const receipt = await candidate(source);
  await t.app.db
    .update(releases)
    .set({ snapshotDigest: null })
    .where(eq(releases.id, id("release", dep.release)));
  const response = await h
    .as(owner)
    .get(
      `/v1/draft-builds/${receipt.origin.build_id}/reference-impact?base_release=${pin.release}`,
    );
  expect(response.status).toBe(503);
  const body = await response.text();
  expect(body).toContain("reference_impact.scan_unavailable");
  expect(body).not.toContain(dep.release);
  expect(body).not.toContain(downstream.ref);
});

it("requires the owner's read scope for the author-only diagnostic, even with valid publish authority", async () => {
  const source = await create(owner, "impact-owner");
  const pin = await publish(source);
  const receipt = await candidate(source);
  const token = generateToken();
  const [stored] = await t.app.db
    .insert(apiTokens)
    .values({
      userId: owner,
      id: h.services.ids.uuid(),
      name: "Publish only",
      prefix: displayPrefix(token),
      tokenHash: hashToken(token),
      scopes: ["publish"],
    })
    .returning();
  if (!stored) throw new Error("Token was not stored");
  const path = `/v1/draft-builds/${receipt.origin.build_id}/reference-impact?base_release=${pin.release}`;
  expect((await h.withToken(token).get(path)).status).toBe(403);
  await t.app.db
    .update(apiTokens)
    .set({ scopes: ["creations:read"] })
    .where(eq(apiTokens.id, stored.id));
  expect((await h.withToken(token).get(path)).status).toBe(200);
});
