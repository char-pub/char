/** Real saved Story → private dbld → actual opening history → author source navigation. */
import { DraftBuildResponseSchema } from "@char-pub/contracts";
import { CreationArtifactSchema } from "@char-pub/core";
import { expect, test } from "@playwright/test";
import { signInAs } from "./fullstack/session";

test.skip(!process.env.E2E_FULLSTACK, "needs the isolated full stack");
test.use({ actionTimeout: 15000, trace: "off", video: "off" });

test("distinguishes scene context from the first message and locates only the current saved opening source", async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const ns = `opening-${Date.now().toString(36)}`;
  const base = `/v1/creations/@${ns}/two-arrivals`;
  const firstScene = "SCENE_CONTEXT_ONLY: a bell hangs above the closed door.";
  const secondScene = "SECOND_SCENE_CONTEXT: lamps illuminate the garden path.";
  const greeting = "GREETING_OVERRIDE: welcome to the garden, traveler.";
  const revised = "REVISED_GREETING: please follow the lanterns.";
  await signInAs(context, "Opening Source Author");
  await page.goto("/create");
  await page.getByLabel("Namespace").fill(ns);
  await page.getByRole("button", { name: `Register @${ns}` }).click();
  await page.getByRole("radio", { name: /^Scenario/ }).check();
  await page.getByLabel("Name", { exact: true }).fill("Two Arrivals");
  await page.getByRole("button", { name: "Create scenario", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${ns}/two-arrivals/edit$`));
  await page.getByRole("button", { name: "Add first scene", exact: true }).click();
  await page.getByLabel("Scene scene title", { exact: true }).fill("Closed door");
  await page.getByLabel("Opening situation for scene", { exact: true }).fill(firstScene);
  await page.getByRole("button", { name: "Add scene", exact: true }).click();
  await page.getByLabel("Scene scene-2 title", { exact: true }).fill("Garden path");
  await page.getByLabel("Opening situation for scene-2", { exact: true }).fill(secondScene);
  await page.getByRole("button", { name: "Add opening", exact: true }).click();
  await page.getByLabel("Opening start title", { exact: true }).fill("Silent arrival");
  await page
    .getByLabel("Opening start description", { exact: true })
    .fill("Arrive at the closed door without a greeting.");
  await page.getByLabel("Scene for start", { exact: true }).selectOption("scene");
  await page.getByRole("button", { name: "Add opening", exact: true }).click();
  await page.getByLabel("Opening start-2 title", { exact: true }).fill("Garden welcome");
  await page
    .getByLabel("Opening start-2 description", { exact: true })
    .fill("Meet the host at the garden path.");
  await page.getByLabel("Scene for start-2", { exact: true }).selectOption("scene-2");
  await page.getByLabel("First message source for start-2", { exact: true }).selectOption("inline");
  const source = page.getByLabel("Authored opening template for start-2", { exact: true });
  await source.fill(greeting);
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.reload();
  await expect(source).toHaveValue(greeting);

  const requested = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().endsWith(`${base}/draft-builds`),
  );
  await page.getByRole("button", { name: "Build draft preview", exact: true }).click();
  const response = await requested;
  expect(response.status()).toBe(202);
  const receipt = DraftBuildResponseSchema.parse(await response.json());
  const session = page.getByRole("form", { name: "Session settings", exact: true });
  await expect(session).toBeVisible({ timeout: 90000 });
  await session
    .getByRole("group", { name: /^Role / })
    .getByLabel("Name", { exact: true })
    .fill("Guest");
  const opening = page.getByRole("region", { name: "First player-facing message", exact: true });
  const messages = page.getByRole("list", { name: "Assembled messages", exact: true });
  await expect(messages).toContainText(firstScene);
  await expect(opening).toContainText("This opening has no player-facing message.");
  await expect(opening).not.toContainText(firstScene);
  await expect(
    opening.getByRole("button", { name: "Edit message source", exact: true }),
  ).toHaveCount(0);
  await expect(messages).not.toContainText(greeting);
  await page.screenshot({
    path: info.outputPath("scene-context-without-message.png"),
    fullPage: true,
  });

  await page.getByRole("combobox", { name: "Story opening", exact: true }).selectOption("start-2");
  await expect(opening).toContainText(greeting);
  await expect(opening).toContainText("Opening template: start-2");
  await expect(messages).toContainText(secondScene);
  await expect(messages).not.toContainText(firstScene);
  const greetingMessage = messages.getByRole("listitem").filter({ hasText: greeting });
  await expect(greetingMessage).toHaveCount(1);
  await expect(greetingMessage).toContainText(/\d+\. assistant/);
  await expect(opening).not.toContainText(secondScene);
  await page.getByRole("tab", { name: "Plotlines", exact: true }).click();
  await expect(source).not.toBeVisible();
  await opening.getByRole("button", { name: "Edit message source", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Scenes", exact: true })).toHaveAttribute(
    "data-variant",
    "default",
  );
  await expect(source).toBeFocused();
  await expect(source).toHaveValue(greeting);
  await page.screenshot({ path: info.outputPath("opening-source-focused.png"), fullPage: true });

  // This changes the working definition, not the immutable artifact that generated the old message.
  await source.fill(revised);
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(
    opening.getByRole("button", { name: "Edit message source", exact: true }),
  ).toBeDisabled();
  await expect(opening).toContainText(greeting);
  await expect(opening).not.toContainText(revised);
  await page.screenshot({
    path: info.outputPath("stale-opening-source-disabled.png"),
    fullPage: true,
  });

  const artifactResponse = await page.request.get(
    `/v1/draft-builds/${receipt.origin.build_id}/artifact`,
  );
  expect(artifactResponse.ok()).toBe(true);
  const artifact = CreationArtifactSchema.parse(await artifactResponse.json());
  expect(artifact.root).toMatchObject({ origin: receipt.origin });
  expect(artifact.root).not.toHaveProperty("release");
  if (artifact.kind !== "content") throw new Error("Expected content artifact");
  expect(artifact.story?.starts).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: "start-2", greeting })]),
  );
  expect(artifact.story?.starts?.find((start) => start.id === "start")).not.toHaveProperty(
    "greeting",
  );
  const latest = await page.request.get(`${base}/draft`);
  expect(latest.ok()).toBe(true);
  expect((await latest.json()).working.story.starts).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: "start-2", greeting: revised })]),
  );
  const detail = await page.request.get(base);
  expect(detail.ok()).toBe(true);
  expect((await detail.json()).releases).toEqual([]);
  expect(errors).toEqual([]);
});
