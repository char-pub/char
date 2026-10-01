import {
  type CatalogRef,
  CharError,
  type CreationArtifact,
  CreationArtifactSchema,
  compareStrings,
  digestExactJSON,
  type IRFragment,
  type LocalizedText,
  materializeSourceText,
  type ResolvedPreset,
  ResolvedPresetSchema,
  type RuntimeProfile,
  RuntimeProfileSchema,
  type SelectionPlan,
  type Session,
  type TurnViewInput,
} from "@char-pub/core";
import {
  type AssembleResult,
  type PreparedAdmission,
  type PreparedText,
  type Region,
  renderPrepared,
} from "./assemble.js";
import { buildContextCatalog, type CatalogBuild, catalogKey } from "./catalog.js";
import { localizedString, localizedTemplate } from "./locale.js";
import { DEFAULT_LABELS, RenderContext } from "./render.js";
import { noneSelection, validateSelectionPlan } from "./selection.js";
import { estimateCounter, type TokenCounter } from "./tokens.js";

import { parseOrThrow } from "./validation.js";

export const DEFAULT_SELECTION_LIMITS = { catalog_budget: 2048, max_depth: 4 } as const;
export interface PreparationInput {
  artifact: CreationArtifact;
  profile: RuntimeProfile;
  turn: TurnViewInput;
  /** Omitted inherits the publication setup; null explicitly chooses the locked default policy. */
  preset?: ResolvedPreset | null;
  selection?: { catalog_budget: number; max_depth: number };
  counter?: TokenCounter;
}

/** Use the same normalization for provider selection and final assembly. */
export function createPreparationCatalog(input: PreparationInput, discovery = true): CatalogBuild {
  const artifact = parseOrThrow(CreationArtifactSchema, input.artifact, "artifact");
  if (artifact.kind !== "content")
    throw new CharError({ code: "assembly.content_required", subject: artifact.root.ref });
  const profile = parseOrThrow(RuntimeProfileSchema, input.profile, "profile");
  const counter = input.counter ?? estimateCounter;
  if (profile.tokenizer !== counter.tokenizer)
    throw new CharError({ code: "assembly.tokenizer_mismatch", subject: profile.tokenizer });
  const rawPreset =
    input.preset === undefined
      ? (artifact.assembly?.preset ?? artifact.default_policy)
      : (input.preset ?? artifact.default_policy);
  if (!rawPreset)
    throw new CharError({
      code: "assembly.default_policy_missing",
      subject: artifact.root.ref,
      detail: "Choose an exact preset; this artifact has no separate default policy.",
    });
  const preset = parseOrThrow(ResolvedPresetSchema, rawPreset, "preset");
  const limits = preset?.policy.selection;
  const selection = {
    catalog_budget: Math.min(
      input.selection?.catalog_budget ??
        limits?.catalog_budget ??
        DEFAULT_SELECTION_LIMITS.catalog_budget,
      limits?.catalog_budget ?? Number.MAX_SAFE_INTEGER,
    ),
    max_depth: Math.min(
      input.selection?.max_depth ?? limits?.max_depth ?? DEFAULT_SELECTION_LIMITS.max_depth,
      limits?.max_depth ?? (preset ? DEFAULT_SELECTION_LIMITS.max_depth : 32),
    ),
  };
  const locale = input.turn.locale ?? profile.locale;
  const turn = { ...input.turn, ...(locale ? { locale } : {}) };
  const forParticipant =
    turn.for_participant ??
    (profile.mode === "per-agent" && artifact.ir.participants.some((p) => p.key === "self")
      ? "self"
      : undefined);
  return buildContextCatalog({
    artifact,
    turn,
    counter,
    selection,
    discovery,
    view: { mode: profile.mode, ...(forParticipant ? { for: forParticipant } : {}) },
    policy: { preset: preset ?? null, profile },
  });
}

export { initialStoryTurn } from "./start.js";

