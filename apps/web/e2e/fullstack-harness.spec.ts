/** A separately compiled Harness process consumes the real Registry through OAuth, not shared source imports. */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CreateContributionRequestSchema,
  CreateCreationResponseSchema,
  CreationDetailSchema,
  DeriveCreationRequestSchema,
  DraftBuildResponseSchema,
  DraftSchema,
  RevisionSchema,
} from "@char-pub/contracts";
import {
  CreationArtifactSchema,
  canonicalizeCreation,
  ExactRefSchema,
  initStoryState,
  RuntimePreviewInputSchema,
} from "@char-pub/core";
import { expect, type Page, test } from "@playwright/test";
import { z } from "zod";
import { signInAs } from "./fullstack/session";
import { API_PORT } from "./fullstack/stack";

test.skip(!process.env.E2E_FULLSTACK, "needs the isolated full stack");
test.use({ actionTimeout: 15_000, trace: "off", video: "off" });

const Reply = z.discriminatedUnion("ok", [
  z.strictObject({ id: z.number().int(), ok: z.literal(true), result: z.unknown() }),
  z.strictObject({
    id: z.number().int(),
    ok: z.literal(false),
    code: z.string().regex(/^[a-z0-9_.-]+$/),
  }),
]);
class HarnessDriver {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly exited: Promise<void>;
  private sequence = 0;
  private buffer = "";
  private stopped = false;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(root: string, entry: string) {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) =>
          value !== undefined &&
          ["PATH", "SystemRoot", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"].includes(key),
      ),
    );
    this.child = spawn(process.execPath, [entry], {
      cwd: root,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Diagnostic output is intentionally not copied into logs: a protocol error can contain credentials.
    this.child.stderr.resume();
    this.exited = new Promise((done) =>
      this.child.once("exit", () => {
        this.stopped = true;
        this.fail("Harness driver exited");
        done();
      }),
    );
    this.child.once("error", () => this.fail("Harness driver could not start"));
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > 2_000_000) {
        this.fail("Harness IPC exceeded its byte limit");
        this.child.kill();
        return;
      }
      for (;;) {
        const newline = this.buffer.indexOf("\n");
        if (newline < 0) break;
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        let raw: unknown;
        try {
          raw = JSON.parse(line);
        } catch {
          this.fail("Harness IPC was not JSON");
          this.child.kill();
          return;
        }
        const parsed = Reply.safeParse(raw);
        if (!parsed.success) {
          this.fail("Harness IPC reply was invalid");
          this.child.kill();
          return;
        }
        const reply = parsed.data;
        const active = this.pending.get(reply.id);
        if (!active) {
          this.fail("Harness IPC reply had an unknown request ID");
          this.child.kill();
          return;
        }
        this.pending.delete(reply.id);
        clearTimeout(active.timer);
        if (reply.ok) active.resolve(reply.result);
        else active.reject(new Error(`Harness operation failed: ${reply.code}`));
      }
    });
  }
  private fail(message: string) {
    for (const operation of this.pending.values()) {
      clearTimeout(operation.timer);
      operation.reject(new Error(message));
    }
    this.pending.clear();
  }
  async call<T>(command: string, input: unknown, schema: z.ZodType<T>): Promise<T> {
    if (this.stopped) throw new Error("Harness driver is closed");
    const id = ++this.sequence;
    const result = await new Promise<unknown>((done, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Harness operation timed out"));
        this.child.kill();
      }, 45_000);
      this.pending.set(id, { resolve: done, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, command, input })}\n`, (error) => {
        if (error) this.fail("Harness IPC input closed");
      });
    });
    const parsed = schema.safeParse(result);
    if (!parsed.success) throw new Error("Harness operation returned invalid fields");
    return parsed.data;
  }
  async close() {
    if (!this.stopped) {
      try {
        await this.call("dispose", {}, z.object({ disposed: z.literal(true) }));
      } catch {
        /* Exit below still joins the child. */
      }
      this.child.stdin.end();
      const timer = setTimeout(() => this.child.kill("SIGKILL"), 5000);
      await this.exited;
      clearTimeout(timer);
    }
  }
}
async function call(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return page.evaluate(
    async ({ method, path, body, headers }) => {
      const response = await fetch(path, {
        method,
        credentials: "include",
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
    },
    { method, path, body, headers },
  );
}

const ExerciseResult = z.strictObject({
  profile: z.strictObject({ id: z.string(), namespace: z.string().nullable() }),
  sdk_import_is_packaged: z.literal(true),
  runtime_import_is_compiled: z.literal(true),
  release_id: z.string(),
  build_id: z.string(),
  source_count: z.number().int(),
  raw_source_digest: z.string(),
  messages: z.array(z.strictObject({ role: z.string(), content: z.string() })),
  logged_messages_equal: z.literal(true),
  restored_messages_equal: z.literal(true),
  response: z.string(),
  source_request_count: z.number().int(),
  credential_cookies_sent: z.literal(false),
});

test("an external compiled Harness consumes authorized artifacts and Source bytes into a durable Session", async ({
  page,
  context,
}, info) => {
  test.setTimeout(180_000);
  const configuredRoot = process.env.E2E_HARNESS_ROOT;
  if (!configuredRoot)
    throw new Error("E2E_HARNESS_ROOT must identify the separately built Harness checkout");
  const harnessRoot = resolve(configuredRoot);
  const entry = resolve(
    harnessRoot,
    "packages/experimental/charpub-roleplay-runtime/node_modules/.cache/fullstack-registry/fullstack-driver.mjs",
  );
  await access(entry);
  const driver = new HarnessDriver(harnessRoot, entry);
  const suffix = Date.now().toString(36);
  const namespace = `harness-${suffix}`;
  const ref = `@${namespace}/lantern`;
  const base = `/v1/creations/${ref}`;
  const sourceLine = "The silver lantern marks the external Runtime entrance.";
  const rawText = `\uFEFF# Route\r\n${sourceLine}\r\nCafe\u0301  \r\n`;
  const title = "Runtime route notes";
  const appName = `External Harness ${suffix}`;
  try {
    const bridge = await driver.call(
      "hello",
      {},
      z.strictObject({ redirect_uri: z.string().url() }),
    );
    await signInAs(context, "External Runtime Author");
    await page.goto("/");
    expect((await call(page, "POST", "/v1/namespaces", { slug: namespace })).status).toBe(201);
    expect(
      (
        await call(page, "POST", `/v1/namespaces/${namespace}/creations`, {
          name: "lantern",
          type: "scenario",
          display_name: "Runtime Lantern",
        })
      ).status,
    ).toBe(201);
    const initial = DraftSchema.parse((await call(page, "GET", `${base}/draft`)).body);
    const working = {
      ...(initial.working as object),
      fragments: [
        {
          id: "premise",
          kind: "scenario",
          stable: true,
          content: { type: "text", text: "A traveler is looking for the safe entrance." },
        },
      ],
      cast: [{ key: "player", who: { late: "persona" }, part: "A traveler" }],
      story: {
        version: 1,
        scenes: [{ id: "gate", title: "The gate" }],
        starts: [{ id: "arrival", scene: "gate", greeting: "Welcome to the lantern gate." }],
      },
      meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
    };
    expect(
      (
        await call(
          page,
          "PUT",
          `${base}/draft`,
          { working },
          { "if-match": String(initial.version) },
        )
      ).status,
    ).toBe(200);
    await page.goto(`/c/${namespace}/lantern/edit`);
    const documents = page.getByRole("region", { name: "Reference documents", exact: true });
    await documents.getByLabel("Reference file").setInputFiles({
      name: "runtime-route.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(rawText, "utf8"),
    });
    await documents.getByLabel("Document title", { exact: true }).fill(title);
    await documents
      .getByLabel("Document description", { exact: true })
      .fill("Directions needed when a traveler asks for the entrance.");
    await documents.getByRole("button", { name: "Upload reference", exact: true }).click();
    await expect(
      documents.getByText("Document added. Build a draft preview to check and use it."),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("All changes saved", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    const revisionResult = await call(page, "POST", `${base}/revisions`, {});
    expect(revisionResult.status).toBeLessThan(300);
    const revision = revisionResult.body as { id: string; semantic_digest: string };
    expect(
      (
        await call(
          page,
          "POST",
          `${base}/releases`,
          { revision: revision.id, label: "1.0.0", visibility: "private" },
          { "idempotency-key": suffix },
        )
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
    const detail = (await call(page, "GET", base)).body as {
      releases: { id: string; label: string; semantic_digest: string }[];
    };
    const release = detail.releases.find((item) => item.label === "1.0.0");
    if (!release) throw new Error("Private published fixture missing");
    const draft = DraftSchema.parse((await call(page, "GET", `${base}/draft`)).body);
    const buildResponse = await call(
      page,
      "POST",
      `${base}/draft-builds`,
      {},
      { "if-match": String(draft.version) },
    );
    expect([200, 202]).toContain(buildResponse.status);
    const receipt = DraftBuildResponseSchema.parse(buildResponse.body);
    await expect
      .poll(
        async () =>
          DraftBuildResponseSchema.parse(
            (await call(page, "GET", `/v1/draft-builds/${receipt.origin.build_id}`)).body,
          ).state,
        { timeout: 90_000 },
      )
      .toBe("ready");

    await page.goto("/settings#developer-clients");
    const developer = page.getByRole("region", { name: "Developer clients", exact: true });
    await developer.getByLabel("Client name").fill(appName);
    await developer.getByLabel("Redirect URIs — one per line").fill(bridge.redirect_uri);
    await developer.getByRole("button", { name: "Register public client", exact: true }).click();
    await expect(
      developer.getByText(`Registered ${appName}. Use its public client ID below.`),
    ).toBeVisible();
    const list = (await call(page, "GET", "/v1/me/oauth/clients")).body as {
      items: { name: string; client_id: string }[];
    };
    const client = list.items.find((item) => item.name === appName);
    if (!client) throw new Error("Registered Runtime client missing");
    const metadata = (await (
      await fetch(`http://127.0.0.1:${API_PORT}/.well-known/oauth-authorization-server`)
    ).json()) as { issuer: string };
    const authorization = await driver.call(
      "authorize",
      {
        registry_url: new URL(metadata.issuer).origin,
        issuer: metadata.issuer,
        client_id: client.client_id,
      },
      z.strictObject({ authorization_url: z.string().url() }),
    );
    try {
      await page.goto(authorization.authorization_url);
    } catch {
      throw new Error("Runtime authorization navigation failed");
    }
    const consent = page.getByRole("region", { name: "App authorization", exact: true });
    await expect(consent.getByRole("heading", { name: appName, exact: true })).toBeVisible();
    await expect(consent.getByText(bridge.redirect_uri, { exact: true })).toBeVisible();
    await page.screenshot({
      path: info.outputPath("external-harness-consent.png"),
      fullPage: true,
    });
    await consent.getByRole("button", { name: `Authorize ${appName}`, exact: true }).click();
    await expect(
      page.getByText("Authorization completed. Return to char.pub.", { exact: true }),
    ).toBeVisible();
    const result = await driver.call(
      "exercise",
      {
        release: { ref, release: release.id, semantic_digest: release.semantic_digest },
        build_id: receipt.origin.build_id,
      },
      ExerciseResult,
    );
    expect(result.profile.namespace).toBe(namespace);
    expect(result.release_id).toBe(release.id);
    expect(result.build_id).toBe(receipt.origin.build_id);
    expect(result.source_count).toBe(1);
    expect(result.source_request_count).toBe(1);
    // This is authored test text, not a credential; compare the actual HTTP bytes independently.
    const { createHash } = await import("node:crypto");
    expect(result.raw_source_digest).toBe(
      `sha256:${createHash("sha256").update(rawText).digest("hex")}`,
    );
    expect(result.messages.map((message) => message.content).join("\n")).toContain(sourceLine);
    expect(result.response).toBe("The traveler follows the silver lantern.");
    await info.attach("external-harness-model-messages", {
      body: JSON.stringify(result.messages, null, 2),
      contentType: "application/json",
    });
    // Reopen the editor and prove its UI build is the same immutable dbld consumed by the Runtime.
    await page.goto(`/c/${namespace}/lantern/edit`);
    const uiBuild = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().endsWith(`${base}/draft-builds`),
    );
    await page.getByRole("button", { name: "Build draft preview", exact: true }).click();
    const uiReceipt = DraftBuildResponseSchema.parse(await (await uiBuild).json());
    expect(uiReceipt.origin).toEqual(receipt.origin);
    const webSession = page.getByRole("form", { name: "Session settings", exact: true });
    await expect(webSession).toBeVisible({ timeout: 90000 });
    await webSession
      .getByRole("group", { name: /^Role / })
      .getByLabel("Name", { exact: true })
      .fill("Guest");
    const previewMessages = page.getByRole("list", { name: "Assembled messages", exact: true });
    await expect(previewMessages).toBeVisible({ timeout: 90000 });
    const artifactResponse = await page.request.get(
      `/v1/draft-builds/${receipt.origin.build_id}/artifact`,
    );
    expect(artifactResponse.ok()).toBe(true);
    const previewArtifact = CreationArtifactSchema.parse(await artifactResponse.json());
    if (previewArtifact.kind !== "content") throw new Error("Content artifact required");
    const syntheticHistory = [
      {
        role: "assistant" as const,
        text: "SYNTHETIC_RUNTIME_ASSISTANT: a quiet arrival.\r\nCafe\u0301  ",
      },
      { role: "user" as const, text: "SYNTHETIC_RUNTIME_USER: I follow the lantern." },
    ];
    const syntheticBindings = Object.fromEntries(
      previewArtifact.ir.late_slots.map((slot) => [
        slot.key,
        {
          kind: slot.accepts.includes("persona") ? "persona" : "character",
          display_name: "Synthetic traveller",
          description: "A synthetic role binding chosen for this preview.",
        },
      ]),
    );
    const preparedExport = await driver.call(
      "prepare-preview-export",
      { history: syntheticHistory, bindings: syntheticBindings },
      z.strictObject({
        digest: z.string(),
        payload: RuntimePreviewInputSchema,
        session_unchanged: z.literal(true),
      }),
    );
    expect(preparedExport.payload.source.root).toEqual(previewArtifact.root);
    expect(preparedExport.payload.turn.history).toEqual(syntheticHistory);
    expect(preparedExport.payload.turn.bindings).toEqual(syntheticBindings);
    expect(preparedExport.payload).not.toHaveProperty("source_texts");
    expect(preparedExport.payload).not.toHaveProperty("selection");
    expect(JSON.stringify(preparedExport.payload)).not.toContain(sourceLine);
    const exported = await driver.call(
      "confirm-preview-export",
      { candidate_digest: preparedExport.digest },
      z.strictObject({
        json: z.string(),
        payload: RuntimePreviewInputSchema,
        session_unchanged: z.literal(true),
      }),
    );
    expect(RuntimePreviewInputSchema.parse(JSON.parse(exported.json))).toEqual(
      preparedExport.payload,
    );
    expect(exported.payload).toEqual(preparedExport.payload);
    const importSection = page.getByRole("region", { name: "Import runtime preview", exact: true });
    const review = page.getByRole("region", { name: "Review runtime preview", exact: true });
    const originalMessages = await previewMessages.innerText();
    const writes: string[] = [];
    const observeWrite = (request: import("@playwright/test").Request) => {
      if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()))
        writes.push(request.method());
    };
    page.on("request", observeWrite);
    const beforeImport = DraftSchema.parse((await call(page, "GET", `${base}/draft`)).body);
    const wrong = structuredClone(exported.payload);
    wrong.source.root.semantic_digest = `sha256:${"f".repeat(64)}`;
    await importSection.getByLabel("Runtime preview file", { exact: true }).setInputFiles({
      name: "wrong-source.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(wrong)),
    });
    await expect(importSection.getByRole("alert")).toBeVisible();
    await expect(review).toHaveCount(0);
    expect(await previewMessages.innerText()).toBe(originalMessages);
    expect(writes).toEqual([]);
    await importSection.getByLabel("Runtime preview file", { exact: true }).setInputFiles({
      name: "runtime-preview.json",
      mimeType: "application/json",
      buffer: Buffer.from(exported.json),
    });
    await expect(review).toContainText("Synthetic traveller");
    await expect(review).toContainText("SYNTHETIC_RUNTIME_ASSISTANT");
    await expect(
      review.getByRole("button", { name: "Load into preview", exact: true }),
    ).toBeDisabled();
    expect(await previewMessages.innerText()).toBe(originalMessages);
    await review
      .getByRole("checkbox", {
        name: "I reviewed the state, synthetic messages and role bindings.",
        exact: true,
      })
      .check();
    await review.getByRole("button", { name: "Load into preview", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Exit imported preview", exact: true }),
    ).toBeVisible();
    await expect(previewMessages).toContainText("SYNTHETIC_RUNTIME_ASSISTANT");
    await expect(previewMessages).toContainText("SYNTHETIC_RUNTIME_USER");
    expect(
      (await previewMessages.innerText()).split("SYNTHETIC_RUNTIME_ASSISTANT").length - 1,
    ).toBe(1);
    expect((await previewMessages.innerText()).split("SYNTHETIC_RUNTIME_USER").length - 1).toBe(1);
    await expect(previewMessages).not.toContainText("Welcome to the lantern gate.");
    await expect(previewMessages).not.toContainText("The traveler follows the silver lantern.");
    await expect(previewMessages).not.toContainText(sourceLine);
    expect(DraftSchema.parse((await call(page, "GET", `${base}/draft`)).body).version).toBe(
      beforeImport.version,
    );
    expect(writes).toEqual([]);
    page.off("request", observeWrite);
    await page.screenshot({
      path: info.outputPath("runtime-preview-imported.png"),
      fullPage: true,
    });

    // Source selection is a new explicit author action, not authority smuggled in the imported file.
    await page.getByRole("checkbox", { name: new RegExp(title) }).check();
    await expect(previewMessages).toContainText(sourceLine);
    await page.getByRole("button", { name: "Save preview as author test", exact: true }).click();
    await expect(
      page.getByText(
        "Saved author test preview. Run author tests to verify it against a new build.",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 30000 });
    const savedWorking = canonicalizeCreation(
      DraftSchema.parse((await call(page, "GET", `${base}/draft`)).body).working,
    ).creation;
    const fixture = savedWorking.assembly_tests?.[0];
    expect(fixture?.root).toBe("self");
    expect(fixture?.session.history).toEqual(syntheticHistory);
    expect(fixture?.session.bindings).toEqual(syntheticBindings);
    expect(Object.values(fixture?.source_texts ?? {})).toEqual([rawText]);
    const expectedFixture = fixture?.expected;
    await page.getByRole("button", { name: "Run author tests", exact: true }).click();
    await expect(
      page.getByRole("list", { name: "Author test results", exact: true }),
    ).toContainText("Passed: preview", { timeout: 90000 });
    const afterRun = canonicalizeCreation(
      DraftSchema.parse((await call(page, "GET", `${base}/draft`)).body).working,
    ).creation;
    expect(afterRun.assembly_tests?.[0]?.expected).toEqual(expectedFixture);
    await page.screenshot({
      path: info.outputPath("runtime-preview-fixture-passed.png"),
      fullPage: true,
    });
    await page.goto("/settings#connected-apps");
    const connected = page.getByRole("region", { name: "Connected apps", exact: true });
    await connected.getByRole("button", { name: `Revoke ${appName}`, exact: true }).click();
    await expect(connected.getByText("You have no connected apps.", { exact: true })).toBeVisible();
    await page.screenshot({
      path: info.outputPath("external-harness-revoked.png"),
      fullPage: true,
    });
    const revoked = await driver.call(
      "verify-revoked",
      {
        release: { ref, release: release.id, semantic_digest: release.semantic_digest },
        build_id: receipt.origin.build_id,
      },
      z.strictObject({
        profile_denied: z.literal(true),
        release_denied: z.literal(true),
        build_denied: z.literal(true),
        refresh_denied: z.literal(true),
        credential_cookies_sent: z.literal(false),
      }),
    );
    expect(revoked.credential_cookies_sent).toBe(false);
  } finally {
    await driver.close();
  }
});

