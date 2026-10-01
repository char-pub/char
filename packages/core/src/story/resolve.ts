import type { CanonicalCreation } from "../canonical.js";
import { resolveCatalogReference } from "../catalog-index.js";
import { CharError } from "../errors.js";
import { participantKey, ROOT_INSTANCE } from "../keys.js";
import type {
  CatalogIndex,
  CatalogRef,
  CompiledTemplate,
  StoryReferences,
} from "../schema/catalog.js";
import type { ContextIR } from "../schema/ir.js";
import type { Story, StoryCondition, StoryEffect } from "../schema/story.js";

export function resolveStoryReferences(
  creation: CanonicalCreation,
  ir: ContextIR,
  index: CatalogIndex,
  templates: Record<string, CompiledTemplate> = {},
): StoryReferences {
  const participants: Record<string, string> = {};
  for (const cast of creation.cast ?? []) {
    const key = participantKey(ROOT_INSTANCE, cast.key);
    if (!ir.participants.some((p) => p.key === key))
      throw new CharError({ code: "story.participant_missing", subject: cast.key });
    participants[cast.key] = key;
  }
  const information: Record<string, string> = {};
  const content: Record<string, CatalogRef> = {};
  const resolve = (ref: string, kind: "fragment" | "content"): void => {
    const resolved = resolveCatalogReference(ref, ir, index, ROOT_INSTANCE, kind);
    if ("fragment" in resolved) information[ref] = resolved.fragment;
    content[ref] = resolved;
  };
  if (creation.story) visitStoryInformation(creation.story, resolve);
  return { participants, information, content, templates };
}

/** Visit information-bearing fields; narrative prose is never parsed as a reference. */
export function visitStoryInformation(
  story: Story,
  visit: (ref: string, kind: "fragment" | "content") => void,
): void {
  const condition = (node: StoryCondition) => {
    const pending = [node];
    while (pending.length) {
      const item = pending.pop();
      if (!item) break;
      if ("knows" in item) visit(item.knows.info, "fragment");
      else if ("all" in item) pending.push(...item.all);
      else if ("any" in item) pending.push(...item.any);
      else if ("not" in item) pending.push(item.not);
    }
  };
  const effect = (node: StoryEffect) => {
    if ("learn" in node) visit(node.learn.info, "fragment");
  };
  for (const ref of Object.keys(story.knowing ?? {})) visit(ref, "fragment");
  for (const scene of story.scenes) {
    if (scene.place) visit(scene.place, "fragment");
    for (const ref of scene.lore ?? []) visit(ref, "content");
    if (scene.when) condition(scene.when);
  }
  for (const item of [
    ...(story.beats ?? []),
    ...(story.endings ?? []),
    ...(story.events ?? []),
    ...(story.choices ?? []),
  ]) {
    if (item.when) condition(item.when);
    if ("effects" in item) for (const node of item.effects ?? []) effect(node);
    if ("place" in item && item.place) visit(item.place, "fragment");
    if ("truth" in item && item.truth) visit(item.truth, "fragment");
    if ("lore" in item) for (const ref of item.lore ?? []) visit(ref, "content");
  }
  for (const item of story.items ?? []) for (const ref of item.lore ?? []) visit(ref, "content");
  for (const start of story.starts ?? []) for (const node of start.set ?? []) effect(node);
}
