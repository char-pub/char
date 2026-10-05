import { z } from "zod";
import { CAST_KEY_RE, FRAGMENT_ID_RE, SEGMENT_RE } from "../ids.js";
import { LocalizedTemplateTextSchema, LocalizedTextSchema } from "./text.js";

const id = z.string().regex(SEGMENT_RE);
const castKey = z.string().regex(CAST_KEY_RE);
const fragment = FRAGMENT_ID_RE.source.slice(1, -1);
/** Public references are checked against the resolved closure, instance references against cast. */
export const StoryInfoRefSchema = z
  .string()
  .regex(
    new RegExp(
      `^(?:#${fragment}|@[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*#${fragment}|cast:[a-z0-9][a-z0-9_-]*#${fragment})$`,
    ),
  );
const variable = z.string().regex(/^var\/[a-z0-9][a-z0-9_-]*$/);
const int = z.number().int().min(-2147483648).max(2147483647);
const info = StoryInfoRefSchema;
const text = LocalizedTextSchema;
const strings = z.array(id);
export const StoryValueSchema = z.union([z.boolean(), int, z.string(), z.array(z.string())]);
export type StoryValue = z.infer<typeof StoryValueSchema>;

/** Reviewed initial situation for a new sequel; never a saved runtime or history import. */
export const StoryContinuationInputSchema = z.strictObject({
  scene: id,
  present: z.array(castKey),
  vars: z.record(id, StoryValueSchema),
  knowing: z.record(StoryInfoRefSchema, z.array(castKey)),
  opening: LocalizedTemplateTextSchema,
});
export type StoryContinuationInput = z.infer<typeof StoryContinuationInputSchema>;

export type StoryCondition =
  | { all: StoryCondition[] }
  | { any: StoryCondition[] }
  | { not: StoryCondition }
  | { in: string }
  | { visited: string }
  | { reached: string }
  | { ended: string }
  | { happened: string }
  | { knows: { who: string; info: string } }
  | { is: string }
  | { cmp: [string, "=" | "!=" | "<" | "<=" | ">" | ">=", number] }
  | { eq: [string, string] }
  | { has: [string, string] }
  | { judge: z.infer<typeof text> };

const target = (kind: string) => z.string().regex(new RegExp(`^${kind}/[a-z0-9][a-z0-9_-]*$`));
export const StoryConditionSchema: z.ZodType<StoryCondition> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(StoryConditionSchema) }),
    z.strictObject({ any: z.array(StoryConditionSchema) }),
    z.strictObject({ not: StoryConditionSchema }),
    z.strictObject({ in: target("scene") }),
    z.strictObject({ visited: target("scene") }),
    z.strictObject({ reached: target("beat") }),
    z.strictObject({ ended: target("ending") }),
    z.strictObject({ happened: target("event") }),
    z.strictObject({ knows: z.strictObject({ who: castKey, info }) }),
    z.strictObject({ is: variable }),
    z.strictObject({ cmp: z.tuple([variable, z.enum(["=", "!=", "<", "<=", ">", ">="]), int]) }),
    z.strictObject({ eq: z.tuple([variable, id]) }),
    z.strictObject({ has: z.tuple([variable, z.string().min(1)]) }),
    z.strictObject({ judge: text }),
  ]),
);

export const StoryEffectSchema = z.union([
  z.strictObject({ set: z.tuple([variable, StoryValueSchema]) }),
  z.strictObject({ add: z.tuple([variable, int]) }),
  z.strictObject({ put: z.tuple([variable, z.string().min(1)]) }),
  z.strictObject({ drop: z.tuple([variable, z.string().min(1)]) }),
  z.strictObject({ learn: z.strictObject({ who: z.union([castKey, z.literal("*")]), info }) }),
]);
export type StoryEffect = z.infer<typeof StoryEffectSchema>;

export const StoryVariableSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("bool"), init: z.boolean(), description: text }),
  z.strictObject({ type: z.literal("int"), init: int, min: int, max: int, description: text }),
  z.strictObject({ type: z.literal("enum"), init: id, values: strings.min(1), description: text }),
  z.strictObject({
    type: z.literal("set"),
    init: z.array(z.string()),
    of: z.literal("item").optional(),
    values: strings.optional(),
    description: text,
  }),
]);
export type StoryVariable = z.infer<typeof StoryVariableSchema>;

