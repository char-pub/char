import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { brandIcons } from "../../scripts/brand-icons";

/** 直接使用 workspace 包的 TypeScript 源码，开发与构建都不需要先编译 packages/*。 */
const sourceConditions = ["@char-pub/source", "module", "browser", "import", "default"];

/**
 * 本地开发与端到端测试：`/v1` 转发到本机的 API 进程（默认 127.0.0.1:3000，可用
 * `API_PROXY` 修改），页面与 API 同源，session cookie 的行为与线上一致。
 * `vite preview` 沿用同一份代理配置。
 */
const apiProxy = { "/v1": { target: process.env.API_PROXY ?? "http://127.0.0.1:3000" } };

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    react(),
    tailwindcss(),
    brandIcons({ social: true }),
  ],
  resolve: {
    conditions: sourceConditions,
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  build: {
    target: "es2023",
    // CSP 不允许 inline script：禁止把小模块内联成 data URL 或 inline 脚本。
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    sourcemap: true,
  },
});
