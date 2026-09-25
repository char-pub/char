/**
 * `char check`：发布前对单个 Creation 做的静态检查。
 *
 * 这里只检查 Creation 自身就能判断的问题：模板占位符、各类型的最小内容、本地引用
 * （asset、slot、param、cast、scene）、重复 ID、默认值类型等。需要读取被引用
 * Creation 才能判断的问题（override 目标是否存在且稳定、slot 是否已声明并已绑定）
 * 由 `checkOverrideTargets` 与 `checkEdgeBindings` 负责，Resolver 与发布流程会调用它们。
 *
 * 诊断分三级：error 阻止发布；warning 提醒作者但不阻止；info 只是说明。
 * 输出按 code、subject 排序，与输入书写顺序无关。
 */
import type { CanonicalCreation } from "./canonical.js";
import { sortDiagnostics } from "./errors.js";
import {
  type AssetSlot,
  type Binding,
  type CreationType,
  type FragmentContent,
  type FragmentOverride,
  type LocaleMap,
  type ParamDecl,
  RATINGS,
  type ReferenceEdge,
  type ScalarValue,
  type SpeakerRef,
} from "./schema/creation.js";
import { type TemplateIssue, tokenizeTemplate } from "./template.js";

export type CheckSeverity = "error" | "warning" | "info";

export interface CheckDiagnostic {
  code: string;
  /** 出问题的位置，例如 `fragments[lore/arasaka].content`、`references[world].override[0]`。 */
  subject: string;
  severity: CheckSeverity;
  detail?: string;
}

export interface CheckResult {
  /** 没有任何 error 级诊断。 */
  ok: boolean;
  diagnostics: CheckDiagnostic[];
}

export interface CheckOptions {
  /** Creation 的来源。GitHub 不允许托管文字形式的色情内容，所以来源是 github 时会多一条提示。 */
  source?: "native" | "github" | "import";
}

/** 只有这两类 Creation “本身是一个角色”，可以在模板或 binding 中使用 `{{self}}`。 */
const SELF_TYPES: ReadonlySet<CreationType> = new Set(["character", "persona"]);

/** 可以带 bootstrap（开场问候语）的类型。 */
const BOOTSTRAP_TYPES: ReadonlySet<CreationType> = new Set(["character", "scenario"]);

/** 对 intrinsic 依赖做 replace / remove 需要强制确认的 fragment kind。 */
const IDENTITY_KINDS: ReadonlySet<string> = new Set(["world", "character"]);

const TEMPLATE_ISSUE_CODES: Record<TemplateIssue["code"], string> = {
  "template.unknown_placeholder": "check.unknown_placeholder",
  "template.unclosed": "check.unclosed_placeholder",
  "template.invalid_name": "check.invalid_placeholder_name",
};

// ---------------------------------------------------------------------------
// 诊断收集
// ---------------------------------------------------------------------------

class Sink {
  readonly list: CheckDiagnostic[] = [];

  add(severity: CheckSeverity, code: string, subject: string, detail?: string): void {
    this.list.push(
      detail === undefined ? { code, subject, severity } : { code, subject, severity, detail },
    );
  }
  error(code: string, subject: string, detail?: string): void {
    this.add("error", code, subject, detail);
  }
  warn(code: string, subject: string, detail?: string): void {
    this.add("warning", code, subject, detail);
  }
  info(code: string, subject: string, detail?: string): void {
    this.add("info", code, subject, detail);
  }
  sorted(): CheckDiagnostic[] {
    return sortDiagnostics(this.list);
  }
}

function toResult(diagnostics: CheckDiagnostic[]): CheckResult {
  return { ok: !diagnostics.some((d) => d.severity === "error"), diagnostics };
}

// ---------------------------------------------------------------------------
// 作用域：模板与引用在什么 Creation 的语境里解释
// ---------------------------------------------------------------------------

interface Scope {
  type: CreationType;
  slots: ReadonlySet<string>;
  params: ReadonlySet<string>;
  cast: ReadonlySet<string>;
  assets: readonly AssetSlot[];
  fragmentIds: ReadonlySet<string>;
  /** 用在诊断说明里，例如 `@cyberpunk/night-city`。 */
  label: string;
}

