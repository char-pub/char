/**
 * GitHub Actions OIDC 发布凭证的校验。
 *
 * GitHub Action 在 CI 中申请一个 audience 为 char.pub 的 OIDC token，用它换取一次性的
 * 发布权限。这里要回答的只有一个问题：这个 token 是不是 GitHub 为“已绑定的那个仓库、
 * 在允许的 ref 和事件上运行的一次 workflow”签发的。
 *
 * 信任边界：token 只能证明“某个仓库的某次 workflow run”，不能证明运行的是官方的
 * publish Action。能写入该仓库允许发布的 ref 的人就能发布；作者可以在 binding 上额外
 * 要求 ref 受保护、指定 environment 或指定 reusable workflow 来收紧。
 *
 * 校验顺序：
 * 1. 签名（只接受 RS256，密钥来自 GitHub 的 JWKS）、issuer、audience、过期时间、
 *    签发时间（容忍 60 秒时钟偏差，token 最多 10 分钟内签发）；
 * 2. claim 的形状：ID 类 claim 必须是十进制字符串，commit 是 40 位小写 hex，必须有 jti；
 *    事件只允许 push、workflow_dispatch、release（pull_request_target 可以用 base 仓库的
 *    身份运行 fork 的代码，必须拒绝）；
 * 3. 与 Source Binding 比对：仓库和仓库所有者的数字 ID 必须同时相等（名字可以被改名后
 *    抢注，数字 ID 不会），ref 必须在允许列表中，请求里声明的 commit 必须等于 token 的 sha；
 * 4. 最后才消耗 jti：每个 token 只能成功换取一次。
 *
 * `sub` claim 的格式随仓库设置变化，而且包含可改名的仓库名，所以完全不读它。
 */
import { CharError, type GitHubOIDCClaims, GitHubOIDCClaimsSchema } from "@char-pub/core";
import { createRemoteJWKSet, errors, type JWTVerifyGetKey, jwtVerify } from "jose";
import { z } from "zod";

export const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const GITHUB_OIDC_JWKS_URL = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;

/** 允许的时钟偏差（秒）。 */
export const OIDC_CLOCK_TOLERANCE_SECONDS = 60;
/** token 从签发到使用的最长时间（秒）。 */
export const OIDC_MAX_TOKEN_AGE_SECONDS = 10 * 60;

/** 允许发布的触发事件。 */
export const ALLOWED_OIDC_EVENTS = ["push", "workflow_dispatch", "release"] as const;

/** 生产环境使用的 JWKS：jose 会缓存密钥，并在遇到未知 kid 时重新拉取。 */
export function githubJwks(): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(GITHUB_OIDC_JWKS_URL));
}

export interface OidcVerifyOptions {
  /** 期望的 audience，例如 `https://api.char.pub`。必须与 publish Action 申请时一致。 */
  audience: string;
  jwks: JWTVerifyGetKey;
  /** 当前时间，测试时注入。 */
  now?: () => Date;
}

/** 与 binding 比对时需要、但不进入 Release 记录的 claim。 */
export interface OidcContext {
  /** 触发 run 的 ref 是否受分支 / tag 保护。 */
  ref_protected: boolean;
  /** job 使用的 deployment environment。 */
  environment?: string;
  /** 仓库的显示名（`owner/repo`），只用于日志与提示，不参与任何判断。 */
  repository?: string;
}

export interface VerifiedOidcToken {
  claims: GitHubOIDCClaims;
  context: OidcContext;
  /** token 的过期时间；jti 至少要保留到这之后。 */
  expires_at: Date;
}

const DECIMAL_ID = /^[1-9][0-9]{0,19}$/;

/**
 * 从已验签的 payload 中读取的 claim。GitHub 会发送很多其他 claim，这里只挑需要的，
 * 其余忽略（包括 `sub`）。
 */
const ClaimsInputSchema = z.object({
  jti: z.string().min(1).max(256),
  repository_id: z.string().regex(DECIMAL_ID),
  repository_owner_id: z.string().regex(DECIMAL_ID),
  run_id: z.string().regex(DECIMAL_ID),
  run_attempt: z.string().regex(DECIMAL_ID),
  actor_id: z.string().regex(DECIMAL_ID),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  ref: z.string().min(1).max(1024),
  workflow_ref: z.string().min(1).max(1024),
  job_workflow_ref: z.string().min(1).max(1024),
  event_name: z.string().min(1),
  ref_protected: z.enum(["true", "false"]).optional(),
  environment: z.string().min(1).optional(),
  repository: z.string().min(1).optional(),
});

function oidcError(code: string, detail: string): CharError {
  return new CharError({ code, subject: "oidc", detail });
}

