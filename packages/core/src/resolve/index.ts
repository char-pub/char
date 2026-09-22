/**
 * Resolver：Release + 依赖闭包 → Context IR。
 *
 * 纯函数、确定性：相同的输入在任何 JS 运行时都输出字节完全相同的 IR（按 JCS 序列化）。
 * Resolver 负责版本锁定、early binding、params、select、override，以及 rating、license、
 * 署名的汇总；activation、visibility 过滤、预算和 late binding 都留给 Assembler。
 *
 * 输出里所有没有语义顺序的数组都按稳定键排序（UTF-16 code unit 比较）：
 * participants / late_slots 按 key，assets 按 id，graph.nodes 按 ref，graph.instances
 * 按 via 路径，graph.edges 按 from_instance + id，graph.removed 按 id，集合类字段按字典序，
 * diagnostics 按 code + subject。fragments 按引用实例的深度优先顺序（根优先，edge 按 id），
 * 同一实例内保持 Creation 中的声明顺序。greetings 与作者列表保留作者指定的顺序。
 */
import { type CanonicalCreation, type Digest, digestJson, jcs } from "../canonical.js";
import { CharError, compareStrings, sortDiagnostics } from "../errors.js";
import { irAssetId, participantRef, SELF_PARTICIPANT } from "../keys.js";
import type { AttributionAuthor, JSONValue, Rating } from "../schema/creation.js";
import { RATINGS } from "../schema/creation.js";
import {
  type ContextIR,
  ContextIRSchema,
  type EffectiveMeta,
  IR_VERSION,
  type IRAsset,
  type IRFragment,
  type LateSlot,
  type Participant,
} from "../schema/ir.js";
import { RESOLVER } from "../version.js";
import { buildEnvironment, pickLocalized } from "./env.js";
import {
  buildLock,
  type GraphInstance,
  type GraphWarning,
  loadGraph,
  type ReleaseInput,
} from "./graph.js";
import { type LateUsage, type RemovedFragment, renderInstance, renderText } from "./render.js";

export type { ReleaseInput } from "./graph.js";

export interface ResolveInput {
  root: ReleaseInput;
  /** 依赖闭包中的所有 Release（多余的会被忽略）。 */
  dependencies?: readonly ReleaseInput[];
  /**
   * public + mirrored 的 asset 的公共 URL 前缀，例如 `https://assets.char.pub/cas/sha256`。
   * 缺省时 IR 中不写 URL。URL 格式为 `<base>/<前 2 位 hex>/<64 位 hex>`。
   */
  publicAssetBaseUrl?: string;
}

export interface ResolveOutput {
  ir: ContextIR;
  /** 按 JCS 序列化的 IR，字节级比较与存储都用它。 */
  json: string;
  digest: Digest;
  lock: ReturnType<typeof buildLock>;
  /** 可变 Registry 状态产生的警告（例如依赖被 yank），不进入 IR，写入 Publish Report。 */
  warnings: GraphWarning[];
}

const ratingRank = (r: Rating) => RATINGS.indexOf(r);

