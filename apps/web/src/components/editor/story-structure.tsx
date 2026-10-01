/** Story objects are authored once; scene and plotline controls only change their references. */
import type { Story, StoryCondition, StoryEffect } from "@char-pub/core";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { localeOf, nextId, type Working } from "@/lib/draft";
import { storyObjectAnchor } from "@/lib/editor-location";
import {
  storyOf,
  storyReferences,
  storyRestoreError,
  storyText,
  withStoryText,
} from "@/lib/story-editor";
import { Field, MoveButtons, reorder } from "./policy-editor";
import { StoryConditionEditor, StoryEffectsEditor } from "./story-rules";

type Text = string | Record<string, string>;
type Collection = "beats" | "endings" | "choices" | "events";
type Item = {
  id: string;
  title?: Text | undefined;
  label?: Text | undefined;
  description?: Text | undefined;
  intent?: Text | undefined;
  when?: StoryCondition | undefined;
  effects?: StoryEffect[] | undefined;
  kind?: "background" | "planned" | undefined;
  after?: "stop" | "continue" | undefined;
  strength?: "possible" | "suggested" | "required" | undefined;
  reveal?: "hidden" | "on-reach" | "listed" | undefined;
};
const kinds = { beats: "beat", endings: "ending", choices: "choice", events: "event" } as const;
const titles = {
  beats: "Possible changes",
  endings: "Endings",
  choices: "Suggested actions",
  events: "Events",
};
const singular = { beats: "change", endings: "ending", choices: "action", events: "event" };

