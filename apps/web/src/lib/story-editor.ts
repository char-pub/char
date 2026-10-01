/** Authoring helpers preserve authored fields; runtime transitions remain in the SDK. */
import {
  type AssemblyFixture,
  type CastMember,
  canonicalizeCreation,
  checkCreation,
  checkStory,
  type FragmentContent,
  lateSlotKey,
  participantKey,
  type Story,
  type StoryCondition,
  type StoryEffect,
  tokenizeTemplate,
} from "@char-pub/core";
import type { Working } from "./draft";

export function storyOf(w: Working): Story | undefined {
  return w.story as Story | undefined;
}
export function storyText(value: unknown, locale: string): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && locale in value) {
    const text = (value as Record<string, unknown>)[locale];
    return typeof text === "string" ? text : "";
  }
  return "";
}
export function withStoryText(
  prev: unknown,
  locale: string,
  text: string,
): string | Record<string, string> {
  return prev && typeof prev === "object"
    ? { ...(prev as Record<string, string>), [locale]: text }
    : text;
}
export type StoryObjectKind =
  | "scene"
  | "beat"
  | "ending"
  | "choice"
  | "event"
  | "plotline"
  | "start"
  | "var"
  | "item";
const collections: Record<StoryObjectKind, keyof Story> = {
  scene: "scenes",
  beat: "beats",
  ending: "endings",
  choice: "choices",
  event: "events",
  plotline: "plotlines",
  start: "starts",
  var: "vars",
  item: "items",
};