export function resolve(input: ResolveInput): ResolveOutput {
  const graph = loadGraph(input.root, input.dependencies ?? []);
  const env = buildEnvironment(graph);
  const lock = buildLock(graph);
  const rootRel = graph.root.release;
  const rootCreation = rootRel.creation;

  const usage: LateUsage = new Map();
  const fragments: IRFragment[] = [];
  const removed: RemovedFragment[] = [];
  const usedAssets = new Map<string, { inst: GraphInstance; slot: string; variant: string }>();
  let au = env.au;
  const noteAsset = (inst: GraphInstance, slot: string, variant: string) => {
    usedAssets.set(irAssetId(inst.release.ref, slot, variant, inst.key), { inst, slot, variant });
  };

  for (const inst of graph.instances) {
    const r = renderInstance(inst, env, usage, noteAsset);
    fragments.push(...r.fragments);
    removed.push(...r.removed);
    if (r.forcedIntrinsic) au = true;
  }

  // 每个实例的 presentation / context asset 都进入 IR：头像、封面等需要展示。
  for (const inst of graph.instances) {
    for (const s of inst.release.creation.assets) {
      for (const v of s.variants) noteAsset(inst, s.slot, v.id);
    }
  }
  const assets = [...usedAssets.entries()]
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([id, u]) => buildAsset(id, u.inst, u.slot, u.variant, input.publicAssetBaseUrl));

  const bootstrap = buildBootstrap(graph.root, env, usage);
  const late_slots = buildLateSlots(env, usage);
  const participants = buildParticipants(env, rootCreation, new Set(late_slots.map((s) => s.key)));
  const meta = buildMeta(graph, fragments, assets, env, au);

  const diagnostics = sortDiagnostics(
    fragments
      .filter((f) => !f.origin.stable)
      .map((f) => ({
        code: "resolve.unstable_fragment",
        subject: f.id,
        severity: "info" as const,
        detail: "fragment id is not stable and cannot be an override target",
      })),
  );

  const ir: ContextIR = {
    ir_version: IR_VERSION,
    root: { ref: rootRel.ref, release: rootRel.release, semantic_digest: rootRel.semantic_digest },
    lock_digest: digestJson(lock as unknown as JSONValue),
    resolver: { name: RESOLVER.name, version: RESOLVER.version },
    meta,
    participants,
    late_slots,
    fragments,
    bootstrap,
    assets,
    graph: {
      nodes: [...graph.byRef.values()]
        .map((r) => ({
          ref: r.ref,
          release: r.release,
          type: r.creation.type,
          display_name: pickLocalized(
            r.creation.display_name,
            r.creation.meta.default_locale,
            r.creation.meta.default_locale,
          ),
        }))
        .sort((a, b) => compareStrings(a.ref, b.ref)),
      instances: graph.instances
        .map((i) => ({ key: i.key, ref: i.release.ref, via: i.via }))
        .sort((a, b) => compareStrings(jcs(a.via), jcs(b.via))),
      edges: graph.instances
        .filter((i) => i.parent)
        .map((i) => {
          const e = i.parent?.edge;
          const out: ContextIR["graph"]["edges"][number] = {
            from_instance: i.parent?.instance.key ?? "",
            to_instance: i.key,
            id: e?.id ?? "",
            mode: e?.mode ?? "default",
          };
          if (e?.rel !== undefined) out.rel = e.rel;
          return out;
        })
        .sort(
          (a, b) => compareStrings(a.from_instance, b.from_instance) || compareStrings(a.id, b.id),
        ),
      removed: [...removed].sort((a, b) => compareStrings(a.id, b.id)),
    },
    diagnostics,
  };

  // 输出前按 schema 自检：Resolver 的 bug 不能产出不合法的 IR。
  const checked = ContextIRSchema.safeParse(ir);
  if (!checked.success) {
    throw new CharError({
      code: "resolve.internal_invalid_ir",
      subject: rootRel.ref,
      detail: checked.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    });
  }
  const json = jcs(ir as unknown as JSONValue);
  return {
    ir,
    json,
    digest: digestJson(ir as unknown as JSONValue),
    lock,
    warnings: graph.warnings,
  };
}

function buildAsset(
  id: string,
  inst: GraphInstance,
  slot: string,
  variant: string,
  baseUrl: string | undefined,
): IRAsset {
  const rel = inst.release;
  const c = rel.creation;
  const s = c.assets.find((a) => a.slot === slot);
  const v = s?.variants.find((x) => x.id === variant);
  if (!s || !v) throw new CharError({ code: "resolve.asset_missing", subject: id });
  const out: IRAsset = {
    id,
    role: s.role,
    media_type: v.media_type,
    digest: v.blob.digest,
    availability: v.blob.availability,
    access: rel.visibility,
    rating: v.rating ?? c.meta.rating,
    license: v.license ?? c.meta.license,
    origin: { creation: c.ref, release: rel.release, slot, variant, instance_key: inst.key },
  };
  if (baseUrl && rel.visibility === "public" && v.blob.availability === "mirrored") {
    const hex = v.blob.digest.slice("sha256:".length);
    out.url = `${baseUrl.replace(/\/$/, "")}/${hex.slice(0, 2)}/${hex}`;
  }
  if (v.blob.locator) out.locator = v.blob.locator;
  if (v.alt !== undefined)
    out.alt = pickLocalized(v.alt, c.meta.default_locale, c.meta.default_locale);
  return out;
}

