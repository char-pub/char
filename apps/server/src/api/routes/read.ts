/**
 * 公开读取接口：Creation 详情、Release 详情、Release 的源内容、IR 下载、CCv3 导出、反向依赖。
 *
 * - 私有内容对无权访问的人一律 404，不暴露它是否存在。
 * - namespace 或 Creation 改名后，旧地址 301 到新地址，路径的其余部分保持不变。
 * - tombstoned 的 Release 返回 410 和公开的原因代码；yanked 的 Release 正常返回并附带警告。
 * - public 内容通过 CDN 直出：IR 等对象 302 到内容寻址的公共 URL，可以永久缓存；
 *   private 内容 302 到短期签名 URL，响应本身不缓存。
 */
import { CharError, isCharError } from "@char-pub/core";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { Hono } from "hono";
import type { Resource } from "../../authz/authorize.js";
import {
  blockedDigests,
  buildArtifacts,
  creations,
  namespaces,
  releases,
  reverseEdges,
  revisions,
} from "../../db/schema/index.js";
import { problem } from "../../http/middleware.js";
import { QUEUE_NAMES } from "../../jobs/definitions.js";
import { authorizedRelease, readArtifact } from "../../registry/artifacts.js";
import { loadRevisionContent } from "../../registry/content.js";
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

function yankWarning(r: ReleaseRow): string | undefined {
  if (r.status !== "yanked") return undefined;
  return `release ${r.label} was yanked${r.statusReason ? `: ${r.statusReason}` : ""}`;
}

/** Release 对应的 Revision：发布时记录在 Release 上；没有记录时按内容 digest 查找。 */
async function revisionOf(c: AppContext, f: FoundCreation, r: ReleaseRow): Promise<string | null> {
  if (r.revisionId) return r.revisionId;
  const [rev] = await c.var.services.db
    .select({ id: revisions.id })
    .from(revisions)
    .where(
      and(eq(revisions.creationId, f.creation.id), eq(revisions.semanticDigest, r.semanticDigest)),
    )
    .limit(1);
  return rev?.id ?? null;
}

