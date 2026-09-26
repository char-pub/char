/**
 * 发布校验：一个 Revision 能不能发布成 Release。
 *
 * 全部通过才能进入 active 状态：
 * 1. 每条 edge 都 pin 到精确的 Release，不能 follow latest；
 * 2. 依赖闭包中没有 tombstoned 的 Release（有 yanked 的只警告）；
 * 3. public Release 的闭包里只能有 public Release；
 * 4. 同一个 Creation 在闭包里只能有一个 Release；
 * 5. override 的目标都是 stable fragment；
 * 6. 必需的 slot 都已绑定，或者是 late；
 * 7. 引用的每个 asset 都已经处理完成（ready）；
 * 8. Creation、依赖和 asset 的许可相容，且 char.pub 可以再分发；
 * 9. 同一 Creation 的这个 label 还没有被占用（相同内容重复发布是幂等的）。
 *
 * 另外：内容的 digest 在下架黑名单里时拒绝发布，防止被下架的内容换个名字重新上架。
 *
 * 这些规则需要 Registry 的状态（label 是否被占用、asset 状态、黑名单），由调用方
 * 以纯数据形式传入；core 本身不做 IO。
 */

import { type BuildCreationOutput, buildCreation } from "./build.js";
import {
  type CanonicalCreation,
  canonicalizeCreation,
  type Digest,
  digestOf,
} from "./canonical.js";
import { checkCreation, checkEdgeBindings, checkOverrideTargets } from "./check.js";
import { getCreationDependencies } from "./dependencies.js";
import { CharError, compareStrings, isCharError } from "./errors.js";
import { parseCreationRef } from "./ids.js";
import {
  checkDependencyLicense,
  combineLicenseChecks,
  isRedistributable,
  type LicenseCheck,
} from "./license.js";
import { resolveUseRef } from "./resolve/graph.js";
import type { ReleaseInput, ResolveOutput } from "./resolve/index.js";
import type { CreationArtifact } from "./schema/artifact.js";

export type PublishSeverity = "error" | "warning";

export interface PublishIssue {
  code: string;
  subject: string;
  severity: PublishSeverity;
  detail?: string;
  data?: Record<string, unknown>;
}

export interface PublishInput {
  release: string;
  label: string;
  visibility: "public" | "private";
  /** 要发布的 Creation（任意书写形式）。 */
  creation: unknown;
  /** 依赖闭包中的 Release，状态为当前 Registry 状态。 */
  dependencies: readonly ReleaseInput[];
  registry: {
    /** 这个 Creation 已经用过的 label → 那个 Release 的 semantic digest。 */
    existingLabels: Readonly<Record<string, string>>;
    /** asset blob digest → 上传状态。缺失视为不存在。 */
    assetStatus: Readonly<Record<string, "ready" | "processing" | "rejected" | "quarantined">>;
    /** 被下架的内容 digest（fragment、asset、manifest）。 */
    blockedDigests: ReadonlySet<string>;
    /** 与发布者属于同一权利人的 namespace（通常是发布者自己的 namespace）。 */
    ownerNamespaces: ReadonlySet<string>;
  };
  publicAssetBaseUrl?: string;
}

export interface PublishReport {
  ok: boolean;
  /** 同一 label 已发布过相同内容：调用方应直接返回已有的 Release。 */
  idempotent: boolean;
  issues: PublishIssue[];
  license_check: "pass" | "warn" | "fail";
  semantic_digest?: Digest;
  resolved?: ResolveOutput;
  artifact?: CreationArtifact;
  build?: BuildCreationOutput;
}

class Issues {
  list: PublishIssue[] = [];
  error(code: string, subject: string, detail?: string, data?: Record<string, unknown>) {
    this.list.push(clean({ code, subject, severity: "error", detail, data }));
  }
  warn(code: string, subject: string, detail?: string, data?: Record<string, unknown>) {
    this.list.push(clean({ code, subject, severity: "warning", detail, data }));
  }
  get hasErrors() {
    return this.list.some((i) => i.severity === "error");
  }
}

function clean(i: {
  code: string;
  subject: string;
  severity: PublishSeverity;
  detail: string | undefined;
  data: Record<string, unknown> | undefined;
}): PublishIssue {
  const out: PublishIssue = { code: i.code, subject: i.subject, severity: i.severity };
  if (i.detail !== undefined) out.detail = i.detail;
  if (i.data !== undefined) out.data = i.data;
  return out;
}

function namespaceOf(ref: string): string {
  return parseCreationRef(ref)?.namespace ?? "";
}

