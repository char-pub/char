/** UI-authored rules, real saved definition/build, and browser-only Core rehearsal. */
import { DraftBuildResponseSchema } from "@char-pub/contracts";
import { CreationArtifactSchema } from "@char-pub/core";
import { expect, test } from "@playwright/test";
import { signInAs } from "./fullstack/session";

test.skip(!process.env.E2E_FULLSTACK, "needs the isolated full stack");
test.use({ actionTimeout: 15_000 });

test("authors state and rules, rehearses a confirmed change once, and stops at a conditional ending", async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];
  const logs: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => logs.push(`${message.type()}: ${message.text()}`));
  const ns = `rules-${Date.now().toString(36)}`;
  const base = `/v1/creations/@${ns}/promise-at-the-inn`;
  const greeting = "A traveler waits beside the locked front door.";
  await signInAs(context, "Story Rules Author");
  try {
    await page.goto("/create");
    await page.getByLabel("Namespace").fill(ns);
    await page.getByRole("button", { name: `Register @${ns}` }).click();
    await page.getByRole("radio", { name: /^Scenario/ }).check();
    await page.getByLabel("Name", { exact: true }).fill("Promise at the Inn");
    await page.getByRole("button", { name: "Create scenario", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/c/${ns}/promise-at-the-inn/edit$`));
    await page.getByRole("button", { name: "Add first scene", exact: true }).click();
    await page.getByLabel("Scene scene title").fill("The locked door");
    await page
      .getByLabel("Opening situation for scene")
      .fill("The host asks the traveler to promise to return the key.");
    await page.getByRole("button", { name: "Add opening", exact: true }).click();
    await page.getByLabel("Opening start title").fill("Arrive at the inn");
    await page.getByLabel("Opening start description").fill("Begin outside the locked front door.");
    await page.getByLabel("Scene for start", { exact: true }).selectOption("scene");
    await page.getByLabel("First message source for start", { exact: true }).selectOption("inline");
    await page.getByLabel("Authored opening template for start").fill(greeting);

    const state = page.getByRole("region", { name: "Story state", exact: true });
    await state.getByText("Variables", { exact: true }).click();
    await state.getByRole("button", { name: "Add variable", exact: true }).click();
    const variable = state.getByRole("group", { name: "Variable variable", exact: true });
    await variable
      .getByLabel("Description for variable", { exact: true })
      .fill("How many promises the traveler has made.");
    await variable.getByLabel("Type for variable").selectOption("int");
    await variable.getByLabel("Minimum for variable", { exact: true }).fill("0");
    await variable.getByLabel("Maximum for variable", { exact: true }).fill("2");
    await variable.getByLabel("Initial value for variable", { exact: true }).fill("0");

    const development = page.getByRole("region", { name: "Story development", exact: true });
    await development.getByText("Possible changes", { exact: true }).click();
    await development.getByRole("button", { name: "Add change", exact: true }).click();
    const change = development.getByRole("group", { name: /^change ·/ });
    await change.getByLabel("change title", { exact: true }).fill("Promise accepted");
    await change
      .getByLabel("What happens", { exact: true })
      .fill("The host trusts the traveler with the key.");
    await change.getByLabel("The locked door", { exact: true }).check();
    await change.getByText("When can this happen?", { exact: true }).click();
    const changeCondition = change.getByRole("region", {
      name: "Condition for change beat",
      exact: true,
    });
    await changeCondition.getByLabel("Add condition", { exact: true }).selectOption("judge");
    await changeCondition
      .getByLabel("Rule condition description", { exact: true })
      .fill("Did the traveler promise to return the key?");
    await change.getByText("Effects after confirmation", { exact: true }).click();
    const changeEffects = change.getByRole("region", {
      name: "Effects for change beat",
      exact: true,
    });
    await changeEffects.getByLabel("Add effect", { exact: true }).selectOption("add");
    await changeEffects
      .getByLabel("Effect 1 variable", { exact: true })
      .selectOption("var/variable");
    await changeEffects.getByLabel("Effect 1 amount", { exact: true }).fill("1");

    await development.getByText("Endings", { exact: true }).click();
    await development.getByRole("button", { name: "Add ending", exact: true }).click();
    const ending = development.getByRole("group", { name: /^ending ·/ });
    await ending.getByLabel("ending title", { exact: true }).fill("The door opens");
    await ending
      .getByLabel("What happens", { exact: true })
      .fill("The traveler enters the inn and this story ends.");
    await ending.getByLabel("After this ending").selectOption("stop");
    await ending.getByText("When can this happen?", { exact: true }).click();
    const endingCondition = ending.getByRole("region", {
      name: "Condition for ending ending",
      exact: true,
    });
    await endingCondition.getByLabel("Add condition", { exact: true }).selectOption("cmp");
    await endingCondition
      .getByLabel("Rule integer variable", { exact: true })
      .selectOption("var/variable");
    await endingCondition.getByLabel("Rule comparison", { exact: true }).selectOption(">=");
    await endingCondition.getByLabel("Rule compare with", { exact: true }).fill("1");
    await expect(page.getByText("All changes saved", { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    await page.reload();
    await expect(variable.getByLabel("Type for variable")).toHaveValue("int");
    await expect(variable.getByLabel("Maximum for variable", { exact: true })).toHaveValue("2");
    await expect(
      changeCondition.getByLabel("Rule condition description", { exact: true }),
    ).toHaveValue("Did the traveler promise to return the key?");
    await expect(changeEffects.getByLabel("Effect 1 amount", { exact: true })).toHaveValue("1");
    await expect(endingCondition.getByLabel("Rule compare with", { exact: true })).toHaveValue("1");

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
    await expect(page.getByRole("list", { name: "Assembled messages" })).toContainText(greeting);

    await page.getByText("Check story logic", { exact: true }).click();
    const results = page.getByRole("list", { name: "Story condition results", exact: true });
    const variables = page.locator('dl[aria-label="Preview variables"]');
    const confirmChange = results.getByRole("button", {
      name: "Confirm Promise accepted",
      exact: true,
    });
    const confirmEnding = results.getByRole("button", {
      name: "Confirm The door opens",
      exact: true,
    });
    await expect(variables.locator("dd")).toHaveText("0");
    await expect(confirmChange).toBeDisabled();
    await expect(confirmEnding).toBeDisabled();
    const judgment = page.getByLabel("Judge beat/beat/when", { exact: true });
    await judgment.selectOption("false");
    await expect(results).toContainText("Promise accepted · Condition false");
    await expect(confirmChange).toBeDisabled();
    await judgment.selectOption("true");
    await expect(confirmChange).toBeEnabled();
    await confirmChange.click();
    await expect(variables.locator("dd")).toHaveText("1");
    await expect(confirmChange).toBeDisabled();
    await expect(results).toContainText("Already reached");
    await expect(confirmEnding).toBeEnabled();
    await confirmEnding.click();
    await expect(
      page.getByText("Current scene: scene · Story stopped", { exact: true }),
    ).toBeVisible();
    await expect(confirmEnding).toBeDisabled();
    await expect(confirmChange).toBeDisabled();
    await expect(variables.locator("dd")).toHaveText("1");

    const artifactResponse = await page.request.get(
      `/v1/draft-builds/${receipt.origin.build_id}/artifact`,
    );
    expect(artifactResponse.ok()).toBe(true);
    const artifact = CreationArtifactSchema.parse(await artifactResponse.json());
    expect(artifact.root).toMatchObject({ origin: receipt.origin });
    expect(artifact.root).not.toHaveProperty("release");
    if (artifact.kind !== "content") throw new Error("Expected Story artifact");
    expect(artifact.story).toMatchObject({
      vars: {
        variable: {
          type: "int",
          init: 0,
          min: 0,
          max: 2,
          description: "How many promises the traveler has made.",
        },
      },
      beats: [
        {
          id: "beat",
          when: { judge: "Did the traveler promise to return the key?" },
          effects: [{ add: ["var/variable", 1] }],
        },
      ],
      endings: [{ id: "ending", when: { cmp: ["var/variable", ">=", 1] } }],
    });
    expect(artifact.story?.endings?.[0]?.after ?? "stop").toBe("stop");
    const creation = await page.request.get(base);
    expect(creation.ok()).toBe(true);
    expect((await creation.json()).releases).toEqual([]);
    await info.attach("story-rules-artifact", {
      body: JSON.stringify(artifact.story, null, 2),
      contentType: "application/json",
    });
    await info.attach("rehearsal-results", {
      body: await results.innerText(),
      contentType: "text/plain",
    });
    await page.screenshot({ path: info.outputPath("story-rules-stopped.png"), fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await info.attach("browser-console", { body: logs.join("\n"), contentType: "text/plain" });
    await info.attach("browser-errors", { body: errors.join("\n"), contentType: "text/plain" });
  }
});
