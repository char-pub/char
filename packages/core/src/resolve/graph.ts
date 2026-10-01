/**
 * Resolver 第一阶段：加载依赖图。
 *
 * 从根 Release 出发，沿每个 Reference Edge 的 pin 找到被引用的 Release，建立引用实例
 * （同一个 Release 沿不同路径引入时是不同的实例）。这一阶段只检查图本身：
 *
 * - 每条 edge 必须 pin 到一个精确的 Release，且 pin 里的 semantic digest 与 Release 一致；
 * - 同一个 Creation 在整张图里只能出现一个 Release（单图单版本），否则报告冲突的两条路径；
 * - 不允许环；图的深度和实例数有上限，防止恶意构造的图耗尽资源；
 * - tombstoned 的 Release 直接报错并带上原因；yanked 只产生警告。
 *
 * 渲染（binding、params、override）在第二阶段完成。
 */
import { type CanonicalCreation, canonicalizeCreation, type Digest } from "../canonical.js";
import { CharError, compareStrings } from "../errors.js";
import { parseCreationRef } from "../ids.js";
import { instanceKey, ROOT_INSTANCE } from "../keys.js";
import type { CastMember, CreationInput, ReferenceEdge } from "../schema/creation.js";
import {
  type BuildIdentity,
  buildIdentity,
  buildIdentityKey,
  publishedIdentity,
} from "../schema/identity.js";

export const MAX_GRAPH_DEPTH = 32;
export const MAX_GRAPH_INSTANCES = 5000;

/** Resolver 的一个输入 Release：可见性、状态与 canonical Creation。 */
export interface ReleaseInput {
  release: string;
  visibility: "public" | "private";
  /** 缺省为 active。 */
  status?: "active" | "yanked" | "tombstoned";
  status_reason?: string;
  /** canonical JSON 或任意书写形式，会被重新 canonicalize。 */
  creation: CreationInput | unknown;
  /** 提供时必须与重新计算的结果一致。 */
  semantic_digest?: string;
}

export type RootInput = Omit<ReleaseInput, "release"> & BuildIdentity;

export interface LoadedRelease {
  key: string;
  identity: BuildIdentity;
  ref: string;
  visibility: "public" | "private";
  status: "active" | "yanked" | "tombstoned";
  status_reason: string | undefined;
  creation: CanonicalCreation;
  semantic_digest: Digest;
}

export interface GraphInstance {
  key: string;
  /** Includes typed cast segments; via remains the authored reference path. */
  identityPath: string[];
  /** 从根到这个实例的 edge ID 路径。 */
  via: string[];
  release: LoadedRelease;
  /** Lexical introduction: keeps the original edge and declaring environment, not cast ownership. */
  parent?: { instance: GraphInstance; edge: ReferenceEdge };
  /** Actual reference-reachable children. Cast ownership is a separate relation. */
  children: GraphInstance[];
  /** A role use of this definition, separate from its lexical introduction and release identity. */
  cast?: { owner: GraphInstance; member: CastMember };
}

export interface GraphWarning {
  code: string;
  subject: string;
  detail?: string;
  data?: Record<string, unknown>;
}

export interface LoadedGraph {
  root: GraphInstance;
  /** 深度优先顺序（根优先，edge 按 id 排序）。 */
  instances: GraphInstance[];
  /** 不带版本的 ref → 唯一的 Release。 */
  byRef: Map<string, LoadedRelease>;
  warnings: GraphWarning[];
}

function loadRelease(input: RootInput): LoadedRelease {
  const identity = buildIdentity(input);
  const key = buildIdentityKey(identity);
  if (
    "origin" in identity &&
    (input.visibility !== "private" || (input.status && input.status !== "active"))
  )
    throw new CharError({
      code:
        identity.origin.kind === "draft-build"
          ? "build.invalid_draft_state"
          : "build.invalid_local_state",
      subject: key,
    });
  const { creation, semantic_digest } = canonicalizeCreation(input.creation);
  if (creation.type === "preset" || creation.type === "prompt-module") {
    throw new CharError({
      code: "resolve.preset_not_content",
      subject: creation.ref,
      detail: "presets are policy inputs; use resolvePreset instead of the content resolver",
    });
  }
  if (input.semantic_digest !== undefined && input.semantic_digest !== semantic_digest) {
    throw new CharError({
      code: "resolve.semantic_digest_mismatch",
      subject: key,
      detail: `stored ${input.semantic_digest}, computed ${semantic_digest}`,
    });
  }
  return {
    key,
    identity,
    ref: creation.ref,
    visibility: input.visibility,
    status: input.status ?? "active",
    status_reason: input.status_reason,
    creation,
    semantic_digest,
  };
}

