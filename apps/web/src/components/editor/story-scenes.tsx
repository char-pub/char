import type { CastMember, LocalizedText, Story, StoryScene } from "@char-pub/core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { localeOf, nextId, type Working } from "@/lib/draft";
import { storyFieldAnchor, storyObjectAnchor } from "@/lib/editor-location";
import {
  storyOf,
  storyReferences,
  storyRestoreError,
  storyText,
  withStoryText,
} from "@/lib/story-editor";
import { ContentLinks } from "./content-links";
import { Field } from "./policy-editor";
import { StoryConditionEditor, StoryEffectsEditor } from "./story-rules";

type Start = NonNullable<Story["starts"]>[number];
type Removed =
  | { kind: "scene"; item: StoryScene; index: number; baseline: Working }
  | { kind: "start"; item: Start; index: number; baseline: Working };
type Props = { working: Working; update: (fn: (w: Working) => Working) => void };

/** Edit optional prose without discarding other authored languages. */
function optionalText(previous: LocalizedText | undefined, locale: string, value: string) {
  if (value !== "") return withStoryText(previous, locale, value);
  if (previous && typeof previous === "object") {
    const next = { ...previous };
    delete next[locale];
    if (Object.keys(next).length) return next;
  }
  return undefined;
}
function castOf(working: Working): CastMember[] {
  return (working.cast as CastMember[] | undefined) ?? [];
}
function removeKey<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _, ...rest } = value;
  return rest;
}

