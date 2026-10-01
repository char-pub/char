import { DraftBuildResponseSchema } from "@char-pub/contracts";
import { CreationArtifactSchema } from "@char-pub/core";
import { expect, type Page, test } from "@playwright/test";
import { signInAs } from "./fullstack/session";

test.skip(!process.env.E2E_FULLSTACK, "needs the isolated full stack");
test.use({ trace: "off", video: "off" });
async function api(page: Page, path: string, body: unknown) {
  return page.evaluate(
    async ({ path, body }) => {
      const response = await fetch(path, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, body },
  );
}

test("reviews real experimental requirements, publishes that revision and shows the badge to readers", async ({
  page,
  context,
  browser,
}, info) => {
  test.setTimeout(180000);
  const ns = `experimental-${Date.now().toString(36)}`;
  await signInAs(context, "Experimental Story Author");
  await page.goto("/");
  expect((await api(page, "/v1/namespaces", { slug: ns })).status).toBe(201);
  const created = await api(page, `/v1/namespaces/${ns}/creations`, {
    name: "gate",
    type: "scenario",
    display_name: "The Experimental Gate",
    working: {
      meta: { default_locale: "en", rights: "original", license: "CC0-1.0", rating: "general" },
      cast: [{ key: "player", who: { late: "persona" } }],
      fragments: [
        {
          id: "secret",
          stable: true,
          kind: "knowledge",
          content: { type: "text", text: "The gate opens at dawn." },
        },
      ],
      story: {
        version: 1,
        vars: { trust: { type: "int", min: 0, max: 10, init: 1, description: "Trust" } },
        scenes: [{ id: "gate", title: "Gate", opening: "A traveler waits by the gate." }],
        knowing: { "#secret": { start: { knows: ["player"] } } },
      },
    },
  });
  expect(created.status).toBe(201);
  const base = `/v1/creations/@${ns}/gate`;
  const publications: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith(`${base}/releases`))
      publications.push(request.postDataJSON());
  });
  await page.goto(`/c/${ns}/gate/edit`);
  const buildResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().endsWith(`${base}/draft-builds`),
  );
  await page.getByRole("button", { name: "Publish…", exact: true }).click();
  const receipt = DraftBuildResponseSchema.parse(await (await buildResponse).json());
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Publish The Experimental Gate", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Ready to publish the reviewed draft.", { exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await expect(dialog.getByText("Story state and conditions", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Character knowledge", { exact: true })).toBeVisible();
  const checkbox = dialog.getByRole("checkbox", {
    name: "I understand this release uses experimental capabilities.",
    exact: true,
  });
  const publish = dialog.getByRole("button", { name: "Publish 1.0.0", exact: true });
  await expect(checkbox).not.toBeChecked();
  await expect(publish).toBeDisabled();
  expect(publications).toEqual([]);
  const downloaded = await page.request.get(`/v1/draft-builds/${receipt.origin.build_id}/artifact`);
  expect(downloaded.status()).toBe(200);
  const artifact = CreationArtifactSchema.parse(await downloaded.json());
  expect(
    artifact.capabilities
      .filter((capability) => capability.experimental)
      .map((capability) => capability.id),
  ).toEqual(["story.conditions", "story.knowing"]);
  await page.screenshot({
    path: info.outputPath("experimental-release-review.png"),
    fullPage: true,
  });
  await checkbox.check();
  await publish.click();
  await expect(dialog.getByRole("heading", { name: "Published 1.0.0", exact: true })).toBeVisible({
    timeout: 90000,
  });
  expect(publications).toEqual([
    { revision: receipt.origin.revision, label: "1.0.0", visibility: "public" },
  ]);
  await dialog.getByRole("link", { name: "View release", exact: true }).click();
  await expect(page.getByText("Experimental capabilities", { exact: true })).toBeVisible();
  const baseURL = info.project.use.baseURL;
  if (!baseURL) throw new Error("Fullstack base URL required");
  const visitor = await browser.newContext({ baseURL });
  try {
    const publicPage = await visitor.newPage();
    await publicPage.goto(`/c/${ns}/gate?v=1.0.0`);
    await expect(
      publicPage.getByRole("heading", { name: "The Experimental Gate", exact: true }),
    ).toBeVisible();
    await expect(publicPage.getByText("Experimental capabilities", { exact: true })).toBeVisible();
    await publicPage.screenshot({
      path: info.outputPath("experimental-release-reader.png"),
      fullPage: true,
    });
  } finally {
    await visitor.close();
  }
});
