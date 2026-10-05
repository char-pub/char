import type {
  Story,
  StoryCondition,
  StoryEffect,
  StoryValue,
  StoryVariable,
} from "../schema/story.js";

export interface StoryDiagnostic {
  code: string;
  subject: string;
  severity: "error" | "warning";
  detail: string;
}

/** A comparison is constant only when every value in the declared integer domain agrees. */
function constantComparison(
  min: number,
  max: number,
  op: Extract<StoryCondition, { cmp: unknown }>["cmp"][1],
  right: number,
): boolean | undefined {
  if (min > max) return undefined;
  switch (op) {
    case "=":
      return right < min || right > max ? false : min === max ? true : undefined;
    case "!=":
      return right < min || right > max ? true : min === max ? false : undefined;
    case "<":
      return max < right ? true : min >= right ? false : undefined;
    case "<=":
      return max <= right ? true : min > right ? false : undefined;
    case ">":
      return min > right ? true : max <= right ? false : undefined;
    case ">=":
      return min >= right ? true : max < right ? false : undefined;
  }
}

export function setElement(variable: StoryVariable, value: string): string {
  return variable.type === "set" && variable.of === "item" && value.startsWith("item/")
    ? value.slice(5)
    : value;
}

export function validStoryValue(story: Story, variable: StoryVariable, value: StoryValue): boolean {
  switch (variable.type) {
    case "bool":
      return typeof value === "boolean";
    case "int":
      return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= variable.min &&
        value <= variable.max
      );
    case "enum":
      return typeof value === "string" && variable.values.includes(value);
    case "set": {
      const allowed =
        variable.of === "item" ? (story.items ?? []).map((i) => i.id) : (variable.values ?? []);
      return (
        Array.isArray(value) &&
        new Set(value).size === value.length &&
        value.every((v) => allowed.includes(v))
      );
    }
  }
}

export function controlledInformation(story: Story): Set<string> {
  const refs = new Set(Object.keys(story.knowing ?? {}));
  const effects = [
    ...(story.beats ?? []).flatMap((b) => b.effects ?? []),
    ...(story.endings ?? []).flatMap((b) => b.effects ?? []),
    ...(story.events ?? []).flatMap((b) => b.effects ?? []),
    ...(story.starts ?? []).flatMap((b) => b.set ?? []),
  ];
  for (const effect of effects) if ("learn" in effect) refs.add(effect.learn.info);
  return refs;
}

/** Suggestions list only declared alternatives; they never infer a rename or mutate author intent. */
function alternatives(values: Iterable<string>): string {
  const sorted = [...new Set(values)].sort();
  return (
    sorted
      .slice(0, 5)
      .map((value) => `'${value}'`)
      .join(", ") + (sorted.length > 5 ? ", …" : "")
  );
}

function valueSuggestion(story: Story, variable: StoryVariable): string {
  switch (variable.type) {
    case "bool":
      return "Use true or false.";
    case "int":
      return variable.min > variable.max
        ? "Set min no greater than max, then choose an initial integer within those bounds."
        : `Use an integer from ${variable.min} to ${variable.max}.`;
    case "enum":
      return `Choose one declared value: ${alternatives(variable.values)}.`;
    case "set": {
      const allowed =
        variable.of === "item"
          ? (story.items ?? []).map((item) => item.id)
          : (variable.values ?? []);
      return allowed.length
        ? `Use declared ${variable.of === "item" ? "item IDs" : "set values"}: ${alternatives(allowed)}; a set must not repeat values.`
        : `Declare ${variable.of === "item" ? "an Item" : "allowed set values"} before adding an element, or use an empty set.`;
    }
  }
}

