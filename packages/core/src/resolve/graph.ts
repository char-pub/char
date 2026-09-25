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
import type { CreationInput, ReferenceEdge } from "../schema/creation.js";

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

export interface LoadedRelease {
  release: string;
  ref: string;
  visibility: "public" | "private";
  status: "active" | "yanked" | "tombstoned";
  status_reason: string | undefined;
  creation: CanonicalCreation;
  semantic_digest: Digest;
}

export interface GraphInstance {
  key: string;
  /** 从根到这个实例的 edge ID 路径。 */
  via: string[];
  release: LoadedRelease;
  /** 引入这个实例的 edge 以及声明它的父实例；根实例没有。 */
  parent?: { instance: GraphInstance; edge: ReferenceEdge };
  /** 子实例，按 edge id 排序。 */
  children: GraphInstance[];
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

function loadRelease(input: ReleaseInput): LoadedRelease {
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
      subject: input.release,
      detail: `stored ${input.semantic_digest}, computed ${semantic_digest}`,
    });
  }
  return {
    release: input.release,
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

export function loadGraph(root: ReleaseInput, deps: readonly ReleaseInput[]): LoadedGraph {
  const inputs = new Map<string, ReleaseInput>();
  for (const d of deps) inputs.set(d.release, d);
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
  loaded.set(rootRel.release, rootRel);
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
        data: { release: rel.release, via, reason: rel.status_reason ?? null },
      });
    }
    if (rel.status === "yanked" && !reported.has(rel.release)) {
      reported.add(rel.release);
      warnings.push({
        code: "resolve.yanked",
        subject: rel.ref,
        data: { release: rel.release, via, reason: rel.status_reason ?? null },
      });
    }
  };

  const rootInstance: GraphInstance = {
    key: ROOT_INSTANCE,
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
      if (ancestors.includes(rel.release)) {
        throw new CharError({ code: "resolve.cycle", subject: ref, data: { via } });
      }
      const existing = byRef.get(ref);
      if (existing && existing.release !== rel.release) {
        throw new CharError({
          code: "resolve.diamond_conflict",
          subject: ref,
          detail: "the same creation appears with two different releases",
          data: {
            ref,
            releases: [
              { release: existing.release, via: firstVia.get(ref) ?? [] },
              { release: rel.release, via },
            ],
          },
        });
      }
      if (!existing) {
        byRef.set(ref, rel);
        firstVia.set(ref, via);
      }
      checkStatus(rel, via);
      const child: GraphInstance = {
        key: instanceKey(via),
        via,
        release: rel,
        parent: { instance: inst, edge },
        children: [],
      };
      inst.children.push(child);
      visit(child, [...ancestors, rel.release]);
    }
  };
  visit(rootInstance, [rootRel.release]);

  return { root: rootInstance, instances, byRef, warnings };
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
        release: inst.release.release,
        semantic_digest: inst.release.semantic_digest,
        via: inst.via,
      });
    }
  }
  return [...seen.values()].sort((a, b) => compareStrings(a.ref, b.ref));
}