export function StoryStructure({
  working,
  update,
  view,
}: {
  working: Working;
  update: (fn: (w: Working) => Working) => void;
  view?: "scenes" | "plotlines" | "timelines";
}) {
  const [undoError, setUndoError] = useState("");
  const story = storyOf(working);
  const locale = localeOf(working);
  const [removed, setRemoved] = useState<{
    collection: Collection;
    item: Item;
    index: number;
    baseline: Working;
  }>();
  if (!story) return null;
  const change = (fn: (s: Story) => Story) =>
    update((w) => {
      const current = storyOf(w);
      return current ? { ...w, story: fn(current) } : w;
    });
  const restore = (fn: (s: Story) => Story, baseline: Working): boolean => {
    const error = storyRestoreError(working, { ...working, story: fn(story) }, baseline);
    setUndoError(error ?? "");
    if (error) return false;
    update((w) => {
      const current = storyOf(w);
      if (!current) return w;
      const next = { ...w, story: fn(current) };
      return storyRestoreError(w, next, baseline) ? w : next;
    });
    return true;
  };
  const patch = (key: Collection, id: string, fn: (i: Item) => Item) =>
    change((s) => ({ ...s, [key]: (s[key] ?? []).map((i) => (i.id === id ? fn(i) : i)) }));
  const textField = (
    key: Collection,
    item: Item,
    field: "title" | "label" | "description" | "intent",
    label: string,
  ) => (
    <Field
      label={label}
      value={storyText(item[field], locale)}
      multiline={field === "description" || field === "intent"}
      onChange={(text) =>
        patch(key, item.id, (current) => ({
          ...current,
          [field]: withStoryText(current[field], locale, text),
        }))
      }
    />
  );
  return (
    <section aria-label="Story development" className="space-y-5">
      <p hidden={view !== undefined && view !== "scenes"} className="text-sm text-text-2">
        Add changes, suggested actions and endings when your story needs them. Players can always
        try something else.
      </p>
      {undoError ? (
        <p role="alert" className="text-sm text-danger">
          {undoError}
        </p>
      ) : null}
      {removed ? (
        <div role="status" className="flex items-center gap-3 rounded border p-3 text-sm">
          Removed {singular[removed.collection]}.
          <Button
            variant="outline"
            onClick={() => {
              const restored = restore((s) => {
                const list: Item[] = [...(s[removed.collection] ?? [])];
                if (list.some((i) => i.id === removed.item.id)) return s;
                list.splice(Math.min(removed.index, list.length), 0, removed.item);
                return { ...s, [removed.collection]: list };
              }, removed.baseline);
              if (restored) setRemoved(undefined);
            }}
          >
            Undo removal
          </Button>
        </div>
      ) : null}
      {(Object.keys(titles) as Collection[]).map((key) => (
        <details
          key={key}
          hidden={view !== undefined && view !== "scenes"}
          open={!!story[key]?.length}
          className="rounded-xl border bg-surface p-5"
        >
          <summary className="cursor-pointer text-lg font-semibold">{titles[key]}</summary>
          <div className="mt-4 space-y-4">
            {key === "choices" ? (
              <p className="text-sm text-text-2">
                These are suggestions. Choosing one does not confirm changes or run effects.
              </p>
            ) : null}
            {(story[key] ?? []).map((item: Item, index) => {
              const blockers = storyReferences(working, kinds[key], item.id);
              return (
                <fieldset
                  key={item.id}
                  id={storyObjectAnchor(key, item.id)}
                  className="space-y-3 rounded-lg border p-4"
                >
                  <legend className="px-1 text-sm">
                    {singular[key]} · {item.id}
                  </legend>
                  {textField(
                    key,
                    item,
                    key === "choices" ? "label" : "title",
                    key === "choices" ? "Action label" : `${singular[key]} title`,
                  )}
                  {textField(
                    key,
                    item,
                    key === "choices" ? "intent" : "description",
                    key === "choices" ? "What the player is trying to do" : "What happens",
                  )}
                  {key === "events" ? (
                    <Label>
                      Event type
                      <NativeSelect
                        value={item.kind}
                        onChange={(e) =>
                          patch(key, item.id, (current) => {
                            const kind = e.target.value as "background" | "planned";
                            if (
                              kind === "background" &&
                              (current.when ||
                                ("effects" in current &&
                                  Array.isArray(current.effects) &&
                                  current.effects.length))
                            )
                              return current;
                            return { ...current, kind };
                          })
                        }
                      >
                        <option
                          value="background"
                          disabled={
                            !!item.when ||
                            ("effects" in item &&
                              Array.isArray(item.effects) &&
                              item.effects.length > 0)
                          }
                        >
                          Already happened
                        </option>
                        <option value="planned">May happen during play</option>
                      </NativeSelect>
                    </Label>
                  ) : null}
                  {key !== "events" || item.kind === "planned" ? (
                    <details open={!!item.when}>
                      <summary className="cursor-pointer text-sm font-medium">
                        When can this happen?
                      </summary>
                      <StoryConditionEditor
                        working={working}
                        location={{ collection: key, id: item.id }}
                        value={item.when}
                        label={`Condition for ${singular[key]} ${item.id}`}
                        onChange={(when) =>
                          patch(key, item.id, (current) => {
                            if (when) return { ...current, when };
                            const { when: _old, ...rest } = current;
                            return rest;
                          })
                        }
                      />
                      <p className="text-xs text-text-2">
                        Only a true result makes this available. An undecided answer does not
                        trigger it.
                      </p>
                    </details>
                  ) : null}
                  {key === "endings" ? (
                    <Label>
                      After this ending
                      <NativeSelect
                        value={item.after ?? "stop"}
                        onChange={(e) =>
                          patch(key, item.id, (current) => ({
                            ...current,
                            after: e.target.value as "stop" | "continue",
                          }))
                        }
                      >
                        <option value="stop">Stop the story</option>
                        <option value="continue">Allow play to continue</option>
                      </NativeSelect>
                    </Label>
                  ) : null}
                  {key === "beats" || key === "endings" ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Label>
                        How strongly to pursue it
                        <NativeSelect
                          value={item.strength ?? "possible"}
                          onChange={(e) =>
                            patch(key, item.id, (current) => ({
                              ...current,
                              strength: e.target.value as Item["strength"],
                            }))
                          }
                        >
                          <option value="possible">Possible</option>
                          <option value="suggested">Suggested</option>
                          <option value="required">Required direction</option>
                        </NativeSelect>
                      </Label>
                      <Label>
                        Show the description
                        <NativeSelect
                          value={item.reveal ?? (key === "endings" ? "on-reach" : "hidden")}
                          onChange={(e) =>
                            patch(key, item.id, (current) => ({
                              ...current,
                              reveal: e.target.value as Item["reveal"],
                            }))
                          }
                        >
                          <option value="hidden">Keep hidden</option>
                          <option value="on-reach">Once reached</option>
                          <option value="listed">While available</option>
                        </NativeSelect>
                      </Label>
                    </div>
                  ) : null}
                  {key !== "endings" ? (
                    <fieldset>
                      <legend className="text-sm font-medium">Associated scenes</legend>
                      {key === "choices" ? (
                        <p className="text-xs text-text-2">
                          Choose at least one scene before saving this action.
                        </p>
                      ) : null}
                      {story.scenes.map((scene) => (
                        <Label key={scene.id} className="my-2 flex gap-2">
                          <input
                            type="checkbox"
                            checked={scene[key]?.includes(item.id) ?? false}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              change((s) => ({
                                ...s,
                                scenes: s.scenes.map((current) =>
                                  current.id === scene.id
                                    ? {
                                        ...current,
                                        [key]: checked
                                          ? [...new Set([...(current[key] ?? []), item.id])]
                                          : (current[key] ?? []).filter((id) => id !== item.id),
                                      }
                                    : current,
                                ),
                              }));
                            }}
                          />
                          {storyText(scene.title, locale) || scene.id}
                        </Label>
                      ))}
                    </fieldset>
                  ) : null}
                  {key === "beats" ||
                  key === "endings" ||
                  (key === "events" && item.kind === "planned") ? (
                    <details open={!!item.effects?.length}>
                      <summary className="cursor-pointer text-sm font-medium">
                        Effects after confirmation
                      </summary>
                      <StoryEffectsEditor
                        working={working}
                        value={item.effects}
                        label={`Effects for ${singular[key]} ${item.id}`}
                        onChange={(effects) =>
                          patch(key, item.id, (current) => ({ ...current, effects }))
                        }
                      />
                    </details>
                  ) : null}
                  <Button
                    variant="ghost"
                    disabled={blockers.length > 0}
                    onClick={() => {
                      update((w) => {
                        if (storyReferences(w, kinds[key], item.id).length) return w;
                        const s = storyOf(w);
                        if (!s) return w;
                        return {
                          ...w,
                          story: { ...s, [key]: (s[key] ?? []).filter((i) => i.id !== item.id) },
                        };
                      });
                      setRemoved({ collection: key, item, index, baseline: working });
                    }}
                  >
                    Remove {singular[key]}
                  </Button>
                  {blockers.length ? (
                    <p className="text-xs text-text-2">
                      Remove its references first: {blockers.join(", ")}
                    </p>
                  ) : null}
                </fieldset>
              );
            })}
            <Button
              variant="outline"
              onClick={() =>
                change((s) => {
                  const list = s[key] ?? [];
                  const id = nextId(
                    list.map((i) => i.id),
                    kinds[key],
                  );
                  const item =
                    key === "choices"
                      ? { id, label: "New action", intent: "" }
                      : {
                          id,
                          title: `New ${singular[key]}`,
                          description: "",
                          ...(key === "events" ? { kind: "background" } : {}),
                        };
                  return { ...s, [key]: [...list, item] };
                })
              }
            >
              Add {singular[key]}
            </Button>
          </div>
        </details>
      ))}
      <StoryTracks
        story={story}
        locale={locale}
        change={change}
        restore={restore}
        working={working}
        view={view}
      />
    </section>
  );
}