/** Local/type checks; resolved information identity and rights remain closure checks. */
export function checkStory(
  story: Story,
  cast: readonly string[],
  information?: ReadonlySet<string>,
): StoryDiagnostic[] {
  const out: StoryDiagnostic[] = [];
  const error = (subject: string, detail: string, code = "story.invalid_reference") =>
    out.push({
      code,
      subject,
      severity: "error",
      detail,
    });
  const sets = {
    scene: new Set(story.scenes.map((x) => x.id)),
    beat: new Set((story.beats ?? []).map((x) => x.id)),
    ending: new Set((story.endings ?? []).map((x) => x.id)),
    event: new Set((story.events ?? []).map((x) => x.id)),
    item: new Set((story.items ?? []).map((x) => x.id)),
    choice: new Set((story.choices ?? []).map((x) => x.id)),
  };
  const members = new Set(cast);
  if (story.player !== undefined && !members.has(story.player))
    error(
      "story.player",
      "The controlled player must name a declared cast member.",
      "story.player_missing",
    );
  const controlled = controlledInformation(story);
  const missing = (kind: string, value: string, available: Iterable<string>) => {
    const options = alternatives(available);
    return `Unknown ${kind} '${value}'. ${options ? `Choose an existing ${kind}: ${options}; or create the intended ${kind} and update this reference.` : `Create the intended ${kind} first, then update this reference; none are declared yet.`}`;
  };
  const variableSuggestion = (type: StoryVariable["type"]) => {
    const names = Object.entries(story.vars ?? {})
      .filter(([, value]) => value.type === type)
      .map(([key]) => `var/${key}`);
    const options = alternatives(names);
    return options
      ? `Choose a declared ${type} variable: ${options}.`
      : `Declare a ${type} variable with its initial value${type === "int" ? " and min/max bounds" : type === "enum" || type === "set" ? " and allowed values" : ""}, then select it here.`;
  };
  const ref = (kind: keyof typeof sets, id: string, at: string) => {
    if (!sets[kind].has(id)) error(at, missing(kind, id, sets[kind]));
  };
  const person = (key: string, at: string) => {
    if (!members.has(key)) error(at, missing("participant", key, members));
  };
  const info = (value: string, at: string) => {
    if (value.startsWith("cast:")) person(value.slice(5).split("#")[0] ?? "", at);
    if (information && !information.has(value))
      error(
        at,
        `Unknown or ambiguous information '${value}'. Select an existing resolved information reference${information.size ? `: ${alternatives(information)}` : " after adding a fragment"}; use cast:<key>#<fragment> to identify a repeated character instance.`,
      );
  };
  for (const key of [
    "scenes",
    "beats",
    "endings",
    "choices",
    "plotlines",
    "starts",
    "items",
    "events",
    "timelines",
  ] as const) {
    const seen = new Set<string>();
    for (const item of story[key] ?? []) {
      if (seen.has(item.id))
        error(
          `story.${key}[${item.id}]`,
          `Duplicate ${key} ID. Give each object a unique ID and update the references that should point to it.`,
          "story.duplicate_id",
        );
      seen.add(item.id);
    }
  }
  const checkEffect = (effect: StoryEffect, at: string) => {
    if ("learn" in effect) {
      if (effect.learn.who !== "*") person(effect.learn.who, at);
      info(effect.learn.info, at);
      return;
    }
    const [op, tuple] = Object.entries(effect)[0] as [string, [string, StoryValue]];
    const variable = story.vars?.[tuple[0].slice(4)];
    if (!variable) {
      error(
        at,
        missing(
          "variable",
          tuple[0],
          Object.keys(story.vars ?? {}).map((key) => `var/${key}`),
        ),
      );
      return;
    }
    if (op === "set" && !validStoryValue(story, variable, tuple[1]))
      error(
        at,
        `Value does not match variable declaration. ${valueSuggestion(story, variable)}`,
        "story.invalid_value",
      );
    if (op === "add" && variable.type !== "int")
      error(
        at,
        `add requires an integer variable; '${tuple[0]}' is ${variable.type}. ${variableSuggestion("int")}`,
        "story.type_mismatch",
      );
    if (op === "put" || op === "drop") {
      if (
        variable.type !== "set" ||
        typeof tuple[1] !== "string" ||
        !validStoryValue(story, variable, [setElement(variable, tuple[1])])
      )
        error(
          at,
          `${op} requires an allowed set element. ${variable.type === "set" ? valueSuggestion(story, variable) : variableSuggestion("set")}`,
          "story.type_mismatch",
        );
    }
  };
  const checkCondition = (condition: StoryCondition, at: string) => {
    const stack = [{ node: condition, path: at, depth: 1 }];
    let count = 0;
    let maxDepth = 0;
    while (stack.length) {
      const entry = stack.pop();
      if (!entry) break;
      const { node, path, depth } = entry;
      count++;
      maxDepth = Math.max(maxDepth, depth);
      if (count > 512 || depth > 32) {
        error(
          at,
          "Condition exceeds 32 levels or 512 nodes. Split it into smaller conditions or express the decision with a declared variable.",
          "story.condition_limit",
        );
        return;
      }
      if ("all" in node || "any" in node) {
        const op = "all" in node ? "all" : "any";
        const children = "all" in node ? node.all : node.any;
        children.forEach((child, i) => {
          stack.push({ node: child, path: `${path}/${op}/${i}`, depth: depth + 1 });
        });
      } else if ("not" in node)
        stack.push({ node: node.not, path: `${path}/not`, depth: depth + 1 });
      else if ("judge" in node) {
        /* Runtime supplies a judgment. */
      } else if ("knows" in node) {
        person(node.knows.who, path);
        info(node.knows.info, path);
        if (!controlled.has(node.knows.info))
          error(
            path,
            `knows requires controlled information. Add '${node.knows.info}' to Story knowing with its initial knowers, or select already controlled information${controlled.size ? `: ${alternatives(controlled)}` : " after declaring it"}.`,
          );
      } else if ("is" in node || "cmp" in node || "eq" in node || "has" in node) {
        const key =
          "is" in node
            ? node.is
            : "cmp" in node
              ? node.cmp[0]
              : "eq" in node
                ? node.eq[0]
                : node.has[0];
        const variable = story.vars?.[key.slice(4)];
        const type = "is" in node ? "bool" : "cmp" in node ? "int" : "eq" in node ? "enum" : "set";
        if (!variable || variable.type !== type)
          error(
            path,
            `${key} must be a declared ${type}${variable ? `; it is ${variable.type}` : "; it is not declared"}. ${variableSuggestion(type)}${variable ? ` To test this ${variable.type} variable instead, use '${{ bool: "is", int: "cmp", enum: "eq", set: "has" }[variable.type]}'.` : ""}`,
            "story.type_mismatch",
          );
        else if ("cmp" in node && variable.type === "int") {
          const [, op, right] = node.cmp;
          const constant = constantComparison(variable.min, variable.max, op, right);
          if (constant !== undefined)
            out.push({
              code: "story.condition_constant",
              subject: path,
              severity: "warning",
              detail: `${key} ${op} ${right} is always ${constant} within its declared range [${variable.min}, ${variable.max}]. If this should gate progress, change the comparison/operator or review the declared bounds; otherwise keep it as an intentional constant.`,
            });
        } else if ("eq" in node && !validStoryValue(story, variable, node.eq[1]))
          error(path, `Unknown enum value. ${valueSuggestion(story, variable)}`);
        else if (
          "has" in node &&
          !validStoryValue(story, variable, [setElement(variable, node.has[1])])
        )
          error(path, `Unknown set element. ${valueSuggestion(story, variable)}`);
      } else {
        const value = Object.values(node)[0] as string;
        const [kind, id] = value.split("/") as [keyof typeof sets, string];
        ref(kind, id, path);
      }
    }
    if (count > 64 || maxDepth > 8)
      out.push({
        code: "story.condition_complex",
        subject: at,
        severity: "warning",
        detail: `Consider splitting this condition into smaller rules or using a declared variable.`,
      });
  };
  for (const [key, variable] of Object.entries(story.vars ?? {})) {
    const at = `story.vars.${key}`;
    if (variable.type === "set" && (variable.of !== undefined) === (variable.values !== undefined))
      error(
        at,
        "Choose exactly one of of:item and values; keep Item inventory or a custom set, and remove the other declaration.",
        "story.invalid_variable",
      );
    if (
      "values" in variable &&
      variable.values &&
      new Set(variable.values).size !== variable.values.length
    )
      error(
        at,
        "Duplicate variable values. Remove repeated options; each allowed value must have a unique ID.",
        "story.invalid_variable",
      );
    if (!validStoryValue(story, variable, variable.init))
      error(
        at,
        `Initial value outside declared type/range. ${valueSuggestion(story, variable)}`,
        "story.invalid_value",
      );
  }
  for (const scene of story.scenes) {
    const at = `story.scenes[${scene.id}]`;
    const present = scene.cast ?? cast;
    for (const key of present) person(key, at);
    if (new Set(present).size !== present.length)
      error(at, "Duplicate scene participant. List each participating cast key only once.");
    for (const key of Object.keys(scene.goals ?? {}))
      if (!present.includes(key))
        error(
          `${at}.goals.${key}`,
          "Goal belongs to an absent participant. Add that participant to this scene's cast, or move/remove this scene-specific goal.",
        );
    for (const key of ["beats", "choices", "items", "events"] as const) {
      const kind = { beats: "beat", choices: "choice", items: "item", events: "event" } as const;
      for (const value of scene[key] ?? []) ref(kind[key], value, `${at}.${key}`);
    }
    if (scene.place) info(scene.place, `${at}.place`);
    if (scene.when) checkCondition(scene.when, `${at}/when`);
  }
  for (const key of ["beats", "endings", "events", "choices"] as const) {
    for (const item of story[key] ?? []) {
      const at = `story.${key}[${item.id}]`;
      if (item.when) checkCondition(item.when, `${at}/when`);
      if ("effects" in item)
        item.effects?.forEach((effect, i) => {
          checkEffect(effect, `${at}/effects/${i}`);
        });
      if (
        key === "beats" &&
        "strength" in item &&
        item.strength === "required" &&
        !story.scenes.some((scene) => scene.beats?.includes(item.id))
      )
        error(
          at,
          "Required beat must be referenced by a scene. Add it to a scene's beats list, or change its strength if it is optional.",
        );
      if (key === "choices" && !story.scenes.some((scene) => scene.choices?.includes(item.id)))
        error(
          at,
          "Choice must be referenced by a scene. Add it to a scene's choices list, or remove the unused suggestion.",
        );
      if ("kind" in item && item.kind === "background" && (item.when || item.effects?.length))
        error(
          at,
          "Background event cannot have conditions/effects. Remove them from a past fact, or change the event to planned if it should happen during play.",
        );
      if ("cast" in item) for (const key of item.cast ?? []) person(key, at);
      if ("truth" in item && item.truth) info(item.truth, at);
      if ("place" in item && item.place) info(item.place, at);
    }
  }
  for (const line of story.plotlines ?? []) {
    if (!line.scenes?.length && !line.beats?.length)
      error(
        `story.plotlines[${line.id}]`,
        "Plotline needs scenes or beats. Link at least one existing scene or beat, or remove the empty plotline.",
      );
    for (const value of line.scenes ?? []) ref("scene", value, `story.plotlines[${line.id}]`);
    for (const value of line.beats ?? []) ref("beat", value, `story.plotlines[${line.id}]`);
  }
  for (const line of story.timelines ?? []) {
    const ids = line.order.flat();
    if (new Set(ids).size !== ids.length)
      error(
        `story.timelines[${line.id}]`,
        "Timeline repeats an object. Keep each scene or event only once in this timeline, including parallel groups.",
      );
    for (const value of ids)
      value.startsWith("scene/")
        ? ref("scene", value.slice(6), `story.timelines[${line.id}]`)
        : ref("event", value, `story.timelines[${line.id}]`);
  }
  for (const start of story.starts ?? []) {
    const at = `story.starts[${start.id}]`;
    if ((story.starts?.length ?? 0) > 1 && (!start.title || !start.description))
      error(
        at,
        "Multiple starts need title and description. Describe this opening so players can distinguish it from the alternatives.",
      );
    if (start.scene) ref("scene", start.scene, at);
    for (const value of start.reached ?? []) ref("beat", value, at);
    start.set?.forEach((effect, i) => {
      checkEffect(effect, `${at}/set/${i}`);
    });
  }
  for (const [key, entry] of Object.entries(story.knowing ?? {})) {
    const at = `story.knowing[${key}]`;
    info(key, at);
    if (entry.start.knows === undefined && entry.start.not === undefined)
      error(
        at,
        "Knowledge needs knows or not. Declare initial knowers or non-knowers; an explicit empty knows list means nobody starts knowing.",
      );
    const knows = entry.start.knows === "*" ? cast : (entry.start.knows ?? []);
    const not = entry.start.not === "*" ? cast : (entry.start.not ?? []);
    for (const key of [...knows, ...not]) person(key, at);
    if (knows.some((key) => not.includes(key)))
      error(
        at,
        "Participant is both knowing and not knowing. Choose one initial state for each participant and remove it from the opposite list; check wildcard lists too.",
      );
    for (const [scene, value] of Object.entries(entry.enter ?? {})) {
      ref("scene", scene, at);
      for (const key of value.knows === "*" ? cast : value.knows) person(key, at);
    }
  }
  return out;
}
