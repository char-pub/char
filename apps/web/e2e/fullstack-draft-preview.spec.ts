/** Real author workflow: upload a Source, create a dbld, and inspect actual prepared messages. */

import { DraftBuildResponseSchema } from "@char-pub/contracts";
import { expect, test } from "@playwright/test";
import { signInAs } from "./fullstack/session";

test.skip(!process.env.E2E_FULLSTACK, "needs the isolated full stack");

test("creates a private draft preview with a selected uploaded Source without publishing", async ({
  page,
  context,
}, info) => {
  const consoleEntries: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => consoleEntries.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const ns = `draft-${Date.now().toString(36)}`;
  const title = "Courier route notes";
  const sourceText = "The copper lantern marks the safe entrance to the old post office.";
  await signInAs(context, "Draft Preview Author");
  try {
    await page.goto("/create");
    await page.getByLabel("Namespace").fill(ns);
    await page.getByRole("button", { name: `Register @${ns}` }).click();
    await page.getByLabel("Name", { exact: true }).fill("Source Courier");
    await page.getByRole("button", { name: "Create character" }).click();
    await expect(page).toHaveURL(new RegExp(`/c/${ns}/source-courier/edit$`));
    await page
      .getByLabel("Description", { exact: true })
      .fill("A courier looking for a safe delivery route.");
    const documents = page.getByRole("region", { name: "Reference documents", exact: true });
    await documents.getByLabel("Reference file").setInputFiles({
      name: "courier-notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(`\uFEFF${sourceText}\r\n`, "utf8"),
    });
    await documents.getByLabel("Document title", { exact: true }).fill(title);
    await documents
      .getByLabel("Document description", { exact: true })
      .fill("Directions to the post office entrance.");
    await documents.getByRole("button", { name: "Upload reference", exact: true }).click();
    await expect(
      documents.getByText("Document added. Build a draft preview to check and use it."),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("All changes saved", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    const base = `/v1/creations/@${ns}/source-courier`;
    const before = await page.request.get(base);
    expect(before.ok()).toBe(true);
    expect((await before.json()).releases).toEqual([]);

    const requested = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().endsWith(`${base}/draft-builds`),
    );
    await page.getByRole("button", { name: "Build draft preview", exact: true }).click();
    const response = await requested;
    expect(response.status()).toBe(202);
    const receipt = DraftBuildResponseSchema.parse(await response.json());
    expect(receipt.origin.kind).toBe("draft-build");
    expect(receipt.origin.build_id).toMatch(/^dbld_/);
    expect(receipt.origin.revision).toMatch(/^rev_/);
    expect(receipt).not.toHaveProperty("release");
    await expect(
      page.getByRole("heading", { name: "Prepared model messages, in order" }),
    ).toBeVisible({ timeout: 90_000 });
    const messages = page.getByRole("list", { name: "Assembled messages" });
    await expect(messages).not.toContainText(sourceText);
    const selected = page.waitForResponse(
      (reply) =>
        reply.url().includes(`/v1/draft-builds/${receipt.origin.build_id}/source-text?`) &&
        reply.status() === 200,
    );
    await page.getByRole("checkbox", { name: new RegExp(title) }).check();
    await selected;
    await expect(messages).toContainText(sourceText);
    const after = await page.request.get(base);
    expect(after.ok()).toBe(true);
    expect((await after.json()).releases).toEqual([]);
    const status = await page.request.get(`/v1/draft-builds/${receipt.origin.build_id}`);
    expect(status.ok()).toBe(true);
    expect(DraftBuildResponseSchema.parse(await status.json())).toMatchObject({
      state: "ready",
      origin: receipt.origin,
    });
    const artifactResponse = await page.request.get(
      `/v1/draft-builds/${receipt.origin.build_id}/artifact`,
    );
    expect(artifactResponse.ok()).toBe(true);
    const artifact = await artifactResponse.json();
    expect(artifact.root.origin).toEqual(receipt.origin);
    expect(artifact.root).not.toHaveProperty("release");
    await page.screenshot({
      path: info.outputPath("draft-source-prepared-messages.png"),
      fullPage: true,
    });
    await info.attach("prepared-messages", {
      body: await messages.innerText(),
      contentType: "text/plain",
    });
    expect(pageErrors).toEqual([]);
  } finally {
    await info.attach("browser-console", {
      body: consoleEntries.join("\n"),
      contentType: "text/plain",
    });
    await info.attach("browser-errors", { body: pageErrors.join("\n"), contentType: "text/plain" });
  }
});