function scopeOf(c: CanonicalCreation): Scope {
  return {
    type: c.type,
    slots: new Set(Object.keys(c.slots ?? {})),
    params: new Set(Object.keys(c.params ?? {})),
    cast: new Set((c.cast ?? []).map((m) => m.key)),
    assets: c.assets,
    fragmentIds: new Set(c.fragments.map((f) => f.id)),
    label: c.ref,
  };
}

/** 只检查语法，不检查 slot / param 是否已声明（用于语境未知的 override 内容）。 */
function checkTemplateSyntax(text: string, subject: string, sink: Sink): void {
  for (const issue of tokenizeTemplate(text, "creation").issues) {
    sink.error(
      TEMPLATE_ISSUE_CODES[issue.code],
      subject,
      `${issue.detail} at offset ${issue.offset}`,
    );
  }
}

function checkTemplate(text: string, subject: string, scope: Scope, sink: Sink): void {
  const { tokens, issues } = tokenizeTemplate(text, "creation");
  for (const issue of issues) {
    sink.error(
      TEMPLATE_ISSUE_CODES[issue.code],
      subject,
      `${issue.detail} at offset ${issue.offset}`,
    );
  }
  for (const tok of tokens) {
    if (tok.t === "self" && !SELF_TYPES.has(scope.type)) {
      sink.error("check.self_not_allowed", subject, `{{self}} is not available in a ${scope.type}`);
    } else if (tok.t === "slot" && !scope.slots.has(tok.name)) {
      sink.error(
        "check.unknown_slot",
        subject,
        `slot '${tok.name}' is not declared in ${scope.label}`,
      );
    } else if (tok.t === "param" && !scope.params.has(tok.name)) {
      sink.error(
        "check.unknown_param",
        subject,
        `param '${tok.name}' is not declared in ${scope.label}`,
      );
    }
  }
}

const SLOT_SPEAKER_RE = /^\{\{slot:(.+)\}\}$/;
const CAST_SPEAKER_RE = /^\{\{cast:(.+)\}\}$/;

function checkCastKey(key: string, subject: string, scope: Scope, sink: Sink): void {
  if (scope.type !== "scenario") {
    sink.error("check.unknown_cast", subject, `{{cast:${key}}} is only available in a scenario`);
  } else if (!scope.cast.has(key)) {
    sink.error("check.unknown_cast", subject, `cast member '${key}' is not declared`);
  }
}

/** 说话人与 visibility 目标：`{{self}}`、`{{user}}`、`{{slot:x}}`、`{{cast:x}}` 或公共标识。 */
function checkSpeaker(ref: SpeakerRef, subject: string, scope: Scope, sink: Sink): void {
  if (ref === "{{self}}") {
    if (!SELF_TYPES.has(scope.type)) {
      sink.error("check.self_not_allowed", subject, `{{self}} is not available in a ${scope.type}`);
    }
    return;
  }
  const slot = SLOT_SPEAKER_RE.exec(ref)?.[1];
  if (slot !== undefined) {
    if (!scope.slots.has(slot)) {
      sink.error("check.unknown_slot", subject, `slot '${slot}' is not declared in ${scope.label}`);
    }
    return;
  }
  const cast = CAST_SPEAKER_RE.exec(ref)?.[1];
  if (cast !== undefined) checkCastKey(cast, subject, scope, sink);
}

function checkBinding(b: Binding, subject: string, scope: Scope, sink: Sink): void {
  if (typeof b !== "string") return;
  if (b === "{{self}}") {
    if (!SELF_TYPES.has(scope.type)) {
      sink.error("check.self_not_allowed", subject, `a ${scope.type} cannot bind itself`);
    }
    return;
  }
  const cast = CAST_SPEAKER_RE.exec(b)?.[1];
  if (cast !== undefined) checkCastKey(cast, subject, scope, sink);
}

/**
 * `#asset/<slot>` 或 `#asset/<slot>/<variant>`。进入模型的 asset 必须是 context 角色，
 * presentation 角色（头像、封面等）只用于展示。
 */
