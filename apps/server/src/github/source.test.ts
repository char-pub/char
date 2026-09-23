/**
 * GitHubAppSource 对 GitHub REST API 的调用：用 App 私钥换 installation token，按仓库的
 * 数字 ID 与 commit 读取原始文件内容。GitHub 由一个本地 fetch 替身模拟，App 私钥在
 * 运行时生成。
 */
import { generateKeyPairSync } from "node:crypto";
import { request as octokitRequest } from "@octokit/request";
import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import { GitHubAppSource } from "./source.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const SHA = "c".repeat(40);

function fakeGitHub() {
  const calls: { method: string; url: string; auth: string | null; accept: string | null }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    calls.push({
      method: req.method,
      url: url.pathname + url.search,
      auth: req.headers.get("authorization"),
      accept: req.headers.get("accept"),
    });
    if (url.pathname === "/app/installations/77/access_tokens" && req.method === "POST") {
      return Response.json(
        { token: "ghs_installation_token", expires_at: "2099-01-01T00:00:00Z", permissions: {} },
        { status: 201 },
      );
    }
    if (url.pathname === "/repositories/1001/contents/chars/alice/char.yaml") {
      return new Response(`ref: "@djj/alice" # at ${url.searchParams.get("ref")}`, {
        status: 200,
        headers: { "content-type": "application/vnd.github.raw" },
      });
    }
    if (url.pathname === "/installation/repositories") {
      return Response.json({
        total_count: 1,
        repositories: [{ id: 1001, owner: { id: 2001 }, full_name: "djj/alice" }],
      });
    }
    return Response.json({ message: "Not Found" }, { status: 404 });
  }) as typeof fetch;
  const request = octokitRequest.defaults({ request: { fetch: fetchImpl } });
  return { calls, request };
}

describe("GitHubAppSource", () => {
  it("exchanges an App JWT for an installation token and reads the file at the commit by repository id", async () => {
    const gh = fakeGitHub();
    const source = new GitHubAppSource({ appId: "12345", privateKey: PEM }, gh.request);
    const bytes = await source.readFile({
      installation_id: "77",
      repository_id: "1001",
      commit: SHA,
      path: "./chars/alice/char.yaml",
    });
    expect(new TextDecoder().decode(bytes ?? new Uint8Array())).toBe(
      `ref: "@djj/alice" # at ${SHA}`,
    );

    const tokenCall = gh.calls.find((c) => c.url.includes("access_tokens"));
    const jwt = tokenCall?.auth?.replace(/^bearer /i, "") ?? "";
    expect(decodeJwt(jwt).iss).toBe("12345");
    const fileCall = gh.calls.find((c) => c.url.startsWith("/repositories/1001/contents/"));
    expect(fileCall?.url).toBe(`/repositories/1001/contents/chars/alice/char.yaml?ref=${SHA}`);
    expect(fileCall?.auth).toBe("token ghs_installation_token");
    expect(fileCall?.accept).toBe("application/vnd.github.raw+json");
  });

  it("returns null for missing files and rejects bad commits and paths", async () => {
    const gh = fakeGitHub();
    const source = new GitHubAppSource({ appId: "12345", privateKey: PEM }, gh.request);
    const base = { installation_id: "77", repository_id: "1001", commit: SHA };
    expect(await source.readFile({ ...base, path: "missing.yaml" })).toBeNull();
    await expect(
      source.readFile({ ...base, commit: "main", path: "a.yaml" }),
    ).rejects.toMatchObject({
      code: "github.invalid_commit",
    });
    await expect(source.readFile({ ...base, path: "../x.yaml" })).rejects.toMatchObject({
      code: "github.invalid_path",
    });
  });

  it("lists the installation's repositories with numeric ids as strings", async () => {
    const gh = fakeGitHub();
    const source = new GitHubAppSource({ appId: "12345", privateKey: PEM }, gh.request);
    expect(await source.listRepositories("77")).toEqual([
      { id: "1001", owner_id: "2001", full_name: "djj/alice" },
    ]);
  });
});
