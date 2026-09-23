/**
 * source binding 的读取与状态判断，供 binding 路由、OIDC 发布与 worker 共用。
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Executor } from "../db/client.js";
import { githubInstallations, sourceBindings } from "../db/schema/index.js";
import type { OidcBinding } from "../oidc/github.js";

export type BindingRow = typeof sourceBindings.$inferSelect;

export async function bindingForCreation(
  db: Executor,
  creationId: string,
): Promise<BindingRow | undefined> {
  const [b] = await db
    .select()
    .from(sourceBindings)
    .where(eq(sourceBindings.creationId, creationId))
    .limit(1);
  return b;
}

/**
 * 按仓库的数字 ID 查找仍然有效的 binding（active 或 frozen）。同一个仓库可以绑定多个
 * Creation（例如一个仓库里有多个 char.yaml），所以返回列表。
 */
export async function bindingsForRepository(
  db: Executor,
  repositoryId: string,
): Promise<BindingRow[]> {
  const rows = await db
    .select()
    .from(sourceBindings)
    .where(eq(sourceBindings.repositoryId, BigInt(repositoryId)));
  return rows.filter((r) => r.status !== "unbound");
}

/** 转成 OIDC 校验使用的形状。ID 统一为十进制字符串。 */
export function toOidcBinding(b: BindingRow): OidcBinding {
  const out: OidcBinding = {
    repository_id: b.repositoryId.toString(),
    repository_owner_id: b.repositoryOwnerId.toString(),
    publish_refs: b.publishRefs,
    status: b.status,
  };
  if (b.requireRefProtected) out.require_ref_protected = true;
  if (b.environment) out.environment = b.environment;
  if (b.jobWorkflowRef) out.job_workflow_ref = b.jobWorkflowRef;
  return out;
}

/** installation 存在、没有被删除也没有被暂停。 */
export async function installationActive(db: Executor, installationId: bigint): Promise<boolean> {
  const [row] = await db
    .select({ id: githubInstallations.installationId })
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.installationId, installationId),
        isNull(githubInstallations.removedAt),
        isNull(githubInstallations.suspendedAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** binding 通过它所属的 Creation 访问（每个 Creation 最多一个），不对外暴露内部 ID。 */
export function bindingJson(b: BindingRow) {
  return {
    repository_id: b.repositoryId.toString(),
    repository_owner_id: b.repositoryOwnerId.toString(),
    installation_id: b.installationId.toString(),
    full_name: b.displayFullName,
    path: b.path,
    tracked_ref: b.trackedRef,
    publish_refs: b.publishRefs,
    status: b.status,
    ...(b.frozenReason ? { frozen_reason: b.frozenReason } : {}),
    ...(b.lastSeenCommit ? { last_seen_commit: b.lastSeenCommit } : {}),
    ...(b.lastCheck ? { last_check: b.lastCheck } : {}),
    ...(b.lastCheckedAt ? { last_checked_at: b.lastCheckedAt.toISOString() } : {}),
  };
}
