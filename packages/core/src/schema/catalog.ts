import { z } from "zod";
import { LocaleSchema, LocalizedTextSchema } from "./text.js";

export const CatalogRefSchema = z.union([
  z.strictObject({ work: z.string().min(1) }),
  z.strictObject({ fragment: z.string().min(1) }),
  z.strictObject({ group: z.string().min(1) }),
  z.strictObject({ source: z.string().min(1), section: z.string().min(1).optional() }),
  z.strictObject({
    story: z.enum(["scene", "part", "goal", "beat", "ending"]),
    id: z.string().min(1),
  }),
]);
export type CatalogRef = z.infer<typeof CatalogRefSchema>;

/** Editorial associations; never an instruction to expose or activate the target. */
export const AboutTargetSchema = z.union([
  z.strictObject({ work: z.string().min(1) }),
  z.strictObject({ fragment: z.string().min(1) }),
  z.strictObject({ participant: z.string().min(1) }),
]);
export type AboutTarget = z.infer<typeof AboutTargetSchema>;

const identified = {
  id: z.string().min(1),
  owner: z.string().min(1),
  local_id: z.string().min(1),
  title: LocalizedTextSchema,
  description: LocalizedTextSchema.optional(),
};
export const CatalogIndexSchema = z.strictObject({
  about: z
    .array(
      z.strictObject({
        from: z.string().min(1),
        ref: z.string().min(1),
        target: AboutTargetSchema,
      }),
    )
    .optional(),
  works: z.array(
    z.strictObject({
      id: z.string().min(1),
      ref: z.string().min(1),
      instance: z.string().min(1),
      title: LocalizedTextSchema,
      description: LocalizedTextSchema.optional(),
      fragments: z.array(z.string()),
      groups: z.array(z.string()),
      sources: z.array(z.string()),
    }),
  ),
  groups: z.array(
    z.strictObject({
      ...identified,
      entries: z.array(z.string()),
      groups: z.array(z.string()),
    }),
  ),
  sources: z.array(
    z.strictObject({
      ...identified,
      asset: z.string().min(1),
      format: z.enum(["markdown", "text"]),
      shared: z.boolean(),
      sections: z.array(
        z.strictObject({
          id: z.string().min(1),
          title: LocalizedTextSchema,
          description: LocalizedTextSchema.optional(),
          anchor: z.string().min(1),
        }),
      ),
    }),
  ),
});
export type CatalogIndex = z.infer<typeof CatalogIndexSchema>;

export const CompiledTemplateSchema = z.strictObject({
  text: z.string(),
  locales: z.record(LocaleSchema, z.string()).optional(),
});
export type CompiledTemplate = z.infer<typeof CompiledTemplateSchema>;

export const StoryReferencesSchema = z.strictObject({
  templates: z.record(z.string(), CompiledTemplateSchema),
  participants: z.record(z.string(), z.string()),
  information: z.record(z.string(), z.string()),
  /** Direct associations can point to a group or source section, not only a fragment. */
  content: z.record(z.string(), CatalogRefSchema),
});
export type StoryReferences = z.infer<typeof StoryReferencesSchema>;
