/** W5: create and publish a Character inside Scenario casting, then reuse its exact release. */
import { CreationDetailSchema, DraftSchema, FavoritesResponseSchema } from "@char-pub/contracts";
import { canonicalizeCreation } from "@char-pub/core";
import { expect, test } from "@playwright/test";
import { signInAs } from "./fullstack/session";

test.skip(!process.env.E2E_FULLSTACK, "needs the isolated full stack");
test.use({ actionTimeout: 15000, trace: "off", video: "off" });

test("creates, explicitly publishes and selects a character, then reselects its exact release from Favorites", async ({
  page,
  context,
}, info) => {
  test.setTimeout(180000);
  const ns = `cast-${Date.now().toString(36)}`;
  const scenario = `/v1/creations/@${ns}/lighthouse-story`;
  const characterRef = `@${ns}/mira`;
  const character = `/v1/creations/${characterRef}`;
  const introduction = "Mira keeps the lighthouse and remembers every ship that visits.";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signInAs(context, "Casting Author");
  await page.goto("/");
  const namespace = await page.request.post("/v1/namespaces", {
    headers: { origin: new URL(page.url()).origin },
    data: { slug: ns },
  });
  expect(namespace.status()).toBe(201);

  // Only login/namespace use setup APIs. Both creations and Character publication use the UI.
  await page.goto("/create");
  await page.getByRole("radio", { name: /^Scenario/ }).check();
  await page.getByLabel("Name", { exact: true }).fill("Lighthouse story");
  await page.getByRole("button", { name: "Create scenario", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${ns}/lighthouse-story/edit$`));
  await page.getByRole("button", { name: "Choose characters", exact: true }).click();
  const picker = page.getByRole("group", { name: "Add a published cast member", exact: true });
  await picker.getByRole("button", { name: "Create a character here", exact: true }).click();
  await picker.getByLabel("New character name", { exact: true }).fill("Mira");
  await picker.getByLabel("New character introduction", { exact: true }).fill(introduction);
  await picker.getByLabel("Character rating", { exact: true }).selectOption("general");
  await picker.getByLabel("Character rights", { exact: true }).selectOption("original");
  await picker.getByLabel("Character license", { exact: true }).selectOption("CC-BY-4.0");
  await picker.getByRole("button", { name: "Create character draft", exact: true }).click();
  const created = picker.getByRole("region", { name: "Created character", exact: true });
  await expect(created).toContainText(`Saved draft ${characterRef}`);
  await expect(created.getByLabel("Created character introduction", { exact: true })).toHaveValue(
    introduction,
  );
  const before = CreationDetailSchema.parse(await (await page.request.get(character)).json());
  expect(before.releases).toEqual([]);
  await expect(page.getByRole("combobox", { name: "Binding for mira", exact: true })).toHaveCount(
    0,
  );
  await expect(
    created.getByRole("button", { name: "Use published character", exact: true }),
  ).toHaveCount(0);

  await created.getByRole("button", { name: "Review and publish character", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const publish = dialog.getByRole("button", { name: "Publish 1.0.0", exact: true });
  await expect(publish).toBeEnabled({ timeout: 60000 });
  // Preparing a reviewed build has not published anything or inserted a cast member.
  expect(
    CreationDetailSchema.parse(await (await page.request.get(character)).json()).releases,
  ).toEqual([]);
  await publish.click();
  await expect(dialog.getByRole("heading", { name: "Published 1.0.0", exact: true })).toBeVisible({
    timeout: 90000,
  });
  await dialog.getByRole("button", { name: "Back to editor", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const published = CreationDetailSchema.parse(await (await page.request.get(character)).json());
  const release = published.releases.find((entry) => entry.label === "1.0.0");
  expect(release).toMatchObject({ status: "active", visibility: "public" });
  if (!release) throw new Error("Published character missing");
  await expect(page.getByRole("combobox", { name: "Binding for mira", exact: true })).toHaveCount(
    0,
  );
  await created
    .getByRole("combobox", { name: "Published character version", exact: true })
    .selectOption(release.id);
  await created.getByRole("button", { name: "Use published character", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Binding for mira", exact: true })).toHaveValue(
    characterRef,
  );
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible({
    timeout: 30000,
  });

  async function assertPersistedCast() {
    const response = await page.request.get(`${scenario}/draft`);
    expect(response.ok()).toBe(true);
    const working = canonicalizeCreation(DraftSchema.parse(await response.json()).working).creation;
    expect(working.cast?.filter((member) => member.who === characterRef)).toEqual([
      expect.objectContaining({ key: "mira", who: characterRef }),
    ]);
    expect(working.references?.filter((reference) => reference.use === characterRef)).toEqual([
      expect.objectContaining({
        use: characterRef,
        pin: { release: release?.id, semantic_digest: release?.semantic_digest },
      }),
    ]);
  }
  await page.reload();
  await page.getByRole("button", { name: "Choose characters", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Binding for mira", exact: true })).toHaveValue(
    characterRef,
  );
  await assertPersistedCast();
  await picker
    .getByLabel("Add a published cast member address", { exact: true })
    .fill(characterRef);
  await picker.getByRole("button", { name: "Look up", exact: true }).click();
  await picker.getByRole("button", { name: "Save to favorites", exact: true }).click();
  await expect(picker.getByRole("status")).toContainText(`${characterRef} saved to Favorites.`);
  const favoritesResponse = await page.request.get("/v1/me/favorites");
  expect(favoritesResponse.ok()).toBe(true);
  expect(FavoritesResponseSchema.parse(await favoritesResponse.json()).items).toContainEqual(
    expect.objectContaining({
      ref: characterRef,
      latest_release: expect.objectContaining({ id: release.id }),
    }),
  );
  await page
    .locator("#edit-cast-mira")
    .getByRole("button", { name: "Remove cast member", exact: true })
    .click();
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.reload();
  await page.getByRole("button", { name: "Choose characters", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Binding for mira", exact: true })).toHaveCount(
    0,
  );
  await picker.getByRole("button", { name: "Favorites", exact: true }).click();
  await picker.getByRole("button", { name: `Mira · ${characterRef}`, exact: true }).click();
  await expect(
    picker.getByLabel("Add a published cast member version", { exact: true }),
  ).toHaveValue("");
  await expect(picker.getByRole("button", { name: "Use version", exact: true })).toBeDisabled();
  await picker
    .getByLabel("Add a published cast member version", { exact: true })
    .selectOption(release.id);
  await picker.getByRole("button", { name: "Use version", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Binding for mira", exact: true })).toHaveValue(
    characterRef,
  );
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.reload();
  await page.getByRole("button", { name: "Choose characters", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Binding for mira", exact: true })).toHaveValue(
    characterRef,
  );
  await assertPersistedCast();
  await page.screenshot({ path: info.outputPath("created-character-cast.png"), fullPage: true });
  expect(errors).toEqual([]);
});
