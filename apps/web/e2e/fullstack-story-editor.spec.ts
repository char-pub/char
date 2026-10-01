/** Real Story authoring, saved draft, worker-built artifact and browser context preparation. */
import { DraftBuildResponseSchema } from "@char-pub/contracts";
import { CreationArtifactSchema } from "@char-pub/core";
import { expect, test } from "@playwright/test";
import { signInAs } from "./fullstack/session";

test.skip(!process.env.E2E_FULLSTACK, "needs the isolated full stack");
test.use({ actionTimeout: 15_000 });

test("authors scenes, an opening, a change and an ending before a private draft preview", async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];
  const logs: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => logs.push(`${message.type()}: ${message.text()}`));
  const ns = `story-${Date.now().toString(36)}`;
  const base = `/v1/creations/@${ns}/lantern-inn`;
  const situation = "The copper lantern flickers as rain closes the mountain road.";
  const greeting = "You reach the inn just before midnight.";
  await signInAs(context, "Story Workspace Author");
  try {
    await page.goto("/create");
    await page.getByLabel("Namespace").fill(ns);
    await page.getByRole("button", { name: `Register @${ns}` }).click();
    await page.getByRole("radio", { name: /^Scenario/ }).check();
    await page.getByLabel("Name", { exact: true }).fill("Lantern Inn");
    await page.getByRole("button", { name: "Create scenario", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/c/${ns}/lantern-inn/edit$`));
    await page.getByRole("button", { name: "Add first scene", exact: true }).click();
    await page.getByLabel("Scene scene title", { exact: true }).fill("Midnight lobby");
    await page.getByLabel("Time for scene", { exact: true }).fill("Midnight");
    await page.getByLabel("Place description for scene", { exact: true }).fill("The roadside inn");
    await page.getByLabel("Opening situation for scene", { exact: true }).fill(situation);
    // Registry's Scenario seed contains one runtime player. Its binding is supplied in Preview below.
    await expect(page.getByLabel("player present in scene")).toBeChecked();
    await page.getByText("player: part and goals", { exact: true }).click();
    await page.getByLabel("player part across the story (scene)").fill("A guest seeking shelter");
    await page.getByRole("button", { name: "Add opening", exact: true }).click();
    await page.getByLabel("Opening start title").fill("Arrive before the storm");
    await page.getByLabel("Scene for start", { exact: true }).selectOption("scene");
    await page.getByLabel("First message source for start").selectOption("inline");
    await page.getByLabel("Authored opening template for start").fill(greeting);

    const development = page.getByRole("region", { name: "Story development", exact: true });
    await development.getByText("Possible changes", { exact: true }).click();
    await development.getByRole("button", { name: "Add change", exact: true }).click();
    const change = development.getByRole("group", { name: /^change ·/ });
    await change.getByLabel("change title").fill("The guest earns trust");
    await change
      .getByLabel("What happens", { exact: true })
      .fill("The innkeeper shares the spare room.");
    await change.getByLabel("Midnight lobby", { exact: true }).check();
    await development.getByText("Endings", { exact: true }).click();
    await development.getByRole("button", { name: "Add ending", exact: true }).click();
    const ending = development.getByRole("group", { name: /^ending ·/ });
    await ending.getByLabel("ending title").fill("The road opens");
    await ending
      .getByLabel("What happens", { exact: true })
      .fill("The travelers leave when the rain stops.");
    await ending.getByLabel("After this ending").selectOption("continue");
    await page.getByRole("button", { name: "Add scene", exact: true }).click();
    await page.getByLabel("Scene scene-2 title").fill("Morning road");
    await page.getByRole("tab", { name: "Plotlines", exact: true }).click();
    await page.getByRole("button", { name: "Add plotline", exact: true }).click();
    await page.getByLabel("Plotline title").fill("The guest's journey");
    const ordered = development.getByRole("list", { name: "The guest's journey scenes" });
    await ordered.getByRole("checkbox", { name: "Morning road", exact: true }).check();
    await ordered
      .getByRole("button", { name: "Move Morning road in The guest's journey up" })
      .focus();
    await page.keyboard.press("Enter");
    await expect(ordered.getByRole("listitem").first()).toContainText("Morning road");
    await expect(
      ordered.getByRole("button", { name: "Move Morning road in The guest's journey up" }),
    ).toBeDisabled();
    await expect(page.getByText("All changes saved", { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    await page.reload();
    await expect(page.getByLabel("Scene scene title", { exact: true })).toHaveValue(
      "Midnight lobby",
    );
    await expect(page.getByLabel("Opening situation for scene", { exact: true })).toHaveValue(
      situation,
    );
    await expect(page.getByLabel("Authored opening template for start")).toHaveValue(greeting);
    await expect(page.getByLabel("change title")).toHaveValue("The guest earns trust");
    await expect(page.getByLabel("ending title")).toHaveValue("The road opens");
    await expect(change.getByLabel("Midnight lobby", { exact: true })).toBeChecked();
    await page.getByRole("tab", { name: "Plotlines", exact: true }).click();
    await expect(ordered.getByRole("listitem").first()).toContainText("Morning road");
    await expect(page.getByRole("tab", { name: "Plotlines", exact: true })).toHaveAttribute(
      "data-variant",
      "default",
    );
    await expect(page.getByRole("tab", { name: "Scenes", exact: true })).toHaveAttribute(
      "data-variant",
      "outline",
    );
    await page
      .getByRole("region", { name: "Story workspace", exact: true })
      .screenshot({ path: info.outputPath("story-plotline-order.png"), animations: "disabled" });
    const requested = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().endsWith(`${base}/draft-builds`),
    );
    await page.getByRole("button", { name: "Build draft preview", exact: true }).click();
    const response = await requested;
    expect(response.status()).toBe(202);
    const receipt = DraftBuildResponseSchema.parse(await response.json());
    const session = page.getByRole("form", { name: "Session settings", exact: true });
    await expect(session).toBeVisible({ timeout: 90_000 });
    await session
      .getByRole("group", { name: /^Role / })
      .getByLabel("Name", { exact: true })
      .fill("Guest");
    const messages = page.getByRole("list", { name: "Assembled messages" });
    await expect(messages).toContainText(situation);
    await expect(messages).toContainText(greeting);
    await expect(messages).not.toContainText("Describe the opening situation.");
    await expect(messages).toContainText("A guest seeking shelter");
    const artifactResponse = await page.request.get(
      `/v1/draft-builds/${receipt.origin.build_id}/artifact`,
    );
    expect(artifactResponse.ok()).toBe(true);
    const artifact = CreationArtifactSchema.parse(await artifactResponse.json());
    expect(artifact.root).toMatchObject({ origin: receipt.origin });
    expect(artifact.root).not.toHaveProperty("release");
    expect(artifact.kind).toBe("content");
    if (artifact.kind !== "content") throw new Error("Expected Story content artifact");
    expect(artifact.story).toMatchObject({
      scenes: [
        {
          id: "scene",
          title: "Midnight lobby",
          time: "Midnight",
          where: "The roadside inn",
          opening: situation,
          beats: ["beat"],
        },
        { id: "scene-2", title: "Morning road" },
      ],
      plotlines: [{ title: "The guest's journey", scenes: ["scene-2", "scene"] }],
      starts: [{ id: "start", scene: "scene", greeting }],
      beats: [{ id: "beat", description: "The innkeeper shares the spare room." }],
      endings: [
        {
          id: "ending",
          after: "continue",
          description: "The travelers leave when the rain stops.",
        },
      ],
    });
    const creation = await page.request.get(base);
    expect(creation.ok()).toBe(true);
    expect((await creation.json()).releases).toEqual([]);
    await page.screenshot({ path: info.outputPath("story-author-preview.png"), fullPage: true });
    await info.attach("story-artifact", {
      body: JSON.stringify(artifact.story, null, 2),
      contentType: "application/json",
    });
    await info.attach("prepared-messages", {
      body: await messages.innerText(),
      contentType: "text/plain",
    });
    expect(errors).toEqual([]);
  } finally {
    await info.attach("browser-console", { body: logs.join("\n"), contentType: "text/plain" });
    await info.attach("browser-errors", { body: errors.join("\n"), contentType: "text/plain" });
  }
});
