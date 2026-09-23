import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Output } from "../src/commands.js";
import { cmdLogin, cmdPublish, credentialsPath, loadCredentials } from "../src/remote.js";

let dir: string;
let env: NodeJS.ProcessEnv;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "char-remote-"));
  env = { HOME: dir };
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function capture(): Output & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, log: (l) => out.push(l), error: (l) => err.push(l) };
}

const TOKEN = `cp_pat_${"a".repeat(43)}`;

/** 一个记录请求的假 Registry。 */
function fakeRegistry(
  routes: Record<string, (init: RequestInit) => { status: number; body: unknown }>,
) {
  const calls: { method: string; path: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    calls.push({ method, path: u.pathname, init });
    const handler = routes[`${method} ${u.pathname}`];
    const r = handler
      ? handler(init)
      : { status: 404, body: { type: "x", title: "not_found", status: 404, code: "not_found" } };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { f, calls };
}

describe("char login", () => {
  it("validates the token with the registry and stores it with 0600 permissions", async () => {
    const { f } = fakeRegistry({ "GET /v1/me/tokens": () => ({ status: 403, body: {} }) });
    const o = capture();
    expect(
      await cmdLogin({ registry: "https://api.example/", token: `${TOKEN}\n`, env, fetch: f }, o),
    ).toBe(0);
    const file = credentialsPath(env);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      registry: "https://api.example",
      token: TOKEN,
    });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await loadCredentials(env)).toEqual({ registry: "https://api.example", token: TOKEN });
  });

  it("rejects malformed and invalid tokens without saving them", async () => {
    const o = capture();
    expect(await cmdLogin({ registry: "https://api.example", token: "nope", env }, o)).toBe(1);
    const { f } = fakeRegistry({ "GET /v1/me/tokens": () => ({ status: 401, body: {} }) });
    expect(
      await cmdLogin({ registry: "https://api.example", token: TOKEN, env, fetch: f }, o),
    ).toBe(1);
    expect(await loadCredentials(env)).toBeNull();
  });

  it("prefers CHAR_PUB_TOKEN from the environment", async () => {
    expect(await loadCredentials({ ...env, CHAR_PUB_TOKEN: TOKEN })).toEqual({
      registry: "https://api.char.pub",
      token: TOKEN,
    });
  });
});

describe("char publish", () => {
  async function project() {
    const file = path.join(dir, "char.yaml");
    await writeFile(
      file,
      `ref: "@djj/alice"
type: character
display_name: Alice
fragments:
  - { id: description, kind: character, content: { type: text, text: "{{self}} is a courier." } }
meta: { default_locale: en, rating: general, rights: original, license: CC-BY-4.0 }
`,
    );
    return file;
  }

  it("uploads the draft, creates a revision and publishes with an idempotency key", async () => {
    const file = await project();
    const { f, calls } = fakeRegistry({
      "GET /v1/creations/@djj/alice/draft": () => ({
        status: 200,
        body: { version: 3, working: {}, base_revision_id: null, updated_at: "" },
      }),
      "PUT /v1/creations/@djj/alice/draft": () => ({ status: 200, body: { version: 4 } }),
      "POST /v1/creations/@djj/alice/revisions": () => ({ status: 201, body: { id: "rev-1" } }),
      "POST /v1/creations/@djj/alice/releases": () => ({
        status: 202,
        body: { release: "rel-1", state: "pending", idempotent: false },
      }),
    });
    const o = capture();
    const code = await cmdPublish(
      {
        file,
        label: "1.0.0",
        visibility: "public",
        env: { ...env, CHAR_PUB_TOKEN: TOKEN },
        fetch: f,
      },
      o,
    );
    expect(code).toBe(0);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /v1/creations/@djj/alice/draft",
      "PUT /v1/creations/@djj/alice/draft",
      "POST /v1/creations/@djj/alice/revisions",
      "POST /v1/creations/@djj/alice/releases",
    ]);
    const headersOf = (i: number) => (calls[i]?.init.headers ?? {}) as Record<string, string>;
    expect(headersOf(1)["if-match"]).toBe("3");
    // 占位 ID 不发给 Registry，由服务端使用真实 ID。
    expect(JSON.parse(String(calls[1]?.init.body)).working.id).toBeUndefined();
    expect(headersOf(3)["idempotency-key"]).toMatch(/^cli:@djj\/alice:1\.0\.0:sha256:/);
    expect(JSON.parse(String(calls[3]?.init.body))).toEqual({
      revision: "rev-1",
      label: "1.0.0",
      visibility: "public",
    });
    expect(o.out.at(-1)).toBe("publish pending: @djj/alice@1.0.0 (rel-1)");
  });

  it("reports registry problems, missing credentials and bad labels", async () => {
    const file = await project();
    const o = capture();
    expect(await cmdPublish({ file, label: "1.0.0", visibility: "public", env }, o)).toBe(1);
    expect(o.err.at(-1)).toContain("cli.not_logged_in");
    expect(await cmdPublish({ file, label: "bad label", visibility: "public", env }, o)).toBe(1);
    expect(o.err.at(-1)).toContain("cli.invalid_label");
    const { f } = fakeRegistry({
      "GET /v1/creations/@djj/alice/draft": () => ({
        status: 404,
        body: {
          type: "x",
          title: "not_found",
          status: 404,
          code: "not_found",
          detail: "create it first",
        },
      }),
    });
    expect(
      await cmdPublish(
        {
          file,
          label: "1.0.0",
          visibility: "public",
          env: { ...env, CHAR_PUB_TOKEN: TOKEN },
          fetch: f,
        },
        o,
      ),
    ).toBe(1);
    expect(o.err.at(-1)).toContain("not_found");
  });
});
