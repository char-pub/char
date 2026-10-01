/** Structured authoring only: Core validates and executes Story conditions and effects. */
import {
  type CastMember,
  checkStory,
  controlledInformation,
  type Story,
  type StoryCondition,
  type StoryEffect,
  type StoryValue,
  type StoryVariable,
} from "@char-pub/core";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { localeOf, nextId, type Working } from "@/lib/draft";
import { storyConditionAnchor } from "@/lib/editor-location";
import { storyOf, storyText, withStoryText } from "@/lib/story-editor";
import { Field, reorder } from "./policy-editor";

const conditionNames = {
  judge: "Describe a condition",
  all: "All conditions",
  any: "Any condition",
  not: "Not",
  in: "Current scene",
  visited: "Visited scene",
  reached: "Reached change",
  ended: "Reached ending",
  happened: "Event happened",
  knows: "Person knows information",
  is: "Boolean is true",
  cmp: "Compare integer",
  eq: "Enum equals",
  has: "Set contains",
} as const;
type ConditionKind = keyof typeof conditionNames;
const effectNames = {
  set: "Set variable",
  add: "Add to integer",
  put: "Add to set",
  drop: "Remove from set",
  learn: "Learn information",
} as const;
type EffectKind = keyof typeof effectNames;
type Option = { value: string; label: string };
const options = (values: readonly string[]): Option[] =>
  values.map((value) => ({ value, label: value }));
const members = (w: Working) =>
  ((w.cast as CastMember[] | undefined) ?? []).map((person) => person.key);
const variables = (w: Working, type?: StoryVariable["type"]) =>
  Object.entries(storyOf(w)?.vars ?? {})
    .filter(([, variable]) => !type || variable.type === type)
    .map(([key]) => `var/${key}`);
const variableOf = (w: Working, key: string) => storyOf(w)?.vars?.[key.slice(4)];
function setValues(w: Working, variable: StoryVariable | undefined, prefixed = false): string[] {
  if (variable?.type !== "set") return [];
  return variable.of === "item"
    ? (storyOf(w)?.items ?? []).map((item) => `${prefixed ? "item/" : ""}${item.id}`)
    : (variable.values ?? []);
}
function setReferenceValue(variable: StoryVariable | undefined, value: string) {
  return variable?.type === "set" && variable.of === "item" && !value.startsWith("item/")
    ? `item/${value}`
    : value;
}
function information(w: Working, controlled: boolean): string[] {
  const story = storyOf(w);
  const local = new Set((w.fragments ?? []).map((fragment) => `#${fragment.id}`));
  const known = story ? [...controlledInformation(story)] : [];
  const existing = known.filter((ref) =>
    ref.startsWith("#")
      ? local.has(ref)
      : ref.startsWith("cast:")
        ? members(w).includes(ref.slice(5).split("#")[0] ?? "")
        : ref.startsWith("@"),
  );
  return [...new Set(controlled ? existing : [...local, ...existing])];
}
function progressOptions(w: Working, kind: ConditionKind): string[] {
  const story = storyOf(w);
  if (!story) return [];
  if (kind === "in" || kind === "visited") return story.scenes.map((scene) => `scene/${scene.id}`);
  if (kind === "reached") return (story.beats ?? []).map((beat) => `beat/${beat.id}`);
  if (kind === "ended") return (story.endings ?? []).map((ending) => `ending/${ending.id}`);
  if (kind === "happened") return (story.events ?? []).map((event) => `event/${event.id}`);
  return [];
}

