/** U1: choose two real published Characters in the UI, write one scene, preview and publish it. */
import {
  CreationDetailSchema,
  DraftBuildResponseSchema,
  DraftSchema,
  RevisionSchema,
} from "@char-pub/contracts";
import {
  type CreationArtifact,
  CreationArtifactSchema,
  canonicalizeCreation,
} from "@char-pub/core";
import { expect, type Page, test } from "@playwright/test";
import { signInAs } from "./fullstack/session";

test.skip(!process.env.E2E_FULLSTACK, "needs the isolated full stack");
test.use({ actionTimeout: 15000, trace: "off", video: "off" });

async function publishedCharacter(page: Page, ns: string, name: string, text: string) {
  const origin = new URL(page.url()).origin;
  const ref = `@${ns}/${name}`;
  const base = `/v1/creations/${ref}`;
  const created = await page.request.post(`/v1/namespaces/${ns}/creations`, {
    headers: { origin },
    data: { name, type: "character", display_name: name === "alice" ? "Alice" : "Bob" },
  });
  expect(created.status()).toBe(201);
  const draftResponse = await page.request.get(`${base}/draft`);
  expect(draftResponse.ok()).toBe(true);
  const draft = DraftSchema.parse(await draftResponse.json());
  const saved = await page.request.put(`${base}/draft`, {
    headers: { origin, "if-match": `"${draft.version}"` },
    data: {
      working: {
        ...(draft.working as object),
        fragments: [
          { id: "description", kind: "character", stable: true, content: { type: "text", text } },
        ],
        meta: { default_locale: "en", rating: "general", rights: "original", license: "CC0-1.0" },
      },
    },
  });
  expect(saved.ok()).toBe(true);
  const revisionResponse = await page.request.post(`${base}/revisions`, {
    headers: { origin },
    data: {},
  });
  expect(revisionResponse.ok()).toBe(true);
  const revision = RevisionSchema.parse(await revisionResponse.json());
  const published = await page.request.post(`${base}/releases`, {
    headers: { origin, "idempotency-key": `u1-${ns}-${name}` },
    data: { revision: revision.id, label: "1.0.0", visibility: "public" },
  });
  expect(published.ok()).toBe(true);
  await expect
    .poll(
      async () => {
        const report = await page.request.get(`${base}/releases/1.0.0/report`);
        expect(report.ok()).toBe(true);
        return (await report.json()).state;
      },
      { timeout: 60000 },
    )
    .toBe("active");
  const detailResponse = await page.request.get(base);
  expect(detailResponse.ok()).toBe(true);
  const release = CreationDetailSchema.parse(await detailResponse.json()).releases.find(
    (r) => r.label === "1.0.0",
  );
  if (!release) throw new Error("Published Character release missing");
  return { ref, release: release.id, semantic_digest: release.semantic_digest, text };
}

