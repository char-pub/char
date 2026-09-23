/**
 * GitHub webhook 事件的处理：把归一化后的事件落到数据库。
 *
 * - installation：记录或更新 installation；删除 / 暂停时，相关 binding 不再能发布
 *   （发布时检查 installation 状态）。
 * - installation_repositories：只记录；binding 由作者在 char.pub 上显式创建。
 * - repository.renamed：只更新 binding 的展示名。binding 按数字 ID 匹配，改名不影响它。
 * - repository.transferred：仓库换了所有者，对应 binding 冻结，等作者确认重新绑定或换用
 *   新仓库；冻结期间一切发布被拒绝。
 * - push：记录最新 commit，入队同步任务读取 char.yaml（不会自动发布）。
 *
 * 每个事件与审计记录写在同一个事务里；按 delivery ID 去重，重复投递直接跳过。
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { appendAudit } from "../audit/audit.js";
import type { Db, Tx } from "../db/client.js";
import { githubInstallations, sourceBindings, webhookDeliveries } from "../db/schema/index.js";
import type { NormalizedEvent } from "../webhook/github.js";

export interface WebhookEffects {
  /** 被冻结的 binding，调用方负责通知对应 namespace 的 owner。 */
  frozen: { binding_id: string; creation_id: string }[];
  /** 需要入队同步的 binding。 */
  sync: { binding_id: string; commit: string }[];
  duplicate: boolean;
}

export async function recordDelivery(
  tx: Tx,
  deliveryId: string,
  event: string,
  now: Date,
): Promise<boolean> {
  const inserted = await tx
    .insert(webhookDeliveries)
    .values({ deliveryId, event, receivedAt: now, status: "received" })
    .onConflictDoNothing()
    .returning({ id: webhookDeliveries.deliveryId });
  return inserted.length > 0;
}

export async function applyWebhookEvent(
  db: Db,
  input: { delivery_id: string; event: string; normalized: NormalizedEvent | null; now: Date },
): Promise<WebhookEffects> {
  const effects: WebhookEffects = { frozen: [], sync: [], duplicate: false };
  await db.transaction(async (tx) => {
    if (!(await recordDelivery(tx, input.delivery_id, input.event, input.now))) {
      effects.duplicate = true;
      return;
    }
    const e = input.normalized;
    if (e) await applyOne(tx, e, input.now, effects, input.delivery_id);
    await tx
      .update(webhookDeliveries)
      .set({ status: "processed", processedAt: input.now })
      .where(eq(webhookDeliveries.deliveryId, input.delivery_id));
  });
  return effects;
}

async function applyOne(
  tx: Tx,
  e: NormalizedEvent,
  now: Date,
  effects: WebhookEffects,
  deliveryId: string,
): Promise<void> {
  const actor = { kind: "system" as const, id: "github-webhook" };
  switch (e.kind) {
    case "installation.created":
    case "installation.unsuspended": {
      const values = {
        installationId: BigInt(e.installation_id),
        accountId: BigInt(e.account_id ?? "0"),
        accountLogin: e.account_login ?? "",
        accountType: (e.account_type === "Organization" ? "Organization" : "User") as
          | "User"
          | "Organization",
        suspendedAt: null,
        removedAt: null,
      };
      await tx
        .insert(githubInstallations)
        .values(values)
        .onConflictDoUpdate({
          target: githubInstallations.installationId,
          set: { suspendedAt: null, removedAt: null, updatedAt: now },
        });
      return;
    }
    case "installation.suspended":
    case "installation.deleted": {
      const set =
        e.kind === "installation.suspended"
          ? { suspendedAt: now, updatedAt: now }
          : { removedAt: now, updatedAt: now };
      await tx
        .update(githubInstallations)
        .set(set)
        .where(eq(githubInstallations.installationId, BigInt(e.installation_id)));
      await appendAudit(tx, {
        at: now,
        actor,
        action: e.kind,
        subject: `github_installation:${e.installation_id}`,
        requestId: deliveryId,
      });
      return;
    }
    case "installation.repositories_changed":
      return;
    case "repository.renamed": {
      await tx
        .update(sourceBindings)
        .set({ displayFullName: e.full_name, updatedAt: now })
        .where(eq(sourceBindings.repositoryId, BigInt(e.repository_id)));
      return;
    }
    case "repository.transferred": {
      const rows = await tx
        .update(sourceBindings)
        .set({
          status: "frozen",
          frozenReason: `transferred from ${e.previous_owner_login} to ${e.new_owner_login}`,
          displayFullName: e.full_name,
          updatedAt: now,
        })
        .where(
          and(
            eq(sourceBindings.repositoryId, BigInt(e.repository_id)),
            ne(sourceBindings.status, "unbound"),
          ),
        )
        .returning({ id: sourceBindings.id, creationId: sourceBindings.creationId });
      for (const r of rows) {
        effects.frozen.push({ binding_id: r.id, creation_id: r.creationId });
        await appendAudit(tx, {
          at: now,
          actor,
          action: "binding.frozen",
          subject: `source_binding:${r.id}`,
          requestId: deliveryId,
          before: { owner_id: e.previous_owner_id },
          after: { owner_id: e.new_owner_id, reason: "repository.transferred" },
        });
      }
      return;
    }
    case "push": {
      if (!e.commit) return;
      const rows = await tx
        .update(sourceBindings)
        .set({ lastSeenCommit: e.commit, updatedAt: now })
        .where(
          and(
            eq(sourceBindings.repositoryId, BigInt(e.repository_id)),
            eq(sourceBindings.repositoryOwnerId, BigInt(e.repository_owner_id)),
            eq(sourceBindings.status, "active"),
            eq(sourceBindings.trackedRef, e.ref),
          ),
        )
        .returning({ id: sourceBindings.id });
      for (const r of rows) effects.sync.push({ binding_id: r.id, commit: e.commit });
      return;
    }
  }
}

