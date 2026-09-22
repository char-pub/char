import { defineConfig } from "vitest/config";

/** 测试直接使用各 workspace 包的 TypeScript 源码，不需要先 build。 */
const sourceConditions = ["@char-pub/source", "import", "module", "default"];

export default defineConfig({
  resolve: { conditions: sourceConditions },
  ssr: { resolve: { conditions: sourceConditions } },
  test: {
    projects: [
      // 各 app 与一致性测试集自带的 project 配置（integration、conformance-* 等）
      "apps/*/vitest.config.ts",
      "spec/conformance/vitest.*.config.ts",
      {
        extends: true,
        test: {
          name: "unit",
          include: [
            "packages/*/src/**/*.test.ts",
            "packages/*/test/**/*.test.ts",
            "apps/*/src/**/*.unit.test.ts",
          ],
          environment: "node",
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts", "apps/server/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/index.ts"],
      reporter: ["text-summary", "json-summary", "html"],
    },
  },
});
