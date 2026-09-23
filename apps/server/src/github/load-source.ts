/**
 * 在 GitHub 的某个 commit 上重新读取 char.yaml，得到 canonical Creation 与 semantic digest。
 *
 * 这是 OIDC 发布的核心校验：Action 在 CI 里算出的 digest 只用来尽早发现不一致，
 * Registry 以这里自己读取、自己计算的结果为准。解析规则与 CLI 完全相同（同一个
 * `parseCharYaml`），所以同一个 commit 在本地和 Registry 得到相同的 digest。
 */
import { parseCharYaml } from "@char-pub/cli";
import {
  type CanonicalCreation,
  CharError,
  canonicalizeCreation,
  type Digest,
} from "@char-pub/core";
import { type GitHubSource, normalizeRepoPath } from "./source.js";

export interface SourceAtCommit {
  installation_id: string;
  repository_id: string;
  commit: string;
  /** char.yaml 在仓库中的路径。 */
  path: string;
}

export interface LoadedSource {
  creation: CanonicalCreation;
  semantic_digest: Digest;
  /**
   * 按 Action 的算法算出的 digest：char.yaml 没有写内部 Creation ID 时，Action 用 CLI 由 ref
   * 派生的占位 ID 计算，不知道 Registry 里的真实 ID。只用于与 Action 上报的值比对；存入
   * Revision 的是上面用真实 ID 算出的内容。
   */
  reported_digest: Digest;
  /** 读取过的文件（char.yaml 与 include），用于记录 source_digest。 */
  files: string[];
}

/**
 * @param expectedRef binding 所属 Creation 的公共标识；char.yaml 中的 ref 必须与它一致，
 *   否则一个仓库可以冒充发布别人的 Creation。
 * @param creationId Registry 中这个 Creation 的内部 ID，覆盖文件中的占位 ID。
 */
export async function loadSourceAtCommit(
  gh: GitHubSource,
  at: SourceAtCommit,
  expected: { ref: string; creationId: string },
): Promise<LoadedSource> {
  const yamlPath = normalizeRepoPath(at.path);
  const files: string[] = [];
  const read = async (rel: string) => {
    files.push(rel);
    return gh.readFile({ ...at, path: rel });
  };
  const bytes = await read(yamlPath);
  if (!bytes) throw new CharError({ code: "github.source_missing", subject: yamlPath });
  const parsed = await parseCharYaml(bytes, yamlPath, read);
  if (parsed.missingIds.length > 0) {
    throw new CharError({
      code: "check.missing_fragment_id",
      subject: `fragments[${parsed.missingIds[0]}]`,
      detail: "run 'char check --fix' and commit the result",
    });
  }
  if (parsed.creation.ref !== expected.ref) {
    throw new CharError({
      code: "github.ref_mismatch",
      subject: String(parsed.creation.ref),
      detail: `this binding publishes ${expected.ref}`,
    });
  }
  const { creation, semantic_digest } = canonicalizeCreation({
    ...parsed.creation,
    id: expected.creationId,
  });
  const reported_digest = canonicalizeCreation(parsed.creation).semantic_digest;
  return { creation, semantic_digest, reported_digest, files: [...new Set(files)].sort() };
}
