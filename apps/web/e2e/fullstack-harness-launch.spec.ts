/** Real dsh application acceptance; only its model adapter is an offline test fixture. */
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DraftSchema } from "@char-pub/contracts";
import { canonicalizeCreation, checkCreation } from "@char-pub/core";
import { expect, type Page, test } from "@playwright/test";
import { signInAs } from "./fullstack/session";

test.skip(!process.env.E2E_FULLSTACK, "needs the isolated full stack");
test.use({ trace: "off", video: "off", actionTimeout: 15_000 });

async function call(page: Page, method: string, path: string, body?: unknown, version?: number) {
  return page.evaluate(
    async ({ method, path, body, version }) => {
      const response = await fetch(path, {
        method,
        credentials: "include",
        headers: {
          "content-type": "application/json",
          ...(method === "POST" ? { "idempotency-key": crypto.randomUUID() } : {}),
          ...(version === undefined ? {} : { "if-match": String(version) }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: (await response.json()) as unknown };
    },
    { method, path, body, version },
  );
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port allocated");
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
  return address.port;
}

async function logs(directory: string) {
  const paths = await readdir(directory, { recursive: true }).catch(() => [] as string[]);
  const entries = await Promise.all(
    paths
      .filter((path) => path.endsWith(".jsonl"))
      .map(async (path) => [path, await readFile(join(directory, path))] as const),
  );
  return new Map(entries);
}

test("platform launch enters the real dsh app, authorizes, plays, and starts a new draft without replacing its old session", async ({
  page,
  context,
}, info) => {
  test.setTimeout(180_000);
  if (!process.env.E2E_HARNESS_ROOT)
    throw new Error("E2E_HARNESS_ROOT must identify the separately built Harness checkout");
  const harness = resolve(process.env.E2E_HARNESS_ROOT);
  const runtime = join(harness, "packages/experimental/charpub-roleplay-runtime");
  await access(join(runtime, "lib/app.js"));
  const home = await mkdtemp(join(tmpdir(), "charpub-app-acceptance-"));
  const sessionRoot = join(home, "sessions");
  const port = await freePort();
  const appOrigin = `http://127.0.0.1:${port}`;
  const suffix = Date.now().toString(36);
  const namespace = `launch-${suffix}`;
  const base = `/v1/creations/@${namespace}/gate`;
  const appName = `Local roleplay ${suffix}`;
  let child: ChildProcess | undefined;
  const browserErrors: string[] = [];
  context.on("page", (opened) => opened.on("pageerror", (error) => browserErrors.push(error.name)));
  try {
    await signInAs(context, "Runtime launch author");
    await page.goto("/");
    expect((await call(page, "POST", "/v1/namespaces", { slug: namespace })).status).toBe(201);
    expect(
      (
        await call(page, "POST", `/v1/namespaces/${namespace}/creations`, {
          name: "gate",
          type: "scenario",
          display_name: "Lantern openings",
        })
      ).status,
    ).toBe(201);
    const initial = DraftSchema.parse((await call(page, "GET", `${base}/draft`)).body);
    const working = {
      ...(initial.working as object),
      meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
      fragments: [
        {
          id: "premise",
          kind: "scenario",
          stable: true,
          content: { type: "text", text: "A lantern marks the safe passage." },
        },
      ],
      cast: [{ key: "traveler", who: { late: "persona" }, part: "A visitor" }],
      story: {
        version: 1,
        scenes: [{ id: "gate", title: "Lantern gate" }],
        starts: [
          {
            id: "dawn",
            title: "At dawn",
            description: "Meet the traveler as the sun rises.",
            scene: "gate",
            greeting: "The dawn lantern welcomes you.",
          },
          {
            id: "night",
            title: "At night",
            description: "Meet the traveler beneath the lantern after dark.",
            scene: "gate",
            greeting: "The night lantern welcomes you.",
          },
        ],
      },
    };
    expect(checkCreation(canonicalizeCreation(working).creation).ok).toBe(true);
    expect((await call(page, "PUT", `${base}/draft`, { working }, initial.version)).status).toBe(
      200,
    );
    const revision = (await call(page, "POST", `${base}/revisions`, {})).body as { id: string };
    expect(
      (
        await call(page, "POST", `${base}/releases`, {
          revision: revision.id,
          label: "1.0.0",
          visibility: "public",
        })
      ).status,
    ).toBeLessThan(300);
    await expect
      .poll(
        async () =>
          ((await call(page, "GET", `${base}/releases/1.0.0/report`)).body as { state: string })
            .state,
        { timeout: 60_000 },
      )
      .toBe("active");

    await page.goto("/settings#developer-clients");
    const developer = page.getByRole("region", { name: "Developer clients", exact: true });
    await developer.getByLabel("Client name").fill(appName);
    await developer.getByLabel("Redirect URIs — one per line").fill(`${appOrigin}/oauth/callback`);
    await developer.getByRole("button", { name: "Register public client", exact: true }).click();
    await expect(
      developer.getByText(`Registered ${appName}. Use its public client ID below.`),
    ).toBeVisible();
    const clients = (await call(page, "GET", "/v1/me/oauth/clients")).body as {
      items: { name: string; client_id: string }[];
    };
    const client = clients.items.find((item) => item.name === appName);
    if (!client) throw new Error("Registered client missing");

    // The supported launcher loads a real named profile. No inline Loader or private app bootstrap.
    const profile = join(home, "profiles/roleplay");
    await mkdir(join(profile, "node_modules/@deepseek-ai"), { recursive: true });
    await symlink(
      runtime,
      join(profile, "node_modules/@deepseek-ai/dsh-experimental-charpub-roleplay-runtime"),
      "dir",
    );
    await writeFile(
      join(profile, "package.json"),
      JSON.stringify({
        name: "dsh-profile-roleplay",
        private: true,
        dependencies: {},
        dsh: { profile: { bundles: ["@deepseek-ai/dsh-experimental-charpub-roleplay-runtime"] } },
      }),
    );
    await writeFile(
      join(profile, "cordis.patch.yml"),
      JSON.stringify([
        {
          insert: [
            {
              id: "fixed-model",
              name: pathToFileURL(join(runtime, "tests/registry/app-fixed-provider.mjs")).href,
            },
            {
              id: "roleplay-app",
              name: "@deepseek-ai/dsh-experimental-charpub-roleplay-runtime/app",
              config: {
                host: "127.0.0.1",
                port,
                registry_origin: "http://localhost:4174",
                issuer: "http://localhost:4174/v1/auth",
                client_id: client.client_id,
                timeout_ms: 15_000,
                max_request_bytes: 100_000,
                max_response_bytes: 2_000_000,
                max_artifact_bytes: 2_000_000,
                profile: {
                  runtime: { name: "charpub-roleplay-app", version: "1" },
                  tokenizer: "estimate",
                  mode: "narrator",
                  context_window: 8000,
                  reserve_for_output: 256,
                  capabilities: { system_role: true, multiple_system_messages: true },
                },
                model: { provider: "charpub-app-fullstack", model: "fixed", maxTokens: 256 },
              },
            },
          ],
        },
      ]),
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) =>
          value !== undefined &&
          ["PATH", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP", "SystemRoot"].includes(key),
      ),
    );
    child = spawn("pnpm", ["dsh", "--profile", "roleplay"], {
      cwd: harness,
      env: {
        ...env,
        DSH_HOME: home,
        CHARPUB_SESSION_ROOT: sessionRoot,
        CHARPUB_REQUEST_TIMEOUT_MS: "15000",
        CHARPUB_MAX_EVENT_BYTES: "2000000",
        CHARPUB_MAX_STREAM_BYTES: "100000",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    // OAuth URLs and credentials are not copied from process diagnostics into the test report.
    child.stdout?.resume();
    child.stderr?.resume();
    await expect
      .poll(
        async () => {
          if (child?.exitCode !== null)
            throw new Error("The supported dsh launcher exited before the app was ready");
          return fetch(appOrigin)
            .then((response) => response.status)
            .catch(() => 0);
        },
        { timeout: 30_000 },
      )
      .toBe(200);

    await page.goto(`/c/${namespace}/gate`);
    await page.getByRole("button", { name: "Start playing", exact: true }).click();
    const launch = page.getByRole("dialog", { name: "Open in a Runtime", exact: true });
    await launch.getByLabel("Runtime launch URL").fill(`${appOrigin}/`);
    await launch.getByRole("combobox", { name: "Opening", exact: true }).selectOption("night");
    const opened = context.waitForEvent("page");
    await launch.getByRole("button", { name: "Open Runtime", exact: true }).click();
    const app = await opened;
    await expect(app.getByRole("heading", { name: "Local roleplay", exact: true })).toBeVisible();
    expect(browserErrors).toEqual([]);
    await app.getByRole("button", { name: "Authorize Registry access", exact: true }).click();
    const consent = app.getByRole("region", { name: "App authorization", exact: true });
    await expect(consent.getByText(`${appOrigin}/oauth/callback`, { exact: true })).toBeVisible();
    await consent.getByRole("button", { name: `Authorize ${appName}`, exact: true }).click();
    await expect(app.getByRole("heading", { name: "Local roleplay", exact: true })).toBeVisible();
    await app.getByRole("button", { name: "Review version", exact: true }).click();
    await expect(
      app.getByRole("heading", { name: "Review this version", exact: true }),
    ).toBeVisible();
    await expect(app.getByRole("combobox", { name: "Opening", exact: true })).toHaveValue("night");
    for (const field of await app.getByRole("textbox", { name: / display name$/ }).all())
      await field.fill("Mira");
    await app.getByRole("checkbox", { name: /I reviewed the rating/ }).check();
    await app.getByRole("button", { name: "Start new session", exact: true }).click();
    await expect(app.locator("#history")).toContainText("The night lantern welcomes you.");
    await app.getByLabel("Your reply", { exact: true }).fill("Please open the gate.");
    await app.getByRole("button", { name: "Send once", exact: true }).click();
    await expect(app.locator("#history")).toContainText("The guide opens the lantern gate.");
    await app.screenshot({ path: info.outputPath("runtime-app-session.png"), fullPage: true });
    const previous = await logs(sessionRoot);
    expect(previous.size).toBe(1);

    const draft = DraftSchema.parse((await call(page, "GET", `${base}/draft`)).body);
    const next = structuredClone(draft.working) as typeof working;
    const dawn = next.story.starts.find((start) => start.id === "dawn");
    if (!dawn) throw new Error("The authored dawn opening disappeared");
    dawn.greeting = "The revised dawn welcomes you.";
    expect(
      (await call(page, "PUT", `${base}/draft`, { working: next }, draft.version)).status,
    ).toBe(200);
    await page.goto(`/c/${namespace}/gate/edit`);
    await page.getByRole("button", { name: "Try draft in Runtime", exact: true }).click();
    const draftLaunch = page.getByRole("dialog", { name: "Open in a Runtime", exact: true });
    await expect(draftLaunch).toBeVisible({ timeout: 60_000 });
    await draftLaunch.getByRole("combobox", { name: "Opening", exact: true }).selectOption("dawn");
    const nextOpened = context.waitForEvent("page");
    await draftLaunch.getByRole("button", { name: "Open Runtime", exact: true }).click();
    const nextApp = await nextOpened;
    await nextApp.getByRole("button", { name: "Review version", exact: true }).click();
    await expect(
      nextApp.getByText(
        "A session already exists. Starting this version creates a new session; the previous log remains unchanged.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(nextApp.locator("#details")).toContainText("draft-build");
    for (const field of await nextApp.getByRole("textbox", { name: / display name$/ }).all())
      await field.fill("Mira");
    await nextApp.screenshot({
      path: info.outputPath("runtime-app-new-draft-review.png"),
      fullPage: true,
    });
    await nextApp.getByRole("checkbox", { name: /I reviewed the rating/ }).check();
    await nextApp.getByRole("button", { name: "Start new session", exact: true }).click();
    await expect(nextApp.locator("#history")).toContainText("The revised dawn welcomes you.");
    await expect(nextApp.locator("#history")).not.toContainText("Please open the gate.");
    const after = await logs(sessionRoot);
    expect(after.size).toBe(2);
    for (const [path, bytes] of previous) expect(after.get(path)?.equals(bytes)).toBe(true);
    // The old browser tab cannot address the new controller session through an implicit global current.
    await app.getByLabel("Your reply", { exact: true }).fill("OLD_TAB_MUST_NOT_COMMIT");
    await app.getByRole("button", { name: "Send once", exact: true }).click();
    await expect(app.getByRole("status")).toContainText("stale_session");
    const afterRejected = await logs(sessionRoot);
    expect(afterRejected.size).toBe(2);
    for (const [path, bytes] of after) expect(afterRejected.get(path)?.equals(bytes)).toBe(true);
    await expect(nextApp.locator("#history")).not.toContainText("OLD_TAB_MUST_NOT_COMMIT");
    const detail = (await call(page, "GET", base)).body as { releases: unknown[] };
    expect(detail.releases).toHaveLength(1);
    expect(browserErrors).toEqual([]);
  } finally {
    if (child?.pid) {
      const exited = child.exitCode === null ? once(child, "exit") : Promise.resolve();
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        /* The isolated process group already exited. */
      }
      await Promise.race([exited, new Promise<void>((done) => setTimeout(done, 3000))]);
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        /* No child may outlive this test's temporary profile. */
      }
    }
    await rm(home, { recursive: true, force: true });
  }
});
