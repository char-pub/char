/** Real optimistic saves in two browser pages; no mocked drafts or conflict responses. */
import { DraftSchema } from "@char-pub/contracts";
import { expect, type Page, test } from "@playwright/test";
import { signInAs } from "./fullstack/session";

test.skip(!process.env.E2E_FULLSTACK, "needs the isolated full stack");
test.use({ actionTimeout: 15000, trace: "off", video: "off" });

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

function nextSave(page: Page, path: string) {
  return page.waitForResponse(
    (response) => response.request().method() === "PUT" && response.url().endsWith(path),
  );
}

async function readDraft(page: Page, path: string) {
  const result = await call(page, "GET", path);
  expect(result.status).toBe(200);
  return DraftSchema.parse(result.body);
}

const fragment = (id: string, text: string) => ({
  id,
  content: { type: "text", text },
});

test("reapplies separate objects, resolves a shared object, and retains local edits after another real 409", async ({
  page: first,
  context,
}, info) => {
  const second = await context.newPage();
  const errors: string[] = [];
  first.on("pageerror", (error) => errors.push(error.message));
  second.on("pageerror", (error) => errors.push(error.message));
  const ns = `draft-race-${Date.now().toString(36)}`;
  const name = "harbor";
  const base = `/v1/creations/@${ns}/${name}`;
  const path = `${base}/draft`;
  const editorURL = `/c/${ns}/${name}/edit`;
  const description = (page: Page) => page.getByLabel("Description", { exact: true });
  const personality = (page: Page) =>
    page
      .getByRole("listitem", { name: "Passage 2", exact: true })
      .getByLabel("Text", { exact: true });
  const conflict = second.getByRole("region", {
    name: "This draft was changed somewhere else",
    exact: true,
  });
  const comparison = second.getByRole("region", { name: "Changes to review", exact: true });
  const descriptionChoice = comparison.getByRole("group", {
    name: "Passage: description",
    exact: true,
  });
  const personalityChoice = comparison.getByRole("group", {
    name: "Passage: personality",
    exact: true,
  });
  const apply = comparison.getByRole("button", { name: "Apply choices and save", exact: true });
  try {
    await signInAs(context, "Two-page Draft Author");
    await first.goto("/");
    expect((await call(first, "POST", "/v1/namespaces", { slug: ns })).status).toBe(201);
    expect(
      (
        await call(first, "POST", `/v1/namespaces/${ns}/creations`, {
          name,
          type: "character",
          display_name: "Harbor Keeper",
        })
      ).status,
    ).toBe(201);
    const initial = await readDraft(first, path);
    expect(
      (
        await call(
          first,
          "PUT",
          path,
          {
            working: {
              ...(initial.working as object),
              fragments: [
                {
                  ...fragment("description", "The keeper watches the harbor."),
                  kind: "character",
                  stable: true,
                },
                {
                  ...fragment("personality", "The keeper is patient."),
                  kind: "character",
                  stable: true,
                },
              ],
            },
          },
          { "if-match": String(initial.version) },
        )
      ).status,
    ).toBe(200);
    const baseline = await readDraft(first, path);
    await Promise.all([first.goto(editorURL), second.goto(editorURL)]);
    await expect(description(first)).toHaveValue("The keeper watches the harbor.");
    await expect(personality(second)).toHaveValue("The keeper is patient.");

    // Different fragments: a real stale save pauses, then only the local fragment is reapplied.
    let saving = nextSave(first, path);
    await description(first).fill("REMOTE: the keeper watches arriving ships.");
    expect((await saving).status()).toBe(200);
    const firstSaved = await readDraft(first, path);
    expect(firstSaved.version).toBe(baseline.version + 1);
    saving = nextSave(second, path);
    await personality(second).fill("LOCAL: the keeper is curious about visitors.");
    const stale = await saving;
    expect(stale.status()).toBe(409);
    expect(stale.request().headers()["if-match"]).toBe(`"${baseline.version}"`);
    await conflict.getByRole("button", { name: "Compare changes", exact: true }).click();
    await expect(comparison).toContainText(`saved version ${firstSaved.version}`);
    await expect(
      personalityChoice.getByRole("radio", { name: "Use my version", exact: true }),
    ).toBeChecked();
    await expect(apply).toBeEnabled();
    saving = nextSave(second, path);
    await apply.click();
    const reapplied = await saving;
    expect(reapplied.status()).toBe(200);
    expect(reapplied.request().headers()["if-match"]).toBe(`"${firstSaved.version}"`);
    await expect(second.getByText("All changes saved", { exact: true })).toBeVisible();
    const separate = await readDraft(first, path);
    expect(separate.working).toMatchObject({
      fragments: expect.arrayContaining([
        expect.objectContaining(
          fragment("description", "REMOTE: the keeper watches arriving ships."),
        ),
        expect.objectContaining(
          fragment("personality", "LOCAL: the keeper is curious about visitors."),
        ),
      ]),
    });

    // Same fragment: neither side is implicitly selected; explicitly keep the latest object.
    await Promise.all([first.reload(), second.reload()]);
    await expect(description(first)).toHaveValue("REMOTE: the keeper watches arriving ships.");
    await expect(description(second)).toHaveValue("REMOTE: the keeper watches arriving ships.");
    saving = nextSave(first, path);
    await description(first).fill("LATEST: the keeper lights the harbor beacon.");
    expect((await saving).status()).toBe(200);
    saving = nextSave(second, path);
    await description(second).fill("MINE: the keeper rings the harbor bell.");
    expect((await saving).status()).toBe(409);
    await conflict.getByRole("button", { name: "Compare changes", exact: true }).click();
    await expect(comparison).toContainText("Changed in both versions. Choose which to keep.");
    await expect(apply).toBeDisabled();
    await expect(
      descriptionChoice.getByRole("radio", { name: "Use my version", exact: true }),
    ).not.toBeChecked();
    await expect(
      descriptionChoice.getByRole("radio", { name: "Keep latest version", exact: true }),
    ).not.toBeChecked();
    await second.screenshot({ path: info.outputPath("draft-object-conflict.png"), fullPage: true });
    await descriptionChoice
      .getByRole("radio", { name: "Keep latest version", exact: true })
      .check();
    saving = nextSave(second, path);
    await apply.click();
    expect((await saving).status()).toBe(200);
    await expect(description(second)).toHaveValue("LATEST: the keeper lights the harbor beacon.");
    await expect(second.getByText("All changes saved", { exact: true })).toBeVisible();

    // A newer save lands after comparison. Reapply must still use the reviewed version, not overwrite it.
    await Promise.all([first.reload(), second.reload()]);
    await expect(description(first)).toHaveValue("LATEST: the keeper lights the harbor beacon.");
    await expect(description(second)).toHaveValue("LATEST: the keeper lights the harbor beacon.");
    saving = nextSave(first, path);
    await description(first).fill("REMOTE SECOND: the beacon is blue.");
    expect((await saving).status()).toBe(200);
    saving = nextSave(second, path);
    await description(second).fill("LOCAL RETAINED: the bell rings twice.");
    expect((await saving).status()).toBe(409);
    await conflict.getByRole("button", { name: "Compare changes", exact: true }).click();
    const reviewed = await readDraft(first, path);
    await expect(comparison).toContainText(`saved version ${reviewed.version}`);
    await descriptionChoice.getByRole("radio", { name: "Use my version", exact: true }).check();
    saving = nextSave(first, path);
    await personality(first).fill("REMOTE THIRD: the keeper welcomes every traveler.");
    expect((await saving).status()).toBe(200);
    const third = await readDraft(first, path);
    expect(third.version).toBe(reviewed.version + 1);
    saving = nextSave(second, path);
    await apply.click();
    const raced = await saving;
    expect(raced.status()).toBe(409);
    expect(raced.request().headers()["if-match"]).toBe(`"${reviewed.version}"`);
    await expect(description(second)).toHaveValue("LOCAL RETAINED: the bell rings twice.");
    await expect(
      conflict.getByRole("button", { name: "Compare changes", exact: true }),
    ).toBeVisible();
    expect((await readDraft(first, path)).version).toBe(third.version);
    await second.screenshot({
      path: info.outputPath("draft-conflict-repeated.png"),
      fullPage: true,
    });

    await conflict.getByRole("button", { name: "Compare changes", exact: true }).click();
    await expect(comparison).toContainText(`saved version ${third.version}`);
    await descriptionChoice.getByRole("radio", { name: "Use my version", exact: true }).check();
    saving = nextSave(second, path);
    await apply.click();
    const finalSave = await saving;
    expect(finalSave.status()).toBe(200);
    expect(finalSave.request().headers()["if-match"]).toBe(`"${third.version}"`);
    await expect(second.getByText("All changes saved", { exact: true })).toBeVisible();
    const final = await readDraft(first, path);
    expect(final.version).toBe(third.version + 1);
    expect(final.working).toMatchObject({
      fragments: expect.arrayContaining([
        expect.objectContaining(fragment("description", "LOCAL RETAINED: the bell rings twice.")),
        expect.objectContaining(
          fragment("personality", "REMOTE THIRD: the keeper welcomes every traveler."),
        ),
      ]),
    });
    await second.reload();
    await expect(description(second)).toHaveValue("LOCAL RETAINED: the bell rings twice.");
    await expect(personality(second)).toHaveValue(
      "REMOTE THIRD: the keeper welcomes every traveler.",
    );
    await second.screenshot({ path: info.outputPath("draft-reapplied-saved.png"), fullPage: true });
    const detail = await call(first, "GET", base);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ releases: [] });
    expect(errors).toEqual([]);
  } finally {
    await second.close();
  }
});
