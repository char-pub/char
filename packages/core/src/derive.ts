import { canonicalizeCreation } from "./canonical.js";
import { checkCreation } from "./check.js";
import { getCreationDependencies } from "./dependencies.js";
import { CharError } from "./errors.js";
import { checkDependencyLicense, type LicenseCheck } from "./license.js";
import { type ReleaseInput, resolveUseRef } from "./resolve/graph.js";
import {
  type Binding,
  type Creation,
  CreationIdSchema,
  CreationSchema,
  type Fragment,
  type FragmentContent,
  type FragmentOverride,
  type LocalizedText,
  UnversionedRefSchema,
  type Visibility,
} from "./schema/creation.js";
import { type ExactRef, publishedIdentity } from "./schema/identity.js";
import {
  type Story,
  type StoryCondition,
  type StoryContinuationInput,
  StoryContinuationInputSchema,
  type StoryEffect,
} from "./schema/story.js";
import { controlledInformation } from "./story/check.js";
import { validateStoryState } from "./story/evaluate.js";

export interface DeriveCreationInput {
  kind: "remix" | "sequel";
  /** The authorized immutable published definition, not a compiled or player-state snapshot. */
  source: ReleaseInput;
  /** Assigned by the caller; Registry must authorize and enforce this new identity. */
  target: { id: string; ref: string; display_name?: LocalizedText };
  /** A static authoring choice. Its conditions are not evaluated or claimed to have occurred. */
  ending?: string;
  /** Reviewed authored-key situation, with prior progress deliberately reset. Sequel only. */
  from_play?: StoryContinuationInput;
}
export interface DeriveCreationResult {
  creation: Creation;
  source: ExactRef;
  license: LicenseCheck;
  notices: { code: string; detail: string }[];
}

