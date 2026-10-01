/** Author editable discovery metadata, fixed selection and resolved about navigation. */
import { DraftBuildResponseSchema } from "@char-pub/contracts";
import { expect, test } from "@playwright/test";
import { signInAs } from "./fullstack/session";

test.skip(!process.env.E2E_FULLSTACK, "needs the isolated full stack");
test.use({ actionTimeout: 15000 });
test("authors a selectable rumor and related entry, saves it, then selects its real context", async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const ns = `about-${Date.now().toString(36)}`;
  const body = "Guests say the north door opens only at dawn.";
  await signInAs(context, "Related Entries Author");
  await page.goto("/create");
  await page.getByLabel("Namespace").fill(ns);
  await page.getByRole("button", { name: `Register @${ns}` }).click();
  await page.getByRole("radio", { name: /^World/ }).check();
  await page.getByLabel("Name", { exact: true }).fill("Door Stories");
  await page.getByRole("button", { name: "Create world", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${ns}/door-stories/edit$`));
  await page
    .getByLabel("About this world", { exact: true })
    .fill("The inn stands beside a quiet road.");
  const library = page.getByRole("region", { name: "Content groups", exact: true });
  await library.getByRole("button", { name: "Add passage", exact: true }).click();
  const rumor = library.getByRole("listitem", { name: "Passage 2", exact: true });
  await rumor.getByLabel("ID", { exact: true }).fill("rumor");
  await rumor.getByLabel("Kind", { exact: true }).selectOption("knowledge");
  await rumor.getByLabel("Text", { exact: true }).fill(body);
  await rumor
    .getByLabel("Passage description (en)", { exact: true })
    .fill("A rumor about the north door and dawn.");
  await rumor.getByLabel("Included", { exact: true }).selectOption("keyword");
  await rumor.getByLabel("Keywords (comma separated)").fill("nevermentionedtrigger");
  await rumor.getByLabel("Keywords (comma separated)").press("Tab");
  await rumor.getByRole("checkbox", { name: "Allow AI selection without a keyword match" }).check();
  await rumor.getByRole("combobox", { name: "Passage perspective" }).selectOption("rumor");
  await rumor.getByText("About and related entries", { exact: true }).click();
  await rumor.getByRole("combobox", { name: "About target for rumor" }).selectOption("#world");
  await rumor.getByRole("button", { name: "View #world", exact: true }).click();
  const world = library.getByRole("listitem", { name: "Passage 1", exact: true });
  await expect(
    world.getByRole("button", { name: "Open related entry rumor", exact: true }),
  ).toBeVisible();
  await world.getByRole("button", { name: "Open related entry rumor", exact: true }).click();
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.reload();
  await expect(rumor.getByRole("combobox", { name: "Passage perspective" })).toHaveValue("rumor");
  await expect(
    rumor.getByRole("checkbox", { name: "Allow AI selection without a keyword match" }),
  ).toBeChecked();
  const base = `/v1/creations/@${ns}/door-stories`;
  const requested = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith(`${base}/draft-builds`),
  );
  await page.getByRole("button", { name: "Build draft preview", exact: true }).click();
  const response = await requested;
  expect(response.status()).toBe(202);
  const receipt = DraftBuildResponseSchema.parse(await response.json());
  const messages = page.getByRole("list", { name: "Assembled messages" });
  await expect(messages).toBeVisible({ timeout: 90000 });
  await expect(messages).not.toContainText(body);
  const optional = page.getByRole("group", { name: "Optional entries", exact: true });
  await expect(optional).toContainText("A rumor about the north door and dawn.");
  await optional.getByRole("checkbox", { name: /rumor/ }).check();
  await expect(messages).toContainText(body);
  await expect(messages).toContainText("传闻：");
  await page.getByText("Related references", { exact: true }).click();
  const related = page.getByRole("list", { name: "Related references", exact: true });
  const targetLink = related.getByRole("link", { name: "world", exact: true });
  const href = await targetLink.getAttribute("href");
  await targetLink.click();
  expect(await page.evaluate(() => document.activeElement?.id)).toBe(href?.slice(1));
  await expect(messages).toContainText(body);
  const artifactReply = await page.request.get(
    `/v1/draft-builds/${receipt.origin.build_id}/artifact`,
  );
  expect(artifactReply.ok()).toBe(true);
  const artifact = await artifactReply.json();
  expect(artifact.catalog_index.about).toEqual([
    {
      from: `@${ns}/door-stories#rumor~root`,
      ref: "#world",
      target: { fragment: `@${ns}/door-stories#world~root` },
    },
  ]);
  expect(
    artifact.ir.fragments.find((f: { id: string }) => f.id.endsWith("#rumor~root")),
  ).toMatchObject({
    description: "A rumor about the north door and dawn.",
    perspective: "rumor",
    selectable: true,
  });
  expect((await (await page.request.get(base)).json()).releases).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: info.outputPath("fragment-about-selected-preview.png"),
    fullPage: true,
  });
  await info.attach("prepared-messages", {
    body: await messages.innerText(),
    contentType: "text/plain",
  });
});
