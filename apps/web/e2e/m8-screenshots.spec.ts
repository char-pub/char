/**
 * M8 人工审阅用的截图（`M8_SCREENSHOTS=1` 时才执行，不在 CI 中运行）：作品页的 Context
 * Preview（展开一行 Trace）、两个版本的 Diff、编辑器（展开 More options）、导入向导的
 * Import Report。截图保存在 `docs/goals/v0/evidence/m8/`。
 */
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { diffPair, resolveSample } from "../src/fixtures/samples";
import { creationDetail, ME, mockApi } from "./mock-api";

test.skip(!process.env.M8_SCREENSHOTS, "M8 review screenshots are only taken on demand");

const ORIGIN = "http://127.0.0.1:4173";
const OUT = fileURLToPath(new URL("../../../docs/goals/v0/evidence/m8/", import.meta.url));
const BASE = "/v1/creations/@djj/alice";

function release(label: string, rating: string, n: number) {
  return {
    id: `rel_01j0000000000000000000000${n}`,
    label,
    visibility: "public",
    status: "active",
    semantic_digest: `sha256:${String(n).repeat(64)}`,
    effective_rating: rating,
    created_at: `2026-09-2${n}T12:00:00.000Z`,
  };
}

test("M8 review screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const api = await mockApi(page, ORIGIN);
  const releases = [release("1.2.0", "mature", 2), release("1.1.0", "teen", 1)];
  api.on("GET /v1/me", {
    body: {
      ...ME,
      namespace: "djj",
      settings: {
        show_mature: true,
        mature_confirmed_at: "2026-09-23T08:00:00.000Z",
        locale: null,
      },
    },
  });
  api.on(`GET ${BASE}`, {
    body: creationDetail({
      ref: "@djj/alice",
      display_name: "Alice",
      effective_rating: "mature",
      releases,
      latest_release: releases[0],
    }),
  });
  api.on(`GET ${BASE}/releases/*`, (_req, url) => {
    const r = releases.find((x) => x.label === url.pathname.split("/").pop()) ?? releases[0];
    return {
      body: {
        ...r,
        ref: "@djj/alice",
        creation: "cr_01j00000000000000000000000",
        lock_digest: null,
        context_ir_digest: null,
        license_check: "pass",
        availability: "complete",
      },
    };
  });
  api.on(`GET ${BASE}/releases/1.1.0/ir`, { body: resolveSample(diffPair.from).ir });
  api.on(`GET ${BASE}/releases/1.2.0/ir`, { body: resolveSample(diffPair.to).ir });
  api.on(`GET ${BASE}/dependents`, { body: { items: [], next_cursor: null } });
  api.on(`GET ${BASE}/draft`, {
    body: {
      version: 4,
      working: {
        id: "cr_01j00000000000000000000000",
        ref: "@djj/alice",
        type: "character",
        display_name: "Alice",
        summary: "A courier in Night City.",
        fragments: [
          {
            id: "description",
            stable: true,
            kind: "character",
            content: { type: "text", text: "{{self}} is a courier who knows every alley." },
          },
        ],
        bootstrap: { greetings: [{ id: "default", text: "Package for {{user}}!" }] },
        meta: { default_locale: "en", rating: "teen", rights: "original", license: "CC-BY-4.0" },
      },
      base_revision_id: null,
      updated_at: "2026-09-23T08:00:00.000Z",
    },
  });

  await page.goto("/c/djj/alice/preview?v=1.1.0");
  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  await table
    .getByRole("button", { name: "Show details for @cyberpunk/corps#lore/militech" })
    .click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}preview-trace.png`, fullPage: true });

  await page.goto("/c/djj/alice/diff");
  await expect(page.getByText("rating changed", { exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}diff.png`, fullPage: true });

  await page.goto("/c/djj/alice/edit");
  await page.getByRole("button", { name: "More options" }).click();
  await expect(page.getByRole("heading", { name: "Fragments" })).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}editor.png`, fullPage: true });
});

test("M8 review screenshot: import report", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const api = await mockApi(page, ORIGIN);
  api.on("GET /v1/me", { body: ME });
  const report = {
    container: "png",
    format: "ccv3",
    spec: "chara_card_v3",
    spec_version: "3.0",
    source_digest: `sha256:${"a".repeat(64)}`,
    mappings: [
      { from: "data.description", to: "fragments[description]" },
      { from: "data.first_mes", to: "bootstrap.greetings[default]" },
    ],
    omitted_policy_fields: [{ field: "system_prompt", value: "not shown" }],
    placeholders: [],
    lorebook: [],
    assets: [{ type: "icon", name: "main", uri: "ccdefault:", imported: true }],
    dropped: [],
    needs_confirmation: ["meta.rating", "meta.rights", "meta.license"],
    warnings: [],
  };
  api.on("POST /v1/uploads", {
    status: 201,
    body: {
      upload: "upl_01j00000000000000000000000",
      put_url: "https://uploads.example.test/put",
      headers: {},
      expires_at: "2026-09-23T09:00:00.000Z",
    },
  });
  await page.route("https://uploads.example.test/**", (route) =>
    route.fulfill({
      status: route.request().method() === "OPTIONS" ? 204 : 200,
      headers: {
        "access-control-allow-origin": ORIGIN,
        "access-control-allow-methods": "PUT",
        "access-control-allow-headers": "content-type",
      },
    }),
  );
  api.on("POST /v1/uploads/*/complete", {
    body: { upload: "upl_01j00000000000000000000000", status: "ready" },
  });
  api.on("POST /v1/imports", {
    status: 202,
    body: {
      import: "imp_01j00000000000000000000000",
      status: "pending",
      needs_confirmation: report.needs_confirmation,
      confirmed_at: null,
      created_at: "2026-09-23T08:00:00.000Z",
    },
  });
  api.on("GET /v1/imports/*", {
    body: {
      import: "imp_01j00000000000000000000000",
      status: "succeeded",
      creation: "@writer/imported-card",
      needs_confirmation: report.needs_confirmation,
      confirmed_at: null,
      report,
      created_at: "2026-09-23T08:00:00.000Z",
    },
  });
  api.on("GET /v1/creations/@writer/imported-card/draft", {
    body: {
      version: 1,
      working: {
        fragments: [{ id: "description", stable: false }],
        meta: { rating: "general", rights: "original", license: "LicenseRef-All-Rights-Reserved" },
      },
      base_revision_id: null,
      updated_at: "2026-09-23T08:00:00.000Z",
    },
  });
  await page.goto("/create/import");
  await page.getByLabel("Character card").setInputFiles({
    name: "imported-card.png",
    mimeType: "image/png",
    buffer: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("not really an image, the registry is mocked"),
    ]),
  });
  await page.getByRole("button", { name: "Read the card" }).click();
  await expect(page.getByRole("list", { name: "Omitted fields" })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}import-report.png`, fullPage: true });
});
