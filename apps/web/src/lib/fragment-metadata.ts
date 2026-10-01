import {
  type Fragment,
  type KnowledgeSource,
  SegmentSchema,
  SpeakerRefSchema,
} from "@char-pub/core";
import { localeOf, type Working } from "./draft";
import { storyOf, storyText } from "./story-editor";

export interface MetadataOption {
  value: string;
  label: string;
}
export function speakerOptions(w: Working): MetadataOption[] {
  const values: MetadataOption[] = [{ value: "{{user}}", label: "Player ({{user}})" }];
  if (w.type === "character" || w.type === "persona")
    values.push({ value: "{{self}}", label: "This character ({{self}})" });
  for (const name of Object.keys(w.slots ?? {}))
    values.push({ value: `{{slot:${name}}}`, label: `Slot: ${name}` });
  if (w.type === "scenario")
    for (const member of (w.cast ?? []) as { key: string }[])
      values.push({ value: `{{cast:${member.key}}}`, label: `Role: ${member.key}` });
  for (const edge of w.references ?? [])
    if (SpeakerRefSchema.safeParse(edge.use).success && !values.some((v) => v.value === edge.use))
      values.push({ value: edge.use, label: `${edge.use} (build verifies participant)` });
  return values;
}
export function speakerError(w: Working, value: string): string | null {
  if (!SpeakerRefSchema.safeParse(value).success)
    return "Use a player, character, slot, cast role, or @namespace/work reference.";
  if (value.startsWith("@")) return null;
  return speakerOptions(w).some((option) => option.value === value)
    ? null
    : `Missing speaker target: ${value}. Choose an existing target.`;
}
export function sourceOptions(w: Working): MetadataOption[] {
  return ((w.sources ?? []) as KnowledgeSource[]).flatMap((source) => [
    { value: `#source/${source.id}`, label: storyText(source.title, localeOf(w)) || source.id },
    ...(source.sections ?? []).map((section) => ({
      value: `#source/${source.id}/${section.id}`,
      label: `${storyText(source.title, localeOf(w)) || source.id} / ${storyText(section.title, localeOf(w)) || section.id}`,
    })),
  ]);
}
export function sourceError(w: Working, value: string): string | null {
  const parts = value.split("#");
  const [owner, target] = parts;
  const alias = target?.startsWith("source/") ? target.slice(7) : target;
  if (
    parts.length !== 2 ||
    !alias ||
    alias.split("/").length > 2 ||
    !alias.split("/").every((part) => SegmentSchema.safeParse(part).success)
  )
    return "Use #source/id[/section], @namespace/work#source/id[/section], or cast:role#source/id[/section]. Build verifies dependency targets.";
  if (!owner)
    return sourceOptions(w).some((option) => option.value === `#source/${alias}`)
      ? null
      : `Missing source or section: ${value}.`;
  if (owner.startsWith("cast:")) return speakerError(w, `{{cast:${owner.slice(5)}}}`);
  if (owner.startsWith("@") && SpeakerRefSchema.safeParse(owner).success) return null;
  return "Use a local Source, a public work reference, or a declared cast role. Build verifies dependency targets.";
}
export type MetadataKey =
  | "description"
  | "perspective"
  | "source"
  | "selectable"
  | "outward"
  | "visibility";
export function metadataError(w: Working, fragment: Fragment, key: MetadataKey): string | null {
  if (key === "description" && fragment.selectable && !fragment.description)
    return "Turn off AI selection before removing the description.";
  if (
    key === "selectable" &&
    fragment.selectable !== undefined &&
    fragment.activation?.mode !== "keyword"
  )
    return "AI selection is available only for keyword passages.";
  if (key === "selectable" && fragment.selectable && !fragment.description)
    return "Add a description before enabling AI selection.";
  if (
    key === "outward" &&
    fragment.outward !== undefined &&
    !["character", "persona", "examples"].includes(fragment.kind)
  )
    return "Outward content requires character, persona, or examples kind.";
  if (key === "perspective" && typeof fragment.perspective === "object")
    return speakerError(
      w,
      "claim" in fragment.perspective ? fragment.perspective.claim : fragment.perspective.belief,
    );
  if (key === "source" && fragment.source) return sourceError(w, fragment.source.use);
  if (key === "visibility" && fragment.visibility) {
    const visibility = fragment.visibility;
    if (visibility.scope === "private")
      return visibility.to.length
        ? (visibility.to.map((ref) => speakerError(w, ref)).find(Boolean) ?? null)
        : "Choose at least one recipient.";
    if (
      visibility.scope === "story-scene" &&
      !storyOf(w)?.scenes.some((scene) => scene.id === visibility.scene)
    )
      return "The Story scene no longer exists. Choose another scene.";
    if (
      visibility.scope === "scene" &&
      visibility.scene &&
      !w.fragments?.some((f) => f.id === visibility.scene)
    )
      return "The scene passage no longer exists. Choose another passage.";
  }
  return null;
}