/**
 * IR 中的参与者。由 late slot 决定的参与者只在对应的 late slot 出现在 IR 中时才保留：
 * 可选且没有被任何内容使用的 slot 不进入 IR，它的参与者也不应该出现。
 */
function buildParticipants(
  env: ReturnType<typeof buildEnvironment>,
  root: CanonicalCreation,
  lateSlotKeys: ReadonlySet<string>,
): Participant[] {
  const out: Participant[] = [];
  for (const p of env.participants.values()) {
    if (p.late !== undefined && !lateSlotKeys.has(p.late)) continue;
    const item: Participant = { key: p.key, display_name: p.display_name, kind: p.kind };
    if (p.ref !== undefined) item.ref = p.ref;
    if (p.role !== undefined) item.role = p.role;
    if (p.late !== undefined) item.late = p.late;
    const ai = p.avatarInstance;
    if (ai) {
      const avatar = ai.release.creation.assets.find((a) => a.slot === "avatar");
      if (avatar) item.avatar = irAssetId(ai.release.ref, "avatar", "default", ai.key);
    }
    out.push(item);
  }
  if (
    !out.some((p) => p.key === SELF_PARTICIPANT) &&
    (root.type === "character" || root.type === "persona")
  ) {
    throw new CharError({
      code: "resolve.internal",
      subject: root.ref,
      detail: "missing self participant",
    });
  }
  return out.sort((a, b) => compareStrings(a.key, b.key));
}

function buildBootstrap(
  root: GraphInstance,
  env: ReturnType<typeof buildEnvironment>,
  usage: LateUsage,
): ContextIR["bootstrap"] {
  const c = root.release.creation;
  const ienv = env.envs.get(root);
  if (!ienv || !c.bootstrap) return { greetings: [] };
  const speaker = participantRef(ienv.participant ?? SELF_PARTICIPANT);
  return {
    greetings: c.bootstrap.greetings.map((g) => {
      const ctx = { ienv, env, usage, fragmentId: `bootstrap:${g.id}`, assetUsed: () => {} };
      const out: ContextIR["bootstrap"]["greetings"][number] = {
        id: g.id,
        speaker,
        text: renderText(g.text, ctx, c.meta.default_locale),
      };
      if (g.locale && Object.keys(g.locale).length > 0) {
        const locales: Record<string, string> = {};
        for (const loc of Object.keys(g.locale).sort(compareStrings)) {
          const v = g.locale[loc];
          if (v?.content.type !== "text") {
            throw new CharError({
              code: "resolve.greeting_locale_not_text",
              subject: `${g.id}/${loc}`,
            });
          }
          locales[loc] = renderText(v.content.text, ctx, loc);
        }
        out.locales = locales;
      }
      if (g.scenario_hint !== undefined) {
        out.scenario_hint = pickLocalized(
          g.scenario_hint,
          c.meta.default_locale,
          c.meta.default_locale,
        );
      }
      return out;
    }),
  };
}

function buildLateSlots(env: ReturnType<typeof buildEnvironment>, usage: LateUsage): LateSlot[] {
  const out: LateSlot[] = [];
  for (const s of env.lateSlots.values()) {
    const used = [...(usage.get(s.key) ?? [])].sort(compareStrings);
    // 没有被任何内容使用、也不是声明为必需的 late slot 不出现在 IR 中。
    if (used.length === 0 && !s.declaredRequired && s.key !== "user") continue;
    const item: LateSlot = {
      key: s.key,
      accepts: s.accepts,
      required: s.declaredRequired || used.length > 0,
      used_by: used,
    };
    if (s.hint !== undefined) item.hint = s.hint;
    out.push(item);
  }
  return out.sort((a, b) => compareStrings(a.key, b.key));
}