function Select({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string;
  choices: Option[];
  onChange: (next: string) => void;
}) {
  const missing = value !== "" && !choices.some((choice) => choice.value === value);
  return (
    <div className="space-y-1">
      <Label className="block">
        {label}
        <NativeSelect
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {!value ? <option value="">Choose…</option> : null}
          {missing ? <option value={value}>Missing or incompatible: {value}</option> : null}
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </NativeSelect>
      </Label>
      {missing ? (
        <p role="alert" className="text-xs">
          Choose an existing compatible target to replace {value}.
        </p>
      ) : null}
      {!choices.length ? (
        <p className="text-xs text-text-2">
          No compatible targets. Add the needed Story object, variable or controlled information
          first.
        </p>
      ) : null}
    </div>
  );
}
function Integer({
  label,
  value,
  min = -2147483648,
  max = 2147483647,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const number = Number(text);
  const valid = /^-?\d+$/.test(text) && Number.isInteger(number) && number >= min && number <= max;
  return (
    <div className="space-y-1">
      <Label className="block">
        {label}
        <Input
          aria-label={label}
          inputMode="numeric"
          value={text}
          aria-invalid={!valid}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            const n = Number(next);
            if (/^-?\d+$/.test(next) && Number.isInteger(n) && n >= min && n <= max) onChange(n);
          }}
        />
      </Label>
      {!valid ? (
        <p role="alert" className="text-xs">
          Enter an integer from {min} to {max}. This edit has not been applied.
        </p>
      ) : (
        <p className="text-xs text-text-2">
          Integer from {min} to {max}.
        </p>
      )}
    </div>
  );
}
function firstCondition(
  w: Working,
  kind: ConditionKind,
  current?: StoryCondition,
): StoryCondition | undefined {
  if (kind === "all") return { all: current ? [current] : [] };
  if (kind === "any") return { any: current ? [current] : [] };
  if (kind === "not") return { not: current ?? { judge: "" } };
  if (kind === "judge") return { judge: "" };
  const target = progressOptions(w, kind)[0];
  if (target) return { [kind]: target } as StoryCondition;
  if (kind === "knows") {
    const who = members(w)[0],
      info = information(w, true)[0];
    return who && info ? { knows: { who, info } } : undefined;
  }
  if (kind === "is") {
    const key = variables(w, "bool")[0];
    return key ? { is: key } : undefined;
  }
  if (kind === "cmp") {
    const key = variables(w, "int")[0];
    return key ? { cmp: [key, ">=", 0] } : undefined;
  }
  if (kind === "eq") {
    const key = variables(w, "enum").find((key) => {
      const v = variableOf(w, key);
      return v?.type === "enum" && v.values.length;
    });
    const v = key ? variableOf(w, key) : undefined;
    return key && v?.type === "enum" && v.values[0] ? { eq: [key, v.values[0]] } : undefined;
  }
  if (kind === "has") {
    const key = variables(w, "set").find((key) => setValues(w, variableOf(w, key), true).length);
    const item = key ? setValues(w, variableOf(w, key), true)[0] : undefined;
    return key && item ? { has: [key, item] } : undefined;
  }
  return undefined;
}

