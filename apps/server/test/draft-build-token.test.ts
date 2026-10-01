/** Queued draft builds retain the PAT's identity and original authority, not just its user. */
import { DraftBuildResponseSchema, DraftSchema } from "@char-pub/contracts";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { createApi } from "../src/api/server.js";
import { createAuth, SESSION_COOKIE, sessionPrincipalResolver } from "../src/auth/better-auth.js";
import type { Scope } from "../src/authz/authorize.js";
import * as authorization from "../src/authz/authorize.js";
import { apiTokens, draftBuilds, releases } from "../src/db/schema/index.js";
import { API_MODULES } from "../src/processes/modules.js";
import { decodeId } from "../src/registry/ids.js";
import { handleDraftBuild } from "../src/worker/draft-build.js";
import { type ApiHarness, createHarness, ORIGIN } from "./api-harness.js";
import { createTestDatabase, type TestDatabase, testCas } from "./helpers.js";

let t: TestDatabase;
let h: ApiHarness;
let app: ReturnType<typeof createApi>;
let owner: string;
let cookie: string;
let serial = 0;
const BOTH: Scope[] = ["creations:read", "creations:write"];

function send(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
  extra: Record<string, string> = {},
) {
  return app.request(`https://api.char.pub${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : { cookie }),
      origin: ORIGIN,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function buildId(id: string) {
  const value = decodeId("draft_build", id);
  if (!value) throw new Error("Missing build identity");
  return value;
}
async function pat(scopes: Scope[] = BOTH) {
  const response = await send("POST", "/v1/me/tokens", undefined, {
    name: `CLI ${++serial}`,
    scopes,
    expires_in_days: 30,
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as { id: string; token: string };
}
async function work() {
  const name = `character-${++serial}`;
  const response = await send("POST", "/v1/namespaces/pat-builder/creations", undefined, {
    name,
    type: "character",
    display_name: "Test character",
    working: {
      fragments: [
        {
          id: "description",
          kind: "character",
          stable: true,
          content: { type: "text", text: "A test courier." },
        },
      ],
    },
  });
  expect(response.status, await response.clone().text()).toBe(201);
  const path = `/v1/creations/@pat-builder/${name}`;
  const draft = DraftSchema.parse(await (await send("GET", `${path}/draft`)).json());
  return { path, version: draft.version };
}
async function request(draft: Awaited<ReturnType<typeof work>>, token?: string) {
  return send(
    "POST",
    `${draft.path}/draft-builds`,
    token,
    {},
    { "if-match": String(draft.version) },
  );
}
async function queue(draft: Awaited<ReturnType<typeof work>>, token?: string) {
  const response = await request(draft, token);
  expect([200, 202], await response.clone().text()).toContain(response.status);
  return DraftBuildResponseSchema.parse(await response.json()).origin.build_id;
}
async function row(id: string) {
  const [value] = await t.app.db
    .select()
    .from(draftBuilds)
    .where(eq(draftBuilds.id, buildId(id)));
  if (!value) throw new Error("Missing build row");
  return value;
}
async function noArtifact(id: string) {
  expect(await row(id)).toMatchObject({ state: "failed", artifactDigest: null });
  if (!h.services.draftPayloads) throw new Error("Missing payload store");
  await expect(
    h.services.draftPayloads.readPayload(id, "artifact", `sha256:${"0".repeat(64)}`),
  ).rejects.toMatchObject({ code: "draft_payload.not_found" });
  const response = await send("GET", `/v1/draft-builds/${id}/artifact`);
  expect(response.status).toBe(409);
}
beforeAll(async () => {
  t = await createTestDatabase();
  h = await createHarness(t, testCas());
  const auth = createAuth({
    db: t.app.db,
    secret: "draft-pat-real-cookie-secret-32-characters",
    baseURL: "https://api.char.pub",
    trustedOrigins: [ORIGIN],
    providers: {},
    rateLimit: false,
  });
  owner = await h.createUser("Pat Builder");
  const context = await auth.$context;
  const session = await context.internalAdapter.createSession(owner);
  cookie = `${SESSION_COOKIE}=${encodeURIComponent(`${session.token}.${await makeSignature(session.token, context.secret)}`)}`;
  app = createApi({
    services: h.services,
    originSecrets: [],
    allowedOrigins: [ORIGIN],
    sessionPrincipal: sessionPrincipalResolver(auth),
    modules: API_MODULES,
  });
  const namespace = await send("POST", "/v1/namespaces", undefined, { slug: "pat-builder" });
  expect(namespace.status, await namespace.clone().text()).toBe(201);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await h?.close();
  await t?.drop();
});

it("persists the actual HTTP credential ID and scope snapshot and completes a valid build", async () => {
  const token = await pat();
  const draft = await work();
  const id = await queue(draft, token.token);
  const initial = await row(id);
  expect(initial).toMatchObject({
    requesterId: owner,
    requesterTokenId: token.id,
    requesterScopes: BOTH,
    state: "pending",
  });
  expect(JSON.stringify(initial)).not.toContain(token.token);
  expect(await handleDraftBuild(h.services, { build_id: buildId(id) })).toBe("ready");
  expect((await send("GET", `/v1/draft-builds/${id}/artifact`, token.token)).status).toBe(302);
});

it.each(["revoked", "expired", "lost-read", "lost-write"] as const)(
  "fails without publishing an artifact when the queued credential is %s",
  async (change) => {
    const token = await pat();
    const draft = await work();
    const id = await queue(draft, token.token);
    if (change === "revoked") {
      expect((await send("DELETE", `/v1/me/tokens/${token.id}`)).status).toBe(204);
    } else {
      await t.app.db
        .update(apiTokens)
        .set(
          change === "expired"
            ? { expiresAt: new Date(h.clock.now().getTime() - 1) }
            : { scopes: change === "lost-read" ? ["creations:write"] : ["creations:read"] },
        )
        .where(eq(apiTokens.id, token.id));
    }
    expect(await handleDraftBuild(h.services, { build_id: buildId(id) })).toBe("failed");
    await noArtifact(id);
    const report = (await row(id)).report;
    expect(JSON.stringify(report)).toContain(
      change === "revoked" || change === "expired"
        ? "auth.invalid_token"
        : "token.insufficient_scope",
    );
  },
);

it("does not add later scopes to the authority delegated to an already queued build", async () => {
  const token = await pat();
  const draft = await work();
  const id = await queue(draft, token.token);
  await t.app.db
    .update(apiTokens)
    .set({ scopes: [...BOTH, "creations:publish", "contributions:write"] })
    .where(eq(apiTokens.id, token.id));
  // Observe, without replacing, the real central authorization calls during execution.
  const gate = vi.spyOn(authorization, "authorize");
  expect(await handleDraftBuild(h.services, { build_id: buildId(id) })).toBe("ready");
  const delegated = gate.mock.calls.filter(
    ([principal]) => principal.kind === "user" && principal.token_id === token.id,
  );
  expect(delegated.length).toBeGreaterThan(0);
  for (const [principal] of delegated) {
    if (principal.kind !== "user") throw new Error("Expected user principal");
    expect(principal.scopes).toEqual(BOTH);
  }
  expect((await row(id)).requesterScopes).toEqual(BOTH);
  expect(
    await t.app.db
      .select()
      .from(releases)
      .where(eq(releases.creationId, (await row(id)).creationId)),
  ).toEqual([]);
});

it("reuses only the same credential's pending or ready build, never another token or the browser session", async () => {
  const first = await pat();
  const second = await pat();
  const draft = await work();
  const a = await queue(draft, first.token);
  expect(await queue(draft, first.token)).toBe(a);
  const b = await queue(draft, second.token);
  const browser = await queue(draft);
  expect(new Set([a, b, browser]).size).toBe(3);
  expect(await row(a)).toMatchObject({ requesterTokenId: first.id, requesterScopes: BOTH });
  expect(await row(b)).toMatchObject({ requesterTokenId: second.id, requesterScopes: BOTH });
  expect(await row(browser)).toMatchObject({ requesterTokenId: null, requesterScopes: null });
  expect(await handleDraftBuild(h.services, { build_id: buildId(a) })).toBe("ready");
  const reused = await request(draft, first.token);
  expect([200, 202]).toContain(reused.status);
  expect(DraftBuildResponseSchema.parse(await reused.json()).origin.build_id).toBe(a);
  expect((await row(b)).state).toBe("pending");
  expect((await row(browser)).state).toBe("pending");
});

it.each(([["creations:read"], ["creations:write"]] as Scope[][]).map((scopes) => ({ scopes })))(
  "requires both read and write at HTTP enqueue with scopes %j",
  async ({ scopes }) => {
    const token = await pat(scopes);
    const draft = await work();
    const response = await request(draft, token.token);
    expect(response.status, await response.clone().text()).toBe(403);
    expect(await response.json()).toMatchObject({ code: "token.insufficient_scope" });
    expect(
      await t.app.db.select().from(draftBuilds).where(eq(draftBuilds.requesterTokenId, token.id)),
    ).toEqual([]);
  },
);
