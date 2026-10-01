/** A local fixed candidate exercises review/apply/persistence; no online model is called. */
import { readFile } from "node:fs/promises";
import { DraftSchema } from "@char-pub/contracts";
import { canonicalizeCreation, checkCreation } from "@char-pub/core";
import { expect, test } from "@playwright/test";
import { z } from "zod";
import { signInAs } from "./fullstack/session";

test.skip(!process.env.E2E_FULLSTACK, "needs the isolated full stack");
test.use({ trace: "off", video: "off", actionTimeout: 15_000 });

const Request = z.object({
  format: z.literal("char.pub/author-assistance-request"),
  version: z.literal(1),
  creation: z.object({ id: z.string(), ref: z.string() }),
  working_digest: z.string(),
  request_digest: z.string(),
  task: z.object({
    kind: z.literal("description"),
    target: z.object({ kind: z.literal("beat"), id: z.literal("arrival") }),
  }),
  input: z.object({
    selected: z.object({ id: z.literal("arrival"), description: z.string() }),
    context: z.string(),
  }),
});

test("reviews a selected local AI candidate without writing, then explicitly applies it with durable agent provenance", async ({
  page,
  context,
}, info) => {
  const ns = `assist-${Date.now().toString(36)}`;
  const ref = `@${ns}/gate`;
  const base = `/v1/creations/${ref}`;
  const original = "A traveler pauses outside the gate.";
  const candidateDescription = "The traveler offers a lantern as a sign of peace.";
  await signInAs(context, "Local assistance author");
  await page.goto("/");
  const headers = { origin: new URL(page.url()).origin };
  expect(
    (await page.request.post("/v1/namespaces", { headers, data: { slug: ns } })).status(),
  ).toBe(201);
  expect(
    (
      await page.request.post(`/v1/namespaces/${ns}/creations`, {
        headers,
        data: { name: "gate", type: "scenario", display_name: "The lantern gate" },
      })
    ).status(),
  ).toBe(201);
  const initial = DraftSchema.parse(await (await page.request.get(`${base}/draft`)).json());
  const working = {
    ...(initial.working as object),
    fragments: [
      {
        id: "private-setting",
        kind: "scenario",
        stable: true,
        content: { type: "text", text: "UNSELECTED_PRIVATE_SETTING_MUST_NOT_BE_EXPORTED" },
      },
    ],
    cast: [{ key: "player", who: { late: "persona" } }],
    story: {
      version: 1,
      scenes: [{ id: "gate", title: "The gate", beats: ["arrival"] }],
      beats: [{ id: "arrival", title: "A visitor arrives", description: original }],
    },
  };
  const checked = canonicalizeCreation(working);
  expect(checkCreation(checked.creation).ok).toBe(true);
  expect(
    (
      await page.request.put(`${base}/draft`, {
        headers: { ...headers, "if-match": String(initial.version) },
        data: { working },
      })
    ).status(),
  ).toBe(200);
  await page.goto(`/c/${ns}/gate/edit`);
  await page.getByText("Draft with your chosen AI service", { exact: true }).click();
  const assistance = page
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "Draft with your chosen AI service" }) });
  await assistance.getByLabel("Drafting task", { exact: true }).selectOption("description");
  await assistance.getByLabel("Object to draft", { exact: true }).selectOption("beat:arrival");
  await assistance
    .getByLabel("What should the service draft?", { exact: true })
    .fill("Give this change a clear, short description.");
  await assistance
    .getByLabel("Selected context, sentence or plot summary", { exact: true })
    .fill("The traveler wants a peaceful meeting.");
  await assistance.getByRole("button", { name: "Prepare request for review", exact: true }).click();
  const requestSection = assistance.getByRole("region", {
    name: "Assistance request",
    exact: true,
  });
  const displayed = await requestSection
    .getByLabel("Complete request JSON", { exact: true })
    .inputValue();
  const request = Request.parse(JSON.parse(displayed));
  expect(request.creation.ref).toBe(ref);
  expect(request.input.selected.description).toBe(original);
  expect(displayed).not.toContain("UNSELECTED_PRIVATE_SETTING_MUST_NOT_BE_EXPORTED");
  const downloading = page.waitForEvent("download");
  await requestSection
    .getByRole("button", { name: "Download reviewed input", exact: true })
    .click();
  const download = await downloading;
  const file = await download.path();
  if (!file) throw new Error("The reviewed request was not downloaded");
  expect(await readFile(file, "utf8")).toBe(displayed);

  const candidate = {
    format: "char.pub/author-assistance-candidate",
    version: 1,
    creation_id: request.creation.id,
    working_digest: request.working_digest,
    request_digest: request.request_digest,
    output: { description: candidateDescription },
  };
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && new URL(request.url()).pathname === `${base}/draft`) writes++;
  });
  const before = DraftSchema.parse(await (await page.request.get(`${base}/draft`)).json());
  await requestSection.getByLabel("Candidate JSON file", { exact: true }).setInputFiles({
    name: "fixed-candidate.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(candidate)),
  });
  await requestSection
    .getByRole("button", { name: "Review candidate changes", exact: true })
    .click();
  const review = assistance.getByRole("region", {
    name: "Assistance candidate review",
    exact: true,
  });
  await expect(review).toContainText(original);
  await expect(review).toContainText(candidateDescription);
  const reviewed = DraftSchema.parse(await (await page.request.get(`${base}/draft`)).json());
  expect(reviewed.version).toBe(before.version);
  expect(reviewed.working).toEqual(before.working);
  expect(writes).toBe(0);
  await review.screenshot({ path: info.outputPath("local-candidate-reviewed.png") });
  const saving = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" && new URL(response.url()).pathname === `${base}/draft`,
  );
  await review.getByRole("button", { name: "Apply reviewed candidate", exact: true }).click();
  expect((await saving).status()).toBe(200);
  const saved = DraftSchema.parse(await (await page.request.get(`${base}/draft`)).json());
  const canonical = canonicalizeCreation(saved.working).creation;
  expect(canonical.story?.beats?.find((beat) => beat.id === "arrival")?.description).toBe(
    candidateDescription,
  );
  expect(canonical.provenance?.authored_by_agent).toBe(true);
  expect(checkCreation(canonical).ok).toBe(true);
  await page.reload();
  const restored = canonicalizeCreation(
    DraftSchema.parse(await (await page.request.get(`${base}/draft`)).json()).working,
  ).creation;
  expect(restored.story?.beats?.find((beat) => beat.id === "arrival")?.description).toBe(
    candidateDescription,
  );
  expect(restored.provenance?.authored_by_agent).toBe(true);
  await expect(page.getByText(/This draft includes agent-assisted content/)).toBeVisible();
  await page.screenshot({ path: info.outputPath("local-candidate-saved.png"), fullPage: true });

  // The downloaded request belongs to its original draft snapshot; it is not silently rebased after Apply.
  await page.getByText("Draft with your chosen AI service", { exact: true }).click();
  await assistance.getByLabel("Object to draft", { exact: true }).selectOption("beat:arrival");
  await assistance
    .getByLabel("What should the service draft?", { exact: true })
    .fill("Describe the next peaceful moment.");
  await assistance.getByRole("button", { name: "Prepare request for review", exact: true }).click();
  await assistance.getByLabel("Candidate JSON file", { exact: true }).setInputFiles({
    name: "stale-candidate.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(candidate)),
  });
  const countBeforeReject = writes;
  await assistance.getByRole("button", { name: "Review candidate changes", exact: true }).click();
  await expect(assistance.getByRole("alert")).toBeVisible();
  await expect(
    assistance.getByRole("button", { name: "Apply reviewed candidate", exact: true }),
  ).toHaveCount(0);
  expect(writes).toBe(countBeforeReject);
  expect(DraftSchema.parse(await (await page.request.get(`${base}/draft`)).json()).version).toBe(
    saved.version,
  );
});