const named = { id, title: text, description: text.optional() };
const strength = z.enum(["possible", "suggested", "required"]).optional();
const reveal = z.enum(["hidden", "on-reach", "listed"]).optional();
const when = StoryConditionSchema.optional();
const effects = z.array(StoryEffectSchema).optional();
const lore = z.array(z.string().min(1)).optional();

export const StorySceneSchema = z.strictObject({
  ...named,
  time: text.optional(),
  where: text.optional(),
  place: info.optional(),
  cast: z.array(castKey).optional(),
  opening: LocalizedTemplateTextSchema.optional(),
  goals: z.record(castKey, text).optional(),
  beats: strings.optional(),
  choices: strings.optional(),
  lore,
  items: strings.optional(),
  events: strings.optional(),
  when,
});
export const StoryBeatSchema = z.strictObject({
  ...named,
  description: text,
  strength,
  reveal,
  when,
  effects,
});
export const StoryEndingSchema = z.strictObject({
  ...named,
  description: text,
  strength,
  reveal,
  when,
  effects,
  after: z.enum(["stop", "continue"]).optional(),
  priority: int.optional(),
});
export const StoryChoiceSchema = z.strictObject({ id, label: text, intent: text, when });
export const StoryStartSchema = z.strictObject({
  id,
  title: text.optional(),
  description: text.optional(),
  scene: id.optional(),
  greeting: z.union([LocalizedTemplateTextSchema, z.strictObject({ ref: id })]).optional(),
  set: effects,
  reached: strings.optional(),
});
export const StoryEventSchema = z.strictObject({
  ...named,
  description: text,
  kind: z.enum(["background", "planned"]),
  when_text: text.optional(),
  cast: z.array(castKey).optional(),
  place: info.optional(),
  truth: info.optional(),
  lore,
  when,
  effects,
});
const audience = z.union([z.array(castKey), z.literal("*")]);
export const StorySchema = z.strictObject({
  version: z.literal(1),
  /** Explicit single-player control of a declared cast member; never inferred from role or name. */
  player: castKey.optional(),
  scenes: z.array(StorySceneSchema).min(1),
  beats: z.array(StoryBeatSchema).optional(),
  endings: z.array(StoryEndingSchema).optional(),
  choices: z.array(StoryChoiceSchema).optional(),
  plotlines: z
    .array(z.strictObject({ ...named, scenes: strings.optional(), beats: strings.optional() }))
    .optional(),
  starts: z.array(StoryStartSchema).min(1).optional(),
  vars: z.record(id, StoryVariableSchema).optional(),
  items: z
    .array(
      z.strictObject({
        ...named,
        description: text,
        lore,
        reveal: z.enum(["hidden", "on-reach"]).optional(),
      }),
    )
    .optional(),
  events: z.array(StoryEventSchema).optional(),
  timelines: z
    .array(
      z.strictObject({
        ...named,
        order: z.array(z.union([z.string().min(1), z.array(z.string().min(1)).min(1)])),
      }),
    )
    .optional(),
  knowing: z
    .record(
      info,
      z.strictObject({
        start: z.strictObject({ knows: audience.optional(), not: audience.optional() }),
        enter: z.record(id, z.strictObject({ knows: audience })).optional(),
      }),
    )
    .optional(),
});
export type Story = z.infer<typeof StorySchema>;
export type StoryScene = z.infer<typeof StorySceneSchema>;
export type StoryJudgment = {
  target: string;
  path: string;
  result: "true" | "false" | "undetermined";
  provider: { name: string; version: string };
};

/** Runtime-owned snapshot. Cast membership is immutable; presence is session state. */
export interface StoryState {
  start: string;
  scene: string;
  present: string[];
  visited: string[];
  reached: string[];
  ended: string[];
  happened: string[];
  vars: Record<string, StoryValue>;
  knowing: Record<string, string[]>;
  stopped: boolean;
}
