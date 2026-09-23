import { defineConfig } from "vitest/config";

/** 测试直接使用各 workspace 包的 TypeScript 源码，不需要先 build。 */
const sourceConditions = ["@char-pub/source", "node", "development|production"];

/** 行与分支覆盖率的下限（百分比）。 */
const floor = (lines: number, branches: number) => ({ lines, branches });
/** 安全关键模块：被拒绝的路径都要有测试，所以门槛接近全覆盖。 */
const securityCritical = floor(95, 95);

export default defineConfig({
  resolve: { conditions: sourceConditions },
  ssr: { resolve: { conditions: sourceConditions } },
  test: {
    projects: [
      // 各 app 与一致性测试集自带的 project 配置（integration、conformance-* 等）
      "apps/*/vitest.config.ts",
      "apps/*/vitest.unit.config.ts",
      "spec/conformance/vitest.*.config.ts",
      {
        extends: true,
        test: {
          name: "unit",
          include: [
            "packages/*/src/**/*.test.ts",
            "packages/*/test/**/*.test.ts",
            "actions/*/src/**/*.unit.test.ts",
            "scripts/**/*.test.ts",
          ],
          environment: "node",
        },
      },
    ],
    coverage: {
      provider: "v8",
      // server 的覆盖率由 `pnpm test:integration` 单独统计（它需要真实的数据库与存储）。
      include: ["packages/*/src/**/*.ts", "actions/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/index.ts"],
      reporter: ["text-summary", "json-summary", "html"],
      // 按文件组检查的门槛。`pnpm test:unit` 只统计 packages，`pnpm test:integration` 只统计
      // apps/server；某一组在本次运行中没有任何文件时不检查。
      thresholds: {
        "packages/core/src/**": floor(90, 85),
        "packages/ccv3/src/**": floor(90, 85),
        "packages/assembler/src/**": floor(90, 85),
        "packages/core/src/canonical.ts": securityCritical,
        "packages/core/src/merge.ts": securityCritical,
        "apps/server/src/**": floor(80, 75),
        "apps/server/src/authz/**": securityCritical,
        "apps/server/src/oidc/**": securityCritical,
        "apps/server/src/webhook/**": securityCritical,
        "apps/server/src/upload/**": securityCritical,
      },
    },
  },
});
