/** Exact published source → another author's Remix/sequel → saved draft → real worker artifact. */
import { DraftBuildResponseSchema, DraftSchema } from "@char-pub/contracts";
import { CreationArtifactSchema, canonicalizeCreation } from "@char-pub/core";
import { expect, type Page, test } from "@playwright/test";
import { signInAs } from "./fullstack/session";

test.skip(!process.env.E2E_FULLSTACK, "needs the isolated full stack");
test.use({ actionTimeout: 15_000 });

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
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
    },
    { method, path, body, headers },
  );
}

test("remixes and continues an exact Scenario without duplicating its roles or continuing a player save", async ({
  page: sourceAuthor,
  context,
  browser,
}, info) => {
  const baseURL = info.project.use.baseURL;
  if (!baseURL) throw new Error("Fullstack baseURL required");
  const creatorContext = await browser.newContext({ baseURL });
  const creator = await creatorContext.newPage();
  const errors: string[] = [];
  const logs: string[] = [];
  for (const [label, page] of [
    ["source", sourceAuthor],
    ["creator", creator],
  ] as const) {
    page.on("pageerror", (error) => errors.push(`${label}: ${error.message}`));
    page.on("console", (message) => logs.push(`${label}/${message.type()}: ${message.text()}`));
  }
  const suffix = Date.now().toString(36);
  const sourceNs = `derive-source-${suffix}`;
  const targetNs = `derive-writer-${suffix}`;
  const sourceRef = `@${sourceNs}/inn`;
  const sourceBase = `/v1/creations/${sourceRef}`;
  const knowledge = "The old copper key opens the mountain shelter.";
  const oldGreeting = "OLD_STORY_GREETING: the storm has only just begun.";
  try {
    await signInAs(context, "Original Story Author");
    await signInAs(creatorContext, "Remix Story Author");
    await sourceAuthor.goto("/");
    await creator.goto("/");
    expect((await call(sourceAuthor, "POST", "/v1/namespaces", { slug: sourceNs })).status).toBe(
      201,
    );
    expect((await call(creator, "POST", "/v1/namespaces", { slug: targetNs })).status).toBe(201);
    expect(
      (
        await call(sourceAuthor, "POST", `/v1/namespaces/${sourceNs}/creations`, {
          name: "inn",
          type: "scenario",
          display_name: "Original Inn",
        })
      ).status,
    ).toBe(201);
    const initial = DraftSchema.parse(
      (await call(sourceAuthor, "GET", `${sourceBase}/draft`)).body,
    );
    const definition = {
      ...(initial.working as object),
      fragments: [
        {
          id: "premise",
          kind: "scenario",
          stable: true,
          content: { type: "text", text: "Two travelers are sheltering from a storm." },
        },
        {
          id: "guide",
          kind: "knowledge",
          stable: true,
          activation: { mode: "manual" },
          content: { type: "text", text: knowledge },
        },
      ],
      cast: [
        { key: "host", who: { late: "character" }, part: "The shelter keeper" },
        { key: "traveler", who: { late: "persona" }, part: "A traveler seeking shelter" },
      ],
      story: {
        version: 1,
        vars: {
          road_open: {
            type: "bool",
            init: false,
            description: "Whether the mountain road is open",
          },
        },
        scenes: [
          {
            id: "old-hall",
            title: "Original hall",
            cast: ["host", "traveler"],
            lore: ["#guide"],
            opening: "The original storm blocks the road.",
          },
        ],
        starts: [{ id: "old-arrival", scene: "old-hall", greeting: oldGreeting }],
        beats: [{ id: "old-trust", title: "Old trust", description: "The travelers earn trust." }],
        endings: [
          {
            id: "road-opens",
            title: "The road opens",
            description: "The mountain road becomes safe.",
            effects: [{ set: ["var/road_open", true] }],
          },
        ],
      },
      meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
    };
    expect(
      (
        await call(
          sourceAuthor,
          "PUT",
          `${sourceBase}/draft`,
          { working: definition },
          { "if-match": String(initial.version) },
        )
      ).status,
    ).toBe(200);
    const revision = await call(sourceAuthor, "POST", `${sourceBase}/revisions`, {});
    expect(revision.status).toBeLessThan(300);
    const revisionData = revision.body as { id: string; semantic_digest: string };
    expect(
      (
        await call(
          sourceAuthor,
          "POST",
          `${sourceBase}/releases`,
          { revision: revisionData.id, label: "1.0.0", visibility: "public" },
          { "idempotency-key": suffix },
        )
      ).status,
    ).toBeLessThan(300);
    await expect
      .poll(
        async () =>
          (await call(sourceAuthor, "GET", `${sourceBase}/releases/1.0.0/report`)).body as {
            state: string;
          },
        { timeout: 60_000 },
      )
      .toMatchObject({ state: "active" });
    const sourceDetail = (await call(sourceAuthor, "GET", sourceBase)).body as {
      releases: { id: string; label: string; semantic_digest: string }[];
    };
    const sourceRelease = sourceDetail.releases.find((release) => release.label === "1.0.0");
    if (!sourceRelease) throw new Error("Published source missing");

    for (const kind of ["remix", "sequel"] as const) {
      await creator.goto(`/c/${sourceNs}/inn?v=1.0.0`);
      await creator
        .getByRole("button", { name: kind === "remix" ? "Remix" : "Create sequel", exact: true })
        .click();
      const dialog = creator.getByRole("dialog", {
        name: kind === "remix" ? "Remix this creation" : "Create a sequel",
        exact: true,
      });
      await expect(dialog.getByText(`${sourceRef}@1.0.0`, { exact: true })).toBeVisible();
      await dialog
        .getByLabel("New title", { exact: true })
        .fill(kind === "remix" ? "My Mountain Inn" : "After the Mountain Storm");
      const name = kind === "remix" ? "my-inn" : "after-storm";
      await dialog.getByLabel("New address", { exact: true }).fill(name);
      if (kind === "sequel") {
        await expect(dialog.getByText(/not a player's saved session/)).toBeVisible();
        await dialog
          .getByRole("combobox", { name: /^Ending to continue from/ })
          .selectOption("road-opens");
      }
      const create = dialog.getByRole("button", {
        name: kind === "remix" ? "Create remix draft" : "Create sequel draft",
        exact: true,
      });
      await expect(create).toBeDisabled();
      await dialog.getByRole("checkbox", { name: /I confirm I can adapt/ }).check();
      const request = creator.waitForRequest(
        (r) => r.method() === "POST" && r.url().endsWith(`/v1/namespaces/${targetNs}/derivations`),
      );
      await create.click();
      const posted = (await request).postDataJSON() as Record<string, unknown>;
      expect(posted).not.toHaveProperty("working");
      expect(posted.source).toEqual({
        ref: sourceRef,
        release: sourceRelease.id,
        semantic_digest: sourceRelease.semantic_digest,
      });
      await expect(creator).toHaveURL(new RegExp(`/c/${targetNs}/${name}/edit$`));
      const newBase = `/v1/creations/@${targetNs}/${name}`;
      const first = DraftSchema.parse((await call(creator, "GET", `${newBase}/draft`)).body);
      const canonical = canonicalizeCreation(first.working).creation;
      expect(canonical.cast?.map((role) => role.key)).toEqual(["host", "traveler"]);
      expect(canonical.fragments.find((fragment) => fragment.id === "guide")?.content).toEqual({
        type: "text",
        text: knowledge,
      });
      expect(canonical.provenance.derived_from).toContainEqual({
        ref: sourceRef,
        release: sourceRelease.id,
        semantic_digest: sourceRelease.semantic_digest,
        relation: kind,
      });
      const firstScene = canonical.story?.starts?.[0]?.scene ?? canonical.story?.scenes[0]?.id;
      if (!firstScene) throw new Error("Derived story has no opening scene");
      const authoredOpening =
        kind === "remix"
          ? "MY_REMIX_OPENING: the lantern shines green."
          : "MY_SEQUEL_OPENING: travelers set out on the reopened road.";
      await creator
        .getByLabel(`Opening situation for ${firstScene}`, { exact: true })
        .fill(authoredOpening);
      await expect(creator.getByText("All changes saved", { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await creator.reload();
      await expect(
        creator.getByLabel(`Opening situation for ${firstScene}`, { exact: true }),
      ).toHaveValue(authoredOpening);
      const requested = creator.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith(`${newBase}/draft-builds`),
      );
      await creator.getByRole("button", { name: "Build draft preview", exact: true }).click();
      const response = await requested;
      expect(response.status()).toBe(202);
      const receipt = DraftBuildResponseSchema.parse(await response.json());
      const session = creator.getByRole("form", { name: "Session settings", exact: true });
      await expect(session).toBeVisible({ timeout: 90_000 });
      const roles = session.getByRole("group", { name: /^Role / });
      await expect(roles).toHaveCount(2);
      await roles.nth(0).getByLabel("Name", { exact: true }).fill("Keeper");
      await roles.nth(1).getByLabel("Name", { exact: true }).fill("Guest");
      const messages = creator.getByRole("list", { name: "Assembled messages" });
      await expect(messages).toContainText(authoredOpening);
      if (kind === "sequel") {
        await expect(messages).not.toContainText(oldGreeting);
        await expect(messages).not.toContainText(knowledge);
      } else {
        await expect(messages).toContainText(knowledge);
      }
      const artifactResponse = await creator.request.get(
        `/v1/draft-builds/${receipt.origin.build_id}/artifact`,
      );
      expect(artifactResponse.status()).toBe(200);
      const artifact = CreationArtifactSchema.parse(await artifactResponse.json());
      if (artifact.kind !== "content") throw new Error("Expected content artifact");
      const guide = artifact.ir.fragments.find((fragment) => fragment.origin.fragment === "guide");
      if (!guide) throw new Error("Copied manual knowledge is missing from the artifact");
      expect(guide.activation.mode).toBe("manual");
      expect(artifact.catalog_index.works.flatMap((work) => work.fragments)).toContain(guide.id);
      expect(artifact.root).toMatchObject({ ref: `@${targetNs}/${name}`, origin: receipt.origin });
      expect(artifact.lock).toContainEqual(
        expect.objectContaining({
          ref: sourceRef,
          release: sourceRelease.id,
          semantic_digest: sourceRelease.semantic_digest,
        }),
      );
      expect(
        artifact.ir.participants.filter(
          (participant) => participant.late && participant.key !== "user",
        ),
      ).toHaveLength(2);
      expect(
        artifact.ir.participants
          .flatMap((participant) => (participant.cast_key ? [participant.cast_key] : []))
          .sort(),
      ).toEqual(["host", "traveler"]);
      expect(
        artifact.ir.fragments.filter((fragment) => fragment.origin.creation === sourceRef),
      ).toHaveLength(0);
      expect(artifact.ir.graph.instances.some((instance) => instance.ref === sourceRef)).toBe(
        false,
      );
      if (kind === "sequel") {
        expect(artifact.story?.scenes[0]?.lore ?? []).toEqual([]);
        expect(artifact.story?.scenes.map((scene) => scene.id)).not.toContain("old-hall");
        expect(artifact.story?.beats ?? []).toEqual([]);
        expect(artifact.story?.endings ?? []).toEqual([]);
        expect(artifact.story?.starts).toEqual([
          expect.objectContaining({ id: "continuation", set: [{ set: ["var/road_open", true] }] }),
        ]);
        expect(artifact.story?.starts?.[0]).not.toHaveProperty("greeting");
      } else {
        expect(artifact.story?.scenes[0]?.id).toBe("old-hall");
        expect(artifact.story?.endings?.[0]?.id).toBe("road-opens");
      }
      await creator.getByText("Check story logic", { exact: true }).click();
      const variables = creator.locator('dl[aria-label="Preview variables"]');
      await expect(variables).toContainText("road_open");
      await expect(variables).toContainText(kind === "sequel" ? "true" : "false");
      await creator.screenshot({
        path: info.outputPath(`${kind}-draft-prepared.png`),
        fullPage: true,
      });
      await creator.locator("#edit-draft-preview").screenshot({
        path: info.outputPath(`${kind}-messages-and-state.png`),
        animations: "disabled",
      });
      const derivedDetail = (await call(creator, "GET", newBase)).body as { releases: unknown[] };
      expect(derivedDetail.releases).toEqual([]);
    }
    const original = canonicalizeCreation(
      DraftSchema.parse((await call(sourceAuthor, "GET", `${sourceBase}/draft`)).body).working,
    ).creation;
    expect(original.story?.scenes[0]?.opening).toBe("The original storm blocks the road.");
    expect(original.story?.starts?.[0]?.greeting).toBe(oldGreeting);
    expect(errors).toEqual([]);
  } finally {
    await info.attach("browser-console", { body: logs.join("\n"), contentType: "text/plain" });
    await info.attach("browser-errors", { body: errors.join("\n"), contentType: "text/plain" });
    await creatorContext.close();
  }
});