/** Only grammar-owned references count; author text and external fixture roots are unrelated. */
export function storyReferences(w: Working, kind: StoryObjectKind, id: string): string[] {
  const found = new Set<string>();
  const qualified = `${kind}/${id}`;
  const match = (target: StoryObjectKind, value: unknown, path: string) => {
    if (kind === target && value === id) found.add(path);
  };
  const list = (target: StoryObjectKind, value: readonly string[] | undefined, path: string) => {
    if (kind === target && value?.includes(id)) found.add(path);
  };
  const story = storyOf(w);
  const itemValue = (variable: string, value: unknown, path: string) => {
    if (kind !== "item" || story?.vars?.[variable.slice(4)]?.type !== "set") return;
    const declaration = story.vars[variable.slice(4)];
    if (declaration?.type !== "set" || declaration.of !== "item") return;
    const values = Array.isArray(value) ? value : [value];
    if (values.includes(id) || values.includes(`item/${id}`)) found.add(path);
  };
  const effects = (values: StoryEffect[] | undefined, path: string) => {
    values?.forEach((effect, i) => {
      if ("learn" in effect) return;
      const [op, tuple] = Object.entries(effect)[0] as [string, [string, unknown]];
      if (kind === "var" && tuple[0] === qualified) found.add(`${path}[${i}].${op}`);
      itemValue(tuple[0], tuple[1], `${path}[${i}].${op}`);
    });
  };
  const condition = (value: StoryCondition | undefined, path: string): void => {
    if (!value) return;
    if ("all" in value)
      value.all.forEach((child, i) => {
        condition(child, `${path}.all[${i}]`);
      });
    else if ("any" in value)
      value.any.forEach((child, i) => {
        condition(child, `${path}.any[${i}]`);
      });
    else if ("not" in value) condition(value.not, `${path}.not`);
    else {
      if ("is" in value && kind === "var" && value.is === qualified) found.add(`${path}.is`);
      for (const operation of ["cmp", "eq", "has"] as const) {
        if (operation in value) {
          const tuple = (value as { [key: string]: unknown })[operation] as [string, unknown];
          if (kind === "var" && tuple[0] === qualified) found.add(`${path}.${operation}`);
          if (operation === "has") itemValue(tuple[0], tuple[1], `${path}.has`);
        }
      }
      const leaves = {
        in: "scene",
        visited: "scene",
        reached: "beat",
        ended: "ending",
        happened: "event",
      } as const;
      for (const [key, target] of Object.entries(leaves)) {
        if (kind === target && key in value && value[key as keyof typeof value] === qualified)
          found.add(`${path}.${key}`);
      }
    }
  };
  if (story) {
    for (const target of ["scene", "beat", "ending", "choice", "event"] as const) {
      const collection = collections[target] as
        | "scenes"
        | "beats"
        | "endings"
        | "choices"
        | "events";
      story[collection]?.forEach((item, i) => {
        if (target === kind && item.id === id) return;
        condition(item.when, `story.${collection}[${i}].when`);
        if ("effects" in item) effects(item.effects, `story.${collection}[${i}].effects`);
      });
    }
    story.scenes.forEach((scene, i) => {
      if (kind === "scene" && scene.id === id) return;
      list("beat", scene.beats, `story.scenes[${i}].beats`);
      list("choice", scene.choices, `story.scenes[${i}].choices`);
      list("event", scene.events, `story.scenes[${i}].events`);
      list("item", scene.items, `story.scenes[${i}].items`);
    });
    story.plotlines?.forEach((line, i) => {
      if (kind === "plotline" && line.id === id) return;
      list("scene", line.scenes, `story.plotlines[${i}].scenes`);
      list("beat", line.beats, `story.plotlines[${i}].beats`);
    });
    story.timelines?.forEach((line, i) => {
      // Timeline scenes are qualified; event IDs are bare, including parallel groups.
      if (
        (kind === "scene" && line.order.flat().includes(qualified)) ||
        (kind === "event" && line.order.flat().includes(id))
      )
        found.add(`story.timelines[${i}].order`);
    });
    story.starts?.forEach((start, i) => {
      if (kind === "start" && start.id === id) return;
      match("scene", start.scene, `story.starts[${i}].scene`);
      list("beat", start.reached, `story.starts[${i}].reached`);
      effects(start.set, `story.starts[${i}].set`);
    });
    for (const [key, variable] of Object.entries(story.vars ?? {})) {
      if (kind === "var" && key === id) continue;
      if (variable.type === "set") itemValue(`var/${key}`, variable.init, `story.vars.${key}.init`);
    }
    if (kind === "scene")
      for (const [info, entry] of Object.entries(story.knowing ?? {})) {
        if (entry.enter && Object.hasOwn(entry.enter, id))
          found.add(`story.knowing.${info}.enter.${id}`);
      }
  }
  w.fragments?.forEach((fragment, i) => {
    if (fragment.visibility?.scope === "story-scene")
      match("scene", fragment.visibility.scene, `fragments[${i}].visibility.scene`);
    // about targets a fragment, work or cast participant, never a Story object.
  });
  w.references?.forEach((reference, i) => {
    if (reference.scope && typeof reference.scope === "object" && "scene" in reference.scope)
      match("scene", reference.scope.scene, `references[${i}].scope.scene`);
  });
  if (Array.isArray(w.assembly_tests))
    (w.assembly_tests as AssemblyFixture[]).forEach((fixture, i) => {
      if (fixture?.root !== "self") return;
      const path = `assembly_tests[${i}]`;
      const vars = fixture.session?.story?.vars;
      if (kind === "var" && vars && Object.hasOwn(vars, id))
        found.add(`${path}.session.story.vars.${id}`);
      for (const [key, value] of Object.entries(vars ?? {}))
        itemValue(`var/${key}`, value, `${path}.session.story.vars.${key}`);
      match("scene", fixture.session?.scene, `${path}.session.scene`);
      match("start", fixture.session?.story?.start, `${path}.session.story.start`);
      for (const [key, target] of Object.entries({
        visited: "scene",
        reached: "beat",
        ended: "ending",
        happened: "event",
      } as const)) {
        list(
          target,
          fixture.session?.story?.[key as "visited" | "reached" | "ended" | "happened"],
          `${path}.session.story.${key}`,
        );
      }
      fixture.session?.judgments?.forEach((judgment, j) => {
        if (judgment.target === qualified) found.add(`${path}.session.judgments[${j}].target`);
      });
      fixture.selection?.forEach((ref, j) => {
        if ("story" in ref && ref.story === kind && ref.id === id)
          found.add(`${path}.selection[${j}]`);
      });
      if (fixture.expected?.kind === "success")
        fixture.expected.trace?.forEach((assertion, j) => {
          if (assertion.source === `story:${kind}:${id}`)
            found.add(`${path}.expected.trace[${j}].source`);
        });
    });
  return [...found];
}

