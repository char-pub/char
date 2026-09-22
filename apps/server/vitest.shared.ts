/**
 * 测试直接使用各 workspace 包的 TypeScript 源码，不需要先 build。
 * 只额外声明源码条件，其余与 Node 自身的解析一致；不能列出 `import` 或 `module`，
 * 否则 CommonJS 依赖（pg-pool、AWS SDK）会误取为打包工具准备的 ESM 入口。
 */
const conditions = ["@char-pub/source", "node", "development|production"];

export const serverResolve = {
  resolve: { conditions },
  ssr: { resolve: { conditions } },
};
