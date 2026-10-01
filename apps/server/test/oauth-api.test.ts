/** Actual OAuth authorization codes and cookies against the complete Registry API. */
import { createHash, randomUUID } from "node:crypto";
import { DraftBuildResponseSchema, DraftSchema, UploadStatusSchema } from "@char-pub/contracts";
import { CreationArtifactSchema, canonicalFragment, sha256Bytes } from "@char-pub/core";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createApi } from "../src/api/server.js";
import { createAuth, SESSION_COOKIE, sessionPrincipalResolver } from "../src/auth/better-auth.js";
import { createOAuthService } from "../src/auth/oauth.js";
import * as s from "../src/db/schema/index.js";
import { API_MODULES } from "../src/processes/modules.js";
import { decodeId, encodeId } from "../src/registry/ids.js";
import { processUpload } from "../src/upload/pipeline.js";
import { handleDraftBuild } from "../src/worker/draft-build.js";
import { type ApiHarness, createHarness, ORIGIN } from "./api-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

const API = "https://api.char.pub";
const RUNTIME = "https://runtime.example";
const REDIRECT = `${RUNTIME}/callback`;
const VERIFIER = "x".repeat(64);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
let t: TestDatabase;
let h: ApiHarness;
let auth: ReturnType<typeof createAuth>;
let app: ReturnType<typeof createApi>;
interface Actor {
  id: string;
  slug: string;
  cookie: string;
}
let owner: Actor;
let other: Actor;
let serial = 0;