/** Explicit references to a root cast key; implicit all-present audiences do not block removal. */
export function castReferences(w: Working, key: string): string[] {
  const found = new Set<string>();
  const macro = `{{cast:${key}}}`;
  const infoPrefix = `cast:${key}#`;
  const person = (value: unknown, path: string) => {
    if (value === key) found.add(path);
  };
  const audience = (value: unknown, path: string) => {
    if (Array.isArray(value) && value.includes(key)) found.add(path);
  };
  const info = (value: unknown, path: string) => {
    if (typeof value === "string" && (value === `cast:${key}` || value.startsWith(infoPrefix)))
      found.add(path);
  };
  const speaker = (value: unknown, path: string) => {
    if (value === macro) found.add(path);
  };
  const template = (value: unknown, path: string) => {
    if (
      typeof value === "string" &&
      tokenizeTemplate(value).tokens.some((token) => token.t === "cast" && token.name === key)
    )
      found.add(path);
  };
  const localizedTemplate = (value: unknown, path: string) => {
    if (typeof value === "string") template(value, path);
    else if (value && typeof value === "object" && !("ref" in value))
      for (const [locale, text] of Object.entries(value)) template(text, `${path}.${locale}`);
  };
  const content = (value: FragmentContent | undefined, path: string) => {
    if (value?.type === "text") template(value.text, `${path}.text`);
    else if (value?.type === "media") template(value.caption, `${path}.caption`);
    else if (value?.type === "dialogue")
      value.turns?.forEach((turn, i) => {
        speaker(turn.speaker, `${path}.turns[${i}].speaker`);
        template(turn.text, `${path}.turns[${i}].text`);
      });
  };
  const condition = (value: StoryCondition | undefined, path: string): void => {
    if (!value) return;
    if ("all" in value)
      value.all.forEach((child, i) => {
        condition(child, `${path}.all[${i}]`);
      });
    else if ("any" in value)
      value.any.forEach((child, i) => {
        condition(child, `${path}.any[${i}]`);
      });
    else if ("not" in value) condition(value.not, `${path}.not`);
    else if ("knows" in value) {
      person(value.knows.who, `${path}.knows.who`);
      info(value.knows.info, `${path}.knows.info`);
    }
  };
  const effects = (value: NonNullable<Story["starts"]>[number]["set"], path: string) => {
    value?.forEach((effect, i) => {
      if ("learn" in effect) {
        person(effect.learn.who, `${path}[${i}].learn.who`);
        info(effect.learn.info, `${path}[${i}].learn.info`);
      }
    });
  };
  const story = storyOf(w);
  story?.scenes?.forEach((scene, i) => {
    const path = `story.scenes[${i}]`;
    audience(scene.cast, `${path}.cast`);
    if (scene.goals && Object.hasOwn(scene.goals, key)) found.add(`${path}.goals.${key}`);
    condition(scene.when, `${path}.when`);
    localizedTemplate(scene.opening, `${path}.opening`);
    info(scene.place, `${path}.place`);
    scene.lore?.forEach((ref, j) => {
      info(ref, `${path}.lore[${j}]`);
    });
  });
  for (const collection of ["beats", "endings", "choices", "events"] as const)
    story?.[collection]?.forEach((item, i) => {
      const path = `story.${collection}[${i}]`;
      condition(item.when, `${path}.when`);
      if ("effects" in item) effects(item.effects, `${path}.effects`);
      if ("cast" in item) audience(item.cast, `${path}.cast`);
      if ("place" in item) info(item.place, `${path}.place`);
      if ("truth" in item) info(item.truth, `${path}.truth`);
      if ("lore" in item)
        item.lore?.forEach((ref, j) => {
          info(ref, `${path}.lore[${j}]`);
        });
    });
  story?.items?.forEach((item, i) => {
    item.lore?.forEach((ref, j) => {
      info(ref, `story.items[${i}].lore[${j}]`);
    });
  });
  story?.starts?.forEach((start, i) => {
    localizedTemplate(start.greeting, `story.starts[${i}].greeting`);
    effects(start.set, `story.starts[${i}].set`);
  });
  for (const [ref, entry] of Object.entries(story?.knowing ?? {})) {
    const path = `story.knowing.${ref}`;
    info(ref, path);
    audience(entry.start?.knows, `${path}.start.knows`);
    audience(entry.start?.not, `${path}.start.not`);
    for (const [scene, entering] of Object.entries(entry.enter ?? {}))
      audience(entering.knows, `${path}.enter.${scene}.knows`);
  }
  w.fragments?.forEach((fragment, i) => {
    const path = `fragments[${i}]`;
    if (fragment.visibility?.scope === "private" && fragment.visibility.to.includes(macro))
      found.add(`${path}.visibility.to`);
    if (typeof fragment.perspective === "object")
      for (const [name, value] of Object.entries(fragment.perspective))
        speaker(value, `${path}.perspective.${name}`);
    fragment.about?.forEach((ref, j) => {
      info(ref, `${path}.about[${j}]`);
    });
    info(fragment.source?.use, `${path}.source.use`);
    content(fragment.content, `${path}.content`);
    for (const [locale, variant] of Object.entries(fragment.locale ?? {}))
      content(variant.content, `${path}.locale.${locale}.content`);
  });
  w.bootstrap?.greetings?.forEach((greeting, i) => {
    template(greeting.text, `bootstrap.greetings[${i}].text`);
    for (const [locale, variant] of Object.entries(greeting.locale ?? {}))
      content(variant.content, `bootstrap.greetings[${i}].locale.${locale}.content`);
  });
  w.references?.forEach((reference, i) => {
    if (reference.scope && typeof reference.scope === "object" && "cast" in reference.scope)
      person(reference.scope.cast, `references[${i}].scope.cast`);
    for (const [slot, binding] of Object.entries(reference.bind ?? {}))
      speaker(binding, `references[${i}].bind.${slot}`);
    // Overrides are compiled in the referenced creation's cast scope, not this root's.
  });
  const members = Array.isArray(w.cast) ? (w.cast as CastMember[]) : [];
  const late = members.find((member) => member.key === key)?.who;
  const participant = participantKey("root", key);
  const sessionPerson = (value: unknown, path: string) => {
    if (value === key || value === participant) found.add(path);
  };
  if (Array.isArray(w.assembly_tests))
    (w.assembly_tests as AssemblyFixture[]).forEach((fixture, i) => {
      if (fixture?.root !== "self") return;
      const path = `assembly_tests[${i}]`;
      const session = fixture.session;
      sessionPerson(session?.for_participant, `${path}.session.for_participant`);
      session?.present?.forEach((value, j) => {
        sessionPerson(value, `${path}.session.present[${j}]`);
      });
      session?.history?.forEach((message, j) => {
        sessionPerson(message.speaker, `${path}.session.history[${j}].speaker`);
      });
      if (
        late &&
        typeof late === "object" &&
        session?.bindings &&
        Object.hasOwn(session.bindings, lateSlotKey("root", key))
      )
        found.add(`${path}.session.bindings.${lateSlotKey("root", key)}`);
      for (const [ref, value] of Object.entries(session?.story?.knowing ?? {})) {
        info(ref, `${path}.session.story.knowing.${ref}`);
        audience(value, `${path}.session.story.knowing.${ref}`);
      }
      fixture.selection?.forEach((ref, j) => {
        if ("story" in ref && (ref.story === "part" || ref.story === "goal"))
          person(ref.id, `${path}.selection[${j}]`);
      });
      if (fixture.expected?.kind === "success")
        fixture.expected.trace?.forEach((assertion, j) => {
          if (assertion.source === `story:part:${key}` || assertion.source === `story:goal:${key}`)
            found.add(`${path}.expected.trace[${j}].source`);
        });
    });
  return [...found];
}

