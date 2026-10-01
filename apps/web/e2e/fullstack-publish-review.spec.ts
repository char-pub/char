import {
  CreationDetailSchema,
  DraftBuildResponseSchema,
  DraftSchema,
  ReferenceImpactResponseSchema,
  RevisionSchema,
} from "@char-pub/contracts";
import { CreationSchema, canonicalizeCreation, ExactRefSchema } from "@char-pub/core";
import { expect, type Page, test } from "@playwright/test";
import { signInAs } from "./fullstack/session";

test.skip(!process.env.E2E_FULLSTACK, "needs the isolated full stack");
test.use({ trace: "off", video: "off", actionTimeout: 15000 });
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
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    { method, path, body, headers },
  );
}

test("reviews canonical changes and authorized object references before publishing the same saved revision", async ({
  page,
  context,
}, info) => {
  test.setTimeout(180000);
  const ns = `review-${Date.now().toString(36)}`;
  const base = `/v1/creations/@${ns}/gate`;
  await signInAs(context, "Publication Review Author");
  await page.goto("/");
  expect((await call(page, "POST", "/v1/namespaces", { slug: ns })).status).toBe(201);
  const policy = ExactRefSchema.parse((await call(page, "GET", "/v1/default-policy")).body);
  const meta = { default_locale: "en", license: "CC0-1.0", rights: "original", rating: "general" };
  expect(
    (
      await call(page, "POST", `/v1/namespaces/${ns}/creations`, {
        name: "gate",
        type: "scenario",
        display_name: "Gate review",
        working: {
          meta,
          cast: [{ key: "player", who: { late: "persona" }, goal: "Find a safe route." }],
          fragments: [
            {
              id: "premise",
              stable: true,
              kind: "scenario",
              description: "OLD_DESCRIPTION",
              content: { type: "text", text: "OLD_BODY" },
            },
            {
              id: "retire",
              stable: true,
              kind: "knowledge",
              content: { type: "text", text: "This stable passage will be removed." },
            },
          ],
          story: {
            version: 1,
            vars: { trust: { type: "int", init: 1, min: 0, max: 10, description: "Trust" } },
            scenes: [{ id: "gate", title: "Gate", time: "Evening", opening: "A traveler waits." }],
          },
          assembly: {
            version: "1-draft",
            preset: policy,
            assembler: { name: "@char-pub/assembler", version: "0.0.0" },
            tokenizer: { name: "estimate", version: "1" },
            profile: {
              runtime: { name: "review-test", version: "1" },
              tokenizer: "estimate",
              mode: "per-agent",
              context_window: 8192,
              reserve_for_output: 512,
              locale: "en",
              capabilities: { system_role: true, multiple_system_messages: true },
            },
          },
        },
      })
    ).status,
  ).toBe(201);
  await page.goto(`/c/${ns}/gate/edit`);
  const documents = page.getByRole("region", { name: "Reference documents", exact: true });
  await documents.getByLabel("Reference file").setInputFiles({
    name: "gate-notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("UNFETCHED_REVIEW_DOCUMENT", "utf8"),
  });
  await documents.getByLabel("Document title", { exact: true }).fill("Gate notes");
  await documents
    .getByLabel("Document description", { exact: true })
    .fill("Directions for the traveler.");
  await documents.getByRole("button", { name: "Upload reference", exact: true }).click();
  await expect(
    documents.getByText("Document added. Build a draft preview to check and use it."),
  ).toBeVisible({ timeout: 60000 });
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  async function publish(path: string, label: string) {
    const revisionResponse = await call(page, "POST", `${path}/revisions`, {});
    expect([200, 201]).toContain(revisionResponse.status);
    const revision = RevisionSchema.parse(revisionResponse.body);
    expect(
      (
        await call(
          page,
          "POST",
          `${path}/releases`,
          { revision: revision.id, label, visibility: "public" },
          { "idempotency-key": `${ns}:${path}:${label}` },
        )
      ).status,
    ).toBe(202);
    await expect
      .poll(async () => (await call(page, "GET", `${path}/releases/${label}/report`)).body, {
        timeout: 60000,
      })
      .toMatchObject({ state: "active" });
    const detail = CreationDetailSchema.parse((await call(page, "GET", path)).body);
    const release = detail.releases.find((item) => item.label === label);
    if (!release) throw new Error("Published release missing");
    return { release, revision };
  }
  const first = await publish(base, "1.0.0");
  const follower = `/v1/creations/@${ns}/follower`;
  expect(
    (
      await call(page, "POST", `/v1/namespaces/${ns}/creations`, {
        name: "follower",
        type: "world",
        display_name: "Gate dependent",
        working: {
          meta,
          fragments: [
            {
              id: "world",
              stable: true,
              kind: "world",
              content: { type: "text", text: "A neighboring town." },
            },
          ],
          references: [
            {
              id: "gate",
              use: `@${ns}/gate`,
              mode: "default",
              pin: { release: first.release.id, semantic_digest: first.release.semantic_digest },
              select: { include: ["retire"] },
            },
          ],
        },
      })
    ).status,
  ).toBe(201);
  await publish(follower, "1.0.0");
  // Fixed API inputs prepare the three authoring changes; all review and publication actions below use the real UI.
  const before = DraftSchema.parse((await call(page, "GET", `${base}/draft`)).body);
  const next = CreationSchema.parse(canonicalizeCreation(before.working).json);
  next.fragments = next.fragments
    .filter((fragment) => fragment.id !== "retire")
    .map((fragment) => {
      const { digest: _, ...definition } = fragment;
      return {
        ...definition,
        description: "NEW_DESCRIPTION",
        content: { type: "text" as const, text: "NEW_BODY" },
      };
    });
  if (!next.story?.scenes[0]) throw new Error("Scene missing");
  next.story.scenes[0].time = "Morning";
  expect(
    (
      await call(
        page,
        "PUT",
        `${base}/draft`,
        { working: next },
        { "if-match": String(before.version) },
      )
    ).status,
  ).toBe(200);
  await page.reload();
  await page.getByRole("button", { name: "Publish…", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Ready to publish the reviewed draft.", { exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await expect(dialog.getByLabel("Compare with published version", { exact: true })).toHaveValue(
    first.release.id,
  );
  const diff = dialog.getByRole("region", { name: "Changes in this release", exact: true });
  await expect(diff).toContainText(`Compared with @${ns}/gate@1.0.0.`);
  await expect(diff).toContainText("OLD_BODY");
  await expect(diff).toContainText("NEW_BODY");
  await expect(diff).toContainText("OLD_DESCRIPTION");
  await expect(diff).toContainText("NEW_DESCRIPTION");
  await expect(diff).toContainText("Evening");
  await expect(diff).toContainText("Morning");
  const impact = dialog.getByRole("region", { name: "References to removed objects", exact: true });
  await expect(impact).toContainText("retire");
  await expect(impact).toContainText("Gate dependent");
  await expect(impact).toContainText("Existing exact pins keep using their original content");
  await dialog.getByText("Checks for individual character views", { exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Share Gate notes with all characters", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Share Gate notes with all characters", exact: true })
    .click();
  await expect(dialog.getByRole("button", { name: "Publish 1.0.1", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Undo sharing", exact: true })).toBeVisible();
  // Rebuild the intentional visibility edit; the old review cannot silently resume.
  const buildResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().endsWith(`${base}/draft-builds`),
  );
  await dialog.getByRole("button", { name: "Prepare again", exact: true }).click();
  const receipt = DraftBuildResponseSchema.parse(await (await buildResponse).json());
  await expect(
    dialog.getByText("Ready to publish the reviewed draft.", { exact: true }),
  ).toBeVisible({ timeout: 90000 });
  const impactResponse = await page.request.get(
    `/v1/draft-builds/${receipt.origin.build_id}/reference-impact?base_release=${first.release.id}`,
  );
  expect(impactResponse.status()).toBe(200);
  const report = ReferenceImpactResponseSchema.parse(await impactResponse.json());
  expect(report.base.release).toBe(first.release.id);
  expect(report.candidate.origin.revision).toBe(receipt.origin.revision);
  expect(
    report.items.some((item) =>
      item.uses.some((use) => use.object.kind === "fragment" && use.object.id === "retire"),
    ),
  ).toBe(true);
  await dialog.screenshot({ path: info.outputPath("publication-definition-review.png") });
  await dialog
    .getByRole("checkbox", {
      name: "I understand this release uses experimental capabilities.",
      exact: true,
    })
    .check();
  const sent = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith(`${base}/releases`),
  );
  await dialog.getByRole("button", { name: "Publish 1.0.1", exact: true }).click();
  expect((await sent).postDataJSON()).toEqual({
    revision: receipt.origin.revision,
    label: "1.0.1",
    visibility: "public",
  });
  await expect(dialog.getByRole("heading", { name: "Published 1.0.1", exact: true })).toBeVisible({
    timeout: 90000,
  });
  await dialog.getByRole("link", { name: "View release", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Gate review", exact: true })).toBeVisible();
  await page.screenshot({
    path: info.outputPath("publication-reviewed-release.png"),
    fullPage: true,
  });
});
