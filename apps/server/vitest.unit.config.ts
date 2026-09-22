import { defineProject } from "vitest/config";
import { serverResolve } from "./vitest.shared.js";

/** 不依赖外部服务的 server 单元测试（`src/**\/*.test.ts`），随 `pnpm test` 运行。 */
export default defineProject({
  ...serverResolve,
  test: {
    name: "server-unit",
    root: import.meta.dirname,
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
