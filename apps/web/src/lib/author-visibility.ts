/** Author-only checks over a built snapshot; never part of model or Selector input. */
import type { ContentArtifact } from "@char-pub/assembler";
import { type KnowledgeSource, type LateBindingValue, participantKey } from "@char-pub/core";
import type { Working } from "./draft";
import { localized } from "./text";

export interface AuthorVisibilityCheck {
  kind: "source" | "outward" | "goal";
  id: string;
  title: string;
  detail: string;
  subject?: string;
  shareSource?: string;
}

export function authorVisibilityChecks(
  artifact: ContentArtifact,
  bindings: Readonly<Record<string, LateBindingValue>> = {},
): AuthorVisibilityCheck[] {
  const result: AuthorVisibilityCheck[] = [];
  const locale = artifact.ir.meta.default_locale;
  const rootOwner = `${artifact.root.ref}~root`;
  for (const source of artifact.catalog_index.sources) {
    if (source.shared) continue;
    const local = source.owner === rootOwner;
    const work = artifact.catalog_index.works.find((value) => value.id === source.owner);
    result.push({
      kind: "source",
      id: source.id,
      title: localized(source.title, locale),
      detail: local
        ? "No individual character can read this document. Share it only if all characters may consult it."
        : `No individual character can read this document. Its visibility is defined in ${work?.ref ?? source.owner}; edit that source work to change it.`,
      ...(local ? { subject: `sources[${source.local_id}]`, shareSource: source.id } : {}),
    });
  }
  for (const participant of artifact.ir.participants) {
    const binding = participant.late ? bindings[participant.late] : undefined;
    const name = binding?.display_name ?? localized(participant.display_name, locale);
    const title = participant.cast_key ? `${name} · ${participant.cast_key}` : name;
    const localCast = participant.cast_scope === "root" ? participant.cast_key : undefined;
    const subject = localCast
      ? `cast[${localCast}]`
      : participant.key === "self"
        ? "fragments"
        : undefined;
    const outward =
      !!binding?.outward_description ||
      artifact.ir.fragments.some((fragment) => {
        if (!fragment.outward || !["character", "persona", "examples"].includes(fragment.kind))
          return false;
        const role = artifact.ir.graph.instances.find(
          (instance) => instance.key === fragment.origin.instance_key,
        )?.cast;
        const owner = fragment.subject ?? (role ? participantKey(role.scope, role.key) : undefined);
        return owner === participant.key;
      });
    if (!outward)
      result.push({
        kind: "outward",
        id: participant.key,
        title,
        detail: participant.late
          ? "This role has no outward description in these bindings. Add one in Session controls if other characters should see its appearance."
          : "This character has no outward fragments. Put appearance or other public traits in a separate outward fragment in the character or its cast override.",
        ...(!participant.late && subject ? { subject } : {}),
      });
    if (participant.goal)
      result.push({
        kind: "goal",
        id: `participant:${participant.key}`,
        title: `${title} — character goal`,
        detail:
          "Goals are private to their character. If this includes a fact others should know, write an information fragment and use knowing to name its readers.",
        ...(localCast ? { subject: `cast[${localCast}].goal` } : {}),
      });
  }
  for (const scene of artifact.story?.scenes ?? []) {
    for (const key of Object.keys(scene.goals ?? {})) {
      result.push({
        kind: "goal",
        id: `scene:${scene.id}:${key}`,
        title: `${localized(scene.title, locale)} — ${key}'s goal`,
        detail:
          "A scene goal is private to its character. If others should know part of it, move that fact to an information fragment and declare knowing.",
        subject: `story.scenes[${scene.id}].goals`,
      });
    }
  }
  return result;
}

/** Prepare one local visibility edit; the caller still enforces current actor and snapshot ownership. */
export function shareAuthorSource(working: Working, artifact: ContentArtifact, compiledId: string) {
  const source = artifact.catalog_index.sources.find((entry) => entry.id === compiledId);
  if (!source || source.owner !== `${artifact.root.ref}~root` || source.shared)
    throw new Error("Only an unshared document in this work can be changed here.");
  const sources = Array.isArray(working.sources) ? (working.sources as KnowledgeSource[]) : [];
  const matches = sources.filter((entry) => entry.id === source.local_id);
  if (matches.length !== 1 || !matches[0] || matches[0].visibility?.scope === "shared")
    throw new Error("The document changed. Build this draft again before sharing it.");
  const before = structuredClone(matches[0]);
  const after: KnowledgeSource = { ...before, visibility: { scope: "shared" } };
  const changed = {
    ...working,
    sources: sources.map((entry) => (entry.id === before.id ? after : entry)),
  };
  return {
    working: changed,
    undo(current: Working): Working {
      const entries = Array.isArray(current.sources) ? (current.sources as KnowledgeSource[]) : [];
      const same = entries.filter((entry) => entry.id === before.id);
      if (same.length !== 1 || JSON.stringify(same[0]) !== JSON.stringify(after))
        throw new Error(
          "This document changed after sharing. Review its visibility in Reference documents.",
        );
      return {
        ...current,
        sources: entries.map((entry) => (entry.id === before.id ? structuredClone(before) : entry)),
      };
    },
  };
}
