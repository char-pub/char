/**
 * GitHub 相关的后台任务。
 *
 * - `github.sync`：push 之后在新的 commit 上读取 char.yaml 并运行 `char check` 规则，把结果写在
 *   binding 上，让作者在网页上看到仓库当前的状态。**只检查，从不发布**：发布只能由作者
 *   在 CI 里通过 OIDC 主动发起。
 * - `github.reconcile`：定期（每 6 小时）核对 binding 与 GitHub 的实际情况，补偿可能丢失的
 *   webhook：仓库的 owner 变了就冻结 binding；installation 已经无法访问这个仓库时写一条审计，
 *   之后的发布会因为 installation 检查失败而被拒绝。
 */
import { type CheckDiagnostic, checkCreation, isCharError } from "@char-pub/core";
import { eq, inArray } from "drizzle-orm";
import { appendAudit } from "../audit/audit.js";
import type { Db } from "../db/client.js";
import { creations, namespaces, sourceBindings } from "../db/schema/index.js";
import { freezeOnOwnerMismatch } from "../github/events.js";
import { loadSourceAtCommit } from "../github/load-source.js";
import type { GitHubSource } from "../github/source.js";
import { encodeId } from "../registry/ids.js";

export interface GitHubWorkerDeps {
  db: Db;
  source: GitHubSource;
  now: () => Date;
}

export interface SyncJob {
  binding_id: string;
  commit: string;
}

export interface SyncCheck {
  /** 检查的 commit；对账发现仓库无法访问时是最后一次看到的 commit（可能没有）。 */
  commit: string | null;
  ok: boolean;
  semantic_digest?: string;
  diagnostics: Pick<CheckDiagnostic, "code" | "subject" | "severity">[];
}

const INACCESSIBLE = "github.repository_not_accessible";

/** 处理一次同步。binding 已经不是 active（冻结或解绑）时跳过。 */
export async function runGitHubSync(
  deps: GitHubWorkerDeps,
  job: SyncJob,
): Promise<SyncCheck | null> {
  const [row] = await deps.db
    .select({ b: sourceBindings, name: creations.name, slug: namespaces.slug })
    .from(sourceBindings)
    .innerJoin(creations, eq(creations.id, sourceBindings.creationId))
    .innerJoin(namespaces, eq(namespaces.id, creations.namespaceId))
    .where(eq(sourceBindings.id, job.binding_id))
    .limit(1);
  if (row?.b.status !== "active") return null;
  const b = row.b;
  let check: SyncCheck;
  try {
    const loaded = await loadSourceAtCommit(
      deps.source,
      {
        installation_id: b.installationId.toString(),
        repository_id: b.repositoryId.toString(),
        commit: job.commit,
        path: b.path,
      },
      { ref: `@${row.slug}/${row.name}`, creationId: encodeId("creation", b.creationId) },
    );
    const result = checkCreation(loaded.creation, { source: "github" });
    check = {
      commit: job.commit,
      ok: result.ok,
      semantic_digest: loaded.semantic_digest,
      diagnostics: result.diagnostics.map((d) => ({
        code: d.code,
        subject: d.subject,
        severity: d.severity,
      })),
    };
  } catch (e) {
    if (!isCharError(e)) throw e;
    check = {
      commit: job.commit,
      ok: false,
      diagnostics: [{ code: e.code, subject: e.subject, severity: "error" }],
    };
  }
  await deps.db
    .update(sourceBindings)
    .set({ lastCheck: check, lastCheckedAt: deps.now(), updatedAt: deps.now() })
    .where(eq(sourceBindings.id, b.id));
  return check;
}

export interface ReconcileResult {
  frozen: string[];
  inaccessible: string[];
}

/** 核对所有 active 的 binding。 */
export async function runGitHubReconcile(deps: GitHubWorkerDeps): Promise<ReconcileResult> {
  const active = await deps.db
    .select()
    .from(sourceBindings)
    .where(inArray(sourceBindings.status, ["active"]));
  const byInstallation = new Map<string, typeof active>();
  for (const b of active) {
    const k = b.installationId.toString();
    byInstallation.set(k, [...(byInstallation.get(k) ?? []), b]);
  }
  const out: ReconcileResult = { frozen: [], inaccessible: [] };
  for (const [installation, bindings] of byInstallation) {
    const repos = new Map((await deps.source.listRepositories(installation)).map((r) => [r.id, r]));
    for (const b of bindings) {
      const repo = repos.get(b.repositoryId.toString());
      if (!repo) {
        out.inaccessible.push(b.id);
        // 只在第一次发现时记录：结果写在 binding 上（作者可以看到），之后的对账不再重复审计。
        const last = b.lastCheck as SyncCheck | null;
        if (last?.diagnostics[0]?.code === INACCESSIBLE) continue;
        const check: SyncCheck = {
          commit: b.lastSeenCommit,
          ok: false,
          diagnostics: [{ code: INACCESSIBLE, subject: "binding", severity: "error" }],
        };
        await deps.db.transaction(async (tx) => {
          await tx
            .update(sourceBindings)
            .set({ lastCheck: check, lastCheckedAt: deps.now(), updatedAt: deps.now() })
            .where(eq(sourceBindings.id, b.id));
          await appendAudit(tx, {
            at: deps.now(),
            actor: { kind: "system", id: "github-reconcile" },
            action: "binding.repository_inaccessible",
            subject: `source_binding:${b.id}`,
            after: { installation, repository_id: b.repositoryId.toString() },
          });
        });
        continue;
      }
      if (repo.owner_id !== b.repositoryOwnerId.toString()) {
        const frozen = await freezeOnOwnerMismatch(deps.db, {
          repository_id: repo.id,
          current_owner_id: repo.owner_id,
          now: deps.now(),
        });
        out.frozen.push(...frozen.map((f) => f.binding_id));
      }
    }
  }
  return out;
}
