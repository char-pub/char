/** Real author workflow: upload a Source, create a dbld, and inspect actual prepared messages. */

import { DraftBuildResponseSchema } from "@char-pub/contracts";
import { expect, test } from "@playwright/test";
import { signInAs } from "./fullstack/session";

test.skip(!process.env.E2E_FULLSTACK, "needs the isolated full stack");
test.use({ actionTimeout: 15000 });

test("organizes groups, generates sections, replaces a file and previews the saved section", async ({
  page,
  context,
}, info) => {
  const consoleEntries: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => consoleEntries.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const ns = `draft-${Date.now().toString(36)}`;
  const title = "Courier route notes";
  const sourceText = "The silver lantern marks the replacement entrance.";
  const original = Buffer.from(
    "\uFEFF# Door\r\nThe old entrance.\r\n# Cellar\r\nAn old cellar.\r\n",
    "utf8",
  );
  const replacement = Buffer.from(
    `\uFEFF# Door\r\n${sourceText}\r\n# Cellar\r\nThe cellar remains. e\u0301  \r\n`,
    "utf8",
  );
  await signInAs(context, "Draft Preview Author");
  try {
    await page.goto("/create");
    await page.getByLabel("Namespace").fill(ns);
    await page.getByRole("button", { name: `Register @${ns}` }).click();
    await page.getByRole("radio", { name: /^World/ }).check();
    await page.getByLabel("Name", { exact: true }).fill("Source Courier");
    await page.getByRole("button", { name: "Create world" }).click();
    await expect(page).toHaveURL(new RegExp(`/c/${ns}/source-courier/edit$`));
    await page
      .getByLabel("About this world", { exact: true })
      .fill("A courier looking for a safe delivery route.");
    const library = page.getByRole("region", { name: "Content groups", exact: true });
    await library.getByRole("button", { name: "New group", exact: true }).click();
    await library.getByLabel("New group title").fill("Buildings");
    await library.getByLabel("New group description").fill("The inn and its surroundings.");
    await library.getByRole("button", { name: "Create group", exact: true }).click();
    await library.getByLabel("Include entry world").check();
    const documents = page.getByRole("region", { name: "Reference documents", exact: true });
    await documents.getByLabel("Reference file").setInputFiles({
      name: "courier-notes.md",
      mimeType: "text/markdown",
      buffer: original,
    });
    await documents.getByLabel("Document title", { exact: true }).fill(title);
    await documents
      .getByLabel("Document description", { exact: true })
      .fill("Directions to the post office entrance.");
    await documents.getByRole("button", { name: "Upload reference", exact: true }).click();
    await expect(
      documents.getByText("Document added. Build a draft preview to check and use it."),
    ).toBeVisible({ timeout: 60_000 });
    await documents.getByText("Sections for courier-notes", { exact: true }).click();
    await documents.getByText("Check a local file or generate headings", { exact: true }).click();
    await documents
      .getByLabel("Local file for courier-notes", { exact: true })
      .setInputFiles({ name: "original.md", mimeType: "text/markdown", buffer: original });
    await expect(
      documents.getByText("Local file matches the current asset. Nothing was uploaded."),
    ).toBeVisible();
    await documents
      .getByRole("button", {
        name: "Preview sections from headings for courier-notes",
        exact: true,
      })
      .click();
    await expect(
      documents.getByRole("region", { name: "Proposed sections for courier-notes" }),
    ).toContainText("#Door");
    await documents
      .getByRole("button", { name: "Add generated sections to courier-notes", exact: true })
      .click();
    await documents
      .getByLabel("Description for courier-notes/door", { exact: true })
      .fill("Directions for arriving visitors.");
    await documents.getByText("Replace file for courier-notes", { exact: true }).click();
    await documents
      .getByLabel("Replacement file for courier-notes", { exact: true })
      .setInputFiles({ name: "updated.md", mimeType: "text/markdown", buffer: replacement });
    await documents.getByRole("button", { name: "Replace document file", exact: true }).click();
    await expect(
      documents.getByText(/File replaced. Document and section IDs were kept/),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByText("All changes saved", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await page.reload();
    await library.getByRole("button", { name: "Buildings", exact: true }).click();
    await expect(library.getByLabel("Group description", { exact: true })).toHaveValue(
      "The inn and its surroundings.",
    );
    await expect(
      documents.getByLabel("Anchor for courier-notes/door", { exact: true }),
    ).toHaveValue("#Door");
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
    await page.getByRole("checkbox", { name: /Door/ }).check();
    await selected;
    await expect(messages).toContainText(sourceText);
    await page.getByRole("button", { name: "Save preview as author test", exact: true }).click();
    await expect(
      page.getByText(
        "Saved author test preview. Run author tests to verify it against a new build.",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 30000 });
    const savedDraft = await page.request.get(`${base}/draft`);
    expect(savedDraft.ok()).toBe(true);
    const captured = (await savedDraft.json()).working.assembly_tests[0];
    expect(captured.root).toBe("self");
    expect(captured.preset.release).toMatch(/^rel_/);
    expect(captured.selection).toEqual([
      { source: `@${ns}/source-courier#source/courier-notes~root`, section: "door" },
    ]);
    expect(Object.values(captured.source_texts)).toEqual([replacement.toString("utf8")]);
    const expectedDigest = captured.expected.messages_digest;
    await page.getByRole("button", { name: "Run author tests", exact: true }).click();
    await expect(page.getByRole("list", { name: "Author test results" })).toContainText(
      "Passed: preview",
      { timeout: 90000 },
    );
    const afterRun = (await (await page.request.get(`${base}/draft`)).json()).working
      .assembly_tests[0];
    expect(afterRun.expected.messages_digest).toBe(expectedDigest);
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
    expect(artifact.catalog_index.groups).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: "Buildings" })]),
    );
    expect(artifact.catalog_index.sources[0].sections).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "door", anchor: "#Door" })]),
    );
    await expect(messages).not.toContainText("The old entrance.");
    expect(artifact.root).not.toHaveProperty("release");
    await page.screenshot({
      path: info.outputPath("content-library-section-preview.png"),
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