const EndingReview = z.strictObject({
  authorization_version: z.number().int(),
  digest: z.string(),
  target: z.strictObject({
    ref: z.string(),
    source: ExactRefSchema,
    label: z.string(),
    revision: z.string(),
  }),
  metadata: z.strictObject({
    source_rating: z.string(),
    source_license: z.string(),
    source_content_warnings: z.array(z.string()),
  }),
  ending: z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    after: z.literal("continue"),
  }),
  request: CreateContributionRequestSchema,
});
const PreparedEnding = z.strictObject({
  candidate: EndingReview,
  contribution_posts: z.literal(0),
  session_settled: z.literal(true),
  logged_messages_equal: z.literal(true),
  credential_cookies_sent: z.literal(false),
});

test("an external Runtime reviews an ending from an old exact Release and submits it for the author's concurrent draft", async ({
  page: owner,
  context,
  browser,
}, info) => {
  test.setTimeout(180000);
  const configuredRoot = process.env.E2E_HARNESS_ROOT;
  if (!configuredRoot)
    throw new Error("E2E_HARNESS_ROOT must identify the separately built Harness checkout");
  const harnessRoot = resolve(configuredRoot);
  const entry = resolve(
    harnessRoot,
    "packages/experimental/charpub-roleplay-runtime/node_modules/.cache/fullstack-registry/fullstack-driver.mjs",
  );
  await access(entry);
  const driver = new HarnessDriver(harnessRoot, entry);
  const baseURL = info.project.use.baseURL;
  if (!baseURL) throw new Error("Fullstack baseURL required");
  const contributorContext = await browser.newContext({ baseURL });
  const contributor = await contributorContext.newPage();
  const suffix = Date.now().toString(36);
  const ns = `return-author-${suffix}`;
  const contributorNs = `return-player-${suffix}`;
  const base = `/v1/creations/@${ns}/inn`;
  const title = "Keep the lantern lit";
  const ending = {
    id: "lantern-stays",
    title: "The lantern stays lit",
    description: "The travelers leave a light for the next visitor.",
    after: "continue" as const,
  };
  const rights = { inbound_equals_outbound: true as const };
  const appName = `Ending Runtime ${suffix}`;
  const errors: string[] = [];
  owner.on("pageerror", (error) => errors.push(error.message));
  contributor.on("pageerror", (error) => errors.push(error.message));
  try {
    await signInAs(context, "Original Ending Author");
    await signInAs(contributorContext, "Runtime Ending Contributor");
    await owner.goto("/");
    await contributor.goto("/");
    expect((await call(owner, "POST", "/v1/namespaces", { slug: ns })).status).toBe(201);
    expect(
      (await call(contributor, "POST", "/v1/namespaces", { slug: contributorNs })).status,
    ).toBe(201);
    expect(
      (
        await call(owner, "POST", `/v1/namespaces/${ns}/creations`, {
          name: "inn",
          type: "scenario",
          display_name: "The Return Inn",
        })
      ).status,
    ).toBe(201);
    const initial = DraftSchema.parse((await call(owner, "GET", `${base}/draft`)).body);
    const working = {
      ...(initial.working as object),
      fragments: [
        {
          id: "premise",
          kind: "scenario",
          stable: true,
          content: { type: "text", text: "A lantern guides travelers to a quiet inn." },
        },
      ],
      cast: [{ key: "player", who: { late: "persona" } }],
      story: {
        version: 1,
        scenes: [
          {
            id: "hall",
            title: "Hall",
            time: "Evening",
            opening: "The lantern glows beside the inn door.",
          },
        ],
        starts: [{ id: "arrival", scene: "hall", greeting: "Welcome to the inn." }],
      },
      meta: {
        default_locale: "en",
        rating: "general",
        rights: "original",
        license: "CC-BY-4.0",
        contribution_policy: "signed-in",
      },
    };
    expect(
      (
        await call(
          owner,
          "PUT",
          `${base}/draft`,
          { working },
          { "if-match": String(initial.version) },
        )
      ).status,
    ).toBe(200);
    async function publish(label: string) {
      const revision = RevisionSchema.parse(
        (await call(owner, "POST", `${base}/revisions`, {})).body,
      );
      const result = await call(
        owner,
        "POST",
        `${base}/releases`,
        { revision: revision.id, label, visibility: "public" },
        { "idempotency-key": `return-${suffix}-${label}` },
      );
      expect(result.status).toBeLessThan(300);
      await expect
        .poll(async () => (await call(owner, "GET", `${base}/releases/${label}/report`)).body, {
          timeout: 60000,
        })
        .toMatchObject({ state: "active" });
      const detail = CreationDetailSchema.parse((await call(owner, "GET", base)).body);
      const release = detail.releases.find((r) => r.label === label);
      if (!release) throw new Error("Published source missing");
      return {
        exact: { ref: `@${ns}/inn`, release: release.id, semantic_digest: release.semantic_digest },
        revision: revision.id,
      };
    }
    const old = await publish("1.0.0");
    const beforeSecond = DraftSchema.parse((await call(owner, "GET", `${base}/draft`)).body);
    const newer = canonicalizeCreation(beforeSecond.working).creation;
    if (!newer.story?.scenes[0]) throw new Error("Scene missing");
    newer.story.scenes[0].time = "Noon in the newer release";
    expect(
      (
        await call(
          owner,
          "PUT",
          `${base}/draft`,
          { working: newer },
          { "if-match": String(beforeSecond.version) },
        )
      ).status,
    ).toBe(200);
    const second = await publish("2.0.0");
    expect(second.exact.release).not.toBe(old.exact.release);

    const bridge = await driver.call(
      "hello",
      {},
      z.strictObject({ redirect_uri: z.string().url() }),
    );
    await contributor.goto("/settings#developer-clients");
    const developer = contributor.getByRole("region", { name: "Developer clients", exact: true });
    await developer.getByLabel("Client name").fill(appName);
    await developer.getByLabel("Redirect URIs — one per line").fill(bridge.redirect_uri);
    await developer.getByRole("button", { name: "Register public client", exact: true }).click();
    await expect(
      developer.getByText(`Registered ${appName}. Use its public client ID below.`),
    ).toBeVisible();
    const clients = z
      .object({ items: z.array(z.object({ name: z.string(), client_id: z.string() })) })
      .parse((await call(contributor, "GET", "/v1/me/oauth/clients")).body);
    const client = clients.items.find((item) => item.name === appName);
    if (!client) throw new Error("Runtime client missing");
    const metadata = z
      .object({ issuer: z.string() })
      .parse(
        await (
          await fetch(`http://127.0.0.1:${API_PORT}/.well-known/oauth-authorization-server`)
        ).json(),
      );
    const authorization = await driver.call(
      "authorize",
      {
        registry_url: new URL(metadata.issuer).origin,
        issuer: metadata.issuer,
        client_id: client.client_id,
      },
      z.strictObject({ authorization_url: z.string().url() }),
    );
    try {
      await contributor.goto(authorization.authorization_url);
    } catch {
      throw new Error("Runtime authorization navigation failed");
    }
    const consent = contributor.getByRole("region", { name: "App authorization", exact: true });
    await expect(consent.getByRole("heading", { name: appName, exact: true })).toBeVisible();
    await consent.getByRole("button", { name: `Authorize ${appName}`, exact: true }).click();
    await expect(
      contributor.getByText("Authorization completed. Return to char.pub.", { exact: true }),
    ).toBeVisible();

    // The separate process settles a real persistent Session, then invokes the product proposal API.
    const prepareInput = { release: old.exact, ending, title, rights_ack: rights };
    const cancelled = await driver.call("prepare-proposal", prepareInput, PreparedEnding);
    expect(cancelled.candidate.target).toEqual({
      ref: old.exact.ref,
      source: old.exact,
      label: "1.0.0",
      revision: old.revision,
    });
    expect(cancelled.candidate.ending).toEqual(ending);
    expect(cancelled.candidate.metadata.source_license).toBe("CC-BY-4.0");
    await driver.call(
      "cancel-proposal",
      { candidate_digest: cancelled.candidate.digest },
      z.strictObject({ cancelled: z.literal(true), contribution_posts: z.literal(0) }),
    );
    const prepared = await driver.call("prepare-proposal", prepareInput, PreparedEnding);
    expect(prepared.candidate.request).toMatchObject({
      base_revision: old.revision,
      changes_version: 1,
      rights_ack: rights,
      agent: true,
    });
    expect(prepared.candidate.request.changes).toContainEqual(
      expect.objectContaining({
        on: "story",
        kind: "ending",
        op: "add",
        id: ending.id,
        after: ending,
      }),
    );
    expect(JSON.stringify(prepared.candidate)).not.toContain("PRIVATE_HISTORY");
    // This is the explicit test confirmation of the displayed DTO, not a finished Runtime GUI.
    const submitted = await driver.call(
      "submit-proposal",
      { candidate_digest: prepared.candidate.digest, rights_ack: rights },
      z.strictObject({
        receipt: z.strictObject({
          id: z.string(),
          number: z.number(),
          status: z.literal("open"),
          agent: z.literal(true),
          sensitive_keys: z.array(z.string()),
        }),
        contribution_posts: z.literal(1),
        session_unchanged: z.literal(true),
        credential_cookies_sent: z.literal(false),
      }),
    );

    // Owner edits after proposal preparation/submission; acceptance must preserve this current field.
    await owner.goto(`/c/${ns}/inn/edit`);
    await owner
      .getByLabel("Time for hall", { exact: true })
      .fill("Midnight, changed by the original author");
    await expect(owner.getByText("All changes saved", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await owner.goto(`/c/${ns}/inn/contributions/${submitted.receipt.number}`);
    await expect(owner.getByRole("heading", { name: title })).toBeVisible();
    await expect(
      owner.getByRole("listitem", { name: `Ending ${ending.id}: will apply`, exact: true }),
    ).toContainText(ending.description);
    const preview = owner.getByRole("region", { name: "Proposal preview", exact: true });
    await preview.getByRole("button", { name: "Preview proposed changes", exact: true }).click();
    await expect(
      preview.getByRole("form", { name: "Session settings", exact: true }),
    ).toBeVisible();
    await preview
      .getByRole("group", { name: /^Role / })
      .getByLabel("Name", { exact: true })
      .fill("Guest");
    await expect(preview.getByRole("list", { name: "Assembled messages" })).toContainText(
      "Midnight, changed by the original author",
    );
    await owner.screenshot({
      path: info.outputPath("runtime-ending-owner-review.png"),
      fullPage: true,
    });
    await owner.getByRole("button", { name: "Accept into the draft", exact: true }).click();
    await expect(owner.getByRole("heading", { name: "Accepted", exact: true })).toBeVisible();
    const accepted = canonicalizeCreation(
      DraftSchema.parse((await call(owner, "GET", `${base}/draft`)).body).working,
    ).creation;
    expect(accepted.story?.scenes[0]?.time).toBe("Midnight, changed by the original author");
    expect(accepted.story?.endings).toContainEqual(expect.objectContaining(ending));
    expect(accepted.provenance?.contributors).toContainEqual(
      expect.objectContaining({ client_id: client.client_id }),
    );
    expect(
      CreationDetailSchema.parse((await call(owner, "GET", base)).body)
        .releases.map((r) => r.id)
        .sort(),
    ).toEqual([old.exact.release, second.exact.release].sort());
    await owner.screenshot({
      path: info.outputPath("runtime-ending-accepted.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await driver.close();
    await contributorContext.close();
  }
});

const ContinuationReview = z.strictObject({
  source: z.strictObject({ exact: ExactRefSchema, label: z.string(), revision: z.string() }),
  target: z.strictObject({
    namespace: z.string(),
    name: z.string(),
    display_name: z.string().optional(),
  }),
  metadata: z.strictObject({
    source_rating: z.string(),
    source_license: z.string(),
    source_content_warnings: z.array(z.string()),
    effective_rating: z.string(),
    effective_content_warnings: z.array(z.string()),
  }),
  request: DeriveCreationRequestSchema,
  reset: z.strictObject({
    visited: z.literal("opening-scene-only"),
    reached: z.array(z.never()),
    ended: z.array(z.never()),
    happened: z.array(z.never()),
    stopped: z.literal(false),
  }),
  authorization_version: z.number().int(),
  digest: z.string(),
});

test("an external Runtime confirms a played situation into a new private sequel without replaying old effects", async ({
  page,
  context,
}, info) => {
  test.setTimeout(180000);
  const configuredRoot = process.env.E2E_HARNESS_ROOT;
  if (!configuredRoot) throw new Error("E2E_HARNESS_ROOT is required");
  const harnessRoot = resolve(configuredRoot);
  const entry = resolve(
    harnessRoot,
    "packages/experimental/charpub-roleplay-runtime/node_modules/.cache/fullstack-registry/fullstack-driver.mjs",
  );
  await access(entry);
  const driver = new HarnessDriver(harnessRoot, entry);
  const suffix = Date.now().toString(36);
  const ns = `sequel-runtime-${suffix}`;
  const ref = `@${ns}/gate`;
  const base = `/v1/creations/${ref}`;
  const appName = `Sequel Runtime ${suffix}`;
  const opening = "REVIEWED_OPENING: Bob leaves the gate with the agreement intact.";
  const rights = { inbound_equals_outbound: true as const };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await signInAs(context, "Runtime Sequel Author");
    await page.goto("/");
    expect((await call(page, "POST", "/v1/namespaces", { slug: ns })).status).toBe(201);
    expect(
      (
        await call(page, "POST", `/v1/namespaces/${ns}/creations`, {
          name: "gate",
          type: "scenario",
          display_name: "The remembered gate",
          working: {
            meta: {
              default_locale: "en",
              rating: "general",
              rights: "original",
              license: "CC0-1.0",
            },
            cast: [
              { key: "alice", who: { late: "character" } },
              { key: "bob", who: { late: "character" } },
            ],
            fragments: [
              {
                id: "secret",
                kind: "knowledge",
                stable: true,
                content: { type: "text", text: "The hidden gate opens east." },
              },
            ],
            story: {
              version: 1,
              vars: { trust: { type: "int", min: 0, max: 10, init: 1, description: "Trust" } },
              scenes: [
                {
                  id: "gate",
                  title: "Gate",
                  opening: "OLD_SCENE_OPENING",
                  time: "Old release evening",
                },
              ],
              starts: [
                {
                  id: "old-start",
                  scene: "gate",
                  greeting: "OLD_GREETING",
                  set: [{ add: ["var/trust", 2] }],
                },
              ],
              knowing: {
                "#secret": { start: { knows: [] }, enter: { gate: { knows: ["alice"] } } },
              },
              beats: [
                {
                  id: "agreement",
                  title: "Agreement",
                  description: "The guards reach agreement.",
                  effects: [{ add: ["var/trust", 4] }, { learn: { who: "bob", info: "#secret" } }],
                },
              ],
              endings: [
                {
                  id: "leave",
                  title: "Leave",
                  description: "The old story ends",
                  effects: [{ add: ["var/trust", 2] }],
                },
              ],
            },
          },
        })
      ).status,
    ).toBe(201);
    async function publish(label: string) {
      const revision = RevisionSchema.parse(
        (await call(page, "POST", `${base}/revisions`, {})).body,
      );
      expect(
        (
          await call(
            page,
            "POST",
            `${base}/releases`,
            { revision: revision.id, label, visibility: "public" },
            { "idempotency-key": `sequel-${suffix}-${label}` },
          )
        ).status,
      ).toBeLessThan(300);
      await expect
        .poll(async () => (await call(page, "GET", `${base}/releases/${label}/report`)).body, {
          timeout: 60000,
        })
        .toMatchObject({ state: "active" });
      const detail = CreationDetailSchema.parse((await call(page, "GET", base)).body);
      const release = detail.releases.find((item) => item.label === label);
      if (!release) throw new Error("Published source missing");
      return {
        exact: { ref, release: release.id, semantic_digest: release.semantic_digest },
        revision: revision.id,
      };
    }
    const old = await publish("1.0.0");
    const draft = DraftSchema.parse((await call(page, "GET", `${base}/draft`)).body);
    const current = canonicalizeCreation(draft.working).creation;
    if (!current.story?.scenes[0]) throw new Error("Source scene missing");
    current.story.scenes[0].time = "NEW_RELEASE_TIME_MUST_NOT_REBIND";
    expect(
      (
        await call(
          page,
          "PUT",
          `${base}/draft`,
          { working: current },
          { "if-match": String(draft.version) },
        )
      ).status,
    ).toBe(200);
    const latest = await publish("2.0.0");
    expect(latest.exact.release).not.toBe(old.exact.release);

    const hello = await driver.call(
      "hello",
      {},
      z.strictObject({ redirect_uri: z.string().url() }),
    );
    await page.goto("/settings#developer-clients");
    const developer = page.getByRole("region", { name: "Developer clients", exact: true });
    await developer.getByLabel("Client name").fill(appName);
    await developer.getByLabel("Redirect URIs — one per line").fill(hello.redirect_uri);
    await developer.getByRole("button", { name: "Register public client", exact: true }).click();
    await expect(
      developer.getByText(`Registered ${appName}. Use its public client ID below.`),
    ).toBeVisible();
    const clients = z
      .object({ items: z.array(z.object({ name: z.string(), client_id: z.string() })) })
      .parse((await call(page, "GET", "/v1/me/oauth/clients")).body);
    const client = clients.items.find((item) => item.name === appName);
    if (!client) throw new Error("Client missing");
    const metadata = z
      .object({ issuer: z.string() })
      .parse(
        await (
          await fetch(`http://127.0.0.1:${API_PORT}/.well-known/oauth-authorization-server`)
        ).json(),
      );
    const auth = await driver.call(
      "authorize",
      {
        registry_url: new URL(metadata.issuer).origin,
        issuer: metadata.issuer,
        client_id: client.client_id,
      },
      z.strictObject({ authorization_url: z.string().url() }),
    );
    try {
      await page.goto(auth.authorization_url);
    } catch {
      throw new Error("Authorization navigation failed");
    }
    const consent = page.getByRole("region", { name: "App authorization", exact: true });
    await consent.getByRole("button", { name: `Authorize ${appName}`, exact: true }).click();
    await expect(
      page.getByText("Authorization completed. Return to char.pub.", { exact: true }),
    ).toBeVisible();

    // The bridge exercises real Runtime commands. Confirmation is a test RPC, not a Runtime GUI.
    const prepared = await driver.call(
      "prepare-continuation",
      {
        release: old.exact,
        namespace: ns,
        name: "after-gate",
        display_name: "Beyond the remembered gate",
        opening,
        rights_ack: rights,
      },
      z.strictObject({
        review: ContinuationReview,
        derivation_posts: z.literal(0),
        session_unchanged: z.literal(true),
        logged_messages_equal: z.literal(true),
        credential_cookies_sent: z.literal(false),
      }),
    );
    expect(prepared.review.source).toEqual({
      exact: old.exact,
      label: "1.0.0",
      revision: old.revision,
    });
    expect(prepared.review.request).toMatchObject({
      kind: "sequel",
      source: old.exact,
      agent: true,
      from_play: {
        scene: "gate",
        present: ["bob"],
        vars: { trust: 7 },
        knowing: { "#secret": ["alice", "bob"] },
        opening,
      },
    });
    expect(prepared.review.request).not.toHaveProperty("working");
    expect(JSON.stringify(prepared.review)).not.toContain("PRIVATE_HISTORY");
    const submitted = await driver.call(
      "submit-continuation",
      { candidate_digest: prepared.review.digest, rights_ack: rights },
      z.strictObject({
        receipt: CreateCreationResponseSchema,
        derivation_posts: z.literal(1),
        session_unchanged: z.literal(true),
        credential_cookies_sent: z.literal(false),
      }),
    );
    expect(submitted.receipt.ref).toBe(`@${ns}/after-gate`);
    const target = `/v1/creations/${submitted.receipt.ref}`;
    await page.goto(`/c/${ns}/after-gate/edit`);
    const saved = DraftSchema.parse((await call(page, "GET", `${target}/draft`)).body);
    const creation = canonicalizeCreation(saved.working).creation;
    expect(creation.provenance).toMatchObject({
      client_id: client.client_id,
      authored_by_agent: true,
      derived_from: [{ ...old.exact, relation: "sequel" }],
    });
    expect(creation.story?.scenes[0]).toMatchObject({
      id: "gate",
      time: "Old release evening",
      opening,
    });
    expect(creation.story?.beats ?? []).toEqual([]);
    expect(creation.story?.knowing?.["#secret"]).not.toHaveProperty("enter");
    expect(creation.story?.endings ?? []).toEqual([]);
    expect(creation.assembly_tests ?? []).toEqual([]);
    expect(creation.bootstrap).toBeUndefined();
    expect((await fetch(`http://127.0.0.1:${API_PORT}${target}/draft`)).status).toBe(404);
    const openingField = page.getByLabel("Opening situation for gate", { exact: true });
    await expect(openingField).toHaveValue(opening);
    const editedOpening = `${opening} WEB_EDIT: a new road awaits.`;
    await openingField.fill(editedOpening);
    await expect(page.getByText("All changes saved", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await page.reload();
    await expect(page.getByLabel("Opening situation for gate", { exact: true })).toHaveValue(
      editedOpening,
    );
    await page.screenshot({ path: info.outputPath("runtime-sequel-editor.png"), fullPage: true });
    const buildResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().endsWith(`${target}/draft-builds`),
    );
    await page.getByRole("button", { name: "Build draft preview", exact: true }).click();
    const response = await buildResponse;
    expect(response.status()).toBe(202);
    const receipt = DraftBuildResponseSchema.parse(await response.json());
    const session = page.getByRole("form", { name: "Session settings", exact: true });
    await expect(session).toBeVisible({ timeout: 90000 });
    const roles = session.getByRole("group", { name: /^Role / });
    await expect(roles).toHaveCount(2);
    await roles.nth(0).getByLabel("Name", { exact: true }).fill("Alice");
    await roles.nth(1).getByLabel("Name", { exact: true }).fill("Bob");
    const messages = page.getByRole("list", { name: "Assembled messages", exact: true });
    await expect(messages).toContainText(editedOpening);
    await expect(messages).not.toContainText("OLD_GREETING");
    await expect(messages).not.toContainText("OLD_SCENE_OPENING");
    await expect(messages).not.toContainText("PRIVATE_HISTORY");
    await expect(messages).not.toContainText("The traveler follows the silver lantern.");
    const artifactResponse = await page.request.get(
      `/v1/draft-builds/${receipt.origin.build_id}/artifact`,
    );
    expect(artifactResponse.status()).toBe(200);
    const artifact = CreationArtifactSchema.parse(await artifactResponse.json());
    if (artifact.kind !== "content" || !artifact.story || !artifact.story_refs)
      throw new Error("Built Story missing");
    expect(
      initStoryState(artifact.story, Object.keys(artifact.story_refs.participants)),
    ).toMatchObject({
      scene: "gate",
      present: ["bob"],
      vars: { trust: 7 },
      knowing: { "#secret": ["alice", "bob"] },
      reached: [],
      ended: [],
      happened: [],
      stopped: false,
    });
    expect(artifact.lock).toContainEqual(expect.objectContaining(old.exact));
    expect(artifact.lock.some((pin) => pin.release === latest.exact.release)).toBe(false);
    expect(CreationDetailSchema.parse((await call(page, "GET", target)).body).releases).toEqual([]);
    expect(CreationDetailSchema.parse((await call(page, "GET", base)).body).releases).toHaveLength(
      2,
    );
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath("runtime-sequel-preview.png"), fullPage: true });
  } finally {
    await driver.close();
  }
});
