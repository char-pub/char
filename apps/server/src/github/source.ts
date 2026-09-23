/**
 * 从 GitHub 读取 Source：用 GitHub App 的 installation token 在指定 commit 上读取文件。
 *
 * Registry 不采信 Action 上报的 digest：OIDC 发布时，worker 用这里的函数在 token 中 `sha`
 * 对应的 commit 上重新读取 char.yaml（以及它引用的 `./*.md` 文件），自己算 digest。
 *
 * App 只有 Metadata: Read 与 Contents: Read 两项权限。token 按 installation 缓存，
 * 过期前自动续期（由 @octokit/auth-app 处理）。
 */

import { CharError } from "@char-pub/core";
import { createAppAuth } from "@octokit/auth-app";
import { request as defaultRequest } from "@octokit/request";

export const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;
const COMMIT_RE = /^[0-9a-f]{40}$/;

/** 读取仓库文件的最小接口。测试中用内存实现替代。 */
export interface RepositoryChoice {
  id: string;
  owner_id: string;
  full_name: string;
  installation_id: string;
  default_branch: string;
}
export interface GitHubSource {
  installationUrl?(): Promise<string>;
  lookupRepository?(fullName: string): Promise<RepositoryChoice | null>;
  canManageRepository?(
    installationId: string,
    repositoryId: string,
    accountId: string,
  ): Promise<boolean>;
  /** 在 commit 上读取文件内容。文件不存在时返回 null。 */
  readFile(input: {
    installation_id: string;
    repository_id: string;
    commit: string;
    path: string;
  }): Promise<Uint8Array | null>;
  /** installation 当前可访问的仓库（用于对账）。 */
  listRepositories(
    installation_id: string,
  ): Promise<{ id: string; owner_id: string; full_name: string }[]>;
}

