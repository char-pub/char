/**
 * 公开读取接口：Creation 详情、Release 详情、IR 下载、CCv3 导出、反向依赖。
 *
 * - 私有内容对无权访问的人一律 404，不暴露它是否存在。
 * - namespace 或 Creation 改名后，旧地址 301 到新地址，路径的其余部分保持不变。
 * - tombstoned 的 Release 返回 410 和公开的原因代码；yanked 的 Release 正常返回并附带警告。
 * - public 内容通过 CDN 直出：IR 等对象 302 到内容寻址的公共 URL，可以永久缓存；
 *   private 内容 302 到短期签名 URL，响应本身不缓存。
 */
import { CharError } from "@char-pub/core";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { Hono } from "hono";
import type { Resource } from "../../authz/authorize.js";
import {
  buildArtifacts,
  creations,
  namespaces,
  releases,
  reverseEdges,
} from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { QUEUE_NAMES } from "../../jobs/definitions.js";
import {
  creationDetail,
  exportCacheKey,
  type FoundCreation,
  findCreation,
  findRelease,
  fromPublicId,
  publicObjectUrl,
  type ReleaseRow,
  refOf,
  releaseSummary,
  toPublicId,
} from "../../registry/read.js";
import { type AppContext, type Env, notFound, route } from "../app.js";

/** 公开读接口在 CDN 上的缓存时间。内容变化（例如下架）时由下架任务主动清除。 */
export const PUBLIC_READ_CACHE = "public, max-age=60, s-maxage=300";
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
export const PRIVATE_CACHE = "private, no-store";

/** CCv3 导出的编译器版本；导出实现变化时递增，旧缓存自然失效。 */
export const CCV3_EXPORT_VERSION = "ccv3-export@0";
/** lazy build 尚未完成时建议客户端等待的秒数。 */
export const EXPORT_RETRY_AFTER_SECONDS = 5;

const NS = ":ns{@[a-z0-9-]+}";
const NAME = ":name{[a-z0-9][a-z0-9-]*}";
export const CREATION_PATH = `/v1/creations/${NS}/${NAME}`;

function params(c: AppContext) {
  return { slug: c.req.param("ns")?.slice(1) ?? "", name: c.req.param("name") ?? "" };
}

function creationResource(f: FoundCreation): Resource {
  return {
    type: "creation",
    id: f.creation.id,
    ns: f.ns,
    has_public_release: f.hasPublicRelease,
    status: f.creation.status,
    contribution_policy: f.creation.contributionPolicy,
  };
}

function releaseResource(f: FoundCreation, r: ReleaseRow): Resource {
  return {
    type: "release",
    id: r.id,
    creation_id: f.creation.id,
    ns: f.ns,
    visibility: r.visibility,
    status: r.status,
    creation_status: f.creation.status,
  };
}

/** 改名后的旧地址：把路径里的 `@ns/name` 换成新名字，其余部分保持不变。 */
function redirectTo(c: AppContext, slug: string, name: string) {
  const u = new URL(c.req.url);
  const { slug: oldSlug, name: oldName } = params(c);
  u.pathname = u.pathname.replace(`/@${oldSlug}/${oldName}`, `/@${slug}/${name}`);
  return c.redirect(`${u.pathname}${u.search}`, 301);
}

/** 查找 Creation；不存在返回 404，旧名返回 301。 */
async function loadCreation(c: AppContext): Promise<FoundCreation | Response> {
  const { slug, name } = params(c);
  const r = await findCreation(c.var.services.db, slug, name, c.var.principal);
  if (r.kind === "missing") return notFound(c);
  if (r.kind === "redirect") return redirectTo(c, r.ns, r.name);
  return r.value;
}

/** 查找 Release，并按授权规则决定是否可见。 */
async function loadRelease(c: AppContext) {
  const f = await loadCreation(c);
  if (f instanceof Response) return f;
  const label = c.req.param("label") ?? "";
  const r = await findRelease(c.var.services.db, f.creation.id, label);
  if (!r) return notFound(c);
  return { action: "release.read" as const, resource: releaseResource(f, r), loaded: { f, r } };
}

/** tombstoned 的 Release：410 加公开的原因代码。 */
function gone(c: AppContext, f: FoundCreation, r: ReleaseRow) {
  return problem(c, 410, "release.tombstoned", "this release was removed", {
    reason: r.statusReason ?? "unspecified",
    ref: `${refOf(f.namespace.slug, f.creation.name)}@${r.label}`,
  });
}

function isPublicRelease(r: ReleaseRow) {
  return r.visibility === "public";
}

