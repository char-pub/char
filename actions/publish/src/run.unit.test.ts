import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ActionDeps, type ActionEnv, defaultLabel, run } from "./run.js";

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "char-action-"));
  file = path.join(dir, "char.yaml");
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
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const SHA = "a".repeat(40);
const ENV: ActionEnv = {
  GITHUB_SHA: SHA,
  GITHUB_EVENT_NAME: "push",
  GITHUB_REF_TYPE: "tag",
  GITHUB_REF_NAME: "v1.2.0",
};

function deps(response: { status: number; body: unknown }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const outputs: Record<string, string> = {};
  const logs: string[] = [];
  const d: ActionDeps = {
    getIdToken: async (aud) => `token-for:${aud}`,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(response.body), { status: response.status });
    }) as typeof fetch,
    log: (l) => logs.push(l),
    setOutput: (n, v) => {
      outputs[n] = v;
    },
    idempotencyKey: "gha:1:2:1",
  };
  return { d, calls, outputs, logs };
}

const inputs = (over: Partial<Parameters<typeof run>[0]> = {}) => ({
  path: file,
  label: "",
  visibility: "public",
  registry: "https://api.char.pub/",
  dryRun: false,
  ...over,
});

describe("publish action", () => {
  it("builds, requests an OIDC token for the registry audience and publishes", async () => {
    const { d, calls, outputs } = deps({
      status: 202,
      body: { release: "rel_01h455vb4pex5vsknk084sn0r1", state: "pending", idempotent: false },
    });
    await run(inputs(), ENV, d);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe("https://api.char.pub/v1/publish/oidc");
    const headers = call?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer token-for:https://api.char.pub");
    expect(headers["idempotency-key"]).toBe("gha:1:2:1");
    const body = JSON.parse(String(call?.init.body));
    expect(body).toMatchObject({
      creation: "@djj/alice",
      label: "1.2.0",
      commit: SHA,
      visibility: "public",
    });
    expect(body.semantic_digest).toMatch(/^sha256:/);
    expect(outputs.release).toBe("rel_01h455vb4pex5vsknk084sn0r1");
  });

  it("does not publish in dry-run mode", async () => {
    const { d, calls, outputs } = deps({ status: 500, body: {} });
    await run(inputs({ dryRun: true }), ENV, d);
    expect(calls).toHaveLength(0);
    expect(outputs["semantic-digest"]).toMatch(/^sha256:/);
  });

  it.each(["pull_request", "pull_request_target", ""])(
    "refuses to publish on %s events",
    async (event) => {
      const { d } = deps({ status: 200, body: {} });
      await expect(run(inputs(), { ...ENV, GITHUB_EVENT_NAME: event }, d)).rejects.toMatchObject({
        code: "action.event_not_allowed",
      });
    },
  );

  it("requires a label outside tag pushes and a valid visibility and sha", async () => {
    const { d } = deps({ status: 200, body: {} });
    await expect(
      run(inputs(), { GITHUB_SHA: SHA, GITHUB_EVENT_NAME: "push" }, d),
    ).rejects.toMatchObject({
      code: "action.label_required",
    });
    await expect(run(inputs({ visibility: "secret" }), ENV, d)).rejects.toMatchObject({
      code: "action.invalid_visibility",
    });
    await expect(run(inputs(), { ...ENV, GITHUB_SHA: "abc" }, d)).rejects.toMatchObject({
      code: "action.missing_sha",
    });
  });

  it("surfaces registry problems with their stable code", async () => {
    const { d } = deps({
      status: 403,
      body: {
        type: "x",
        title: "binding.frozen",
        status: 403,
        code: "binding.frozen",
        detail: "repository was transferred",
      },
    });
    await expect(run(inputs(), ENV, d)).rejects.toMatchObject({
      code: "binding.frozen",
      detail: "repository was transferred",
    });
    const { d: d2 } = deps({ status: 502, body: "nope" });
    await expect(run(inputs(), ENV, d2)).rejects.toMatchObject({ code: "http.502" });
  });

  it("reports idempotent re-publishes", async () => {
    const { d, logs } = deps({
      status: 200,
      body: { release: "rel_x", state: "active", idempotent: true },
    });
    await run(inputs({ label: "2.0.0" }), { ...ENV, GITHUB_REF_TYPE: "branch" }, d);
    expect(logs.at(-1)).toContain("already published");
  });

  it("derives the label from tags only", () => {
    expect(defaultLabel({ GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v1.0.0" })).toBe("1.0.0");
    expect(defaultLabel({ GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "release-1" })).toBe(
      "release-1",
    );
    expect(defaultLabel({ GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "bad/tag" })).toBeUndefined();
    expect(defaultLabel({ GITHUB_REF_TYPE: "branch", GITHUB_REF_NAME: "main" })).toBeUndefined();
  });
});
