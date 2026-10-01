import { defineConfig } from "@playwright/test";
import fullstack from "./playwright.fullstack.config";

/** Explicit cross-repository acceptance; ordinary platform tests need no Harness checkout. */
export default defineConfig(fullstack, {
  testMatch: "**/fullstack-harness*.spec.ts",
  testIgnore: [],
});
