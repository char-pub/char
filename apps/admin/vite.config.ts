import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { brandIcons } from "../../scripts/brand-icons";

/**
 * admin.char.pub 的构建配置。
 *
 * 本地开发时，设置 `ADMIN_API_PROXY`（例如本机运行的 admin 进程地址）后，`/v1/admin/*`
 * 请求会被转发过去；设置 `VITE_ADMIN_MOCK=1` 时前端改用内置的 mock API，方便单独开发界面。
 */
const proxyTarget = process.env.ADMIN_API_PROXY;

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
    brandIcons(),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: proxyTarget
    ? { proxy: { "/v1/admin": { target: proxyTarget, changeOrigin: true } } }
    : {},
  build: {
    target: "es2023",
    // CSP 不允许 inline script：禁止把小模块内联成 data URL 或 inline 脚本。
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    sourcemap: true,
  },
});
