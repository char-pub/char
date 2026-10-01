import type { ContentGroup } from "@char-pub/core";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { draftAboutTarget } from "@/lib/about-editor";
import {
  groupRestoreError,
  groupStructureError,
  groupsOf,
  groupTree,
  restoreGroup,
  ungroupedEntries,
  withNestedGroup,
} from "@/lib/content-groups";
import { contentReferences } from "@/lib/content-references";
import { localeOf, nextId, type Working } from "@/lib/draft";
import { groupObjectAnchor } from "@/lib/editor-location";
import { storyText, withStoryText } from "@/lib/story-editor";
import {
  ANCHOR,
  castAnchor,
  type EditorNavigation,
  fragmentAnchor,
  scrollToAnchor,
} from "./anchors";
import { AboutDirectory, type AboutNavigate } from "./fragment-about";
import { Field } from "./policy-editor";

type Props = {
  navigation?: EditorNavigation | undefined;
  working: Working;
  update: (fn: (w: Working) => Working) => void;
  renderEntries?: (ids: readonly string[], onNavigate: AboutNavigate) => ReactNode;
};

/** Directory membership points at existing fragments; editing their text never creates copies. */
export function ContentGroups({ working, update, renderEntries, navigation }: Props) {
  const [selection, setSelection] = useState("all");
  const located = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (navigation?.request === located.current) return;
    if (!navigation?.contentSelection) return;
    if (selection !== navigation.contentSelection) setSelection(navigation.contentSelection);
    else {
      located.current = navigation.request;
      scrollToAnchor(navigation.anchor);
    }
  }, [navigation, selection]);
  const [aboutTarget, setAboutTarget] = useState("");
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [removed, setRemoved] = useState<{ group: ContentGroup; index: number } | null>(null);
  if (["preset", "prompt-module"].includes(String(working.type))) return null;
  const groups = groupsOf(working);
  const fragments = working.fragments ?? [];
  const locale = localeOf(working);
  const chosen = groups.find((group) => `group:${group.id}` === selection);
  const ids =
    selection === "ungrouped"
      ? ungroupedEntries(working)
      : chosen
        ? (chosen.entries ?? []).filter((id) => fragments.some((fragment) => fragment.id === id))
        : fragments.map((fragment) => fragment.id);
  const blockers = chosen ? contentReferences(working, "group", chosen.id) : [];
  const patch = (id: string, fn: (group: ContentGroup, w: Working) => ContentGroup) =>
    update((w) => ({
      ...w,
      groups: groupsOf(w).map((group) => (group.id === id ? fn(group, w) : group)),
    }));
  const choose = (next: string) => {
    setSelection(next);
    setError("");
  };
  const navigate: AboutNavigate = (ref) => {
    const target = draftAboutTarget(working, ref);
    if (!target) return;
    setAboutTarget(target.kind === "fragment" ? `#${target.id}` : ref);
    if (target.kind === "fragment") {
      setSelection("all");
      scrollToAnchor(fragmentAnchor(target.id));
    } else scrollToAnchor("edit-about-directory");
  };
  return (
    <section
      id="edit-content-groups"
      aria-label="Content groups"
      className="space-y-4 rounded-xl border bg-surface p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Reference library</h2>
        <Button type="button" variant="outline" onClick={() => setCreating(true)}>
          New group
        </Button>
      </div>
      <p className="text-sm text-text-2">
        Organize entries without copying them. Groups do not change when entries activate or who can
        see them.
      </p>
      <AboutDirectory
        working={working}
        target={aboutTarget}
        onTargetChange={setAboutTarget}
        onNavigate={navigate}
      />
      {aboutTarget && draftAboutTarget(working, aboutTarget)?.kind === "participant" ? (
        <Button
          type="button"
          variant="link"
          onClick={() => scrollToAnchor(castAnchor(aboutTarget.slice(5)))}
        >
          Edit participant {aboutTarget.slice(5)}
        </Button>
      ) : null}
      {aboutTarget === working.ref ? (
        <Button type="button" variant="link" onClick={() => scrollToAnchor(ANCHOR.name)}>
          Edit this work
        </Button>
      ) : null}
      {creating ? (
        <fieldset className="space-y-3 rounded border p-4">
          <legend>Create a group</legend>
          <Field label="New group title" value={title} onChange={setTitle} />
          <Field
            label="New group description"
            multiline
            value={description}
            onChange={setDescription}
          />
          <p className="text-xs">
            Describe what is in this group in 1–200 characters. Readers see the description before
            choosing entries.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={
                !title.trim() || !description.trim() || Array.from(description).length > 200
              }
              onClick={() => {
                const id = nextId(
                  groups.map((group) => group.id),
                  "group",
                );
                update((w) => {
                  // A synchronous intervening edit must not replace another group.
                  if (groupsOf(w).some((group) => group.id === id)) return w;
                  return { ...w, groups: [...groupsOf(w), { id, title, description }] };
                });
                setTitle("");
                setDescription("");
                setCreating(false);
                choose(`group:${id}`);
                setNotice(`Created group ${id}.`);
              }}
            >
              Create group
            </Button>
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
              Cancel group creation
            </Button>
          </div>
        </fieldset>
      ) : null}
      <div className="grid gap-5 md:grid-cols-[15rem_1fr]">
        <nav aria-label="Group navigation" className="space-y-1">
          <Button
            type="button"
            variant="ghost"
            aria-pressed={selection === "all"}
            onClick={() => choose("all")}
          >
            All entries ({fragments.length})
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-pressed={selection === "ungrouped"}
            onClick={() => choose("ungrouped")}
          >
            Ungrouped ({ungroupedEntries(working).length})
          </Button>
          <ul className="space-y-1">
            {groupTree(working).map((row, index) => {
              const group = groups.find((group) => group.id === row.id);
              return (
                <li
                  key={`${row.id}:${index}`}
                  style={{ paddingInlineStart: `${Math.min(row.depth, 3)}rem` }}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    aria-pressed={selection === `group:${row.id}`}
                    disabled={!group}
                    onClick={() => choose(`group:${row.id}`)}
                  >
                    {group ? storyText(group.title, locale) || group.id : row.id}
                    {row.repeated ? " (shared)" : ""}
                  </Button>
                  {row.issue ? (
                    <p role="alert" className="text-xs">
                      {row.issue}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {!groups.length ? (
            <p className="text-xs text-text-2">Small libraries can stay ungrouped.</p>
          ) : null}
        </nav>
        <div className="min-w-0 space-y-4">
          {chosen ? (
            <fieldset id={groupObjectAnchor(chosen.id)} className="space-y-3 rounded border p-4">
              <legend>Group {chosen.id}</legend>
              <p className="text-xs text-text-3">Stable ID: {chosen.id}</p>
              <Field
                label="Group title"
                value={storyText(chosen.title, locale)}
                onChange={(text) =>
                  patch(chosen.id, (group, w) => ({
                    ...group,
                    title: withStoryText(group.title, localeOf(w), text),
                  }))
                }
              />
              <Field
                label="Group description"
                multiline
                value={storyText(chosen.description, locale)}
                onChange={(text) =>
                  patch(chosen.id, (group, w) => ({
                    ...group,
                    description: withStoryText(group.description, localeOf(w), text),
                  }))
                }
              />
              {!storyText(chosen.description, locale).trim() ||
              Array.from(storyText(chosen.description, locale)).length > 200 ? (
                <p role="alert" className="text-xs">
                  Write a description of 1–200 characters for this language.
                </p>
              ) : null}
              <details open={!chosen.entries?.length}>
                <summary className="cursor-pointer font-medium">Entries in this group</summary>
                <p className="my-2 text-xs">
                  An entry may belong to several groups. Unchecking removes only this membership.
                </p>
                {[
                  ...new Set([
                    ...fragments.map((fragment) => fragment.id),
                    ...(chosen.entries ?? []),
                  ]),
                ].map((id) => (
                  <Label key={id} className="my-2 flex gap-2">
                    <input
                      type="checkbox"
                      aria-label={`Include entry ${id}`}
                      checked={chosen.entries?.includes(id) ?? false}
                      onChange={(event) => {
                        const included = event.target.checked;
                        patch(chosen.id, (group) => ({
                          ...group,
                          entries: included
                            ? [...new Set([...(group.entries ?? []), id])]
                            : (group.entries ?? []).filter((value) => value !== id),
                        }));
                      }}
                    />
                    {id}
                    {fragments.some((fragment) => fragment.id === id) ? "" : " (missing entry)"}
                  </Label>
                ))}
                {!fragments.length ? (
                  <p className="text-sm">Add an entry below, then include it here.</p>
                ) : null}
              </details>
              <details>
                <summary className="cursor-pointer font-medium">Nested groups</summary>
                <p className="my-2 text-xs">
                  References only, up to three levels. Shared child groups expand once in the
                  directory.
                </p>
                {[...new Set([...groups.map((group) => group.id), ...(chosen.groups ?? [])])].map(
                  (id) => {
                    const included = chosen.groups?.includes(id) ?? false;
                    const target = groups.find((group) => group.id === id);
                    const reason = included
                      ? null
                      : groupStructureError(working, withNestedGroup(working, chosen.id, id, true));
                    return (
                      <div key={id} className="my-2">
                        <Label className="flex gap-2">
                          <input
                            type="checkbox"
                            aria-label={`Nest group ${id}`}
                            checked={included}
                            disabled={!included && !!reason}
                            onChange={(event) => {
                              const include = event.target.checked;
                              const candidate = withNestedGroup(working, chosen.id, id, include);
                              const issue = include
                                ? groupStructureError(working, candidate)
                                : null;
                              if (issue) {
                                setError(issue);
                                return;
                              }
                              update((w) => {
                                const next = withNestedGroup(w, chosen.id, id, include);
                                return include && groupStructureError(w, next) ? w : next;
                              });
                              setError("");
                            }}
                          />
                          {target
                            ? storyText(target.title, locale) || target.id
                            : `${id} (missing group)`}
                        </Label>
                        {reason ? <p className="text-xs text-text-2">{reason}</p> : null}
                      </div>
                    );
                  },
                )}
              </details>
              <Button
                type="button"
                variant="ghost"
                disabled={blockers.length > 0}
                onClick={() => {
                  setRemoved({
                    group: chosen,
                    index: groups.findIndex((group) => group.id === chosen.id),
                  });
                  update((w) =>
                    contentReferences(w, "group", chosen.id).length
                      ? w
                      : { ...w, groups: groupsOf(w).filter((group) => group.id !== chosen.id) },
                  );
                  choose("ungrouped");
                  setNotice(`Removed group ${chosen.id}. Its entries were kept.`);
                }}
              >
                Remove group
              </Button>
              {blockers.length ? (
                <p className="text-xs">
                  Used by: {blockers.join(", ")}. Remove these references first.
                </p>
              ) : null}
            </fieldset>
          ) : (
            <h3 className="font-semibold">
              {selection === "ungrouped" ? "Ungrouped entries" : "All entries"}
            </h3>
          )}
          {chosen ? (
            <p className="text-sm">
              Editing entries directly in this group. Select a nested group to edit its entries.
            </p>
          ) : null}
          <p className="text-xs text-text-2">
            New entries start ungrouped. Add them to any group with “Entries in this group”.
          </p>
          {renderEntries ? (
            renderEntries(ids, navigate)
          ) : (
            <ul aria-label="Selected entries">
              {ids.map((id) => (
                <li key={id}>{id}</li>
              ))}
            </ul>
          )}
          {!ids.length ? <p className="text-sm text-text-2">No entries in this view.</p> : null}
        </div>
      </div>
      {notice ? <p role="status">{notice}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {removed ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            const issue = groupRestoreError(working, removed.group, removed.index);
            if (issue) {
              setError(issue);
              return;
            }
            update((w) =>
              groupRestoreError(w, removed.group, removed.index)
                ? w
                : restoreGroup(w, removed.group, removed.index),
            );
            choose(`group:${removed.group.id}`);
            setNotice(`Restored group ${removed.group.id}.`);
            setRemoved(null);
          }}
        >
          Undo group removal
        </Button>
      ) : null}
    </section>
  );
}