function checkAssetRef(ref: string, subject: string, scope: Scope, sink: Sink): void {
  const [slotName, variantId] = ref.slice("#asset/".length).split("/");
  const slot = scope.assets.find((s) => s.slot === slotName);
  if (!slot) {
    sink.error(
      "check.unknown_asset",
      subject,
      `asset slot '${slotName}' does not exist in ${scope.label}`,
    );
    return;
  }
  if (variantId !== undefined && !slot.variants.some((v) => v.id === variantId)) {
    sink.error(
      "check.unknown_asset",
      subject,
      `asset variant '${slotName}/${variantId}' does not exist`,
    );
    return;
  }
  if (slot.role !== "context") {
    sink.error(
      "check.asset_not_context",
      subject,
      `asset slot '${slotName}' has role 'presentation' and cannot be sent to the model`,
    );
  }
}

/** 检查一段 fragment 内容里的模板、说话人与媒体引用。`scope` 为 null 时只检查模板语法。 */
function checkContent(
  content: FragmentContent,
  subject: string,
  scope: Scope | null,
  sink: Sink,
): void {
  const template = (text: string, at: string) =>
    scope ? checkTemplate(text, at, scope, sink) : checkTemplateSyntax(text, at, sink);
  switch (content.type) {
    case "text":
      template(content.text, subject);
      break;
    case "dialogue":
      content.turns.forEach((turn, i) => {
        template(turn.text, `${subject}.turns[${i}]`);
        if (scope) checkSpeaker(turn.speaker, `${subject}.turns[${i}].speaker`, scope, sink);
      });
      break;
    case "media":
      if (content.caption !== undefined) template(content.caption, `${subject}.caption`);
      if (scope) checkAssetRef(content.asset, `${subject}.asset`, scope, sink);
      break;
    case "structured":
      break;
  }
}

function checkLocaleMap(
  locale: LocaleMap,
  subject: string,
  defaultLocale: string,
  scope: Scope | null,
  sink: Sink,
  opts: { keywordActivation: boolean; textOnly: boolean },
): void {
  for (const [loc, variant] of Object.entries(locale)) {
    const at = `${subject}.locale[${loc}]`;
    if (loc === defaultLocale) {
      sink.warn(
        "check.locale_duplicates_default",
        at,
        `'${loc}' is the default locale; the main content already covers it`,
      );
    }
    if (opts.textOnly && variant.content.type !== "text") {
      sink.error("check.greeting_locale_not_text", at, "greeting translations must be plain text");
      continue;
    }
    checkContent(variant.content, `${at}.content`, scope, sink);
    if (variant.activation_keys !== undefined && !opts.keywordActivation) {
      sink.warn(
        "check.locale_keys_without_keyword",
        at,
        "activation_keys only take effect when the fragment uses keyword activation",
      );
    }
  }
}

function scalarType(v: ScalarValue): ParamDecl["type"] {
  return typeof v === "string" ? "string" : typeof v === "number" ? "number" : "boolean";
}

// ---------------------------------------------------------------------------
// 各类型的最小内容
// ---------------------------------------------------------------------------

function checkTypeRequirements(c: CanonicalCreation, sink: Sink): void {
  const kinds = new Set(c.fragments.map((f) => f.kind));
  const needKind = (kind: string, what: string) => {
    if (!kinds.has(kind as never)) {
      sink.error(
        "check.type_requirement",
        "fragments",
        `a ${c.type} needs at least one ${what} fragment`,
      );
    }
  };
  switch (c.type) {
    case "character":
      needKind("character", "'character'");
      break;
    case "world":
      needKind("world", "'world'");
      break;
    case "lorebook":
      needKind("knowledge", "'knowledge'");
      break;
    case "relationship":
      if (Object.keys(c.slots ?? {}).length < 2) {
        sink.error("check.type_requirement", "slots", "a relationship needs at least two slots");
      }
      needKind("relationship", "'relationship'");
      break;
    case "scenario":
      if ((c.cast ?? []).length === 0) {
        sink.error("check.type_requirement", "cast", "a scenario needs at least one cast member");
      }
      break;
    case "persona":
      needKind("persona", "'persona'");
      break;
    case "style":
      needKind("style", "'style'");
      break;
    case "preset":
    case "prompt-module":
      // Canonicalization 已严格验证 Policy 及其与 Creative 字段的边界。
      break;
  }
}

