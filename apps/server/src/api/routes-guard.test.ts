/**
 * 保证所有路由都经过授权：路由模块里不允许直接调用 `app.get / post / put / patch / delete / all / on`，
 * 必须用 `route()` 注册。
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROUTES_DIR = path.join(import.meta.dirname, "routes");
const DIRECT = /\b(app|api|router)\s*\.\s*(get|post|put|patch|delete|all|on)\s*\(/;

async function sources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await sources(p)));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("route registration", () => {
  it("every route module registers routes through route()", async () => {
    const offenders: string[] = [];
    for (const file of await sources(ROUTES_DIR)) {
      const text = await readFile(file, "utf8");
      text.split("\n").forEach((line, i) => {
        if (DIRECT.test(line))
          offenders.push(`${path.relative(ROUTES_DIR, file)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("detects a direct registration", () => {
    expect(DIRECT.test('app.get("/x", handler)')).toBe(true);
    expect(DIRECT.test('route(app, { method: "get" })')).toBe(false);
  });
});
