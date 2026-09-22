/**
 * 表结构与约束：沿外键链写入一组完整的业务数据，确认唯一约束、语法检查约束
 * 和搜索索引按预期工作。
 */

import { sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as s from "../src/db/schema/index.js";
import { createTestDatabase, pgErrorCode, type TestDatabase } from "./helpers.js";

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const FK_VIOLATION = "23503";
const D = (c: string) => `sha256:${c.repeat(64)}`;

let t: TestDatabase;
const ids = {
  user: uuidv7(),
  ns: uuidv7(),
  creation: uuidv7(),
  dep: uuidv7(),
  revision: uuidv7(),
  release: uuidv7(),
  depRelease: uuidv7(),
  contribution: uuidv7(),
};

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.drop();
});

describe("schema", () => {
  it("accepts a complete graph of related rows", async () => {
    const db = t.app.db;
    await db.transaction(async (tx) => {
      await tx.insert(s.authUser).values({ id: ids.user, email: "a@example.test", name: "A" });
      await tx.insert(s.userSettings).values({ userId: ids.user });
      await tx.insert(s.apiTokens).values({
        id: uuidv7(),
        userId: ids.user,
        name: "cli",
        prefix: "cp_pat_ab",
        tokenHash: D("1"),
        scopes: ["creations:read"],
      });
      await tx.insert(s.guests).values({ guestId: "g_1", displayName: "Guest" });
      await tx
        .insert(s.namespaces)
        .values({ id: ids.ns, slug: "djj", kind: "user", createdBy: ids.user });
      await tx
        .insert(s.namespaceMembers)
        .values({ namespaceId: ids.ns, userId: ids.user, role: "owner" });
      await tx.insert(s.reservedNames).values({ slug: "commons", reason: "system namespace" });
      await tx.insert(s.namespaceRedirects).values({ oldSlug: "old-djj", namespaceId: ids.ns });
      for (const [id, name, type] of [
        [ids.creation, "alice", "character"],
        [ids.dep, "night-city", "world"],
      ] as const) {
        await tx.insert(s.creations).values({
          id,
          namespaceId: ids.ns,
          name,
          type,
          displayName: name,
          rating: "general",
          searchText: `${name} 夜之城`,
          searchGrams: ["夜", "夜之", "之城"],
        });
      }
      await tx
        .insert(s.creationRedirects)
        .values({ namespaceId: ids.ns, oldName: "alicia", creationId: ids.creation });
      await tx
        .insert(s.creationDrafts)
        .values({ creationId: ids.creation, working: {}, updatedBy: ids.user });
      await tx.insert(s.revisions).values({
        id: ids.revision,
        creationId: ids.creation,
        manifestDigest: D("2"),
        semanticDigest: D("2"),
        authorKind: "user",
        authorUserId: ids.user,
      });
      await tx.insert(s.revisionFragments).values({
        revisionId: ids.revision,
        fragmentId: "description",
        digest: D("3"),
        kind: "character",
        stable: true,
        position: 0,
      });
      for (const [id, creationId] of [
        [ids.depRelease, ids.dep],
        [ids.release, ids.creation],
      ] as const) {
        await tx.insert(s.releases).values({
          id,
          creationId,
          label: "1.0.0",
          visibility: "public",
          source: { provider: "native" },
          semanticDigest: D("4"),
          publishedBy: { user: ids.user },
        });
      }
      await tx.insert(s.releaseLocks).values({
        releaseId: ids.release,
        depCreationId: ids.dep,
        depReleaseId: ids.depRelease,
        semanticDigest: D("4"),
        via: ["city"],
      });
      await tx.insert(s.reverseEdges).values({
        depCreationId: ids.dep,
        depReleaseId: ids.depRelease,
        dependentCreationId: ids.creation,
        dependentReleaseId: ids.release,
        mode: "intrinsic",
        rel: "lives_in",
      });
      await tx.insert(s.releaseFragments).values({
        releaseId: ids.release,
        ownerRef: "@djj/night-city",
        fragmentId: "world",
        digest: D("5"),
      });
      await tx
        .insert(s.blobs)
        .values({ digest: D("5"), size: 10, mediaType: "application/json", kind: "fragment" });
      await tx
        .insert(s.blobRefs)
        .values({ digest: D("5"), releaseId: ids.release, role: "fragment" });
      await tx.insert(s.blockedDigests).values({ digest: D("6"), reason: "dmca" });
      await tx
        .insert(s.buildArtifacts)
        .values({ cacheKey: "k", target: "ccv3", blobDigest: D("7") });
      await tx.insert(s.uploads).values({
        id: uuidv7(),
        ownerUserId: ids.user,
        declaredType: "image/png",
        size: 1000,
        stagingKey: "staging/x",
        expiresAt: new Date("2026-09-23T00:00:00Z"),
      });
      await tx
        .insert(s.assetMeta)
        .values({ digest: D("8"), width: 10, height: 10, mediaType: "image/webp" });
      await tx.insert(s.favorites).values({ userId: ids.user, creationId: ids.dep });
      await tx.insert(s.contributions).values({
        id: ids.contribution,
        targetCreationId: ids.creation,
        number: 1,
        authorGuestId: "g_1",
        title: "fix typo",
        baseRevisionId: ids.revision,
        baseSemanticDigest: D("2"),
        transport: { type: "native" },
        rightsAck: { inbound_equals_outbound: true },
      });
      await tx.insert(s.contributionChanges).values({
        id: uuidv7(),
        contributionId: ids.contribution,
        changeKey: "fragment:description",
        on: "fragment",
        op: "modify",
        baseDigest: D("3"),
        position: 0,
      });
      await tx.insert(s.githubInstallations).values({
        installationId: 1n,
        accountId: 2n,
        accountLogin: "octo",
        accountType: "User",
      });
      await tx.insert(s.sourceBindings).values({
        id: uuidv7(),
        creationId: ids.dep,
        repositoryId: 9_007_199_254_740_993n,
        repositoryOwnerId: 2n,
        installationId: 1n,
        path: "char.yaml",
        trackedRef: "refs/heads/main",
        publishRefs: ["refs/heads/main", "refs/tags/*"],
        displayFullName: "octo/night-city",
      });
      await tx.insert(s.webhookDeliveries).values({ deliveryId: "d-1", event: "push" });
      await tx
        .insert(s.oidcJti)
        .values({ jti: "j-1", expiresAt: new Date("2026-09-22T01:00:00Z") });
      await tx.insert(s.reports).values({
        id: uuidv7(),
        reporter: { user: ids.user },
        subjectType: "creation",
        subjectId: ids.creation,
        category: "spam",
      });
      const legalId = uuidv7();
      await tx.insert(s.legalRequests).values({
        id: legalId,
        kind: "dmca",
        requester: { enc: "…" },
        receivedAt: new Date("2026-09-22T00:00:00Z"),
        subjects: [ids.release],
      });
      await tx.insert(s.moderationActions).values({
        id: uuidv7(),
        actorId: ids.user,
        action: "tombstone",
        subject: { release: ids.release },
        reason: "valid DMCA notice received",
        legalRequestId: legalId,
      });
      await tx.insert(s.rateLimits).values({ key: "ip:x", count: 1, windowStart: new Date() });
    });
    const [binding] = await db.select().from(s.sourceBindings);
    // 超过 JS 安全整数范围的 GitHub ID 以 bigint 精确往返。
    expect(binding?.repositoryId).toBe(9_007_199_254_740_993n);
  });

  it("enforces unique (namespace, name) and (creation, label)", async () => {
    expect(
      await pgErrorCode(
        t.app.db.insert(s.creations).values({
          id: uuidv7(),
          namespaceId: ids.ns,
          name: "alice",
          type: "character",
          displayName: "dup",
          rating: "general",
        }),
      ),
    ).toBe(UNIQUE_VIOLATION);
    expect(
      await pgErrorCode(
        t.app.db.insert(s.releases).values({
          id: uuidv7(),
          creationId: ids.creation,
          label: "1.0.0",
          visibility: "public",
          source: {},
          semanticDigest: D("9"),
          publishedBy: {},
        }),
      ),
    ).toBe(UNIQUE_VIOLATION);
  });

  it("enforces identifier syntax at the database level too", async () => {
    expect(
      await pgErrorCode(
        t.app.db.insert(s.namespaces).values({ id: uuidv7(), slug: "Bad_Slug", kind: "user" }),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await pgErrorCode(
        t.app.db
          .insert(s.blobs)
          .values({ digest: "md5:abc", size: 1, mediaType: "x/y", kind: "fragment" }),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await pgErrorCode(
        t.app.db.insert(s.moderationActions).values({
          id: uuidv7(),
          actorId: ids.user,
          action: "ban",
          subject: {},
          reason: "short",
        }),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it("enforces unique change keys within a contribution and valid foreign keys", async () => {
    expect(
      await pgErrorCode(
        t.app.db.insert(s.contributionChanges).values({
          id: uuidv7(),
          contributionId: ids.contribution,
          changeKey: "fragment:description",
          on: "fragment",
          op: "remove",
          position: 1,
        }),
      ),
    ).toBe(UNIQUE_VIOLATION);
    expect(
      await pgErrorCode(
        t.app.db.insert(s.favorites).values({ userId: uuidv7(), creationId: ids.creation }),
      ),
    ).toBe(FK_VIOLATION);
  });

  it("finds CJK text through the trigram and n-gram indexes", async () => {
    const tri = await t.app.db.execute<{ name: string }>(
      sql`SELECT name FROM app.creations WHERE search_text ILIKE ${"%夜之城%"} ORDER BY name`,
    );
    expect(tri.rows.map((r) => r.name)).toEqual(["alice", "night-city"]);
    const gram = await t.app.db.execute<{ name: string }>(
      sql`SELECT name FROM app.creations WHERE search_grams @> ARRAY[${"夜之"}]::text[] ORDER BY name`,
    );
    expect(gram.rows.map((r) => r.name)).toEqual(["alice", "night-city"]);
  });
});