type ConditionNodeProps = {
  working: Working;
  value: StoryCondition;
  path: string;
  location?: { collection: string; id: string; path: string } | undefined;
  change: (next: StoryCondition, structural?: boolean) => void;
};
function ConditionNode({ working, value, path, location, change }: ConditionNodeProps) {
  const kind = Object.keys(value)[0] as ConditionKind;
  const [error, setError] = useState("");
  const locale = localeOf(working);
  const children = "all" in value ? value.all : "any" in value ? value.any : undefined;
  const setChildren = (next: StoryCondition[], structural = false) =>
    change(kind === "all" ? { all: next } : { any: next }, structural);
  return (
    <fieldset
      id={
        location ? storyConditionAnchor(location.collection, location.id, location.path) : undefined
      }
      className="space-y-3 rounded border p-3"
    >
      <legend className="px-1 text-xs">{path}</legend>
      <Select
        label={`${path} rule`}
        value={kind}
        choices={Object.entries(conditionNames).map(([value, label]) => ({ value, label }))}
        onChange={(next) => {
          const replacement = firstCondition(working, next as ConditionKind, value);
          if (!replacement) {
            setError(
              "No compatible targets. Add the required object or variable first; the current rule is unchanged.",
            );
            return;
          }
          setError("");
          change(replacement, true);
        }}
      />
      {error ? <p role="alert">{error}</p> : null}
      {children ? (
        <>
          {!children.length ? (
            <p className="text-sm">
              {kind === "all" ? "An empty All group is true." : "An empty Any group is false."}
            </p>
          ) : null}
          {children.map((child, index) => (
            <div key={`${path}/${index}`} className="space-y-2">
              <ConditionNode
                working={working}
                value={child}
                path={`${path}.${index + 1}`}
                location={
                  location ? { ...location, path: `${location.path}/${kind}/${index}` } : undefined
                }
                change={(next, structural) =>
                  setChildren(
                    children.map((item, i) => (i === index ? next : item)),
                    structural,
                  )
                }
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    setChildren(
                      children.filter((_, i) => i !== index),
                      true,
                    )
                  }
                >
                  Remove rule {path}.{index + 1}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={index === 0}
                  onClick={() => setChildren(reorder(children, index, -1), true)}
                >
                  Move rule {path}.{index + 1} up
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={index === children.length - 1}
                  onClick={() => setChildren(reorder(children, index, 1), true)}
                >
                  Move rule {path}.{index + 1} down
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() => setChildren([...children, { judge: "" }], true)}
          >
            Add condition to {path}
          </Button>
        </>
      ) : null}
      {"not" in value ? (
        <>
          <ConditionNode
            working={working}
            value={value.not}
            path={`${path}.not`}
            location={location ? { ...location, path: `${location.path}/not` } : undefined}
            change={(next, structural) => change({ not: next }, structural)}
          />
          <Button type="button" variant="outline" onClick={() => change(value.not, true)}>
            Unwrap Not {path}
          </Button>
        </>
      ) : null}
      {"judge" in value ? (
        <Field
          label={`${path} condition description`}
          multiline
          value={storyText(value.judge, locale)}
          onChange={(text) => {
            if (text === "" && typeof value.judge === "object") {
              const remaining = { ...value.judge };
              delete remaining[locale];
              if (Object.keys(remaining).length) {
                change({ judge: remaining });
                return;
              }
            }
            change({ judge: withStoryText(value.judge, locale, text) });
          }}
        />
      ) : null}
      {"in" in value ||
      "visited" in value ||
      "reached" in value ||
      "ended" in value ||
      "happened" in value ? (
        <Select
          label={`${path} target`}
          value={Object.values(value)[0] as string}
          choices={options(progressOptions(working, kind))}
          onChange={(target) => change({ [kind]: target } as StoryCondition)}
        />
      ) : null}
      {"knows" in value ? (
        <>
          <Select
            label={`${path} person`}
            value={value.knows.who}
            choices={options(members(working))}
            onChange={(who) => change({ knows: { ...value.knows, who } })}
          />
          <Select
            label={`${path} information`}
            value={value.knows.info}
            choices={options(information(working, true))}
            onChange={(info) => change({ knows: { ...value.knows, info } })}
          />
          <p className="text-xs">
            Only information controlled by knowledge or a Learn effect is available. Dependency
            references are checked when the draft builds.
          </p>
        </>
      ) : null}
      {"is" in value ? (
        <Select
          label={`${path} boolean variable`}
          value={value.is}
          choices={options(variables(working, "bool"))}
          onChange={(key) => change({ is: key })}
        />
      ) : null}
      {"cmp" in value ? (
        <>
          <Select
            label={`${path} integer variable`}
            value={value.cmp[0]}
            choices={options(variables(working, "int"))}
            onChange={(key) => change({ cmp: [key, value.cmp[1], value.cmp[2]] })}
          />
          <Select
            label={`${path} comparison`}
            value={value.cmp[1]}
            choices={options(["=", "!=", "<", "<=", ">", ">="])}
            onChange={(op) =>
              change({ cmp: [value.cmp[0], op as (typeof value.cmp)[1], value.cmp[2]] })
            }
          />
          <Integer
            label={`${path} compare with`}
            value={value.cmp[2]}
            onChange={(n) => change({ cmp: [value.cmp[0], value.cmp[1], n] })}
          />
          <p className="text-xs">
            Comparison constants may exceed the variable bounds; Core reports constant-result
            warnings.
          </p>
        </>
      ) : null}
      {"eq" in value || "has" in value
        ? (() => {
            const enumCondition = "eq" in value;
            const tuple = enumCondition ? value.eq : value.has;
            const variable = variableOf(working, tuple[0]);
            const allowed = enumCondition
              ? variable?.type === "enum"
                ? variable.values
                : []
              : setValues(working, variable, true);
            const replace = (key: string, item: string) =>
              change(enumCondition ? { eq: [key, item] } : { has: [key, item] });
            return (
              <>
                <Select
                  label={`${path} ${enumCondition ? "enum" : "set"} variable`}
                  value={tuple[0]}
                  choices={options(variables(working, enumCondition ? "enum" : "set"))}
                  onChange={(key) => replace(key, tuple[1])}
                />
                <Select
                  label={`${path} value`}
                  value={enumCondition ? tuple[1] : setReferenceValue(variable, tuple[1])}
                  choices={options(allowed)}
                  onChange={(item) => replace(tuple[0], item)}
                />
              </>
            );
          })()
        : null}
    </fieldset>
  );
}

function undoError(
  w: Working,
  condition: StoryCondition | undefined,
  effects?: StoryEffect[],
  baseline?: Working,
): string | null {
  const story = storyOf(w);
  if (!story) return "Restore the Story before undoing this edit.";
  // Core owns typing, progress references and knowledge semantics. A probe is never saved or executed.
  const id = nextId(
    (story.beats ?? []).map((beat) => beat.id),
    "editor-undo-probe",
  );
  const probe: Story = {
    ...story,
    beats: [
      ...(story.beats ?? []),
      {
        id,
        title: "Undo probe",
        description: "Undo validation",
        ...(condition ? { when: condition } : {}),
        ...(effects ? { effects } : {}),
      },
    ],
  };
  const externalInCondition = (node: StoryCondition | undefined): boolean => {
    if (!node) return false;
    if ("knows" in node) return !node.knows.info.startsWith("#");
    if ("not" in node) return externalInCondition(node.not);
    if ("all" in node) return node.all.some(externalInCondition);
    if ("any" in node) return node.any.some(externalInCondition);
    return false;
  };
  const restoringExternal =
    externalInCondition(condition) ||
    effects?.some((effect) => "learn" in effect && !effect.learn.info.startsWith("#"));
  if (
    restoringExternal &&
    baseline &&
    (baseline.references ?? []).some(
      (previous) =>
        !(w.references ?? []).some(
          (current) => JSON.stringify(current) === JSON.stringify(previous),
        ),
    )
  )
    return "Dependencies changed. Restore their previous versions before undoing this reference, or add it again and build to verify it.";
  const candidate = { ...w, story: probe };
  const errors = checkStory(probe, members(w), new Set(information(candidate, false))).filter(
    (diagnostic) =>
      diagnostic.severity === "error" && diagnostic.subject.startsWith(`story.beats[${id}]`),
  );
  return errors.length
    ? `Cannot undo yet: ${errors.map((error) => error.detail).join("; ")}`
    : null;
}

export function StoryConditionEditor({
  working,
  value,
  onChange,
  label = "Condition",
  location,
}: {
  working: Working;
  value?: StoryCondition | undefined;
  onChange: (next: StoryCondition | undefined) => void;
  label?: string;
  location?: { collection: string; id: string };
}) {
  const [undo, setUndo] = useState<{
    before: StoryCondition | undefined;
    after: StoryCondition | undefined;
    baseline: Working;
  } | null>(null);
  const [error, setError] = useState("");
  const change = (next: StoryCondition | undefined, structural = false) => {
    if (structural) setUndo({ before: value, after: next, baseline: working });
    setError("");
    onChange(next);
  };
  const conflict = undo && JSON.stringify(value) !== JSON.stringify(undo.after);
  return (
    <section className="space-y-3" aria-label={label}>
      <h4 className="font-medium">{label}</h4>
      <p className="text-xs text-text-2">
        Rules only declare prerequisites. Runtime confirms what happens. Group changes wrap the
        existing rule. Removing or replacing a rule removes its language variants too. Undo is
        available until further edits.
      </p>
      {value ? (
        <>
          <ConditionNode
            working={working}
            value={value}
            path="Rule"
            location={location ? { ...location, path: "/when" } : undefined}
            change={change}
          />
          <Button type="button" variant="ghost" onClick={() => change(undefined, true)}>
            Remove condition
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm">No condition: this object has no prerequisite.</p>
          <Select
            label="Add condition"
            value=""
            choices={Object.entries(conditionNames).map(([value, label]) => ({ value, label }))}
            onChange={(kind) => {
              const next = firstCondition(working, kind as ConditionKind);
              if (!next) {
                setError(
                  "No compatible targets. Add the required Story object, typed variable or controlled information first.",
                );
                return;
              }
              change(next, true);
            }}
          />
        </>
      )}
      {undo ? (
        <>
          <Button
            type="button"
            variant="outline"
            disabled={!!conflict}
            onClick={() => {
              const issue = undoError(working, undo.before, undefined, undo.baseline);
              if (issue) {
                setError(issue);
                return;
              }
              onChange(undo.before);
              setUndo(null);
              setError("");
            }}
          >
            Undo condition edit
          </Button>
          {conflict ? (
            <p className="text-xs">Later edits are present. Undo cannot replace them.</p>
          ) : null}
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

function initialEffect(w: Working, kind: EffectKind): StoryEffect | undefined {
  if (kind === "learn") {
    const info = information(w, false)[0];
    return info ? { learn: { who: "*", info } } : undefined;
  }
  const key = variables(
    w,
    kind === "add" ? "int" : kind === "put" || kind === "drop" ? "set" : undefined,
  ).find((key) =>
    kind === "put" || kind === "drop" ? setValues(w, variableOf(w, key), true).length : true,
  );
  const variable = key ? variableOf(w, key) : undefined;
  if (!key || !variable) return undefined;
  if (kind === "set") return { set: [key, variable.init] };
  if (kind === "add") return { add: [key, 1] };
  const item = setValues(w, variable, true)[0];
  return item ? ({ [kind]: [key, item] } as StoryEffect) : undefined;
}
function EffectRow({
  working,
  value,
  index,
  change,
}: {
  working: Working;
  value: StoryEffect;
  index: number;
  change: (next: StoryEffect, structural?: boolean) => void;
}) {
  const kind = Object.keys(value)[0] as EffectKind;
  const prefix = `Effect ${index + 1}`;
  const [error, setError] = useState("");
  if ("learn" in value)
    return (
      <fieldset className="space-y-3 rounded border p-3">
        <legend>{prefix}: Learn information</legend>
        <Select
          label={`${prefix} person`}
          value={value.learn.who}
          choices={[{ value: "*", label: "Everyone (*)" }, ...options(members(working))]}
          onChange={(who) => change({ learn: { ...value.learn, who } })}
        />
        <Select
          label={`${prefix} information`}
          value={value.learn.info}
          choices={options(information(working, false))}
          onChange={(info) => change({ learn: { ...value.learn, info } })}
        />
        <EffectType
          working={working}
          kind={kind}
          label={`${prefix} operation`}
          change={change}
          error={error}
          setError={setError}
        />
      </fieldset>
    );
  const tuple =
    "set" in value
      ? value.set
      : "add" in value
        ? value.add
        : "put" in value
          ? value.put
          : value.drop;
  const variable = variableOf(working, tuple[0]);
  const allowedType =
    kind === "add" ? "int" : kind === "put" || kind === "drop" ? "set" : undefined;
  const replace = (key: string, next: StoryValue) => change({ [kind]: [key, next] } as StoryEffect);
  return (
    <fieldset className="space-y-3 rounded border p-3">
      <legend>{prefix}</legend>
      <EffectType
        working={working}
        kind={kind}
        label={`${prefix} operation`}
        change={change}
        error={error}
        setError={setError}
      />
      <Select
        label={`${prefix} variable`}
        value={tuple[0]}
        choices={options(variables(working, allowedType))}
        onChange={(key) => replace(key, tuple[1])}
      />
      {kind === "add" ? (
        <>
          <Integer
            label={`${prefix} amount`}
            value={tuple[1] as number}
            onChange={(n) => replace(tuple[0], n)}
          />
          <p className="text-xs">
            Core clamps the resulting integer to the declared bounds when this effect is confirmed.
          </p>
        </>
      ) : kind === "put" || kind === "drop" ? (
        <Select
          label={`${prefix} member`}
          value={setReferenceValue(variable, tuple[1] as string)}
          choices={options(setValues(working, variable, true))}
          onChange={(next) => replace(tuple[0], next)}
        />
      ) : (
        <StoryValueEditor
          working={working}
          variable={variable}
          value={tuple[1]}
          label={`${prefix} value`}
          change={(next) => replace(tuple[0], next)}
        />
      )}
    </fieldset>
  );
}
function EffectType({
  working,
  kind,
  label,
  change,
  error,
  setError,
}: {
  working: Working;
  kind: EffectKind;
  label: string;
  change: (next: StoryEffect, structural?: boolean) => void;
  error: string;
  setError: (error: string) => void;
}) {
  return (
    <>
      <Select
        label={label}
        value={kind}
        choices={Object.entries(effectNames).map(([value, label]) => ({ value, label }))}
        onChange={(kind) => {
          const next = initialEffect(working, kind as EffectKind);
          if (!next) {
            setError(
              "No compatible targets. The effect is unchanged; create the required variable or information first.",
            );
            return;
          }
          setError("");
          change(next, true);
        }}
      />
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
export function StoryValueEditor({
  working,
  variable,
  value,
  label,
  change,
}: {
  working: Working;
  variable: StoryVariable | undefined;
  value: StoryValue;
  label: string;
  change: (next: StoryValue) => void;
}) {
  if (!variable)
    return <p role="alert">This variable no longer exists. Choose an existing variable.</p>;
  if (variable.type === "bool")
    return (
      <Select
        label={label}
        value={typeof value === "boolean" ? String(value) : `invalid:${JSON.stringify(value)}`}
        choices={options(["true", "false"])}
        onChange={(next) => change(next === "true")}
      />
    );
  if (variable.type === "int")
    return typeof value === "number" ? (
      <Integer
        label={label}
        value={value}
        min={variable.min}
        max={variable.max}
        onChange={change}
      />
    ) : (
      <div>
        <p role="alert">The stored value is not an integer. Choose a value explicitly.</p>
        <Button type="button" variant="outline" onClick={() => change(variable.init)}>
          Use declared initial value ({variable.init})
        </Button>
      </div>
    );
  if (variable.type === "enum")
    return (
      <Select
        label={label}
        value={typeof value === "string" ? value : `invalid:${JSON.stringify(value)}`}
        choices={options(variable.values)}
        onChange={change}
      />
    );
  const allowed = setValues(working, variable);
  if (!Array.isArray(value))
    return (
      <div>
        <p role="alert">The stored value is not a set.</p>
        <Button type="button" variant="outline" onClick={() => change([])}>
          Use an empty set
        </Button>
      </div>
    );
  return (
    <fieldset className="space-y-2">
      <legend>{label}</legend>
      {[...new Set([...allowed, ...value])].map((item) => (
        <Label key={item} className="flex gap-2">
          <input
            type="checkbox"
            checked={value.includes(item)}
            onChange={(event) =>
              change(
                event.target.checked
                  ? [...value, item]
                  : value.filter((existing) => existing !== item),
              )
            }
          />
          {allowed.includes(item) ? item : `Missing: ${item}`}
        </Label>
      ))}
      {!allowed.length ? (
        <p className="text-xs">
          No declared set members. An empty set is valid; add items or variable values to select
          members.
        </p>
      ) : null}
    </fieldset>
  );
}

export function StoryEffectsEditor({
  working,
  value = [],
  onChange,
  label = "Effects",
  phase = "confirmation",
}: {
  working: Working;
  value?: StoryEffect[] | undefined;
  onChange: (next: StoryEffect[]) => void;
  label?: string;
  phase?: "opening" | "confirmation";
}) {
  const [undo, setUndo] = useState<{
    before: StoryEffect[];
    after: StoryEffect[];
    baseline: Working;
  } | null>(null);
  const [error, setError] = useState("");
  const change = (next: StoryEffect[], structural = false) => {
    if (structural) setUndo({ before: value, after: next, baseline: working });
    setError("");
    onChange(next);
  };
  const conflict = undo && JSON.stringify(value) !== JSON.stringify(undo.after);
  return (
    <section className="space-y-3" aria-label={label}>
      <h4 className="font-medium">{label}</h4>
      <p className="text-xs text-text-2">
        {phase === "opening"
          ? "Opening effects run after initial variable and knowledge values, before entering the scene."
          : "Effects run in this order only after Runtime confirms the object."}{" "}
        This editor never applies them to a play session.
      </p>
      {value.map((effect, index) => (
        <div key={index} className="space-y-2">
          <EffectRow
            working={working}
            value={effect}
            index={index}
            change={(next, structural) =>
              change(
                value.map((item, i) => (i === index ? next : item)),
                structural,
              )
            }
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                change(
                  value.filter((_, i) => i !== index),
                  true,
                )
              }
            >
              Remove effect {index + 1}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={index === 0}
              onClick={() => change(reorder(value, index, -1), true)}
            >
              Move effect {index + 1} up
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={index === value.length - 1}
              onClick={() => change(reorder(value, index, 1), true)}
            >
              Move effect {index + 1} down
            </Button>
          </div>
        </div>
      ))}
      <Select
        label="Add effect"
        value=""
        choices={Object.entries(effectNames).map(([value, label]) => ({ value, label }))}
        onChange={(kind) => {
          const next = initialEffect(working, kind as EffectKind);
          if (!next) {
            setError("No compatible targets. Add a typed variable or information fragment first.");
            return;
          }
          change([...value, next], true);
        }}
      />
      {undo ? (
        <>
          <Button
            type="button"
            variant="outline"
            disabled={!!conflict}
            onClick={() => {
              const issue = undoError(working, undefined, undo.before, undo.baseline);
              if (issue) {
                setError(issue);
                return;
              }
              onChange(undo.before);
              setUndo(null);
              setError("");
            }}
          >
            Undo effects edit
          </Button>
          {conflict ? (
            <p className="text-xs">Later edits are present. Undo cannot replace them.</p>
          ) : null}
        </>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
