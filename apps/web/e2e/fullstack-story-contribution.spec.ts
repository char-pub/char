/** Public Story source → object edits → local preview → three-way merge into an unpublished draft. */
import { DraftSchema } from "@char-pub/contracts";
import { canonicalizeCreation } from "@char-pub/core";
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

test("a Story proposal previews locally and merges with a newer scene field without publishing", async ({
  page: owner,
  context,
  browser,
}, info) => {
  const baseURL = info.project.use.baseURL;
  if (!baseURL) throw new Error("Fullstack baseURL is required");
  const contributorContext = await browser.newContext({ baseURL });
  const contributor = await contributorContext.newPage();
  const errors: string[] = [];
  const logs: string[] = [];
  for (const [label, page] of [
    ["owner", owner],
    ["contributor", contributor],
  ] as const) {
    page.on("pageerror", (error) => errors.push(`${label}: ${error.message}`));
    page.on("console", (message) => logs.push(`${label}/${message.type()}: ${message.text()}`));
  }
  const ns = `story-proposal-${Date.now().toString(36)}`;
  const base = `/v1/creations/@${ns}/inn`;
  const proposedOpening = "The contributor lights the copper lantern beside the door.";
  const ownerTime = "The owner moves the scene to midnight.";
  try {
    await signInAs(context, "Story Proposal Owner");
    await signInAs(contributorContext, "Story Proposal Contributor");
    await owner.goto("/");
    expect((await call(owner, "POST", "/v1/namespaces", { slug: ns })).status).toBe(201);
    expect(
      (
        await call(owner, "POST", `/v1/namespaces/${ns}/creations`, {
          name: "inn",
          type: "scenario",
          display_name: "Lantern Inn",
        })
      ).status,
    ).toBe(201);
    const initial = DraftSchema.parse((await call(owner, "GET", `${base}/draft`)).body);
    const working = {
      ...(initial.working as object),
      fragments: [
        {
          id: "setting",
          stable: true,
          kind: "scenario",
          content: {
            type: "text",
            text: "Rain has closed the mountain road.",
          },
        },
      ],
      cast: [{ key: "player", who: { late: "persona" }, part: "A traveler seeking shelter" }],
      story: {
        version: 1,
        scenes: [
          {
            id: "hall",
            title: { en: "Hall", de: "Halle" },
            time: "Evening",
            opening: "The original lantern is unlit.",
            cast: ["player"],
          },
        ],
        starts: [{ id: "arrival", scene: "hall", greeting: "Welcome to the inn." }],
      },
      meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
    };
    expect(
      (
        await call(
          owner,
          "PUT",
          `${base}/draft`,
          { working },
          {
            "if-match": String(initial.version),
          },
        )
      ).status,
    ).toBe(200);
    const revisionResponse = await call(owner, "POST", `${base}/revisions`, {});
    expect(revisionResponse.status).toBeLessThan(300);
    const revision = revisionResponse.body as { id: string };
    expect(
      (
        await call(
          owner,
          "POST",
          `${base}/releases`,
          {
            revision: revision.id,
            label: "1.0.0",
            visibility: "public",
          },
          { "idempotency-key": ns },
        )
      ).status,
    ).toBeLessThan(300);
    await expect
      .poll(
        async () => {
          const report = await call(owner, "GET", `${base}/releases/1.0.0/report`);
          return (report.body as { state: string }).state;
        },
        { timeout: 60_000 },
      )
      .toBe("active");
    const beforeDetail = (await call(owner, "GET", base)).body as { releases: { id: string }[] };
    const releases = beforeDetail.releases.map((release) => release.id);
    expect(releases).toHaveLength(1);

    await contributor.goto(`/c/${ns}/inn`);
    expect((await call(contributor, "GET", `${base}/draft`)).status).toBe(404);
    await contributor.getByRole("link", { name: "Contributions", exact: true }).click();
    await contributor.getByRole("link", { name: "Propose a change", exact: true }).click();
    await contributor.getByLabel("Opening situation for hall").fill(proposedOpening);
    const development = contributor.getByRole("region", { name: "Story development", exact: true });
    await development.getByText("Endings", { exact: true }).click();
    await development.getByRole("button", { name: "Add ending", exact: true }).click();
    const ending = development.getByRole("group", { name: /^ending ·/ });
    await ending.getByLabel("ending title").fill("The storm passes");
    await ending.getByLabel("What happens", { exact: true }).fill("The traveler leaves at dawn.");
    const preview = contributor.getByRole("region", { name: "Proposal preview", exact: true });
    await preview.getByRole("button", { name: "Preview proposed changes", exact: true }).click();
    await expect(
      preview.getByRole("form", { name: "Session settings", exact: true }),
    ).toBeVisible();
    await preview
      .getByRole("group", { name: /^Role / })
      .getByLabel("Name", { exact: true })
      .fill("Guest");
    await expect(preview.getByRole("list", { name: "Assembled messages" })).toContainText(
      proposedOpening,
    );
    await expect(preview.getByText(/This is a local proposal preview/)).toBeVisible();
    await contributor.screenshot({
      path: info.outputPath("story-proposal-local-preview.png"),
      fullPage: true,
    });
    const unchanged = DraftSchema.parse((await call(owner, "GET", `${base}/draft`)).body);
    expect(canonicalizeCreation(unchanged.working).creation.story?.scenes[0]?.opening).toBe(
      "The original lantern is unlit.",
    );

    await contributor
      .getByLabel("Title", { exact: true })
      .fill("Light the lantern and add a hopeful ending");
    await contributor.getByLabel(/I license my contribution under CC-BY-4.0/).check();
    const submitted = contributor.waitForRequest(
      (request) => request.method() === "POST" && request.url().endsWith(`${base}/contributions`),
    );
    await contributor.getByRole("button", { name: /^Submit \d+ changes?$/ }).click();
    expect((await submitted).postDataJSON()).toMatchObject({ changes_version: 1 });
    await expect(contributor).toHaveURL(new RegExp(`/c/${ns}/inn/contributions/1$`));
    await expect(
      contributor.getByRole("heading", { name: "Light the lantern and add a hopeful ending" }),
    ).toBeVisible();
    await expect(
      contributor.getByRole("region", { name: "Proposal preview", exact: true }),
    ).toHaveCount(0);

    const authorDraft = DraftSchema.parse((await call(owner, "GET", `${base}/draft`)).body);
    const concurrent = canonicalizeCreation(authorDraft.working).creation;
    if (!concurrent.story?.scenes[0]) throw new Error("The published scene is missing");
    concurrent.story.scenes[0].time = ownerTime;
    expect(
      (
        await call(
          owner,
          "PUT",
          `${base}/draft`,
          { working: concurrent },
          {
            "if-match": String(authorDraft.version),
          },
        )
      ).status,
    ).toBe(200);
    await owner.goto(`/c/${ns}/inn/contributions/1`);
    const sceneReview = owner.getByRole("listitem", {
      name: "Scene hall: will apply",
      exact: true,
    });
    await expect(sceneReview).toBeVisible();
    const appliedScene = sceneReview.getByText("After:", { exact: true }).locator("..");
    await expect(appliedScene).toContainText(ownerTime);
    await expect(appliedScene).toContainText(proposedOpening);
    await expect(appliedScene).not.toContainText('"Evening"');
    const mergedPreview = owner.getByRole("region", { name: "Proposal preview", exact: true });
    await mergedPreview
      .getByRole("button", { name: "Preview proposed changes", exact: true })
      .click();
    await expect(
      mergedPreview.getByRole("form", { name: "Session settings", exact: true }),
    ).toBeVisible();
    await mergedPreview
      .getByRole("group", { name: /^Role / })
      .getByLabel("Name", { exact: true })
      .fill("Guest");
    const mergedMessages = mergedPreview.getByRole("list", { name: "Assembled messages" });
    await expect(mergedMessages).toContainText(proposedOpening);
    await expect(mergedMessages).toContainText(ownerTime);
    await owner.screenshot({
      path: info.outputPath("story-proposal-merged-preview.png"),
      fullPage: true,
    });
    await owner.getByRole("button", { name: "Accept into the draft", exact: true }).click();
    await expect(owner.getByRole("heading", { name: "Accepted", exact: true })).toBeVisible();
    const accepted = canonicalizeCreation(
      DraftSchema.parse((await call(owner, "GET", `${base}/draft`)).body).working,
    ).creation;
    expect(accepted.story?.scenes[0]).toMatchObject({
      opening: proposedOpening,
      time: ownerTime,
      title: { en: "Hall", de: "Halle" },
    });
    expect(accepted.story?.endings).toEqual([
      expect.objectContaining({
        title: "The storm passes",
        description: "The traveler leaves at dawn.",
      }),
    ]);
    const afterDetail = (await call(owner, "GET", base)).body as { releases: { id: string }[] };
    expect(afterDetail.releases.map((release) => release.id)).toEqual(releases);
    expect(errors).toEqual([]);
  } finally {
    await info.attach("browser-console", { body: logs.join("\n"), contentType: "text/plain" });
    await info.attach("browser-errors", { body: errors.join("\n"), contentType: "text/plain" });
    await contributorContext.close();
  }
});