export function StoryScenes({ working, update }: Props) {
  // Editor owns the work/account session key; undo only ever inserts the removed item.
  const [removed, setRemoved] = useState<Removed | null>(null);
  const [notice, setNotice] = useState("");
  const [removedGoal, setRemovedGoal] = useState<{
    scene: string;
    who: string;
    value: LocalizedText;
    baseline: Working;
  } | null>(null);
  const story = storyOf(working);
  const locale = localeOf(working);
  const cast = castOf(working);
  const goalScene = removedGoal
    ? story?.scenes.find((scene) => scene.id === removedGoal.scene)
    : undefined;
  const goalUndoBlocked = !removedGoal
    ? null
    : !goalScene
      ? "Restore the scene before restoring its goal."
      : goalScene.goals?.[removedGoal.who] !== undefined
        ? "A new scene goal is present. Undo cannot replace it."
        : !cast.some((member) => member.key === removedGoal.who) ||
            (goalScene.cast && !goalScene.cast.includes(removedGoal.who))
          ? "Restore this person's presence before restoring their scene goal."
          : null;
  const patchScene = (id: string, change: (scene: StoryScene, w: Working) => StoryScene) =>
    update((w) => {
      const current = storyOf(w);
      return current
        ? {
            ...w,
            story: {
              ...current,
              scenes: current.scenes.map((scene) => (scene.id === id ? change(scene, w) : scene)),
            },
          }
        : w;
    });
  const patchStart = (id: string, change: (start: Start, w: Working) => Start) =>
    update((w) => {
      const current = storyOf(w);
      return current
        ? {
            ...w,
            story: {
              ...current,
              starts: current.starts?.map((start) => (start.id === id ? change(start, w) : start)),
            },
          }
        : w;
    });
  const undoConflict =
    removed &&
    (removed.kind === "scene" ? story?.scenes : story?.starts)?.some(
      (item) => item.id === removed.item.id,
    );
  return (
    <section
      id="edit-story-scenes"
      className="space-y-5 rounded-xl border bg-surface p-5"
      aria-labelledby="story-heading"
    >
      <h2 id="story-heading" className="text-xl font-bold">
        Scenes and openings
      </h2>
      <p className="text-sm text-text-2">
        Set the scene, give each person a part, and choose how the story begins.
      </p>
      {!story ? (
        <Button
          type="button"
          onClick={() =>
            update((w) =>
              storyOf(w)
                ? w
                : { ...w, story: { version: 1, scenes: [{ id: "scene", title: "First scene" }] } },
            )
          }
        >
          Add first scene
        </Button>
      ) : (
        <>
          <h3 className="font-semibold">Scenes</h3>
          {story.scenes.map((scene, index) => {
            const references = storyReferences(working, "scene", scene.id);
            const blocked =
              story.scenes.length === 1
                ? "Keep at least one scene."
                : references.length
                  ? `Used by: ${references.join(", ")}. Remove these references first.`
                  : null;
            const present = scene.cast ?? cast.map((member) => member.key);
            return (
              <fieldset
                key={scene.id}
                id={storyObjectAnchor("scenes", scene.id)}
                className="space-y-4 rounded-lg border p-4"
              >
                <legend className="px-1 font-semibold">
                  {storyText(scene.title, locale) || scene.id}
                </legend>
                <p className="text-xs text-text-3">Scene ID: {scene.id}</p>
                <Field
                  label={`Scene ${scene.id} title`}
                  value={storyText(scene.title, locale)}
                  onChange={(value) =>
                    patchScene(scene.id, (s, w) => ({
                      ...s,
                      title: withStoryText(s.title, localeOf(w), value),
                    }))
                  }
                />
                {(["time", "where", "opening"] as const).map((field) => (
                  <Field
                    key={field}
                    id={storyFieldAnchor("scenes", scene.id, field)}
                    label={`${field === "time" ? "Time" : field === "where" ? "Place description" : "Opening situation"} for ${scene.id}`}
                    multiline={field === "opening"}
                    value={storyText(scene[field], locale)}
                    onChange={(value) =>
                      patchScene(scene.id, (s, w) => {
                        const next =
                          field === "opening" && typeof s.opening === "object"
                            ? withStoryText(s.opening, localeOf(w), value)
                            : optionalText(s[field], localeOf(w), value);
                        return next === undefined ? removeKey(s, field) : { ...s, [field]: next };
                      })
                    }
                  />
                ))}
                <details open={!!scene.lore?.length}>
                  <summary className="cursor-pointer text-sm font-medium">Related reading</summary>
                  <ContentLinks
                    working={working}
                    value={scene.lore ?? []}
                    label={`Related reading for ${scene.id}`}
                    onChange={(lore) => patchScene(scene.id, (current) => ({ ...current, lore }))}
                  />
                </details>
                <details open={!!scene.when}>
                  <summary className="cursor-pointer text-sm font-medium">Entry condition</summary>
                  <StoryConditionEditor
                    working={working}
                    location={{ collection: "scenes", id: scene.id }}
                    value={scene.when}
                    label={`Entry condition for ${scene.id}`}
                    onChange={(when) =>
                      patchScene(scene.id, (s) => (when ? { ...s, when } : removeKey(s, "when")))
                    }
                  />
                </details>
                <div className="space-y-2">
                  <h4 className="font-medium">People in this scene</h4>
                  <Label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={scene.cast === undefined}
                      onChange={(e) =>
                        patchScene(scene.id, (s, w) =>
                          e.target.checked
                            ? removeKey(s, "cast")
                            : { ...s, cast: castOf(w).map((member) => member.key) },
                        )
                      }
                    />
                    Include all cast, including people added later
                  </Label>
                  {!cast.length ? (
                    <p className="text-sm text-text-2">Add people in Cast and roles below.</p>
                  ) : null}
                  {cast.map((member) => (
                    <Label key={member.key} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={present.includes(member.key)}
                        disabled={
                          present.includes(member.key) && scene.goals?.[member.key] !== undefined
                        }
                        onChange={(e) =>
                          patchScene(scene.id, (s, w) => {
                            const current = s.cast ?? castOf(w).map((person) => person.key);
                            return {
                              ...s,
                              cast: e.target.checked
                                ? [...new Set([...current, member.key])]
                                : current.filter((key) => key !== member.key),
                            };
                          })
                        }
                      />
                      {member.key} present in {scene.id}
                      {scene.goals?.[member.key] !== undefined ? (
                        <span className="text-xs">
                          Clear their scene goal before removing them.
                        </span>
                      ) : null}
                    </Label>
                  ))}
                  {scene.cast?.length === 0 ? (
                    <p className="text-sm">No people are present by default in this scene.</p>
                  ) : null}
                </div>
                {cast
                  .filter((member) => present.includes(member.key))
                  .map((member) => (
                    <details key={member.key} className="rounded border p-3">
                      <summary className="cursor-pointer font-medium">
                        {member.key}: part and goals
                      </summary>
                      <p className="my-2 text-xs text-text-2">
                        Part and overall goal apply throughout this story. Scene goal applies only
                        here.
                      </p>
                      {(["part", "goal"] as const).map((field) => (
                        <Field
                          key={field}
                          label={`${member.key} ${field === "part" ? "part across the story" : "overall goal"} (${scene.id})`}
                          multiline
                          value={storyText(member[field], locale)}
                          onChange={(value) =>
                            update((w) => ({
                              ...w,
                              cast: castOf(w).map((person) => {
                                if (person.key !== member.key) return person;
                                const next = optionalText(person[field], localeOf(w), value);
                                return next === undefined
                                  ? removeKey(person, field)
                                  : { ...person, [field]: next };
                              }),
                            }))
                          }
                        />
                      ))}
                      <Field
                        label={`${member.key} goal in ${scene.id}`}
                        multiline
                        value={storyText(scene.goals?.[member.key], locale)}
                        onChange={(value) =>
                          patchScene(scene.id, (s, w) => {
                            const next = optionalText(s.goals?.[member.key], localeOf(w), value);
                            const goals = { ...s.goals };
                            if (next === undefined) delete goals[member.key];
                            else goals[member.key] = next;
                            return Object.keys(goals).length
                              ? { ...s, goals }
                              : removeKey(s, "goals");
                          })
                        }
                      />
                      {scene.goals?.[member.key] !== undefined ? (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            const value = scene.goals?.[member.key];
                            if (value === undefined) return;
                            setRemovedGoal({
                              scene: scene.id,
                              who: member.key,
                              value,
                              baseline: working,
                            });
                            setNotice(`Cleared ${member.key}'s scene goal in all languages.`);
                            patchScene(scene.id, (current) => {
                              const goals = { ...current.goals };
                              delete goals[member.key];
                              return Object.keys(goals).length
                                ? { ...current, goals }
                                : removeKey(current, "goals");
                            });
                          }}
                        >
                          Clear {member.key} scene goal in all languages
                        </Button>
                      ) : null}
                    </details>
                  ))}
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!!blocked}
                  onClick={() => {
                    setRemoved({ kind: "scene", item: scene, index, baseline: working });
                    setNotice(`Removed scene ${scene.id}.`);
                    update((w) => {
                      const current = storyOf(w);
                      if (
                        !current ||
                        current.scenes.length <= 1 ||
                        storyReferences(w, "scene", scene.id).length
                      )
                        return w;
                      return {
                        ...w,
                        story: {
                          ...current,
                          scenes: current.scenes.filter((s) => s.id !== scene.id),
                        },
                      };
                    });
                  }}
                >
                  Remove scene {scene.id}
                </Button>
                {blocked ? (
                  <p className="text-xs text-text-2">{blocked}</p>
                ) : !story.starts && index === 0 ? (
                  <p className="text-xs text-text-2">
                    Removing the first scene changes the default opening scene.
                  </p>
                ) : null}
              </fieldset>
            );
          })}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              update((w) => {
                const current = storyOf(w);
                return current
                  ? {
                      ...w,
                      story: {
                        ...current,
                        scenes: [
                          ...current.scenes,
                          {
                            id: nextId(
                              current.scenes.map((scene) => scene.id),
                              "scene",
                            ),
                            title: "New scene",
                          },
                        ],
                      },
                    }
                  : w;
              })
            }
          >
            Add scene
          </Button>
          <section className="space-y-4" aria-label="Story openings">
            <h3 className="font-semibold">Openings</h3>
            <p className="text-sm text-text-2">
              The first opening is the default. These are authored templates; build a draft preview
              to see the resolved first message with role bindings.
            </p>
            {!story.starts ? (
              <p className="text-sm">
                Default opening: the first scene and the first compiled bootstrap greeting, if one
                exists.
              </p>
            ) : null}
            {story.starts?.map((start, index) => {
              const refId =
                typeof start.greeting === "object" && "ref" in start.greeting
                  ? start.greeting.ref
                  : undefined;
              const isReference = refId !== undefined;
              const references = storyReferences(working, "start", start.id);
              const mode =
                start.greeting === undefined
                  ? "fallback"
                  : isReference
                    ? `bootstrap:${refId}`
                    : "inline";
              const greetings = working.bootstrap?.greetings ?? [];
              const reference = isReference ? greetings.find((g) => g.id === refId) : undefined;
              const variant = reference?.locale?.[locale]?.content;
              const authoredGreeting = variant?.type === "text" ? variant.text : reference?.text;
              return (
                <fieldset
                  key={start.id}
                  id={storyObjectAnchor("starts", start.id)}
                  className="space-y-3 rounded-lg border p-4"
                >
                  <legend className="px-1 font-medium">
                    {storyText(start.title, locale) || start.id}
                    {index === 0 ? " (default)" : ""}
                  </legend>
                  <p className="text-xs text-text-3">Opening ID: {start.id}</p>
                  <Field
                    label={`Opening ${start.id} title`}
                    value={storyText(start.title, locale)}
                    onChange={(value) =>
                      patchStart(start.id, (s, w) => {
                        const next = optionalText(s.title, localeOf(w), value);
                        return next === undefined ? removeKey(s, "title") : { ...s, title: next };
                      })
                    }
                  />
                  <Field
                    label={`Opening ${start.id} description`}
                    multiline
                    value={storyText(start.description, locale)}
                    onChange={(value) =>
                      patchStart(start.id, (s, w) => {
                        const next = optionalText(s.description, localeOf(w), value);
                        return next === undefined
                          ? removeKey(s, "description")
                          : { ...s, description: next };
                      })
                    }
                  />
                  <p className="text-xs text-text-2">
                    Describe this opening so players can choose. Required when there is more than
                    one opening.
                  </p>
                  <Label className="block space-y-1">
                    Scene for {start.id}
                    <NativeSelect
                      aria-label={`Scene for ${start.id}`}
                      value={start.scene ?? ""}
                      onChange={(e) =>
                        patchStart(start.id, (s) =>
                          e.target.value ? { ...s, scene: e.target.value } : removeKey(s, "scene"),
                        )
                      }
                    >
                      <option value="">First scene (default)</option>
                      {story.scenes.map((scene) => (
                        <option key={scene.id} value={scene.id}>
                          {storyText(scene.title, locale) || scene.id}
                        </option>
                      ))}
                      {start.scene && !story.scenes.some((s) => s.id === start.scene) ? (
                        <option value={start.scene}>Missing scene: {start.scene}</option>
                      ) : null}
                    </NativeSelect>
                  </Label>
                  <Label className="block space-y-1">
                    First message source for {start.id}
                    <NativeSelect
                      id={
                        mode === "inline"
                          ? undefined
                          : storyFieldAnchor("starts", start.id, "greeting")
                      }
                      aria-label={`First message source for ${start.id}`}
                      value={mode}
                      onChange={(e) =>
                        patchStart(start.id, (s) => {
                          const value = e.target.value;
                          if (value === "fallback") return removeKey(s, "greeting");
                          return {
                            ...s,
                            greeting:
                              value === "inline" ? "" : { ref: value.slice("bootstrap:".length) },
                          };
                        })
                      }
                    >
                      <option value="fallback">Use first bootstrap greeting, if available</option>
                      <option value="inline">Write an opening template</option>
                      {greetings.map((g) => (
                        <option key={g.id} value={`bootstrap:${g.id}`}>
                          Bootstrap greeting: {g.id}
                        </option>
                      ))}
                      {isReference && !reference ? (
                        <option value={mode}>Missing bootstrap greeting: {refId}</option>
                      ) : null}
                    </NativeSelect>
                  </Label>
                  {typeof start.greeting === "object" && !isReference ? (
                    <p className="text-xs text-text-2">
                      Changing the message source replaces this template in all languages.
                    </p>
                  ) : null}
                  {mode === "inline" ? (
                    <Field
                      id={storyFieldAnchor("starts", start.id, "greeting")}
                      label={`Authored opening template for ${start.id}`}
                      multiline
                      value={storyText(start.greeting as LocalizedText, locale)}
                      onChange={(value) =>
                        patchStart(start.id, (s, w) => ({
                          ...s,
                          greeting: withStoryText(
                            typeof s.greeting === "object" && "ref" in s.greeting
                              ? undefined
                              : s.greeting,
                            localeOf(w),
                            value,
                          ),
                        }))
                      }
                    />
                  ) : isReference ? (
                    <div className="text-sm">
                      <p>Authored bootstrap template: {refId}</p>
                      {reference ? (
                        <pre className="whitespace-pre-wrap">{authoredGreeting}</pre>
                      ) : (
                        <p role="alert">
                          This bootstrap greeting is missing. Choose another source before building.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm">
                      The first compiled bootstrap greeting is used. If none exists, this opening
                      has no first message.
                    </p>
                  )}
                  <details open={!!start.set?.length || !!start.reached?.length}>
                    <summary className="cursor-pointer text-sm font-medium">Opening state</summary>
                    <StoryEffectsEditor
                      working={working}
                      value={start.set}
                      phase="opening"
                      label={`Initial effects for ${start.id}`}
                      onChange={(set) => patchStart(start.id, (current) => ({ ...current, set }))}
                    />
                    <fieldset className="mt-3 space-y-2">
                      <legend className="text-sm font-medium">Already reached changes</legend>
                      <p className="text-xs text-text-2">
                        Marks these as reached without running their effects.
                      </p>
                      {(story.beats ?? []).map((beat) => (
                        <Label key={beat.id} className="flex gap-2">
                          <input
                            type="checkbox"
                            checked={start.reached?.includes(beat.id) ?? false}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              patchStart(start.id, (current) => ({
                                ...current,
                                reached: checked
                                  ? [...new Set([...(current.reached ?? []), beat.id])]
                                  : (current.reached ?? []).filter((id) => id !== beat.id),
                              }));
                            }}
                          />
                          {storyText(beat.title, locale) || beat.id}
                        </Label>
                      ))}
                    </fieldset>
                  </details>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={references.length > 0}
                    onClick={() => {
                      setRemoved({ kind: "start", item: start, index, baseline: working });
                      setNotice(`Removed opening ${start.id}.`);
                      update((w) => {
                        const current = storyOf(w);
                        if (!current || storyReferences(w, "start", start.id).length) return w;
                        const starts = current.starts?.filter((s) => s.id !== start.id) ?? [];
                        return {
                          ...w,
                          story: starts.length
                            ? { ...current, starts }
                            : removeKey(current, "starts"),
                        };
                      });
                    }}
                  >
                    Remove opening {start.id}
                  </Button>
                  {references.length ? (
                    <p className="text-xs text-text-2">
                      Used by: {references.join(", ")}. Remove these references first.
                    </p>
                  ) : null}
                  {index === 0 ? (
                    <p className="text-xs text-text-2">
                      Removing this opening changes the default. Removing the last opening restores
                      the implicit default.
                    </p>
                  ) : null}
                </fieldset>
              );
            })}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                update((w) => {
                  const current = storyOf(w);
                  if (!current) return w;
                  const starts = current.starts ?? [];
                  return {
                    ...w,
                    story: {
                      ...current,
                      starts: [
                        ...starts,
                        {
                          id: nextId(
                            starts.map((s) => s.id),
                            "start",
                          ),
                          title: "New opening",
                        },
                      ],
                    },
                  };
                })
              }
            >
              Add opening
            </Button>
            <a href="#edit-draft-preview" className="block text-sm underline">
              Build a draft preview for resolved opening messages
            </a>
          </section>
        </>
      )}
      {notice ? <p role="status">{notice}</p> : null}
      {removedGoal ? (
        <div className="space-y-1">
          <Button
            type="button"
            variant="outline"
            disabled={!!goalUndoBlocked}
            onClick={() => {
              const restore = removedGoal;
              const candidate = (w: Working): Working => {
                const current = storyOf(w);
                if (!current) return w;
                return {
                  ...w,
                  story: {
                    ...current,
                    scenes: current.scenes.map((scene) => {
                      if (
                        scene.id !== restore.scene ||
                        scene.goals?.[restore.who] !== undefined ||
                        !castOf(w).some((member) => member.key === restore.who) ||
                        (scene.cast && !scene.cast.includes(restore.who))
                      )
                        return scene;
                      return { ...scene, goals: { ...scene.goals, [restore.who]: restore.value } };
                    }),
                  },
                };
              };
              const error = storyRestoreError(working, candidate(working), restore.baseline);
              if (error) {
                setNotice(error);
                return;
              }
              update((w) => {
                const next = candidate(w);
                return storyRestoreError(w, next, restore.baseline) ? w : next;
              });
              setRemovedGoal(null);
              setNotice(`Restored ${restore.who}'s scene goal.`);
            }}
          >
            Undo scene goal removal
          </Button>
          {goalUndoBlocked ? <p role="alert">{goalUndoBlocked}</p> : null}
        </div>
      ) : null}
      {removed && story ? (
        <div className="space-y-1">
          <Button
            type="button"
            variant="outline"
            disabled={!!undoConflict}
            onClick={() => {
              const restore = removed;
              const candidate = (w: Working): Working => {
                const current = storyOf(w);
                if (!current) return w;
                if (restore.kind === "scene") {
                  if (current.scenes.some((s) => s.id === restore.item.id)) return w;
                  const scenes = [...current.scenes];
                  scenes.splice(Math.min(restore.index, scenes.length), 0, restore.item);
                  return { ...w, story: { ...current, scenes } };
                }
                if (current.starts?.some((s) => s.id === restore.item.id)) return w;
                const starts = [...(current.starts ?? [])];
                starts.splice(Math.min(restore.index, starts.length), 0, restore.item);
                return { ...w, story: { ...current, starts } };
              };
              const error = storyRestoreError(working, candidate(working), restore.baseline);
              if (error) {
                setNotice(error);
                return;
              }
              update((w) => {
                const next = candidate(w);
                return storyRestoreError(w, next, restore.baseline) ? w : next;
              });
              setRemoved(null);
              setNotice(`Restored ${restore.kind} ${restore.item.id}.`);
            }}
          >
            Undo removal
          </Button>
          {undoConflict ? (
            <p role="alert">A new item already uses this ID. Undo cannot replace it.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
