import { defineProject } from "vitest/config";
import { serverResolve } from "./vitest.shared.js";

/** 用 Testcontainers 启动真实的 Postgres 与 MinIO 的集成测试（`test/**\/*.test.ts`）。 */
export default defineProject({
  ...serverResolve,
  test: {
    name: "integration",
    root: import.meta.dirname,
    include: ["test/**/*.test.ts"],
    environment: "node",
    globalSetup: ["test/global-setup.ts"],
    // 首次运行需要拉取镜像，容器启动可能较慢。
    hookTimeout: 180_000,
    testTimeout: 60_000,
  },
});