/** Undo may restore an object only while its references are still available. */
export function storyRestoreError(
  before: Working,
  after: Working,
  baseline: Working = before,
): string | null {
  try {
    const errors = (w: Working) => {
      const story = storyOf(w);
      const result = story
        ? checkStory(
            story,
            ((w.cast as CastMember[] | undefined) ?? []).map((member) => member.key),
          )
        : [];
      // Text may be unfinished, but restoring an opening still requires its named inputs.
      const names = {
        cast: new Set(((w.cast as CastMember[] | undefined) ?? []).map((member) => member.key)),
        slot: new Set(Object.keys(w.slots ?? {})),
        param: new Set(Object.keys(w.params ?? {})),
      };
      const missing = (subject: string, detail: string) => {
        result.push({
          code: "story.restore_missing_reference",
          subject,
          detail,
          severity: "error",
        });
      };
      const template = (value: unknown, subject: string) => {
        const texts =
          typeof value === "string"
            ? [["", value]]
            : value && typeof value === "object"
              ? Object.entries(value)
              : [];
        for (const [locale, text] of texts) {
          if (typeof text !== "string") continue;
          for (const token of tokenizeTemplate(text).tokens) {
            if (
              (token.t === "cast" || token.t === "slot" || token.t === "param") &&
              !names[token.t].has(token.name)
            )
              missing(
                locale ? `${subject}[${locale}]` : subject,
                `Opening references missing ${token.t} '${token.name}'`,
              );
          }
        }
      };
      for (const scene of story?.scenes ?? [])
        template(scene.opening, `story.scenes[${scene.id}].opening`);
      for (const start of story?.starts ?? []) {
        const greeting = start.greeting;
        const subject = `story.starts[${start.id}].greeting`;
        if (greeting && typeof greeting === "object" && "ref" in greeting) {
          if (!w.bootstrap?.greetings.some((entry) => entry.id === greeting.ref))
            missing(subject, `Opening references missing bootstrap greeting '${greeting.ref}'`);
        } else template(greeting, subject);
      }
      try {
        result.push(
          ...checkCreation(canonicalizeCreation(w).creation)
            .diagnostics.filter((d) => d.severity === "error")
            .map((d) => ({ ...d, severity: "error" as const, detail: d.detail ?? d.code })),
        );
      } catch {
        /* Incomplete prose remains editable; Story and opening references were checked above. */
      }
      return result.filter((d) => d.severity === "error");
    };
    const existing = new Set(
      [...errors(before), ...errors(baseline)].map((d) => JSON.stringify(d)),
    );
    const added = errors(after).filter((d) => !existing.has(JSON.stringify(d)));
    return added.length ? `Cannot restore yet: ${added.map((d) => d.detail).join("; ")}` : null;
  } catch {
    return "Complete the current Story structure before restoring this item. Your removed item is still available to undo.";
  }
}
