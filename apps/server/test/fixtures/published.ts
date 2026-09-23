/**
 * 测试用的“已发布”数据：直接把 namespace、Creation 和完成发布的 Release 写进数据库和
 * 对象存储，绕过发布流程（发布流程有自己的测试）。
 *
 * 写入的内容与真实发布一致：Creation 由 core 规范化，IR 由 core 的 Resolver 生成，
 * release_locks、reverse_edges、release_fragments、blob_refs 按依赖闭包物化，
 * 快照与 IR 按 Release 的可见性写入 public 或 private 桶。
 */
import {
  type CanonicalCreation,
  type CreationInput,
  canonicalizeCreation,
  type FragmentKind,
  type JSONValue,
  jcs,
  type ReleaseInput,
  resolve,
} from "@char-pub/core";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { Db } from "../../src/db/client.js";
import {
  authUser,
  blobRefs,
  creations,
  namespaceMembers,
  namespaces,
  releaseFragments,
  releaseLocks,
  releases,
  reverseEdges,
  userSettings,
} from "../../src/db/schema/index.js";
import { toPublicId } from "../../src/registry/read.js";
import { refreshSearchColumns } from "../../src/registry/search.js";
import type { Cas } from "../../src/storage/cas.js";

const enc = new TextEncoder();

export async function createUser(db: Db, opts: { name?: string; showMature?: boolean } = {}) {
  const id = uuidv7();
  await db.insert(authUser).values({
    id,
    email: `${id}@example.test`,
    name: opts.name ?? "user",
  });
  if (opts.showMature !== undefined) {
    await db.insert(userSettings).values({
      userId: id,
      showMature: opts.showMature,
      matureConfirmedAt: opts.showMature ? new Date() : null,
    });
  }
  return id;
}

export async function createNamespace(db: Db, slug: string, ownerId?: string) {
  const id = uuidv7();
  await db.insert(namespaces).values({ id, slug, kind: "user", createdBy: ownerId ?? null });
  if (ownerId)
    await db.insert(namespaceMembers).values({ namespaceId: id, userId: ownerId, role: "owner" });
  return id;
}

export interface PublishedRelease {
  releaseId: string;
  publicReleaseId: string;
  creationId: string;
  ref: string;
  label: string;
  visibility: "public" | "private";
  creation: CanonicalCreation;
  semanticDigest: string;
  irDigest: string;
  snapshotDigest: string;
  input: ReleaseInput;
}

export interface PublishOptions {
  db: Db;
  cas: Cas;
  namespaceId: string;
  /** 已存在的 Creation；缺省时新建。 */
  creationId?: string;
  creation: Omit<CreationInput, "id">;
  label: string;
  visibility?: "public" | "private";
  status?: "active" | "yanked" | "tombstoned";
  statusReason?: string;
  dependencies?: readonly PublishedRelease[];
  publicAssetBaseUrl?: string;
  createdAt?: Date;
}

/** 按 `pinOf(dep)` 引用一个已发布的 Release。 */
export function pinOf(dep: PublishedRelease) {
  return { release: dep.publicReleaseId, semantic_digest: dep.semanticDigest };
}

