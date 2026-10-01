/** Real sessions and API: invite/accept/revoke through UI, then preserve a denied local edit. */
import { DraftSchema } from "@char-pub/contracts";
import { expect, type Page, test } from "@playwright/test";
import { signInAs } from "./fullstack/session";

test.skip(!process.env.E2E_FULLSTACK, "needs the isolated full stack");
test.use({ actionTimeout: 15000 });

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

test("invites a collaborator, confirms the license, saves an edit, and preserves unsaved text after revocation", async ({
  page: owner,
  context,
  browser,
}, info) => {
  const baseURL = info.project.use.baseURL;
  if (!baseURL) throw new Error("Fullstack baseURL is required");
  const editorContext = await browser.newContext({ baseURL });
  const editor = await editorContext.newPage();
  const errors: string[] = [];
  const consoleEntries: string[] = [];
  for (const [label, page] of [
    ["owner", owner],
    ["editor", editor],
  ] as const) {
    page.on("pageerror", (error) => errors.push(`${label}: ${error.message}`));
    page.on("console", (message) =>
      consoleEntries.push(`${label}/${message.type()}: ${message.text()}`),
    );
  }
  const suffix = Date.now().toString(36);
  const ownerNs = `co-owner-${suffix}`;
  const editorNs = `co-editor-${suffix}`;
  const name = "harbor";
  const ref = `@${ownerNs}/${name}`;
  const base = `/v1/creations/${ref}`;
  const savedText = "The keeper remembers every visiting captain.";
  const localText = "UNSAVED_AFTER_REVOCATION: the keeper counts a new ship.";
  try {
    await signInAs(context, "Collaboration Owner");
    await signInAs(editorContext, "Collaboration Editor");
    await owner.goto("/");
    await editor.goto("/");
    expect((await call(owner, "POST", "/v1/namespaces", { slug: ownerNs })).status).toBe(201);
    expect((await call(editor, "POST", "/v1/namespaces", { slug: editorNs })).status).toBe(201);
    expect(
      (
        await call(owner, "POST", `/v1/namespaces/${ownerNs}/creations`, {
          name,
          type: "character",
          display_name: "Shared Harbor",
        })
      ).status,
    ).toBe(201);
    const initial = DraftSchema.parse((await call(owner, "GET", `${base}/draft`)).body);
    const working = {
      ...(initial.working as object),
      display_name: "Shared Harbor",
      fragments: [
        {
          id: "description",
          stable: true,
          kind: "character",
          content: { type: "text", text: "The keeper counts ships at the harbor." },
        },
      ],
      meta: { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" },
    };
    expect(
      (
        await call(
          owner,
          "PUT",
          `${base}/draft`,
          { working },
          { "if-match": String(initial.version) },
        )
      ).status,
    ).toBe(200);
    expect((await call(editor, "GET", `${base}/draft`)).status).toBe(404);

    // The owner must use the real settings UI; no direct collaboration-row/API preparation.
    await owner.goto(`/c/${ownerNs}/${name}/settings`);
    const people = owner.getByRole("region", { name: "Work collaborators", exact: true });
    await people.getByLabel("Invite collaborator by @namespace").fill(`@${editorNs}`);
    const inviting = owner.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().endsWith(`${base}/collaborators`),
    );
    await people.getByRole("button", { name: "Invite collaborator", exact: true }).click();
    expect((await inviting).status()).toBe(201);
    await expect(people.getByText(`@${editorNs}`, { exact: true })).toBeVisible();
    await expect(
      people.getByText("Pending — waiting for license acceptance", { exact: true }),
    ).toBeVisible();
    expect((await call(editor, "GET", `${base}/draft`)).status).toBe(404);

    await editor.goto("/settings");
    const invitations = editor.getByRole("region", {
      name: "Collaboration invitations",
      exact: true,
    });
    await expect(invitations.getByText("CC-BY-4.0", { exact: true })).toBeVisible();
    const accept = invitations.getByRole("button", {
      name: `Accept invitation to ${ref}`,
      exact: true,
    });
    await expect(accept).toBeDisabled();
    await invitations
      .getByRole("checkbox", {
        name: `I agree to contribute my edits to ${ref} under CC-BY-4.0.`,
        exact: true,
      })
      .check();
    const accepting = editor.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`${base}/collaborators/accept`),
    );
    await accept.click();
    const accepted = await accepting;
    expect(accepted.status()).toBe(200);
    expect(accepted.request().postDataJSON()).toEqual({ license: "CC-BY-4.0", agree: true });
    await invitations.getByRole("link", { name: `Edit ${ref}`, exact: true }).click();
    await expect(editor).toHaveURL(new RegExp(`/c/${ownerNs}/${name}/edit$`));
    const description = editor.getByLabel("Description", { exact: true });
    await expect(description).toHaveValue("The keeper counts ships at the harbor.");
    await expect(editor.getByRole("button", { name: "Publish…", exact: true })).toHaveCount(0);
    await editor.getByRole("button", { name: "Rating, license & tags", exact: true }).click();
    for (const label of ["Rating", "Content warnings", "Rights", "License"])
      await expect(editor.getByLabel(label, { exact: true })).toBeDisabled();
    await expect(editor.getByLabel("Tags", { exact: true })).toBeEnabled();

    // Server permissions are real too: a handcrafted sensitive write is rejected.
    const beforeEdit = DraftSchema.parse((await call(editor, "GET", `${base}/draft`)).body);
    expect(
      (
        await call(
          editor,
          "PUT",
          `${base}/draft`,
          {
            working: {
              ...(beforeEdit.working as object),
              meta: { ...working.meta, license: "CC0-1.0" },
            },
          },
          { "if-match": String(beforeEdit.version) },
        )
      ).status,
    ).toBe(403);
    const saving = editor.waitForResponse(
      (response) =>
        response.request().method() === "PUT" && response.url().endsWith(`${base}/draft`),
    );
    await description.fill(savedText);
    expect((await saving).status()).toBe(200);
    await expect(editor.getByText("All changes saved", { exact: true })).toBeVisible();
    const saved = DraftSchema.parse((await call(owner, "GET", `${base}/draft`)).body);
    expect(JSON.stringify(saved.working)).toContain(savedText);
    expect((saved.working as { meta: { license: string } }).meta.license).toBe("CC-BY-4.0");
    await editor.screenshot({
      path: info.outputPath("collaborator-edit-capabilities.png"),
      fullPage: true,
    });

    // Keep the collaborator's editor open while the owner removes access in a separate session.
    await owner.reload();
    await expect(people.getByText("Active — can edit drafts", { exact: true })).toBeVisible();
    const removing = owner.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        response.url().includes(`${base}/collaborators/`),
    );
    await people
      .getByRole("button", { name: `Remove collaborator @${editorNs}`, exact: true })
      .click();
    expect((await removing).status()).toBe(204);
    await expect(
      people.getByRole("button", { name: `Invite @${editorNs} again`, exact: true }),
    ).toBeVisible();
    const denied = editor.waitForResponse(
      (response) =>
        response.request().method() === "PUT" && response.url().endsWith(`${base}/draft`),
    );
    await description.fill(localText);
    expect((await denied).status()).toBe(404);
    await expect(editor.getByText("Not saved — access changed", { exact: true })).toBeVisible();
    await expect(editor.getByRole("alert")).toContainText("Your unsaved edits are kept here");
    await expect(description).toHaveValue(localText);
    await expect(
      editor.getByRole("button", { name: "Copy my version", exact: true }),
    ).toBeVisible();
    const retained = DraftSchema.parse((await call(owner, "GET", `${base}/draft`)).body);
    expect(retained.version).toBe(saved.version);
    expect(JSON.stringify(retained.working)).toContain(savedText);
    expect(JSON.stringify(retained.working)).not.toContain(localText);
    await editor.screenshot({
      path: info.outputPath("collaborator-revoked-unsaved.png"),
      fullPage: true,
    });

    // Explicitly confirm leaving the retained local edit, then verify no new private read succeeds.
    editor.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await editor.reload();
    await expect(
      editor.getByRole("heading", { name: "You can't edit this creation", exact: true }),
    ).toBeVisible();
    await expect(editor.getByLabel("Description", { exact: true })).toHaveCount(0);
    expect((await call(editor, "GET", `${base}/draft`)).status).toBe(404);
    expect((await call(editor, "GET", base)).status).toBe(404);
    const detail = await call(owner, "GET", base);
    expect(detail.status).toBe(200);
    expect((detail.body as { releases: unknown[] }).releases).toEqual([]);
    await editor.screenshot({
      path: info.outputPath("collaborator-revoked-refresh.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await info.attach("browser-console", {
      body: consoleEntries.join("\n"),
      contentType: "text/plain",
    });
    await info.attach("browser-errors", { body: errors.join("\n"), contentType: "text/plain" });
    await editorContext.close();
  }
});
