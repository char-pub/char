/**
 * admin SPA 的依赖边界检查。规则与根配置相同，只是 `@/` 别名解析到 apps/admin/src
 * （每个 SPA 都有自己的 `@/` 别名，一次运行只能解析其中一个）。
 */
const base = require("./.dependency-cruiser.cjs");

module.exports = {
  ...base,
  options: {
    ...base.options,
    exclude: { path: "(dist|coverage)/" },
    tsConfig: { fileName: "tsconfig.depcruise.admin.json" },
  },
};