/** 规范化仓库内路径：不允许绝对路径、`..` 或空段，防止读取仓库之外的内容。 */
export function normalizeRepoPath(p: string): string {
  const parts = p.replace(/^\.\//, "").split("/");
  if (p.startsWith("/") || parts.some((s) => s === "" || s === "." || s === "..")) {
    throw new CharError({ code: "github.invalid_path", subject: p });
  }
  return parts.join("/");
}

type RequestFn = typeof defaultRequest;

export interface AppCredentials {
  appId: string;
  /** PEM 格式的私钥。 */
  privateKey: string;
}

/** 基于 GitHub REST API 的实现。 */
export class GitHubAppSource implements GitHubSource {
  private readonly auth: ReturnType<typeof createAppAuth>;

  constructor(
    creds: AppCredentials,
    private readonly request: RequestFn = defaultRequest,
  ) {
    this.auth = createAppAuth({ appId: creds.appId, privateKey: creds.privateKey, request });
  }

  async installationUrl(): Promise<string> {
    const auth = await this.auth({ type: "app" });
    const { data } = await this.request("GET /app", {
      headers: { authorization: `Bearer ${auth.token}` },
    });
    const slug = (data as { slug?: string }).slug;
    if (!slug || !/^[a-z0-9-]+$/i.test(slug)) throw new Error("GitHub App slug is missing");
    return `https://github.com/apps/${slug}/installations/new`;
  }

  async lookupRepository(fullName: string): Promise<RepositoryChoice | null> {
    const [owner, repo] = fullName.split("/");
    const auth = await this.auth({ type: "app" });
    try {
      const installation = await this.request("GET /repos/{owner}/{repo}/installation", {
        owner: owner ?? "",
        repo: repo ?? "",
        headers: { authorization: `Bearer ${auth.token}` },
      });
      const installationId = String(installation.data.id);
      const token = await this.token(installationId);
      const { data } = await this.request("GET /repos/{owner}/{repo}", {
        owner: owner ?? "",
        repo: repo ?? "",
        headers: { authorization: `Bearer ${token}` },
      });
      return {
        id: String(data.id),
        owner_id: String(data.owner.id),
        full_name: data.full_name,
        installation_id: installationId,
        default_branch: data.default_branch,
      };
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  }

  async canManageRepository(
    installationId: string,
    repositoryId: string,
    accountId: string,
  ): Promise<boolean> {
    const token = await this.token(installationId);
    const headers = { authorization: `Bearer ${token}` };
    try {
      const user = await this.request("GET /user/{account_id}", {
        account_id: Number(accountId),
        headers,
      });
      if (String(user.data.id) !== accountId) return false;
      const repo = await this.request("GET /repositories/{repository_id}", {
        repository_id: Number(repositoryId),
        headers,
      });
      if (String(repo.data.id) !== repositoryId) return false;
      const [owner, name] = repo.data.full_name.split("/");
      const { data } = await this.request(
        "GET /repos/{owner}/{repo}/collaborators/{username}/permission",
        {
          owner: owner ?? "",
          repo: name ?? "",
          username: user.data.login,
          headers,
        },
      );
      // Check the numeric identity again: a concurrent rename must never authorize a different user.
      return (
        String(data.user?.id) === accountId &&
        ["admin", "write", "maintain"].includes(data.permission)
      );
    } catch (e) {
      if ([403, 404].includes((e as { status?: number }).status ?? 0)) return false;
      throw e;
    }
  }

  private async token(installationId: string): Promise<string> {
    const a = await this.auth({ type: "installation", installationId: Number(installationId) });
    return a.token;
  }

  async readFile(input: {
    installation_id: string;
    repository_id: string;
    commit: string;
    path: string;
  }): Promise<Uint8Array | null> {
    if (!COMMIT_RE.test(input.commit)) {
      throw new CharError({ code: "github.invalid_commit", subject: input.commit });
    }
    const path = normalizeRepoPath(input.path);
    const token = await this.token(input.installation_id);
    try {
      // 按数字 ID 访问仓库（`/repositories/:id`），不依赖可能被改名或抢注的 owner/name。
      // `{+path}` 让路径里的 `/` 保持原样（`{path}` 会把它编码成 %2F，GitHub 会返回 404）；
      // 每一段单独做 URL 编码，所以路径里的特殊字符不会改变请求的含义。
      const res = await this.request("GET /repositories/{repository_id}/contents/{+path}", {
        repository_id: Number(input.repository_id),
        path: path.split("/").map(encodeURIComponent).join("/"),
        ref: input.commit,
        headers: { authorization: `token ${token}`, accept: "application/vnd.github.raw+json" },
        request: { parseSuccessResponseBody: false },
      });
      // parseSuccessResponseBody: false 时 data 是原始的响应流；raw 媒体类型直接返回文件字节。
      const bytes = new Uint8Array(await new Response(res.data as ReadableStream).arrayBuffer());
      if (bytes.byteLength > MAX_SOURCE_FILE_BYTES) {
        throw new CharError({ code: "github.file_too_large", subject: path });
      }
      return bytes;
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  }

  async listRepositories(installationId: string) {
    const token = await this.token(installationId);
    const out: { id: string; owner_id: string; full_name: string }[] = [];
    for (let page = 1; page <= 50; page++) {
      const res = await this.request("GET /installation/repositories", {
        per_page: 100,
        page,
        headers: { authorization: `token ${token}` },
      });
      const repos = (
        res.data as { repositories: { id: number; owner: { id: number }; full_name: string }[] }
      ).repositories;
      for (const r of repos)
        out.push({ id: String(r.id), owner_id: String(r.owner.id), full_name: r.full_name });
      if (repos.length < 100) break;
    }
    return out;
  }
}

/** 内存实现：测试与本地开发使用。 */
export class MemoryGitHubSource implements GitHubSource {
  readonly writers = new Set<string>();
  async installationUrl() {
    return "https://github.com/apps/char-pub-test/installations/new";
  }
  async lookupRepository(fullName: string): Promise<RepositoryChoice | null> {
    for (const [installationId, repos] of this.repos) {
      const repo = repos.find((r) => r.full_name.toLowerCase() === fullName.toLowerCase());
      if (repo) return { ...repo, installation_id: installationId, default_branch: "main" };
    }
    return null;
  }
  async canManageRepository(installationId: string, repositoryId: string, accountId: string) {
    return (
      (this.repos.get(installationId) ?? []).some((r) => r.id === repositoryId) &&
      this.writers.has(`${repositoryId}:${accountId}`)
    );
  }
  readonly files = new Map<string, Uint8Array>();
  readonly repos = new Map<string, { id: string; owner_id: string; full_name: string }[]>();

  put(repository_id: string, commit: string, path: string, content: string | Uint8Array): void {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    this.files.set(`${repository_id}@${commit}:${normalizeRepoPath(path)}`, bytes);
  }

  async readFile(input: { repository_id: string; commit: string; path: string }) {
    return (
      this.files.get(`${input.repository_id}@${input.commit}:${normalizeRepoPath(input.path)}`) ??
      null
    );
  }

  async listRepositories(installation_id: string) {
    return this.repos.get(installation_id) ?? [];
  }
}
