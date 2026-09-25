import { buildCreation, canonicalizeCreation, PRESET_REGIONS } from "@char-pub/core";
import { expect, type Page, test } from "@playwright/test";
import { creationDetail, ME, type MockApi, mockApi, OTHER } from "./mock-api";

const meta = { default_locale: "en", rating: "general", rights: "original", license: "CC-BY-4.0" };
const policy = {
  version: "0-draft",
  blocks: [{ id: "rules", text: "Keep the scene vivid.", position: "main" }],
  layout: [...PRESET_REGIONS],
  requires: { system_role: true },
};
const preset = {
  id: "cr_01j00000000000000000000002",
  ref: "@writer/policy",
  type: "preset",
  display_name: "Policy",
  policy,
  meta,
};
const scene = {
  id: "cr_01j00000000000000000000001",
  ref: "@writer/scene",
  type: "scenario",
  display_name: "Scene",
  meta,
  cast: [
    { key: "left", who: { late: "persona" } },
    { key: "right", who: { late: "character" } },
  ],
  fragments: [
    {
      id: "scene",
      stable: true,
      kind: "scenario",
      content: { type: "text", text: "Two visitors meet." },
    },
  ],
};
const release = "rel_01j00000000000000000000002";
const artifact = buildCreation({
  root: { creation: preset, release, visibility: "public" },
}).artifact;

function published(api: MockApi) {
  const rel = {
    id: release,
    label: "2.0.0",
    visibility: "public",
    status: "active",
    semantic_digest: artifact.root.semantic_digest,
    effective_rating: "general",
    created_at: "2026-09-26T00:00:00Z",
  };
  api.on("GET /v1/creations/@writer/policy", {
    body: creationDetail({
      id: preset.id,
      ref: preset.ref,
      type: preset.type,
      display_name: preset.display_name,
      releases: [rel],
      latest_release: rel,
    }),
  });
  api.on("GET /v1/creations/@writer/policy/releases/2.0.0/artifact", { body: artifact });
  api.on("GET /v1/creations/@writer/policy/releases/2.0.0/source", {
    body: {
      creation: preset,
      semantic_digest: artifact.root.semantic_digest,
      revision: "rev_01j00000000000000000000002",
    },
  });
}
async function editor(page: Page, working: Record<string, unknown>) {
  const api = await mockApi(page, "http://127.0.0.1:4173");
  api.on("GET /v1/me", { body: ME });
  const ref = String(working.ref);
  api.on(`GET /v1/creations/${ref}`, {
    body: creationDetail({
      id: working.id,
      ref: working.ref,
      type: working.type,
      display_name: working.display_name,
      releases: [],
      latest_release: undefined,
    }),
  });
  api.on(`GET /v1/creations/${ref}/draft`, {
    body: { version: 1, working, base_revision_id: null, updated_at: "2026-09-26T00:00:00Z" },
  });
  let version = 1;
  api.on(`PUT /v1/creations/${ref}/draft`, {
    body: {
      version: ++version,
      semantic_digest: canonicalizeCreation(working).semantic_digest,
      warnings: [],
    },
  });
  return api;
}
async function choose(page: Page, label: string) {
  const picker = page.getByRole("group", { name: label, exact: true });
  await picker.getByLabel(`${label} address`).fill("@writer/policy");
  await picker.getByRole("button", { name: "Look up" }).click();
  await picker.getByLabel(`${label} version`).selectOption(release);
  await picker.getByRole("button", { name: "Use version" }).click();
}

test("Preset and module policies have real block editors and preserve stable IDs when reordered", async ({
  page,
}) => {
  const api = await editor(page, preset);
  await page.goto("/c/writer/policy/edit");
  await page.getByLabel("Instructions for rules").fill("Write concise scenes.");
  await page.getByRole("button", { name: "Add prompt block" }).click();
  await page.getByLabel("Block 2 ID").fill("ending");
  await page.getByLabel("Instructions for ending").fill("End with a question.");
  await page.getByRole("button", { name: "Move ending up", exact: true }).click();
  await expect(page.getByLabel("Block 1 ID")).toHaveValue("ending");
  await page.getByRole("button", { name: "Build draft preview" }).click();
  await expect(
    page.getByRole("paragraph").filter({ hasText: /^Write concise scenes.$/ }),
  ).toBeVisible();
  await page.screenshot({ path: "/tmp/char-pub-preset-editor.png", fullPage: true });
  await expect(page.getByText("All changes saved")).toBeVisible();
  expect(api.calls.findLast((c) => c.method === "PUT")?.body).toMatchObject({
    working: {
      policy: {
        blocks: [
          { id: "ending", text: "End with a question." },
          { id: "rules", text: "Write concise scenes." },
        ],
      },
    },
  });
});

