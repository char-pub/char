/**
 * GitHub Source 集成测试的工具。GitHub 一律用替身：
 *
 * - 仓库内容与 installation 可访问的仓库列表来自 `MemoryGitHubSource`；
 * - OIDC token 用每次运行时新生成的 RS256 密钥签发，JWKS 是本地的公钥集合；
 * - webhook 用真实的 HMAC-SHA256 签名，走与生产完全相同的验签路径。
 *
 * 仓库里不保存任何私钥或 secret。
 */
import { createHmac, randomUUID } from "node:crypto";
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from "jose";
import { authAccount } from "../src/db/schema/index.js";
import type { GitHubDeps } from "../src/github/deps.js";
import { MemoryGitHubSource } from "../src/github/source.js";
import { GITHUB_OIDC_ISSUER } from "../src/oidc/github.js";
import { githubApiModules } from "../src/processes/modules.js";
import type { Cas } from "../src/storage/cas.js";
import { type ApiHarness, createHarness } from "./api-harness.js";
import type { TestDatabase } from "./helpers.js";

export async function grantRepositoryAccess(
  t: TestDatabase,
  g: GitHubHarness,
  uid: string,
  repos: string[],
  accountId = "4242",
) {
  await t.app.db
    .insert(authAccount)
    .values({ id: randomUUID(), userId: uid, providerId: "github", accountId })
    .onConflictDoNothing();
  for (const repo of repos) g.source.writers.add(`${repo}:${accountId}`);
}

export const AUDIENCE = "https://api.char.pub";
export const WEBHOOK_PATH = "/v1/github/webhook";

export interface RepoFixture {
  id: string;
  owner_id: string;
  owner_login: string;
  name: string;
}

export interface GitHubHarness {
  h: ApiHarness;
  gh: GitHubDeps;
  source: MemoryGitHubSource;
  webhookSecret: string;
  /** 用本地密钥签发一个 GitHub Actions OIDC token。 */
  oidcToken(claims: Record<string, unknown>, opts?: { wrongKey?: boolean }): Promise<string>;
  /** 用真实 HMAC 签名投递一次 webhook。 */
  deliver(
    event: string,
    payload: unknown,
    opts?: { delivery?: string; secret?: string; signature?: string },
  ): Promise<Response>;
  /** 投递 installation.created，并让 installation 能访问这些仓库。 */
  install(installationId: string, account: RepoFixture, repos: RepoFixture[]): Promise<void>;
}

export function repoJson(r: RepoFixture) {
  return {
    id: Number(r.id),
    name: r.name,
    full_name: `${r.owner_login}/${r.name}`,
    default_branch: "main",
    owner: { id: Number(r.owner_id), login: r.owner_login },
  };
}

export function listed(r: RepoFixture) {
  return { id: r.id, owner_id: r.owner_id, full_name: `${r.owner_login}/${r.name}` };
}

export async function createGitHubHarness(t: TestDatabase, cas: Cas): Promise<GitHubHarness> {
  const main = await generateKeyPair("RS256", { extractable: true });
  const other = await generateKeyPair("RS256", { extractable: true });
  const pub = { ...(await exportJWK(main.publicKey)), kid: "gh-test", alg: "RS256", use: "sig" };
  const source = new MemoryGitHubSource();
  const webhookSecret = `whsec-${randomUUID()}`;
  const gh: GitHubDeps = {
    source,
    webhookSecrets: [webhookSecret],
    oidcAudience: AUDIENCE,
    jwks: createLocalJWKSet({ keys: [pub] }),
  };
  const h = await createHarness(t, cas, { extraModules: githubApiModules(gh) });

  const oidcToken: GitHubHarness["oidcToken"] = async (claims, opts = {}) => {
    const nowSec = Math.floor(h.clock.now().getTime() / 1000);
    const payload: JWTPayload = {
      iss: GITHUB_OIDC_ISSUER,
      aud: AUDIENCE,
      iat: nowSec - 10,
      nbf: nowSec - 10,
      exp: nowSec + 290,
      jti: randomUUID(),
      run_id: "5001",
      run_attempt: "1",
      actor_id: "4242",
      event_name: "push",
      ref: "refs/heads/main",
      ...claims,
    };
    const clean = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
    return new SignJWT(clean)
      .setProtectedHeader({ alg: "RS256", kid: "gh-test", typ: "JWT" })
      .sign(opts.wrongKey ? other.privateKey : main.privateKey);
  };

  const deliver: GitHubHarness["deliver"] = async (event, payload, opts = {}) => {
    const body = JSON.stringify(payload);
    const mac = createHmac("sha256", opts.secret ?? webhookSecret)
      .update(body)
      .digest("hex");
    return h.app.request(WEBHOOK_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": event,
        "x-github-delivery": opts.delivery ?? randomUUID(),
        "x-hub-signature-256": opts.signature ?? `sha256=${mac}`,
      },
      body,
    });
  };

  const install: GitHubHarness["install"] = async (installationId, account, repos) => {
    const r = await deliver("installation", {
      action: "created",
      installation: {
        id: Number(installationId),
        account: { id: Number(account.owner_id), login: account.owner_login, type: "User" },
      },
    });
    if (r.status !== 200) throw new Error(`installation delivery failed: ${r.status}`);
    source.repos.set(installationId, repos.map(listed));
  };

  return { h, gh, source, webhookSecret, oidcToken, deliver, install };
}

/** OIDC token 里与仓库相关的 claim。 */
export function repoClaims(r: RepoFixture, sha: string, over: Record<string, unknown> = {}) {
  const full = `${r.owner_login}/${r.name}`;
  return {
    sub: `repo:${full}:ref:refs/heads/main`,
    repository: full,
    repository_id: r.id,
    repository_owner: r.owner_login,
    repository_owner_id: r.owner_id,
    sha,
    workflow_ref: `${full}/.github/workflows/publish.yml@refs/heads/main`,
    job_workflow_ref: `${full}/.github/workflows/publish.yml@refs/heads/main`,
    ...over,
  };
}

/** 一个最小的 char.yaml 与它引用的文件。 */
export function charYaml(ref: string, text: string) {
  return {
    yaml: `ref: "${ref}"
type: character
display_name: Alice
summary: A courier who is always late.
fragments:
  - { id: description, kind: character, content: { type: text, text: ./description.md } }
meta: { default_locale: en, rating: general, rights: original, license: CC-BY-4.0 }
`,
    description: text,
  };
}

export function putCharSource(
  source: MemoryGitHubSource,
  repo: RepoFixture,
  sha: string,
  dir: string,
  files: { yaml: string; description: string },
) {
  source.put(repo.id, sha, `${dir}/char.yaml`, files.yaml);
  source.put(repo.id, sha, `${dir}/description.md`, files.description);
}