/** 按 edge id 排序后的 references。 */
export function sortedEdges(c: CanonicalCreation): ReferenceEdge[] {
  return [...c.references].sort((a, b) => compareStrings(a.id, b.id));
}

/**
 * `use` 为 `#name` 时指向同一 namespace 下名为 name 的 Creation。
 * 返回不带版本的 ref；`@ns/name@label` 中的 label 只用于展示，锁定靠 pin。
 */
export function resolveUseRef(use: string, declaringRef: string): string {
  if (use.startsWith("#")) {
    const owner = parseCreationRef(declaringRef);
    const name = use.slice(1);
    if (!owner || name.includes("/")) {
      throw new CharError({ code: "resolve.invalid_local_ref", subject: use });
    }
    return `@${owner.namespace}/${name}`;
  }
  const p = parseCreationRef(use);
  if (!p) throw new CharError({ code: "resolve.invalid_ref", subject: use });
  return `@${p.namespace}/${p.name}`;
}

export function loadGraph(root: RootInput, deps: readonly ReleaseInput[]): LoadedGraph {
  const inputs = new Map<string, ReleaseInput>();
  for (const d of deps) {
    publishedIdentity(d);
    inputs.set(d.release, d);
  }
  const loaded = new Map<string, LoadedRelease>();
  const load = (id: string): LoadedRelease | undefined => {
    const cached = loaded.get(id);
    if (cached) return cached;
    const input = inputs.get(id);
    if (!input) return undefined;
    const rel = loadRelease(input);
    loaded.set(id, rel);
    return rel;
  };

  const rootRel = loadRelease(root);
  loaded.set(rootRel.key, rootRel);
  const byRef = new Map<string, LoadedRelease>([[rootRel.ref, rootRel]]);
  const firstVia = new Map<string, string[]>([[rootRel.ref, []]]);
  const warnings: GraphWarning[] = [];
  const instances: GraphInstance[] = [];
  const reported = new Set<string>();

  const checkStatus = (rel: LoadedRelease, via: string[]) => {
    if (rel.status === "tombstoned") {
      throw new CharError({
        code: "resolve.tombstoned",
        subject: rel.ref,
        detail: rel.status_reason ?? "release was removed",
        data: { release: rel.key, via, reason: rel.status_reason ?? null },
      });
    }
    if (rel.status === "yanked" && !reported.has(rel.key)) {
      reported.add(rel.key);
      warnings.push({
        code: "resolve.yanked",
        subject: rel.ref,
        data: { release: rel.key, via, reason: rel.status_reason ?? null },
      });
    }
  };

  const rootInstance: GraphInstance = {
    key: ROOT_INSTANCE,
    identityPath: [],
    via: [],
    release: rootRel,
    children: [],
  };
  checkStatus(rootRel, []);

  const visit = (inst: GraphInstance, ancestors: string[]) => {
    instances.push(inst);
    if (instances.length > MAX_GRAPH_INSTANCES) {
      throw new CharError({ code: "resolve.graph_too_large", subject: rootRel.ref });
    }
    if (inst.via.length > MAX_GRAPH_DEPTH) {
      throw new CharError({ code: "resolve.graph_too_deep", subject: inst.release.ref });
    }
    for (const edge of sortedEdges(inst.release.creation)) {
      const via = [...inst.via, edge.id];
      const ref = resolveUseRef(edge.use, inst.release.ref);
      const pin = edge.pin;
      if (!pin || !("release" in pin)) {
        throw new CharError({
          code: "resolve.unpinned",
          subject: `${inst.release.ref}/${edge.id}`,
          detail: "every reference must pin an exact release",
          data: { via },
        });
      }
      const rel = load(pin.release);
      if (!rel) {
        throw new CharError({
          code: "resolve.release_missing",
          subject: pin.release,
          data: { ref, via },
        });
      }
      if (rel.ref !== ref) {
        throw new CharError({
          code: "resolve.pin_ref_mismatch",
          subject: `${inst.release.ref}/${edge.id}`,
          detail: `pinned release belongs to ${rel.ref}, not ${ref}`,
        });
      }
      if (rel.semantic_digest !== pin.semantic_digest) {
        throw new CharError({
          code: "resolve.pin_digest_mismatch",
          subject: `${inst.release.ref}/${edge.id}`,
          detail: `pin ${pin.semantic_digest}, release ${rel.semantic_digest}`,
        });
      }
      if (ancestors.includes(rel.key)) {
        throw new CharError({ code: "resolve.cycle", subject: ref, data: { via } });
      }
      const existing = byRef.get(ref);
      if (existing && existing.key !== rel.key) {
        throw new CharError({
          code: "resolve.diamond_conflict",
          subject: ref,
          detail: "the same creation appears with two different releases",
          data: {
            ref,
            releases: [
              { ...buildIdentity(existing.identity), via: firstVia.get(ref) ?? [] },
              { ...buildIdentity(rel.identity), via },
            ],
          },
        });
      }
      if (!existing) {
        byRef.set(ref, rel);
        firstVia.set(ref, via);
      }
      checkStatus(rel, via);
      const identity = [...inst.identityPath, edge.id];
      const child: GraphInstance = {
        key: instanceKey(identity),
        identityPath: identity,
        via,
        release: rel,
        parent: { instance: inst, edge },
        children: [],
      };
      inst.children.push(child);
      visit(child, [...ancestors, rel.key]);
    }
  };
  visit(rootInstance, [rootRel.key]);

  const materialized = materializeRoles(rootInstance);
  return { ...materialized, byRef, warnings };
}