function buildMeta(
  graph: ReturnType<typeof loadGraph>,
  fragments: IRFragment[],
  assets: IRAsset[],
  env: ReturnType<typeof buildEnvironment>,
  au: boolean,
): EffectiveMeta {
  const root = graph.root.release.creation;
  const nodes = [...graph.byRef.values()].sort((a, b) => compareStrings(a.ref, b.ref));

  const rating_sources: EffectiveMeta["rating_sources"] = [];
  let rating: Rating = "general";
  const bump = (r: Rating) => {
    if (ratingRank(r) > ratingRank(rating)) rating = r;
  };
  for (const n of nodes) {
    rating_sources.push({ ref: n.ref, rating: n.creation.meta.rating });
    bump(n.creation.meta.rating);
  }
  const licenses: EffectiveMeta["licenses"] = nodes.map((n) => ({
    ref: n.ref,
    license: n.creation.meta.license,
  }));
  for (const a of assets) {
    const owner = graph.byRef.get(a.origin.creation);
    const assetKey = `${a.origin.slot}/${a.origin.variant}`;
    if (owner && a.rating !== owner.creation.meta.rating) {
      rating_sources.push({ ref: a.origin.creation, rating: a.rating, asset: assetKey });
    }
    bump(a.rating);
    if (owner && a.license !== owner.creation.meta.license) {
      licenses.push({ ref: a.origin.creation, license: a.license, asset: assetKey });
    }
  }
  const dedupe = <T>(list: T[]) => {
    const seen = new Set<string>();
    return list.filter((x) => {
      const k = jcs(x as unknown as JSONValue);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const sortRefAsset = (
    a: { ref: string; asset?: string | undefined },
    b: { ref: string; asset?: string | undefined },
  ) => compareStrings(a.ref, b.ref) || compareStrings(a.asset ?? "", b.asset ?? "");

  const warnings = new Set<string>();
  for (const n of nodes) for (const w of n.creation.meta.content_warnings ?? []) warnings.add(w);

  const attribution = nodes.map((n) => ({
    ref: n.ref,
    authors: (n.creation.authors ?? []) as AttributionAuthor[],
  }));
  const contributors: EffectiveMeta["contributors"] = [];
  for (const n of nodes) {
    for (const c of n.creation.provenance.contributors ?? []) {
      const item: EffectiveMeta["contributors"][number] = { ref: n.ref, author: c.author };
      if (c.contribution !== undefined) item.contribution = c.contribution;
      contributors.push(item);
    }
  }
  const import_omissions = nodes
    .map((n) => ({
      ref: n.ref,
      fields: [...(n.creation.provenance.imported_from?.omitted_policy_fields ?? [])].sort(
        compareStrings,
      ),
    }))
    .filter((x) => x.fields.length > 0);

  // 可用 locale：每个 fragment 都具备（default 或变体）的 locale 的交集。
  const localeSets = fragments.map((f) => {
    const owner = graph.byRef.get(f.origin.creation);
    const set = new Set<string>(Object.keys(f.locales ?? {}));
    if (owner) set.add(owner.creation.meta.default_locale);
    return set;
  });
  let available: string[] = [];
  if (localeSets.length === 0) available = [root.meta.default_locale];
  else {
    const [first, ...rest] = localeSets;
    available = [...(first ?? [])].filter((l) => rest.every((s) => s.has(l)));
  }

  return {
    default_locale: root.meta.default_locale,
    available_locales: available.sort(compareStrings),
    rating,
    rating_sources: dedupe(rating_sources).sort(sortRefAsset),
    content_warnings: [...warnings].sort(compareStrings),
    licenses: dedupe(licenses).sort(sortRefAsset),
    attribution,
    contributors,
    import_omissions,
    au: au || env.au,
    recommended_presets: [...(root.meta.recommended_presets ?? [])].sort(compareStrings),
  };
}
