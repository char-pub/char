/**
 * 保证所有路由都经过授权。规则本身是 Biome 插件 `tools/biome/no-direct-route.grit`，随 `pnpm lint`
 * 执行；这里用真实的 Biome 检查一组样例，证明规则既能拦住直接注册（与变量名无关），又不会误伤
 * 无关的调用，并且核对仓库里绕过规则的例外只有经过审阅的那几处。
 */
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const SERVER_SRC = path.join(ROOT, "apps/server/src");
const BIOME = path.join(ROOT, "node_modules/.bin/biome");

const VIOLATIONS: Record<string, string> = {
  "get-any-name": `export function f(r: X) { r.get("/v1/x", (c: C) => c.text("x")); }`,
  "post-template-path": `export function f(r: X) { r.post(\`/v1/\${1}\`, h); }`,
  "delete-identifier-path": "export function f(r: X) { r.delete(PATH, h); }",
  "all-method": `export function f(r: X) { r.all("/v1/*", h); }`,
  "on-single-method": `export function f(r: X) { r.on("PUT", "/v1/y", h); }`,
  "on-method-list": `export function f(r: X) { r.on(["GET", "POST"], "/v1/y", h); }`,
  "use-with-path": `export function f(r: X) { r.use("/v1/z", (c: C) => c.text("z")); }`,
  "computed-method": `export function f(r: X, m: "get") { r[m]("/v1/w", h); }`,
  "sub-app-route": `export function f(r: X, sub: X) { r.route("/v1/sub", sub); }`,
  "nested-member": `export function f(o: { api: X }) { o.api.patch("/v1/p", h); }`,
};

const ALLOWED: Record<string, string> = {
  "map-get": `export const v = new Map<string, number>().get("a");`,
  "header-get": `export function f(req: Request) { return req.headers.get("x-request-id"); }`,
  "drizzle-index-on": `export const i = (t: T) => [index("x").on(t.a, t.b, t.c)];`,
  "event-listener-on": `export function f(pool: P) { pool.on("error", (e: Error) => log(e)); }`,
  "global-middleware": `export function f(app: X) { app.use(mw); app.use(async (c: C, next: N) => next()); }`,
  "route-helper-call": `export function f(app: X) { route(app, { method: "get", path: "/v1/x" }); }`,
  "db-delete": `export async function f(db: D) { await db.delete(table).where(cond); }`,
};

let dir = "";

/** 在与规则作用范围相同的路径下写入样例文件，然后用仓库的 Biome 配置检查，返回每个文件的诊断数。 */
async function lintSamples(samples: Record<string, string>): Promise<Map<string, number>> {
  const base = path.join(dir, "apps/server/src/samples");
  await rm(base, { recursive: true, force: true });
  await mkdir(base, { recursive: true });
  for (const [name, code] of Object.entries(samples)) {
    await writeFile(path.join(base, `${name}.ts`), `${code}\n`);
  }
  const r = spawnSync(
    BIOME,
    [
      "lint",
      `--config-path=${path.join(ROOT, "biome.json")}`,
      "--vcs-enabled=false",
      "--reporter=github",
      "--max-diagnostics=none",
      "apps/server/src/samples",
    ],
    { cwd: dir, encoding: "utf8" },
  );
  const counts = new Map<string, number>(Object.keys(samples).map((k) => [k, 0]));
  for (const line of `${r.stdout}\n${r.stderr}`.split("\n")) {
    const m = /^::error title=plugin,file=[^,]*\/samples\/([^,/]+)\.ts,/.exec(line);
    if (m?.[1]) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  return counts;
}

async function sources(d: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) out.push(...(await sources(p)));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "route-guard-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("route registration lint rule", () => {
  it("flags every direct Hono registration, whatever the variable is called", async () => {
    const counts = await lintSamples(VIOLATIONS);
    const missed = [...counts].filter(([, n]) => n === 0).map(([k]) => k);
    expect(missed).toEqual([]);
  }, 30_000);

  it("does not flag unrelated calls with the same method names", async () => {
    const counts = await lintSamples(ALLOWED);
    const flagged = [...counts].filter(([, n]) => n > 0).map(([k]) => k);
    expect(flagged).toEqual([]);
  }, 30_000);

  it("is bypassed only at the reviewed places", async () => {
    const found: string[] = [];
    for (const file of await sources(SERVER_SRC)) {
      const text = await readFile(file, "utf8");
      const n = text.split("\n").filter((l) => l.includes("biome-ignore lint/plugin")).length;
      if (n > 0) found.push(`${path.relative(SERVER_SRC, file)}:${n}`);
    }
    // route() 与 adminRoute() 本身、两个健康检查、Better Auth 的挂载点、CORS 中间件。
    expect(found.sort()).toEqual(["admin/app.ts:2", "api/app.ts:1", "api/server.ts:3"]);
  });
});