/** Prepare a derivative definition without IO, runtime progress, or publishing authority. */
export function deriveCreation(input: DeriveCreationInput): DeriveCreationResult {
  if (input.from_play !== undefined && (input.kind !== "sequel" || input.ending !== undefined))
    throw new CharError({ code: "derive.invalid_continuation", subject: "from_play" });
  const fromPlay =
    input.from_play === undefined ? undefined : StoryContinuationInputSchema.parse(input.from_play);
  const identity = publishedIdentity(input.source);
  const canonical = canonicalizeCreation(input.source.creation);
  const original = canonical.creation;
  const source: ExactRef = {
    ref: original.ref,
    ...identity,
    semantic_digest: canonical.semantic_digest,
  };
  if (
    input.source.semantic_digest !== undefined &&
    input.source.semantic_digest !== source.semantic_digest
  )
    throw new CharError({ code: "resolve.semantic_digest_mismatch", subject: source.release });
  if (input.source.status === "tombstoned")
    throw new CharError({ code: "resolve.tombstoned", subject: source.ref });
  const target = {
    id: CreationIdSchema.parse(input.target.id),
    ref: UnversionedRefSchema.parse(input.target.ref),
  };
  if (target.id === original.id || target.ref === original.ref)
    throw new CharError({ code: "derive.new_identity_required", subject: target.ref });
  for (const dependency of getCreationDependencies(original))
    if (!dependency.pin || !("release" in dependency.pin))
      throw new CharError({ code: "resolve.unpinned", subject: `${source.ref}/${dependency.id}` });
  const license = checkDependencyLicense({
    dependent: original.meta.license,
    dependency: original.meta.license,
    modified: true,
  });
  if (license.verdict === "fail")
    throw new CharError({
      code: "derive.license_not_allowed",
      subject: source.ref,
      data: { reasons: license.reasons },
    });
  const creation = CreationSchema.parse(JSON.parse(JSON.stringify(canonical.json)));
  const notices: DeriveCreationResult["notices"] = [];
  if (input.source.status === "yanked")
    notices.push({ code: "derive.source_yanked", detail: "The exact source release is yanked." });
  if (input.kind === "sequel") {
    if (creation.type !== "scenario")
      throw new CharError({ code: "derive.sequel_requires_scenario", subject: source.ref });
    creation.story = sequelStory(creation, input.ending, notices, fromPlay);
    delete creation.bootstrap;
    delete creation.assembly_tests;
    notices.push({
      code: "derive.background_copied",
      detail:
        "Background definitions and exact dependencies are copied for editing; previous plot progress and greeting are not continued.",
    });
  } else if (input.ending !== undefined) {
    throw new CharError({ code: "derive.ending_requires_sequel", subject: source.ref });
  } else if (creation.assembly_tests?.length) {
    notices.push({
      code: "derive.tests_require_review",
      detail:
        "Copied author tests retain their original expectations; rerun them for the new identity and content.",
    });
  }
  const rewrite = (ref: string): string =>
    ref === source.ref
      ? target.ref
      : ref.startsWith(`${source.ref}#`)
        ? `${target.ref}${ref.slice(source.ref.length)}`
        : ref;
  const binding = (value: Binding): Binding =>
    typeof value !== "string"
      ? value
      : value.startsWith("#")
        ? resolveUseRef(value, source.ref)
        : rewrite(value);
  const visibility = (value: Visibility | undefined) => {
    if (value?.scope === "private") value.to = value.to.map(rewrite);
  };
  const content = (value: FragmentContent) => {
    if (value.type === "dialogue")
      for (const turn of value.turns) turn.speaker = rewrite(turn.speaker);
  };
  const fragment = (value: Fragment) => {
    delete value.digest;
    content(value.content);
    for (const entry of Object.values(value.locale ?? {})) content(entry.content);
    if (value.about) value.about = value.about.map(rewrite);
    if (value.source) value.source.use = rewrite(value.source.use);
    if (typeof value.perspective === "object") {
      if ("claim" in value.perspective) value.perspective.claim = rewrite(value.perspective.claim);
      else value.perspective.belief = rewrite(value.perspective.belief);
    }
    visibility(value.visibility);
  };
  const overrides = (values: FragmentOverride[] | undefined) => {
    for (const value of values ?? []) {
      if (value.op === "add") fragment(value.fragment);
      else if (value.op === "replace") content(value.content);
      else if (value.op === "patch") visibility(value.set.visibility);
    }
  };
  for (const value of creation.fragments) fragment(value);
  for (const edge of creation.references) {
    if (edge.use.startsWith("#")) edge.use = resolveUseRef(edge.use, source.ref);
    if (edge.bind)
      for (const key of Object.keys(edge.bind)) edge.bind[key] = binding(edge.bind[key] as Binding);
    overrides(edge.override);
  }
  for (const member of creation.cast ?? []) {
    member.who = binding(member.who);
    overrides(member.override);
  }
  if (creation.story) rewriteStory(creation.story, rewrite);
  creation.id = target.id;
  creation.ref = target.ref;
  if (input.target.display_name !== undefined) creation.display_name = input.target.display_name;
  delete creation.provenance.client_id;
  creation.provenance.derived_from = [
    ...(creation.provenance.derived_from ?? []),
    { ...source, relation: input.kind },
  ];
  const prepared = canonicalizeCreation(creation);
  const checked = checkCreation(prepared.creation);
  if (!checked.ok)
    throw new CharError({
      code: "derive.invalid_result",
      subject: target.ref,
      data: { diagnostics: checked.diagnostics },
    });
  return { creation: prepared.creation, source, license, notices };
}

