/**
 * 把品牌子模块（vendor/brand-assets）里的 favicon 放进 web 与 admin 的站点根目录；
 * 公开站点（web）还需要社交分享图（Open Graph / Twitter 卡片）。
 *
 * 图标只有一份来源：子模块。开发服务器直接从子模块读取，构建时写进产物，
 * 仓库里的 `public/` 不保存副本。子模块没有拉取时给出明确的报错。
 * 页面里用到的 logo（字标、横版 lockup）由组件直接 import 子模块里的 SVG，不经过这里。
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const BRAND = fileURLToPath(new URL("../vendor/brand-assets/", import.meta.url));

/** 站点路径 → 子模块中的文件。 */
const ICONS: Record<string, string> = {
  "/favicon-light.svg": "icons/favicon-light.svg",
  "/favicon-dark.svg": "icons/favicon-dark.svg",
  "/favicon.ico": "icons/favicon-light.ico",
  "/apple-touch-icon.png": "icons/apple-touch-icon.png",
};

/** 社交分享图：`index.html` 的 og:image / twitter:image 指向这里。 */
const SOCIAL: Record<string, string> = {
  "/og.png": "social/og-light.png",
};

const TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

function read(rel: string): Buffer {
  const path = BRAND + rel;
  if (!existsSync(path)) {
    throw new Error(
      "brand assets are missing: run `git submodule update --init` (vendor/brand-assets)",
    );
  }
  return readFileSync(path);
}

export function brandIcons(options: { social?: boolean } = {}): Plugin {
  const files = options.social ? { ...ICONS, ...SOCIAL } : ICONS;
  return {
    name: "charpub-brand-icons",
    buildStart() {
      // 尽早失败：缺少子模块时在构建开始就报错，而不是产物里少了图标。
      for (const rel of Object.values(files)) read(rel);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rel = req.url ? files[req.url.split("?")[0] ?? ""] : undefined;
        if (!rel) return next();
        res.setHeader(
          "content-type",
          TYPES[rel.slice(rel.lastIndexOf("."))] ?? "application/octet-stream",
        );
        res.end(read(rel));
      });
    },
    generateBundle() {
      for (const [site, rel] of Object.entries(files)) {
        this.emitFile({ type: "asset", fileName: site.slice(1), source: read(rel) });
      }
    },
  };
}