function StoryTracks({
  story,
  locale,
  change,
  restore,
  working,
  view,
}: {
  story: Story;
  locale: string;
  change: (fn: (s: Story) => Story) => void;
  restore: (fn: (s: Story) => Story, baseline: Working) => boolean;
  working: Working;
  view?: "scenes" | "plotlines" | "timelines" | undefined;
}) {
  const [notice, setNotice] = useState("");
  const [removed, setRemoved] = useState<
    | {
        kind: "plotline";
        value: NonNullable<Story["plotlines"]>[number];
        index: number;
        baseline: Working;
      }
    | {
        kind: "timeline";
        value: NonNullable<Story["timelines"]>[number];
        index: number;
        baseline: Working;
      }
  >();
  return (
    <>
      {removed ? (
        <div role="status" className="flex items-center gap-3 rounded border p-3 text-sm">
          Removed {removed.kind}.
          <Button
            variant="outline"
            onClick={() => {
              const restored = restore((s) => {
                if (removed.kind === "plotline") {
                  const list = [...(s.plotlines ?? [])];
                  if (list.some((l) => l.id === removed.value.id)) return s;
                  list.splice(Math.min(removed.index, list.length), 0, removed.value);
                  return { ...s, plotlines: list };
                }
                const list = [...(s.timelines ?? [])];
                if (list.some((l) => l.id === removed.value.id)) return s;
                list.splice(Math.min(removed.index, list.length), 0, removed.value);
                return { ...s, timelines: list };
              }, removed.baseline);
              if (restored) setRemoved(undefined);
              setNotice("");
            }}
          >
            Undo track removal
          </Button>
        </div>
      ) : null}
      <details
        hidden={view !== undefined && view !== "plotlines"}
        open={view === "plotlines" || !!story.plotlines?.length}
        className="rounded-xl border bg-surface p-5"
      >
        <summary className="cursor-pointer text-lg font-semibold">Plotlines</summary>
        <p className="my-3 text-sm text-text-2">
          Arrange existing scenes and changes in the order you expect to tell them. Players can
          still take a different path. Each object keeps one definition.
        </p>
        {(story.plotlines ?? []).map((line, lineIndex) => (
          <fieldset
            key={line.id}
            id={storyObjectAnchor("plotlines", line.id)}
            className="my-4 space-y-3 rounded border p-3"
          >
            <legend>{line.id}</legend>
            <Field
              label="Plotline title"
              value={storyText(line.title, locale)}
              onChange={(text) =>
                change((s) => ({
                  ...s,
                  plotlines: s.plotlines?.map((l) =>
                    l.id === line.id ? { ...l, title: withStoryText(l.title, locale, text) } : l,
                  ),
                }))
              }
            />
            {(["scenes", "beats"] as const).map((key) => (
              <fieldset key={key}>
                <legend className="text-sm font-medium">
                  {key === "scenes" ? "Scenes" : "Changes"}
                </legend>
                <ol
                  aria-label={`${storyText(line.title, locale) || line.id} ${key === "scenes" ? "scenes" : "changes"}`}
                  className="space-y-2"
                >
                  {[
                    ...(line[key] ?? []),
                    ...(story[key] ?? [])
                      .filter((item) => !line[key]?.includes(item.id))
                      .map((item) => item.id),
                  ].map((id) => {
                    const item = story[key]?.find((item) => item.id === id);
                    const title = storyText(item?.title, locale) || id;
                    const index = line[key]?.indexOf(id) ?? -1;
                    return (
                      <li key={id} className="flex flex-wrap items-center gap-2">
                        {index >= 0 ? <span aria-hidden="true">{index + 1}.</span> : null}
                        <Label className="my-2 flex flex-1 gap-2">
                          <input
                            type="checkbox"
                            checked={index >= 0}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              change((s) => ({
                                ...s,
                                plotlines: s.plotlines?.map((l) =>
                                  l.id === line.id
                                    ? {
                                        ...l,
                                        [key]: checked
                                          ? [...new Set([...(l[key] ?? []), id])]
                                          : l[key]?.filter((value) => value !== id),
                                      }
                                    : l,
                                ),
                              }));
                            }}
                          />
                          {title}
                        </Label>
                        {index >= 0 ? (
                          <MoveButtons
                            index={index}
                            length={line[key]?.length ?? 0}
                            label={`${title} in ${storyText(line.title, locale) || line.id}`}
                            onMove={(direction) => {
                              change((s) => ({
                                ...s,
                                plotlines: s.plotlines?.map((l) =>
                                  l.id === line.id
                                    ? {
                                        ...l,
                                        [key]: reorder(
                                          l[key] ?? [],
                                          l[key]?.indexOf(id) ?? -1,
                                          direction,
                                        ),
                                      }
                                    : l,
                                ),
                              }));
                              setNotice(`${title} moved to position ${index + direction + 1}.`);
                            }}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </fieldset>
            ))}
            <Button
              variant="ghost"
              onClick={() => {
                change((s) => ({ ...s, plotlines: s.plotlines?.filter((l) => l.id !== line.id) }));
                setRemoved({ kind: "plotline", value: line, index: lineIndex, baseline: working });
                setNotice("Plotline removed. Its scenes and changes are still available.");
              }}
            >
              Remove plotline
            </Button>
          </fieldset>
        ))}
        <Button
          variant="outline"
          onClick={() =>
            change((s) => ({
              ...s,
              plotlines: [
                ...(s.plotlines ?? []),
                {
                  id: nextId(
                    (s.plotlines ?? []).map((l) => l.id),
                    "plot",
                  ),
                  title: "New plotline",
                  scenes: s.scenes.slice(0, 1).map((scene) => scene.id),
                },
              ],
            }))
          }
        >
          Add plotline
        </Button>
      </details>
      <details
        hidden={view !== undefined && view !== "timelines"}
        open={view === "timelines" || !!story.timelines?.length}
        className="rounded-xl border bg-surface p-5"
      >
        <summary className="cursor-pointer text-lg font-semibold">Timelines</summary>
        <p className="my-3 text-sm text-text-2">
          Arrange scenes and events in relative order. Entries in one moment happen alongside each
          other.
        </p>
        {(story.timelines ?? []).map((line, lineIndex) => {
          const options = [
            ...story.scenes.map((s) => ({
              id: `scene/${s.id}`,
              title: storyText(s.title, locale) || s.id,
            })),
            ...(story.events ?? []).map((e) => ({
              id: e.id,
              title: storyText(e.title, locale) || e.id,
            })),
          ];
          const patch = (fn: (l: typeof line) => typeof line) =>
            change((s) => ({
              ...s,
              timelines: s.timelines?.map((l) => (l.id === line.id ? fn(l) : l)),
            }));
          const used = line.order.flat();
          return (
            <fieldset
              key={line.id}
              id={storyObjectAnchor("timelines", line.id)}
              className="my-4 space-y-3 rounded border p-3"
            >
              <legend>{line.id}</legend>
              <Field
                label="Timeline title"
                value={storyText(line.title, locale)}
                onChange={(text) =>
                  patch((l) => ({ ...l, title: withStoryText(l.title, locale, text) }))
                }
              />
              {line.order.map((step, index) => {
                const entries = Array.isArray(step) ? step : [step];
                return (
                  <fieldset key={index} className="space-y-2 rounded border p-3">
                    <legend>Moment {index + 1}</legend>
                    <p>
                      {entries
                        .map((id) => options.find((o) => o.id === id)?.title ?? id)
                        .join(" · ")}
                    </p>
                    <Label>
                      Add alongside
                      <NativeSelect
                        value=""
                        onChange={(e) => {
                          const id = e.target.value;
                          if (id)
                            patch((l) => ({
                              ...l,
                              order: l.order.map((v, i) =>
                                i === index ? [...(Array.isArray(v) ? v : [v]), id] : v,
                              ),
                            }));
                        }}
                      >
                        <option value="">Choose a scene or event</option>
                        {options
                          .filter((o) => !used.includes(o.id))
                          .map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.title}
                            </option>
                          ))}
                      </NativeSelect>
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        disabled={index === 0}
                        onClick={() => patch((l) => ({ ...l, order: reorder(l.order, index, -1) }))}
                      >
                        Move moment {index + 1} earlier
                      </Button>
                      <Button
                        variant="outline"
                        disabled={index === line.order.length - 1}
                        onClick={() => patch((l) => ({ ...l, order: reorder(l.order, index, 1) }))}
                      >
                        Move moment {index + 1} later
                      </Button>
                      {entries.map((id) => (
                        <Button
                          key={id}
                          variant="ghost"
                          onClick={() =>
                            patch((l) => ({
                              ...l,
                              order: l.order.flatMap((v, i) => {
                                if (i !== index) return [v];
                                const kept = (Array.isArray(v) ? v : [v]).filter((k) => k !== id);
                                return kept.length === 0
                                  ? []
                                  : [kept.length === 1 ? (kept[0] ?? kept) : kept];
                              }),
                            }))
                          }
                        >
                          Remove {options.find((o) => o.id === id)?.title ?? id} from timeline
                        </Button>
                      ))}
                    </div>
                  </fieldset>
                );
              })}
              <Label>
                Add next moment
                <NativeSelect
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id) patch((l) => ({ ...l, order: [...l.order, id] }));
                  }}
                >
                  <option value="">Choose a scene or event</option>
                  {options
                    .filter((o) => !used.includes(o.id))
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.title}
                      </option>
                    ))}
                </NativeSelect>
              </Label>
              <Button
                variant="ghost"
                onClick={() => {
                  change((s) => ({
                    ...s,
                    timelines: s.timelines?.filter((l) => l.id !== line.id),
                  }));
                  setRemoved({
                    kind: "timeline",
                    value: line,
                    index: lineIndex,
                    baseline: working,
                  });
                }}
              >
                Remove timeline
              </Button>
            </fieldset>
          );
        })}
        <Button
          variant="outline"
          onClick={() =>
            change((s) => ({
              ...s,
              timelines: [
                ...(s.timelines ?? []),
                {
                  id: nextId(
                    (s.timelines ?? []).map((l) => l.id),
                    "timeline",
                  ),
                  title: "New timeline",
                  order: [],
                },
              ],
            }))
          }
        >
          Add timeline
        </Button>
      </details>
      {notice ? (
        <p role="status" className="text-sm">
          {notice}
        </p>
      ) : null}
    </>
  );
}
