/**
 * Resolver 第二阶段：把每个引用实例的 fragment 渲染成 IR fragment。
 *
 * 对每个实例依次做：
 * 1. select：按引入它的 edge 上的 include / exclude 过滤；
 * 2. override：应用该 edge 上的 replace / remove / patch / add；
 * 3. 模板替换：`{{self}}` 和 early 绑定的 `{{slot:x}}` 换成显示名，`{{param:x}}` 换成值，
 *    `{{user}}` 和 late 绑定的 slot 换成 `{{late:<key>}}`；
 * 4. 说话人、可见性目标改写成 `participant:<key>`，asset 引用改写成 IR asset ID。
 *
 * override 只能作用于被这条 edge 直接引用的 Creation 的 fragment，目标必须存在、
 * 必须是 stable，同一条 edge 上对同一目标只能有一个 override。对 intrinsic 依赖中
 * world / character 类 fragment 的 replace / remove 只允许在 Scenario 中、并且带
 * `force: true`，这会把结果标记为 AU（alternate universe）。
 */
import { canonicalActivation, canonicalContent, normalizeText } from "../canonical.js";
import { CharError, compareStrings } from "../errors.js";
import {
  irAssetId,
  irFragmentDigest,
  irFragmentId,
  participantRef,
  USER_LATE_SLOT,
  USER_PARTICIPANT,
} from "../keys.js";
import type {
  Activation,
  Fragment,
  FragmentContent,
  FragmentOverride,
  LocaleMap,
  Selector,
  Visibility,
} from "../schema/creation.js";
import type { IRContent, IRFragment, IRVisibility, Origin } from "../schema/ir.js";
import { type RawTemplate, renderTemplate, tokenizeTemplate } from "../template.js";
import { type Environment, type InstanceEnv, pickLocalized } from "./env.js";
import type { GraphInstance } from "./graph.js";

export interface RemovedFragment {
  id: string;
  by: { creation: string; edge?: string; reason: "select" | "override" };
}

export interface RenderResult {
  fragments: IRFragment[];
  removed: RemovedFragment[];
  /** 是否应用过对 intrinsic 依赖的强制 override。 */
  forcedIntrinsic: boolean;
}

/** 渲染过程中记录 late slot 的使用情况：slot key → 使用它的 IR fragment ID。 */
export type LateUsage = Map<string, Set<string>>;

function matches(pattern: string, id: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("/*")) return id.startsWith(pattern.slice(0, -1));
  return pattern === id;
}

function selected(sel: Selector | undefined, id: string): boolean {
  if (!sel) return true;
  if ("include" in sel) return sel.include.some((p) => matches(p, id));
  return !sel.exclude.some((p) => matches(p, id));
}

interface WorkingFragment {
  fragment: Omit<Fragment, "digest">;
  overridden_by: NonNullable<Origin["overridden_by"]>;
}

function overrideTarget(o: FragmentOverride): string | null {
  return o.op === "add" ? null : o.target;
}

/**
 * 渲染一个实例。`usage` 会被就地更新，用来算出 late slot 的 used_by。
 */
