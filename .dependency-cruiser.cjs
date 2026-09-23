/** 包之间的依赖边界，CI 强制执行。core 必须保持零 IO、可在任意 JS 运行时中运行。 */
module.exports = {
  forbidden: [
    {
      name: "core-no-node-builtins",
      comment: "core 零 IO、同构：不能依赖 node:* 内置模块",
      severity: "error",
      from: { path: "^packages/core/src" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "conformance-runner-no-node-builtins",
      comment: "一致性运行器要在浏览器和 workerd 中运行，不能依赖 node:* 内置模块",
      severity: "error",
      from: { path: "^spec/conformance/runner/(?!.*\\.test\\.ts$)" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "core-only-allowed-deps",
      comment: "core 只能依赖经过审阅的纯计算库",
      severity: "error",
      from: { path: "^packages/core/src" },
      to: {
        dependencyTypes: [
          "npm",
          "npm-dev",
          "npm-optional",
          "npm-peer",
          "npm-no-pkg",
          "npm-unknown",
        ],
        pathNot:
          "node_modules/(zod|canonicalize|@noble/hashes|spdx-expression-parse|spdx-license-ids|spdx-exceptions)/",
      },
    },
    {
      name: "packages-not-import-apps",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" },
    },
    {
      name: "apps-not-import-each-other",
      comment: "apps 之间不能互相 import，共享代码放 packages/*",
      severity: "error",
      from: { path: "^apps/([^/]+)/" },
      to: { path: "^apps/", pathNot: "^apps/$1/" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(dist|coverage)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.depcruise.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
    },
  },
};
