/** Optional Story state controls preserve authored fields and leave runtime changes to Core. */
import {
  type CastMember,
  checkStory,
  type Story,
  StoryInfoRefSchema,
  type StoryVariable,
} from "@char-pub/core";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  knowledgeRemovalReferences,
  stateInformationRestoreError,
  variableOfType,
} from "@/lib/story-state-editor";
import { Field } from "./policy-editor";

type Props = { working: Working; update: (fn: (w: Working) => Working) => void };
type Item = NonNullable<Story["items"]>[number];
type Knowledge = NonNullable<Story["knowing"]>[string];
type Audience = string[] | "*" | undefined;
type Removed = (
  | { kind: "variable"; id: string; value: StoryVariable }
  | { kind: "item"; id: string; value: Item; index: number }
  | { kind: "knowledge"; id: string; value: Knowledge }
  | { kind: "learning"; id: string; scene: string; value: { knows: string[] | "*" } }
) & { baseline: Working };

function without<T>(record: Record<string, T> | undefined, key: string) {
  const { [key]: _removed, ...rest } = record ?? {};
  return rest;
}
function IntegerField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [error, setError] = useState("");
  useEffect(() => {
    setText(String(value));
  }, [value]);
  const parse = (raw: string) => {
    const number = Number(raw);
    return raw.trim() !== "" &&
      Number.isInteger(number) &&
      number >= -2147483648 &&
      number <= 2147483647
      ? number
      : undefined;
  };
  return (
    <div>
      <Label className="block">
        {label}
        <Input
          type="number"
          value={text}
          aria-invalid={!!error}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            const number = parse(next);
            if (number !== undefined) {
              onChange(number);
              setError("");
            }
          }}
          onBlur={() =>
            setError(
              parse(text) === undefined
                ? "Not saved: enter a whole number from -2147483648 to 2147483647."
                : "",
            )
          }
        />
      </Label>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

function AudienceField({
  label,
  value,
  people,
  optional,
  onChange,
}: {
  label: string;
  value: Audience;
  people: string[];
  optional?: boolean;
  onChange: (value: Audience) => void;
}) {
  const selected = Array.isArray(value) ? value : [];
  return (
    <fieldset className="space-y-2 rounded border p-3">
      <legend>{label}</legend>
      <Label className="block">
        {label} audience
        <NativeSelect
          value={value === undefined ? "unset" : value === "*" ? "all" : "selected"}
          onChange={(e) => {
            onChange(
              e.target.value === "unset"
                ? undefined
                : e.target.value === "all"
                  ? "*"
                  : value === "*"
                    ? [...people]
                    : selected,
            );
          }}
        >
          {optional ? <option value="unset">Not declared</option> : null}
          <option value="selected">Selected people</option>
          <option value="all">Everyone, including people added later (*)</option>
        </NativeSelect>
      </Label>
      {value === "*" ? (
        <p className="text-xs text-text-2">
          This includes everyone in the cast, including future additions.
        </p>
      ) : value !== undefined ? (
        [...new Set([...people, ...selected])].map((person) => (
          <Label key={person} className="flex gap-2">
            <input
              type="checkbox"
              aria-label={`${label}: ${person}`}
              checked={selected.includes(person)}
              onChange={(e) =>
                onChange(
                  e.target.checked ? [...selected, person] : selected.filter((p) => p !== person),
                )
              }
            />
            {person}
            {people.includes(person) ? "" : " (missing cast member)"}
          </Label>
        ))
      ) : null}
    </fieldset>
  );
}

