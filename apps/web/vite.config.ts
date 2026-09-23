import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { brandIcons } from "../../scripts/brand-icons";

/** 直接使用 workspace 包的 TypeScript 源码，开发与构建都不需要先编译 packages/*。 */
const sourceConditions = ["@char-pub/source", "module", "browser", "import", "default"];

/**
 * 本地开发与端到端测试：`/v1` 转发到本机的 API 进程（默认 127.0.0.1:3000，可用
 * `API_PROXY` 修改），页面与 API 同源，session cookie 的行为与线上一致。
 * `vite preview` 沿用同一份代理配置。
 */
const apiProxy = { "/v1": { target: process.env.API_PROXY ?? "http://127.0.0.1:3000" } };

/**
 * sonner（toast）在模块加载时向 <head> 插入一个 <style>，生产 CSP（style-src 'self'）会拦下
 * 它并在控制台报违规。它的样式已经由 styles.css 打进我们自己的 CSS，这里在构建时把运行时
 * 插入改成空操作。sonner 升级后找不到这段代码就直接报错，避免悄悄失效。
 */
function sonnerWithoutInlineStyle(): Plugin {
  const marker = "function __insertCSS(code) {";
  return {
    name: "charpub-sonner-without-inline-style",
    apply: "build",
    transform(code, id) {
      if (!/[\\/]sonner[\\/]dist[\\/]index\.mjs$/.test(id)) return null;
      if (!code.includes(marker)) {
        this.error("sonner no longer defines __insertCSS; update sonnerWithoutInlineStyle()");
      }
      return { code: code.replace(marker, `${marker} return;`), map: null };
    },
  };
}

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
    sonnerWithoutInlineStyle(),
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
