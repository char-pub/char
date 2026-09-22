import { defineProject } from "vitest/config";

/** 直接使用 workspace 包的 TypeScript 源码，不需要先 build。 */
const conditions = ["@char-pub/source", "import", "module", "default"];

export default defineProject({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    name: "conformance-node",
    include: ["runner/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
  },
});
