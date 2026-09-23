import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checksFor } from "./smoke.js";

/** 一个模拟部署：按路径返回符合（或不符合）期望的响应。 */
let server: Server;
let base = "";
let mode: "good" | "bad" = "good";
beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "/";
    const good = mode === "good";
    if (url.startsWith("/web/")) {
      res.writeHead(200, {
        "content-type": "text/html",
        ...(good
          ? {
              "content-security-policy": "default-src 'self'; script-src 'self'",
              "strict-transport-security": "max-age=63072000",
              "x-content-type-options": "nosniff",
            }
          : { "content-security-policy": "script-src 'self' 'unsafe-inline'" }),
      });
      res.end('<div id="root"></div>');
    } else if (url === "/api/healthz") {
      res.writeHead(200).end("{}");
    } else if (url.startsWith("/api/v1/search")) {
      res.writeHead(200, { "content-type": "application/json" }).end('{"items":[]}');
    } else if (url.startsWith("/admin")) {
      res.writeHead(good ? 302 : 200, { location: "https://login" }).end();
    } else if (url.startsWith("/origin/")) {
      res.writeHead(good ? 403 : 200).end();
    } else {
      res.writeHead(404, { "content-type": "application/problem+json" }).end("{}");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});

const target = () => ({
  web: `${base}/web`,
  api: `${base}/api`,
  admin: `${base}/admin`,
  adminApi: `${base}/admin-api`,
  assets: `${base}/assets`,
});

async function runAll() {
  const out: [string, boolean][] = [];
  for (const c of checksFor(target(), `${base}/origin`)) {
    try {
      await c.run();
      out.push([c.name, true]);
    } catch {
      out.push([c.name, false]);
    }
  }
  return out;
}

describe("smoke checks", () => {
  it("all pass against a correctly configured deployment", async () => {
    mode = "good";
    expect((await runAll()).filter(([, ok]) => !ok)).toEqual([]);
  });

  it("catch a weak CSP, an open admin and an origin that accepts direct traffic", async () => {
    mode = "bad";
    const failed = (await runAll()).filter(([, ok]) => !ok).map(([n]) => n);
    expect(failed).toEqual([
      "web serves the SPA with security headers",
      "admin-api rejects requests without Cloudflare Access",
      "admin SPA is behind Cloudflare Access",
      "origin rejects traffic that bypasses Cloudflare",
    ]);
  });
});
