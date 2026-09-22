import { playwright } from "@vitest/browser-playwright";
import { defineProject } from "vitest/config";

/** 直接使用 workspace 包的 TypeScript 源码，不需要先 build。 */
const conditions = ["@char-pub/source", "browser", "import", "module", "default"];

export default defineProject({
  resolve: { conditions },
  test: {
    name: "conformance-browser",
    include: ["runner/conformance.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