test("Scenario locks an exact preset, binds each role independently, and runs a published synthetic author test", async ({
  page,
}) => {
  const api = await editor(page, scene);
  published(api);
  await page.goto("/c/writer/scene/edit");
  await choose(page, "Lock a preset");
  await expect(page.getByRole("button", { name: "Remove locked assembly" })).toBeVisible();
  await page.getByRole("button", { name: "Add author test" }).click();
  await page.getByText("Advanced synthetic Session JSON", { exact: true }).click();
  await page.getByLabel("Synthetic session JSON").fill("[]");
  await page.getByRole("button", { name: "Apply session JSON" }).click();
  await expect(page.getByRole("alert")).toContainText("Invalid input");
  const resolved = buildCreation({
    root: { creation: scene, release, visibility: "public" },
  }).artifact;
  if (resolved.kind !== "content") throw new Error("content");
  const bindings = Object.fromEntries(
    resolved.ir.late_slots.map((slot, i) => [
      slot.key,
      { kind: slot.accepts[0], display_name: i ? "Rhea" : "Lena" },
    ]),
  );
  await page
    .getByLabel("Synthetic session JSON")
    .fill(JSON.stringify({ history: [{ role: "user", text: "A synthetic greeting." }], bindings }));
  await page.getByRole("button", { name: "Apply session JSON" }).click();
  await page.getByRole("button", { name: "Run author tests" }).click();
  await expect(page.getByRole("list", { name: "Author test results" })).toContainText("Passed:", {
    timeout: 15000,
  });
  await page.getByRole("button", { name: "Build draft preview" }).click();
  await expect(page.getByLabel("Use the author's locked setup")).toBeChecked();
  const roles = page
    .locator("fieldset")
    .filter({ has: page.locator("legend", { hasText: /^Role / }) });
  await expect(roles).toHaveCount(2);
  await roles.nth(0).getByLabel("Name", { exact: true }).fill("Lena");
  await roles.nth(1).getByLabel("Name", { exact: true }).fill("Rhea");
  await expect(page.getByRole("list", { name: "Assembled messages" })).toContainText(
    "Two visitors meet.",
  );
  await expect(page.getByRole("list", { name: "Assembled messages" })).toContainText(
    "Keep the scene vivid.",
  );
  await expect(roles.nth(0).getByLabel("Name", { exact: true })).toHaveValue("Lena");
  await expect(roles.nth(1).getByLabel("Name", { exact: true })).toHaveValue("Rhea");
  await expect(page.getByText("Policy: @writer/policy", { exact: false })).toBeVisible();
  await page.screenshot({ path: "/tmp/char-pub-assembly-preview.png", fullPage: true });
  await expect(page.getByText("All changes saved")).toBeVisible();
  expect(api.calls.findLast((c) => c.method === "PUT")?.body).toMatchObject({
    working: {
      assembly: {
        preset: { ref: "@writer/policy", release, semantic_digest: artifact.root.semantic_digest },
      },
    },
  });
});

test("a preset contribution submits policy as one atomic configuration change", async ({
  page,
}) => {
  const api = await mockApi(page, "http://127.0.0.1:4173");
  api.on("GET /v1/me", { body: ME });
  api.on("GET /v1/me", { body: OTHER });
  published(api);
  api.on("POST /v1/creations/@writer/policy/contributions", {
    status: 201,
    body: {
      id: "ctb_01j00000000000000000000007",
      number: 7,
      status: "open",
      agent: false,
      sensitive_keys: [],
    },
  });
  await page.goto("/c/writer/policy/contributions/new");
  await page.getByLabel("Instructions for rules").fill("A proposed policy edit.");
  await page.getByLabel("Title", { exact: true }).fill("Clarify the policy");
  await page.getByLabel(/I license my contribution under CC-BY-4.0/).check();
  await page.getByRole("button", { name: "Submit 1 change" }).click();
  await expect(page).toHaveURL(/contributions\/7$/);
  const body = api.calls.find(
    (c) => c.method === "POST" && c.path.endsWith("/contributions"),
  )?.body;
  expect(body).toMatchObject({
    changes: [
      {
        on: "configuration",
        field: "policy",
        op: "set",
        after: { blocks: [{ id: "rules", text: "A proposed policy edit." }] },
      },
    ],
  });
});

test("a prompt module is edited and previewed without a fictitious content IR", async ({
  page,
}) => {
  const { policy: omitted, ...base } = preset;
  const working = {
    ...base,
    ref: "@writer/module",
    type: "prompt-module",
    display_name: "Module",
    prompt_module: { version: "0-draft", blocks: omitted.blocks },
  };
  await editor(page, working);
  await page.goto("/c/writer/module/edit");
  await page.getByLabel("Instructions for rules").fill("Reusable module text.");
  await expect(page.getByRole("list", { name: "Context layout" })).toHaveCount(0);
  await page.getByRole("button", { name: "Build draft preview" }).click();
  await expect(
    page.getByRole("paragraph").filter({ hasText: /^Reusable module text.$/ }),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Assembled messages" })).toHaveCount(0);
});