function sequelStory(
  creation: Creation,
  endingId: string | undefined,
  notices: DeriveCreationResult["notices"],
  fromPlay?: StoryContinuationInput,
): Story {
  const prior = creation.story;
  if (fromPlay) {
    if (!prior) throw new CharError({ code: "derive.story_required", subject: "from_play" });
    validateStoryState(
      prior,
      (creation.cast ?? []).map((member) => member.key),
      {
        start: prior.starts?.[0]?.id ?? "default",
        scene: fromPlay.scene,
        present: fromPlay.present,
        vars: fromPlay.vars,
        knowing: fromPlay.knowing,
        visited: [fromPlay.scene],
        reached: [],
        ended: [],
        happened: [],
        stopped: false,
      },
    );
  }
  const ending =
    endingId === undefined ? undefined : prior?.endings?.find((item) => item.id === endingId);
  if (endingId !== undefined && !ending)
    throw new CharError({ code: "derive.ending_missing", subject: endingId });
  const scoped = new Set<string>();
  const visibility = (value: Visibility | undefined) => {
    if (value?.scope === "story-scene") scoped.add(value.scene);
  };
  const overrides = (values: FragmentOverride[] | undefined) => {
    for (const value of values ?? []) {
      if (value.op === "add") visibility(value.fragment.visibility);
      else if (value.op === "patch") visibility(value.set.visibility);
    }
  };
  for (const fragment of creation.fragments) visibility(fragment.visibility);
  for (const edge of creation.references) {
    if (typeof edge.scope === "object" && "scene" in edge.scope) scoped.add(edge.scope.scene);
    overrides(edge.override);
  }
  for (const cast of creation.cast ?? []) overrides(cast.override);
  let sceneId = "opening";
  for (let number = 2; prior?.scenes.some((scene) => scene.id === sceneId); number++)
    sceneId = `opening-${number}`;
  const placeholders = [...scoped]
    .filter((id) => id !== fromPlay?.scene)
    .sort()
    .map((id) => {
      const original = prior?.scenes.find((scene) => scene.id === id);
      if (!original) throw new CharError({ code: "derive.scene_scope_missing", subject: id });
      notices.push({
        code: "derive.scene_scope_retained",
        detail: `Background scope '${id}' is preserved as an editable scene without its previous plot or opening.`,
      });
      return { id, title: original.title };
    });
  const knowing: NonNullable<Story["knowing"]> = {};
  for (const ref of prior ? controlledInformation(prior) : []) {
    const entry = prior?.knowing?.[ref];
    knowing[ref] = {
      start: fromPlay ? { knows: fromPlay.knowing[ref] ?? [] } : (entry?.start ?? { knows: [] }),
    };
  }
  if (fromPlay && prior) {
    const scene = prior.scenes.find((item) => item.id === fromPlay.scene);
    if (!scene)
      throw new CharError({ code: "derive.scene_scope_missing", subject: fromPlay.scene });
    notices.push({
      code: "derive.progress_reset",
      detail:
        "The reviewed situation becomes a new opening. Previous starts, conditions, goals, entry knowledge and plot progress are not replayed; only the opening scene is visited.",
    });
    return {
      version: 1,
      scenes: [
        {
          id: scene.id,
          title: scene.title,
          cast: fromPlay.present,
          opening: fromPlay.opening,
          ...(scene.time !== undefined ? { time: scene.time } : {}),
          ...(scene.where !== undefined ? { where: scene.where } : {}),
          ...(scene.place !== undefined ? { place: scene.place } : {}),
          ...(scene.lore !== undefined ? { lore: scene.lore } : {}),
          ...(scene.items !== undefined ? { items: scene.items } : {}),
        },
        ...placeholders,
      ],
      starts: [{ id: "continuation", scene: scene.id }],
      ...(prior.vars
        ? {
            vars: Object.fromEntries(
              Object.entries(prior.vars).map(([key, variable]) => [
                key,
                { ...variable, init: fromPlay.vars[key] },
              ]),
            ) as NonNullable<Story["vars"]>,
          }
        : {}),
      ...(prior.items ? { items: prior.items } : {}),
      ...(Object.keys(knowing).length ? { knowing } : {}),
    };
  }
  return {
    version: 1,
    scenes: [{ id: sceneId, title: "New scene" }, ...placeholders],
    starts: [
      {
        id: "continuation",
        scene: sceneId,
        ...(ending ? { title: ending.title, set: ending.effects ?? [] } : {}),
      },
    ],
    ...(prior?.vars ? { vars: prior.vars } : {}),
    ...(prior?.items ? { items: prior.items } : {}),
    ...(Object.keys(knowing).length ? { knowing } : {}),
  };
}

function rewriteStory(story: Story, rewrite: (ref: string) => string): void {
  const condition = (value: StoryCondition) => {
    if ("knows" in value) value.knows.info = rewrite(value.knows.info);
    else if ("all" in value) for (const child of value.all) condition(child);
    else if ("any" in value) for (const child of value.any) condition(child);
    else if ("not" in value) condition(value.not);
  };
  const effects = (values: StoryEffect[] | undefined) => {
    for (const value of values ?? [])
      if ("learn" in value) value.learn.info = rewrite(value.learn.info);
  };
  for (const scene of story.scenes) {
    if (scene.place) scene.place = rewrite(scene.place);
    if (scene.lore) scene.lore = scene.lore.map(rewrite);
    if (scene.when) condition(scene.when);
  }
  for (const item of [
    ...(story.beats ?? []),
    ...(story.endings ?? []),
    ...(story.choices ?? []),
    ...(story.events ?? []),
  ]) {
    if (item.when) condition(item.when);
    if ("effects" in item) effects(item.effects);
    if ("place" in item && item.place) item.place = rewrite(item.place);
    if ("truth" in item && item.truth) item.truth = rewrite(item.truth);
    if ("lore" in item && item.lore) item.lore = item.lore.map(rewrite);
  }
  for (const item of story.items ?? []) if (item.lore) item.lore = item.lore.map(rewrite);
  for (const start of story.starts ?? []) effects(start.set);
  if (story.knowing)
    story.knowing = Object.fromEntries(
      Object.entries(story.knowing).map(([ref, entry]) => [rewrite(ref), entry]),
    );
}