/**
 * 对账时发现的所有者变化：仓库的当前 owner 与 binding 记录的不同，同样冻结。
 * 这补偿了可能丢失的 `repository.transferred` webhook。
 */
export async function freezeOnOwnerMismatch(
  db: Db,
  input: { repository_id: string; current_owner_id: string; now: Date },
): Promise<{ binding_id: string; creation_id: string }[]> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(sourceBindings)
      .set({
        status: "frozen",
        frozenReason: "owner changed (reconciliation)",
        updatedAt: input.now,
      })
      .where(
        and(
          eq(sourceBindings.repositoryId, BigInt(input.repository_id)),
          eq(sourceBindings.status, "active"),
          sql`${sourceBindings.repositoryOwnerId} <> ${BigInt(input.current_owner_id)}`,
        ),
      )
      .returning({ id: sourceBindings.id, creationId: sourceBindings.creationId });
    for (const r of rows) {
      await appendAudit(tx, {
        at: input.now,
        actor: { kind: "system", id: "github-reconcile" },
        action: "binding.frozen",
        subject: `source_binding:${r.id}`,
        after: { owner_id: input.current_owner_id, reason: "reconciliation" },
      });
    }
    return rows.map((r) => ({ binding_id: r.id, creation_id: r.creationId }));
  });
}

/**
 * 作者确认冻结的 binding：`rebind` 接受新的所有者并恢复 active；`unbind` 解除绑定，
 * 之后可以为这个 Creation 绑定另一个仓库。只能操作 frozen 状态的 binding。
 */
export async function resolveFrozenBinding(
  db: Db,
  input: {
    binding_id: string;
    action: "rebind" | "unbind";
    new_owner_id?: string;
    actor_user_id: string;
    now: Date;
  },
): Promise<{ ok: true } | { ok: false; code: string }> {
  return db.transaction(async (tx) => {
    const [b] = await tx
      .select()
      .from(sourceBindings)
      .where(eq(sourceBindings.id, input.binding_id))
      .for("update");
    if (!b) return { ok: false as const, code: "not_found" };
    if (b.status !== "frozen") return { ok: false as const, code: "binding.not_frozen" };
    if (input.action === "rebind") {
      if (!input.new_owner_id) return { ok: false as const, code: "binding.owner_required" };
      await tx
        .update(sourceBindings)
        .set({
          status: "active",
          frozenReason: null,
          repositoryOwnerId: BigInt(input.new_owner_id),
          updatedAt: input.now,
        })
        .where(eq(sourceBindings.id, b.id));
    } else {
      await tx
        .update(sourceBindings)
        .set({ status: "unbound", updatedAt: input.now })
        .where(eq(sourceBindings.id, b.id));
    }
    await appendAudit(tx, {
      at: input.now,
      actor: { kind: "user", id: input.actor_user_id },
      action: `binding.${input.action}`,
      subject: `source_binding:${b.id}`,
      before: { status: "frozen", owner_id: b.repositoryOwnerId.toString() },
      after:
        input.action === "rebind"
          ? { status: "active", owner_id: input.new_owner_id }
          : { status: "unbound" },
    });
    return { ok: true as const };
  });
}

export interface BindInput {
  /** 新建 binding 时使用的 ID（UUIDv7，由调用方生成）。 */
  new_id: string;
  creation_id: string;
  repository_id: string;
  repository_owner_id: string;
  installation_id: string;
  path: string;
  tracked_ref: string;
  publish_refs: string[];
  display_full_name: string;
  actor_user_id: string;
  now: Date;
}

/**
 * 为 Creation 绑定一个仓库（按数字 ID）。一个 Creation 同时只有一个 binding：
 * 已解绑的旧记录会被新的仓库覆盖（“换用新仓库”）；仍然 active 或 frozen 时拒绝，
 * 需要先处理旧的 binding。
 */
export async function bindRepository(
  db: Db,
  input: BindInput,
): Promise<{ ok: true; binding_id: string } | { ok: false; code: string }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: sourceBindings.id, status: sourceBindings.status })
      .from(sourceBindings)
      .where(eq(sourceBindings.creationId, input.creation_id))
      .for("update");
    if (existing && existing.status !== "unbound") {
      return { ok: false as const, code: "binding.exists" };
    }
    const values = {
      repositoryId: BigInt(input.repository_id),
      repositoryOwnerId: BigInt(input.repository_owner_id),
      installationId: BigInt(input.installation_id),
      path: input.path,
      trackedRef: input.tracked_ref,
      publishRefs: input.publish_refs,
      displayFullName: input.display_full_name,
      status: "active" as const,
      frozenReason: null,
      lastSeenCommit: null,
      updatedAt: input.now,
    };
    let id: string;
    if (existing) {
      await tx.update(sourceBindings).set(values).where(eq(sourceBindings.id, existing.id));
      id = existing.id;
    } else {
      const [row] = await tx
        .insert(sourceBindings)
        .values({ id: input.new_id, creationId: input.creation_id, ...values })
        .returning({ id: sourceBindings.id });
      if (!row) throw new Error("binding insert returned no row");
      id = row.id;
    }
    await appendAudit(tx, {
      at: input.now,
      actor: { kind: "user", id: input.actor_user_id },
      action: "binding.bind",
      subject: `source_binding:${id}`,
      after: {
        repository_id: input.repository_id,
        repository_owner_id: input.repository_owner_id,
        path: input.path,
        publish_refs: input.publish_refs,
      },
    });
    return { ok: true as const, binding_id: id };
  });
}
