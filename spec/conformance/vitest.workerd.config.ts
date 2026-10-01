import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineProject } from "vitest/config";

/** 直接使用 workspace 包的 TypeScript 源码，不需要先 build。 */
const conditions = ["@char-pub/source", "workerd", "worker", "import", "module", "default"];

export default defineProject({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    name: "conformance-workerd",
    include: [
      "runner/conformance.test.ts",
      "runner/preset.test.ts",
      "runner/instances.test.ts",
      "runner/local-build.test.ts",
      "runner/story-contribution.test.ts",
      "runner/derivation.test.ts",
      "runner/story.test.ts",
      "runner/story-portability.test.ts",
    ],
  },
});