export function renderInstance(
  inst: GraphInstance,
  env: Environment,
  usage: LateUsage,
  assetBaseUrlUsed: (instance: GraphInstance, slot: string, variant: string) => void,
): RenderResult {
  const ienv = env.envs.get(inst);
  if (!ienv) throw new CharError({ code: "resolve.internal", subject: inst.key });
  const c = inst.release.creation;
  const edge = inst.parent?.edge;
  const parentRef = inst.parent?.instance.release.ref;
  const parentType = inst.parent?.instance.release.creation.type;
  const removed: RemovedFragment[] = [];
  let forcedIntrinsic = false;

  const byId = new Map(c.fragments.map((f) => [f.id, f]));
  const working = new Map<string, WorkingFragment>();
  const order: string[] = [];
  for (const f of c.fragments) {
    if (!selected(edge?.select, f.id)) {
      removed.push({
        id: irFragmentId(c.ref, f.id, inst.key),
        by: { creation: parentRef ?? c.ref, ...(edge ? { edge: edge.id } : {}), reason: "select" },
      });
      continue;
    }
    const { digest: _d, ...body } = f;
    working.set(f.id, { fragment: body, overridden_by: [] });
    order.push(f.id);
  }

  const overrides = edge?.override ?? [];
  const seenTargets = new Set<string>();
  for (const o of overrides) {
    const target = overrideTarget(o);
    const subject = `${parentRef}/${edge?.id}/override/${target ?? (o.op === "add" ? o.fragment.id : "")}`;
    if (target !== null) {
      if (seenTargets.has(target)) {
        throw new CharError({ code: "resolve.override_duplicate_target", subject });
      }
      seenTargets.add(target);
      const orig = byId.get(target);
      if (!orig) throw new CharError({ code: "resolve.override_target_missing", subject });
      if (!orig.stable) {
        throw new CharError({
          code: "resolve.override_unstable_target",
          subject,
          detail: "only fragments with stable: true can be overridden",
        });
      }
      const w = working.get(target);
      if (!w) throw new CharError({ code: "resolve.override_target_excluded", subject });
      if (
        (o.op === "replace" || o.op === "remove") &&
        edge?.mode === "intrinsic" &&
        (orig.kind === "world" || orig.kind === "character")
      ) {
        if (parentType !== "scenario" || o.force !== true) {
          throw new CharError({
            code: "resolve.intrinsic_override_forbidden",
            subject,
            detail: "replacing core world/character content needs a scenario and force: true",
          });
        }
        forcedIntrinsic = true;
      }
      const by = { creation: parentRef ?? c.ref, ...(edge ? { edge: edge.id } : {}) };
      if (o.op === "remove") {
        working.delete(target);
        order.splice(order.indexOf(target), 1);
        removed.push({
          id: irFragmentId(c.ref, target, inst.key),
          by: { ...by, reason: "override" },
        });
      } else if (o.op === "replace") {
        w.fragment = { ...w.fragment, content: o.content };
        w.overridden_by.push({ ...by, op: "replace" });
      } else if (o.op === "patch") {
        const set = o.set;
        const next = { ...w.fragment };
        if (set.activation !== undefined) next.activation = set.activation;
        if (set.visibility !== undefined) next.visibility = set.visibility;
        if (set.importance !== undefined) next.importance = set.importance;
        if (set.placement_hint !== undefined) next.placement_hint = set.placement_hint;
        w.fragment = next;
        w.overridden_by.push({ ...by, op: "patch" });
      }
      continue;
    }
    if (o.op !== "add") continue;
    const id = o.fragment.id;
    if (byId.has(id) || working.has(id)) {
      throw new CharError({ code: "resolve.override_add_collision", subject });
    }
    const { digest: _d, ...body } = o.fragment;
    working.set(id, {
      fragment: body,
      overridden_by: [
        { creation: parentRef ?? c.ref, ...(edge ? { edge: edge.id } : {}), op: "add" },
      ],
    });
    order.push(id);
  }

  const fragments: IRFragment[] = [];
  for (const id of order) {
    const w = working.get(id);
    if (!w) continue;
    fragments.push(renderFragment(w, ienv, env, usage, assetBaseUrlUsed));
  }
  return { fragments, removed, forcedIntrinsic };
}

function renderFragment(
  w: WorkingFragment,
  ienv: InstanceEnv,
  env: Environment,
  usage: LateUsage,
  assetUsed: (instance: GraphInstance, slot: string, variant: string) => void,
): IRFragment {
  const inst = ienv.inst;
  const c = inst.release.creation;
  const f = w.fragment;
  const id = irFragmentId(c.ref, f.id, inst.key);
  const ctx: RenderCtx = { ienv, env, usage, fragmentId: id, assetUsed };
  const defaultLocale = c.meta.default_locale;

  const content = renderContent(canonicalContent(f.content), ctx, defaultLocale);
  let locales: Record<string, IRContent> | undefined;
  if (f.locale && Object.keys(f.locale).length > 0) {
    locales = {};
    for (const loc of Object.keys(f.locale).sort(compareStrings)) {
      const v = f.locale[loc];
      if (v) locales[loc] = renderContent(canonicalContent(v.content), ctx, loc);
    }
  }

  const activation = mergeLocaleKeys(
    canonicalActivation(f.activation ?? { mode: "always" }),
    f.locale,
  );
  const visibility = renderVisibility(f.visibility ?? { scope: "shared" }, ctx);
  const subject =
    (f.kind === "character" || f.kind === "persona") && ienv.participant
      ? ienv.participant
      : undefined;
  const asset_refs = f.asset_refs?.map((r) => renderAssetRef(r, ctx, true));

  const semantic = {
    kind: f.kind,
    content,
    ...(locales ? { locales } : {}),
    activation,
    visibility,
    importance: f.importance ?? "normal",
    placement_hint: f.placement_hint ?? f.kind,
    ...(subject ? { subject } : {}),
    ...(asset_refs && asset_refs.length > 0 ? { asset_refs } : {}),
  } satisfies Omit<IRFragment, "id" | "origin" | "digest">;

  const origin: Origin = {
    creation: c.ref,
    release: inst.release.release,
    fragment: f.id,
    via: inst.via,
    instance_key: inst.key,
    stable: f.stable,
  };
  if (w.overridden_by.length > 0) origin.overridden_by = w.overridden_by;

  return { id, ...semantic, origin, digest: irFragmentDigest(semantic) };
}

