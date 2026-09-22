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
    include: ["runner/conformance.test.ts"],
  },
});