export function checkPublish(input: PublishInput): PublishReport {
  const issues = new Issues();
  const fail = (license: LicenseCheck["verdict"] = "pass"): PublishReport => ({
    ok: false,
    idempotent: false,
    issues: sortIssues(issues.list),
    license_check: license,
  });

  let creation: CanonicalCreation;
  let semantic_digest: Digest;
  try {
    ({ creation, semantic_digest } = canonicalizeCreation(input.creation));
  } catch (e) {
    if (!isCharError(e)) throw e;
    issues.error(e.code, e.subject, e.detail, e.data);
    return fail();
  }

  // 规则 9：label 占用。相同内容视为幂等成功，其余检查没有必要再做。
  const existing = input.registry.existingLabels[input.label];
  if (existing !== undefined) {
    if (existing === semantic_digest) {
      return { ok: true, idempotent: true, issues: [], license_check: "pass", semantic_digest };
    }
    issues.error(
      "publish.label_taken",
      input.label,
      "this label already points to different content; choose a new label",
    );
    return fail();
  }

  const local = checkCreation(creation);
  for (const d of local.diagnostics) {
    if (d.severity === "error") issues.error(d.code, d.subject, d.detail);
    else if (d.severity === "warning") issues.warn(d.code, d.subject, d.detail);
  }

  // 规则 1：pin 必须精确。先于 resolve 检查，给出所有未 pin 的 edge，而不是只报第一条。
  for (const edge of getCreationDependencies(creation)) {
    if (!edge.pin || !("release" in edge.pin)) {
      issues.error(
        "publish.unpinned",
        `references[${edge.id}]`,
        "pin an exact release before publishing",
      );
    }
  }

  // 下架黑名单：fragment、asset 与整体 manifest。
  const blocked = input.registry.blockedDigests;
  if (blocked.has(semantic_digest)) issues.error("publish.blocked_content", "creation");
  for (const f of creation.fragments) {
    if (blocked.has(f.digest)) issues.error("publish.blocked_content", `fragments[${f.id}]`);
  }
  for (const s of creation.assets) {
    for (const v of s.variants) {
      if (blocked.has(v.blob.digest)) {
        issues.error("publish.blocked_content", `assets[${s.slot}/${v.id}]`);
      }
    }
  }
  for (const block of creation.policy?.blocks ?? creation.prompt_module?.blocks ?? []) {
    if (blocked.has(digestOf(block)))
      issues.error("publish.blocked_content", `policy.blocks[${block.id}]`);
  }
  if (issues.hasErrors) return fail();

  const byRelease = new Map(input.dependencies.map((d) => [d.release, d]));
  const depCreations = new Map<string, CanonicalCreation>();
  for (const d of input.dependencies) {
    try {
      depCreations.set(d.release, canonicalizeCreation(d.creation).creation);
    } catch (e) {
      if (!isCharError(e)) throw e;
      issues.error(e.code, d.release, e.detail);
    }
  }

  // 规则 5、6：override 目标与 slot 绑定。按被引用的 Creation 检查。
  const checkEdges = (c: CanonicalCreation) => {
    for (const edge of c.references) {
      if (!edge.pin || !("release" in edge.pin)) continue;
      const target = depCreations.get(edge.pin.release);
      if (!target) continue;
      const ctx = { dependentType: c.type };
      for (const r of [
        checkOverrideTargets(edge, target, ctx),
        checkEdgeBindings(edge, target, ctx),
      ]) {
        for (const d of r.diagnostics) {
          const subject = `${c.ref}:${d.subject}`;
          if (d.severity === "error") issues.error(d.code, subject, d.detail);
          else if (d.severity === "warning") issues.warn(d.code, subject, d.detail);
        }
      }
    }
  };
  checkEdges(creation);
  if (issues.hasErrors) return fail();

  // 规则 2、4 以及 pin 的一致性由 Resolver 检查；它的错误带有解释用的路径。
  let built: BuildCreationOutput;
  try {
    built = buildCreation({
      root: { release: input.release, visibility: input.visibility, creation },
      dependencies: input.dependencies,
      ...(input.publicAssetBaseUrl ? { publicAssetBaseUrl: input.publicAssetBaseUrl } : {}),
    });
  } catch (e) {
    if (!isCharError(e)) throw e;
    const code =
      e.code === "resolve.diamond_conflict"
        ? "publish.diamond_conflict"
        : e.code === "resolve.tombstoned"
          ? "publish.tombstoned_dependency"
          : e.code;
    issues.error(code, e.subject, e.detail, e.data);
    return fail();
  }
  for (const w of built.warnings) {
    if (w.code === "resolve.yanked")
      issues.warn("publish.yanked_dependency", w.subject, w.detail, w.data);
  }

  const closure = built.lock
    .map((l) => byRelease.get(l.release))
    .filter((d): d is ReleaseInput => d !== undefined);

  // 规则 3：public 只能依赖 public。
  if (input.visibility === "public") {
    for (const l of built.lock) {
      const d = byRelease.get(l.release);
      if (d?.visibility !== "public") {
        issues.error(
          "publish.public_depends_on_private",
          l.ref,
          "a public release can only depend on public releases",
          { via: l.via },
        );
      }
    }
  }

  // 规则 7：asset 必须 ready。闭包中所有被纳入 IR 的 asset 都要检查。
  for (const a of built.artifact.assets) {
    if (a.availability === "linked") continue;
    const status = input.registry.assetStatus[a.digest];
    if (status !== "ready") {
      issues.error(
        "publish.asset_not_ready",
        a.id,
        status === undefined ? "asset was never uploaded" : `asset is ${status}`,
      );
    }
    if (blocked.has(a.digest)) issues.error("publish.blocked_content", a.id);
  }
  // IR fragment 的 digest 覆盖渲染后的内容，与黑名单里的原始 fragment digest 不同，
  // 所以检查闭包中依赖的原始 fragment。
  for (const d of closure) {
    const c = depCreations.get(d.release);
    if (c && blocked.has(canonicalizeCreation(c).semantic_digest))
      issues.error("publish.blocked_content", c.ref);
    for (const block of c?.policy?.blocks ?? c?.prompt_module?.blocks ?? []) {
      if (blocked.has(digestOf(block)))
        issues.error("publish.blocked_content", `${c?.ref}#${block.id}`);
    }
    for (const f of c?.fragments ?? []) {
      if (blocked.has(f.digest)) issues.error("publish.blocked_content", `${c?.ref}#${f.id}`);
    }
  }

  // 规则 8：许可。
  const ownerNs = input.registry.ownerNamespaces;
  const sameOwner = (ref: string) => ownerNs.has(namespaceOf(ref));
  const licenseChecks: LicenseCheck[] = [
    isRedistributable(creation.meta.license, { same_owner: sameOwner(creation.ref) }),
  ];
  const modifiedRefs = new Set<string>();
  const collectModified = (c: CanonicalCreation) => {
    for (const e of c.references) {
      if ((e.override ?? []).some((o) => o.op !== "patch")) {
        modifiedRefs.add(resolveUseRef(e.use, c.ref));
      }
    }
  };
  collectModified(creation);
  for (const d of closure) {
    const c = depCreations.get(d.release);
    if (c) collectModified(c);
  }
  for (const l of built.artifact.meta.licenses) {
    if (l.ref === creation.ref && l.asset === undefined) continue;
    const check =
      l.ref === creation.ref
        ? isRedistributable(l.license, { same_owner: sameOwner(l.ref) })
        : checkDependencyLicense({
            dependent: creation.meta.license,
            dependency: l.license,
            same_owner: sameOwner(l.ref),
            modified: l.asset === undefined && modifiedRefs.has(l.ref),
          });
    licenseChecks.push(check);
  }
  // A compatible root license must not hide a dependency's own incompatible declaration.
  for (const dependency of closure) {
    const dependent = depCreations.get(dependency.release);
    if (!dependent || dependent.meta.license === creation.meta.license) continue;
    for (const edge of getCreationDependencies(dependent)) {
      if (!edge.pin || !("release" in edge.pin)) continue;
      const target = depCreations.get(edge.pin.release);
      if (!target) continue;
      const reference = dependent.references.find((item) => item.id === edge.id);
      licenseChecks.push(
        checkDependencyLicense({
          dependent: dependent.meta.license,
          dependency: target.meta.license,
          same_owner: sameOwner(target.ref),
          modified:
            edge.domain === "content" &&
            (reference?.override ?? []).some((item) => item.op !== "patch"),
        }),
      );
    }
  }
  const license = combineLicenseChecks(licenseChecks);
  for (const r of license.reasons) {
    if (r.verdict === "fail") issues.error(r.code, "license", r.detail);
    else issues.warn(r.code, "license", r.detail);
  }

  const ok = !issues.hasErrors;
  const report: PublishReport = {
    ok,
    idempotent: false,
    issues: sortIssues(issues.list),
    license_check: license.verdict,
    semantic_digest,
  };
  if (ok) {
    report.artifact = built.artifact;
    report.build = built;
    if (built.resolved) report.resolved = built.resolved;
  }
  return report;
}

function sortIssues(list: PublishIssue[]): PublishIssue[] {
  const rank = (s: PublishSeverity) => (s === "error" ? 0 : 1);
  return [...list].sort(
    (a, b) =>
      rank(a.severity) - rank(b.severity) ||
      compareStrings(a.code, b.code) ||
      compareStrings(a.subject, b.subject),
  );
}

/** 发布失败时抛出的错误，附带完整报告。 */
export function assertPublishable(input: PublishInput): PublishReport {
  const r = checkPublish(input);
  if (!r.ok) {
    const first = r.issues.find((i) => i.severity === "error");
    throw new CharError({
      code: first?.code ?? "publish.failed",
      subject: first?.subject ?? input.label,
      ...(first?.detail ? { detail: first.detail } : {}),
      data: { issues: r.issues },
    });
  }
  return r;
}