export function register(app: Hono<Env>): void {
  // `@ns/name@label` 是 Release 的公共标识写法，重定向到规范路径。重定向本身不暴露任何
  // 信息：目标地址照常做授权，私有 Release 在那里返回 404。
  route(app, {
    method: "get",
    path: `/v1/creations/${NS}/:nameLabel{[a-z0-9][a-z0-9-]*@[0-9A-Za-z.+-]{1,64}}`,
    authorize: async () => ({ public: true, loaded: null }),
    handler: async (c) => {
      const [name, label] = (c.req.param("nameLabel") ?? "").split("@");
      return c.redirect(`/v1/creations/${c.req.param("ns")}/${name}/releases/${label}`, 308);
    },
  });

  route(app, {
    method: "get",
    path: CREATION_PATH,
    authorize: async (c) => {
      const f = await loadCreation(c);
      if (f instanceof Response) return f;
      return { action: "creation.read", resource: creationResource(f), loaded: f };
    },
    handler: async (c, { loaded }) => {
      const detail = await creationDetail(c.var.services.db, loaded, c.var.principal);
      c.header(
        "cache-control",
        loaded.hasPublicRelease && loaded.ns.role === null ? PUBLIC_READ_CACHE : PRIVATE_CACHE,
      );
      return c.json(detail);
    },
  });

  route(app, {
    method: "get",
    path: `${CREATION_PATH}/releases/:label`,
    authorize: loadRelease,
    handler: async (c, { loaded: { f, r } }) => {
      if (r.status === "tombstoned") return gone(c, f, r);
      const body: Record<string, unknown> = {
        ...releaseSummary(r),
        ref: refOf(f.namespace.slug, f.creation.name),
        creation: toPublicId("creation", f.creation.id),
        lock_digest: r.lockDigest,
        context_ir_digest: r.contextIrDigest,
        license_check: r.licenseCheck,
        availability: r.availability,
      };
      if (r.status === "yanked") {
        body.warning = `release ${r.label} was yanked${r.statusReason ? `: ${r.statusReason}` : ""}`;
      }
      c.header("cache-control", isPublicRelease(r) ? PUBLIC_READ_CACHE : PRIVATE_CACHE);
      return c.json(body);
    },
  });

  route(app, {
    method: "get",
    path: `${CREATION_PATH}/releases/:label/ir`,
    authorize: loadRelease,
    handler: async (c, { loaded: { f, r } }) => {
      if (r.status === "tombstoned") return gone(c, f, r);
      const digest = r.contextIrDigest;
      if (!digest) throw new CharError({ code: "release.ir_missing", subject: r.label });
      if (isPublicRelease(r)) {
        c.header("cache-control", IMMUTABLE_CACHE);
        return c.redirect(publicObjectUrl(c.var.services.publicAssetBaseUrl, digest), 302);
      }
      c.header("cache-control", PRIVATE_CACHE);
      return c.redirect(await c.var.services.cas.signedGet(digest), 302);
    },
  });

  route(app, {
    method: "get",
    path: `${CREATION_PATH}/releases/:label/export/ccv3`,
    authorize: loadRelease,
    handler: async (c, { loaded: { f, r } }) => {
      if (r.status === "tombstoned") return gone(c, f, r);
      const { db, cas, queue } = c.var.services;
      const key = exportCacheKey({
        semantic_digest: r.semanticDigest,
        lock_digest: r.lockDigest ?? "",
        target: "ccv3",
        compiler_version: CCV3_EXPORT_VERSION,
      });
      const [hit] = await db
        .select()
        .from(buildArtifacts)
        .where(eq(buildArtifacts.cacheKey, key))
        .limit(1);
      if (hit) {
        if (isPublicRelease(r)) {
          c.header("cache-control", IMMUTABLE_CACHE);
          return c.redirect(
            publicObjectUrl(c.var.services.publicAssetBaseUrl, hit.blobDigest),
            302,
          );
        }
        c.header("cache-control", PRIVATE_CACHE);
        return c.redirect(await cas.signedGet(hit.blobDigest), 302);
      }
      await db.transaction(async (tx) => {
        await queue.enqueue(
          tx,
          QUEUE_NAMES.exportBuild,
          { release_id: r.id, target: "ccv3", cache_key: key },
          { singletonKey: `export:${key}` },
        );
      });
      c.header("retry-after", String(EXPORT_RETRY_AFTER_SECONDS));
      c.header("cache-control", "no-store");
      return c.json({ state: "building", retry_after: EXPORT_RETRY_AFTER_SECONDS }, 202);
    },
  });

  route(app, {
    method: "get",
    path: `${CREATION_PATH}/dependents`,
    authorize: async (c) => {
      const f = await loadCreation(c);
      if (f instanceof Response) return f;
      return { action: "creation.read", resource: creationResource(f), loaded: f };
    },
    handler: async (c, { loaded: f }) => {
      const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 20) || 20, 1), 100);
      const cursor = decodeCursor(c.req.query("cursor"));
      // 只列出 public 的依赖方：私有作品不会因为依赖了某个公开作品而暴露出来。
      const rows = await c.var.services.db
        .select({
          creationId: creations.id,
          name: creations.name,
          slug: namespaces.slug,
          type: creations.type,
          displayName: creations.displayName,
          releaseId: releases.id,
          label: releases.label,
          mode: reverseEdges.mode,
          rel: reverseEdges.rel,
        })
        .from(reverseEdges)
        .innerJoin(releases, eq(releases.id, reverseEdges.dependentReleaseId))
        .innerJoin(creations, eq(creations.id, reverseEdges.dependentCreationId))
        .innerJoin(namespaces, eq(namespaces.id, creations.namespaceId))
        .where(
          and(
            eq(reverseEdges.depCreationId, f.creation.id),
            eq(releases.visibility, "public"),
            eq(releases.publishState, "done"),
            sql`${releases.status} <> 'tombstoned'`,
            eq(creations.status, "active"),
            eq(namespaces.status, "active"),
            cursor ? lt(releases.id, cursor) : sql`true`,
          ),
        )
        .orderBy(desc(releases.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      c.header("cache-control", PUBLIC_READ_CACHE);
      return c.json({
        items: page.map((x) => ({
          ref: refOf(x.slug, x.name),
          type: x.type,
          display_name: x.displayName,
          release: { id: toPublicId("release", x.releaseId), label: x.label },
          mode: x.mode,
          ...(x.rel ? { rel: x.rel } : {}),
        })),
        next_cursor:
          rows.length > limit
            ? toPublicId("release", page[page.length - 1]?.releaseId ?? "")
            : null,
      });
    },
  });
}

/** 分页游标是上一页最后一个依赖方 Release 的对外 ID。 */
function decodeCursor(cursor: string | undefined): string | null {
  return cursor ? fromPublicId("release", cursor) : null;
}