/** 把 jose 的错误映射成稳定的错误码；不是 jose 的错误（例如网络故障）原样抛出。 */
function mapJoseError(e: unknown): never {
  if (e instanceof errors.JWTExpired) {
    if (e.claim === "iat") throw oidcError("oidc.too_old", "token was issued too long ago");
    throw oidcError("oidc.expired", "token has expired");
  }
  if (e instanceof errors.JWTClaimValidationFailed) {
    switch (e.claim) {
      case "iss":
        throw oidcError("oidc.wrong_issuer", "token was not issued by GitHub Actions");
      case "aud":
        throw oidcError("oidc.wrong_audience", "token audience does not match this registry");
      case "iat":
        if (e.reason === "missing") throw oidcError("oidc.claim_invalid", "missing iat claim");
        throw oidcError("oidc.issued_in_future", "token issue time is in the future");
      case "nbf":
        throw oidcError("oidc.not_yet_valid", "token is not valid yet");
      default:
        throw oidcError("oidc.claim_invalid", `invalid or missing ${e.claim} claim`);
    }
  }
  if (e instanceof errors.JOSEAlgNotAllowed) {
    throw oidcError("oidc.algorithm_not_allowed", "only RS256 tokens are accepted");
  }
  if (e instanceof errors.JWSSignatureVerificationFailed || e instanceof errors.JWKSNoMatchingKey) {
    throw oidcError("oidc.invalid_signature", "token signature is not valid");
  }
  if (e instanceof errors.JWKSTimeout) {
    throw oidcError("oidc.jwks_unavailable", "could not fetch GitHub signing keys");
  }
  if (e instanceof errors.JOSEError) {
    throw oidcError("oidc.malformed", "token is not a valid JWT");
  }
  throw e;
}

/**
 * 校验 token 的签名与 claim，不查 binding，也不消耗 jti。
 * 发布流程应使用 `authenticateOidcPublish`，它会依次完成全部检查。
 */
export async function verifyGitHubOidcToken(
  token: string,
  opts: OidcVerifyOptions,
): Promise<VerifiedOidcToken> {
  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(token, opts.jwks, {
      algorithms: ["RS256"],
      issuer: GITHUB_OIDC_ISSUER,
      audience: opts.audience,
      clockTolerance: OIDC_CLOCK_TOLERANCE_SECONDS,
      maxTokenAge: OIDC_MAX_TOKEN_AGE_SECONDS,
      requiredClaims: ["exp", "jti"],
      currentDate: (opts.now ?? (() => new Date()))(),
    });
    payload = verified.payload;
  } catch (e) {
    mapJoseError(e);
  }

  if (payload.event_name === "pull_request_target" || payload.event_name === "pull_request") {
    throw oidcError(
      "oidc.event_not_allowed",
      `publishing from ${payload.event_name} runs is not allowed`,
    );
  }
  const parsed = ClaimsInputSchema.safeParse(payload);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".") ?? "claims";
    throw oidcError("oidc.claim_invalid", `invalid or missing ${field} claim`);
  }
  const c = parsed.data;
  if (!(ALLOWED_OIDC_EVENTS as readonly string[]).includes(c.event_name)) {
    throw oidcError(
      "oidc.event_not_allowed",
      `publishing from ${c.event_name} runs is not allowed`,
    );
  }

  const claims = GitHubOIDCClaimsSchema.parse({
    repository_id: c.repository_id,
    repository_owner_id: c.repository_owner_id,
    sha: c.sha,
    ref: c.ref,
    workflow_ref: c.workflow_ref,
    job_workflow_ref: c.job_workflow_ref,
    run_id: c.run_id,
    run_attempt: c.run_attempt,
    actor_id: c.actor_id,
    event_name: c.event_name,
    jti: c.jti,
  });
  const context: OidcContext = { ref_protected: c.ref_protected === "true" };
  if (c.environment !== undefined) context.environment = c.environment;
  if (c.repository !== undefined) context.repository = c.repository;
  // exp 已由 requiredClaims 保证存在，且 jose 校验过它是数字。
  const exp = payload.exp as number;
  return { claims, context, expires_at: new Date(exp * 1000) };
}

// ---------------------------------------------------------------------------
// Source Binding 比对
// ---------------------------------------------------------------------------

export interface OidcBinding {
  repository_id: string;
  repository_owner_id: string;
  /** 允许发布的 ref，见 `refMatches`。 */
  publish_refs: readonly string[];
  status: "active" | "frozen" | "unbound";
  /** 要求触发 run 的 ref 受保护。 */
  require_ref_protected?: boolean;
  /** 要求 job 使用这个 deployment environment。 */
  environment?: string;
  /** 要求 job 由这个 reusable workflow 运行（精确匹配，例如带 `@refs/tags/v1`）。 */
  job_workflow_ref?: string;
}

export interface OidcPublishRequest {
  /** 请求里声明要发布的 commit。 */
  commit: string;
}

const REF_PATTERN = /^refs\/[^*\s]+$|^refs\/[^*\s]*\/\*$/;

/**
 * ref 匹配规则：模式必须以 `refs/` 开头；要么精确相等，要么以 `/*` 结尾并匹配这个
 * 前缀下的任意非空后缀（例如 `refs/tags/*` 匹配 `refs/tags/v1.0` 和 `refs/tags/a/b`）。
 * 其他位置的 `*` 或空白一律视为非法模式。
 */