export function register(app: Hono<Env>): void {
  route(app, {
    method: "get",
    path: `${CREATION_PATH}/releases/:label/avatar`,
    authorize: loadRelease,
    handler: async (c, { loaded: { f, r } }) => {
      c.header("cache-control", "private, no-store");
      if (r.status === "tombstoned") return gone(c, f, r);
      const { cas, db } = c.var.services;
      const artifact = await readArtifact(cas, r, c.var.services.publicAssetBaseUrl);
      const digest = artifact.assets.find(
        (a) =>
          a.origin.creation === artifact.root.ref &&
          a.origin.slot === "avatar" &&
          a.availability === "mirrored",
      )?.digest;
      if (!digest) return notFound(c);
      const [blocked] = await db
        .select()
        .from(blockedDigests)
        .where(eq(blockedDigests.digest, digest))
        .limit(1);
      if (blocked) return notFound(c);
      return c.redirect(
        isPublicRelease(r)
          ? publicObjectUrl(c.var.services.publicAssetBaseUrl, digest)
          : await cas.signedGet(digest),
        302,
      );
    },
  });
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
        artifact_digest: r.artifactDigest,
        license_check: r.licenseCheck,
        availability: r.availability,
      };
      const warning = yankWarning(r);
      if (warning) body.warning = warning;
      c.header("cache-control", isPublicRelease(r) ? PUBLIC_READ_CACHE : PRIVATE_CACHE);
      return c.json(body);
    },
  });

  // Release 的源内容：它对应的 Revision 与 canonical Creation。提交 Contribution 时在这份
  // 内容上修改，变更的 base_digest 按它计算。可见性与读取 Release 完全相同。
  // 内容不可变，但 Release 之后可能被下架，而下架只清除 CDN 上的内容寻址对象，所以这里
  // 与 Release 详情一样只做短时缓存，不做永久缓存。
  route(app, {
    method: "get",
    path: `${CREATION_PATH}/releases/:label/source`,
    authorize: loadRelease,
    handler: async (c, { loaded: { f, r } }) => {
      if (r.status === "tombstoned") return gone(c, f, r);
      const revisionId = await revisionOf(c, f, r);
      if (!revisionId) {
        return problem(c, 404, "release.source_unavailable", "this release has no stored source");
      }
      let content: Awaited<ReturnType<typeof loadRevisionContent>>;
      try {
        content = await loadRevisionContent(c.var.services.cas, r.semanticDigest);
      } catch (e) {
        if (isCharError(e) && e.code === "registry.revision_corrupt") {
          return problem(
            c,
            410,
            "release.source_unavailable",
            "the stored source is no longer available",
          );
        }
        throw e;
      }
      const warning = yankWarning(r);
      c.header("cache-control", isPublicRelease(r) ? PUBLIC_READ_CACHE : PRIVATE_CACHE);
      return c.json({
        revision: toPublicId("revision", revisionId),
        semantic_digest: r.semanticDigest,
        creation: content.json,
        ...(warning ? { warning } : {}),
      });
    },
  });

  route(app, {
    method: "get",
    path: `${CREATION_PATH}/releases/:label/artifact`,
    authorize: loadRelease,
    handler: async (c, { loaded: { f, r } }) => {
      if (r.status === "tombstoned") return gone(c, f, r);
      if (!r.artifactDigest) {
        c.header("cache-control", isPublicRelease(r) ? PUBLIC_READ_CACHE : PRIVATE_CACHE);
        return c.json(await readArtifact(c.var.services.cas, r, c.var.services.publicAssetBaseUrl));
      }
      c.header("cache-control", isPublicRelease(r) ? IMMUTABLE_CACHE : PRIVATE_CACHE);
      return c.redirect(
        isPublicRelease(r)
          ? publicObjectUrl(c.var.services.publicAssetBaseUrl, r.artifactDigest)
          : await c.var.services.cas.signedGet(r.artifactDigest),
        302,
      );
    },
  });

  route(app, {
    method: "get",
    path: `${CREATION_PATH}/releases/:label/ir`,
    authorize: loadRelease,
    handler: async (c, { loaded: { f, r } }) => {
      if (r.status === "tombstoned") return gone(c, f, r);
      if (f.creation.type === "preset" || f.creation.type === "prompt-module")
        return problem(
          c,
          422,
          "release.ir_not_applicable",
          "policy works provide an artifact, not a content IR",
        );
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
      if (f.creation.type === "preset" || f.creation.type === "prompt-module")
        return problem(c, 422, "export.not_applicable", "select a content release to export CCv3");
      const { db, cas, queue } = c.var.services;
      const part = c.req.query("part");
      if (part !== undefined && part !== "card" && part !== "loss")
        return problem(c, 400, "export.invalid_part", "part must be card or loss");
      const selected = c.req.query("preset");
      const presetRelease = selected
        ? await authorizedRelease(db, c.var.principal, selected)
        : null;
      if (selected && !presetRelease) return notFound(c);
      if (presetRelease?.row.status === "tombstoned") return problem(c, 410, "release.tombstoned");
      if (presetRelease && presetRelease.creation.type !== "preset")
        return problem(c, 422, "export.not_preset", "the selected release must be a Preset");
      const publicExport =
        isPublicRelease(r) && (!presetRelease || isPublicRelease(presetRelease.row));
      const key = exportCacheKey({
        semantic_digest: r.semanticDigest,
        lock_digest: r.lockDigest ?? "",
        target: "ccv3",
        compiler_version: presetRelease
          ? `${CCV3_EXPORT_VERSION}:preset:${presetRelease.row.id}:${presetRelease.row.semanticDigest}:bucket:${publicExport ? "public" : "private"}`
          : CCV3_EXPORT_VERSION,
      });
      const [hit] = await db
        .select()
        .from(buildArtifacts)
        .where(eq(buildArtifacts.cacheKey, key))
        .limit(1);
      if (hit) {
        if (part) {
          const bytes = await cas.getBlob(publicExport ? "public" : "private", hit.blobDigest);
          const output = JSON.parse(new TextDecoder().decode(bytes)) as {
            card: Record<string, unknown>;
            loss: Record<string, unknown>;
          };
          c.header("cache-control", PRIVATE_CACHE);
          c.header(
            "content-disposition",
            `attachment; filename="${f.creation.name}-${r.label}${part === "loss" ? "-loss" : ""}.json"`,
          );
          return c.json(output[part]);
        }
        if (publicExport) {
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
          {
            release_id: r.id,
            target: "ccv3",
            cache_key: key,
            ...(presetRelease ? { preset_release_id: presetRelease.row.id } : {}),
            ...(publicExport ? {} : { private_output: true }),
          },
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
