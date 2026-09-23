/**
 * GitHub 集成在进程中共享的依赖：读取仓库内容、webhook 验签 secret、OIDC 校验参数。
 * 路由模块与 worker 通过工厂函数拿到它，不放进通用的 Services（没有配置 GitHub App 时
 * 这些路由与任务根本不注册）。
 */
import type { JWTVerifyGetKey } from "jose";
import type { GitHubSource } from "./source.js";

export interface GitHubDeps {
  source: GitHubSource;
  webhookSecrets: readonly string[];
  /** OIDC token 的 audience，例如 `https://api.char.pub`。 */
  oidcAudience: string;
  /** GitHub Actions 的 JWKS；生产环境为 `githubJwks()`，测试中为本地密钥。 */
  jwks: JWTVerifyGetKey;
}