export function refMatches(pattern: string, ref: string): boolean {
  if (!REF_PATTERN.test(pattern)) {
    throw new CharError({
      code: "binding.invalid_ref_pattern",
      subject: "binding",
      detail: `'${pattern}' is not a valid ref pattern`,
    });
  }
  if (!pattern.endsWith("/*")) return pattern === ref;
  const prefix = pattern.slice(0, -1);
  return ref.length > prefix.length && ref.startsWith(prefix);
}

function bindingError(code: string, detail: string): CharError {
  return new CharError({ code, subject: "binding", detail });
}

/**
 * 检查 token 能否为这个 binding 发布。binding 通常按 `repository_id` 查到；缺失或已解绑时
 * 报 `binding.not_found`。
 */
export function matchBinding(
  verified: Pick<VerifiedOidcToken, "claims" | "context">,
  binding: OidcBinding | null | undefined,
  request: OidcPublishRequest,
): void {
  const { claims, context } = verified;
  if (!binding || binding.status === "unbound") {
    throw bindingError("binding.not_found", "this repository is not bound to any creation");
  }
  if (binding.repository_id !== claims.repository_id) {
    throw bindingError(
      "binding.mismatch",
      "token was issued for a different repository than the one bound (it may have been renamed and re-created)",
    );
  }
  if (binding.repository_owner_id !== claims.repository_owner_id) {
    throw bindingError(
      "binding.mismatch",
      "the repository owner changed since it was bound; the author must confirm the binding again",
    );
  }
  if (binding.status === "frozen") {
    throw bindingError(
      "binding.frozen",
      "this binding is frozen until the author confirms it after a repository transfer",
    );
  }
  if (!binding.publish_refs.some((p) => refMatches(p, claims.ref))) {
    throw bindingError("binding.ref_not_allowed", `publishing from ${claims.ref} is not allowed`);
  }
  if (binding.require_ref_protected && !context.ref_protected) {
    throw bindingError("binding.ref_not_protected", `${claims.ref} is not a protected ref`);
  }
  if (binding.environment !== undefined && binding.environment !== context.environment) {
    throw bindingError(
      "binding.environment_mismatch",
      `the job must run in the '${binding.environment}' environment`,
    );
  }
  if (
    binding.job_workflow_ref !== undefined &&
    binding.job_workflow_ref !== claims.job_workflow_ref
  ) {
    throw bindingError(
      "binding.workflow_mismatch",
      `the job must run from ${binding.job_workflow_ref}`,
    );
  }
  if (request.commit !== claims.sha) {
    throw new CharError({
      code: "oidc.commit_mismatch",
      subject: "oidc",
      detail: "the requested commit is not the commit this workflow run was triggered for",
    });
  }
}

// ---------------------------------------------------------------------------
// jti 防重放
// ---------------------------------------------------------------------------

export interface JtiStore {
  /**
   * 原子地占用一个 jti，并至少保留到 `expiresAt`。已经被占用时返回 false。
   * 数据库实现应当依赖唯一约束（INSERT … ON CONFLICT DO NOTHING），保证并发请求中只有一个成功。
   */
  claim(jti: string, expiresAt: Date): Promise<boolean>;
}

/** 内存实现：只用于测试与本地开发，多进程部署必须用数据库实现。 */
export class MemoryJtiStore implements JtiStore {
  private readonly seen = new Map<string, number>();
  constructor(private readonly now: () => Date = () => new Date()) {}

  async claim(jti: string, expiresAt: Date): Promise<boolean> {
    const t = this.now().getTime();
    for (const [k, exp] of this.seen) if (exp < t) this.seen.delete(k);
    if (this.seen.has(jti)) return false;
    this.seen.set(jti, expiresAt.getTime());
    return true;
  }
}

export interface OidcPublishOptions extends OidcVerifyOptions {
  jtiStore: JtiStore;
  /** 按仓库的数字 ID 查找 binding。 */
  findBinding: (repositoryId: string) => Promise<OidcBinding | null>;
}

/**
 * 完整的 OIDC 发布认证：验证 token → 查找并比对 binding → 占用 jti。
 * jti 放在最后占用，这样被拒绝的请求不会消耗 token，而成功换取过的 token 不能再用。
 */
export async function authenticateOidcPublish(
  token: string,
  request: OidcPublishRequest,
  opts: OidcPublishOptions,
): Promise<VerifiedOidcToken & { binding: OidcBinding }> {
  const verified = await verifyGitHubOidcToken(token, opts);
  const binding = await opts.findBinding(verified.claims.repository_id);
  matchBinding(verified, binding, request);
  // jti 的保留期要覆盖时钟容忍窗口，否则同一个 token 在容忍期内可以再用一次。
  const keepUntil = new Date(verified.expires_at.getTime() + OIDC_CLOCK_TOLERANCE_SECONDS * 1000);
  if (!(await opts.jtiStore.claim(verified.claims.jti, keepUntil))) {
    throw oidcError("oidc.replay", "this token has already been used");
  }
  // matchBinding 已确认 binding 存在。
  return { ...verified, binding: binding as OidcBinding };
}