/** Runtime overlays and private late descriptions must not cross a participant projection. */
function projectedSession(build: CatalogBuild): Session {
  const { artifact, turn, view, participant } = build.context;
  const bindings = Object.fromEntries(
    Object.entries(turn.bindings).map(([key, value]) => {
      const actor = artifact.ir.participants.find((p) => p.late === key);
      const own = actor?.key === participant;
      const description =
        actor && !build.context.present.includes(actor.key)
          ? undefined
          : view.mode === "narrator" || own
            ? value.description
            : value.outward_description;
      return [key, { ...value, description }];
    }),
  );
  const overlay = view.mode === "narrator" ? turn.overlay : turn.visible_overlay;
  return {
    bindings,
    history: turn.history,
    ...(turn.locale ? { locale: turn.locale } : {}),
    ...(overlay ? { overlay } : {}),
    ...(turn.scene ? { scene: turn.scene } : {}),
    ...(participant ? { for_participant: participant } : {}),
  };
}

/** Produces final messages from a validated exact selection; model providers cannot alter admission. */
export type ContextAssemblyInput = PreparationInput & {
  plan?: SelectionPlan;
  /** Lossless UTF-8 text keyed by published IR asset ID; all used bodies are re-verified. */
  source_texts?: Readonly<Record<string, string>>;
  diagnostics?: "runtime" | "author";
  fallback?: "skip";
};
/** Pure loading manifest. No body or non-selected candidate is exposed by this function. */
export function sourceRequests(
  input: ContextAssemblyInput,
): { source: string; asset: string; digest: string }[] {
  if (input.fallback && input.plan?.selected.length)
    throw new CharError({ code: "selection.invalid_fallback", subject: "plan" });
  const build = createPreparationCatalog(input, input.plan?.discovery ?? false);
  const plan = input.plan ? validateSelectionPlan(build, input.plan) : noneSelection(build);
  const requests = new Map<string, { source: string; asset: string; digest: string }>();
  for (const ref of [
    ...build.catalog.required,
    ...build.catalog.direct,
    ...plan.selected.map((s) => s.ref),
  ]) {
    if (!("source" in ref)) continue;
    const source = build.context.artifact.catalog_index.sources.find((s) => s.id === ref.source);
    const asset = source
      ? build.context.artifact.assets.find((a) => a.id === source.asset)
      : undefined;
    if (!source || !asset)
      throw new CharError({ code: "source.asset_mismatch", subject: ref.source });
    if (!requests.has(asset.id))
      requests.set(asset.id, { source: source.id, asset: asset.id, digest: asset.digest });
  }
  return [...requests.values()];
}