/** 各 locale 变体里的额外关键词并入 keyword 激活，这样用任意语言聊天都能触发。 */
function mergeLocaleKeys(a: Activation, locale: LocaleMap | undefined): Activation {
  if (a.mode !== "keyword" || !locale) return a;
  const keys = [...a.keys];
  for (const loc of Object.keys(locale).sort(compareStrings)) {
    for (const k of locale[loc]?.activation_keys ?? []) if (!keys.includes(k)) keys.push(k);
  }
  return keys.length === a.keys.length ? a : { ...a, keys };
}

export interface RenderCtx {
  ienv: InstanceEnv;
  env: Environment;
  usage: LateUsage;
  fragmentId: string;
  assetUsed: (instance: GraphInstance, slot: string, variant: string) => void;
}

function markLate(ctx: RenderCtx, key: string): RawTemplate {
  let set = ctx.usage.get(key);
  if (!set) {
    set = new Set();
    ctx.usage.set(key, set);
  }
  set.add(ctx.fragmentId);
  return { raw: `{{late:${key}}}` };
}

/** 渲染模板文本。`locale` 决定显示名取哪种语言。 */
export function renderText(text: string, ctx: RenderCtx, locale: string): string {
  const { tokens, issues } = tokenizeTemplate(text, "creation");
  const first = issues[0];
  if (first) {
    throw new CharError({
      code: "resolve.template_invalid",
      subject: ctx.fragmentId,
      detail: first.detail,
    });
  }
  const c = ctx.ienv.inst.release.creation;
  // 替换后的拼接结果可能不再是 NFC（例如参数值以组合字符开头），所以最后再归一一次。
  return normalizeText(renderText0(tokens, ctx, c, locale));
}

function renderText0(
  tokens: ReturnType<typeof tokenizeTemplate>["tokens"],
  ctx: RenderCtx,
  c: GraphInstance["release"]["creation"],
  locale: string,
): string {
  return renderTemplate(tokens, (tok) => {
    switch (tok.t) {
      case "self":
        if (!ctx.ienv.participant) {
          throw new CharError({
            code: "resolve.self_outside_participant",
            subject: ctx.fragmentId,
            detail: "{{self}} is only valid in characters and personas",
          });
        }
        return pickLocalized(c.display_name, locale, c.meta.default_locale);
      case "user":
        return markLate(ctx, USER_LATE_SLOT);
      case "slot": {
        const v = ctx.ienv.slots.get(tok.name);
        if (!v) {
          throw new CharError({
            code: "resolve.slot_unbound",
            subject: ctx.fragmentId,
            detail: tok.name,
          });
        }
        if (v.kind === "late") return markLate(ctx, v.late);
        return pickLocalized(v.display_name, locale, c.meta.default_locale);
      }
      case "param": {
        const v = ctx.ienv.params.get(tok.name);
        if (v === undefined) {
          throw new CharError({
            code: "resolve.param_missing",
            subject: ctx.fragmentId,
            detail: tok.name,
          });
        }
        return String(v);
      }
      case "late":
        return null;
    }
  });
}

