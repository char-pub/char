/**
 * GitHub Source binding 的生命周期：绑定、改名、push、仓库转移后冻结、作者确认
 * （重新绑定或换用新仓库）、对账补偿，以及 webhook 去重与 OIDC jti 防重放。
 */
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyAuditChain } from "../src/audit/audit.js";
import {
  authUser,
  creations,
  githubInstallations,
  namespaces,
  sourceBindings,
} from "../src/db/schema/index.js";
import {
  applyWebhookEvent,
  bindRepository,
  freezeOnOwnerMismatch,
  resolveFrozenBinding,
} from "../src/github/events.js";
import { DbJtiStore } from "../src/github/jti.js";
import { createTestDatabase, type TestDatabase } from "./helpers.js";

let t: TestDatabase;
const now = new Date("2026-09-22T12:00:00Z");
const userId = uuidv7();
const creationId = uuidv7();
const REPO = "1001";
const OWNER = "2001";
const NEW_OWNER = "2002";
const INSTALL = "3001";

beforeAll(async () => {
  t = await createTestDatabase();
  const db = t.app.db;
  await db.insert(authUser).values({ id: userId, email: "a@example.com", name: "A" });
  const nsId = uuidv7();
  await db.insert(namespaces).values({ id: nsId, slug: "djj", kind: "user", createdBy: userId });
  await db.insert(creations).values({
    id: creationId,
    namespaceId: nsId,
    name: "alice",
    type: "character",
    displayName: "Alice",
    rating: "general",
  });
  await applyWebhookEvent(db, {
    delivery_id: "d-install",
    event: "installation",
    normalized: {
      kind: "installation.created",
      installation_id: INSTALL,
      account_id: OWNER,
      account_login: "djj",
      account_type: "User",
    },
    now,
  });
});
afterAll(async () => {
  await t.drop();
});

async function binding() {
  const [b] = await t.app.db
    .select()
    .from(sourceBindings)
    .where(eq(sourceBindings.creationId, creationId));
  return b;
}

const bindInput = (repo: string, owner: string) => ({
  new_id: uuidv7(),
  creation_id: creationId,
  repository_id: repo,
  repository_owner_id: owner,
  installation_id: INSTALL,
  path: "char.yaml",
  tracked_ref: "refs/heads/main",
  publish_refs: ["refs/heads/main", "refs/tags/*"],
  display_full_name: "djj/alice",
  actor_user_id: userId,
  now,
});