export async function publishRelease(o: PublishOptions): Promise<PublishedRelease> {
  const { db, cas } = o;
  const visibility = o.visibility ?? "public";
  const bucket = visibility === "public" ? "public" : "private";
  let creationId = o.creationId;
  const isNew = !creationId;
  creationId ??= uuidv7();
  const releaseId = uuidv7();
  const publicReleaseId = toPublicId("release", releaseId);

  const { creation, semantic_digest, json } = canonicalizeCreation({
    ...o.creation,
    id: toPublicId("creation", creationId),
  });
  const [, name] = creation.ref.slice(1).split("/");
  if (!name) throw new Error("bad ref");

  const deps = o.dependencies ?? [];
  // 依赖闭包：直接依赖加上它们各自的闭包（与发布时一样按 Release 去重）。
  const closure = new Map<string, PublishedRelease>();
  const collect = (d: PublishedRelease) => {
    if (closure.has(d.releaseId)) return;
    closure.set(d.releaseId, d);
    for (const x of registry.get(d.releaseId) ?? []) collect(x);
  };
  for (const d of deps) collect(d);

  const input: ReleaseInput = { release: publicReleaseId, visibility, creation: json };
  const resolved = resolve({
    root: input,
    dependencies: [...closure.values()].map((d) => d.input),
    ...(o.publicAssetBaseUrl ? { publicAssetBaseUrl: o.publicAssetBaseUrl } : {}),
  });

  const snapshot = enc.encode(
    jcs({
      creation: json,
      closure: [...closure.values()].map((d) => d.input.creation) as JSONValue[],
    } as JSONValue),
  );
  const snap = await cas.putBlob(db, {
    bucket,
    bytes: snapshot,
    mediaType: "application/json",
    kind: "snapshot",
  });
  const ir = await cas.putBlob(db, {
    bucket,
    bytes: enc.encode(resolved.json),
    mediaType: "application/vnd.char.context-ir+json",
    kind: "ir",
  });
  // fragment 的 CAS key 就是它的 digest：对象内容是去掉 digest 字段后的 canonical JSON。
  for (const f of creation.fragments) {
    const { digest, ...body } = f;
    await cas.putBlob(db, {
      bucket,
      bytes: enc.encode(jcs(body as unknown as JSONValue)),
      mediaType: "application/json",
      kind: "fragment",
      digest,
    });
  }

  if (isNew) {
    await db.insert(creations).values({
      id: creationId,
      namespaceId: o.namespaceId,
      name,
      type: creation.type,
      displayName: creation.display_name,
      summary: creation.summary ?? null,
      rating: creation.meta.rating,
      tags: creation.meta.tags ?? [],
    });
  }
  const createdAt = o.createdAt ?? new Date();
  await db.insert(releases).values({
    id: releaseId,
    creationId,
    label: o.label,
    visibility,
    status: o.status ?? "active",
    statusReason: o.statusReason ?? null,
    publishState: "done",
    source: { provider: "native" },
    semanticDigest: semantic_digest,
    lockDigest: resolved.ir.lock_digest,
    snapshotDigest: snap.digest,
    contextIrDigest: ir.digest,
    availability: "complete",
    effectiveRating: resolved.ir.meta.rating,
    licenseCheck: "pass",
    publishedBy: { user: "test" },
    createdAt,
  });
  await db
    .update(creations)
    .set({ latestReleaseId: releaseId, effectiveRating: resolved.ir.meta.rating })
    .where(eq(creations.id, creationId));

  // 物化：依赖闭包、反向依赖、闭包中的 fragment 与 blob 反向引用。
  for (const d of closure.values()) {
    await db.insert(releaseLocks).values({
      releaseId,
      depCreationId: d.creationId,
      depReleaseId: d.releaseId,
      semanticDigest: d.semanticDigest,
      via: resolved.lock.find((l) => l.release === d.publicReleaseId)?.via ?? [],
    });
  }
  for (const d of deps) {
    const edge = creation.references.find(
      (e) =>
        "release" in (e.pin ?? {}) && (e.pin as { release: string }).release === d.publicReleaseId,
    );
    await db.insert(reverseEdges).values({
      depCreationId: d.creationId,
      depReleaseId: d.releaseId,
      dependentCreationId: creationId,
      dependentReleaseId: releaseId,
      mode: edge?.mode ?? "default",
      rel: edge?.rel ?? null,
    });
  }
  const fragmentRows = new Map<string, { ownerRef: string; fragmentId: string; digest: string }>();
  for (const c of [creation, ...[...closure.values()].map((d) => d.creation)]) {
    for (const f of c.fragments) {
      fragmentRows.set(`${c.ref}#${f.id}`, { ownerRef: c.ref, fragmentId: f.id, digest: f.digest });
    }
  }
  for (const f of fragmentRows.values()) {
    await db.insert(releaseFragments).values({ releaseId, ...f });
    await db
      .insert(blobRefs)
      .values({ digest: f.digest, releaseId, role: "fragment" })
      .onConflictDoNothing();
  }
  await db.insert(blobRefs).values([
    { digest: snap.digest, releaseId, role: "snapshot" },
    { digest: ir.digest, releaseId, role: "ir" },
  ]);
  for (const a of resolved.ir.assets) {
    await db
      .insert(blobRefs)
      .values({ digest: a.digest, releaseId, role: "asset" })
      .onConflictDoNothing();
  }
  await refreshSearchColumns(db, creationId);

  const out: PublishedRelease = {
    releaseId,
    publicReleaseId,
    creationId,
    ref: creation.ref,
    label: o.label,
    visibility,
    creation,
    semanticDigest: semantic_digest,
    irDigest: ir.digest,
    snapshotDigest: snap.digest,
    input: { ...input, semantic_digest },
  };
  registry.set(releaseId, [...closure.values()]);
  return out;
}

/** 每个已发布 Release 的依赖闭包，用来给下游 Release 物化完整闭包。 */
const registry = new Map<string, PublishedRelease[]>();

export const META = {
  default_locale: "en",
  rating: "general",
  rights: "original",
  license: "CC-BY-4.0",
} as const;

export function textFragment(id: string, kind: FragmentKind, text: string) {
  return { id, stable: true, kind, content: { type: "text" as const, text } };
}