function renderContent(content: FragmentContent, ctx: RenderCtx, locale: string): IRContent {
  switch (content.type) {
    case "text":
      return {
        type: "text",
        text: renderText(content.text, ctx, locale),
        format: content.format ?? "markdown",
      };
    case "dialogue":
      return {
        type: "dialogue",
        turns: content.turns.map((t) => ({
          speaker: participantRef(speakerKey(t.speaker, ctx)),
          text: renderText(t.text, ctx, locale),
        })),
      };
    case "media": {
      const out: IRContent = { type: "media", asset: renderAssetRef(content.asset, ctx, false) };
      if (content.caption !== undefined) out.caption = renderText(content.caption, ctx, locale);
      return out;
    }
    case "structured":
      return { type: "structured", schema: content.schema, data: content.data };
  }
}

/** 把 SpeakerRef 解析成参与者 key。 */
export function speakerKey(speaker: string, ctx: RenderCtx): string {
  const { ienv, env } = ctx;
  const c = ienv.inst.release.creation;
  if (speaker === "{{self}}") {
    if (!ienv.participant) {
      throw new CharError({ code: "resolve.self_outside_participant", subject: ctx.fragmentId });
    }
    return ienv.participant;
  }
  if (speaker === "{{user}}") {
    markLate(ctx, USER_LATE_SLOT);
    return USER_PARTICIPANT;
  }
  const slotMatch = /^\{\{slot:(.+)\}\}$/.exec(speaker);
  if (slotMatch?.[1]) {
    const v = ienv.slots.get(slotMatch[1]);
    if (!v || v.participant === null) {
      throw new CharError({
        code: "resolve.speaker_unknown",
        subject: ctx.fragmentId,
        detail: speaker,
      });
    }
    if (v.kind === "late") markLate(ctx, v.late);
    return v.participant;
  }
  const castMatch = /^\{\{cast:(.+)\}\}$/.exec(speaker);
  if (castMatch?.[1]) {
    const v = ienv.cast.get(castMatch[1]);
    if (!v?.participant) {
      throw new CharError({
        code: "resolve.speaker_unknown",
        subject: ctx.fragmentId,
        detail: speaker,
      });
    }
    if (v.kind === "late") markLate(ctx, v.late);
    return v.participant;
  }
  if (speaker === c.ref && ienv.participant) return ienv.participant;
  for (const v of [...ienv.slots.values(), ...ienv.cast.values()]) {
    if (v.kind === "early" && v.ref === speaker && v.participant) return v.participant;
  }
  for (const p of env.participants.values()) {
    if (p.ref === speaker) return p.key;
  }
  throw new CharError({
    code: "resolve.speaker_unknown",
    subject: ctx.fragmentId,
    detail: speaker,
  });
}

function renderVisibility(v: Visibility, ctx: RenderCtx): IRVisibility {
  if (v.scope === "shared") return { scope: "shared" };
  if (v.scope === "private") {
    const keys = [...new Set(v.to.map((s) => participantRef(speakerKey(s, ctx))))].sort(
      compareStrings,
    );
    return { scope: "private", to: keys };
  }
  const c = ctx.ienv.inst.release.creation;
  const inst = ctx.ienv.inst;
  return {
    scope: "scene",
    scene: v.scene === undefined ? `instance:${inst.key}` : irFragmentId(c.ref, v.scene, inst.key),
  };
}

/** `#asset/slot[/variant]` → IR asset ID；fragment 只能引用 role 为 context 的 asset。 */
function renderAssetRef(ref: string, ctx: RenderCtx, requireContext: boolean): string {
  const inst = ctx.ienv.inst;
  const c = inst.release.creation;
  // `#asset/<slot>` 或 `#asset/<slot>/<variant>`
  const [, slot, variant = "default"] = ref.split("/");
  const s = c.assets.find((a) => a.slot === slot);
  const v = s?.variants.find((x) => x.id === variant);
  if (!s || !v || slot === undefined) {
    throw new CharError({ code: "resolve.asset_missing", subject: ctx.fragmentId, detail: ref });
  }
  if (requireContext && s.role !== "context") {
    throw new CharError({
      code: "resolve.asset_not_context",
      subject: ctx.fragmentId,
      detail: `${ref} is a presentation asset and cannot enter the model context`,
    });
  }
  ctx.assetUsed(inst, slot, variant);
  return irAssetId(c.ref, slot, variant, inst.key);
}