describe("binding lifecycle", () => {
  it("records the installation and binds by numeric ids", async () => {
    const [inst] = await t.app.db.select().from(githubInstallations);
    expect(inst?.installationId).toBe(BigInt(INSTALL));
    expect(await bindRepository(t.app.db, bindInput(REPO, OWNER))).toMatchObject({ ok: true });
    expect((await binding())?.status).toBe("active");
    expect(await bindRepository(t.app.db, bindInput(REPO, OWNER))).toEqual({
      ok: false,
      code: "binding.exists",
    });
  });

  it("a rename only updates the display name", async () => {
    await applyWebhookEvent(t.app.db, {
      delivery_id: "d-rename",
      event: "repository",
      normalized: {
        kind: "repository.renamed",
        repository_id: REPO,
        repository_owner_id: OWNER,
        full_name: "djj/alice-card",
        previous_name: "alice",
      },
      now,
    });
    const b = await binding();
    expect(b?.displayFullName).toBe("djj/alice-card");
    expect(b?.status).toBe("active");
  });

  it("push on the tracked ref records the commit and asks for a sync", async () => {
    const commit = "a".repeat(40);
    const effects = await applyWebhookEvent(t.app.db, {
      delivery_id: "d-push",
      event: "push",
      normalized: {
        kind: "push",
        installation_id: INSTALL,
        repository_id: REPO,
        repository_owner_id: OWNER,
        ref: "refs/heads/main",
        commit,
        default_branch: "main",
        forced: false,
      },
      now,
    });
    expect(effects.sync).toEqual([{ binding_id: (await binding())?.id, commit }]);
    // 同一个 delivery 再投递一次：直接跳过。
    const again = await applyWebhookEvent(t.app.db, {
      delivery_id: "d-push",
      event: "push",
      normalized: null,
      now,
    });
    expect(again.duplicate).toBe(true);
  });

  it("a push from a different owner with the same repository id is ignored", async () => {
    const effects = await applyWebhookEvent(t.app.db, {
      delivery_id: "d-push-evil",
      event: "push",
      normalized: {
        kind: "push",
        installation_id: INSTALL,
        repository_id: REPO,
        repository_owner_id: "9999",
        ref: "refs/heads/main",
        commit: "b".repeat(40),
        default_branch: "main",
        forced: false,
      },
      now,
    });
    expect(effects.sync).toEqual([]);
  });

  it("a transfer freezes the binding until the author confirms", async () => {
    const effects = await applyWebhookEvent(t.app.db, {
      delivery_id: "d-transfer",
      event: "repository",
      normalized: {
        kind: "repository.transferred",
        repository_id: REPO,
        previous_owner_id: OWNER,
        previous_owner_login: "djj",
        new_owner_id: NEW_OWNER,
        new_owner_login: "someone-else",
        full_name: "someone-else/alice-card",
      },
      now,
    });
    expect(effects.frozen).toHaveLength(1);
    const b = await binding();
    expect(b?.status).toBe("frozen");
    expect(b?.frozenReason).toContain("someone-else");
  });

  it("rebinding accepts the new owner", async () => {
    const b = await binding();
    if (!b) throw new Error("no binding");
    expect(
      await resolveFrozenBinding(t.app.db, {
        binding_id: b.id,
        action: "rebind",
        actor_user_id: userId,
        now,
      }),
    ).toEqual({ ok: false, code: "binding.owner_required" });
    expect(
      await resolveFrozenBinding(t.app.db, {
        binding_id: b.id,
        action: "rebind",
        new_owner_id: NEW_OWNER,
        actor_user_id: userId,
        now,
      }),
    ).toEqual({ ok: true });
    const after = await binding();
    expect(after?.status).toBe("active");
    expect(after?.repositoryOwnerId).toBe(BigInt(NEW_OWNER));
    expect(
      await resolveFrozenBinding(t.app.db, {
        binding_id: b.id,
        action: "unbind",
        actor_user_id: userId,
        now,
      }),
    ).toEqual({ ok: false, code: "binding.not_frozen" });
  });

  it("reconciliation freezes on owner mismatch; unbinding allows switching to a new repository", async () => {
    const frozen = await freezeOnOwnerMismatch(t.app.db, {
      repository_id: REPO,
      current_owner_id: "2003",
      now,
    });
    expect(frozen).toHaveLength(1);
    const b = await binding();
    if (!b) throw new Error("no binding");
    expect(
      await resolveFrozenBinding(t.app.db, {
        binding_id: b.id,
        action: "unbind",
        actor_user_id: userId,
        now,
      }),
    ).toEqual({ ok: true });
    expect((await binding())?.status).toBe("unbound");
    const rebound = await bindRepository(t.app.db, bindInput("1002", OWNER));
    expect(rebound).toEqual({ ok: true, binding_id: b.id });
    const nb = await binding();
    expect([nb?.status, nb?.repositoryId]).toEqual(["active", 1002n]);
  });

  it("every state change is audited and the chain is intact", async () => {
    expect((await verifyAuditChain(t.app.db)).ok).toBe(true);
  });

  it("unknown bindings cannot be resolved", async () => {
    expect(
      await resolveFrozenBinding(t.app.db, {
        binding_id: uuidv7(),
        action: "unbind",
        actor_user_id: userId,
        now,
      }),
    ).toEqual({ ok: false, code: "not_found" });
  });
});

describe("installation state and jti store", () => {
  it("suspending and deleting an installation are recorded", async () => {
    for (const kind of ["installation.suspended", "installation.deleted"] as const) {
      await applyWebhookEvent(t.app.db, {
        delivery_id: `d-${kind}`,
        event: "installation",
        normalized: {
          kind,
          installation_id: INSTALL,
          account_id: OWNER,
          account_login: "djj",
          account_type: "User",
        },
        now,
      });
    }
    const [inst] = await t.app.db.select().from(githubInstallations);
    expect(inst?.suspendedAt).toBeTruthy();
    expect(inst?.removedAt).toBeTruthy();
  });

  it("claims each jti once, even concurrently, and purges expired ones", async () => {
    const store = new DbJtiStore(t.app.db, () => now);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => store.claim("jti-1", new Date(now.getTime() + 60_000))),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    await store.claim("jti-old", new Date(now.getTime() - 1000));
    expect(await store.purgeExpired()).toBe(1);
    expect(await store.claim("jti-1", new Date(now.getTime() + 60_000))).toBe(false);
  });
});