// ---------------------------------------------------------------------------
// Reference Edge（只做本地可判断的结构检查）
// ---------------------------------------------------------------------------

function overrideTarget(o: FragmentOverride): string {
  return o.op === "add" ? o.fragment.id : o.target;
}

function checkEdgeLocal(c: CanonicalCreation, edge: ReferenceEdge, scope: Scope, sink: Sink): void {
  const at = `references[${edge.id}]`;
  for (const [slot, binding] of Object.entries(edge.bind ?? {})) {
    checkBinding(binding, `${at}.bind.${slot}`, scope, sink);
  }
  const seen = new Map<string, number>();
  (edge.override ?? []).forEach((o, i) => {
    const oat = `${at}.override[${i}]`;
    const target = overrideTarget(o);
    const first = seen.get(target);
    if (first !== undefined) {
      sink.error(
        "check.duplicate_override",
        oat,
        `fragment '${target}' is already overridden by override[${first}] on the same reference`,
      );
    } else {
      seen.set(target, i);
    }
    if ((o.op === "replace" || o.op === "remove") && o.force === true && c.type !== "scenario") {
      sink.error(
        "check.force_outside_scenario",
        oat,
        "force overrides are only allowed in a scenario",
      );
    }
    // override 的内容在被引用 Creation 的语境里解释，这里只能检查模板语法。
    if (o.op === "replace") checkContent(o.content, `${oat}.content`, null, sink);
    if (o.op === "add") {
      checkContent(o.fragment.content, `${oat}.fragment.content`, null, sink);
      for (const [loc, v] of Object.entries(o.fragment.locale ?? {})) {
        checkContent(v.content, `${oat}.fragment.locale[${loc}].content`, null, sink);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// checkCreation
// ---------------------------------------------------------------------------

export function checkCreation(c: CanonicalCreation, opts: CheckOptions = {}): CheckResult {
  const sink = new Sink();
  const scope = scopeOf(c);
  const defaultLocale = c.meta.default_locale;

  checkTypeRequirements(c, sink);

  // 重复 ID
  const edgeIds = new Set<string>();
  for (const e of c.references) {
    if (edgeIds.has(e.id)) sink.error("check.duplicate_edge", `references[${e.id}]`);
    edgeIds.add(e.id);
  }
  const slotNames = new Set<string>();
  for (const s of c.assets) {
    if (slotNames.has(s.slot)) sink.error("check.duplicate_asset_slot", `assets[${s.slot}]`);
    slotNames.add(s.slot);
    const variantIds = new Set<string>();
    for (const v of s.variants) {
      const at = `assets[${s.slot}].variants[${v.id}]`;
      if (variantIds.has(v.id)) sink.error("check.duplicate_asset_variant", at);
      variantIds.add(v.id);
      if (v.rating !== undefined && RATINGS.indexOf(v.rating) < RATINGS.indexOf(c.meta.rating)) {
        sink.error(
          "check.asset_rating_below_creation",
          at,
          `asset rating '${v.rating}' is lower than the creation rating '${c.meta.rating}'`,
        );
      }
    }
  }

  // Fragment
  for (const f of c.fragments) {
    const at = `fragments[${f.id}]`;
    if (!f.stable) {
      sink.info(
        "check.unstable_fragment",
        at,
        "unstable fragments work normally but cannot be overridden by other creations",
      );
    }
    checkContent(f.content, `${at}.content`, scope, sink);
    if (f.locale) {
      checkLocaleMap(f.locale, at, defaultLocale, scope, sink, {
        keywordActivation: f.activation?.mode === "keyword",
        textOnly: false,
      });
    }
    for (const ref of f.asset_refs ?? []) checkAssetRef(ref, `${at}.asset_refs`, scope, sink);
    const vis = f.visibility;
    if (vis?.scope === "private") {
      vis.to.forEach((to, i) => {
        checkSpeaker(to, `${at}.visibility.to[${i}]`, scope, sink);
      });
    } else if (
      vis?.scope === "scene" &&
      vis.scene !== undefined &&
      !scope.fragmentIds.has(vis.scene)
    ) {
      sink.error(
        "check.unknown_scene",
        `${at}.visibility.scene`,
        `fragment '${vis.scene}' does not exist`,
      );
    }
  }

  // Bootstrap
  if (c.bootstrap) {
    if (!BOOTSTRAP_TYPES.has(c.type)) {
      sink.warn(
        "check.bootstrap_unused",
        "bootstrap",
        `greetings are only used by characters and scenarios, not by a ${c.type}`,
      );
    }
    const ids = new Set<string>();
    for (const g of c.bootstrap.greetings) {
      const at = `bootstrap.greetings[${g.id}]`;
      if (ids.has(g.id)) sink.error("check.duplicate_greeting", at);
      ids.add(g.id);
      checkTemplate(g.text, at, scope, sink);
      if (g.locale) {
        checkLocaleMap(g.locale, at, defaultLocale, scope, sink, {
          keywordActivation: false,
          textOnly: true,
        });
      }
    }
  }

  // Param 默认值
  for (const [name, decl] of Object.entries(c.params ?? {})) {
    if (decl.default !== undefined && scalarType(decl.default) !== decl.type) {
      sink.error(
        "check.param_default_type",
        `params.${name}`,
        `default is a ${scalarType(decl.default)}, but the param is declared as ${decl.type}`,
      );
    }
  }

  // Reference Edge
  for (const e of c.references) checkEdgeLocal(c, e, scope, sink);

  // Cast
  if (
    c.cast !== undefined &&
    (!(c.type === "preset" || c.type === "prompt-module") || c.cast.length > 0)
  ) {
    if (c.type !== "scenario") {
      sink.error("check.cast_not_allowed", "cast", `a ${c.type} cannot declare a cast`);
    }
    const keys = new Set<string>();
    for (const m of c.cast) {
      const at = `cast[${m.key}]`;
      if (keys.has(m.key)) sink.error("check.duplicate_cast", at);
      keys.add(m.key);
      checkBinding(m.who, `${at}.who`, scope, sink);
    }
  }

  if (opts.source === "github" && c.meta.rating === "explicit") {
    sink.warn(
      "check.github_explicit",
      "meta.rating",
      "GitHub does not allow sexually explicit text; publish explicit creations from char.pub instead",
    );
  }

  return toResult(sink.sorted());
}

// ---------------------------------------------------------------------------
// 需要被引用 Creation 才能判断的检查
// ---------------------------------------------------------------------------

export interface EdgeContext {
  /** 声明这条 edge 的 Creation 的类型。 */
  dependentType: CreationType;
}

/**
 * 检查一条 edge 上的 override 与被引用 Creation 是否相符：
 * - replace / remove / patch 的目标必须存在，且是稳定 fragment；
 * - 对 intrinsic 依赖中 world / character 类 fragment 的 replace / remove，只能在 scenario 中
 *   带 `force: true` 进行（替换一个角色的核心设定不能静默成功）；
 * - add 追加的 fragment 不能与目标已有的 fragment 同名；
 * - override 内容里的模板与 asset 引用按被引用 Creation 的声明检查。
 */
export function checkOverrideTargets(
  edge: ReferenceEdge,
  target: CanonicalCreation,
  ctx: EdgeContext,
): CheckResult {
  const sink = new Sink();
  const scope = scopeOf(target);
  const byId = new Map(target.fragments.map((f) => [f.id, f]));
  (edge.override ?? []).forEach((o, i) => {
    const at = `references[${edge.id}].override[${i}]`;
    if (o.op === "add") {
      if (byId.has(o.fragment.id)) {
        sink.error(
          "check.override_add_conflict",
          at,
          `${target.ref} already has a fragment '${o.fragment.id}'`,
        );
      }
      checkContent(o.fragment.content, `${at}.fragment.content`, scope, sink);
      for (const [loc, v] of Object.entries(o.fragment.locale ?? {})) {
        checkContent(v.content, `${at}.fragment.locale[${loc}].content`, scope, sink);
      }
      for (const ref of o.fragment.asset_refs ?? []) {
        checkAssetRef(ref, `${at}.fragment.asset_refs`, scope, sink);
      }
      return;
    }
    const frag = byId.get(o.target);
    if (!frag) {
      sink.error(
        "check.override_target_missing",
        at,
        `${target.ref} has no fragment '${o.target}'`,
      );
      return;
    }
    if (!frag.stable) {
      sink.error(
        "check.override_target_unstable",
        at,
        `'${o.target}' in ${target.ref} is not stable and cannot be overridden`,
      );
    }
    if (
      (o.op === "replace" || o.op === "remove") &&
      edge.mode === "intrinsic" &&
      IDENTITY_KINDS.has(frag.kind) &&
      !(ctx.dependentType === "scenario" && o.force === true)
    ) {
      sink.error(
        "check.intrinsic_override_requires_force",
        at,
        `'${o.target}' is core to ${target.ref}; replacing or removing it needs a scenario with force: true, or a remix`,
      );
    }
    if (o.op === "replace") checkContent(o.content, `${at}.content`, scope, sink);
  });
  return toResult(sink.sorted());
}

/** `lore/*` 匹配 `lore/` 下的所有 fragment，`*` 匹配全部，其余按完整 ID 匹配。 */
export function matchesFragmentPattern(pattern: string, id: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("/*")) return id.startsWith(pattern.slice(0, -1));
  return pattern === id;
}

/**
 * 检查一条 edge 的 bind、params 与 select 是否与被引用 Creation 的声明相符：
 * - 只能绑定已声明的 slot；必需的 slot 必须绑定（early 或 late 都可以）；
 * - late binding 的类型必须在 slot 的 accepts 中；`{{self}}` 绑定时引用方类型必须被接受；
 * - 只能传已声明的 param，类型要一致；没有默认值的 param 必须传值；
 * - select 中不匹配任何 fragment 的模式给出警告（多半是拼写错误）。
 */
export function checkEdgeBindings(
  edge: ReferenceEdge,
  target: CanonicalCreation,
  ctx: EdgeContext,
): CheckResult {
  const sink = new Sink();
  const at = `references[${edge.id}]`;
  const slots = target.slots ?? {};
  const bind = edge.bind ?? {};
  for (const [name, b] of Object.entries(bind)) {
    const decl = slots[name];
    if (!decl) {
      sink.error(
        "check.unknown_slot_binding",
        `${at}.bind.${name}`,
        `${target.ref} has no slot '${name}'`,
      );
      continue;
    }
    const accepts = Array.isArray(decl.accepts) ? decl.accepts : [decl.accepts];
    const boundType =
      typeof b === "object" ? b.late : b === "{{self}}" ? ctx.dependentType : undefined;
    if (boundType !== undefined && !accepts.includes(boundType)) {
      sink.error(
        "check.binding_type_mismatch",
        `${at}.bind.${name}`,
        `slot '${name}' accepts ${accepts.join(", ")}, not ${boundType}`,
      );
    }
  }
  for (const [name, decl] of Object.entries(slots)) {
    if (decl.required !== false && !(name in bind)) {
      sink.error(
        "check.required_slot_unbound",
        `${at}.bind`,
        `required slot '${name}' is not bound`,
      );
    }
  }
  const params = target.params ?? {};
  const given = edge.params ?? {};
  for (const [name, value] of Object.entries(given)) {
    const decl = params[name];
    if (!decl) {
      sink.error(
        "check.unknown_param_binding",
        `${at}.params.${name}`,
        `${target.ref} has no param '${name}'`,
      );
    } else if (scalarType(value) !== decl.type) {
      sink.error(
        "check.param_type_mismatch",
        `${at}.params.${name}`,
        `param '${name}' is a ${decl.type}, got a ${scalarType(value)}`,
      );
    }
  }
  for (const [name, decl] of Object.entries(params)) {
    if (decl.default === undefined && !(name in given)) {
      sink.error(
        "check.param_unbound",
        `${at}.params`,
        `param '${name}' has no default and no value`,
      );
    }
  }
  const sel = edge.select;
  if (sel) {
    const patterns = "include" in sel ? sel.include : sel.exclude;
    for (const p of patterns) {
      if (!target.fragments.some((f) => matchesFragmentPattern(p, f.id))) {
        sink.warn(
          "check.selector_no_match",
          `${at}.select`,
          `'${p}' matches no fragment in ${target.ref}`,
        );
      }
    }
  }
  return toResult(sink.sorted());
}