function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error("Expected protocol value");
  return value;
}
function uuid(kind: "creation" | "draft_build" | "contribution", id: string) {
  return required(decodeId(kind, id));
}
function send(
  method: string,
  path: string,
  proof: Actor | string | null,
  body?: unknown,
  extra: Record<string, string> = {},
) {
  const headers: Record<string, string> = {
    ...(typeof proof === "string"
      ? { authorization: `Bearer ${proof}`, origin: RUNTIME }
      : proof
        ? { cookie: proof.cookie, origin: ORIGIN }
        : {}),
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    ...extra,
  };
  return app.request(`${API}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function actor(slug: string): Promise<Actor> {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    { email: `${randomUUID()}@private.test`, name: "Private Login Name", emailVerified: true },
    { method: "admin" },
  );
  const session = await ctx.internalAdapter.createSession(user.id);
  const result = {
    id: user.id,
    slug,
    cookie: `${SESSION_COOKIE}=${encodeURIComponent(`${session.token}.${await makeSignature(session.token, ctx.secret)}`)}`,
  };
  const response = await send("POST", "/v1/namespaces", result, { slug });
  expect(response.status, await response.clone().text()).toBe(201);
  return result;
}
async function grant(who: Actor, scope: string) {
  const registration = await send("POST", "/v1/me/oauth/clients", who, {
    name: "External Runtime",
    redirect_uris: [REDIRECT],
  });
  expect(registration.status, await registration.clone().text()).toBe(201);
  const client = (await registration.json()) as { client_id: string };
  const query = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "trusted-client-state",
  });
  const authorize = await send("GET", `/v1/auth/oauth2/authorize?${query}`, who);
  expect(authorize.status, await authorize.clone().text()).toBe(302);
  const signed = new URL(required(authorize.headers.get("location"))).search.slice(1);
  const details = await send("POST", "/v1/oauth/consent/details", who, { oauth_query: signed });
  expect(details.status, await details.clone().text()).toBe(200);
  expect(await details.json()).toMatchObject({
    client_id: client.client_id,
    redirect_uri: REDIRECT,
  });
  const decision = await send("POST", "/v1/oauth/consent", who, {
    oauth_query: signed,
    accept: true,
  });
  expect(decision.status, await decision.clone().text()).toBe(200);
  const location = new URL(((await decision.json()) as { redirect_uri: string }).redirect_uri);
  const exchange = await app.request(`${API}/v1/auth/oauth2/token`, {
    method: "POST",
    headers: { origin: RUNTIME, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.client_id,
      grant_type: "authorization_code",
      code: required(location.searchParams.get("code")),
      code_verifier: VERIFIER,
      redirect_uri: REDIRECT,
    }),
  });
  expect(exchange.status, await exchange.clone().text()).toBe(200);
  expect(exchange.headers.get("access-control-allow-origin")).toBe("*");
  expect(exchange.headers.has("access-control-allow-credentials")).toBe(false);
  const token = (await exchange.json()) as { access_token: string; refresh_token?: string };
  return { client_id: client.client_id, token: token.access_token };
}
const fragment = (text = "A careful courier.") => ({
  id: "description",
  stable: true,
  kind: "character" as const,
  content: { type: "text" as const, text },
});
function definition() {
  return {
    fragments: [fragment()],
    meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
  };
}
async function newWork(who: Actor, working: Record<string, unknown> = definition()) {
  const name = `work-${++serial}`;
  const response = await send("POST", `/v1/namespaces/${who.slug}/creations`, who, {
    name,
    type: "character",
    display_name: "Courier",
    working,
  });
  expect(response.status, await response.clone().text()).toBe(201);
  const creation = (await response.json()) as { id: string; ref: string };
  const path = `/v1/creations/${creation.ref}`;
  const draft = DraftSchema.parse(await (await send("GET", `${path}/draft`, who)).json());
  return { ...creation, path, draft };
}
async function build(who: Actor, work: Awaited<ReturnType<typeof newWork>>) {
  const requested = await send(
    "POST",
    `${work.path}/draft-builds`,
    who,
    {},
    { "if-match": String(work.draft.version) },
  );
  expect(requested.status, await requested.clone().text()).toBe(202);
  const receipt = DraftBuildResponseSchema.parse(await requested.json());
  expect(
    await handleDraftBuild(h.services, { build_id: uuid("draft_build", receipt.origin.build_id) }),
  ).toBe("ready");
  return receipt.origin.build_id;
}
beforeAll(async () => {
  t = await createTestDatabase();
  h = await createHarness(t, testCas());
  auth = createAuth({
    db: t.app.db,
    secret: "oauth-business-tests-secret-32-characters",
    baseURL: API,
    trustedOrigins: [ORIGIN],
    providers: {},
    rateLimit: false,
  });
  h.services.oauth = createOAuthService(auth, t.app.db);
  app = createApi({
    services: h.services,
    originSecrets: [],
    allowedOrigins: [ORIGIN],
    sessionPrincipal: sessionPrincipalResolver(auth),
    authHandler: h.services.oauth.handler,
    modules: API_MODULES,
  });
  owner = await actor("oauth-owner");
  other = await actor("oauth-other");
});
afterAll(async () => {
  await h?.close();
  await t?.drop();
});

it("serves honest OAuth metadata and public-only profile, without allowing tokens to manage accounts", async () => {
  const oauth = await grant(owner, "profile");
  for (const path of [
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-authorization-server/v1/auth",
  ]) {
    const response = await send("GET", path, null);
    expect(response.status).toBe(200);
    const metadata = await response.json();
    expect(metadata).toMatchObject({
      issuer: `${API}/v1/auth`,
      code_challenge_methods_supported: ["S256"],
    });
    expect(metadata).not.toHaveProperty("userinfo_endpoint");
  }
  const profile = await send("GET", "/v1/profile", oauth.token);
  expect(profile.status).toBe(200);
  expect(await profile.json()).toEqual({ id: encodeId("user", owner.id), namespace: owner.slug });
  expect((await send("GET", "/v1/me", oauth.token)).status).toBe(403);
  for (const method of ["GET", "POST"]) {
    const response = await send(
      method,
      "/v1/me/oauth/clients",
      oauth.token,
      method === "POST" ? { name: "Cannot register", redirect_uris: [REDIRECT] } : undefined,
      { cookie: owner.cookie },
    );
    expect(response.status).toBe(403);
  }
  expect(
    (await send("GET", "/v1/profile", "unknown-token", undefined, { cookie: owner.cookie })).status,
  ).toBe(401);
  expect(
    (
      await send(
        "POST",
        "/v1/auth/update-user",
        oauth.token,
        { name: "Unauthorized" },
        { cookie: owner.cookie },
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await send(
        "POST",
        "/v1/auth/update-user",
        "unknown",
        { name: "Unauthorized" },
        { cookie: owner.cookie },
      )
    ).status,
  ).toBe(401);
});

it("allows only initial own-namespace drafts and forces immutable identity, author and runtime provenance", async () => {
  const oauth = await grant(owner, "profile drafts:write");
  const name = `runtime-${++serial}`;
  const created = await send("POST", `/v1/namespaces/${owner.slug}/creations`, oauth.token, {
    name,
    type: "character",
    display_name: "Runtime creation",
    working: {
      id: "fake",
      ref: "@attacker/stolen",
      type: "world",
      display_name: "Forged name",
      authors: [{ name: "Forged author" }],
      fragments: [fragment()],
      provenance: { client_id: "forged-runtime" },
    },
  });
  expect(created.status, await created.clone().text()).toBe(201);
  const cr = (await created.json()) as { id: string; ref: string };
  const path = `/v1/creations/${cr.ref}`;
  const draft = DraftSchema.parse(await (await send("GET", `${path}/draft`, owner)).json());
  expect(draft.working).toMatchObject({
    id: cr.id,
    ref: `@${owner.slug}/${name}`,
    type: "character",
    display_name: "Runtime creation",
    authors: [{ name: `@${owner.slug}`, user: encodeId("user", owner.id) }],
    provenance: { client_id: oauth.client_id },
    meta: { license: "LicenseRef-All-Rights-Reserved" },
  });
  const [stored] = await t.app.db
    .select()
    .from(s.creations)
    .where(eq(s.creations.id, uuid("creation", cr.id)));
  expect(stored?.clientId).toBe(oauth.client_id);
  const no = await send("POST", `/v1/namespaces/${other.slug}/creations`, oauth.token, {
    name: "forbidden",
    type: "character",
    display_name: "Forbidden",
    working: definition(),
  });
  expect([403, 404]).toContain(no.status);
  const mutations = [
    send(
      "PUT",
      `${path}/draft`,
      oauth.token,
      { working: draft.working },
      { "if-match": String(draft.version) },
    ),
    send("POST", `${path}/revisions`, oauth.token, {}),
    send("POST", `${path}/draft-builds`, oauth.token, {}, { "if-match": String(draft.version) }),
  ];
  for (const result of await Promise.all(mutations)) expect(result.status).toBe(403);
  expect((await send("GET", `${path}/draft`, oauth.token)).status).toBe(403);
  expect((await send("GET", `${path}/draft/avatar`, oauth.token)).status).toBe(403);
  const revision = await send("POST", `${path}/revisions`, owner, {});
  expect(revision.status).toBe(201);
  const rev = (await revision.json()) as { id: string };
  expect(
    (
      await send(
        "POST",
        `${path}/releases`,
        oauth.token,
        { revision: rev.id, label: "1.0.0", visibility: "public" },
        { "idempotency-key": randomUUID() },
      )
    ).status,
  ).toBe(403);
  const after = DraftSchema.parse(await (await send("GET", `${path}/draft`, owner)).json());
  expect(after.working).toEqual(draft.working);
  expect((await send("DELETE", `/v1/me/oauth/grants/${oauth.client_id}`, owner)).status).toBe(204);
  expect((await send("GET", "/v1/profile", oauth.token)).status).toBe(401);
  expect(
    (
      await send("POST", `/v1/namespaces/${owner.slug}/creations`, oauth.token, {
        name: "after-revoke",
        type: "character",
        display_name: "No",
      })
    ).status,
  ).toBe(401);
});

it("intersects creations:read with real work ownership for existing build receipts, artifacts and Source bytes", async () => {
  const bytes = new TextEncoder().encode(
    "# Private manual\r\nOnly this work may read this Source.\r\n",
  );
  const uploadResponse = await send("POST", "/v1/uploads", owner, {
    purpose: "asset",
    content_type: "text/markdown",
    size: bytes.length,
    sha256: sha256Bytes(bytes),
  });
  expect(uploadResponse.status, await uploadResponse.clone().text()).toBe(201);
  const target = (await uploadResponse.json()) as {
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
  expect((await send("POST", `/v1/uploads/${target.upload}/complete`, owner, {})).status).toBe(202);
  expect(
    (
      await processUpload(
        {
          db: t.app.db,
          cas: h.services.cas,
          now: h.clock.now,
          newId: h.services.ids.uuid,
          systemActorId: owner.id,
        },
        target.upload,
      )
    ).state,
  ).toBe("ready");
  const upload = UploadStatusSchema.parse(
    await (await send("GET", `/v1/uploads/${target.upload}`, owner)).json(),
  );
  const blob = required(upload.blob);
  const work = await newWork(owner, {
    ...definition(),
    assets: [
      {
        slot: "manual",
        role: "context",
        variants: [
          {
            id: "default",
            media_type: blob.media_type,
            blob: { digest: blob.digest, size: blob.size, availability: "mirrored" },
          },
        ],
      },
    ],
    sources: [
      {
        id: "manual",
        title: "Manual",
        description: "Private working manual",
        format: "markdown",
        asset: "manual",
        visibility: { scope: "shared" },
      },
    ],
  });
  const id = await build(owner, work);
  const sibling = await newWork(other);
  const siblingBuild = await build(other, sibling);
  const oauth = await grant(owner, "creations:read");
  const receipt = await send("GET", `/v1/draft-builds/${id}`, oauth.token);
  expect(receipt.status, await receipt.clone().text()).toBe(200);
  expect(DraftBuildResponseSchema.parse(await receipt.json()).state).toBe("ready");
  const artifactResponse = await send("GET", `/v1/draft-builds/${id}/artifact`, oauth.token);
  expect(artifactResponse.status, await artifactResponse.clone().text()).toBe(302);
  expect(artifactResponse.headers.get("cache-control")).toBe("private, no-store");
  const downloaded = await fetch(required(artifactResponse.headers.get("location")));
  const artifact = CreationArtifactSchema.parse(await downloaded.json());
  if (artifact.kind !== "content") throw new Error("Expected content artifact");
  const source = required(artifact.catalog_index.sources[0]);
  const sourceResponse = await send(
    "GET",
    `/v1/draft-builds/${id}/source-text?source=${encodeURIComponent(source.id)}`,
    oauth.token,
  );
  expect(sourceResponse.status).toBe(200);
  expect(await sourceResponse.json()).toMatchObject({
    source: source.id,
    digest: blob.digest,
    text: new TextDecoder().decode(bytes),
  });
  for (const suffix of ["", "/artifact", `/source-text?source=${encodeURIComponent(source.id)}`])
    expect(
      (await send("GET", `/v1/draft-builds/${siblingBuild}${suffix}`, oauth.token)).status,
    ).toBe(404);
  expect((await send("GET", `${work.path}/draft`, oauth.token)).status).toBe(403);
  expect(
    (
      await send(
        "POST",
        `${work.path}/draft-builds`,
        oauth.token,
        {},
        { "if-match": String(work.draft.version) },
      )
    ).status,
  ).toBe(403);
  expect((await send("DELETE", `/v1/draft-builds/${id}`, oauth.token)).status).toBe(403);
  const profileOnly = await grant(owner, "profile");
  expect((await send("GET", `/v1/draft-builds/${id}`, profileOnly.token)).status).toBe(403);
});

it("attributes OAuth contributions to the actual client through owner acceptance", async () => {
  const work = await newWork(other);
  const revisionResponse = await send("POST", `${work.path}/revisions`, other, {});
  expect(revisionResponse.status).toBe(201);
  const revision = (await revisionResponse.json()) as { id: string };
  const published = await send(
    "POST",
    `${work.path}/releases`,
    other,
    { revision: revision.id, label: "1.0.0", visibility: "public" },
    { "idempotency-key": randomUUID() },
  );
  expect(published.status, await published.clone().text()).toBe(202);
  expect(await h.runPublishJobs()).toEqual(["published"]);
  const oauth = await grant(owner, "contributions:write");
  const proposed = await send("POST", `${work.path}/contributions`, oauth.token, {
    title: "Runtime suggestion",
    base_revision: revision.id,
    changes: [
      {
        on: "fragment",
        op: "modify",
        id: "description",
        base_digest: canonicalFragment(fragment()).digest,
        after: fragment("A courier who helps strangers."),
      },
    ],
    rights_ack: { inbound_equals_outbound: true },
  });
  expect(proposed.status, await proposed.clone().text()).toBe(201);
  const proposal = (await proposed.json()) as { id: string; number: number };
  const [row] = await t.app.db
    .select()
    .from(s.contributions)
    .where(eq(s.contributions.id, uuid("contribution", proposal.id)));
  expect(row).toMatchObject({ authorUserId: owner.id, clientId: oauth.client_id });
  const accepted = await send(
    "POST",
    `${work.path}/contributions/${proposal.number}/accept`,
    other,
    {},
  );
  expect(accepted.status, await accepted.clone().text()).toBe(200);
  const draft = DraftSchema.parse(await (await send("GET", `${work.path}/draft`, other)).json());
  expect(draft.working).toMatchObject({
    provenance: {
      contributors: [
        expect.objectContaining({ author: encodeId("user", owner.id), client_id: oauth.client_id }),
      ],
    },
  });
  const buildId = await build(other, { ...work, draft });
  const artifactResponse = await send("GET", `/v1/draft-builds/${buildId}/artifact`, other);
  expect(artifactResponse.status).toBe(302);
  const artifact = CreationArtifactSchema.parse(
    await (await fetch(required(artifactResponse.headers.get("location")))).json(),
  );
  expect(artifact.meta.contributors).toContainEqual(
    expect.objectContaining({ author: encodeId("user", owner.id), client_id: oauth.client_id }),
  );
  if (artifact.kind !== "content") throw new Error("Expected content artifact");
  expect(artifact.ir.meta.contributors).toEqual(artifact.meta.contributors);
  expect(
    (await send("POST", `${work.path}/contributions/${proposal.number}/accept`, oauth.token, {}))
      .status,
  ).toBe(403);
});

it("creates derivatives with drafts:write and requires creations:read for a private source", async () => {
  const work = await newWork(owner);
  const revisionResponse = await send("POST", `${work.path}/revisions`, owner, {});
  expect(revisionResponse.status).toBe(201);
  const revision = (await revisionResponse.json()) as { id: string; semantic_digest: string };
  async function publishSource(label: string, visibility: "public" | "private") {
    const response = await send(
      "POST",
      `${work.path}/releases`,
      owner,
      { revision: revision.id, label, visibility },
      { "idempotency-key": `oauth-derived-${label}` },
    );
    expect(response.status, await response.clone().text()).toBe(202);
    const release = ((await response.json()) as { release: string }).release;
    expect(await h.runPublishJobs()).toEqual(["published"]);
    return { ref: work.ref, release, semantic_digest: revision.semantic_digest };
  }
  const publicSource = await publishSource("1.0.0", "public");
  const privateSource = await publishSource("2.0.0", "private");
  const draftsOnly = await grant(owner, "drafts:write");
  const readOnly = await grant(owner, "creations:read");
  const both = await grant(owner, "drafts:write creations:read");
  const publicMetadata = await send("GET", `/v1/releases/${publicSource.release}`, null);
  expect(publicMetadata.status).toBe(200);
  expect(await publicMetadata.json()).toMatchObject({
    id: publicSource.release,
    semantic_digest: publicSource.semantic_digest,
  });
  for (const suffix of ["", "/artifact"]) {
    expect((await send("GET", `/v1/releases/${privateSource.release}${suffix}`, null)).status).toBe(
      404,
    );
    expect(
      (await send("GET", `/v1/releases/${privateSource.release}${suffix}`, draftsOnly.token))
        .status,
    ).toBe(404);
  }
  const exact = await send("GET", `/v1/releases/${privateSource.release}`, readOnly.token);
  expect(exact.status).toBe(200);
  expect(exact.headers.get("cache-control")).toBe("private, no-store");
  const receipt = (await exact.json()) as { artifact_digest: string; semantic_digest: string };
  expect(receipt.semantic_digest).toBe(privateSource.semantic_digest);
  const redirect = await send(
    "GET",
    `/v1/releases/${privateSource.release}/artifact`,
    readOnly.token,
  );
  expect(redirect.status).toBe(302);
  const downloaded = new Uint8Array(
    await (await fetch(required(redirect.headers.get("location")))).arrayBuffer(),
  );
  expect(sha256Bytes(downloaded)).toBe(receipt.artifact_digest);
  expect(
    CreationArtifactSchema.parse(JSON.parse(new TextDecoder().decode(downloaded))).root,
  ).toMatchObject({
    ref: privateSource.ref,
    release: privateSource.release,
    semantic_digest: privateSource.semantic_digest,
  });
  const post = (token: string, source: typeof publicSource) =>
    send("POST", `/v1/namespaces/${owner.slug}/derivations`, token, {
      source,
      kind: "remix",
      name: `runtime-remix-${++serial}`,
      display_name: "Runtime remix",
      rights_ack: { inbound_equals_outbound: true },
    });
  const response = await post(draftsOnly.token, publicSource);
  expect(response.status, await response.clone().text()).toBe(201);
  const created = (await response.json()) as { ref: string };
  const draft = DraftSchema.parse(
    await (await send("GET", `/v1/creations/${created.ref}/draft`, owner)).json(),
  );
  expect(draft.working).toMatchObject({
    provenance: {
      client_id: draftsOnly.client_id,
      derived_from: [expect.objectContaining(publicSource)],
    },
  });
  expect((await post(readOnly.token, publicSource)).status).toBe(403);
  expect((await post(draftsOnly.token, privateSource)).status).toBe(404);
  expect((await post(both.token, privateSource)).status).toBe(201);
});

it("creates a reviewed sequel with OAuth provenance without granting later draft edits or implying agent authorship", async () => {
  const made = await send("POST", `/v1/namespaces/${owner.slug}/creations`, owner, {
    name: `played-source-${++serial}`,
    type: "scenario",
    display_name: "Source story",
    working: {
      meta: definition().meta,
      cast: [{ key: "traveler", who: { late: "character" } }],
      story: {
        version: 1,
        vars: { trust: { type: "int", min: 0, max: 10, init: 0, description: "Trust" } },
        scenes: [{ id: "gate", title: "Gate" }],
      },
    },
  });
  expect(made.status, await made.clone().text()).toBe(201);
  const original = await made.json();
  const originalPath = `/v1/creations/${original.ref}`;
  const revisionResponse = await send("POST", `${originalPath}/revisions`, owner, {});
  expect(revisionResponse.status).toBe(201);
  const revision = await revisionResponse.json();
  const publicationResponse = await send(
    "POST",
    `${originalPath}/releases`,
    owner,
    { revision: revision.id, label: "1.0.0", visibility: "private" },
    { "idempotency-key": `played-oauth-${++serial}` },
  );
  expect(publicationResponse.status).toBe(202);
  const publication = await publicationResponse.json();
  expect(await h.runPublishJobs()).toEqual(["published"]);
  const restricted = await grant(owner, "drafts:write");
  const allowed = await grant(owner, "drafts:write creations:read");
  const body = {
    source: {
      ref: original.ref,
      release: publication.release,
      semantic_digest: revision.semantic_digest,
    },
    kind: "sequel",
    name: `oauth-played-${++serial}`,
    display_name: "Played continuation",
    from_play: {
      scene: "gate",
      present: ["traveler"],
      vars: { trust: 4 },
      knowing: {},
      opening: "The journey continues.",
    },
    rights_ack: { inbound_equals_outbound: true },
  };
  expect(
    (await send("POST", `/v1/namespaces/${owner.slug}/derivations`, restricted.token, body)).status,
  ).toBe(404);
  const response = await send(
    "POST",
    `/v1/namespaces/${owner.slug}/derivations`,
    allowed.token,
    body,
  );
  expect(response.status, await response.clone().text()).toBe(201);
  const created = await response.json();
  const path = `/v1/creations/${created.ref}`;
  const draft = DraftSchema.parse(await (await send("GET", `${path}/draft`, owner)).json());
  expect(draft.working).toMatchObject({
    provenance: {
      client_id: allowed.client_id,
      derived_from: [expect.objectContaining(body.source)],
    },
    story: { vars: { trust: { init: 4 } } },
  });
  expect(draft.working).not.toHaveProperty("provenance.authored_by_agent", true);
  expect(
    (
      await send(
        "PUT",
        `${path}/draft`,
        allowed.token,
        { working: draft.working },
        { "if-match": String(draft.version) },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await send(
        "POST",
        `${path}/releases`,
        allowed.token,
        { revision: revision.id, label: "1.0.0", visibility: "public" },
        { "idempotency-key": `played-denied-${++serial}` },
      )
    ).status,
  ).toBe(403);
  const after = DraftSchema.parse(await (await send("GET", `${path}/draft`, owner)).json());
  expect(after).toEqual(draft);
});
