/** Real public-client consent and bearer API: credentials stay only in memory, never trace/log artifacts. */
import { createHash, randomBytes } from "node:crypto";
import { DraftSchema } from "@char-pub/contracts";
import { expect, type Page, test } from "@playwright/test";
import { signInAs } from "./fullstack/session";
import { API_PORT } from "./fullstack/stack";

test.skip(!process.env.E2E_FULLSTACK, "needs the isolated full stack");
test.use({ actionTimeout: 15_000, trace: "off", video: "off" });

async function sessionCall(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(
    async ({ method, path, body }) => {
      const response = await fetch(path, {
        method,
        credentials: "include",
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
    },
    { method, path, body },
  );
}

test("registers a public client, authorizes PKCE access, enforces scopes and revokes the grant", async ({
  page,
  context,
}, info) => {
  const suffix = Date.now().toString(36);
  const namespace = `oauth-${suffix}`;
  const appName = `Lantern Runtime ${suffix}`;
  const callback = "http://127.0.0.1:65432/charpub-callback";
  const errors: string[] = [];
  page.on("pageerror", () => errors.push("Browser page error"));
  await signInAs(context, "OAuth Author");
  await page.goto("/");
  expect((await sessionCall(page, "POST", "/v1/namespaces", { slug: namespace })).status).toBe(201);
  await page.goto("/settings#developer-clients");
  const developer = page.getByRole("region", { name: "Developer clients", exact: true });
  await developer.getByLabel("Client name").fill(appName);
  await developer.getByLabel("Redirect URIs — one per line").fill(callback);
  await developer.getByRole("button", { name: "Register public client", exact: true }).click();
  await expect(
    developer.getByText(`Registered ${appName}. Use its public client ID below.`),
  ).toBeVisible();
  const listed = await sessionCall(page, "GET", "/v1/me/oauth/clients");
  expect(listed.status).toBe(200);
  const clients = listed.body as {
    items: { client_id: string; name: string; redirect_uris: string[] }[];
  };
  const client = clients.items.find((entry) => entry.name === appName);
  if (!client) throw new Error("Registered client missing");
  expect(client.redirect_uris).toEqual([callback]);
  await page.screenshot({ path: info.outputPath("oauth-registered-client.png"), fullPage: true });

  // Metadata and protocol calls go to real handlers. The callback alone is a local Runtime stand-in.
  const metadataResponse = await fetch(
    `http://127.0.0.1:${API_PORT}/.well-known/oauth-authorization-server`,
  );
  expect(metadataResponse.status).toBe(200);
  const metadata = (await metadataResponse.json()) as {
    authorization_endpoint: string;
    token_endpoint: string;
    code_challenge_methods_supported: string[];
  };
  expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(24).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = new URL(metadata.authorization_endpoint);
  authorize.search = new URLSearchParams({
    client_id: client.client_id,
    response_type: "code",
    redirect_uri: callback,
    scope: "profile creations:read drafts:write contributions:write offline_access",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  }).toString();
  let code: string | null = null;
  let returnedState: string | null = null;
  await page.route(`${callback}?**`, async (route) => {
    const location = new URL(route.request().url());
    code = location.searchParams.get("code");
    returnedState = location.searchParams.get("state");
    await route.fulfill({
      contentType: "text/html",
      body: '<script>history.replaceState(null,"","/charpub-callback")</script><p>Authorization callback received.</p>',
    });
  });
  const consentDetails = page.waitForResponse((response) =>
    response.url().endsWith("/v1/oauth/consent/details"),
  );
  await page.goto(authorize.toString());
  const detailsResponse = await consentDetails;
  const supplied = detailsResponse.request().postDataJSON() as { oauth_query: string };
  const browserQuery = await page.evaluate(() => window.location.search.slice(1));
  if (supplied.oauth_query !== browserQuery)
    throw new Error("The router changed the signed authorization query");
  if (detailsResponse.status() !== 200) {
    const problem = (await detailsResponse.json()) as { code?: string };
    throw new Error(
      `Consent details rejected: status=${detailsResponse.status()}, code=${problem.code ?? "unknown"}, raw_query_preserved=${supplied.oauth_query === browserQuery}`,
    );
  }
  const consent = page.getByRole("region", { name: "App authorization", exact: true });
  await expect(consent.getByRole("heading", { name: appName, exact: true })).toBeVisible();
  await expect(consent.getByText(callback, { exact: true })).toBeVisible();
  await expect(consent.getByText("offline_access", { exact: true })).toBeVisible();
  await expect(consent.getByText("drafts:write", { exact: true })).toBeVisible();
  await expect(consent.getByText(/This does not allow publishing/)).toBeVisible();
  await page.screenshot({ path: info.outputPath("oauth-consent.png"), fullPage: true });
  await consent.getByRole("button", { name: `Authorize ${appName}`, exact: true }).click();
  await expect(page.getByText("Authorization callback received.", { exact: true })).toBeVisible();
  if (!code || returnedState !== state)
    throw new Error("OAuth callback did not bind the expected state and code");

  // Native fetch is deliberately cookie-free and outside Playwright tracing; never print token responses.
  const tokenResponse = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      Origin: "http://127.0.0.1:65432",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.client_id,
      redirect_uri: callback,
      code,
      code_verifier: verifier,
    }),
  });
  expect(tokenResponse.status).toBe(200);
  const token = (await tokenResponse.json()) as Record<string, unknown>;
  if (typeof token.access_token !== "string" || typeof token.refresh_token !== "string")
    throw new Error("OAuth exchange did not issue the requested tokens");
  const access = token.access_token;
  const refresh = token.refresh_token;
  const apiOrigin = `http://127.0.0.1:${API_PORT}`;
  const bearer = (
    path: string,
    method = "GET",
    body?: unknown,
    extra: Record<string, string> = {},
  ) =>
    fetch(`${apiOrigin}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${access}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const profileResponse = await bearer("/v1/profile");
  expect(profileResponse.status).toBe(200);
  const profile = (await profileResponse.json()) as Record<string, unknown>;
  expect(Object.keys(profile).sort()).toEqual(["id", "namespace"]);
  expect(profile.namespace).toBe(namespace);
  const name = "runtime-note";
  const base = `/v1/creations/@${namespace}/${name}`;
  const authoredText = "The lantern keeper remembers the player arriving before dawn.";
  const created = await bearer(`/v1/namespaces/${namespace}/creations`, "POST", {
    name,
    type: "character",
    display_name: "Runtime Note",
    working: {
      fragments: [
        {
          id: "memory",
          kind: "character",
          stable: true,
          content: { type: "text", text: authoredText },
        },
      ],
      meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
    },
  });
  expect(created.status).toBe(201);
  await page.goto("/settings#connected-apps");
  const draft = DraftSchema.parse((await sessionCall(page, "GET", `${base}/draft`)).body);
  const working = draft.working as {
    provenance?: { client_id?: string };
    fragments: { content: { text: string } }[];
  };
  expect(working.provenance?.client_id).toBe(client.client_id);
  expect(working.fragments[0]?.content.text).toBe(authoredText);
  expect((await bearer(`${base}/draft`)).status).toBe(403);
  expect(
    (
      await bearer(
        `${base}/draft`,
        "PUT",
        { working: draft.working },
        { "if-match": String(draft.version) },
      )
    ).status,
  ).toBe(403);
  expect(
    (await bearer(`${base}/draft-builds`, "POST", {}, { "if-match": String(draft.version) }))
      .status,
  ).toBe(403);
  const revision = await sessionCall(page, "POST", `${base}/revisions`, {});
  expect(revision.status).toBeLessThan(300);
  const revisionId = (revision.body as { id: string }).id;
  expect(
    (
      await bearer(
        `${base}/releases`,
        "POST",
        { revision: revisionId, label: "1.0.0", visibility: "public" },
        { "idempotency-key": `oauth-denied-${suffix}` },
      )
    ).status,
  ).toBe(403);
  expect((await bearer("/v1/me/oauth/clients")).status).toBe(403);
  expect((await bearer("/v1/me/oauth/grants")).status).toBe(403);

  const connected = page.getByRole("region", { name: "Connected apps", exact: true });
  await expect(connected.getByRole("heading", { name: appName, exact: true })).toBeVisible();
  await connected.getByRole("button", { name: `Revoke ${appName}`, exact: true }).click();
  await expect(connected.getByText("You have no connected apps.", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("oauth-revoked.png"), fullPage: true });
  expect((await bearer("/v1/profile")).status).toBe(401);
  const refreshed = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: client.client_id,
      refresh_token: refresh,
    }),
  });
  expect(refreshed.status).toBe(400);
  const detail = (await sessionCall(page, "GET", base)).body as { releases: unknown[] };
  expect(detail.releases).toEqual([]);
  expect(errors).toEqual([]);
});