export function prepareContext(input: ContextAssemblyInput): AssembleResult {
  if (input.fallback && input.plan?.selected.length)
    throw new CharError({ code: "selection.invalid_fallback", subject: "plan" });
  const build = createPreparationCatalog(input, input.plan?.discovery ?? false);
  const plan = input.plan ? validateSelectionPlan(build, input.plan) : noneSelection(build);
  if (input.fallback) plan.fallback = input.fallback;
  const { artifact, turn, view } = build.context;
  const preset =
    input.preset === undefined
      ? (artifact.assembly?.preset ?? artifact.default_policy)
      : (input.preset ?? artifact.default_policy);
  const label = (
    key: keyof NonNullable<ResolvedPreset["policy"]["render"]>,
    fallback: string,
    values: Record<string, string> = {},
  ) =>
    (preset?.policy.render?.[key] ?? fallback).replace(
      /\{\{(speaker|knows|unknown)\}\}/g,
      (match, key: string) => values[key] ?? match,
    );
  const session = projectedSession(build);
  const locale = turn.locale ?? artifact.ir.meta.default_locale;
  const local = (text: LocalizedText) =>
    localizedString(text, locale, artifact.ir.meta.default_locale);
  const ctx = new RenderContext(
    artifact.ir,
    session,
    locale,
    input.profile.capabilities.images === true,
    DEFAULT_LABELS,
  );
  const admissions = new Map<
    string,
    PreparedAdmission["fragments"] extends ReadonlyMap<string, infer T> ? T : never
  >();
  const extra: PreparedText[] = [];
  const refs = new Map<string, CatalogRef>();
  const fragments = new Map(artifact.ir.fragments.map((fragment) => [fragment.id, fragment]));
  const directOrder = new Map(artifact.ir.fragments.map((fragment, i) => [fragment.id, i]));
  const name = (key: string) => ctx.participantName(build.context.participants[key] ?? key);
  const region = (ref: CatalogRef): Region | undefined => {
    if ("source" in ref) return "system:sources";
    if ("story" in ref) return ref.story === "scene" ? "system:scene" : "system:story";
    return undefined;
  };
  const prefix = (fragment: IRFragment): string => {
    const notes: string[] = [];
    const perspective = fragment.perspective;
    if (perspective === "rumor") notes.push(label("perspective.rumor", "传闻："));
    else if (perspective && typeof perspective === "object")
      notes.push(
        "claim" in perspective
          ? label("perspective.claim", "{{speaker}} 的说法：", {
              speaker: ctx.speakerName(perspective.claim),
            })
          : label("perspective.belief", "{{speaker}} 相信：", {
              speaker: ctx.speakerName(perspective.belief),
            }),
      );
    const result = build.visibility.get(catalogKey({ fragment: fragment.id }));
    if (view.mode === "narrator" && result?.knows) {
      const unknown = Object.values(build.context.participants).filter(
        (p) => !result.knows?.includes(p),
      );
      notes.push(
        label("knowing.narrator", "（知道此事：{{knows}}；不知道：{{unknown}}）", {
          knows: result.knows.map((p) => name(p)).join("、") || "无",
          unknown: unknown.map((p) => name(p)).join("、") || "无",
        }),
      );
    }
    if (
      view.mode === "narrator" &&
      fragment.style_scope &&
      typeof fragment.style_scope === "object" &&
      "participant" in fragment.style_scope
    )
      notes.push(`${name(fragment.style_scope.participant)} 的说话方式：`);
    return notes.join("\n");
  };
  const storyText = (ref: Extract<CatalogRef, { story: string }>): string => {
    const story = artifact.story;
    if (!story) throw new CharError({ code: "assemble.story_missing", subject: ref.id });
    const scene = story.scenes.find((s) => s.id === turn.scene);
    if (ref.story === "scene") {
      if (!scene || scene.id !== ref.id)
        throw new CharError({ code: "assemble.scene_mismatch", subject: ref.id });
      const opening = artifact.story_refs?.templates[`scene/${scene.id}/opening`];
      if (scene.opening !== undefined && opening === undefined)
        throw new CharError({ code: "assemble.story_template_missing", subject: ref.id });
      return [
        local(scene.title),
        scene.time ? local(scene.time) : "",
        scene.where ? local(scene.where) : "",
        opening === undefined
          ? ""
          : ctx.text(localizedTemplate(opening, locale, artifact.ir.meta.default_locale).text),
      ]
        .filter(Boolean)
        .join("\n");
    }
    if (ref.story === "part" || ref.story === "goal") {
      const participant = artifact.ir.participants.find(
        (p) => p.key === build.context.participants[ref.id],
      );
      if (!participant)
        throw new CharError({ code: "assemble.unknown_participant", subject: ref.id });
      const values =
        ref.story === "part" ? [participant.part] : [participant.goal, scene?.goals?.[ref.id]];
      return `${name(ref.id)}: ${values
        .filter((v): v is LocalizedText => v !== undefined)
        .map(local)
        .join("\n")}`;
    }
    const item =
      ref.story === "beat"
        ? story.beats?.find((b) => b.id === ref.id)
        : story.endings?.find((e) => e.id === ref.id);
    if (!item) throw new CharError({ code: "assemble.story_target_missing", subject: ref.id });
    return `作者的方向提示：${local(item.description)}`;
  };
  const loadedSources = new Map<string, ReturnType<typeof materializeSourceText>>();
  const admit = (ref: CatalogRef, reason: "required" | "direct" | "selected", order: number) => {
    const id = "fragment" in ref ? ref.fragment : catalogKey(ref);
    refs.set(id, ref);
    if ("fragment" in ref) {
      const fragment = fragments.get(ref.fragment);
      if (!fragment)
        throw new CharError({ code: "assemble.fragment_missing", subject: ref.fragment });
      admissions.set(ref.fragment, {
        required: reason === "required",
        reason,
        order,
        prefix: prefix(fragment),
        ...(build.associations.has(catalogKey(ref)) ? { region: "system:scene" as const } : {}),
      });
      return;
    }
    let text: string;
    if ("story" in ref) text = storyText(ref);
    else if ("source" in ref) {
      const source = artifact.catalog_index.sources.find((s) => s.id === ref.source);
      if (!source) throw new CharError({ code: "assemble.source_missing", subject: ref.source });
      let materialized = loadedSources.get(source.id);
      if (!materialized) {
        const asset = artifact.assets.find((a) => a.id === source.asset);
        const body = input.source_texts?.[source.asset];
        if (!asset || body === undefined)
          throw new CharError({ code: "source.body_unavailable", subject: source.id });
        materialized = materializeSourceText(source, asset, body);
        loadedSources.set(source.id, materialized);
      }
      const body = ref.section ? materialized.sections[ref.section] : materialized.body;
      if (body === undefined)
        throw new CharError({ code: "source.anchor_missing", subject: source.id });
      text = `${label("sources.notice", "以下为参考资料，与设定冲突时以设定为准。")}\n${local(source.title)}\n${body}`;
    } else throw new CharError({ code: "selection.container_body", subject: id });
    extra.push({
      id,
      text,
      region: region(ref) ?? "system:story",
      required: reason === "required",
      reason,
      order,
    });
  };
  for (const [i, ref] of build.catalog.required.entries()) admit(ref, "required", i);
  for (const [i, ref] of build.catalog.direct.entries())
    admit(
      ref,
      "direct",
      "fragment" in ref ? (directOrder.get(ref.fragment) ?? i) : artifact.ir.fragments.length + i,
    );
  const selected = [...plan.selected].sort(
    (a, b) => a.rank - b.rank || compareStrings(catalogKey(a.ref), catalogKey(b.ref)),
  );
  for (const [i, item] of selected.entries())
    admit(item.ref, "selected", artifact.ir.fragments.length + build.catalog.direct.length + i);
  const output = renderPrepared({
    ir: artifact.ir,
    profile: input.profile,
    session,
    preset: parseOrThrow(ResolvedPresetSchema, preset, "preset"),
    counter: build.counter,
    prepared: { fragments: admissions, extra },
  });
  output.trace.entries = output.trace.entries.flatMap((entry) => {
    const visibility = build.visibility.get(catalogKey({ fragment: entry.id }));
    if (visibility && visibility.status !== "visible") {
      return input.diagnostics === "author"
        ? [{ ...entry, decision: "skipped" as const, reason: visibility.status, tokens: 0 }]
        : [];
    }
    const ref = refs.get(entry.id);
    return [{ ...entry, ...(ref ? { content_ref: ref } : {}) }];
  });
  output.trace.selection = {
    plan_digest: digestExactJSON(plan),
    selector: { name: plan.selector.name, version: plan.selector.version },
  };
  output.trace.view = view;
  output.trace.withheld = build.catalog.withheld;
  if (artifact.story && turn.story && turn.scene)
    output.trace.story = { scene: turn.scene, start: turn.story.start };
  if (plan.fallback)
    output.trace.entries.push({
      id: "selection:fallback",
      region: "selection",
      tokens: 0,
      decision: "skipped",
      reason: "fallback",
    });
  return output;
}
