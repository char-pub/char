/**
 * 一次性的引导命令，部署到新环境后执行：
 *
 *   node dist/main.js bootstrap --system-actor
 *       创建自动处置使用的系统账号（`SYSTEM_ACTOR_ID`），已存在时不做任何事。
 *   node dist/main.js bootstrap --owner <email>
 *       把一个已经注册（登录过一次）的用户提升为 owner。只有系统里还没有任何 owner 时才能成功。
 *
 * 两者都写审计记录，并且可以安全地重复执行。
 */
import { eq, like, or } from "drizzle-orm";
import { appendAudit } from "../audit/audit.js";
import { createDatabase, type Db } from "../db/client.js";
import { authUser } from "../db/schema/index.js";
import { DatabaseEnvSchema, parseEnv, WorkerEnvSchema } from "../env.js";

export const SYSTEM_ACTOR_EMAIL = "system@char.pub";

export async function ensureSystemActor(db: Db, id: string, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(authUser).where(eq(authUser.id, id)).limit(1);
    if (existing) return false;
    // 系统账号的邮箱已被另一个 ID 占用，说明 SYSTEM_ACTOR_ID 改过。不能悄悄换成新账号，
    // 否则历史处置记录与之后的记录会指向两个不同的执行者。
    const [other] = await tx
      .select({ id: authUser.id })
      .from(authUser)
      .where(eq(authUser.email, SYSTEM_ACTOR_EMAIL))
      .limit(1);
    if (other) {
      throw new Error(
        `bootstrap.system_actor_mismatch: ${SYSTEM_ACTOR_EMAIL} already belongs to ${other.id}; set SYSTEM_ACTOR_ID to that id`,
      );
    }
    await tx.insert(authUser).values({
      id,
      email: SYSTEM_ACTOR_EMAIL,
      name: "char.pub system",
      emailVerified: true,
    });
    await appendAudit(tx, {
      at: now,
      actor: { kind: "system", id: "bootstrap" },
      action: "bootstrap.system_actor",
      subject: `user:${id}`,
    });
    return true;
  });
}

export type PromoteResult =
  | { ok: true; user_id: string }
  | { ok: false; code: "bootstrap.owner_exists" | "bootstrap.user_not_found" };

export async function promoteFirstOwner(db: Db, email: string, now: Date): Promise<PromoteResult> {
  return db.transaction(async (tx) => {
    const owners = await tx
      .select({ id: authUser.id })
      .from(authUser)
      .where(
        or(
          eq(authUser.role, "owner"),
          like(authUser.role, "owner,%"),
          like(authUser.role, "%,owner"),
          like(authUser.role, "%,owner,%"),
        ),
      )
      .limit(1)
      .for("update");
    if (owners.length > 0) return { ok: false as const, code: "bootstrap.owner_exists" as const };
    const [user] = await tx
      .select()
      .from(authUser)
      .where(eq(authUser.email, email.toLowerCase()))
      .limit(1);
    if (!user) return { ok: false as const, code: "bootstrap.user_not_found" as const };
    await tx
      .update(authUser)
      .set({ role: "owner", updatedAt: now })
      .where(eq(authUser.id, user.id));
    await appendAudit(tx, {
      at: now,
      actor: { kind: "system", id: "bootstrap" },
      action: "staff.bootstrap_owner",
      subject: `user:${user.id}`,
      before: { role: user.role },
      after: { role: "owner" },
    });
    return { ok: true as const, user_id: user.id };
  });
}

export async function bootstrapFromArgs(args: readonly string[]): Promise<void> {
  const env = parseEnv(DatabaseEnvSchema);
  const database = createDatabase(env.DATABASE_URL, { max: 2 });
  const now = new Date();
  try {
    if (args.includes("--system-actor")) {
      const { SYSTEM_ACTOR_ID } = parseEnv(WorkerEnvSchema);
      const created = await ensureSystemActor(database.db, SYSTEM_ACTOR_ID, now);
      process.stdout.write(created ? "system actor created\n" : "system actor already exists\n");
    }
    const i = args.indexOf("--owner");
    if (i >= 0) {
      const email = args[i + 1];
      if (!email) throw new Error("--owner needs an email address");
      const r = await promoteFirstOwner(database.db, email, now);
      if (!r.ok) throw new Error(r.code);
      process.stdout.write(`promoted ${email} to owner\n`);
    }
    if (!args.includes("--system-actor") && i < 0) {
      throw new Error("usage: main.js bootstrap [--system-actor] [--owner <email>]");
    }
  } finally {
    await database.close();
  }
}