test("chooses Alice and Bob from exact releases, writes one open scene and publishes the composed Scenario", async ({
  page,
  context,
  browser,
}, info) => {
  const ns = `u1-${Date.now().toString(36)}`;
  const name = "alice-and-bob";
  const ref = `@${ns}/${name}`;
  const base = `/v1/creations/${ref}`;
  const scene = "The station closes at midnight. Alice asks Bob to explain the unopened letter.";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signInAs(context, "Two-character Story Author");
  await page.goto("/");
  expect(
    (
      await page.request.post("/v1/namespaces", {
        headers: { origin: new URL(page.url()).origin },
        data: { slug: ns },
      })
    ).status(),
  ).toBe(201);
  // Only published Character setup uses the API. Scenario cast/dependencies are created exclusively by UI.
  const characters = [
    await publishedCharacter(
      page,
      ns,
      "alice",
      "ALICE_CANONICAL_BODY: Alice is a courier carrying an unopened letter.",
    ),
    await publishedCharacter(
      page,
      ns,
      "bob",
      "BOB_CANONICAL_BODY: Bob is a station keeper who remembers every traveler.",
    ),
  ];
  await page.goto("/create");
  await page.getByRole("radio", { name: /^Scenario/ }).check();
  await page.getByLabel("Name", { exact: true }).fill("Alice and Bob");
  await page.getByRole("button", { name: "Create scenario", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${ns}/${name}/edit$`));
  await page.getByRole("button", { name: "Choose characters", exact: true }).click();
  const picker = page.getByRole("group", { name: "Add a published cast member", exact: true });
  await expect(picker).toBeVisible();
  for (const character of characters) {
    await picker
      .getByLabel("Add a published cast member address", { exact: true })
      .fill(character.ref);
    await picker.getByRole("button", { name: "Look up", exact: true }).click();
    await picker
      .getByLabel("Add a published cast member version", { exact: true })
      .selectOption(character.release);
    await picker.getByRole("button", { name: "Use version", exact: true }).click();
    await expect(
      page.getByRole("combobox", {
        name: `Binding for ${character.ref.split("/")[1]}`,
        exact: true,
      }),
    ).toHaveValue(character.ref);
  }
  // Keep the ordinary user slot, but the authored cast of this scene is exactly Alice and Bob.
  await page
    .locator("#edit-cast-player")
    .getByRole("button", { name: "Remove cast member", exact: true })
    .click();
  await page.getByRole("button", { name: "Add first scene", exact: true }).click();
  await page.getByLabel("Scene scene title", { exact: true }).fill("The last train");
  await page.getByLabel("Opening situation for scene", { exact: true }).fill(scene);
  await expect(page.getByLabel("alice present in scene", { exact: true })).toBeChecked();
  await expect(page.getByLabel("bob present in scene", { exact: true })).toBeChecked();
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.reload();
  await expect(page.getByLabel("Opening situation for scene", { exact: true })).toHaveValue(scene);
  const draftResponse = await page.request.get(`${base}/draft`);
  expect(draftResponse.ok()).toBe(true);
  const working = canonicalizeCreation(
    DraftSchema.parse(await draftResponse.json()).working,
  ).creation;
  expect(working.cast?.map((member) => ({ key: member.key, who: member.who }))).toEqual(
    characters.map((character) => ({ key: character.ref.split("/")[1], who: character.ref })),
  );
  for (const character of characters)
    expect(working.references).toContainEqual(
      expect.objectContaining({
        use: character.ref,
        pin: { release: character.release, semantic_digest: character.semantic_digest },
      }),
    );
  expect(working.story?.vars).toBeUndefined();
  expect(working.story?.scenes[0]?.when).toBeUndefined();

  const requested = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().endsWith(`${base}/draft-builds`),
  );
  await page.getByRole("button", { name: "Build draft preview", exact: true }).click();
  const buildResponse = await requested;
  expect(buildResponse.status()).toBe(202);
  const receipt = DraftBuildResponseSchema.parse(await buildResponse.json());
  const messages = page.getByRole("list", { name: "Assembled messages", exact: true });
  await expect(messages).toContainText(scene, { timeout: 90000 });
  for (const character of characters) {
    await expect(messages).toContainText(character.text);
    expect((await messages.innerText()).split(character.text).length - 1).toBe(1);
  }
  const builtResponse = await page.request.get(
    `/v1/draft-builds/${receipt.origin.build_id}/artifact`,
  );
  expect(builtResponse.ok()).toBe(true);
  const draftArtifact = CreationArtifactSchema.parse(await builtResponse.json());
  expect(draftArtifact.root).toMatchObject({ origin: receipt.origin });
  const checkComposition = (artifact: CreationArtifact) => {
    if (artifact.kind !== "content") throw new Error("Scenario content artifact required");
    expect(
      artifact.ir.participants.flatMap((p) => (p.cast_key ? [p.cast_key] : [])).sort(),
    ).toEqual(["alice", "bob"]);
    expect(artifact.story?.scenes).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "scene", opening: scene })]),
    );
    for (const character of characters) {
      expect(artifact.lock).toContainEqual(
        expect.objectContaining({
          ref: character.ref,
          release: character.release,
          semantic_digest: character.semantic_digest,
        }),
      );
      const fragments = artifact.ir.fragments.filter(
        (f) => f.origin.creation === character.ref && f.origin.fragment === "description",
      );
      expect(fragments).toHaveLength(1);
      expect(fragments[0]?.origin).toMatchObject({ release: character.release });
    }
  };
  checkComposition(draftArtifact);
  await page.screenshot({ path: info.outputPath("alice-bob-private-preview.png"), fullPage: true });

  await page.getByRole("button", { name: "Publish…", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Version label", { exact: true })).toHaveValue("1.0.0");
  await dialog.getByRole("button", { name: "Publish 1.0.0", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Published 1.0.0", exact: true })).toBeVisible({
    timeout: 90000,
  });
  await page.screenshot({ path: info.outputPath("alice-bob-published.png"), fullPage: true });
  const detailResponse = await page.request.get(base);
  expect(detailResponse.ok()).toBe(true);
  const release = CreationDetailSchema.parse(await detailResponse.json()).releases.find(
    (r) => r.label === "1.0.0",
  );
  expect(release).toMatchObject({ status: "active", visibility: "public" });
  if (!release) throw new Error("Published Scenario missing");
  const baseURL = info.project.use.baseURL;
  if (!baseURL) throw new Error("Fullstack baseURL required");
  const anonymous = await browser.newContext({ baseURL });
  try {
    const visitor = await anonymous.newPage();
    await visitor.goto(`/c/${ns}/${name}?v=1.0.0`);
    await expect(
      visitor.getByRole("heading", { name: "Alice and Bob", exact: true }),
    ).toBeVisible();
    const artifactResponse = await visitor.request.get(`/v1/releases/${release.id}/artifact`);
    expect(artifactResponse.ok()).toBe(true);
    const publishedArtifact = CreationArtifactSchema.parse(await artifactResponse.json());
    expect(publishedArtifact.root).toMatchObject({ ref, release: release.id });
    expect(publishedArtifact.root).not.toHaveProperty("origin");
    checkComposition(publishedArtifact);
    await visitor.goto(`/c/${ns}/${name}/preview?v=1.0.0`);
    const publicMessages = visitor.getByRole("list", { name: "Assembled messages", exact: true });
    await expect(publicMessages).toContainText(scene);
    for (const character of characters) await expect(publicMessages).toContainText(character.text);
    await visitor.screenshot({
      path: info.outputPath("alice-bob-public-preview.png"),
      fullPage: true,
    });
  } finally {
    await anonymous.close();
  }
  expect(errors).toEqual([]);
});
