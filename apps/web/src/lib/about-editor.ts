import type { CastMember, Fragment } from "@char-pub/core";
import type { Working } from "./draft";
export type DraftAboutTarget =
  | { kind: "fragment"; id: string }
  | { kind: "participant"; id: string }
  | { kind: "work"; id: string };
export function draftAboutTarget(w: Working, ref: string): DraftAboutTarget | null {
  const local = ref.startsWith("#")
    ? ref.slice(1)
    : typeof w.ref === "string" && ref.startsWith(`${w.ref}#`)
      ? ref.slice(w.ref.length + 1)
      : null;
  if (local !== null)
    return (w.fragments ?? []).some((f) => f.id === local) ? { kind: "fragment", id: local } : null;
  if (ref.startsWith("cast:") && !ref.includes("#")) {
    const key = ref.slice(5);
    return ((w.cast ?? []) as CastMember[]).some((c) => c.key === key)
      ? { kind: "participant", id: key }
      : null;
  }
  if (ref === w.ref) return { kind: "work", id: ref };
  return null;
}
export function aboutTargetKey(t: DraftAboutTarget): string {
  return `${t.kind}:${t.id}`;
}
export function incomingAbout(w: Working, target: DraftAboutTarget): Fragment[] {
  return (w.fragments ?? []).filter((f) =>
    f.about?.some((ref) => {
      const t = draftAboutTarget(w, ref);
      return !!t && aboutTargetKey(t) === aboutTargetKey(target);
    }),
  );
}
export function draftAboutOptions(w: Working): { ref: string; label: string }[] {
  return [
    ...(w.fragments ?? []).map((f) => ({ ref: `#${f.id}`, label: `Entry: ${f.id}` })),
    ...((w.cast ?? []) as CastMember[]).map((c) => ({
      ref: `cast:${c.key}`,
      label: `Participant: ${c.key}`,
    })),
    ...(typeof w.ref === "string" ? [{ ref: w.ref, label: "This work" }] : []),
    ...[...new Set((w.references ?? []).map((r) => r.use).filter((r) => r.startsWith("@")))].map(
      (ref) => ({ ref, label: `Referenced work: ${ref}` }),
    ),
  ];
}

/** Local navigation cannot resolve a cast's referenced content, but Undo can protect its binding. */
export function aboutRestoreError(w: Working, baseline: Working, ref: string): string | null {
  const old = draftAboutTarget(baseline, ref);
  if (old && !draftAboutTarget(w, ref))
    return "Restore the linked subject before undoing this link.";
  if (ref.startsWith("cast:") && ref.includes("#")) {
    const key = ref.slice(5, ref.indexOf("#"));
    const previous = ((baseline.cast ?? []) as CastMember[]).find((c) => c.key === key);
    const current = ((w.cast ?? []) as CastMember[]).find((c) => c.key === key);
    if (previous && (!current || JSON.stringify(previous.who) !== JSON.stringify(current.who)))
      return "The referenced participant was removed or rebound. Restore that binding before undoing this link.";
  }
  if (!old && JSON.stringify(w.references) !== JSON.stringify(baseline.references))
    return "Dependencies changed. Restore them or add the reference again and build to verify it.";
  return null;
}
