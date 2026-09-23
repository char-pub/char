/**
 * 角色卡导入向导（mock API）：原件上传给服务端解析，Import Report 只显示被省略字段的名字，
 * 评级、权利与许可必须逐项选择之后才能确认。
 */
import { expect, test } from "@playwright/test";
import { ME, mockApi } from "./mock-api";

const ORIGIN = "http://127.0.0.1:4173";
const SECRET = "NEVER-SHOW-THIS-SYSTEM-PROMPT";
const IMPORT_ID = "imp_01j00000000000000000000000";

const REPORT = {
  container: "png",
  format: "ccv3",
  spec: "chara_card_v3",
  spec_version: "3.0",
  source_digest: `sha256:${"a".repeat(64)}`,
  mappings: [{ from: "data.description", to: "fragments[description]" }],
  omitted_policy_fields: [{ field: "system_prompt", value: SECRET }],
  placeholders: [],
  lorebook: [],
  assets: [{ type: "icon", name: "main", uri: "ccdefault:", imported: true }],
  dropped: [],
  needs_confirmation: ["meta.rating", "meta.rights", "meta.license"],
  warnings: [],
};

function status(state: string, extra: Record<string, unknown> = {}) {
  return {
    import: IMPORT_ID,
    status: state,
    needs_confirmation: ["meta.rating", "meta.rights", "meta.license"],
    confirmed_at: null,
    created_at: "2026-09-22T12:00:00.000Z",
    ...extra,
  };
}

test("imports a card through the registry and requires explicit choices", async ({ page }) => {
  const api = await mockApi(page, ORIGIN);
  api.on("GET /v1/me", { body: ME });
  api.on("POST /v1/uploads", {
    status: 201,
    body: {
      upload: "0199a000-0000-7000-8000-000000000001",
      put_url: "https://uploads.example.test/put",
      headers: { "content-type": "image/png" },
      expires_at: "2026-09-22T12:10:00.000Z",
    },
  });
  api.on("POST /v1/uploads/*/complete", {
    body: { upload: "0199a000-0000-7000-8000-000000000001", status: "ready" },
  });
  api.on("POST /v1/imports", { status: 202, body: status("pending") });
  api.on(`GET /v1/imports/${IMPORT_ID}`, {
    body: status("succeeded", { creation: "@writer/mira", report: REPORT }),
  });
  api.on("GET /v1/creations/@writer/mira/draft", {
    body: {
      version: 1,
      working: {
        fragments: [{ id: "lore-1", stable: false }],
        meta: { rating: "general", rights: "original", license: "LicenseRef-All-Rights-Reserved" },
      },
      base_revision_id: null,
      updated_at: "2026-09-22T12:00:00.000Z",
    },
  });
  api.on(`POST /v1/imports/${IMPORT_ID}/confirm`, {
    body: status("succeeded", {
      creation: "@writer/mira",
      needs_confirmation: [],
      confirmed_at: "2026-09-22T12:01:00.000Z",
    }),
  });
  let uploaded = 0;
  await page.route("https://uploads.example.test/**", (route) => {
    const cors = {
      "access-control-allow-origin": ORIGIN,
      "access-control-allow-methods": "PUT",
      "access-control-allow-headers": "content-type",
    };
    if (route.request().method() === "PUT") uploaded++;
    return route.fulfill({
      status: route.request().method() === "OPTIONS" ? 204 : 200,
      headers: cors,
    });
  });

  await page.goto("/create/import");
  await page.getByLabel("Character card").setInputFiles({
    name: "Mira.png",
    mimeType: "image/png",
    buffer: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("not really an image, the registry is mocked"),
    ]),
  });
  await expect(page.getByLabel("Address")).toHaveValue("mira");
  await page.getByRole("button", { name: "Read the card" }).click();

  const omitted = page.getByRole("list", { name: "Omitted fields" });
  await expect(omitted.getByText("system_prompt")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("body")).not.toContainText(SECRET);
  await expect(page.getByText("lore-1")).toBeVisible();
  expect(uploaded).toBe(1);
  expect(api.calls.find((c) => c.path === "/v1/uploads")?.body).toMatchObject({
    purpose: "import",
    content_type: "image/png",
  });

  const confirm = page.getByRole("button", { name: "Confirm and open the editor" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Rating").selectOption("teen");
  await page.getByLabel("Rights").selectOption("fan-work");
  await expect(confirm).toBeDisabled();
  await page.getByLabel("License").selectOption("CC-BY-4.0");
  await confirm.click();
  await expect(page).toHaveURL(/\/c\/writer\/mira\/edit$/);
  expect(api.calls.find((c) => c.path.endsWith("/confirm"))?.body).toEqual({
    rating: "teen",
    rights: "fan-work",
    license: "CC-BY-4.0",
  });
});

test("a failed import explains why", async ({ page }) => {
  const api = await mockApi(page, ORIGIN);
  api.on("GET /v1/me", { body: ME });
  api.on("POST /v1/uploads", {
    status: 201,
    body: {
      upload: "0199a000-0000-7000-8000-000000000002",
      put_url: "https://uploads.example.test/put",
      headers: {},
      expires_at: "2026-09-22T12:10:00.000Z",
    },
  });
  api.on("POST /v1/uploads/*/complete", {
    body: { upload: "0199a000-0000-7000-8000-000000000002", status: "ready" },
  });
  api.on("POST /v1/imports", {
    status: 202,
    body: status("failed", { error_code: "import.parse_failed" }),
  });
  await page.route("https://uploads.example.test/**", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "access-control-allow-origin": ORIGIN,
        "access-control-allow-methods": "PUT",
        "access-control-allow-headers": "content-type",
      },
    }),
  );
  await page.goto("/create/import");
  await page.getByLabel("Character card").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"spec": "chara_card_v3"'),
  });
  await page.getByRole("button", { name: "Read the card" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "The card could not be read. It may be damaged.",
  );
});