export function StoryStateEditor({ working, update }: Props) {
  const story = storyOf(working);
  const locale = localeOf(working);
  const people = ((working.cast as CastMember[] | undefined) ?? []).map((member) => member.key);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [removed, setRemoved] = useState<Removed>();
  const [newInfo, setNewInfo] = useState("");
  if (!story) return null;
  const change = (fn: (s: Story) => Story) =>
    update((w) => {
      const current = storyOf(w);
      return current ? { ...w, story: fn(current) } : w;
    });
  const patchVariable = (id: string, fn: (v: StoryVariable) => StoryVariable) =>
    change((s) => {
      const current = s.vars?.[id];
      return current ? { ...s, vars: { ...s.vars, [id]: fn(current) } } : s;
    });
  const patchItem = (id: string, fn: (value: Item) => Item) =>
    change((s) => ({ ...s, items: s.items?.map((item) => (item.id === id ? fn(item) : item)) }));
  const patchKnowledge = (ref: string, fn: (value: Knowledge) => Knowledge) =>
    change((s) => {
      const current = s.knowing?.[ref];
      return current ? { ...s, knowing: { ...s.knowing, [ref]: fn(current) } } : s;
    });
  const diagnostics = checkStory(story, people).filter(
    (d) =>
      d.severity === "error" &&
      (d.subject.startsWith("story.vars") || d.subject.startsWith("story.knowing")),
  );
  const remove = (entry: Removed, fn: (s: Story) => Story) => {
    const candidate = { ...working, story: fn(story) };
    const blocked = storyRestoreError(working, candidate);
    if (blocked) {
      setError(blocked.replace("Cannot restore yet:", "Cannot remove yet:"));
      return;
    }
    update((w) => {
      const current = storyOf(w);
      if (!current) return w;
      const next = { ...w, story: fn(current) };
      return storyRestoreError(w, next) ? w : next;
    });
    setRemoved(entry);
    setError("");
    setNotice(`Removed ${entry.kind} ${entry.id}.`);
  };
  const undo = () => {
    if (!removed) return;
    const restore = (w: Working): Working => {
      const s = storyOf(w);
      if (!s) return w;
      if (removed.kind === "variable")
        return { ...w, story: { ...s, vars: { ...s.vars, [removed.id]: removed.value } } };
      if (removed.kind === "knowledge")
        return { ...w, story: { ...s, knowing: { ...s.knowing, [removed.id]: removed.value } } };
      if (removed.kind === "learning") {
        const entry = s.knowing?.[removed.id];
        return entry
          ? {
              ...w,
              story: {
                ...s,
                knowing: {
                  ...s.knowing,
                  [removed.id]: {
                    ...entry,
                    enter: { ...entry.enter, [removed.scene]: removed.value },
                  },
                },
              },
            }
          : w;
      }
      const items = [...(s.items ?? [])];
      items.splice(Math.min(removed.index, items.length), 0, removed.value);
      return { ...w, story: { ...s, items } };
    };
    const conflict =
      removed.kind === "variable"
        ? Object.hasOwn(story.vars ?? {}, removed.id)
        : removed.kind === "knowledge"
          ? Object.hasOwn(story.knowing ?? {}, removed.id)
          : removed.kind === "learning"
            ? !story.knowing?.[removed.id] ||
              Object.hasOwn(story.knowing[removed.id]?.enter ?? {}, removed.scene)
            : story.items?.some((item) => item.id === removed.id);
    const blocked = conflict
      ? "Undo cannot replace a new object or restore learning before its information entry."
      : (stateInformationRestoreError(working, restore(working), removed.baseline) ??
        storyRestoreError(working, restore(working), removed.baseline));
    if (blocked) {
      setError(blocked);
      return;
    }
    update((w) => {
      const next = restore(w);
      return stateInformationRestoreError(w, next, removed.baseline) ||
        storyRestoreError(w, next, removed.baseline)
        ? w
        : next;
    });
    setNotice(`Restored ${removed.kind} ${removed.id}.`);
    setError("");
    setRemoved(undefined);
  };
  return (
    <section aria-label="Story state" className="space-y-4">
      <p className="text-sm text-text-2">
        Add state only when your story needs it. These are starting values; play changes are handled
        by the runtime.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {removed ? (
        <Button variant="outline" onClick={undo}>
          Undo state removal
        </Button>
      ) : null}
      <details
        open={Object.keys(story.vars ?? {}).length > 0}
        className="space-y-3 rounded border p-4"
      >
        <summary className="cursor-pointer font-semibold">Variables</summary>
        <p className="text-sm text-text-2">
          Stable IDs keep conditions and effects connected. Changing an unreferenced type resets its
          starting value and allowed values.
        </p>
        {Object.entries(story.vars ?? {}).map(([id, variable]) => {
          const blockers = storyReferences(working, "var", id);
          const allowed =
            variable.type === "enum" || variable.type === "set"
              ? variable.type === "set" && variable.of === "item"
                ? (story.items ?? []).map((item) => item.id)
                : (variable.values ?? [])
              : [];
          return (
            <fieldset
              key={id}
              id={storyObjectAnchor("vars", id)}
              className="space-y-3 rounded border p-3"
            >
              <legend>Variable {id}</legend>
              <p className="text-xs">Stable ID: var/{id}</p>
              <Field
                label={`Description for ${id}`}
                multiline
                value={storyText(variable.description, locale)}
                onChange={(text) =>
                  patchVariable(id, (current) => ({
                    ...current,
                    description: withStoryText(current.description, locale, text),
                  }))
                }
              />
              <Label className="block">
                Type for {id}
                <NativeSelect
                  value={variable.type}
                  disabled={blockers.length > 0}
                  onChange={(e) => {
                    const type = e.target.value as StoryVariable["type"];
                    update((w) => {
                      const current = storyOf(w);
                      const value = current?.vars?.[id];
                      return current && value && !storyReferences(w, "var", id).length
                        ? {
                            ...w,
                            story: {
                              ...current,
                              vars: { ...current.vars, [id]: variableOfType(type, value) },
                            },
                          }
                        : w;
                    });
                  }}
                >
                  <option value="bool">Yes / no</option>
                  <option value="int">Whole number</option>
                  <option value="enum">One named value</option>
                  <option value="set">Set of values</option>
                </NativeSelect>
              </Label>
              {blockers.length ? (
                <p className="text-xs">
                  Remove references before changing type or deleting: {blockers.join(", ")}
                </p>
              ) : null}
              {variable.type === "bool" ? (
                <Label className="flex gap-2">
                  <input
                    type="checkbox"
                    checked={variable.init}
                    onChange={(e) => {
                      const init = e.target.checked;
                      patchVariable(id, (current) =>
                        current.type === "bool" ? { ...current, init } : current,
                      );
                    }}
                  />
                  Initial value for {id}
                </Label>
              ) : null}
              {variable.type === "int" ? (
                <div className="grid gap-3 sm:grid-cols-3">
                  {(["min", "max", "init"] as const).map((field) => (
                    <IntegerField
                      key={field}
                      label={`${field === "init" ? "Initial value" : field === "min" ? "Minimum" : "Maximum"} for ${id}`}
                      value={variable[field]}
                      onChange={(number) =>
                        patchVariable(id, (current) =>
                          current.type === "int" ? { ...current, [field]: number } : current,
                        )
                      }
                    />
                  ))}
                </div>
              ) : null}
              {variable.type === "set" ? (
                <Label className="block">
                  Set members for {id}
                  <NativeSelect
                    aria-label={`Set members for ${id}`}
                    value={variable.of === "item" ? "items" : "values"}
                    disabled={blockers.length > 0}
                    onChange={(e) => {
                      const items = e.target.value === "items";
                      patchVariable(id, (current) => {
                        if (current.type !== "set") return current;
                        const { of: _of, values: _values, ...rest } = current;
                        return items
                          ? { ...rest, of: "item", init: [] }
                          : { ...rest, values: [], init: [] };
                      });
                    }}
                  >
                    <option value="items">Story items</option>
                    <option value="values">Named values</option>
                  </NativeSelect>
                  <span className="block text-xs text-text-2">
                    Changing the member source clears the initial members and replaces the allowed
                    values.
                  </span>
                </Label>
              ) : null}
              {(variable.type === "enum" || variable.type === "set") &&
              !(variable.type === "set" && variable.of === "item") ? (
                <div className="space-y-2">
                  <p className="text-xs">
                    Allowed value IDs use lowercase letters, digits, hyphens or underscores.
                    Changing a value does not rewrite conditions or starting values.
                  </p>
                  {(variable.values ?? []).map((value, index) => (
                    <div key={index} className="flex items-end gap-2">
                      <Field
                        label={`Allowed value ${index + 1} for ${id}`}
                        value={value}
                        onChange={(text) =>
                          patchVariable(id, (current) =>
                            current.type === "enum" || current.type === "set"
                              ? {
                                  ...current,
                                  values:
                                    current.values?.map((v, i) => (i === index ? text : v)) ?? [],
                                }
                              : current,
                          )
                        }
                      />
                      <Button
                        variant="ghost"
                        onClick={() =>
                          patchVariable(id, (current) =>
                            current.type === "enum" || current.type === "set"
                              ? {
                                  ...current,
                                  values: current.values?.filter((_, i) => i !== index) ?? [],
                                }
                              : current,
                          )
                        }
                      >
                        Remove value {index + 1} from {id}
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    onClick={() =>
                      patchVariable(id, (current) =>
                        current.type === "enum" || current.type === "set"
                          ? {
                              ...current,
                              values: [
                                ...(current.values ?? []),
                                nextId(current.values ?? [], "value"),
                              ],
                            }
                          : current,
                      )
                    }
                  >
                    Add allowed value to {id}
                  </Button>
                </div>
              ) : null}
              {variable.type === "enum" ? (
                <Label className="block">
                  Initial value for {id}
                  <NativeSelect
                    value={variable.init}
                    onChange={(e) => {
                      const init = e.target.value;
                      patchVariable(id, (current) =>
                        current.type === "enum" ? { ...current, init } : current,
                      );
                    }}
                  >
                    {!allowed.includes(variable.init) ? (
                      <option value={variable.init}>Missing value: {variable.init}</option>
                    ) : null}
                    {allowed.map((value, i) => (
                      <option key={`${value}-${i}`} value={value}>
                        {value}
                      </option>
                    ))}
                  </NativeSelect>
                </Label>
              ) : null}
              {variable.type === "set" ? (
                <fieldset>
                  <legend>Initial members for {id}</legend>
                  {[...new Set([...allowed, ...variable.init])].map((value) => (
                    <Label key={value} className="flex gap-2">
                      <input
                        type="checkbox"
                        aria-label={`${id} initially includes ${value}`}
                        checked={variable.init.includes(value)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          patchVariable(id, (current) =>
                            current.type === "set"
                              ? {
                                  ...current,
                                  init: checked
                                    ? [...current.init, value]
                                    : current.init.filter((v) => v !== value),
                                }
                              : current,
                          );
                        }}
                      />
                      {value}
                      {allowed.includes(value) ? "" : " (not an allowed value)"}
                    </Label>
                  ))}
                </fieldset>
              ) : null}
              {diagnostics
                .filter((d) => d.subject === `story.vars.${id}`)
                .map((d, i) => (
                  <p role="alert" key={i}>
                    {d.detail}
                  </p>
                ))}
              <Button
                variant="ghost"
                disabled={blockers.length > 0}
                onClick={() => {
                  if (storyReferences(working, "var", id).length) return;
                  remove({ kind: "variable", id, value: variable, baseline: working }, (s) => ({
                    ...s,
                    vars: without(s.vars, id),
                  }));
                }}
              >
                Remove variable {id}
              </Button>
            </fieldset>
          );
        })}
        <Button
          variant="outline"
          onClick={() =>
            change((s) => {
              const id = nextId(Object.keys(s.vars ?? {}), "variable");
              return { ...s, vars: { ...s.vars, [id]: variableOfType("bool") } };
            })
          }
        >
          Add variable
        </Button>
      </details>
      <details open={!!story.items?.length} className="space-y-3 rounded border p-4">
        <summary className="cursor-pointer font-semibold">Items</summary>
        <p className="text-sm text-text-2">
          Describe an object or clue here. Inventory ownership belongs in a set variable using Story
          items.
        </p>
        {(story.items ?? []).map((item, index) => {
          const blockers = storyReferences(working, "item", item.id);
          return (
            <fieldset
              key={item.id}
              id={storyObjectAnchor("items", item.id)}
              className="space-y-3 rounded border p-3"
            >
              <legend>Item {item.id}</legend>
              <p className="text-xs">Stable ID: item/{item.id}</p>
              <Field
                label={`Title for item ${item.id}`}
                value={storyText(item.title, locale)}
                onChange={(text) =>
                  patchItem(item.id, (current) => ({
                    ...current,
                    title: withStoryText(current.title, locale, text),
                  }))
                }
              />
              <Field
                label={`Description for item ${item.id}`}
                multiline
                value={storyText(item.description, locale)}
                onChange={(text) =>
                  patchItem(item.id, (current) => ({
                    ...current,
                    description: withStoryText(current.description, locale, text),
                  }))
                }
              />
              <Label className="block">
                Reveal item {item.id}
                <NativeSelect
                  value={item.reveal ?? "hidden"}
                  onChange={(e) => {
                    const reveal = e.target.value as "hidden" | "on-reach";
                    patchItem(item.id, (current) => ({ ...current, reveal }));
                  }}
                >
                  <option value="hidden">Keep hidden</option>
                  <option value="on-reach">When acquired</option>
                </NativeSelect>
              </Label>
              <fieldset className="space-y-2">
                <legend>Related material for {item.id}</legend>
                <p className="text-xs">
                  Use a fragment, group or Source reference. The build verifies dependency
                  references.
                </p>
                {(item.lore ?? []).map((ref, i) => (
                  <div key={i} className="flex items-end gap-2">
                    <Field
                      label={`Material ${i + 1} for ${item.id}`}
                      value={ref}
                      onChange={(text) =>
                        patchItem(item.id, (current) => ({
                          ...current,
                          lore: current.lore?.map((value, n) => (n === i ? text : value)),
                        }))
                      }
                    />
                    <Button
                      variant="ghost"
                      onClick={() =>
                        patchItem(item.id, (current) => ({
                          ...current,
                          lore: current.lore?.filter((_, n) => n !== i),
                        }))
                      }
                    >
                      Remove material {i + 1} from {item.id}
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  onClick={() =>
                    patchItem(item.id, (current) => ({
                      ...current,
                      lore: [...(current.lore ?? []), ""],
                    }))
                  }
                >
                  Add related material to {item.id}
                </Button>
              </fieldset>
              <fieldset>
                <legend>Scenes with {item.id}</legend>
                {story.scenes.map((scene) => (
                  <Label key={scene.id} className="flex gap-2">
                    <input
                      type="checkbox"
                      aria-label={`${item.id} in ${scene.id}`}
                      checked={scene.items?.includes(item.id) ?? false}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        change((s) => ({
                          ...s,
                          scenes: s.scenes.map((current) =>
                            current.id === scene.id
                              ? {
                                  ...current,
                                  items: checked
                                    ? [...new Set([...(current.items ?? []), item.id])]
                                    : current.items?.filter((id) => id !== item.id),
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
              <Button
                variant="ghost"
                disabled={blockers.length > 0}
                onClick={() => {
                  if (storyReferences(working, "item", item.id).length) return;
                  remove(
                    { kind: "item", id: item.id, value: item, index, baseline: working },
                    (s) => ({ ...s, items: s.items?.filter((value) => value.id !== item.id) }),
                  );
                }}
              >
                Remove item {item.id}
              </Button>
              {blockers.length ? (
                <p className="text-xs">Remove its references first: {blockers.join(", ")}</p>
              ) : null}
            </fieldset>
          );
        })}
        <Button
          variant="outline"
          onClick={() =>
            change((s) => ({
              ...s,
              items: [
                ...(s.items ?? []),
                {
                  id: nextId(
                    (s.items ?? []).map((item) => item.id),
                    "item",
                  ),
                  title: "New item",
                  description: "",
                },
              ],
            }))
          }
        >
          Add item
        </Button>
      </details>
      <details
        open={Object.keys(story.knowing ?? {}).length > 0}
        className="space-y-3 rounded border p-4"
      >
        <summary className="cursor-pointer font-semibold">Who knows what</summary>
        <p className="text-sm text-text-2">
          Keep “not declared” separate from “explicitly does not know”. During play both mean the
          person does not know yet. Entering a scene can only add knowledge.
        </p>
        {Object.entries(story.knowing ?? {}).map(([ref, knowledge]) => {
          const after = { ...story, knowing: without(story.knowing, ref) };
          const blockers = knowledgeRemovalReferences(working, ref, after);
          const removalError = storyRestoreError(working, { ...working, story: after });
          const listed = [
            ...new Set([
              ...people,
              ...(Array.isArray(knowledge.start.knows) ? knowledge.start.knows : []),
              ...(Array.isArray(knowledge.start.not) ? knowledge.start.not : []),
            ]),
          ];
          const audiencePatch = (field: "knows" | "not", value: Audience) =>
            patchKnowledge(ref, (current) => ({
              ...current,
              start:
                value === undefined
                  ? without(current.start, field)
                  : { ...current.start, [field]: value },
            }));
          return (
            <fieldset
              key={ref}
              id={storyObjectAnchor("knowing", ref)}
              className="space-y-3 rounded border p-3"
            >
              <legend>Information {ref}</legend>
              <AudienceField
                label={`Knows ${ref} at start`}
                value={knowledge.start.knows}
                people={people}
                optional
                onChange={(value) => audiencePatch("knows", value)}
              />
              <AudienceField
                label={`Does not know ${ref} at start`}
                value={knowledge.start.not}
                people={people}
                optional
                onChange={(value) => audiencePatch("not", value)}
              />
              <ul className="text-sm">
                {listed.map((person) => {
                  const knows =
                    knowledge.start.knows === "*" || knowledge.start.knows?.includes(person);
                  const not = knowledge.start.not === "*" || knowledge.start.not?.includes(person);
                  return (
                    <li key={person}>
                      {person}:{" "}
                      {knows && not
                        ? "Conflict: listed on both sides"
                        : knows
                          ? "Knows"
                          : not
                            ? "Explicitly does not know"
                            : "Not declared"}
                    </li>
                  );
                })}
              </ul>
              {diagnostics
                .filter((d) => d.subject === `story.knowing[${ref}]`)
                .map((d, i) => (
                  <p role="alert" key={i}>
                    {d.detail}
                  </p>
                ))}
              <fieldset className="space-y-3">
                <legend>Learn on entering a scene: {ref}</legend>
                {[
                  ...story.scenes,
                  ...Object.keys(knowledge.enter ?? {})
                    .filter((id) => !story.scenes.some((scene) => scene.id === id))
                    .map((id) => ({ id, title: `Missing scene: ${id}` })),
                ].map((scene) => {
                  const entering = knowledge.enter?.[scene.id];
                  return (
                    <div key={scene.id} className="space-y-2">
                      <Label className="flex gap-2">
                        <input
                          type="checkbox"
                          aria-label={`Learn ${ref} on entering ${scene.id}`}
                          checked={entering !== undefined}
                          onChange={(e) => {
                            if (e.target.checked)
                              patchKnowledge(ref, (current) => ({
                                ...current,
                                enter: { ...current.enter, [scene.id]: { knows: [] } },
                              }));
                            else if (entering)
                              remove(
                                {
                                  kind: "learning",
                                  id: ref,
                                  scene: scene.id,
                                  value: entering,
                                  baseline: working,
                                },
                                (s) => ({
                                  ...s,
                                  knowing: {
                                    ...s.knowing,
                                    [ref]: {
                                      ...(s.knowing?.[ref] ?? knowledge),
                                      enter: without(s.knowing?.[ref]?.enter, scene.id),
                                    },
                                  },
                                }),
                              );
                          }}
                        />
                        {storyText(scene.title, locale) || scene.id}
                      </Label>
                      {entering ? (
                        <AudienceField
                          label={`Learns ${ref} in ${scene.id}`}
                          value={entering.knows}
                          people={people}
                          onChange={(value) =>
                            patchKnowledge(ref, (current) => ({
                              ...current,
                              enter: {
                                ...current.enter,
                                [scene.id]: { ...current.enter?.[scene.id], knows: value ?? [] },
                              },
                            }))
                          }
                        />
                      ) : null}
                    </div>
                  );
                })}
              </fieldset>
              <Button
                variant="ghost"
                disabled={blockers.length > 0 || !!removalError}
                onClick={() =>
                  remove(
                    { kind: "knowledge", id: ref, value: knowledge, baseline: working },
                    (s) => ({ ...s, knowing: without(s.knowing, ref) }),
                  )
                }
              >
                Remove knowledge {ref}
              </Button>
              {blockers.length || removalError ? (
                <p className="text-xs">
                  Remove its references first: {blockers.join(", ") || removalError}
                </p>
              ) : null}
            </fieldset>
          );
        })}
        <div className="space-y-2 rounded border p-3">
          <Label className="block">
            Local information fragment
            <NativeSelect value="" onChange={(e) => setNewInfo(e.target.value)}>
              <option value="">Choose a local fragment</option>
              {(working.fragments ?? []).map((fragment) => (
                <option key={fragment.id} value={`#${fragment.id}`}>
                  {fragment.id}
                </option>
              ))}
            </NativeSelect>
          </Label>
          <Label className="block">
            Information reference
            <Input
              value={newInfo}
              placeholder="#secret or cast:actor#secret or @author/work#secret"
              onChange={(e) => setNewInfo(e.target.value)}
            />
          </Label>
          <p className="text-xs text-text-2">
            Only this work's fragments are listed. Cast and public references are checked in the
            dependency closure when building.
          </p>
          <Button
            variant="outline"
            onClick={() => {
              const ref = newInfo.trim();
              if (!StoryInfoRefSchema.safeParse(ref).success) {
                setError("Use #fragment, cast:actor#fragment or @author/work#fragment.");
                return;
              }
              if (Object.hasOwn(story.knowing ?? {}, ref)) {
                setError("This information already has a knowledge entry.");
                return;
              }
              if (
                ref.startsWith("#") &&
                !(working.fragments ?? []).some((fragment) => `#${fragment.id}` === ref)
              ) {
                setError("Choose an existing local fragment.");
                return;
              }
              if (ref.startsWith("cast:") && !people.includes(ref.slice(5).split("#")[0] ?? "")) {
                setError("Choose an existing cast key for this reference.");
                return;
              }
              change((s) =>
                Object.hasOwn(s.knowing ?? {}, ref)
                  ? s
                  : { ...s, knowing: { ...s.knowing, [ref]: { start: { knows: [] } } } },
              );
              setError("");
              setNotice(`Added knowledge entry ${ref}.`);
              setNewInfo("");
            }}
          >
            Add knowledge entry
          </Button>
        </div>
      </details>
    </section>
  );
}