/** Validate authored paths before cast expansion, then materialize actual role instances. */
function materializeRoles(templateRoot: GraphInstance): Pick<LoadedGraph, "root" | "instances"> {
  interface Plan {
    target: GraphInstance;
    member: CastMember;
    crossedScenario: boolean;
  }
  interface Scope {
    owner: GraphInstance;
    template: GraphInstance;
    plans: Plan[];
    actuals: Map<GraphInstance, GraphInstance[]>;
  }
  const instances: GraphInstance[] = [];
  const roleInstances = new Map<string, GraphInstance>();
  const planRoles = (template: GraphInstance): Plan[] => {
    const plans: Plan[] = [];
    for (const member of template.release.creation.cast ?? []) {
      if (typeof member.who !== "string") continue;
      const subject = `${template.release.ref}/cast/${member.key}`;
      if (member.who.startsWith("{{"))
        throw new CharError({ code: "resolve.invalid_cast_binding", subject });
      const ref = resolveUseRef(member.who, template.release.ref);
      const matches: { target: GraphInstance; crossedScenario: boolean }[] = [];
      const scan = (node: GraphInstance, crossedScenario: boolean) => {
        if (matches.length > 1) return;
        if (node !== template && node.release.ref === ref)
          matches.push({ target: node, crossedScenario });
        for (const child of node.children)
          scan(
            child,
            crossedScenario || (node !== template && node.release.creation.type === "scenario"),
          );
      };
      scan(template, false);
      const match = matches[0];
      if (!match)
        throw new CharError({ code: "resolve.binding_not_in_graph", subject, detail: ref });
      if (matches.length > 1)
        throw new CharError({
          code: "resolve.ambiguous_cast_path",
          subject,
          data: { ref, paths: matches.map((m) => m.target.via.slice(template.via.length)) },
        });
      if (!["character", "persona"].includes(match.target.release.creation.type))
        throw new CharError({ code: "resolve.binding_type_mismatch", subject, detail: ref });
      plans.push({ ...match, member });
    }
    return plans;
  };
  const expand = (
    template: GraphInstance,
    identityPath: string[],
    parent: GraphInstance["parent"],
    inherited: Scope | undefined,
    observers: Scope[],
    cast?: NonNullable<GraphInstance["cast"]>,
  ): GraphInstance => {
    const inst: GraphInstance = {
      key: instanceKey(identityPath),
      identityPath,
      via: template.via,
      release: template.release,
      children: [],
      ...(parent ? { parent } : {}),
      ...(cast ? { cast } : {}),
    };
    if (cast) {
      const roleId = `${cast.owner.key}/${cast.member.key}`;
      const prior = roleInstances.get(roleId);
      if (prior)
        throw new CharError({
          code: "resolve.ambiguous_cast_context",
          subject: roleId,
          data: { instances: [prior.parent?.instance.key, parent?.instance.key] },
        });
      roleInstances.set(roleId, inst);
    }
    instances.push(inst);
    if (instances.length > MAX_GRAPH_INSTANCES)
      throw new CharError({ code: "resolve.graph_too_large", subject: templateRoot.release.ref });
    if (inst.via.length > MAX_GRAPH_DEPTH)
      throw new CharError({ code: "resolve.graph_too_deep", subject: inst.release.ref });
    for (const scope of observers) {
      const copies = scope.actuals.get(template) ?? [];
      copies.push(inst);
      scope.actuals.set(template, copies);
    }
    const ownScope: Scope | undefined =
      template.release.creation.type === "scenario"
        ? {
            owner: inst,
            template,
            plans: planRoles(template),
            actuals: new Map([[template, [inst]]]),
          }
        : undefined;
    const scope = ownScope ?? inherited;
    const watching = ownScope ? [...observers, ownScope] : observers;
    for (const child of template.children) {
      const edge = child.parent?.edge;
      if (!edge) throw new CharError({ code: "resolve.internal", subject: child.key });
      const roles = scope?.plans.filter((p) => p.target === child && !p.crossedScenario) ?? [];
      for (const plan of roles.length ? roles : [undefined]) {
        const identity = [
          ...inst.identityPath,
          edge.id,
          ...(plan ? [`cast:${plan.member.key}`] : []),
        ];
        inst.children.push(
          expand(
            child,
            identity,
            { instance: inst, edge },
            scope,
            watching,
            plan && scope ? { owner: scope.owner, member: plan.member } : undefined,
          ),
        );
      }
    }
    if (ownScope) {
      // Freeze the reference-derived lexical contexts before creating any of this
      // owner's cross-Scenario copies. A prior copy must not become another plan's input.
      const deferred = ownScope.plans
        .filter((p) => p.crossedScenario)
        .map((plan) => {
          const introduction = plan.target.parent;
          const parents = introduction
            ? [...(ownScope.actuals.get(introduction.instance) ?? [])]
            : [];
          return { plan, introduction, parents };
        });
      for (const { plan, introduction, parents } of deferred) {
        const lexicalParent = parents[0];
        if (!introduction || parents.length !== 1 || !lexicalParent)
          throw new CharError({
            code: "resolve.ambiguous_cast_context",
            subject: `${inst.release.ref}/cast/${plan.member.key}`,
            data: { instances: parents.map((p) => p.key) },
          });
        // This copy belongs to the outer Scenario. It must not become reference-reachable
        // from the nested Scenario whose edge supplied the lexical introduction.
        const route = plan.target.via.slice(template.via.length);
        expand(
          plan.target,
          [...inst.identityPath, ...route, `owner:${inst.key}`, `cast:${plan.member.key}`],
          { instance: lexicalParent, edge: introduction.edge },
          ownScope,
          // A derived ownership copy is not an authored reference occurrence for
          // this scope or any ancestor. Nested Scenarios create their own observers.
          [],
          { owner: inst, member: plan.member },
        );
      }
    }
    return inst;
  };
  const root = expand(templateRoot, [], undefined, undefined, []);
  return { root, instances };
}

/** 依赖闭包的 lock：除根以外每个 Creation 一条，按 ref 排序；via 是第一次遇到它时的路径。 */
export function buildLock(graph: LoadedGraph) {
  const seen = new Map<
    string,
    { ref: string; release: string; semantic_digest: Digest; via: string[] }
  >();
  for (const inst of graph.instances) {
    if (inst === graph.root) continue;
    const ref = inst.release.ref;
    if (!seen.has(ref)) {
      seen.set(ref, {
        ref,
        ...publishedIdentity(inst.release.identity),
        semantic_digest: inst.release.semantic_digest,
        via: inst.via,
      });
    }
  }
  return [...seen.values()].sort((a, b) => compareStrings(a.ref, b.ref));
}
